import * as Schema from "effect/Schema";

import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const WHITEBOARD_MAX_ELEMENTS = 5_000;
export const WHITEBOARD_MAX_FILE_DATA_URL_LENGTH = 4 * 1024 * 1024;
const WHITEBOARD_MAX_SNAPSHOT_BASE64_LENGTH = 8 * 1024 * 1024;

/** An Excalidraw element. The server reads identity, version and a few display fields, and stores the rest untouched. */
export const WhiteboardElement = Schema.Record(Schema.String, Schema.Unknown);
export type WhiteboardElement = typeof WhiteboardElement.Type;

/** An image pasted onto the board, keyed by Excalidraw's file id. */
export const WhiteboardFile = Schema.Struct({
  mimeType: Schema.String,
  dataURL: Schema.String.check(Schema.isMaxLength(WHITEBOARD_MAX_FILE_DATA_URL_LENGTH)),
  created: Schema.optional(Schema.Number),
});
export type WhiteboardFile = typeof WhiteboardFile.Type;

export const WhiteboardFiles = Schema.Record(Schema.String, WhiteboardFile);
export type WhiteboardFiles = typeof WhiteboardFiles.Type;

export const WhiteboardEditor = Schema.Literals(["user", "agent"]);
export type WhiteboardEditor = typeof WhiteboardEditor.Type;

/** Names a board's file in the server's whiteboard folder, so it has to be safe as a file name. */
export const WhiteboardId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]{1,64}$/));
export type WhiteboardId = typeof WhiteboardId.Type;

export const WHITEBOARD_NAME_MAX_LENGTH = 60;

export const WhiteboardName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(WHITEBOARD_NAME_MAX_LENGTH),
);
export type WhiteboardName = typeof WhiteboardName.Type;

/** A board. Every thread on the server can open it. */
export const WhiteboardEngine = Schema.Literals(["excalidraw", "tldraw"]);
export type WhiteboardEngine = typeof WhiteboardEngine.Type;

/** A board. Every thread on the server can open it. Boards made before engines were named are Excalidraw. */
export const Whiteboard = Schema.Struct({
  boardId: WhiteboardId,
  name: WhiteboardName,
  engine: Schema.optional(WhiteboardEngine),
});
export type Whiteboard = typeof Whiteboard.Type;

export const whiteboardEngine = (board: Pick<Whiteboard, "engine">): WhiteboardEngine =>
  board.engine ?? "excalidraw";

/** The server's boards, and which one each thread's Whiteboard tab shows. */
export const WhiteboardDirectory = Schema.Struct({
  boards: Schema.Array(Whiteboard),
  /** By thread id. A thread that is not here has yet to open or start a board. */
  selected: Schema.Record(Schema.String, WhiteboardId),
});
export type WhiteboardDirectory = typeof WhiteboardDirectory.Type;

export const WhiteboardDirectorySubscribeInput = Schema.Struct({});
export type WhiteboardDirectorySubscribeInput = typeof WhiteboardDirectorySubscribeInput.Type;

export const WhiteboardCreateInput = Schema.Struct({
  /** Left out, the board is named after the thread in `threadId`. */
  name: Schema.optional(WhiteboardName),
  /** New boards use tldraw unless an Excalidraw board is explicitly requested or copied. */
  engine: Schema.optional(WhiteboardEngine),
  /** Starts the new board as a copy of this one. */
  copyOf: Schema.optional(WhiteboardId),
  /** Shows the new board in this thread's Whiteboard tab. */
  threadId: Schema.optional(ThreadId),
});
export type WhiteboardCreateInput = typeof WhiteboardCreateInput.Type;

export const WhiteboardRenameInput = Schema.Struct({
  boardId: WhiteboardId,
  name: WhiteboardName,
});
export type WhiteboardRenameInput = typeof WhiteboardRenameInput.Type;

export const WhiteboardDeleteInput = Schema.Struct({
  boardId: WhiteboardId,
});
export type WhiteboardDeleteInput = typeof WhiteboardDeleteInput.Type;

/** Shows a board in a thread's Whiteboard tab. */
export const WhiteboardSelectInput = Schema.Struct({
  threadId: ThreadId,
  boardId: WhiteboardId,
});
export type WhiteboardSelectInput = typeof WhiteboardSelectInput.Type;

