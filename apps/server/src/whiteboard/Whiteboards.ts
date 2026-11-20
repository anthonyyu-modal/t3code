import {
  NonNegativeInt,
  ThreadId,
  WHITEBOARD_NAME_MAX_LENGTH,
  Whiteboard,
  WhiteboardBoardRejected,
  WhiteboardElement,
  WhiteboardError,
  WhiteboardFiles,
  WhiteboardId,
  WhiteboardName,
  type WhiteboardActivityEvent,
  type WhiteboardCreateInput,
  type WhiteboardDeleteInput,
  type WhiteboardDirectory,
  type WhiteboardEditor,
  type WhiteboardRenameInput,
  type WhiteboardSaveInput,
  type WhiteboardSaveResult,
  type WhiteboardScene,
  type WhiteboardSceneEvent,
  type WhiteboardSelectInput,
  type WhiteboardSnapshotInput,
  type WhiteboardStreamEvent,
} from "@t3tools/contracts";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- A board moved from a thread needs the same id every time its old file is read.
import * as NodeCrypto from "node:crypto";

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
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
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

// A window that is there answers within a second; one that is asleep never does.
const SNAPSHOT_TIMEOUT = "5 seconds";

const SeenVersions = Schema.Record(Schema.String, Schema.Number);

const StoredBoard = Schema.Struct({
  revision: NonNegativeInt,
  elements: Schema.Array(WhiteboardElement),
  files: WhiteboardFiles,
  /** The element versions each thread's agent last saw, by thread id. Whatever differs changed since. */
  seenBy: Schema.optional(Schema.Record(Schema.String, SeenVersions)),
});
type StoredBoard = typeof StoredBoard.Type;

const StoredBoardJson = Schema.fromJsonString(StoredBoard);
const decodeStoredBoard = Schema.decodeUnknownEffect(StoredBoardJson);
const encodeStoredBoard = Schema.encodeSync(StoredBoardJson);

const EMPTY_BOARD: StoredBoard = { revision: 0, elements: [], files: {} };

/** A board from when each thread had one of its own, which only that thread's agent saw. */
const ThreadBoard = Schema.Struct({
  revision: NonNegativeInt,
  elements: Schema.Array(WhiteboardElement),
  files: WhiteboardFiles,
  agentSeen: Schema.NullOr(SeenVersions),
});
const decodeThreadBoard = Schema.decodeUnknownEffect(Schema.fromJsonString(ThreadBoard));

const StoredIndex = Schema.Struct({
  boards: Schema.Array(Whiteboard),
  /** The board each thread's Whiteboard tab shows, by thread id. */
  selected: Schema.Record(Schema.String, WhiteboardId),
  /** Threads whose tab changed board without their agent having been told. */
  unannounced: Schema.Array(Schema.String),
});
type StoredIndex = typeof StoredIndex.Type;

const StoredIndexJson = Schema.fromJsonString(StoredIndex);
const decodeStoredIndex = Schema.decodeUnknownEffect(StoredIndexJson);
const encodeStoredIndex = Schema.encodeSync(StoredIndexJson);

const EMPTY_INDEX: StoredIndex = { boards: [], selected: {}, unannounced: [] };
// Boards sit in `shared/` because the folder above it used to hold each thread's own board.
const INDEX_FILE = "shared/index.json";
const THREAD_BOARD_SUFFIX = ".json";
const UNTITLED_BOARD_NAME = "Board";

const fileOf = (boardId: WhiteboardId) => `shared/${boardId}.json`;

const isThreadId = Schema.is(ThreadId);
const decodeBoardName = Schema.decodeUnknownOption(WhiteboardName);

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
  {
    reason: Schema.Literals(["no-board", "empty", "not-drawn"]),
    /** Why the server could not draw a board that no window drew. */
    detail: Schema.optional(Schema.String),
  },
) {
  override get message() {
    switch (this.reason) {
      case "no-board":
        return "This thread's Whiteboard tab shows no board. Name one with board.";
      case "empty":
        return "The whiteboard is empty, so there is nothing to picture.";
      case "not-drawn":
        return `No window drew this board, and the server could not draw it either. ${this.detail} Use whiteboard_read for the board's contents as data.`;
    }
  }
}

