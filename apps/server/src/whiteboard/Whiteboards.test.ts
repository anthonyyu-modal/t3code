import { describe, expect, it } from "@effect/vitest";
import { ThreadId, type WhiteboardRef, type WhiteboardStreamEvent } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import * as Whiteboards from "./Whiteboards.ts";

const threadId = ThreadId.make("thread-board");
const otherThreadId = ThreadId.make("thread-other");
const ownBoard = { kind: "thread", threadId } as const;

const box = (id: string, version: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  version,
  versionNonce: 1,
  isDeleted: false,
  ...extra,
});

const userSaves = (boards: Whiteboards.Whiteboards["Service"], ...elements: Array<object>) =>
  boards.save({ board: ownBoard, clientId: "window-a", elements: elements as never });

const userSavesTo = (
  boards: Whiteboards.Whiteboards["Service"],
  boardId: string,
  ...elements: Array<object>
) =>
  boards.save({
    board: { kind: "shared", boardId },
    clientId: "window-a",
    elements: elements as never,
  });

/** Collects `count` events, resuming the test only once the stream has subscribed. */
const collect = Effect.fn("test.collect")(function* (
  boards: Whiteboards.Whiteboards["Service"],
  count: number,
  board: WhiteboardRef = ownBoard,
) {
  const subscribed = yield* Deferred.make<void>();
  const fiber = yield* boards.stream(board).pipe(
    Stream.tap(() => Deferred.succeed(subscribed, undefined)),
    Stream.take(count),
    Stream.runCollect,
    Effect.forkChild,
  );
  yield* Deferred.await(subscribed);
  return fiber;
});

const scenes = (events: ReadonlyArray<WhiteboardStreamEvent>) =>
  events.flatMap((event) =>
    event.type === "scene"
      ? [{ revision: event.revision, editor: event.editor, clientId: event.clientId }]
      : [],
  );