export const WhiteboardScene = Schema.Struct({
  boardId: WhiteboardId,
  engine: WhiteboardEngine,
  revision: NonNegativeInt,
  elements: Schema.Array(WhiteboardElement),
  files: WhiteboardFiles,
});
export type WhiteboardScene = typeof WhiteboardScene.Type;

export const WhiteboardBoardInput = Schema.Struct({
  boardId: WhiteboardId,
});
export type WhiteboardBoardInput = typeof WhiteboardBoardInput.Type;

export const WhiteboardSaveInput = Schema.Struct({
  boardId: WhiteboardId,
  /** Names the saving window, so that window can ignore the echo of its own save. */
  clientId: TrimmedNonEmptyString,
  /** The elements this window changed since its last save, deleted ones included. */
  elements: Schema.Array(WhiteboardElement).check(Schema.isMaxLength(WHITEBOARD_MAX_ELEMENTS)),
  /** Only files the server has not been sent yet. */
  files: Schema.optional(WhiteboardFiles),
});
export type WhiteboardSaveInput = typeof WhiteboardSaveInput.Type;

export const WhiteboardSaveResult = Schema.Struct({
  revision: NonNegativeInt,
});
export type WhiteboardSaveResult = typeof WhiteboardSaveResult.Type;

export const WhiteboardSceneEvent = Schema.Struct({
  type: Schema.Literal("scene"),
  revision: NonNegativeInt,
  elements: Schema.Array(WhiteboardElement),
  /** File contents travel through `whiteboard.get`, so an edit never resends images. */
  fileIds: Schema.Array(Schema.String),
  editor: Schema.NullOr(WhiteboardEditor),
  clientId: Schema.NullOr(Schema.String),
});
export type WhiteboardSceneEvent = typeof WhiteboardSceneEvent.Type;

/** Asks an open window to draw the board as a picture for the agent. */
export const WhiteboardSnapshotRequestEvent = Schema.Struct({
  type: Schema.Literal("snapshot-request"),
  requestId: TrimmedNonEmptyString,
});
export type WhiteboardSnapshotRequestEvent = typeof WhiteboardSnapshotRequestEvent.Type;

export const WhiteboardStreamEvent = Schema.Union([
  WhiteboardSceneEvent,
  WhiteboardSnapshotRequestEvent,
]);
export type WhiteboardStreamEvent = typeof WhiteboardStreamEvent.Type;

export const WhiteboardSnapshotInput = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  mimeType: Schema.Literal("image/png"),
  data: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(WHITEBOARD_MAX_SNAPSHOT_BASE64_LENGTH),
  ),
  width: NonNegativeInt,
  height: NonNegativeInt,
});
export type WhiteboardSnapshotInput = typeof WhiteboardSnapshotInput.Type;

export const WhiteboardActivitySubscribeInput = Schema.Struct({});
export type WhiteboardActivitySubscribeInput = typeof WhiteboardActivitySubscribeInput.Type;

/** One each time an agent draws, so a client can open that agent's thread's Whiteboard tab. */
export const WhiteboardActivityEvent = Schema.Struct({
  threadId: ThreadId,
  revision: NonNegativeInt,
  editor: WhiteboardEditor,
});
export type WhiteboardActivityEvent = typeof WhiteboardActivityEvent.Type;

export class WhiteboardError extends Schema.TaggedError<WhiteboardError>()("WhiteboardError", {
  /** The file that could not be read or written. */
  board: Schema.String,
  operation: Schema.Literals(["load", "save"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `Could not ${this.operation} the whiteboard ${this.board}.`;
  }
}

export class WhiteboardBoardRejected extends Schema.TaggedError<WhiteboardBoardRejected>()(
  "WhiteboardBoardRejected",
  {
    reason: Schema.Literals(["name-taken", "not-found"]),
    /** The name asked for, or the id when the caller named the board by id. */
    board: Schema.String,
  },
) {
  override get message() {
    return this.reason === "name-taken"
      ? `A board named "${this.board}" already exists.`
      : `There is no board "${this.board}".`;
  }
}