/** An agent named a board that does not exist. */
export class WhiteboardUnknownBoard extends Schema.TaggedError<WhiteboardUnknownBoard>()(
  "WhiteboardUnknownBoard",
  { board: Schema.String, boards: Schema.Array(Schema.String) },
) {
  override get message() {
    const known =
      this.boards.length === 0 ? "There are no boards yet." : `Boards: ${this.boards.join(", ")}.`;
    return `No board is named "${this.board}". ${known} To start a new board, pass newBoard to whiteboard_edit.`;
  }
}

export interface WhiteboardAgentView {
  /** The board that was read, by name. `null` when the thread's tab shows none and none was named. */
  readonly board: string | null;
  /** Every board, by name. */
  readonly boards: ReadonlyArray<string>;
  readonly revision: number;
  readonly elements: ReadonlyArray<WhiteboardElementView>;
  /** What changed since this thread's agent last read or edited the board. */
  readonly changes: WhiteboardChanges | null;
}

/**
 * Which board an agent means: the one its thread's Whiteboard tab shows, unless it names one. A
 * thread whose tab shows none starts a board named after the thread.
 */
export interface WhiteboardAgentTarget {
  readonly board?: string | undefined;
  /** Starts a board with this name. */
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
  /** The names of the files directly in the whiteboard folder. */
  readonly list: Effect.Effect<ReadonlyArray<string>, PlatformError.PlatformError>;
}

/** The titles of the threads that still exist, by thread id. */
type ThreadTitles = (
  threadIds: ReadonlyArray<ThreadId>,
) => Effect.Effect<Readonly<Record<string, string>>>;

type BoardFailure = WhiteboardError | WhiteboardBoardRejected;

