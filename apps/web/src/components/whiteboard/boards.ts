import {
  THREAD_WHITEBOARD_NAME,
  type EnvironmentId,
  type ThreadId,
  type WhiteboardDirectory,
  type WhiteboardRef,
} from "@t3tools/contracts";

export const boardKey = (environmentId: EnvironmentId, board: WhiteboardRef) =>
  `${environmentId}:${board.kind}:${board.kind === "thread" ? board.threadId : board.boardId}`;

/** The board a thread's Whiteboard tab shows: the shared one it chose, or else its own. */
export function boardShownIn(directory: WhiteboardDirectory, threadId: ThreadId): WhiteboardRef {
  const boardId = directory.selected[threadId];
  return boardId !== undefined && directory.boards.some((board) => board.boardId === boardId)
    ? { kind: "shared", boardId }
    : { kind: "thread", threadId };
}

export function boardName(directory: WhiteboardDirectory, board: WhiteboardRef): string {
  if (board.kind === "thread") return THREAD_WHITEBOARD_NAME;
  return directory.boards.find((shared) => shared.boardId === board.boardId)?.name ?? "Board";
}
