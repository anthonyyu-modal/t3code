import { assert, describe, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EventSink from "./EventSink.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadHotLinks from "./ThreadHotLinksService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const projectId = ProjectId.make("project:hot-links");
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.1-codex",
} as const;

const adapter = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("provider execution is disabled in hot links tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

function makeHarness(
  options: {
    readonly generateHotLinks?: TextGeneration.TextGeneration["Service"]["generateThreadHotLinks"];
  } = {},
) {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerRegistry = ProviderAdapterRegistry.layerFromAdapters([adapter]);
  const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
    { name: "thread-hot-links" },
    layerRegistry,
    { databaseLayer: layerDatabase, runEffectWorker: false },
  );
  const layerServerSettings = ServerSettings.layerTest({});
  const layerThreadManagement = ThreadManagement.layer.pipe(
    Layer.provide(layerOrchestrator),
    Layer.provide(layerServerSettings),
    Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
  const generateThreadHotLinks = vi.fn(
    options.generateHotLinks ??
      ((input) =>
        Effect.succeed({
          links: input.candidateUrls.map((url) => ({ url, label: "Extracted link" })),
        })),
  );
  const layerProjectedProjects = Layer.mock(ProjectStore.ProjectStoreV2)({
    get: (requestedProjectId) =>
      Effect.succeed(
        requestedProjectId === projectId
          ? Option.some({
              projectId,
              title: "Project",
              workspaceRoot: "/repo",
              defaultModelSelection: modelSelection,
              defaultThreadEnvMode: null,
              hasCustomTitle: false,
              autoPull: false,
              faviconPath: null,
              projectIcon: null,
              scripts: [],
              trackedFolders: [],
              pinnedAt: null,
              archivedAt: null,
              createdAt: "2026-06-20T00:00:00.000Z",
              updatedAt: "2026-06-20T00:00:00.000Z",
              deletedAt: null,
            })
          : Option.none(),
      ),
  });
  const layerHotLinks = ThreadHotLinks.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerDatabase,
        layerThreadManagement,
        layerProjectedProjects,
        Layer.mock(TextGeneration.TextGeneration)({ generateThreadHotLinks }),
        layerServerSettings,
        NodeServices.layer,
      ),
    ),
  );
  return {
    layer: Layer.mergeAll(layerOrchestrator, layerThreadManagement, layerHotLinks, layerDatabase),
    generateThreadHotLinks,
  };
}

