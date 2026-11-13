import { describe, expect, it } from "@effect/vitest";
import { ThreadId, type WhiteboardStreamEvent } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import * as Whiteboards from "./Whiteboards.ts";

const threadId = ThreadId.make("thread-board");

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
  boards.save({ threadId, clientId: "window-a", elements: elements as never });

/** Collects `count` events, resuming the test only once the stream has subscribed. */
const collect = Effect.fn("test.collect")(function* (
  boards: Whiteboards.Whiteboards["Service"],
  count: number,
) {
  const subscribed = yield* Deferred.make<void>();
  const fiber = yield* boards.stream(threadId).pipe(
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
      expect(yield* boards.get(threadId)).toEqual({
        threadId,
        revision: 0,
        elements: [],
        files: {},
      });
      expect(yield* userSaves(boards, box("a", 1))).toEqual({ revision: 1 });
      expect(yield* userSaves(boards, box("a", 1))).toEqual({ revision: 1 });
      const image = { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" };
      expect(
        yield* boards.save({ threadId, clientId: "window-a", elements: [], files: { f1: image } }),
      ).toEqual({ revision: 2 });
      expect((yield* boards.get(threadId)).files).toEqual({ f1: image });
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );

  it.effect("streams the current scene, then the user's and the agent's changes", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      yield* userSaves(boards, box("a", 1));
      const fiber = yield* collect(boards, 3);
      yield* userSaves(boards, box("b", 1));
      yield* boards.edit(threadId, { add: [{ type: "text", x: 0, y: 0, text: "hello" }] });
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
      yield* boards.edit(threadId, {
        add: [{ type: "rectangle", id: "mine", x: 0, y: 0, text: "Agent box" }],
      });
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();

      yield* userSaves(boards, box("theirs", 1));
      yield* boards.edit(threadId, { update: [{ id: "mine", x: 40 }] });
      expect(yield* boards.takeUserChangeNote(threadId)).toContain("Added: rectangle (id theirs).");
      expect(yield* boards.takeUserChangeNote(threadId)).toBeNull();

      yield* userSaves(boards, box("theirs", 2, { x: 500 }));
      const view = yield* boards.read(threadId);
      expect(view.userChanges).toEqual({
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
      const error = yield* boards.edit(threadId, { remove: ["nope"] }).pipe(Effect.flip);
      expect(error.message).toBe('Nothing was changed. remove: no element has id "nope".');
      expect((yield* boards.get(threadId)).revision).toBe(0);
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
      yield* boards.submitSnapshot({ threadId, requestId: request.requestId, ...drawn });
      expect(yield* Fiber.join(picture)).toEqual(drawn);
    }).pipe(Effect.provide(Whiteboards.layerMemory)),
  );
});