export class Whiteboards extends Context.Service<
  Whiteboards,
  {
    readonly get: (boardId: WhiteboardId) => Effect.Effect<WhiteboardScene, BoardFailure>;
    /** Merges a window's elements into the board. */
    readonly save: (
      input: WhiteboardSaveInput,
    ) => Effect.Effect<WhiteboardSaveResult, BoardFailure>;
    /** The current scene, then every later change and picture request for the board. */
    readonly stream: (boardId: WhiteboardId) => Stream.Stream<WhiteboardStreamEvent, BoardFailure>;
    /** One event each time an agent draws. */
    readonly activity: Stream.Stream<WhiteboardActivityEvent>;
    readonly submitSnapshot: (input: WhiteboardSnapshotInput) => Effect.Effect<void>;
    /** The boards and each thread's choice of board, now and after every change. */
    readonly directory: Stream.Stream<WhiteboardDirectory, WhiteboardError>;
    readonly create: (input: WhiteboardCreateInput) => Effect.Effect<Whiteboard, BoardFailure>;
    readonly rename: (input: WhiteboardRenameInput) => Effect.Effect<void, BoardFailure>;
    /** Deletes a board. Threads that showed it show none until they open or start another. */
    readonly remove: (input: WhiteboardDeleteInput) => Effect.Effect<void, BoardFailure>;
    /** Sets which board a thread's Whiteboard tab shows. */
    readonly select: (input: WhiteboardSelectInput) => Effect.Effect<void, BoardFailure>;
    /** A board as an agent reads it. Counts as that thread's agent having seen it. */
    readonly read: (
      threadId: ThreadId,
      board?: string,
    ) => Effect.Effect<WhiteboardAgentView, WhiteboardError | WhiteboardUnknownBoard>;
    /** Draws on a board, starting one if need be, and shows it in the agent's thread's Whiteboard tab. */
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
    /**
     * The board an agent asks to see, and the picture of it that a window showing it draws.
     * `picture` is null when no window shows the board or none answers in time; WhiteboardPictures
     * then draws `elements` and `files` on the server.
     */
    readonly windowPicture: (
      threadId: ThreadId,
      board?: string,
    ) => Effect.Effect<
      {
        readonly board: string;
        readonly revision: number;
        readonly elements: ReadonlyArray<WhiteboardElement>;
        readonly files: WhiteboardFiles;
        readonly picture: WhiteboardPicture | null;
      },
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

const liveElementCount = (board: Pick<StoredBoard, "elements">) =>
  board.elements.filter((element) => element.isDeleted !== true).length;

const makeWith = Effect.fn("Whiteboards.make")(function* (
  storage: BoardStorage,
  threadTitles: ThreadTitles,
) {
  const random = yield* SecureRandom.SecureRandom;
  const lock = yield* Semaphore.make(1);
  const indexLoad = yield* Semaphore.make(1);
  const events = yield* PubSub.unbounded<{
    readonly boardId: WhiteboardId;
    readonly event: WhiteboardStreamEvent;
  }>();
  const activity = yield* PubSub.unbounded<WhiteboardActivityEvent>();
  const directories = yield* PubSub.unbounded<WhiteboardDirectory>();
  const boards = new Map<WhiteboardId, StoredBoard>();
  const openTabs = new Map<WhiteboardId, number>();
  const pictureRequests = new Map<string, Deferred.Deferred<WhiteboardPicture>>();
  let index: StoredIndex | null = null;

  const failed = (file: string, operation: "load" | "save") => (cause: unknown) =>
    new WhiteboardError({ board: file, operation, cause });

  const store = Effect.fn("Whiteboards.store")(function* (
    boardId: WhiteboardId,
    next: StoredBoard,
  ) {
    const file = fileOf(boardId);
    yield* storage.write(file, encodeStoredBoard(next)).pipe(Effect.mapError(failed(file, "save")));
    boards.set(boardId, next);
  });

  /** `wanted`, or `wanted 2`, `wanted 3` and so on while boards already have those names. */
  const freeNameLike = (taken: ReadonlyArray<Whiteboard>, wanted: string) => {
    for (let count = 1; ; count += 1) {
      const suffix = count === 1 ? "" : ` ${count}`;
      const name = `${wanted.slice(0, WHITEBOARD_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
      if (!taken.some((board) => sameName(board.name, name))) return name;
    }
  };

  const nameAfterThread = (taken: ReadonlyArray<Whiteboard>, title: string | undefined) =>
    freeNameLike(taken, title?.trim() || UNTITLED_BOARD_NAME);

  // Each thread once had a board of its own, in a file named after the thread. Each one that holds
  // a drawing becomes an ordinary board named after its thread, which that thread goes on showing
  // unless it had chosen another. A board's id comes from its old file's name, so a move that was
  // cut short picks up where it stopped.
  const adoptThreadBoards = Effect.fn("Whiteboards.adoptThreadBoards")(function* (
    current: StoredIndex,
  ) {
    const files = yield* storage.list.pipe(Effect.mapError(failed(INDEX_FILE, "load")));
    // The file's name is the thread's id with "_" for what a file name cannot hold, which in ids
    // such as "mcp:…" is the colon. Whichever reading names a thread is the thread.
    const threadBoards = files.flatMap((file) => {
      const name = file.slice(0, -THREAD_BOARD_SUFFIX.length);
      return file.endsWith(THREAD_BOARD_SUFFIX) && isThreadId(name)
        ? [{ file, name, withColons: ThreadId.make(name.replaceAll("_", ":")) }]
        : [];
    });
    if (threadBoards.length === 0) return current;
    const titles = yield* threadTitles(
      threadBoards.flatMap((board) => [board.name, board.withColons]),
    );
    const listed = [...current.boards];
    const selected = { ...current.selected };
    const adopted: Array<string> = [];
    for (const { file, name, withColons } of threadBoards) {
      const threadId = name in titles || !(withColons in titles) ? name : withColons;
      const boardId = NodeCrypto.createHash("sha256").update(file).digest("hex").slice(0, 32);
      const own = yield* storage.read(file).pipe(
        Effect.flatMap((raw) => (raw === null ? Effect.succeed(null) : decodeThreadBoard(raw))),
        Effect.catch((cause) =>
          Effect.logWarning("Left a thread's whiteboard where it was: it could not be read.", {
            file,
            cause,
          }).pipe(Effect.as(null)),
        ),
      );
      if (own === null) continue;
      adopted.push(file);
      const moved = listed.some((board) => board.boardId === boardId);
      if (moved || liveElementCount(own) === 0) continue;
      yield* store(boardId, {
        revision: own.revision,
        elements: own.elements,
        files: own.files,
        ...(own.agentSeen === null ? {} : { seenBy: { [threadId]: own.agentSeen } }),
      });
      listed.push({ boardId, name: nameAfterThread(listed, titles[threadId]) });
      selected[threadId] ??= boardId;
    }
    const next = { ...current, boards: listed, selected };
    // The index goes before the old files do: until it lists a board, its old file is the drawing.
    if (listed.length > current.boards.length) {
      yield* storage
        .write(INDEX_FILE, encodeStoredIndex(next))
        .pipe(Effect.mapError(failed(INDEX_FILE, "save")));
    }
    for (const file of adopted) {
      yield* storage.remove(file).pipe(Effect.mapError(failed(file, "save")));
    }
    return next;
  });

  // Reads run outside `lock`, so the first of them must not find the index half adopted.
  const loadIndex = Effect.fn("Whiteboards.loadIndex")(function* () {
    if (index !== null) return index;
    const raw = yield* storage.read(INDEX_FILE).pipe(Effect.mapError(failed(INDEX_FILE, "load")));
    const stored =
      raw === null
        ? EMPTY_INDEX
        : yield* decodeStoredIndex(raw).pipe(Effect.mapError(failed(INDEX_FILE, "load")));
    index = yield* adoptThreadBoards(stored);
    return index;
  }, indexLoad.withPermits(1));

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

  const load = Effect.fn("Whiteboards.load")(function* (boardId: WhiteboardId) {
    const cached = boards.get(boardId);
    if (cached !== undefined) return cached;
    const file = fileOf(boardId);
    const loaded = yield* storage.read(file).pipe(
      Effect.flatMap((raw) =>
        raw === null ? Effect.succeed(EMPTY_BOARD) : decodeStoredBoard(raw),
      ),
      Effect.mapError(failed(file, "load")),
    );
    boards.set(boardId, loaded);
    return loaded;
  });

  /** Fails for a board that does not exist, so nothing reads or writes a stray file. */
  const existing = Effect.fn("Whiteboards.existing")(function* (boardId: WhiteboardId) {
    const current = yield* loadIndex();
    if (current.boards.some((board) => board.boardId === boardId)) return boardId;
    return yield* new WhiteboardBoardRejected({ reason: "not-found", board: boardId });
  });

  /** The board a thread's Whiteboard tab shows, if the thread has opened or started one. */
  const shownIn = (current: StoredIndex, threadId: ThreadId): WhiteboardId | null => {
    const boardId = current.selected[threadId];
    return boardId !== undefined && current.boards.some((board) => board.boardId === boardId)
      ? boardId
      : null;
  };

  const nameOf = (current: StoredIndex, boardId: WhiteboardId) =>
    current.boards.find((board) => board.boardId === boardId)?.name ?? boardId;

  const namesOf = (current: StoredIndex) => current.boards.map((board) => board.name);

  /** The board an agent means: its thread's tab's board, unless it names another. */
  const named = Effect.fn("Whiteboards.named")(function* (
    current: StoredIndex,
    threadId: ThreadId,
    name: string | undefined,
  ) {
    if (name === undefined) return shownIn(current, threadId);
    const board = current.boards.find((candidate) => sameName(candidate.name, name));
    if (board !== undefined) return board.boardId;
    return yield* new WhiteboardUnknownBoard({ board: name, boards: namesOf(current) });
  });

  const freeName = Effect.fn("Whiteboards.freeName")(function* (
    current: StoredIndex,
    name: string,
    except?: WhiteboardId,
  ) {
    const taken = current.boards.some(
      (board) => board.boardId !== except && sameName(board.name, name),
    );
    if (taken) return yield* new WhiteboardBoardRejected({ reason: "name-taken", board: name });
  });

  const withSeen = (
    stored: StoredBoard,
    threadId: ThreadId,
    seen: Readonly<Record<string, number>>,
  ): StoredBoard => ({ ...stored, seenBy: { ...stored.seenBy, [threadId]: seen } });

  /** Points a thread's tab at a board, or at none, and remembers whether its agent knows. */
  const withSelection = (
    current: StoredIndex,
    threadId: ThreadId,
    boardId: WhiteboardId | null,
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
    boardId: WhiteboardId,
    stored: StoredBoard,
    editor: WhiteboardEditor,
    clientId: string | null,
  ) => PubSub.publish(events, { boardId, event: sceneEvent(stored, editor, clientId) });

  const get: Whiteboards["Service"]["get"] = Effect.fn("Whiteboards.get")(function* (boardId) {
    const stored = yield* load(yield* existing(boardId));
    return { boardId, revision: stored.revision, elements: stored.elements, files: stored.files };
  });

  const save: Whiteboards["Service"]["save"] = Effect.fn("Whiteboards.save")(function* (input) {
    const board = yield* load(yield* existing(input.boardId));
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
    yield* store(input.boardId, next);
    yield* announce(input.boardId, next, "user", input.clientId);
    return { revision: next.revision };
  }, lock.withPermits(1));

  // Subscribes before reading, so a change made during the read still arrives.
  const stream: Whiteboards["Service"]["stream"] = (boardId) =>
    Stream.callback<WhiteboardStreamEvent, BoardFailure>(
      (mailbox) =>
        Effect.gen(function* () {
          yield* existing(boardId);
          const subscription = yield* PubSub.subscribe(events);
          yield* Effect.acquireRelease(
            Effect.sync(() => openTabs.set(boardId, (openTabs.get(boardId) ?? 0) + 1)),
            () => Effect.sync(() => openTabs.set(boardId, (openTabs.get(boardId) ?? 1) - 1)),
          );
          Queue.offerUnsafe(mailbox, sceneEvent(yield* load(boardId), null, null));
          yield* Stream.fromSubscription(subscription).pipe(
            Stream.runForEach((change) =>
              Effect.sync(() => {
                if (change.boardId === boardId) Queue.offerUnsafe(mailbox, change.event);
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

  /** Starts a board under `name`, or under a name after `threadId`'s thread when it has none. */
  const addBoard = Effect.fn("Whiteboards.addBoard")(function* (
    current: StoredIndex,
    name: string | undefined,
    threadId: ThreadId | undefined,
    contents: StoredBoard,
  ) {
    if (name !== undefined) yield* freeName(current, name);
    const board: Whiteboard = {
      boardId: yield* random.uuidV4(),
      name:
        name ??
        nameAfterThread(
          current.boards,
          threadId === undefined ? undefined : (yield* threadTitles([threadId]))[threadId],
        ),
    };
    yield* store(board.boardId, contents);
    return { board, index: { ...current, boards: [...current.boards, board] } };
  });

  const create: Whiteboards["Service"]["create"] = Effect.fn("Whiteboards.create")(function* (
    input,
  ) {
    const current = yield* loadIndex();
    const source =
      input.copyOf === undefined ? EMPTY_BOARD : yield* load(yield* existing(input.copyOf));
    const elements = source.elements.filter((element) => element.isDeleted !== true);
    const added = yield* addBoard(current, input.name, input.threadId, {
      revision: elements.length === 0 ? 0 : 1,
      elements,
      files: source.files,
    });
    yield* storeIndex(
      input.threadId === undefined
        ? added.index
        : withSelection(added.index, input.threadId, added.board.boardId, false),
    );
    return added.board;
  }, lock.withPermits(1));

  const rename: Whiteboards["Service"]["rename"] = Effect.fn("Whiteboards.rename")(function* (
    input,
  ) {
    const current = yield* loadIndex();
    yield* existing(input.boardId);
    yield* freeName(current, input.name, input.boardId);
    yield* storeIndex({
      ...current,
      boards: current.boards.map((board) =>
        board.boardId === input.boardId ? { ...board, name: input.name } : board,
      ),
    });
  }, lock.withPermits(1));

  const remove: Whiteboards["Service"]["remove"] = Effect.fn("Whiteboards.remove")(function* (
    input,
  ) {
    yield* existing(input.boardId);
    const current = yield* loadIndex();
    const showing = Object.keys(current.selected).filter(
      (threadId) => current.selected[threadId] === input.boardId,
    );
    // The index goes first: a board left on disk without an entry is only an unused file.
    yield* storeIndex({
      boards: current.boards.filter((board) => board.boardId !== input.boardId),
      selected: Object.fromEntries(
        Object.entries(current.selected).filter(([, boardId]) => boardId !== input.boardId),
      ),
      unannounced: [...new Set([...current.unannounced, ...showing])],
    });
    const file = fileOf(input.boardId);
    boards.delete(input.boardId);
    yield* storage.remove(file).pipe(Effect.mapError(failed(file, "save")));
  }, lock.withPermits(1));

  const select: Whiteboards["Service"]["select"] = Effect.fn("Whiteboards.select")(function* (
    input,
  ) {
    const current = yield* loadIndex();
    yield* existing(input.boardId);
    if (shownIn(current, input.threadId) === input.boardId) return;
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
    const boardId = yield* named(current, threadId, name);
    if (boardId === null) {
      yield* told(threadId);
      return { board: null, boards: namesOf(current), revision: 0, elements: [], changes: null };
    }
    const stored = yield* load(boardId);
    const seen = stored.seenBy?.[threadId] ?? null;
    // A board this agent never saw has nothing to compare against.
    const changes = seen === null ? null : whiteboardChangesSince(seen, stored.elements);
    if (changes !== null || seen === null) {
      yield* store(boardId, withSeen(stored, threadId, whiteboardSeenVersions(stored.elements)));
    }
    if (boardId === shownIn(current, threadId)) yield* told(threadId);
    return {
      board: nameOf(current, boardId),
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
    const newName =
      target.newBoard === undefined
        ? undefined
        : Option.getOrNull(decodeBoardName(target.newBoard));
    if (newName === null) {
      return yield* new WhiteboardEditRejected({
        problems: [`newBoard: a board's name has 1 to ${WHITEBOARD_NAME_MAX_LENGTH} characters.`],
      });
    }
    // No board yet: the agent asked for a new one, or its thread's tab shows none.
    const existingBoard =
      newName === undefined ? yield* named(before, threadId, target.board) : null;
    const stored = existingBoard === null ? EMPTY_BOARD : yield* load(existingBoard);
    const outcome = applyWhiteboardEdit(stored.elements, change, {
      now: yield* Clock.currentTimeMillis,
      random: Math.random,
      makeId: () => SecureRandom.uuidV4Unsafe(),
    });
    if (!outcome.ok) return yield* new WhiteboardEditRejected({ problems: outcome.problems });
    // An invalid drawing must not leave an empty board behind, so the board starts only now.
    const added =
      existingBoard === null ? yield* addBoard(before, newName, threadId, EMPTY_BOARD) : null;
    const boardId = existingBoard ?? added!.board.boardId;
    const current = added?.index ?? before;
    // Only what this edit touched counts as seen, so changes the agent has not seen still get reported.
    const versions = new Map(stored.elements.map((element) => [element.id, element.version]));
    const touched = outcome.elements.filter(
      (element) => versions.get(element.id) !== element.version,
    );
    const seen = { ...stored.seenBy?.[threadId] };
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
            threadId,
            seen,
          );
    if (next !== stored) yield* store(boardId, next);
    // The user has to see what was drawn, so the thread's tab follows the agent to this board.
    const shown = withSelection(current, threadId, boardId, true);
    const moved = shownIn(current, threadId) !== boardId;
    if (added !== null || moved || current.unannounced.includes(threadId)) {
      yield* storeIndex(shown);
    }
    if (next !== stored) {
      yield* announce(boardId, next, "agent", null);
      yield* PubSub.publish(activity, {
        threadId,
        revision: next.revision,
        editor: "agent" as const,
      });
    }
    return {
      board: nameOf(shown, boardId),
      revision: next.revision,
      addedIds: outcome.addedIds,
      layoutWarnings,
    };
  }, lock.withPermits(1));

  const windowPicture: Whiteboards["Service"]["windowPicture"] = Effect.fn(
    "Whiteboards.windowPicture",
  )(function* (threadId, name) {
    const current = yield* loadIndex();
    const boardId = yield* named(current, threadId, name);
    if (boardId === null) {
      return yield* new WhiteboardPictureUnavailable({ reason: "no-board" });
    }
    const stored = yield* load(boardId);
    if (liveElementCount(stored) === 0) {
      return yield* new WhiteboardPictureUnavailable({ reason: "empty" });
    }
    const pictured = (board: StoredBoard, picture: WhiteboardPicture | null) => ({
      board: nameOf(current, boardId),
      revision: board.revision,
      elements: board.elements,
      files: board.files,
      picture,
    });
    if ((openTabs.get(boardId) ?? 0) === 0) return pictured(stored, null);
    const requestId = yield* random.uuidV4();
    const request = yield* Deferred.make<WhiteboardPicture>();
    pictureRequests.set(requestId, request);
    yield* PubSub.publish(events, { boardId, event: { type: "snapshot-request", requestId } });
    const drawn = yield* Deferred.await(request).pipe(
      Effect.timeoutOption(SNAPSHOT_TIMEOUT),
      Effect.ensuring(Effect.sync(() => pictureRequests.delete(requestId))),
    );
    // The board may have changed while the window was waited on.
    return Option.isSome(drawn)
      ? pictured(stored, drawn.value)
      : pictured(yield* load(boardId), null);
  });

  const takeUserChangeNote: Whiteboards["Service"]["takeUserChangeNote"] = Effect.fn(
    "Whiteboards.takeUserChangeNote",
  )(function* (threadId) {
    const current = yield* loadIndex();
    const boardId = shownIn(current, threadId);
    const moved = current.unannounced.includes(threadId);
    if (boardId === null) {
      if (!moved) return null;
      yield* told(threadId);
      return whiteboardSwitchNote(null);
    }
    const stored = yield* load(boardId);
    const name = nameOf(current, boardId);
    const seeAll = () =>
      store(boardId, withSeen(stored, threadId, whiteboardSeenVersions(stored.elements)));
    if (moved) {
      yield* seeAll();
      yield* told(threadId);
      return whiteboardSwitchNote({
        name,
        revision: stored.revision,
        elementCount: liveElementCount(stored),
      });
    }
    const changes = whiteboardChangesSince(stored.seenBy?.[threadId] ?? null, stored.elements);
    if (changes === null) return null;
    yield* seeAll();
    return whiteboardChangeNote(changes, stored.revision, name);
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
    windowPicture,
    takeUserChangeNote,
  });
});

