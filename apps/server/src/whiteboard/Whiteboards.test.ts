import { describe, expect, it } from "@effect/vitest";
import { ThreadId, type WhiteboardStreamEvent } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as Whiteboards from "./Whiteboards.ts";

const threadId = ThreadId.make("thread-board");
const otherThreadId = ThreadId.make("thread-other");

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

const userSaves = (
  boards: Whiteboards.Whiteboards["Service"],
  boardId: string,
  ...elements: Array<object>
) => boards.save({ boardId, clientId: "window-a", elements: elements as never });

/** Collects `count` events, resuming the test only once the stream has subscribed. */
const collect = Effect.fn("test.collect")(function* (
  boards: Whiteboards.Whiteboards["Service"],
  boardId: string,
  count: number,
) {
  const subscribed = yield* Deferred.make<void>();
  const fiber = yield* boards.stream(boardId).pipe(
    Stream.tap(() => Deferred.succeed(subscribed, undefined)),
    Stream.take(count),
    Stream.runCollect,
    Effect.forkChild,
  );
  yield* Deferred.await(subscribed);
  return fiber;
});

const directoryNow = (boards: Whiteboards.Whiteboards["Service"]) =>
  Stream.runHead(boards.directory).pipe(Effect.map(Option.getOrThrow));

const scenes = (events: ReadonlyArray<WhiteboardStreamEvent>) =>
  events.flatMap((event) =>
    event.type === "scene"
      ? [{ revision: event.revision, editor: event.editor, clientId: event.clientId }]
      : [],
  );

/** A board's file from when each thread kept one to itself. */
const threadBoard = (...elements: Array<object>) =>
  JSON.stringify({ revision: 1, elements, files: {}, agentSeen: null });

const titled = Whiteboards.layerMemoryWith({
  threadTitles: { [threadId]: "Request flow", [otherThreadId]: "Request flow" },
});

