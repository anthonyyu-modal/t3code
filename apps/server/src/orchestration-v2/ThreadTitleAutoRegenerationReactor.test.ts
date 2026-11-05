import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadTitleAutoRegenerationReactor from "./ThreadTitleAutoRegenerationReactor.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const projectId = ProjectId.make("project:auto-title");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.1-codex" };
const adapter = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("provider execution is disabled in auto title tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const layer = (settings: Parameters<typeof ServerSettings.layerTest>[0]) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  return ThreadTitleAutoRegenerationReactor.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        layerDatabase,
        ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
        EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
        ServerSettings.layerTest(settings),
        ProviderReplayHarness.layerWithRegistry(
          { name: "auto-title" },
          ProviderAdapterRegistry.layerFromAdapters([adapter]),
          { databaseLayer: layerDatabase, runEffectWorker: false },
        ),
      ),
    ),
  );
};

const completeRunOnNewThread = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const reactor = yield* ThreadTitleAutoRegenerationReactor.ThreadTitleAutoRegenerationReactor;
  const threadId = ThreadId.make("thread:auto-title");
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create-auto-title"),
    threadId,
    projectId,
    title: "First title",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  yield* orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make("start-auto-title"),
    threadId,
    messageId: MessageId.make("message:auto-title"),
    text: "Fix the login bug",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    creationSource: "web",
  });
  const run = (yield* projections.getThreadProjection(threadId)).runs[0]!;
  const completed = {
    id: EventId.make("event:auto-title-run-completed"),
    threadId,
    runId: run.id,
    occurredAt: run.requestedAt,
    type: "run.updated" as const,
    payload: { ...run, status: "completed" as const },
  };
  yield* reactor.handle(completed);
  yield* reactor.handle(completed);
  const outbox = yield* EffectOutbox.EffectOutboxV2;
  const requestId = CommandId.make(`server:auto-title:${run.id}`);
  return {
    thread: (yield* projections.getThreadProjection(threadId)).thread,
    requestId,
    effects: (yield* outbox.listByCommandId(requestId)).map((effect) => effect.request),
  };
});

it.effect("regenerates the title once per completed run when enabled", () =>
  Effect.gen(function* () {
    const { thread, requestId, effects } = yield* completeRunOnNewThread;
    assert.equal(thread.titleRegeneration?.requestId, requestId);
    assert.deepEqual(effects, [{ type: "thread-title.generate", kind: { type: "regenerate" } }]);
  }).pipe(Effect.provide(layer({ autoRegenerateThreadTitles: true }))),
);

it.effect("honors a project override that turns it off", () =>
  Effect.gen(function* () {
    const { thread, requestId, effects } = yield* completeRunOnNewThread;
    assert.notEqual(thread.titleRegeneration?.requestId, requestId);
    assert.deepEqual(effects, []);
  }).pipe(
    Effect.provide(
      layer({
        autoRegenerateThreadTitles: true,
        projectSettingsOverrides: { [projectId]: { autoRegenerateThreadTitles: false } },
      }),
    ),
  ),
);
