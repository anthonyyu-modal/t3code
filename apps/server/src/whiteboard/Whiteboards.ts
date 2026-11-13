import {
  NonNegativeInt,
  SharedWhiteboard,
  SharedWhiteboardId,
  THREAD_WHITEBOARD_NAME,
  WhiteboardBoardRejected,
  WhiteboardElement,
  WhiteboardError,
  WhiteboardFiles,
  type ThreadId,
  type WhiteboardActivityEvent,
  type WhiteboardCreateInput,
  type WhiteboardDeleteInput,
  type WhiteboardDirectory,
  type WhiteboardEditor,
  type WhiteboardRef,
  type WhiteboardRenameInput,
  type WhiteboardSaveInput,
  type WhiteboardSaveResult,
  type WhiteboardScene,
  type WhiteboardSceneEvent,
  type WhiteboardSelectInput,
  type WhiteboardSnapshotInput,
  type WhiteboardStreamEvent,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import {
  applyWhiteboardEdit,
  describeWhiteboard,
  mergeWhiteboardElements,
  whiteboardChangeNote,
  whiteboardChangesSince,
  whiteboardLayoutWarnings,
  whiteboardSeenVersions,
  whiteboardSwitchNote,
  type WhiteboardChanges,
  type WhiteboardEdit,
  type WhiteboardElementView,
} from "./whiteboardScene.ts";

const SNAPSHOT_TIMEOUT = "10 seconds";

const SeenVersions = Schema.Record(Schema.String, Schema.Number);

const StoredBoard = Schema.Struct({
  revision: NonNegativeInt,
  elements: Schema.Array(WhiteboardElement),
  files: WhiteboardFiles,
  /** A thread's own board: the element versions its agent last saw. Whatever differs changed since. */
  agentSeen: Schema.NullOr(SeenVersions),
  /** A shared board: the same, for each thread whose agent has looked at it. */
  seenBy: Schema.optional(Schema.Record(Schema.String, SeenVersions)),
});
type StoredBoard = typeof StoredBoard.Type;

const StoredBoardJson = Schema.fromJsonString(StoredBoard);
const decodeStoredBoard = Schema.decodeUnknownEffect(StoredBoardJson);
const encodeStoredBoard = Schema.encodeSync(StoredBoardJson);

const EMPTY_BOARD: StoredBoard = { revision: 0, elements: [], files: {}, agentSeen: null };

const StoredIndex = Schema.Struct({
  boards: Schema.Array(SharedWhiteboard),
  /** Threads whose Whiteboard tab shows a shared board, by thread id. */
  selected: Schema.Record(Schema.String, SharedWhiteboardId),
  /** Threads whose tab changed board without their agent having been told. */
  unannounced: Schema.Array(Schema.String),
});
type StoredIndex = typeof StoredIndex.Type;

const StoredIndexJson = Schema.fromJsonString(StoredIndex);
const decodeStoredIndex = Schema.decodeUnknownEffect(StoredIndexJson);
const encodeStoredIndex = Schema.encodeSync(StoredIndexJson);

const EMPTY_INDEX: StoredIndex = { boards: [], selected: {}, unannounced: [] };
const INDEX_FILE = "shared/index.json";

/** Thread ids are opaque strings; keep them from naming a path outside the folder. */
const fileOf = (board: WhiteboardRef) =>
  board.kind === "thread"
    ? `${board.threadId.replace(/[^\w.-]/g, "_")}.json`
    : `shared/${board.boardId}.json`;

const sameName = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export class WhiteboardEditRejected extends Schema.TaggedError<WhiteboardEditRejected>()(
  "WhiteboardEditRejected",
  { problems: Schema.Array(Schema.String) },
) {
  override get message() {
    return `Nothing was changed. ${this.problems.join(" ")}`;
  }
}

export class WhiteboardPictureUnavailable extends Schema.TaggedError<WhiteboardPictureUnavailable>()(
  "WhiteboardPictureUnavailable",
  { reason: Schema.Literals(["empty", "not-open", "timed-out"]) },
) {
  override get message() {
    switch (this.reason) {
      case "empty":
        return "The whiteboard is empty, so there is nothing to picture.";
      case "not-open":
        return "No window has this board open in a Whiteboard tab, and only an open tab can draw the picture. Use whiteboard_read for the board's contents as data.";
      case "timed-out":
        return "The open Whiteboard tab did not return a picture in time. Use whiteboard_read for the board's contents as data.";
    }
  }
}

/** An agent named a board that does not exist. */
export class WhiteboardUnknownBoard extends Schema.TaggedError<WhiteboardUnknownBoard>()(
  "WhiteboardUnknownBoard",
  { board: Schema.String, boards: Schema.Array(Schema.String) },
) {
  override get message() {
    return `No board is named "${this.board}". Boards: ${this.boards.join(", ")}. To start a new shared board, pass newBoard to whiteboard_edit.`;
  }
}

export interface WhiteboardAgentView {
  /** The board that was read, by name. */
  readonly board: string;
  /** Every board the agent can name: the thread's own, then the shared ones. */
  readonly boards: ReadonlyArray<string>;
  readonly revision: number;
  readonly elements: ReadonlyArray<WhiteboardElementView>;
  /** What changed since this thread's agent last read or edited the board. */
  readonly changes: WhiteboardChanges | null;
}

/** Which board an agent means: the one its thread's Whiteboard tab shows, unless it names one. */
export interface WhiteboardAgentTarget {
  readonly board?: string | undefined;
  /** Starts a shared board with this name. */
  readonly newBoard?: string | undefined;
}

export interface WhiteboardPicture {
  readonly mimeType: "image/png";
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

interface BoardStorage {
  readonly read: (file: string) => Effect.Effect<string | null, PlatformError.PlatformError>;
  readonly write: (
    file: string,
    contents: string,
  ) => Effect.Effect<void, PlatformError.PlatformError>;
  readonly remove: (file: string) => Effect.Effect<void, PlatformError.PlatformError>;
}

type BoardFailure = WhiteboardError | WhiteboardBoardRejected;

export class Whiteboards extends Context.Service<
  Whiteboards,
  {
    readonly get: (board: WhiteboardRef) => Effect.Effect<WhiteboardScene, BoardFailure>;
    /** Merges a window's elements into the board. */
    readonly save: (
      input: WhiteboardSaveInput,
    ) => Effect.Effect<WhiteboardSaveResult, BoardFailure>;
    /** The current scene, then every later change and picture request for the board. */
    readonly stream: (board: WhiteboardRef) => Stream.Stream<WhiteboardStreamEvent, BoardFailure>;
    /** One event each time an agent draws. */
    readonly activity: Stream.Stream<WhiteboardActivityEvent>;
    readonly submitSnapshot: (input: WhiteboardSnapshotInput) => Effect.Effect<void>;
    /** The shared boards and each thread's choice of board, now and after every change. */
    readonly directory: Stream.Stream<WhiteboardDirectory, WhiteboardError>;
    readonly create: (
      input: WhiteboardCreateInput,
    ) => Effect.Effect<SharedWhiteboard, BoardFailure>;
    readonly rename: (input: WhiteboardRenameInput) => Effect.Effect<void, BoardFailure>;
    /** Deletes a shared board. Threads that showed it go back to their own. */
    readonly remove: (input: WhiteboardDeleteInput) => Effect.Effect<void, BoardFailure>;
    /** Sets which board a thread's Whiteboard tab shows. */
    readonly select: (input: WhiteboardSelectInput) => Effect.Effect<void, BoardFailure>;
    /** A board as an agent reads it. Counts as that thread's agent having seen it. */
    readonly read: (
      threadId: ThreadId,
      board?: string,
    ) => Effect.Effect<WhiteboardAgentView, WhiteboardError | WhiteboardUnknownBoard>;
    /** Draws on a board, and shows that board in the agent's thread's Whiteboard tab. */
    readonly edit: (
      threadId: ThreadId,
      target: WhiteboardAgentTarget,
      edit: WhiteboardEdit,
    ) => Effect.Effect<
      {
        readonly board: string;
        readonly revision: number;
        readonly addedIds: ReadonlyArray<string>;
        /** Overlaps and cramped labels among what the edit touched, which the agent cannot see. */
        readonly layoutWarnings: ReadonlyArray<string>;
      },
      WhiteboardError | WhiteboardBoardRejected | WhiteboardUnknownBoard | WhiteboardEditRejected
    >;
    /** Asks an open Whiteboard tab to draw the board, since only a browser can render it. */
    readonly picture: (
      threadId: ThreadId,
      board?: string,
    ) => Effect.Effect<
      WhiteboardPicture & { readonly board: string; readonly revision: number },
      WhiteboardError | WhiteboardUnknownBoard | WhiteboardPictureUnavailable
    >;
    /**
     * A note for a thread's agent on what happened to the board its Whiteboard tab shows since
     * the agent last saw it, given once.
     */
    readonly takeUserChangeNote: (
      threadId: ThreadId,
    ) => Effect.Effect<string | null, WhiteboardError>;
  }
>()("t3/whiteboard/Whiteboards") {}

const liveElementCount = (board: StoredBoard) =>
  board.elements.filter((element) => element.isDeleted !== true).length;

const makeWith = Effect.fn("Whiteboards.make")(function* (storage: BoardStorage) {
  const random = yield* SecureRandom.SecureRandom;
  const lock = yield* Semaphore.make(1);
  const events = yield* PubSub.unbounded<{
    readonly file: string;
    readonly event: WhiteboardStreamEvent;
  }>();
  const activity = yield* PubSub.unbounded<WhiteboardActivityEvent>();
  const directories = yield* PubSub.unbounded<WhiteboardDirectory>();
  const boards = new Map<string, StoredBoard>();
  const openTabs = new Map<string, number>();
  const pictureRequests = new Map<string, Deferred.Deferred<WhiteboardPicture>>();
  let index: StoredIndex | null = null;

  const failed = (file: string, operation: "load" | "save") => (cause: unknown) =>
    new WhiteboardError({ board: file, operation, cause });

  const loadIndex = Effect.fn("Whiteboards.loadIndex")(
    function* () {
      if (index !== null) return index;
      const raw = yield* storage.read(INDEX_FILE);
      index = raw === null ? EMPTY_INDEX : yield* decodeStoredIndex(raw);
      return index;
    },
    Effect.mapError(failed(INDEX_FILE, "load")),
  );

  const toDirectory = (current: StoredIndex): WhiteboardDirectory => ({
    boards: current.boards,
    selected: current.selected,
  });

  const storeIndex = Effect.fn("Whiteboards.storeIndex")(function* (next: StoredIndex) {
    yield* storage
      .write(INDEX_FILE, encodeStoredIndex(next))
      .pipe(Effect.mapError(failed(INDEX_FILE, "save")));
    index = next;
    yield* PubSub.publish(directories, toDirectory(next));
  });

  const load = Effect.fn("Whiteboards.load")(function* (board: WhiteboardRef) {
    const file = fileOf(board);
    const cached = boards.get(file);
    if (cached !== undefined) return cached;
    const loaded = yield* storage.read(file).pipe(
      Effect.flatMap((raw) =>
        raw === null ? Effect.succeed(EMPTY_BOARD) : decodeStoredBoard(raw),
      ),
      Effect.mapError(failed(file, "load")),
    );
    boards.set(file, loaded);
    return loaded;
  });

  const store = Effect.fn("Whiteboards.store")(function* (board: WhiteboardRef, next: StoredBoard) {
    const file = fileOf(board);
    yield* storage.write(file, encodeStoredBoard(next)).pipe(Effect.mapError(failed(file, "save")));
    boards.set(file, next);
  });

  /** Fails for a shared board that does not exist, so nothing reads or writes a stray file. */
  const existing = Effect.fn("Whiteboards.existing")(function* (board: WhiteboardRef) {
    if (board.kind === "thread") return board;
    const current = yield* loadIndex();
    if (current.boards.some((shared) => shared.boardId === board.boardId)) return board;
    return yield* new WhiteboardBoardRejected({ reason: "not-found", board: board.boardId });
  });

  const selectedBoard = (current: StoredIndex, threadId: ThreadId): WhiteboardRef => {
    const boardId = current.selected[threadId];
    return boardId !== undefined && current.boards.some((shared) => shared.boardId === boardId)
      ? { kind: "shared", boardId }
      : { kind: "thread", threadId };
  };

  const nameOf = (current: StoredIndex, board: WhiteboardRef) =>
    board.kind === "thread"
      ? THREAD_WHITEBOARD_NAME
      : (current.boards.find((shared) => shared.boardId === board.boardId)?.name ?? board.boardId);

  const namesOf = (current: StoredIndex) => [
    THREAD_WHITEBOARD_NAME,
    ...current.boards.map((shared) => shared.name),
  ];

  /** The board an agent means: its thread's tab's board, unless it names another. */
  const named = Effect.fn("Whiteboards.named")(function* (
    current: StoredIndex,
    threadId: ThreadId,
    name: string | undefined,
  ) {
    if (name === undefined) return selectedBoard(current, threadId);
    if (sameName(name, THREAD_WHITEBOARD_NAME)) return { kind: "thread", threadId } as const;
    const shared = current.boards.find((candidate) => sameName(candidate.name, name));
    if (shared !== undefined) return { kind: "shared", boardId: shared.boardId } as const;
    return yield* new WhiteboardUnknownBoard({ board: name, boards: namesOf(current) });
  });

  const freeName = Effect.fn("Whiteboards.freeName")(function* (
    current: StoredIndex,
    name: string,
    except?: SharedWhiteboardId,
  ) {
    const taken =
      sameName(name, THREAD_WHITEBOARD_NAME) ||
      current.boards.some((shared) => shared.boardId !== except && sameName(shared.name, name));
    if (taken) return yield* new WhiteboardBoardRejected({ reason: "name-taken", board: name });
  });

  // A thread's own board has one agent. A shared board keeps what each thread's agent saw.
  const seenBy = (stored: StoredBoard, board: WhiteboardRef, threadId: ThreadId) =>
    board.kind === "thread" ? stored.agentSeen : (stored.seenBy?.[threadId] ?? null);

  const withSeen = (
    stored: StoredBoard,
    board: WhiteboardRef,
    threadId: ThreadId,
    seen: Readonly<Record<string, number>>,
  ): StoredBoard =>
    board.kind === "thread"
      ? { ...stored, agentSeen: seen }
      : { ...stored, seenBy: { ...stored.seenBy, [threadId]: seen } };

  /** Points threads' tabs at boards, and remembers that their agents have yet to hear of it. */
  const withSelection = (
    current: StoredIndex,
    threadId: ThreadId,
    boardId: SharedWhiteboardId | null,
    told: boolean,
  ): StoredIndex => {
    const { [threadId]: _previous, ...others } = current.selected;
    const unannounced = current.unannounced.filter((id) => id !== threadId);
    return {
      ...current,
      selected: boardId === null ? others : { ...others, [threadId]: boardId },
      unannounced: told ? unannounced : [...unannounced, threadId],
    };
  };

  const sceneEvent = (
    board: StoredBoard,
    editor: WhiteboardEditor | null,
    clientId: string | null,
  ): WhiteboardSceneEvent => ({
    type: "scene",
    revision: board.revision,
    elements: board.elements,
    fileIds: Object.keys(board.files),
    editor,
    clientId,
  });

  const announce = (
    board: WhiteboardRef,
    stored: StoredBoard,
    editor: WhiteboardEditor,
    clientId: string | null,
  ) => PubSub.publish(events, { file: fileOf(board), event: sceneEvent(stored, editor, clientId) });

  const get: Whiteboards["Service"]["get"] = Effect.fn("Whiteboards.get")(function* (board) {
    const stored = yield* load(yield* existing(board));
    return { board, revision: stored.revision, elements: stored.elements, files: stored.files };
  });

  const save: Whiteboards["Service"]["save"] = Effect.fn("Whiteboards.save")(function* (input) {
    const board = yield* load(yield* existing(input.board));
    const merged = mergeWhiteboardElements(
      board.elements,
      input.elements,
      yield* Clock.currentTimeMillis,
    );
    const newFiles = Object.entries(input.files ?? {}).filter(([id]) => !(id in board.files));
    if (!merged.changed && newFiles.length === 0) return { revision: board.revision };
    const next: StoredBoard = {
      ...board,
      revision: board.revision + 1,
      elements: merged.elements,
      files: { ...board.files, ...Object.fromEntries(newFiles) },
    };
    yield* store(input.board, next);
    yield* announce(input.board, next, "user", input.clientId);
    return { revision: next.revision };
  }, lock.withPermits(1));

  // Subscribes before reading, so a change made during the read still arrives.
  const stream: Whiteboards["Service"]["stream"] = (board) =>
    Stream.callback<WhiteboardStreamEvent, BoardFailure>(
      (mailbox) =>
        Effect.gen(function* () {
          const file = fileOf(yield* existing(board));
          const subscription = yield* PubSub.subscribe(events);
          yield* Effect.acquireRelease(
            Effect.sync(() => openTabs.set(file, (openTabs.get(file) ?? 0) + 1)),
            () => Effect.sync(() => openTabs.set(file, (openTabs.get(file) ?? 1) - 1)),
          );
          Queue.offerUnsafe(mailbox, sceneEvent(yield* load(board), null, null));
          yield* Stream.fromSubscription(subscription).pipe(
            Stream.runForEach((change) =>
              Effect.sync(() => {
                if (change.file === file) Queue.offerUnsafe(mailbox, change.event);
              }),
            ),
            Effect.forkScoped,
          );
        }),
      { bufferSize: 64, strategy: "sliding" },
    );

  const directory: Whiteboards["Service"]["directory"] = Stream.callback<
    WhiteboardDirectory,
    WhiteboardError
  >(
    (mailbox) =>
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(directories);
        Queue.offerUnsafe(mailbox, toDirectory(yield* loadIndex()));
        yield* Stream.fromSubscription(subscription).pipe(
          Stream.runForEach((next) => Effect.sync(() => Queue.offerUnsafe(mailbox, next))),
          Effect.forkScoped,
        );
      }),
    { bufferSize: 16, strategy: "sliding" },
  );

  const submitSnapshot: Whiteboards["Service"]["submitSnapshot"] = Effect.fn(
    "Whiteboards.submitSnapshot",
  )(function* (input) {
    const request = pictureRequests.get(input.requestId);
    if (request === undefined) return;
    yield* Deferred.succeed(request, {
      mimeType: input.mimeType,
      data: input.data,
      width: input.width,
      height: input.height,
    });
  });

  const addBoard = Effect.fn("Whiteboards.addBoard")(function* (
    current: StoredIndex,
    name: string,
    contents: StoredBoard,
  ) {
    yield* freeName(current, name);
    const shared: SharedWhiteboard = { boardId: yield* random.uuidV4(), name };
    yield* store({ kind: "shared", boardId: shared.boardId }, contents);
    return { shared, index: { ...current, boards: [...current.boards, shared] } };
  });

  const create: Whiteboards["Service"]["create"] = Effect.fn("Whiteboards.create")(function* (
    input,
  ) {
    const current = yield* loadIndex();
    const source =
      input.copyOf === undefined ? EMPTY_BOARD : yield* load(yield* existing(input.copyOf));
    const elements = source.elements.filter((element) => element.isDeleted !== true);
    const added = yield* addBoard(current, input.name, {
      revision: elements.length === 0 ? 0 : 1,
      elements,
      files: source.files,
      agentSeen: null,
    });
    yield* storeIndex(
      input.threadId === undefined
        ? added.index
        : withSelection(added.index, input.threadId, added.shared.boardId, false),
    );
    return added.shared;
  }, lock.withPermits(1));

  const rename: Whiteboards["Service"]["rename"] = Effect.fn("Whiteboards.rename")(function* (
    input,
  ) {
    const current = yield* loadIndex();
    yield* existing({ kind: "shared", boardId: input.boardId });
    yield* freeName(current, input.name, input.boardId);
    yield* storeIndex({
      ...current,
      boards: current.boards.map((shared) =>
        shared.boardId === input.boardId ? { ...shared, name: input.name } : shared,
      ),
    });
  }, lock.withPermits(1));

  const remove: Whiteboards["Service"]["remove"] = Effect.fn("Whiteboards.remove")(function* (
    input,
  ) {
    const board = yield* existing({ kind: "shared", boardId: input.boardId });
    const current = yield* loadIndex();
    const showing = Object.keys(current.selected).filter(
      (threadId) => current.selected[threadId] === input.boardId,
    );
    // The index goes first: a board left on disk without an entry is only an unused file.
    yield* storeIndex({
      boards: current.boards.filter((shared) => shared.boardId !== input.boardId),
      selected: Object.fromEntries(
        Object.entries(current.selected).filter(([, boardId]) => boardId !== input.boardId),
      ),
      unannounced: [...new Set([...current.unannounced, ...showing])],
    });
    const file = fileOf(board);
    boards.delete(file);
    yield* storage.remove(file).pipe(Effect.mapError(failed(file, "save")));
  }, lock.withPermits(1));

  const select: Whiteboards["Service"]["select"] = Effect.fn("Whiteboards.select")(function* (
    input,
  ) {
    const current = yield* loadIndex();
    if (input.boardId !== null) yield* existing({ kind: "shared", boardId: input.boardId });
    const before = selectedBoard(current, input.threadId);
    const after: WhiteboardRef =
      input.boardId === null
        ? { kind: "thread", threadId: input.threadId }
        : { kind: "shared", boardId: input.boardId };
    if (fileOf(before) === fileOf(after)) return;
    yield* storeIndex(withSelection(current, input.threadId, input.boardId, false));
  }, lock.withPermits(1));

  /** The agent has now seen which board its thread's tab shows. */
  const told = Effect.fn("Whiteboards.told")(function* (threadId: ThreadId) {
    const current = yield* loadIndex();
    if (!current.unannounced.includes(threadId)) return;
    yield* storeIndex({
      ...current,
      unannounced: current.unannounced.filter((id) => id !== threadId),
    });
  });

  const read: Whiteboards["Service"]["read"] = Effect.fn("Whiteboards.read")(function* (
    threadId,
    name,
  ) {
    const current = yield* loadIndex();
    const board = yield* named(current, threadId, name);
    const stored = yield* load(board);
    const seen = seenBy(stored, board, threadId);
    // A board this agent never saw has nothing to compare against, unless it is the thread's own,
    // where everything on it is the user's.
    const changes =
      seen === null && (board.kind === "shared" || liveElementCount(stored) === 0)
        ? null
        : whiteboardChangesSince(seen, stored.elements);
    if (changes !== null || seen === null) {
      yield* store(
        board,
        withSeen(stored, board, threadId, whiteboardSeenVersions(stored.elements)),
      );
    }
    if (fileOf(board) === fileOf(selectedBoard(current, threadId))) yield* told(threadId);
    return {
      board: nameOf(current, board),
      boards: namesOf(current),
      revision: stored.revision,
      elements: describeWhiteboard(stored.elements),
      changes,
    };
  }, lock.withPermits(1));

  const edit: Whiteboards["Service"]["edit"] = Effect.fn("Whiteboards.edit")(function* (
    threadId,
    target,
    change,
  ) {
    const before = yield* loadIndex();
    const startsBoard = target.newBoard !== undefined;
    const existingBoard = startsBoard ? null : yield* named(before, threadId, target.board);
    const stored = existingBoard === null ? EMPTY_BOARD : yield* load(existingBoard);
    const outcome = applyWhiteboardEdit(stored.elements, change, {
      now: yield* Clock.currentTimeMillis,
      random: Math.random,
      makeId: () => SecureRandom.uuidV4Unsafe(),
    });
    if (!outcome.ok) return yield* new WhiteboardEditRejected({ problems: outcome.problems });
    // An invalid drawing must not leave an empty board behind, so the board starts only now.
    const added = startsBoard ? yield* addBoard(before, target.newBoard, EMPTY_BOARD) : null;
    const board: WhiteboardRef = existingBoard ?? {
      kind: "shared",
      boardId: added!.shared.boardId,
    };
    const current = added?.index ?? before;
    // Only what this edit touched counts as seen, so changes the agent has not seen still get reported.
    const versions = new Map(stored.elements.map((element) => [element.id, element.version]));
    const touched = outcome.elements.filter(
      (element) => versions.get(element.id) !== element.version,
    );
    const seen = { ...seenBy(stored, board, threadId) };
    for (const element of touched) {
      if (typeof element.id !== "string") continue;
      if (element.isDeleted === true) delete seen[element.id];
      else if (typeof element.version === "number") seen[element.id] = element.version;
    }
    const layoutWarnings = whiteboardLayoutWarnings(
      outcome.elements,
      new Set(touched.flatMap((element) => (typeof element.id === "string" ? [element.id] : []))),
    );
    const next: StoredBoard =
      touched.length === 0
        ? stored
        : withSeen(
            { ...stored, revision: stored.revision + 1, elements: outcome.elements },
            board,
            threadId,
            seen,
          );
    if (next !== stored) yield* store(board, next);
    // The user has to see what was drawn, so the thread's tab follows the agent to this board.
    const shown = withSelection(
      current,
      threadId,
      board.kind === "shared" ? board.boardId : null,
      true,
    );
    const moved = fileOf(selectedBoard(current, threadId)) !== fileOf(board);
    if (added !== null || moved || current.unannounced.includes(threadId)) {
      yield* storeIndex(shown);
    }
    if (next !== stored) {
      yield* announce(board, next, "agent", null);
      yield* PubSub.publish(activity, {
        threadId,
        revision: next.revision,
        editor: "agent" as const,
      });
    }
    return {
      board: nameOf(shown, board),
      revision: next.revision,
      addedIds: outcome.addedIds,
      layoutWarnings,
    };
  }, lock.withPermits(1));

  const picture: Whiteboards["Service"]["picture"] = Effect.fn("Whiteboards.picture")(
    function* (threadId, name) {
      const current = yield* loadIndex();
      const board = yield* named(current, threadId, name);
      const file = fileOf(board);
      const stored = yield* load(board);
      if (liveElementCount(stored) === 0) {
        return yield* new WhiteboardPictureUnavailable({ reason: "empty" });
      }
      if ((openTabs.get(file) ?? 0) === 0) {
        return yield* new WhiteboardPictureUnavailable({ reason: "not-open" });
      }
      const requestId = yield* random.uuidV4();
      const request = yield* Deferred.make<WhiteboardPicture>();
      pictureRequests.set(requestId, request);
      yield* PubSub.publish(events, { file, event: { type: "snapshot-request", requestId } });
      const drawn = yield* Deferred.await(request).pipe(
        Effect.timeoutOption(SNAPSHOT_TIMEOUT),
        Effect.ensuring(Effect.sync(() => pictureRequests.delete(requestId))),
      );
      if (Option.isNone(drawn)) {
        return yield* new WhiteboardPictureUnavailable({ reason: "timed-out" });
      }
      return { ...drawn.value, board: nameOf(current, board), revision: stored.revision };
    },
  );

  const takeUserChangeNote: Whiteboards["Service"]["takeUserChangeNote"] = Effect.fn(
    "Whiteboards.takeUserChangeNote",
  )(function* (threadId) {
    const current = yield* loadIndex();
    const board = selectedBoard(current, threadId);
    const stored = yield* load(board);
    const sharedName = board.kind === "shared" ? nameOf(current, board) : null;
    const seeAll = () =>
      store(board, withSeen(stored, board, threadId, whiteboardSeenVersions(stored.elements)));
    if (current.unannounced.includes(threadId)) {
      yield* seeAll();
      yield* told(threadId);
      return whiteboardSwitchNote(sharedName, stored.revision, liveElementCount(stored));
    }
    const changes = whiteboardChangesSince(seenBy(stored, board, threadId), stored.elements);
    if (changes === null) return null;
    yield* seeAll();
    return whiteboardChangeNote(changes, stored.revision, sharedName);
  }, lock.withPermits(1));

  return Whiteboards.of({
    get,
    save,
    stream,
    activity: Stream.fromPubSub(activity),
    submitSnapshot,
    directory,
    create,
    rename,
    remove,
    select,
    read,
    edit,
    picture,
    takeUserChangeNote,
  });
});