describe("Whiteboards", () => {
  it.effect("merges a window's save and only counts a revision when something changed", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const { boardId } = yield* boards.create({ name: "Plan", engine: "excalidraw" });
      expect(yield* boards.get(boardId)).toEqual({
        boardId,
        engine: "excalidraw",
        revision: 0,
        elements: [],
        files: {},
      });
      expect(yield* userSaves(boards, boardId, box("a", 1))).toEqual({ revision: 1 });
      expect(yield* userSaves(boards, boardId, box("a", 1))).toEqual({ revision: 1 });
      const image = { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" };
      expect(
        yield* boards.save({ boardId, clientId: "window-a", elements: [], files: { f1: image } }),
      ).toEqual({ revision: 2 });
      expect((yield* boards.get(boardId)).files).toEqual({ f1: image });
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect("creates native tldraw boards while preserving Excalidraw as an explicit choice", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const native = yield* boards.create({ name: "Native", threadId });
      expect(native.engine).toBe("tldraw");
      expect(yield* boards.get(native.boardId)).toMatchObject({
        engine: "tldraw",
        revision: 0,
      });
      expect(
        (yield* boards.get(native.boardId)).elements.map((element) => element.typeName),
      ).toEqual(["document", "page"]);
      yield* boards.edit(
        threadId,
        {},
        { add: [{ type: "rectangle", id: "native-box", x: 20, y: 30, text: "Native" }] },
      );
      expect(yield* boards.read(threadId)).toMatchObject({
        engine: "tldraw",
        elements: [{ id: "native-box", type: "rectangle", x: 20, y: 30, text: "Native" }],
      });
      const legacy = yield* boards.create({ name: "Legacy", engine: "excalidraw" });
      expect((yield* boards.get(legacy.boardId)).elements).toEqual([]);
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect("streams the current scene, then the user's and the agent's changes", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const { boardId } = yield* boards.create({ name: "Plan", threadId, engine: "excalidraw" });
      yield* userSaves(boards, boardId, box("a", 1));
      const fiber = yield* collect(boards, boardId, 3);
      yield* userSaves(boards, boardId, box("b", 1));
      yield* boards.edit(threadId, {}, { add: [{ type: "text", x: 0, y: 0, text: "hello" }] });
      expect(scenes(yield* Fiber.join(fiber))).toEqual([
        { revision: 1, editor: null, clientId: null },
        { revision: 2, editor: "user", clientId: "window-a" },
        { revision: 3, editor: "agent", clientId: null },
      ]);
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect(
    "starts a board named after the thread when an agent draws in a thread without one",
    () =>
      Effect.gen(function* () {
        const boards = yield* Whiteboards.Whiteboards;
        expect(yield* boards.read(threadId)).toEqual({
          board: null,
          engine: null,
          boards: [],
          revision: 0,
          elements: [],
          changes: null,
        });
        expect((yield* boards.windowPicture(threadId).pipe(Effect.flip)).message).toBe(
          "This thread's Whiteboard tab shows no board. Name one with board.",
        );
        const invalid = yield* boards.edit(threadId, {}, { remove: ["nope"] }).pipe(Effect.flip);
        expect(invalid.message).toBe('Nothing was changed. remove: no element has id "nope".');
        expect((yield* boards.read(threadId)).boards).toEqual([]);

        const drawn = yield* boards.edit(
          threadId,
          {},
          { add: [{ type: "rectangle", id: "mine", x: 0, y: 0, text: "Agent box" }] },
        );
        expect({ board: drawn.board, revision: drawn.revision }).toEqual({
          board: "Request flow",
          revision: 1,
        });
        // A second thread with the same title gets a name of its own, and sees the first one's board.
        const other = yield* boards.edit(
          otherThreadId,
          {},
          { add: [{ type: "text", x: 0, y: 0, text: "hello" }] },
        );
        expect(other.board).toBe("Request flow 2");
        const view = yield* boards.read(otherThreadId, "request flow");
        expect({
          board: view.board,
          boards: view.boards,
          ids: view.elements.map((e) => e.id),
        }).toEqual({
          board: "Request flow",
          boards: ["Request flow", "Request flow 2"],
          ids: ["mine"],
        });
        const longName = yield* boards
          .edit(threadId, { newBoard: "x".repeat(61) }, { add: [] })
          .pipe(Effect.flip);
        expect(longName.message).toBe(
          "Nothing was changed. newBoard: a board's name has 1 to 60 characters.",
        );
      }).pipe(Effect.provide(titled)),
  );

  it.effect("tells the agent once what the user changed, and not about its own edits", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();
      yield* boards.create({ name: "Plan", threadId, engine: "excalidraw" });
      yield* boards.edit(
        threadId,
        {},
        { add: [{ type: "rectangle", id: "mine", x: 0, y: 0, text: "Agent box" }] },
      );
      const planId = (yield* directoryNow(boards)).selected[threadId]!;
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();

      yield* userSaves(boards, planId, box("theirs", 1));
      yield* boards.edit(threadId, {}, { update: [{ id: "mine", x: 40 }] });
      expect(yield* boards.takeUserChangeNote(threadId)).toContain("Added: rectangle (id theirs).");
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();

      yield* userSaves(boards, planId, box("theirs", 2, { x: 500 }));
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

  it.effect(
    "gets a picture from a window that shows the board, and the board when none draws",
    () =>
      Effect.gen(function* () {
        const boards = yield* Whiteboards.Whiteboards;
        const { boardId } = yield* boards.create({ name: "Plan", threadId, engine: "excalidraw" });
        const unavailable = (yield* boards.windowPicture(threadId).pipe(Effect.flip)) as {
          readonly reason?: string;
        };
        expect(unavailable.reason).toBe("empty");
        yield* userSaves(boards, boardId, box("a", 1));
        const board = {
          board: "Plan",
          engine: "excalidraw",
          revision: 1,
          elements: [box("a", 1)],
          files: {},
        };
        expect(yield* boards.windowPicture(threadId)).toEqual({ ...board, picture: null });

        const tab = yield* collect(boards, boardId, 2);
        const answered = yield* boards.windowPicture(threadId).pipe(Effect.forkChild);
        const request = (yield* Fiber.join(tab))[1];
        if (request?.type !== "snapshot-request") throw new Error("expected a picture request");
        const drawn = { mimeType: "image/png" as const, data: "AAAA", width: 4, height: 3 };
        yield* boards.submitSnapshot({ requestId: request.requestId, ...drawn });
        expect(yield* Fiber.join(answered)).toEqual({ ...board, picture: drawn });

        // A window that never answers, such as one on a sleeping laptop, is not waited on for long.
        const asleep = yield* collect(boards, boardId, 2);
        const unanswered = yield* boards.windowPicture(threadId).pipe(Effect.forkChild);
        yield* Fiber.join(asleep);
        yield* userSaves(boards, boardId, box("b", 1));
        yield* TestClock.adjust("5 seconds");
        expect(yield* Fiber.join(unanswered)).toEqual({
          ...board,
          revision: 2,
          elements: [box("a", 1), box("b", 1)],
          picture: null,
        });
      }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect("keeps boards that any thread can show, and copies one board into another", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const subscribed = yield* Deferred.make<void>();
      const directory = yield* boards.directory.pipe(
        Stream.tap(() => Deferred.succeed(subscribed, undefined)),
        Stream.take(5),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(subscribed);
      // Started from a thread without a name, a board is named after that thread.
      const first = yield* boards.create({ threadId, engine: "excalidraw" });
      expect(first.name).toBe("Request flow");
      yield* userSaves(boards, first.boardId, box("a", 1), box("gone", 2, { isDeleted: true }));
      const plan = yield* boards.create({
        name: "Plan",
        copyOf: first.boardId,
        threadId,
        engine: "excalidraw",
      });
      expect((yield* boards.get(plan.boardId)).elements).toEqual([box("a", 1)]);
      const taken = yield* boards.create({ name: "plan", engine: "excalidraw" }).pipe(Effect.flip);
      expect(taken.message).toBe('A board named "plan" already exists.');

      yield* boards.rename({ boardId: plan.boardId, name: "Roadmap" });
      yield* boards.select({ threadId: otherThreadId, boardId: plan.boardId });
      yield* boards.remove({ boardId: plan.boardId });
      expect(yield* Fiber.join(directory)).toEqual([
        { boards: [], selected: {} },
        { boards: [first], selected: { [threadId]: first.boardId } },
        { boards: [first, plan], selected: { [threadId]: plan.boardId } },
        {
          boards: [first, { ...plan, name: "Roadmap" }],
          selected: { [threadId]: plan.boardId },
        },
        {
          boards: [first, { ...plan, name: "Roadmap" }],
          selected: { [threadId]: plan.boardId, [otherThreadId]: plan.boardId },
        },
      ]);
      const missing = yield* boards.get(plan.boardId).pipe(Effect.flip);
      expect(missing.message).toBe(`There is no board "${plan.boardId}".`);
      // Deleting the board a thread showed leaves that thread with none, and its agent is told.
      expect(yield* boards.takeUserChangeNote(threadId)).toBe(
        [
          "The board this thread's Whiteboard tab showed was deleted, so the tab shows no board now.",
          "whiteboard_edit starts a new board, or draws on one you name with board.",
        ].join("\n"),
      );
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();
      expect((yield* boards.read(threadId)).board).toBeNull();
    }).pipe(Effect.provide(titled)),
  );

  it.effect("notes a board's changes only for threads whose tab shows it", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const plan = yield* boards.create({ name: "Plan", threadId, engine: "excalidraw" });
      const sketch = yield* boards.create({ name: "Sketch", engine: "excalidraw" });
      expect(yield* boards.takeUserChangeNote(threadId)).toBe(
        [
          'This thread\'s Whiteboard tab now shows the board "Plan" (revision 0). It is empty.',
          "The whiteboard tools now act on this board. Call whiteboard_read before you draw on it.",
        ].join("\n"),
      );

      yield* userSaves(boards, plan.boardId, box("a", 1));
      expect(yield* boards.takeUserChangeNote(otherThreadId)).toBeNull();
      expect(yield* boards.takeUserChangeNote(threadId)).toBe(
        [
          'The whiteboard "Plan", which this thread\'s Whiteboard tab shows, changed since you last saw it (now revision 1).',
          "Added: rectangle (id a).",
          "Call whiteboard_read for the whole board, or whiteboard_view for a picture of it.",
        ].join("\n"),
      );
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();

      // Another thread's agent draws on it: this thread hears of that too, once it is back on the board.
      yield* boards.select({ threadId, boardId: sketch.boardId });
      yield* boards.takeUserChangeNote(threadId);
      yield* boards.edit(otherThreadId, { board: "plan" }, { update: [{ id: "a", x: 300 }] });
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();
      yield* boards.select({ threadId, boardId: plan.boardId });
      yield* boards.takeUserChangeNote(threadId);
      yield* userSaves(boards, plan.boardId, box("b", 1));
      expect(yield* boards.takeUserChangeNote(threadId)).toContain("Added: rectangle (id b).");
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect("lets an agent name a board, and moves its thread's tab to where it draws", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const plan = yield* boards.create({ name: "Plan", engine: "excalidraw" });
      yield* userSaves(boards, plan.boardId, box("a", 1));

      const peek = yield* boards.read(threadId, "plan");
      expect({ board: peek.board, boards: peek.boards, changes: peek.changes }).toEqual({
        board: "Plan",
        boards: ["Plan"],
        changes: null,
      });
      expect((yield* boards.read(threadId)).board).toBeNull();
      const unknown = yield* boards.read(threadId, "Plans").pipe(Effect.flip);
      expect(unknown.message).toBe(
        'No board is named "Plans". Boards: Plan. To start a new board, pass newBoard to whiteboard_edit.',
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
      const now = yield* boards.read(threadId);
      expect({ board: now.board, boards: now.boards }).toEqual({
        board: "Sketch",
        boards: ["Plan", "Sketch"],
      });
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect(
    "turns the boards threads once kept to themselves into boards every thread can open",
    () =>
      Effect.gen(function* () {
        const boards = yield* Whiteboards.Whiteboards;
        const directory = yield* directoryNow(boards);
        const named = (name: string) =>
          directory.boards.find((board) => board.name === name)?.boardId ?? `no board "${name}"`;
        // An empty board is not kept, and one a cut-short move already listed is not listed twice.
        expect(directory.boards.map((board) => board.name)).toEqual([
          "Kept",
          "Done",
          "Launched",
          "Request flow",
          "Board",
          "Kept 2",
        ]);
        // A thread that had chosen another board stays on it; its old board is in the list.
        expect(directory.selected).toEqual({
          "thread-other": "kept",
          "mcp:launched": named("Launched"),
          "thread-board": named("Request flow"),
          "thread-gone": named("Board"),
        });
        expect((yield* boards.get(named("Request flow"))).elements).toEqual([box("a", 1)]);
        // The thread's agent had seen its board, so only what changed since is news to it.
        expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();
        yield* userSaves(boards, named("Request flow"), box("b", 1));
        expect(yield* boards.takeUserChangeNote(threadId)).toContain("Added: rectangle (id b).");
      }).pipe(
        Effect.provide(
          Whiteboards.layerMemoryWith({
            threadTitles: {
              [threadId]: "Request flow",
              [otherThreadId]: "Kept",
              "mcp:launched": "Launched",
            },
            files: {
              "shared/index.json": JSON.stringify({
                boards: [
                  { boardId: "kept", name: "Kept" },
                  // The id a move gave thread-done.json's board before it was cut short.
                  { boardId: "b2453b88361e0364d130741f46e529ee", name: "Done" },
                ],
                selected: { "thread-other": "kept" },
                unannounced: [],
              }),
              "shared/kept.json": JSON.stringify({
                revision: 0,
                elements: [],
                files: {},
                agentSeen: null,
              }),
              "thread-done.json": threadBoard(box("f", 1)),
              "mcp_launched.json": threadBoard(box("g", 1)),
              "thread-board.json": JSON.stringify({
                revision: 3,
                elements: [box("a", 1)],
                files: {},
                agentSeen: { a: 1 },
              }),
              "thread-gone.json": threadBoard(box("d", 1)),
              "thread-other.json": threadBoard(box("c", 1)),
              "thread-empty.json": threadBoard(box("e", 2, { isDeleted: true })),
            },
          }),
        ),
      ),
  );
});
