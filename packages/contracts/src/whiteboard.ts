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

export const WhiteboardScene = Schema.Struct({
  threadId: ThreadId,
  revision: NonNegativeInt,
  elements: Schema.Array(WhiteboardElement),
  files: WhiteboardFiles,
});
export type WhiteboardScene = typeof WhiteboardScene.Type;

export const WhiteboardThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type WhiteboardThreadInput = typeof WhiteboardThreadInput.Type;

export const WhiteboardSaveInput = Schema.Struct({
  threadId: ThreadId,
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
  threadId: ThreadId,
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

/** One per board change, across every thread, so a client can open the tab when an agent draws. */
export const WhiteboardActivityEvent = Schema.Struct({
  threadId: ThreadId,
  revision: NonNegativeInt,
  editor: WhiteboardEditor,
});
export type WhiteboardActivityEvent = typeof WhiteboardActivityEvent.Type;

export class WhiteboardError extends Schema.TaggedError<WhiteboardError>()("WhiteboardError", {
  threadId: ThreadId,
  operation: Schema.Literals(["load", "save"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `Could not ${this.operation} the whiteboard for thread ${this.threadId}.`;
  }
}
