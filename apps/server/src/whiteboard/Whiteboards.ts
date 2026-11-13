import {
  NonNegativeInt,
  WhiteboardElement,
  WhiteboardError,
  WhiteboardFiles,
  type ThreadId,
  type WhiteboardActivityEvent,
  type WhiteboardEditor,
  type WhiteboardSaveInput,
  type WhiteboardSaveResult,
  type WhiteboardScene,
  type WhiteboardSceneEvent,
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
  type WhiteboardChanges,
  type WhiteboardEdit,
  type WhiteboardElementView,
} from "./whiteboardScene.ts";

const SNAPSHOT_TIMEOUT = "10 seconds";

const StoredBoard = Schema.Struct({
  revision: NonNegativeInt,
  elements: Schema.Array(WhiteboardElement),
  files: WhiteboardFiles,
  /** Element versions the agent last saw; whatever differs was changed by the user since. */
  agentSeen: Schema.NullOr(Schema.Record(Schema.String, Schema.Number)),
});
type StoredBoard = typeof StoredBoard.Type;

const StoredBoardJson = Schema.fromJsonString(StoredBoard);
const decodeStoredBoard = Schema.decodeUnknownEffect(StoredBoardJson);
const encodeStoredBoard = Schema.encodeSync(StoredBoardJson);

const EMPTY_BOARD: StoredBoard = { revision: 0, elements: [], files: {}, agentSeen: null };

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
        return "No window has this thread's Whiteboard tab open, and only an open tab can draw the picture. Use whiteboard_read for the board's contents as data.";
      case "timed-out":
        return "The open Whiteboard tab did not return a picture in time. Use whiteboard_read for the board's contents as data.";
    }
  }
}

export interface WhiteboardAgentView {
  readonly revision: number;
  readonly elements: ReadonlyArray<WhiteboardElementView>;
  /** What the user changed since the agent last read or edited the board. */
  readonly userChanges: WhiteboardChanges | null;
}

export interface WhiteboardPicture {
  readonly mimeType: "image/png";
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

interface BoardStorage {
  readonly read: (threadId: ThreadId) => Effect.Effect<string | null, PlatformError.PlatformError>;
  readonly write: (
    threadId: ThreadId,
    contents: string,
  ) => Effect.Effect<void, PlatformError.PlatformError>;
}

export class Whiteboards extends Context.Service<
  Whiteboards,
  {
    readonly get: (threadId: ThreadId) => Effect.Effect<WhiteboardScene, WhiteboardError>;
    /** Merges a window's elements into the board. */
    readonly save: (
      input: WhiteboardSaveInput,
    ) => Effect.Effect<WhiteboardSaveResult, WhiteboardError>;
    /** The current scene, then every later change and picture request for the thread. */
    readonly stream: (threadId: ThreadId) => Stream.Stream<WhiteboardStreamEvent, WhiteboardError>;
    /** One event per change on any thread's board. */
    readonly activity: Stream.Stream<WhiteboardActivityEvent>;
    readonly submitSnapshot: (input: WhiteboardSnapshotInput) => Effect.Effect<void>;
    /** The board as an agent reads it. Counts as the agent having seen it. */
    readonly read: (threadId: ThreadId) => Effect.Effect<WhiteboardAgentView, WhiteboardError>;
    readonly edit: (
      threadId: ThreadId,
      edit: WhiteboardEdit,
    ) => Effect.Effect<
      {
        readonly revision: number;
        readonly addedIds: ReadonlyArray<string>;
        /** Overlaps and cramped labels among what the edit touched, which the agent cannot see. */
        readonly layoutWarnings: ReadonlyArray<string>;
      },
      WhiteboardError | WhiteboardEditRejected
    >;
    /** Asks an open Whiteboard tab to draw the board, since only a browser can render it. */
    readonly picture: (
      threadId: ThreadId,
    ) => Effect.Effect<WhiteboardPicture, WhiteboardError | WhiteboardPictureUnavailable>;
    /** A note on what the user changed since the agent last saw the board, given once. */
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
    readonly threadId: ThreadId;
    readonly event: WhiteboardStreamEvent;
  }>();
  const activity = yield* PubSub.unbounded<WhiteboardActivityEvent>();
  const boards = new Map<ThreadId, StoredBoard>();
  const openTabs = new Map<ThreadId, number>();
  const pictureRequests = new Map<string, Deferred.Deferred<WhiteboardPicture>>();

