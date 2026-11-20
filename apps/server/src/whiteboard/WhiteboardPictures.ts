// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Playwright loads from disk and runs outside the Effect runtime.
import type {
  ThreadId,
  WhiteboardEngine,
  WhiteboardElement,
  WhiteboardError,
  WhiteboardFiles,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { constVoid } from "effect/Function";
import * as Mime from "effect/http/Mime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import type { Browser, Route } from "playwright-core";

import { resolveRootCliCommand } from "../cli/invocation.ts";
import * as ServerConfig from "../config.ts";
import * as PreviewBrowser from "../preview/PreviewBrowser.ts";
import * as PreviewBrowserHost from "../preview/PreviewBrowserHost.ts";
import * as Whiteboards from "./Whiteboards.ts";

// Playwright needs its files on disk. createRequire also resolves it from a Node SEA executable.
const requirePlaywright = NodeModule.createRequire(import.meta.url);
const loadPlaywright = () =>
  requirePlaywright("playwright-core") as typeof import("playwright-core");

/** The page of the web client that draws a board: apps/web/src/whiteboardPicture.ts. */
const PAGE = "whiteboard-picture.html";
// Never looked up: every request to it is answered from the client's files on disk.
const LOCAL_ORIGIN = "http://t3-whiteboard.localhost";
// An agent's tool call is given up on at 60 seconds, and a window may have been waited on first.
const INSTALL_WAIT = "20 seconds";
const DRAW_TIMEOUT = "15 seconds";
const LAUNCH_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 3_000;

const Picture = Schema.Struct({
  mimeType: Schema.Literal("image/png"),
  data: Schema.String.check(Schema.isMinLength(1)),
  width: Schema.Int,
  height: Schema.Int,
});
const decodePicture = Schema.decodeUnknownEffect(Picture);

/** Why the server did not draw a board, in words the agent that asked for the picture can act on. */
export class WhiteboardNotDrawn extends Schema.TaggedError<WhiteboardNotDrawn>()(
  "WhiteboardNotDrawn",
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message() {
    return this.reason;
  }
}

interface Scene {
  readonly engine?: WhiteboardEngine | undefined;
  readonly elements: ReadonlyArray<WhiteboardElement>;
  readonly files: WhiteboardFiles;
}

/** What apps/web/src/whiteboardPicture.ts puts on its window. */
interface DrawingPage {
  readonly drawWhiteboard: (scene: Scene) => Promise<unknown>;
}

type Draw = (scene: Scene) => Effect.Effect<Whiteboards.WhiteboardPicture, WhiteboardNotDrawn>;

export class WhiteboardPictures extends Context.Service<
  WhiteboardPictures,
  {
    /**
     * A board as a PNG for an agent. A window that shows the board draws it; when none does, the
     * server draws the board it has stored.
     */
    readonly picture: (
      threadId: ThreadId,
      board?: string,
    ) => Effect.Effect<
      Whiteboards.WhiteboardPicture & { readonly board: string; readonly revision: number },
      | WhiteboardError
      | Whiteboards.WhiteboardUnknownBoard
      | Whiteboards.WhiteboardPictureUnavailable
    >;
  }
>()("t3/whiteboard/WhiteboardPictures") {}

/** Where the drawing page's files are: the client built beside the server, or a dev server. */
interface PageSource {
  readonly origin: string;
  /** Null for a dev server, which answers the page's requests itself. */
  readonly directory: string | null;
}

/**
 * What a request from the drawing page gets: a file of the client, the dev server's answer, or
 * nothing. A board's links, embeds and remote images get nothing, and so does the CDN Excalidraw
 * turns to for a font the client does not ship.
 */
export const answerPageRequest = (source: PageSource, requestUrl: string) => {
  const url = URL.parse(requestUrl);
  if (url === null || url.origin !== source.origin) return { _tag: "refuse" } as const;
  if (source.directory === null) return { _tag: "pass" } as const;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return { _tag: "refuse" } as const;
  }
  const file = NodePath.join(source.directory, pathname);
  return file.startsWith(`${source.directory}${NodePath.sep}`) && !file.includes("\0")
    ? ({ _tag: "file", file } as const)
    : ({ _tag: "refuse" } as const);
};

