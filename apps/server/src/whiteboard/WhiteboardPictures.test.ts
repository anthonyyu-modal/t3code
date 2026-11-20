import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as WhiteboardPictures from "./WhiteboardPictures.ts";
import * as Whiteboards from "./Whiteboards.ts";

const threadId = ThreadId.make("thread-board");
const serverDrawn = { mimeType: "image/png" as const, data: "SERVER", width: 8, height: 6 };
const windowDrawn = { mimeType: "image/png" as const, data: "WINDOW", width: 4, height: 3 };

const box = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  ...extra,
});

/** The picture service over boards in memory, with `draw` in place of the server's browser. */
const withDraw = (draw: Parameters<typeof WhiteboardPictures.layerWith>[0]) =>
  WhiteboardPictures.layerWith(draw).pipe(Layer.provideMerge(Whiteboards.layerMemory));

describe("WhiteboardPictures", () => {
  it.effect("draws the stored board on the server when no window shows it", () => {
    const scenes: Array<unknown> = [];
    return Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const pictures = yield* WhiteboardPictures.WhiteboardPictures;
      const { boardId } = yield* boards.create({ name: "Plan", threadId });
      const image = { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" };
      yield* boards.save({
        boardId,
        clientId: "window-a",
        elements: [box("a"), box("pasted", { type: "image", fileId: "f1" })] as never,
        files: { f1: image },
      });
      expect(yield* pictures.picture(threadId)).toEqual({
        ...serverDrawn,
        board: "Plan",
        revision: 1,
      });
      expect(scenes).toEqual([
        {
          elements: [box("a"), box("pasted", { type: "image", fileId: "f1" })],
          files: { f1: image },
        },
      ]);
    }).pipe(
      Effect.provide(
        withDraw((scene) =>
          Effect.sync(() => void scenes.push(scene)).pipe(Effect.as(serverDrawn)),
        ),
      ),
    );
  });

  it.effect("leaves the drawing to a window that shows the board", () => {
    let serverDrew = false;
    return Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const pictures = yield* WhiteboardPictures.WhiteboardPictures;
      const { boardId } = yield* boards.create({ name: "Plan", threadId });
      yield* boards.save({ boardId, clientId: "window-a", elements: [box("a")] as never });
      const subscribed = yield* Deferred.make<void>();
      const tab = yield* boards.stream(boardId).pipe(
        Stream.tap(() => Deferred.succeed(subscribed, undefined)),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(subscribed);
      const picture = yield* pictures.picture(threadId).pipe(Effect.forkChild);
      const request = (yield* Fiber.join(tab))[1];
      if (request?.type !== "snapshot-request") throw new Error("expected a picture request");
      yield* boards.submitSnapshot({ requestId: request.requestId, ...windowDrawn });
      expect(yield* Fiber.join(picture)).toEqual({ ...windowDrawn, board: "Plan", revision: 1 });
      expect(serverDrew).toBe(false);
    }).pipe(
      Effect.provide(
        withDraw(() => Effect.sync(() => void (serverDrew = true)).pipe(Effect.as(serverDrawn))),
      ),
    );
  });

  it.effect("says what the host lacks when the server cannot draw either", () =>
    Effect.gen(function* () {
      const boards = yield* Whiteboards.Whiteboards;
      const pictures = yield* WhiteboardPictures.WhiteboardPictures;
      const { boardId } = yield* boards.create({ name: "Plan", threadId });
      yield* boards.save({ boardId, clientId: "window-a", elements: [box("a")] as never });
      expect((yield* pictures.picture(threadId).pipe(Effect.flip)).message).toBe(
        "No window drew this board, and the server could not draw it either. This host is missing libraries T3's browser needs (libnss3.so). Run `sudo t3 browser setup` on the host to install them, then try again. Use whiteboard_read for the board's contents as data.",
      );
    }).pipe(
      Effect.provide(
        withDraw(() =>
          Effect.fail(
            new WhiteboardPictures.WhiteboardNotDrawn({
              reason:
                "This host is missing libraries T3's browser needs (libnss3.so). Run `sudo t3 browser setup` on the host to install them, then try again.",
            }),
          ),
        ),
      ),
    ),
  );

  it("sends the drawing page what is on the board now, and only the images that shows", () => {
    const image = { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" };
    const shown = box("shown", { type: "image", fileId: "kept" });
    expect(
      WhiteboardPictures.pageScene({
        elements: [
          box("a"),
          shown,
          box("erased", { isDeleted: true }),
          box("erased-image", { type: "image", fileId: "gone", isDeleted: true }),
          box("lost", { type: "image", fileId: "never-saved" }),
        ],
        files: { kept: image, gone: image, unused: image },
      }),
    ).toEqual({
      elements: [box("a"), shown, box("lost", { type: "image", fileId: "never-saved" })],
      files: { kept: image },
    });
  });

  it("answers the drawing page from the client's files and nothing else", () => {
    const client = { origin: "http://t3-whiteboard.localhost", directory: "/srv/t3/client" };
    const answer = (url: string) => WhiteboardPictures.answerPageRequest(client, url);
    expect(answer("http://t3-whiteboard.localhost/whiteboard-picture.html")).toEqual({
      _tag: "file",
      file: "/srv/t3/client/whiteboard-picture.html",
    });
    expect(
      answer("http://t3-whiteboard.localhost/excalidraw-assets/fonts/Comic%20Shanns/a.woff2?v=1"),
    ).toEqual({
      _tag: "file",
      file: "/srv/t3/client/excalidraw-assets/fonts/Comic Shanns/a.woff2",
    });
    // However a path climbs, it stays inside the client's folder or gets nothing.
    expect(answer("http://t3-whiteboard.localhost/%2e%2e/%2e%2e/etc/passwd")).toEqual({
      _tag: "file",
      file: "/srv/t3/client/etc/passwd",
    });
    // The CDN Excalidraw turns to for a missing font, a remote image, and the host's own files.
    for (const url of [
      "https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/fonts/Xiaolai/x.woff2",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:3773/api/whatever",
      "http://t3-whiteboard.localhost/..%2f..%2fsecrets.json",
      "http://t3-whiteboard.localhost/%E0%A4%A",
      "file:///etc/passwd",
    ]) {
      expect(answer(url), url).toEqual({ _tag: "refuse" });
    }
    // A dev server has no built client, so it answers its own origin and still nothing else.
    const dev = { origin: "http://localhost:5733", directory: null };
    expect(
      WhiteboardPictures.answerPageRequest(dev, "http://localhost:5733/src/whiteboardPicture.ts"),
    ).toEqual({ _tag: "pass" });
    expect(WhiteboardPictures.answerPageRequest(dev, "https://esm.sh/x.woff2")).toEqual({
      _tag: "refuse",
    });
  });
});