describe("Whiteboards", () => {
  it.effect("merges a window's save and only counts a revision when something changed", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      expect(yield* boards.get(ownBoard)).toEqual({
        board: ownBoard,
        revision: 0,
        elements: [],
        files: {},
      });
      expect(yield* userSaves(boards, box("a", 1))).toEqual({ revision: 1 });
      expect(yield* userSaves(boards, box("a", 1))).toEqual({ revision: 1 });
      const image = { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" };
      expect(
        yield* boards.save({
          board: ownBoard,
          clientId: "window-a",
          elements: [],
          files: { f1: image },
        }),
      ).toEqual({ revision: 2 });
      expect((yield* boards.get(ownBoard)).files).toEqual({ f1: image });
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect("streams the current scene, then the user's and the agent's changes", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      yield* userSaves(boards, box("a", 1));
      const fiber = yield* collect(boards, 3);
      yield* userSaves(boards, box("b", 1));
      yield* boards.edit(threadId, {}, { add: [{ type: "text", x: 0, y: 0, text: "hello" }] });
      expect(scenes(yield* Fiber.join(fiber))).toEqual([
        { revision: 1, editor: null, clientId: null },
        { revision: 2, editor: "user", clientId: "window-a" },
        { revision: 3, editor: "agent", clientId: null },
      ]);
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect("tells the agent once what the user changed, and not about its own edits", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();
      yield* boards.edit(
        threadId,
        {},
        { add: [{ type: "rectangle", id: "mine", x: 0, y: 0, text: "Agent box" }] },
      );
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();

      yield* userSaves(boards, box("theirs", 1));
      yield* boards.edit(threadId, {}, { update: [{ id: "mine", x: 40 }] });
      expect(yield* boards.takeUserChangeNote(threadId)).toContain("Added: rectangle (id theirs).");
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();

      yield* userSaves(boards, box("theirs", 2, { x: 500 }));
      const view = yield* boards.read(threadId);
      expect(view.changes).toEqual({
        added: [],
        changed: ["rectangle (id theirs)"],
        removed: [],
      });
      expect(view.elements.map((element) => element.id)).toEqual(["mine", "theirs"]);
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect("rejects an invalid agent edit without changing the board", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const error = yield* boards.edit(threadId, {}, { remove: ["nope"] }).pipe(Effect.flip);
      expect(error.message).toBe('Nothing was changed. remove: no element has id "nope".');
      expect((yield* boards.get(ownBoard)).revision).toBe(0);
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect("gets a picture from an open tab, and says why when it cannot", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const unavailable = (yield* boards.picture(threadId).pipe(Effect.flip)) as {
        readonly reason?: string;
      };
      expect(unavailable.reason).toBe("empty");
      yield* userSaves(boards, box("a", 1));
      const closed = (yield* boards.picture(threadId).pipe(Effect.flip)) as {
        readonly reason?: string;
      };
      expect(closed.reason).toBe("not-open");

      const tab = yield* collect(boards, 2);
      const picture = yield* boards.picture(threadId).pipe(Effect.forkChild);
      const request = (yield* Fiber.join(tab))[1];
      if (request?.type !== "snapshot-request") throw new Error("expected a picture request");
      const drawn = { mimeType: "image/png" as const, data: "AAAA", width: 4, height: 3 };
      yield* boards.submitSnapshot({ requestId: request.requestId, ...drawn });
      expect(yield* Fiber.join(picture)).toEqual({
        ...drawn,
        board: "This thread",
        revision: 1,
      });
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect("keeps shared boards that any thread can show, and copies a board into one", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      yield* userSaves(boards, box("a", 1), box("gone", 2, { isDeleted: true }));
      const subscribed = yield* Deferred.make<void>();
      const directory = yield* boards.directory.pipe(
        Stream.tap(() => Deferred.succeed(subscribed, undefined)),
        Stream.take(4),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(subscribed);
      const plan = yield* boards.create({ name: "Plan", copyOf: ownBoard, threadId });
      expect((yield* boards.get({ kind: "shared", boardId: plan.boardId })).elements).toEqual([
        box("a", 1),
      ]);
      const taken = yield* boards.create({ name: "plan" }).pipe(Effect.flip);
      expect(taken.message).toBe('A board named "plan" already exists.');
      expect((yield* boards.create({ name: "This thread" }).pipe(Effect.flip)).message).toBe(
        'A board named "This thread" already exists.',
      );

      yield* boards.rename({ boardId: plan.boardId, name: "Roadmap" });
      yield* boards.select({ threadId: otherThreadId, boardId: plan.boardId });
      yield* boards.remove({ boardId: plan.boardId });
      expect(yield* Fiber.join(directory)).toEqual([
        { boards: [], selected: {} },
        { boards: [plan], selected: { [threadId]: plan.boardId } },
        { boards: [{ ...plan, name: "Roadmap" }], selected: { [threadId]: plan.boardId } },
        {
          boards: [{ ...plan, name: "Roadmap" }],
          selected: { [threadId]: plan.boardId, [otherThreadId]: plan.boardId },
        },
      ]);
      const missing = yield* boards
        .get({ kind: "shared", boardId: plan.boardId })
        .pipe(Effect.flip);
      expect(missing.message).toBe(`There is no shared board "${plan.boardId}".`);
      expect((yield* boards.read(threadId)).board).toBe("This thread");
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect("notes a shared board's changes only for threads whose tab shows it", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const plan = yield* boards.create({ name: "Plan", threadId });
      expect(yield* boards.takeUserChangeNote(threadId)).toBe(
        [
          'The user switched this thread\'s Whiteboard tab to the shared board "Plan", which other threads can also draw on (revision 0). It is empty.',
          "The whiteboard tools now act on this board. Call whiteboard_read before you draw on it.",
        ].join("\n"),
      );

      yield* userSavesTo(boards, plan.boardId, box("a", 1));
      expect(yield* boards.takeUserChangeNote(otherThreadId)).toBeNull();
      expect(yield* boards.takeUserChangeNote(threadId)).toBe(
        [
          'The shared whiteboard "Plan", which this thread\'s Whiteboard tab shows, changed since you last saw it (now revision 1).',
          "Added: rectangle (id a).",
          "Call whiteboard_read for the whole board, or whiteboard_view for a picture of it.",
        ].join("\n"),
      );
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();

      // Another thread's agent draws on it: this thread hears of that too, once it is back on the board.
      yield* boards.select({ threadId, boardId: null });
      yield* boards.takeUserChangeNote(threadId);
      yield* boards.edit(otherThreadId, { board: "plan" }, { update: [{ id: "a", x: 300 }] });
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();
      yield* boards.select({ threadId, boardId: plan.boardId });
      yield* boards.takeUserChangeNote(threadId);
      yield* userSavesTo(boards, plan.boardId, box("b", 1));
      expect(yield* boards.takeUserChangeNote(threadId)).toContain("Added: rectangle (id b).");
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect("lets an agent name a board, and moves its thread's tab to where it draws", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const plan = yield* boards.create({ name: "Plan" });
      yield* userSavesTo(boards, plan.boardId, box("a", 1));

      const peek = yield* boards.read(threadId, "plan");
      expect({ board: peek.board, boards: peek.boards, changes: peek.changes }).toEqual({
        board: "Plan",
        boards: ["This thread", "Plan"],
        changes: null,
      });
      expect((yield* boards.read(threadId)).board).toBe("This thread");
      const unknown = yield* boards.read(threadId, "Plans").pipe(Effect.flip);
      expect(unknown.message).toBe(
        'No board is named "Plans". Boards: This thread, Plan. To start a new shared board, pass newBoard to whiteboard_edit.',
      );

      const drawn = yield* boards.edit(
        threadId,
        { board: "Plan" },
        { add: [{ type: "text", x: 0, y: 100, text: "next" }] },
      );
      expect({ board: drawn.board, revision: drawn.revision }).toEqual({
        board: "Plan",
        revision: 2,
      });
      expect((yield* boards.read(threadId)).board).toBe("Plan");
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();

      const invalid = yield* boards
        .edit(threadId, { newBoard: "Sketch" }, { remove: ["nope"] })
        .pipe(Effect.flip);
      expect(invalid._tag).toBe("WhiteboardEditRejected");
      const started = yield* boards.edit(
        threadId,
        { newBoard: "Sketch" },
        { add: [{ type: "rectangle", x: 0, y: 0, text: "First" }] },
      );
      expect(started.board).toBe("Sketch");
      expect((yield* boards.read(threadId, "This thread")).boards).toEqual([
        "This thread",
        "Plan",
        "Sketch",
      ]);
      expect((yield* boards.read(threadId)).board).toBe("Sketch");
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );
});