// One JSON file per board under T3 home, not a SQLite table: this fork rebases onto upstream,
// and a fork-owned migration id would collide with the next one upstream adds. A thread's own
// board is named after the thread; shared boards and their index sit in `shared/`.
export const layer = Layer.effect(
  Whiteboards,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const platform = yield* HostProcess.Platform;
    const pathOf = (file: string) => path.join(stateDir, "whiteboards", file);
    const missing = (error: PlatformError.PlatformError) => error.reason._tag === "NotFound";
    return yield* makeWith({
      read: (file) =>
        fs.readFileString(pathOf(file)).pipe(Effect.catchIf(missing, () => Effect.succeed(null))),
      write: (file, contents) =>
        writeFileStringAtomically({ filePath: pathOf(file), contents }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.provideService(HostProcess.Platform, platform),
        ),
      remove: (file) => fs.remove(pathOf(file)).pipe(Effect.catchIf(missing, () => Effect.void)),
    });
  }),
);

/** Boards that live only as long as the process, for tests. */
export const layerMemory = Layer.effect(
  Whiteboards,
  Effect.suspend(() => {
    const files = new Map<string, string>();
    return makeWith({
      read: (file) => Effect.succeed(files.get(file) ?? null),
      write: (file, contents) => Effect.sync(() => void files.set(file, contents)),
      remove: (file) => Effect.sync(() => void files.delete(file)),
    });
  }),
).pipe(Layer.provide(SecureRandom.layerWebCrypto));