function createThread(thread: string) {
  return Effect.gen(function* () {
    const threads = yield* ThreadManagement.ThreadManagementService;
    const threadId = ThreadId.make(thread);
    yield* threads.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${thread}`),
      threadId,
      projectId,
      title: "Seed title",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    return threadId;
  });
}

function recordRun(input: {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly ordinal: number;
  readonly user: string;
  readonly assistant: string;
}) {
  return Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const providerThreadId = ProviderThreadId.make(`${input.threadId}:provider`);
    const message = (role: "user" | "assistant", text: string) => ({
      id: EventId.make(`${input.runId}:${role}`),
      type: "message.updated" as const,
      threadId: input.threadId,
      runId: input.runId,
      occurredAt: now,
      payload: {
        id: MessageId.make(`${input.runId}:${role}`),
        threadId: input.threadId,
        runId: input.runId,
        nodeId: null,
        role,
        text,
        attachments: [],
        streaming: false,
        createdBy: role === "user" ? ("user" as const) : ("agent" as const),
        creationSource: role === "user" ? ("web" as const) : ("provider" as const),
        createdAt: now,
        updatedAt: now,
      },
    });
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(`${input.runId}:created`),
          type: "run.created",
          threadId: input.threadId,
          runId: input.runId,
          occurredAt: now,
          payload: {
            id: input.runId,
            threadId: input.threadId,
            ordinal: input.ordinal,
            providerInstanceId: modelSelection.instanceId,
            modelSelection,
            providerThreadId,
            userMessageId: MessageId.make(`${input.runId}:user`),
            rootNodeId: null,
            activeAttemptId: null,
            status: "completed",
            requestedAt: now,
            startedAt: now,
            completedAt: now,
            checkpointId: null,
            contextHandoffId: null,
          },
        },
        {
          id: EventId.make(`${input.runId}:provider-thread`),
          type: "provider-thread.updated",
          threadId: input.threadId,
          occurredAt: now,
          payload: {
            id: providerThreadId,
            driver: adapter.driver,
            providerInstanceId: modelSelection.instanceId,
            providerSessionId: null,
            appThreadId: input.threadId,
            ownerNodeId: null,
            nativeThreadRef: { driver: adapter.driver, nativeId: "native", strength: "strong" },
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: 1,
            lastRunOrdinal: input.ordinal,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        message("user", input.user),
        message("assistant", input.assistant),
      ],
    });
  });
}

describe("ThreadHotLinksService", () => {
  it.effect(
    "extracts hot links solely from user-authored messages, drops unmentioned URLs, caches in SQLite, and inherits pre-fork user links",
    () => {
      const plainUrl =
        "https://app.plain.com/workspace/w_01KWMBPKHR6KG1HJYJKR5CW91N/thread/th_01M71FTBJTCH5N6QCNHJDD9ZNP";
      const slackUrl = "https://modal-com.slack.com/archives/C082J7T719B/p1794248046987359";
      const assistantOnlyUrl = "https://docs.kernel.org/admin-guide/cgroup-v2.html";
      const quotedAssistantCitation = serializeAssistantCitation({
        version: 1,
        environmentId: EnvironmentId.make("local"),
        threadId: ThreadId.make("thread:main"),
        messageId: MessageId.make("run:1:assistant"),
        text: `See ${assistantOnlyUrl} for quota details`,
        start: 0,
        end: 58,
        prefix: "",
        suffix: "",
        comment: `Also check ${slackUrl}`,
      });

      const harness = makeHarness({
        generateHotLinks: () =>
          Effect.succeed({
            links: [
              { url: plainUrl, label: "Plain · no_new_privs" },
              { url: slackUrl, label: "Slack · Triton latency" },
              { url: "https://evil.example.com/hallucinated", label: "Hallucinated" },
            ],
          }),
      });

      return Effect.gen(function* () {
        const service = yield* ThreadHotLinks.ThreadHotLinksService;
        const threads = yield* ThreadManagement.ThreadManagementService;
        const mainId = yield* createThread("thread:main");
        const emptyId = yield* createThread("thread:no-links");

        yield* recordRun({
          threadId: emptyId,
          runId: RunId.make("run:empty:1"),
          ordinal: 1,
          user: "Why is TypeScript failing here?",
          assistant: `Check ${assistantOnlyUrl}`,
        });
        const emptyResult = yield* service.getThreadHotLinks({ threadId: emptyId });
        assert.deepStrictEqual(emptyResult.links, []);
        assert.strictEqual(harness.generateThreadHotLinks.mock.calls.length, 0);

        yield* recordRun({
          threadId: mainId,
          runId: RunId.make("run:main:1"),
          ordinal: 1,
          user: `investigate (${plainUrl}).\n${quotedAssistantCitation}`,
          assistant: `Assistant reply citing ${assistantOnlyUrl} and http://localhost:3000`,
        });

        const first = yield* service.getThreadHotLinks({ threadId: mainId });
        assert.deepStrictEqual(first.links, [
          { url: plainUrl, label: "Plain · no_new_privs", kind: "plain" },
          { url: slackUrl, label: "Slack · Triton latency", kind: "slack" },
        ]);
        assert.strictEqual(harness.generateThreadHotLinks.mock.calls.length, 1);
        const callInput = harness.generateThreadHotLinks.mock.calls[0]![0];
        assert.deepStrictEqual(callInput.candidateUrls, [plainUrl, slackUrl]);
        assert.isFalse(callInput.userMessages.includes(assistantOnlyUrl));

        // Second read hits SQLite fingerprint cache with zero extra LLM calls.
        const second = yield* service.getThreadHotLinks({ threadId: mainId });
        assert.deepStrictEqual(second.links, first.links);
        assert.strictEqual(harness.generateThreadHotLinks.mock.calls.length, 1);

        // Explicit refresh bypasses cache.
        yield* service.getThreadHotLinks({ threadId: mainId, refresh: true });
        assert.strictEqual(harness.generateThreadHotLinks.mock.calls.length, 2);

        // A fork inherits user-authored links from its parent through the forked run.
        const forkId = ThreadId.make("thread:fork");
        yield* threads.dispatch({
          type: "thread.fork",
          commandId: CommandId.make("fork:main"),
          sourceThreadId: mainId,
          targetThreadId: forkId,
          sourcePoint: { type: "run", runId: RunId.make("run:main:1") },
          title: "Forked investigation",
          createdBy: "user",
          creationSource: "web",
        });
        const forkLinks = yield* service.getThreadHotLinks({ threadId: forkId });
        assert.deepStrictEqual(forkLinks.links, first.links);
      }).pipe(Effect.provide(harness.layer));
    },
  );
});