// One JSON file per board under T3 home, not a SQLite table: this fork rebases onto upstream,
// and a fork-owned migration id would collide with the next one upstream adds.
export const layer = Layer.effect(
  Whiteboards,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const platform = yield* HostProcess.Platform;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const pathOf = (file: string) => path.join(stateDir, "whiteboards", file);
    const missing = (error: PlatformError.PlatformError) => error.reason._tag === "NotFound";
    return yield* makeWith(
      {
        read: (file) =>
          fs.readFileString(pathOf(file)).pipe(Effect.catchIf(missing, () => Effect.succeed(null))),
        write: (file, contents) =>
          writeFileStringAtomically({ filePath: pathOf(file), contents }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.provideService(HostProcess.Platform, platform),
          ),
        remove: (file) => fs.remove(pathOf(file)).pipe(Effect.catchIf(missing, () => Effect.void)),
        list: fs
          .readDirectory(pathOf(""))
          .pipe(Effect.catchIf(missing, () => Effect.succeed<ReadonlyArray<string>>([]))),
      },
      // A board still gets a name when its thread's title cannot be read.
      (threadIds) => projections.getThreadTitles(threadIds).pipe(Effect.orElseSucceed(() => ({}))),
    );
  }),
).pipe(Layer.provide(ProjectionStore.layer));

/** Boards that live only as long as the process, for tests. `files` is what the folder holds at first. */
export const layerMemoryWith = (input: {
  readonly files?: Readonly<Record<string, string>>;
  readonly threadTitles?: Readonly<Record<string, string>>;
}) =>
  Layer.effect(
    Whiteboards,
    Effect.suspend(() => {
      const files = new Map(Object.entries(input.files ?? {}));
      return makeWith(
        {
          read: (file) => Effect.succeed(files.get(file) ?? null),
          write: (file, contents) => Effect.sync(() => void files.set(file, contents)),
          remove: (file) => Effect.sync(() => void files.delete(file)),
          list: Effect.sync(() => [...files.keys()].filter((file) => !file.includes("/"))),
        },
        () => Effect.succeed(input.threadTitles ?? {}),
      );
    }),
  ).pipe(Layer.provide(SecureRandom.layerWebCrypto));

export const layerMemory = layerMemoryWith({});
