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

/** Names a shared board in the server's whiteboard folder, so it has to be safe as a file name. */
export const SharedWhiteboardId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]{1,64}$/));
export type SharedWhiteboardId = typeof SharedWhiteboardId.Type;

export const WHITEBOARD_NAME_MAX_LENGTH = 60;
/** What a thread's own board is called wherever boards are listed. No shared board may take it. */
export const THREAD_WHITEBOARD_NAME = "This thread";

export const WhiteboardName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(WHITEBOARD_NAME_MAX_LENGTH),
);
export type WhiteboardName = typeof WhiteboardName.Type;

/** One board: a thread's own, or one that every thread on the server can open. */
export const WhiteboardRef = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("thread"), threadId: ThreadId }),
  Schema.Struct({ kind: Schema.Literal("shared"), boardId: SharedWhiteboardId }),
]);
export type WhiteboardRef = typeof WhiteboardRef.Type;

export const SharedWhiteboard = Schema.Struct({
  boardId: SharedWhiteboardId,
  name: WhiteboardName,
});
export type SharedWhiteboard = typeof SharedWhiteboard.Type;

/** The server's shared boards, and which board each thread's Whiteboard tab shows. */
export const WhiteboardDirectory = Schema.Struct({
  boards: Schema.Array(SharedWhiteboard),
  /** Threads showing a shared board, by thread id. Every other thread shows its own board. */
  selected: Schema.Record(Schema.String, SharedWhiteboardId),
});
export type WhiteboardDirectory = typeof WhiteboardDirectory.Type;

export const WhiteboardDirectorySubscribeInput = Schema.Struct({});
export type WhiteboardDirectorySubscribeInput = typeof WhiteboardDirectorySubscribeInput.Type;

export const WhiteboardCreateInput = Schema.Struct({
  name: WhiteboardName,
  /** Starts the new board as a copy of this one. */
  copyOf: Schema.optional(WhiteboardRef),
  /** Shows the new board in this thread's Whiteboard tab. */
  threadId: Schema.optional(ThreadId),
});
export type WhiteboardCreateInput = typeof WhiteboardCreateInput.Type;

export const WhiteboardRenameInput = Schema.Struct({
  boardId: SharedWhiteboardId,
  name: WhiteboardName,
});
export type WhiteboardRenameInput = typeof WhiteboardRenameInput.Type;

export const WhiteboardDeleteInput = Schema.Struct({
  boardId: SharedWhiteboardId,
});
export type WhiteboardDeleteInput = typeof WhiteboardDeleteInput.Type;

export const WhiteboardSelectInput = Schema.Struct({
  threadId: ThreadId,
  /** The shared board the thread's Whiteboard tab should show, or `null` for the thread's own. */
  boardId: Schema.NullOr(SharedWhiteboardId),
});
export type WhiteboardSelectInput = typeof WhiteboardSelectInput.Type;

export const WhiteboardScene = Schema.Struct({
  board: WhiteboardRef,
  revision: NonNegativeInt,
  elements: Schema.Array(WhiteboardElement),
  files: WhiteboardFiles,
});
export type WhiteboardScene = typeof WhiteboardScene.Type;

export const WhiteboardBoardInput = Schema.Struct({
  board: WhiteboardRef,
});
export type WhiteboardBoardInput = typeof WhiteboardBoardInput.Type;

export const WhiteboardSaveInput = Schema.Struct({
  board: WhiteboardRef,
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
  /** The board's file name, which says whose board it is without the caller decoding a ref. */
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
      : `There is no shared board "${this.board}".`;
  }
}