  const load = Effect.fn("Whiteboards.load")(
    function* (threadId: ThreadId) {
      const cached = boards.get(threadId);
      if (cached !== undefined) return cached;
      const raw = yield* storage.read(threadId);
      const board = raw === null ? EMPTY_BOARD : yield* decodeStoredBoard(raw);
      boards.set(threadId, board);
      return board;
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.mapError((cause) => new WhiteboardError({ threadId, operation: "load", cause })),
      ),
  );

  const store = Effect.fn("Whiteboards.store")(function* (threadId: ThreadId, board: StoredBoard) {
    yield* storage
      .write(threadId, encodeStoredBoard(board))
      .pipe(
        Effect.mapError((cause) => new WhiteboardError({ threadId, operation: "save", cause })),
      );
    boards.set(threadId, board);
  });

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

  const announce = Effect.fn("Whiteboards.announce")(function* (
    threadId: ThreadId,
    board: StoredBoard,
    editor: WhiteboardEditor,
    clientId: string | null,
  ) {
    yield* PubSub.publish(events, { threadId, event: sceneEvent(board, editor, clientId) });
    yield* PubSub.publish(activity, { threadId, revision: board.revision, editor });
  });

  const get: Whiteboards["Service"]["get"] = Effect.fn("Whiteboards.get")(function* (threadId) {
    const board = yield* load(threadId);
    return { threadId, revision: board.revision, elements: board.elements, files: board.files };
  });

  const save: Whiteboards["Service"]["save"] = Effect.fn("Whiteboards.save")(function* (input) {
    const board = yield* load(input.threadId);
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
    yield* store(input.threadId, next);
    yield* announce(input.threadId, next, "user", input.clientId);
    return { revision: next.revision };
  }, lock.withPermits(1));

