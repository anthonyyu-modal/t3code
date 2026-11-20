import * as Schema from "effect/Schema";

import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DiagramEngine = Schema.Literals(["drawio", "drawnix"]);
export type DiagramEngine = typeof DiagramEngine.Type;

export const DIAGRAM_NAME_MAX_LENGTH = 60;
const DIAGRAM_MAX_CONTENT_LENGTH = 16 * 1024 * 1024;

/** Names a diagram file in the server's engine folder, so it has to be safe as a file name. */
export const DiagramBoardId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]{1,64}$/));
export type DiagramBoardId = typeof DiagramBoardId.Type;

export const DiagramBoardName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(DIAGRAM_NAME_MAX_LENGTH),
);
export type DiagramBoardName = typeof DiagramBoardName.Type;

/** One shared diagram for a given engine. Every thread on the server can open it. */
export const DiagramBoard = Schema.Struct({
  boardId: DiagramBoardId,
  name: DiagramBoardName,
});
export type DiagramBoard = typeof DiagramBoard.Type;

/** Every diagram for an engine, plus which one each thread's tab currently shows. */
export const DiagramDirectory = Schema.Struct({
  engine: DiagramEngine,
  boards: Schema.Array(DiagramBoard),
  selected: Schema.Record(Schema.String, DiagramBoardId),
});
export type DiagramDirectory = typeof DiagramDirectory.Type;

export const DiagramDirectorySubscribeInput = Schema.Struct({
  engine: DiagramEngine,
});
export type DiagramDirectorySubscribeInput = typeof DiagramDirectorySubscribeInput.Type;

export const DiagramBoardInput = Schema.Struct({
  engine: DiagramEngine,
  boardId: DiagramBoardId,
});
export type DiagramBoardInput = typeof DiagramBoardInput.Type;

export const DiagramCreateInput = Schema.Struct({
  engine: DiagramEngine,
  /** Left out, the diagram is named after the thread in `threadId`. */
  name: Schema.optional(DiagramBoardName),
  /** Starts the new diagram as a copy of this one. */
  copyOf: Schema.optional(DiagramBoardId),
  /** Shows the new diagram in this thread's tab for this engine. */
  threadId: Schema.optional(ThreadId),
});
export type DiagramCreateInput = typeof DiagramCreateInput.Type;

export const DiagramRenameInput = Schema.Struct({
  engine: DiagramEngine,
  boardId: DiagramBoardId,
  name: DiagramBoardName,
});
export type DiagramRenameInput = typeof DiagramRenameInput.Type;

export const DiagramDeleteInput = Schema.Struct({
  engine: DiagramEngine,
  boardId: DiagramBoardId,
});
export type DiagramDeleteInput = typeof DiagramDeleteInput.Type;

export const DiagramSelectInput = Schema.Struct({
  engine: DiagramEngine,
  threadId: ThreadId,
  boardId: DiagramBoardId,
});
export type DiagramSelectInput = typeof DiagramSelectInput.Type;

export const DiagramDocument = Schema.Struct({
  engine: DiagramEngine,
  boardId: DiagramBoardId,
  revision: NonNegativeInt,
  content: Schema.String,
});
export type DiagramDocument = typeof DiagramDocument.Type;

export const DiagramSaveInput = Schema.Struct({
  engine: DiagramEngine,
  boardId: DiagramBoardId,
  /** Names the saving window so it can ignore echoes of its own save. */
  clientId: TrimmedNonEmptyString,
  content: Schema.String.check(Schema.isMaxLength(DIAGRAM_MAX_CONTENT_LENGTH)),
});
export type DiagramSaveInput = typeof DiagramSaveInput.Type;

export const DiagramSaveResult = Schema.Struct({
  revision: NonNegativeInt,
});
export type DiagramSaveResult = typeof DiagramSaveResult.Type;

export const DiagramDocumentEvent = Schema.Struct({
  revision: NonNegativeInt,
  content: Schema.String,
  clientId: Schema.NullOr(Schema.String),
});
export type DiagramDocumentEvent = typeof DiagramDocumentEvent.Type;

export class DiagramError extends Schema.TaggedError<DiagramError>()("DiagramError", {
  engine: DiagramEngine,
  board: Schema.String,
  operation: Schema.Literals(["load", "save"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `Could not ${this.operation} the ${this.engine} diagram ${this.board}.`;
  }
}

export class DiagramBoardRejected extends Schema.TaggedError<DiagramBoardRejected>()(
  "DiagramBoardRejected",
  {
    reason: Schema.Literals(["name-taken", "not-found"]),
    board: Schema.String,
  },
) {
  override get message() {
    return this.reason === "name-taken"
      ? `A diagram named "${this.board}" already exists.`
      : `There is no diagram "${this.board}".`;
  }
}