const answer = (source: PageSource) => async (route: Route) => {
  const response = answerPageRequest(source, route.request().url());
  if (response._tag === "refuse") return route.abort("blockedbyclient");
  if (response._tag === "pass") return route.continue();
  const body = await NodeFSP.readFile(response.file).catch(() => null);
  return body === null
    ? route.fulfill({ status: 404 })
    : route.fulfill({
        body,
        contentType: Option.getOrElse(
          Mime.getType(response.file),
          () => "application/octet-stream",
        ),
      });
};

/** What the page is sent: live elements, and only the images they show, not every one ever pasted. */
export const pageScene = (scene: Scene): Scene => {
  const liveElements = scene.elements.filter((element) => element.isDeleted !== true);
  const assetIds = new Set(
    liveElements.flatMap((element) => {
      const assetId = (element.props as { assetId?: unknown } | undefined)?.assetId;
      return typeof assetId === "string" ? [assetId] : [];
    }),
  );
  const elements = liveElements.filter(
    (element) => element.typeName !== "asset" || assetIds.has(String(element.id)),
  );
  const fileIds = elements.flatMap((element) => {
    if (element.typeName === "asset" && typeof element.id === "string") return [element.id];
    return typeof element.fileId === "string" ? [element.fileId] : [];
  });
  return {
    ...(scene.engine === undefined ? {} : { engine: scene.engine }),
    elements,
    files: Object.fromEntries(
      fileIds.flatMap((fileId) => {
        const file = scene.files[fileId];
        return file === undefined ? [] : [[fileId, file] as const];
      }),
    ),
  };
};

/** The first line of a Playwright error, which is the part that says what went wrong. */
const firstLine = (cause: unknown) =>
  (cause instanceof Error ? cause.message : String(cause))
    .split("\n", 1)[0]!
    .slice(0, 300)
    .replace(/[.\s]+$/, "");

/**
 * Draws a board in the headless browser T3 installs for itself, on the page of the web client
 * that runs the same Excalidraw export a window runs. The browser lives for one drawing.
 */
