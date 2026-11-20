import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import * as Diagrams from "./Diagrams.ts";

describe("Diagrams", () => {
  it.effect("keeps drawio and drawnix directories and documents separate", () =>
    Effect.gen(function* () {
      const diagrams = yield* Diagrams.Diagrams;
      const threadId = ThreadId.make("thread-1");

      const drawioBoard = yield* diagrams.create({
        engine: "drawio",
        name: "Architecture",
        threadId,
      });
      const drawnixBoard = yield* diagrams.create({
        engine: "drawnix",
        name: "Architecture",
        threadId,
      });

      expect(drawioBoard.boardId).not.toBe(drawnixBoard.boardId);

      const drawioDir = yield* diagrams.directory("drawio").pipe(Stream.take(1), Stream.runCollect);
      const drawnixDir = yield* diagrams
        .directory("drawnix")
        .pipe(Stream.take(1), Stream.runCollect);

      expect(drawioDir[0]).toEqual({
        engine: "drawio",
        boards: [drawioBoard],
        selected: { [threadId]: drawioBoard.boardId },
      });
      expect(drawnixDir[0]).toEqual({
        engine: "drawnix",
        boards: [drawnixBoard],
        selected: { [threadId]: drawnixBoard.boardId },
      });

      const drawioDoc = yield* diagrams.get({ engine: "drawio", boardId: drawioBoard.boardId });
      const drawnixDoc = yield* diagrams.get({ engine: "drawnix", boardId: drawnixBoard.boardId });
      expect(drawioDoc.content).toBe(Diagrams.EMPTY_DRAWIO_XML);
      expect(drawnixDoc.content).toBe(Diagrams.EMPTY_DRAWNIX_JSON);
    }).pipe(Effect.provide(Diagrams.layerMemory)),
  );

  it.effect("saves edits, skips unchanged saves, and streams updates to subscribers", () =>
    Effect.gen(function* () {
      const diagrams = yield* Diagrams.Diagrams;
      const board = yield* diagrams.create({ engine: "drawio", name: "Flow" });

      const collector = yield* diagrams
        .stream({ engine: "drawio", boardId: board.boardId })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);

      yield* Effect.yieldNow;

      const updatedXml = Diagrams.EMPTY_DRAWIO_XML.replace("Page-1", "System");
      const firstSave = yield* diagrams.save({
        engine: "drawio",
        boardId: board.boardId,
        clientId: "win-1",
        content: updatedXml,
      });
      expect(firstSave.revision).toBe(1);

      const noopSave = yield* diagrams.save({
        engine: "drawio",
        boardId: board.boardId,
        clientId: "win-1",
        content: updatedXml,
      });
      expect(noopSave.revision).toBe(1);

      const events = yield* Fiber.join(collector);
      expect(events).toEqual([
        { revision: 0, content: Diagrams.EMPTY_DRAWIO_XML, clientId: null },
        { revision: 1, content: updatedXml, clientId: "win-1" },
      ]);
    }).pipe(Effect.provide(Diagrams.layerMemory)),
  );

  it.effect("supports auto-naming, duplicating, renaming, rejecting duplicates, and deleting", () =>
    Effect.gen(function* () {
      const diagrams = yield* Diagrams.Diagrams;
      const threadId = ThreadId.make("thread-a");

      const first = yield* diagrams.create({ engine: "drawnix", threadId });
      expect(first.name).toBe("Trace architecture");

      const second = yield* diagrams.create({ engine: "drawnix", threadId });
      expect(second.name).toBe("Trace architecture 2");

      const payload = JSON.stringify({
        type: "drawnix",
        version: 2,
        source: "t3code",
        elements: [{ id: "el-1", type: "geometry" }],
      });
      yield* diagrams.save({
        engine: "drawnix",
        boardId: first.boardId,
        clientId: "win-a",
        content: payload,
      });

      const copy = yield* diagrams.create({
        engine: "drawnix",
        name: "Copy",
        copyOf: first.boardId,
      });
      const copyDoc = yield* diagrams.get({ engine: "drawnix", boardId: copy.boardId });
      expect(copyDoc.content).toBe(payload);

      const collision = yield* diagrams
        .rename({ engine: "drawnix", boardId: copy.boardId, name: "trace architecture" })
        .pipe(Effect.flip);
      expect(collision._tag).toBe("DiagramBoardRejected");

      yield* diagrams.rename({ engine: "drawnix", boardId: copy.boardId, name: "Renamed" });
      yield* diagrams.select({ engine: "drawnix", threadId, boardId: copy.boardId });
      yield* diagrams.remove({ engine: "drawnix", boardId: copy.boardId });

      const dir = yield* diagrams.directory("drawnix").pipe(Stream.take(1), Stream.runCollect);
      const snapshot = dir[0]!;
      expect(snapshot.boards.map((b) => b.boardId)).toEqual([first.boardId, second.boardId]);
      expect(snapshot.selected[threadId]).toBeUndefined();
    }).pipe(
      Effect.provide(
        Diagrams.layerMemoryWith({ threadTitles: { "thread-a": "Trace architecture" } }),
      ),
    ),
  );
});
