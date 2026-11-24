import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  OrchestratorMcpCreateThreadsInput,
  OrchestratorMcpDelegateTaskInput,
  OrchestratorMcpDelegateTaskResult,
  OrchestratorMcpThreadWaitResult,
} from "./orchestratorMcp.ts";

const decodeCreateThreadsInput = Schema.decodeUnknownSync(OrchestratorMcpCreateThreadsInput);
const decodeDelegateTaskInput = Schema.decodeUnknownSync(OrchestratorMcpDelegateTaskInput);
const decodeDelegateTaskResult = Schema.decodeUnknownSync(OrchestratorMcpDelegateTaskResult);
const decodeThreadWaitResult = Schema.decodeUnknownSync(OrchestratorMcpThreadWaitResult);

describe("orchestrator MCP contracts", () => {
  it("decodes cross-provider delegated task requests and durable results", () => {
    const request = decodeDelegateTaskInput({
      task: "Inspect the workspace and report the result.",
      target: {
        providerInstanceId: "claudeAgent",
        model: "claude-sonnet-4-6",
      },
      mode: "wait",
      timeoutMs: 5_000,
      clientRequestId: "delegate-1",
      runtimeMode: "inherit",
      interactionMode: "inherit",
    });
    const result = decodeDelegateTaskResult({
      taskId: "node-task-1",
      childThreadId: "thread-child-1",
      childRunId: "run-child-1",
      childNodeId: "node-task-1",
      status: "completed",
      workState: "result_available",
      hasPendingChildRuns: false,
      providerInstanceId: "claudeAgent",
      model: "claude-sonnet-4-6",
      summary: "Workspace inspected.",
      resultContextTransferId: "context-transfer-result-1",
      latestTerminalRunId: "run-child-1",
      latestTerminalStatus: "completed",
      latestTerminalSummary: "Workspace inspected.",
      latestTerminalResultContextTransferId: "context-transfer-result-1",
      hasPendingQuestion: false,
      pendingApproval: null,
      waitTimedOut: false,
    });

    expect(request.target?.providerInstanceId).toBe("claudeAgent");
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("Workspace inspected.");
    expect(result.pendingApproval).toBeNull();
    const pendingApproval = {
      requestId: "request-approval-1",
      kind: "command",
      runId: "run-child-1",
    };
    expect(
      decodeDelegateTaskResult({
        ...result,
        pendingApproval: { ...pendingApproval, input: { command: "private command" } },
      }).pendingApproval,
    ).toEqual(pendingApproval);
    expect(() =>
      decodeDelegateTaskResult({
        ...result,
        pendingApproval: { ...pendingApproval, kind: "user_input" },
      }),
    ).toThrow();
  });

  it("decodes a running-task next written by another version", () => {
    const next = "Completion wakes this thread, so end your turn. Do not wait on it or poll it.";
    expect(
      decodeThreadWaitResult({
        threadId: "thread-child-1",
        runId: "run-child-1",
        status: "running",
        timedOut: true,
        next,
      }).next,
    ).toBe(next);
  });

  it("decodes JSON-string target.options and create_threads target for Cursor CallDynamicTool", () => {
    const fromRecord = decodeDelegateTaskInput({
      task: "Run with xhigh effort.",
      target: {
        providerInstanceId: "codex",
        model: "gpt-6.2-astra",
        options: '{"reasoningEffort":"xhigh","fastMode":true}',
      },
    });
    expect(fromRecord.target?.options).toEqual([
      { id: "reasoningEffort", value: "xhigh" },
      { id: "fastMode", value: true },
    ]);

    const fromArray = decodeDelegateTaskInput({
      task: "Run with array options.",
      target: {
        providerInstanceId: "cursor",
        model: "gemini-4-carbon",
        options: '[{"id":"reasoning_effort","value":"high"}]',
      },
    });
    expect(fromArray.target?.options).toEqual([{ id: "reasoning_effort", value: "high" }]);

    const cleared = decodeDelegateTaskInput({
      task: "Clear options.",
      target: { providerInstanceId: "codex", options: "{}" },
    });
    expect(cleared.target?.options).toEqual([]);

    expect(() =>
      decodeDelegateTaskInput({
        task: "Invalid JSON options.",
        target: { providerInstanceId: "codex", options: "[true]" },
      }),
    ).toThrow();
    expect(() =>
      decodeDelegateTaskInput({
        task: "Malformed JSON options.",
        target: { providerInstanceId: "codex", options: "not-json" },
      }),
    ).toThrow();

    const created = decodeCreateThreadsInput({
      threads: [
        {
          title: "Astra",
          prompt: "Investigate.",
          target:
            '{"providerInstanceId":"codex","model":"gpt-6.2-astra","options":{"reasoningEffort":"xhigh"}}',
        },
      ],
    });
    expect(created.threads[0]?.target).toEqual({
      providerInstanceId: "codex",
      model: "gpt-6.2-astra",
      options: [{ id: "reasoningEffort", value: "xhigh" }],
    });
  });
});
