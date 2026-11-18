import type {
  EnvironmentId,
  ThreadId,
  Whiteboard,
  WhiteboardDirectory,
  WhiteboardId,
} from "@t3tools/contracts";

export const boardKey = (environmentId: EnvironmentId, boardId: WhiteboardId) =>
  `${environmentId}:${boardId}`;

/** The board a thread's Whiteboard tab shows, or `null` until the thread opens or starts one. */
export function boardShownIn(
  directory: WhiteboardDirectory,
  threadId: ThreadId,
): Whiteboard | null {
  const boardId = directory.selected[threadId];
  return directory.boards.find((board) => board.boardId === boardId) ?? null;
}

export const boardsByName = (directory: WhiteboardDirectory): ReadonlyArray<Whiteboard> =>
  directory.boards.toSorted((left, right) => left.name.localeCompare(right.name));
