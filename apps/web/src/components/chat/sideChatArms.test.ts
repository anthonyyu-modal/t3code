import type { OrchestrationV2ProviderCapabilities } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  armSideChat,
  disarmSideChat,
  providerSupportsSideChat,
  readSideChatArm,
  stripSideChatCommandPrefix,
} from "./sideChatArms";

function makeCapabilities(overrides?: {
  canForkThread?: boolean;
  nativeThreadIds?: "strong" | "weak" | "none";
  canConsumeHandoffSummaries?: boolean;
  acceptsSyntheticUserContext?: boolean;
  supportsFullThreadHandoff?: boolean;
}): OrchestrationV2ProviderCapabilities {
  return {
    sessions: {
      supportsMultipleProviderThreadsPerSession: false,
      supportsModelSwitchInSession: false,
      supportsProviderSwitchingViaHandoff: false,
      supportsRuntimeModeSwitchInSession: false,
      pendingRequestsSurviveRestart: false,
    },
    threads: {
      canCreateEmptyThread: false,
      canReadThreadSnapshot: false,
      canRollbackThread: false,
      canForkThread: overrides?.canForkThread ?? false,
      canForkFromTurn: false,
      canForkFromSubagentThread: false,
      exposesNativeThreadId: false,
    },
    turns: {
      exposesNativeTurnId: false,
      emitsTurnStarted: false,
      emitsTurnCompleted: false,
      supportsInterrupt: false,
      supportsActiveSteering: false,
      supportsSteeringByInterruptRestart: false,
      supportsQueuedMessages: false,
      terminalStatusQuality: "none",
    },
    streaming: {
      streamsAssistantText: false,
      streamsReasoning: false,
      streamsToolOutput: false,
      streamsPlanText: false,
      emitsMessageCompleted: false,
    },
    tools: {
      exposesToolItemIds: false,
      emitsToolStarted: false,
      emitsToolCompleted: false,
      emitsToolOutput: false,
      supportsMcpTools: false,
      supportsDynamicToolCallbacks: false,
    },
    approvals: {
      supportsCommandApproval: false,
      supportsFileReadApproval: false,
      supportsFileChangeApproval: false,
      supportsApplyPatchApproval: false,
      approvalsHaveNativeRequestIds: false,
      approvalCallbacksAreLiveOnly: false,
      approvalsCanOriginateFromSubagents: false,
    },
    planning: {
      emitsPlanUpdated: false,
      emitsTodoList: false,
      emitsProposedPlan: false,
      supportsStructuredQuestions: false,
      planDeltasHaveItemIds: false,
    },
    subagents: {
      supportsSubagents: false,
      exposesSubagentThreadIds: false,
      emitsSubagentLifecycle: false,
      canWaitForSubagents: false,
      canCloseSubagents: false,
      canForkSubagentThread: false,
    },
    context: {
      acceptsSystemContext: false,
      acceptsDeveloperContext: false,
      acceptsSyntheticUserContext: overrides?.acceptsSyntheticUserContext ?? false,
      canGenerateSummaries: false,
      canConsumeHandoffSummaries: overrides?.canConsumeHandoffSummaries ?? false,
      supportsDeltaHandoff: false,
      supportsFullThreadHandoff: overrides?.supportsFullThreadHandoff ?? false,
      maxRecommendedHandoffChars: null,
    },
    checkpointing: {
      appCanCheckpointFilesystem: false,
      supportsNestedCheckpointScopes: false,
      providerCanRollbackConversation: false,
      providerRollbackReturnsSnapshot: false,
      providerCanReadConversationSnapshot: false,
    },
    identity: {
      nativeThreadIds: overrides?.nativeThreadIds ?? "none",
      nativeTurnIds: "none",
      nativeItemIds: "none",
      nativeRequestIds: "none",
    },
    runtimePolicy: {
      enforcement: "client-boundary",
    },
  };
}

describe("sideChatArms", () => {
  const threadA = "env:thread-a";
  const threadB = "env:thread-b";

  afterEach(() => {
    disarmSideChat(threadA);
    disarmSideChat(threadB);
  });

  it("arms and disarms per thread without clearing a newer arm", () => {
    expect(readSideChatArm(threadA)).toBeUndefined();
    const first = armSideChat(threadA);
    expect(readSideChatArm(threadA)).toBe(first);
    expect(readSideChatArm(threadB)).toBeUndefined();

    const second = armSideChat(threadA);
    expect(second).not.toBe(first);

    disarmSideChat(threadA, first);
    expect(readSideChatArm(threadA)).toBe(second);

    disarmSideChat(threadA, second);
    expect(readSideChatArm(threadA)).toBeUndefined();
  });
});

describe("stripSideChatCommandPrefix", () => {
  it("strips leading /side or /btw prefixes and one separator", () => {
    const cases: ReadonlyArray<readonly [string, string | null]> = [
      ["/side why is this slow?", "why is this slow?"],
      ["/btw   check @src/a.ts", "check @src/a.ts"],
      ["/SIDE\n  indented", "  indented"],
      ["/btw\r\nhello", "hello"],
      ["  /side hello", "hello"],
      ["/side", ""],
      ["/btw ", ""],
      ["/sidex hello", null],
      ["hello /side", null],
    ];
    for (const [input, expected] of cases) {
      const match = stripSideChatCommandPrefix(input);
      expect(match ? input.slice(match.prefixLength) : null).toBe(expected);
    }
  });
});

describe("providerSupportsSideChat", () => {
  it("accepts missing evidence, native fork, or portable full-thread handoff", () => {
    expect(providerSupportsSideChat(undefined)).toBe(true);
    expect(
      providerSupportsSideChat(
        makeCapabilities({ canForkThread: true, nativeThreadIds: "strong" }),
      ),
    ).toBe(true);
    expect(
      providerSupportsSideChat(
        makeCapabilities({
          canConsumeHandoffSummaries: true,
          acceptsSyntheticUserContext: true,
          supportsFullThreadHandoff: true,
        }),
      ),
    ).toBe(true);
  });

  it("rejects providers that support neither native fork nor portable handoff", () => {
    expect(providerSupportsSideChat(makeCapabilities())).toBe(false);
    expect(
      providerSupportsSideChat(makeCapabilities({ canForkThread: true, nativeThreadIds: "weak" })),
    ).toBe(false);
    expect(
      providerSupportsSideChat(
        makeCapabilities({
          canConsumeHandoffSummaries: true,
          supportsFullThreadHandoff: true,
        }),
      ),
    ).toBe(false);
  });
});
