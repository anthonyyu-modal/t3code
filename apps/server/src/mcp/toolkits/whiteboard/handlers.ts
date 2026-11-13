import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as Whiteboards from "../../../whiteboard/Whiteboards.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { WhiteboardDataToolkit, WhiteboardViewToolkit, type WhiteboardToolkit } from "./tools.ts";

const toFailure = (error: { readonly _tag: string; readonly message: string }) =>
  new OrchestratorMcpFailure({
    code: error._tag === "WhiteboardError" ? "orchestration_error" : "invalid_request",
    message: error.message,
  });

const callerBoard = Effect.fn("WhiteboardToolkit.callerBoard")(function* (operation: string) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, operation);
  return { threadId: thread.threadId, whiteboards: yield* Whiteboards.Whiteboards };
});

const handlers = {
  whiteboard_read: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { threadId, whiteboards } = yield* callerBoard("whiteboard_read");
      return yield* whiteboards.read(threadId, input.board).pipe(Effect.mapError(toFailure));
    }),
  ),
  whiteboard_edit: McpToolAccess.actsAsCaller(({ board, newBoard, ...edit }) =>
    Effect.gen(function* () {
      const { threadId, whiteboards } = yield* callerBoard("whiteboard_edit");
      const result = yield* whiteboards
        .edit(threadId, { board, newBoard }, edit)
        .pipe(Effect.mapError(toFailure));
      return {
        ...result,
        message:
          result.layoutWarnings.length > 0
            ? "The user can see this on the whiteboard now. Fix layoutWarnings with one more whiteboard_edit that moves or resizes those elements, then say what you drew in a sentence."
            : "The user can see this on the whiteboard now. Say what you drew in a sentence; do not describe the board element by element.",
      };
    }),
  ),
  whiteboard_view: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { threadId, whiteboards } = yield* callerBoard("whiteboard_view");
      const { board, revision, ...screenshot } = yield* whiteboards
        .picture(threadId, input.board)
        .pipe(Effect.mapError(toFailure));
      return { board, revision, screenshot };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof WhiteboardToolkit.tools>;

export const layerData = McpToolAccess.toLayer(WhiteboardDataToolkit, {
  whiteboard_read: handlers.whiteboard_read,
  whiteboard_edit: handlers.whiteboard_edit,
});

export const layerView = McpToolAccess.toLayer(WhiteboardViewToolkit, {
  whiteboard_view: handlers.whiteboard_view,
});
