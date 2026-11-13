// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite plugins run before any Effect runtime.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite plugins run before any Effect runtime.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { Plugin } from "vite-plus";

const FONT_ROOT = NodeURL.fileURLToPath(
  new URL("../node_modules/@excalidraw/excalidraw/dist/prod/fonts", import.meta.url),
);
/** Must match `EXCALIDRAW_ASSET_PATH` in src/components/whiteboard/excalidrawAssets.ts. */
const ROUTE = "/excalidraw-assets/fonts/";
// 13 MB of CJK glyphs for the hand-drawn font; CJK text falls back to a system font without it.
const SKIPPED_FAMILIES = new Set(["Xiaolai"]);

function fontFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const family of NodeFS.readdirSync(FONT_ROOT)) {
    if (SKIPPED_FAMILIES.has(family)) continue;
    for (const file of NodeFS.readdirSync(NodePath.join(FONT_ROOT, family))) {
      if (file.endsWith(".woff2"))
        files.set(`${family}/${file}`, NodePath.join(FONT_ROOT, family, file));
    }
  }
  return files;
}

/**
 * Excalidraw fetches its fonts by fixed path at run time and otherwise falls back to a CDN, which
 * the desktop app's content policy blocks. This serves and ships them with the app.
 */
export function excalidrawFontsPlugin(): Plugin {
  return {
    name: "t3code:excalidraw-fonts",
    configureServer(server) {
      const files = fontFiles();
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?")[0] ?? "";
        if (!pathname.startsWith(ROUTE)) return next();
        const file = files.get(decodeURIComponent(pathname.slice(ROUTE.length)));
        if (file === undefined) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader("Content-Type", "font/woff2");
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        NodeFS.createReadStream(file).pipe(response);
      });
    },
    generateBundle() {
      for (const [name, file] of fontFiles()) {
        this.emitFile({
          type: "asset",
          fileName: `${ROUTE.slice(1)}${name}`,
          source: NodeFS.readFileSync(file),
        });
      }
    },
  };
}
