import { CommandId, type OrchestrationV2DomainEvent } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/**
 * Fork feature: when `autoRegenerateThreadTitles` is on for a thread's project,
 * each completed run asks for the same title regeneration as the
 * "Regenerate title" menu action, so titles follow the conversation.
 */
export class ThreadTitleAutoRegenerationReactor extends Context.Service<
  ThreadTitleAutoRegenerationReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ThreadTitleAutoRegenerationReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  // Runs for every domain event; most return before any work is needed.
  const handle: ThreadTitleAutoRegenerationReactor["Service"]["handle"] = Effect.fnUntraced(
    function* (event) {
      if (event.type !== "run.updated" || event.payload.status !== "completed") return;
      const thread = yield* projections.getThread(event.threadId);
      if (thread.archivedAt !== null || thread.deletedAt !== null) return;
      const { settings } = resolveProjectSettings(
        yield* serverSettings.getSettings,
        thread.projectId,
      );
      if (!settings.autoRegenerateThreadTitles) return;
      // Keyed by run, so a run reported complete more than once regenerates once.
      yield* engine.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make(`server:auto-title:${event.payload.id}`),
        threadId: event.threadId,
        regenerateTitle: true,
      });
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("automatic thread title regeneration failed", {
            threadId: event.threadId,
            cause,
          }),
        ),
      ),
  );

  const start: ThreadTitleAutoRegenerationReactor["Service"]["start"] = () =>
    forkParked(
      Stream.runForEach(engine.streamDomainEvents, handle).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("automatic thread title regeneration event stream failed", { cause }),
        ),
      ),
    );

  return { start, handle } satisfies ThreadTitleAutoRegenerationReactor["Service"];
});

export const layer = Layer.effect(ThreadTitleAutoRegenerationReactor, make);
