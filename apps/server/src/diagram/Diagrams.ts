import {
  DIAGRAM_NAME_MAX_LENGTH,
  DiagramBoard,
  DiagramBoardId,
  DiagramBoardRejected,
  DiagramError,
  type DiagramBoardInput,
  type DiagramCreateInput,
  type DiagramDeleteInput,
  type DiagramDirectory,
  type DiagramDocument,
  type DiagramDocumentEvent,
  type DiagramEngine,
  type DiagramRenameInput,
  type DiagramSaveInput,
  type DiagramSaveResult,
  type DiagramSelectInput,
  type ThreadId,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

const StoredIndex = Schema.Struct({
  boards: Schema.Array(DiagramBoard),
  selected: Schema.Record(Schema.String, DiagramBoardId),
});
type StoredIndex = typeof StoredIndex.Type;

const StoredIndexJson = Schema.fromJsonString(StoredIndex);
const decodeStoredIndex = Schema.decodeUnknownEffect(StoredIndexJson);
const encodeStoredIndex = Schema.encodeSync(StoredIndexJson);

const EMPTY_INDEX: StoredIndex = { boards: [], selected: {} };
const INDEX_FILE = "index.json";

export const EMPTY_DRAWIO_XML =
  '<mxfile host="t3code" type="embed"><diagram id="page-1" name="Page-1"><mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1100" pageHeight="850" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

export const EMPTY_DRAWNIX_JSON = JSON.stringify({
  type: "drawnix",
  version: 2,
  source: "t3code",
  elements: [],
});

const ENGINE_CONFIG: Readonly<
  Record<
    DiagramEngine,
    {
      readonly folder: string;
      readonly extension: string;
      readonly untitledName: string;
      readonly emptyContent: string;
    }
  >
> = {
  drawio: {
    folder: "drawio",
    extension: ".drawio",
    untitledName: "Diagram",
    emptyContent: EMPTY_DRAWIO_XML,
  },
  drawnix: {
    folder: "drawnix",
    extension: ".drawnix",
    untitledName: "Board",
    emptyContent: EMPTY_DRAWNIX_JSON,
  },
};

const sameName = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

interface StoredDocument {
  readonly revision: number;
  readonly content: string;
}

interface DiagramStorage {
  readonly read: (
    engine: DiagramEngine,
    file: string,
  ) => Effect.Effect<string | null, PlatformError.PlatformError>;
  readonly write: (
    engine: DiagramEngine,
    file: string,
    contents: string,
  ) => Effect.Effect<void, PlatformError.PlatformError>;
  readonly remove: (
    engine: DiagramEngine,
    file: string,
  ) => Effect.Effect<void, PlatformError.PlatformError>;
}

type ThreadTitles = (
  threadIds: ReadonlyArray<ThreadId>,
) => Effect.Effect<Readonly<Record<string, string>>>;

type DiagramFailure = DiagramError | DiagramBoardRejected;

export class Diagrams extends Context.Service<
  Diagrams,
  {
    readonly get: (input: DiagramBoardInput) => Effect.Effect<DiagramDocument, DiagramFailure>;
    readonly save: (input: DiagramSaveInput) => Effect.Effect<DiagramSaveResult, DiagramFailure>;
    readonly stream: (
      input: DiagramBoardInput,
    ) => Stream.Stream<DiagramDocumentEvent, DiagramFailure>;
    readonly directory: (engine: DiagramEngine) => Stream.Stream<DiagramDirectory, DiagramError>;
    readonly create: (input: DiagramCreateInput) => Effect.Effect<DiagramBoard, DiagramFailure>;
    readonly rename: (input: DiagramRenameInput) => Effect.Effect<void, DiagramFailure>;
    readonly remove: (input: DiagramDeleteInput) => Effect.Effect<void, DiagramFailure>;
    readonly select: (input: DiagramSelectInput) => Effect.Effect<void, DiagramFailure>;
  }
>()("t3/diagram/Diagrams") {}

const makeEngineStore = Effect.fn("Diagrams.makeEngineStore")(function* (
  engine: DiagramEngine,
  storage: DiagramStorage,
  threadTitles: ThreadTitles,
) {
  const config = ENGINE_CONFIG[engine];
  const random = yield* SecureRandom.SecureRandom;
  const lock = yield* Semaphore.make(1);
  const indexLoad = yield* Semaphore.make(1);
  const events = yield* PubSub.unbounded<{
    readonly boardId: DiagramBoardId;
    readonly event: DiagramDocumentEvent;
  }>();
  const directories = yield* PubSub.unbounded<DiagramDirectory>();
  const documents = new Map<DiagramBoardId, StoredDocument>();
  let index: StoredIndex | null = null;

  const fileOf = (boardId: DiagramBoardId) => `${boardId}${config.extension}`;
  const failed = (file: string, operation: "load" | "save") => (cause: unknown) =>
    new DiagramError({ engine, board: file, operation, cause });

  const toDirectory = (current: StoredIndex): DiagramDirectory => ({
    engine,
    boards: current.boards,
    selected: current.selected,
  });

  const loadIndex = Effect.fn("Diagrams.loadIndex")(
    function* () {
      if (index !== null) return index;
      const raw = yield* storage.read(engine, INDEX_FILE);
      index = raw === null ? EMPTY_INDEX : yield* decodeStoredIndex(raw);
      return index;
    },
    Effect.mapError(failed(INDEX_FILE, "load")),
    indexLoad.withPermits(1),
  );

  const storeIndex = Effect.fn("Diagrams.storeIndex")(function* (next: StoredIndex) {
    yield* storage
      .write(engine, INDEX_FILE, encodeStoredIndex(next))
      .pipe(Effect.mapError(failed(INDEX_FILE, "save")));
    index = next;
    yield* PubSub.publish(directories, toDirectory(next));
  });

  const existing = Effect.fn("Diagrams.existing")(function* (boardId: DiagramBoardId) {
    const current = yield* loadIndex();
    if (current.boards.some((board) => board.boardId === boardId)) return boardId;
    return yield* new DiagramBoardRejected({ reason: "not-found", board: boardId });
  });

  const freeName = Effect.fn("Diagrams.freeName")(function* (
    current: StoredIndex,
    name: string,
    except?: DiagramBoardId,
  ) {
    const taken = current.boards.some(
      (board) => board.boardId !== except && sameName(board.name, name),
    );
    if (taken) return yield* new DiagramBoardRejected({ reason: "name-taken", board: name });
  });

  const freeNameLike = (taken: ReadonlyArray<DiagramBoard>, wanted: string) => {
    for (let count = 1; ; count += 1) {
      const suffix = count === 1 ? "" : ` ${count}`;
      const name = `${wanted.slice(0, DIAGRAM_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
      if (!taken.some((board) => sameName(board.name, name))) return name;
    }
  };

  const loadDocument = Effect.fn("Diagrams.loadDocument")(function* (boardId: DiagramBoardId) {
    const cached = documents.get(boardId);
    if (cached !== undefined) return cached;
    const file = fileOf(boardId);
    const raw = yield* storage.read(engine, file).pipe(Effect.mapError(failed(file, "load")));
    const loaded: StoredDocument =
      raw === null ? { revision: 0, content: config.emptyContent } : { revision: 1, content: raw };
    documents.set(boardId, loaded);
    return loaded;
  });

  const storeDocument = Effect.fn("Diagrams.storeDocument")(function* (
    boardId: DiagramBoardId,
    next: StoredDocument,
  ) {
    const file = fileOf(boardId);
    yield* storage.write(engine, file, next.content).pipe(Effect.mapError(failed(file, "save")));
    documents.set(boardId, next);
  });

  const get = Effect.fn("Diagrams.get")(function* (boardId: DiagramBoardId) {
    const stored = yield* loadDocument(yield* existing(boardId));
    return { engine, boardId, revision: stored.revision, content: stored.content };
  });

  const save = Effect.fn("Diagrams.save")(function* (input: DiagramSaveInput) {
    const stored = yield* loadDocument(yield* existing(input.boardId));
    if (input.content === stored.content) return { revision: stored.revision };
    const next: StoredDocument = { revision: stored.revision + 1, content: input.content };
    yield* storeDocument(input.boardId, next);
    yield* PubSub.publish(events, {
      boardId: input.boardId,
      event: { revision: next.revision, content: next.content, clientId: input.clientId },
    });
    return { revision: next.revision };
  }, lock.withPermits(1));

  const stream = (boardId: DiagramBoardId): Stream.Stream<DiagramDocumentEvent, DiagramFailure> =>
    Stream.callback<DiagramDocumentEvent, DiagramFailure>(
      (mailbox) =>
        Effect.gen(function* () {
          yield* existing(boardId);
          const subscription = yield* PubSub.subscribe(events);
          const initial = yield* loadDocument(boardId);
          Queue.offerUnsafe(mailbox, {
            revision: initial.revision,
            content: initial.content,
            clientId: null,
          });
          yield* Stream.fromSubscription(subscription).pipe(
            Stream.runForEach((change) =>
              Effect.sync(() => {
                if (change.boardId === boardId) Queue.offerUnsafe(mailbox, change.event);
              }),
            ),
            Effect.forkScoped,
          );
        }),
      { bufferSize: 32, strategy: "sliding" },
    );

  const directory: Stream.Stream<DiagramDirectory, DiagramError> = Stream.callback<
    DiagramDirectory,
    DiagramError
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

  const create = Effect.fn("Diagrams.create")(function* (input: DiagramCreateInput) {
    const current = yield* loadIndex();
    if (input.name !== undefined) yield* freeName(current, input.name);
    const source =
      input.copyOf === undefined ? null : yield* loadDocument(yield* existing(input.copyOf));
    const title =
      input.name ??
      freeNameLike(
        current.boards,
        (input.threadId === undefined
          ? undefined
          : (yield* threadTitles([input.threadId]))[input.threadId]
        )?.trim() || config.untitledName,
      );
    const board: DiagramBoard = { boardId: yield* random.uuidV4(), name: title };
    yield* storeDocument(board.boardId, {
      revision: source === null ? 0 : 1,
      content: source?.content ?? config.emptyContent,
    });
    const selected =
      input.threadId === undefined
        ? current.selected
        : { ...current.selected, [input.threadId]: board.boardId };
    yield* storeIndex({ boards: [...current.boards, board], selected });
    return board;
  }, lock.withPermits(1));

  const rename = Effect.fn("Diagrams.rename")(function* (input: DiagramRenameInput) {
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

  const remove = Effect.fn("Diagrams.remove")(function* (input: DiagramDeleteInput) {
    yield* existing(input.boardId);
    const current = yield* loadIndex();
    yield* storeIndex({
      boards: current.boards.filter((board) => board.boardId !== input.boardId),
      selected: Object.fromEntries(
        Object.entries(current.selected).filter(([, boardId]) => boardId !== input.boardId),
      ),
    });
    const file = fileOf(input.boardId);
    documents.delete(input.boardId);
    yield* storage.remove(engine, file).pipe(Effect.mapError(failed(file, "save")));
  }, lock.withPermits(1));

  const select = Effect.fn("Diagrams.select")(function* (input: DiagramSelectInput) {
    const current = yield* loadIndex();
    yield* existing(input.boardId);
    if (current.selected[input.threadId] === input.boardId) return;
    yield* storeIndex({
      ...current,
      selected: { ...current.selected, [input.threadId]: input.boardId },
    });
  }, lock.withPermits(1));

  return { get, save, stream, directory, create, rename, remove, select };
});

const makeWith = Effect.fn("Diagrams.make")(function* (
  storage: DiagramStorage,
  threadTitles: ThreadTitles,
) {
  const stores = {
    drawio: yield* makeEngineStore("drawio", storage, threadTitles),
    drawnix: yield* makeEngineStore("drawnix", storage, threadTitles),
  } as const;

  return Diagrams.of({
    get: Effect.fn("Diagrams.get")(function* (input) {
      return yield* stores[input.engine].get(input.boardId);
    }),
    save: Effect.fn("Diagrams.save")(function* (input) {
      return yield* stores[input.engine].save(input);
    }),
    stream: (input) => stores[input.engine].stream(input.boardId),
    directory: (engine) => stores[engine].directory,
    create: Effect.fn("Diagrams.create")(function* (input) {
      return yield* stores[input.engine].create(input);
    }),
    rename: Effect.fn("Diagrams.rename")(function* (input) {
      return yield* stores[input.engine].rename(input);
    }),
    remove: Effect.fn("Diagrams.remove")(function* (input) {
      return yield* stores[input.engine].remove(input);
    }),
    select: Effect.fn("Diagrams.select")(function* (input) {
      return yield* stores[input.engine].select(input);
    }),
  });
});

// Plain `.drawio` XML and `.drawnix` JSON files under T3 home instead of SQLite migrations, so
// upstream nightly rebases never collide on a fork-owned migration number.
export const layer = Layer.effect(
  Diagrams,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const platform = yield* HostProcess.Platform;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const pathOf = (engine: DiagramEngine, file: string) =>
      path.join(stateDir, ENGINE_CONFIG[engine].folder, file);
    const missing = (error: PlatformError.PlatformError) => error.reason._tag === "NotFound";
    return yield* makeWith(
      {
        read: (engine, file) =>
          fs
            .readFileString(pathOf(engine, file))
            .pipe(Effect.catchIf(missing, () => Effect.succeed(null))),
        write: (engine, file, contents) =>
          writeFileStringAtomically({ filePath: pathOf(engine, file), contents }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.provideService(HostProcess.Platform, platform),
          ),
        remove: (engine, file) =>
          fs.remove(pathOf(engine, file)).pipe(Effect.catchIf(missing, () => Effect.void)),
      },
      (threadIds) => projections.getThreadTitles(threadIds).pipe(Effect.orElseSucceed(() => ({}))),
    );
  }),
).pipe(Layer.provide(ProjectionStore.layer));

export const layerMemoryWith = (input: {
  readonly files?: Readonly<Record<string, string>>;
  readonly threadTitles?: Readonly<Record<string, string>>;
}) =>
  Layer.effect(
    Diagrams,
    Effect.suspend(() => {
      const files = new Map(Object.entries(input.files ?? {}));
      const keyOf = (engine: DiagramEngine, file: string) => `${engine}/${file}`;
      return makeWith(
        {
          read: (engine, file) => Effect.succeed(files.get(keyOf(engine, file)) ?? null),
          write: (engine, file, contents) =>
            Effect.sync(() => void files.set(keyOf(engine, file), contents)),
          remove: (engine, file) => Effect.sync(() => void files.delete(keyOf(engine, file))),
        },
        () => Effect.succeed(input.threadTitles ?? {}),
      );
    }),
  ).pipe(Layer.provide(SecureRandom.layerWebCrypto));

export const layerMemory = layerMemoryWith({});