  // Subscribes before reading, so a change made during the read still arrives.
  const stream: Whiteboards["Service"]["stream"] = (threadId) =>
    Stream.callback<WhiteboardStreamEvent, WhiteboardError>(
      (mailbox) =>
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(events);
          yield* Effect.acquireRelease(
            Effect.sync(() => openTabs.set(threadId, (openTabs.get(threadId) ?? 0) + 1)),
            () => Effect.sync(() => openTabs.set(threadId, (openTabs.get(threadId) ?? 1) - 1)),
          );
          Queue.offerUnsafe(mailbox, sceneEvent(yield* load(threadId), null, null));
          yield* Stream.fromSubscription(subscription).pipe(
            Stream.runForEach((change) =>
              Effect.sync(() => {
                if (change.threadId === threadId) Queue.offerUnsafe(mailbox, change.event);
              }),
            ),
            Effect.forkScoped,
          );
        }),
      { bufferSize: 64, strategy: "sliding" },
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

  const read: Whiteboards["Service"]["read"] = Effect.fn("Whiteboards.read")(function* (threadId) {
    const board = yield* load(threadId);
    const userChanges =
      board.agentSeen === null && liveElementCount(board) === 0
        ? null
        : whiteboardChangesSince(board.agentSeen, board.elements);
    if (userChanges !== null || board.agentSeen === null) {
      yield* store(threadId, { ...board, agentSeen: whiteboardSeenVersions(board.elements) });
    }
    return {
      revision: board.revision,
      elements: describeWhiteboard(board.elements),
      userChanges,
    };
  }, lock.withPermits(1));

  const edit: Whiteboards["Service"]["edit"] = Effect.fn("Whiteboards.edit")(function* (
    threadId,
    change,
  ) {
    const board = yield* load(threadId);
    const outcome = applyWhiteboardEdit(board.elements, change, {
      now: yield* Clock.currentTimeMillis,
      random: Math.random,
      makeId: () => SecureRandom.uuidV4Unsafe(),
    });
    if (!outcome.ok) return yield* new WhiteboardEditRejected({ problems: outcome.problems });
    // Only what this edit touched counts as seen, so the user's unseen changes still get reported.
    const before = new Map(board.elements.map((element) => [element.id, element.version]));
    const touched = outcome.elements.filter(
      (element) => before.get(element.id) !== element.version,
    );
    const agentSeen = { ...board.agentSeen };
    for (const element of touched) {
      if (typeof element.id !== "string") continue;
      if (element.isDeleted === true) delete agentSeen[element.id];
      else if (typeof element.version === "number") agentSeen[element.id] = element.version;
    }
    const layoutWarnings = whiteboardLayoutWarnings(
      outcome.elements,
      new Set(touched.flatMap((element) => (typeof element.id === "string" ? [element.id] : []))),
    );
    if (touched.length === 0) {
      return { revision: board.revision, addedIds: outcome.addedIds, layoutWarnings };
    }
    const next: StoredBoard = {
      ...board,
      revision: board.revision + 1,
      elements: outcome.elements,
      agentSeen,
    };
    yield* store(threadId, next);
    yield* announce(threadId, next, "agent", null);
    return { revision: next.revision, addedIds: outcome.addedIds, layoutWarnings };
  }, lock.withPermits(1));

  const picture: Whiteboards["Service"]["picture"] = Effect.fn("Whiteboards.picture")(
    function* (threadId) {
      const board = yield* load(threadId);
      if (liveElementCount(board) === 0) {
        return yield* new WhiteboardPictureUnavailable({ reason: "empty" });
      }
      if ((openTabs.get(threadId) ?? 0) === 0) {
        return yield* new WhiteboardPictureUnavailable({ reason: "not-open" });
      }
      const requestId = yield* random.uuidV4();
      const request = yield* Deferred.make<WhiteboardPicture>();
      pictureRequests.set(requestId, request);
      yield* PubSub.publish(events, { threadId, event: { type: "snapshot-request", requestId } });
      const drawn = yield* Deferred.await(request).pipe(
        Effect.timeoutOption(SNAPSHOT_TIMEOUT),
        Effect.ensuring(Effect.sync(() => pictureRequests.delete(requestId))),
      );
      if (Option.isNone(drawn)) {
        return yield* new WhiteboardPictureUnavailable({ reason: "timed-out" });
      }
      return drawn.value;
    },
  );

  const takeUserChangeNote: Whiteboards["Service"]["takeUserChangeNote"] = Effect.fn(
    "Whiteboards.takeUserChangeNote",
  )(function* (threadId) {
    const board = yield* load(threadId);
    const changes = whiteboardChangesSince(board.agentSeen, board.elements);
    if (changes === null) return null;
    yield* store(threadId, { ...board, agentSeen: whiteboardSeenVersions(board.elements) });
    return whiteboardChangeNote(changes, board.revision);
  }, lock.withPermits(1));

  return Whiteboards.of({
    get,
    save,
    stream,
    activity: Stream.fromPubSub(activity),
    submitSnapshot,
    read,
    edit,
    picture,
    takeUserChangeNote,
  });
});

/** Thread ids are opaque strings; keep them from naming a path outside the folder. */
const boardFileName = (threadId: ThreadId) => `${threadId.replace(/[^\w.-]/g, "_")}.json`;

// One JSON file per thread under T3 home, not a SQLite table: this fork rebases onto upstream,
// and a fork-owned migration id would collide with the next one upstream adds.
export const layer = Layer.effect(
  Whiteboards,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const platform = yield* HostProcess.Platform;
    const fileOf = (threadId: ThreadId) =>
      path.join(stateDir, "whiteboards", boardFileName(threadId));
    return yield* makeWith({
      read: (threadId) =>
        fs.readFileString(fileOf(threadId)).pipe(
          Effect.catchIf(
            (error) => error.reason._tag === "NotFound",
            () => Effect.succeed(null),
          ),
        ),
      write: (threadId, contents) =>
        writeFileStringAtomically({ filePath: fileOf(threadId), contents }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.provideService(HostProcess.Platform, platform),
        ),
    });
  }),
);

/** Boards that live only as long as the process, for tests. */
export const layerMemory = Layer.effect(
  Whiteboards,
  Effect.suspend(() => {
    const files = new Map<ThreadId, string>();
    return makeWith({
      read: (threadId) => Effect.succeed(files.get(threadId) ?? null),
      write: (threadId, contents) => Effect.sync(() => void files.set(threadId, contents)),
    });
  }),
).pipe(Layer.provide(SecureRandom.layerWebCrypto));