const makeDraw = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const previewBrowser = yield* PreviewBrowser.PreviewBrowser;
  const launchServices = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
  const sandboxed = !PreviewBrowserHost.sandboxDisabled(yield* HostProcess.Environment);
  // sudo resets the environment, so the command has to name this server's home.
  const setupCommand = yield* resolveRootCliCommand(PreviewBrowserHost.SETUP_SUBCOMMAND, [
    "--base-dir",
    config.baseDir,
  ]);
  const directory =
    config.staticDir ?? (config.devUrl ? yield* ServerConfig.resolveStaticDir() : undefined);
  const source: PageSource | null =
    directory !== undefined
      ? { origin: LOCAL_ORIGIN, directory: NodePath.resolve(directory) }
      : config.devUrl !== undefined
        ? { origin: config.devUrl.origin, directory: null }
        : null;
  // One browser at a time: a drawing takes under a second, and a second browser its own memory.
  const turn = yield* Semaphore.make(1);

  const executable = previewBrowser.executable.pipe(
    Effect.mapError((error) => new WhiteboardNotDrawn({ reason: error.message, cause: error })),
    Effect.timeoutOrElse({
      duration: INSTALL_WAIT,
      orElse: () =>
        Effect.fail(
          new WhiteboardNotDrawn({
            reason: "T3 is installing its headless browser. Try again in a minute.",
          }),
        ),
    }),
  );

  const launch = (executablePath: string) =>
    Effect.tryPromise({
      try: async () => {
        const browser = await loadPlaywright().chromium.launch({
          executablePath,
          headless: true,
          // Only an explicit operator opt-out disables sandboxing. Launch errors never do.
          chromiumSandbox: sandboxed,
          args: ["--disable-gpu"],
          timeout: LAUNCH_TIMEOUT_MS,
        });
        // Without its process id the browser can still be asked to quit, only not made to.
        const pid = await browser
          .newBrowserCDPSession()
          .then((session) => session.send("SystemInfo.getProcessInfo"))
          .then(
            ({ processInfo }) => processInfo.find((process) => process.type === "browser")?.id,
            () => undefined,
          );
        return { browser, pid };
      },
      catch: (cause) =>
        new WhiteboardNotDrawn({
          reason: `T3's headless browser did not start: ${firstLine(cause)}.`,
          cause,
        }),
    }).pipe(
      // Playwright's launch error drops Chrome's own output; its sandbox note survives.
      Effect.catch((failed) =>
        PreviewBrowserHost.diagnoseLaunchFailure({
          executable: executablePath,
          setupCommand,
          output: /sandboxing failed/i.test(String(failed.cause))
            ? PreviewBrowserHost.NO_SANDBOX_SIGNATURE
            : "",
        }).pipe(
          Effect.provideContext(launchServices),
          Effect.flatMap((hostError) =>
            Effect.fail(
              hostError === undefined
                ? failed
                : new WhiteboardNotDrawn({ reason: hostError.message, cause: failed.cause }),
            ),
          ),
        ),
      ),
    );

  // A browser that does not quit when asked is killed, so none outlives its drawing.
  const close = ({
    browser,
    pid,
  }: {
    readonly browser: Browser;
    readonly pid: number | undefined;
  }) =>
    Effect.promise(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const quit = await Promise.race([
        browser.close().then(() => true, constVoid),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), CLOSE_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);
      if (quit !== false || pid === undefined) return;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // It quit in the meantime.
      }
    });

  const drawIn = (browser: Browser, source: PageSource, scene: Scene) =>
    Effect.tryPromise({
      try: async () => {
        const context = await browser.newContext({ serviceWorkers: "block" });
        await context.route("**/*", answer(source));
        const page = await context.newPage();
        const response = await page.goto(`${source.origin}/${PAGE}`);
        if (response === null || !response.ok()) {
          throw new Error(`this server's web client has no ${PAGE}`);
        }
        // A dev server may reload the page once while it prepares Excalidraw.
        await page.waitForFunction("typeof window.drawWhiteboard === 'function'");
        return await page.evaluate(
          (scene) => (globalThis as unknown as DrawingPage).drawWhiteboard(scene),
          pageScene(scene),
        );
      },
      catch: (cause) =>
        new WhiteboardNotDrawn({
          reason: `T3's headless browser could not draw the board: ${firstLine(cause)}.`,
          cause,
        }),
    }).pipe(
      Effect.flatMap((picture) =>
        decodePicture(picture).pipe(
          Effect.mapError(
            (cause) =>
              new WhiteboardNotDrawn({
                reason: "T3's headless browser drew something other than a picture.",
                cause,
              }),
          ),
        ),
      ),
    );

  const draw: Draw = Effect.fn("WhiteboardPictures.draw")(function* (scene) {
    if (source === null) {
      return yield* new WhiteboardNotDrawn({
        reason: "This T3 server has no web client to draw the board with.",
      });
    }
    const executablePath = yield* executable;
    return yield* Effect.acquireUseRelease(
      launch(executablePath),
      ({ browser }) => drawIn(browser, source, scene),
      close,
    ).pipe(
      turn.withPermits(1),
      Effect.timeoutOrElse({
        duration: DRAW_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new WhiteboardNotDrawn({
              reason: `T3's headless browser did not draw the board within ${DRAW_TIMEOUT}.`,
            }),
          ),
      }),
    );
  });

  return draw;
});

const makeWith = Effect.fn("WhiteboardPictures.make")(function* (draw: Draw) {
  const whiteboards = yield* Whiteboards.Whiteboards;

  const picture: WhiteboardPictures["Service"]["picture"] = Effect.fn("WhiteboardPictures.picture")(
    function* (threadId, name) {
      // A window goes first: it draws what the user sees, and the server need start no browser.
      const { board, engine, revision, elements, files, picture } =
        yield* whiteboards.windowPicture(threadId, name);
      const drawn =
        picture ??
        (yield* draw({ engine, elements, files }).pipe(
          Effect.mapError(
            (error) =>
              new Whiteboards.WhiteboardPictureUnavailable({
                reason: "not-drawn",
                detail: error.message,
              }),
          ),
        ));
      return { ...drawn, board, revision };
    },
  );

  return WhiteboardPictures.of({ picture });
});

export const layer = Layer.effect(WhiteboardPictures, Effect.flatMap(makeDraw, makeWith));

/** For tests, which have no browser: `draw` stands in for the server's own drawing. */
export const layerWith = (draw: Draw) => Layer.effect(WhiteboardPictures, makeWith(draw));
