// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite plugins run before any Effect runtime.
import * as NodeCrypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite plugins run before any Effect runtime.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite plugins run before any Effect runtime.
import * as NodeFSP from "node:fs/promises";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite plugins run before any Effect runtime.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import JSZip from "jszip";
import type { Plugin } from "vite-plus";

const DRAWIO_VERSION = "32.7.4";
const DRAWIO_WAR_URL = `https://github.com/jgraph/drawio/releases/download/v${DRAWIO_VERSION}/draw.war`;
const DRAWIO_WAR_SHA256 = "caf784637155f444e0b6fb7c154cae5dbad27cfc31cb16286054d43f996be42f";

/** Must match `DRAWIO_ASSET_ROUTE` in src/components/diagram/drawioAssets.ts. */
const ROUTE = "/drawio-assets/";
const CACHE_ROOT = NodeURL.fileURLToPath(
  new URL(`../node_modules/.cache/t3code-drawio-${DRAWIO_VERSION}`, import.meta.url),
);
const READY_MARKER = NodePath.join(CACHE_ROOT, ".ready");

const INCLUDED_FILES = new Set([
  "index.html",
  "favicon.ico",
  "shortcuts.svg",
  "export-fonts.css",
  "resources/dia.txt",
  "js/PreConfig.js",
  "js/PostConfig.js",
  "js/bootstrap.js",
  "js/main.js",
  "js/app.min.js",
  "js/shapes-14-6-5.min.js",
  "js/stencils.min.js",
  "js/extensions.min.js",
  "js/orgchart.min.js",
  "js/export.js",
  "js/export-init.js",
]);

const INCLUDED_PREFIXES = [
  "styles/",
  "images/",
  "img/",
  "stencils/",
  "mxgraph/css/",
  "mxgraph/images/",
  "js/deflate/",
  "js/sanitizer/",
  "js/rough/",
  "js/libavoid-js/",
  "js/elk/",
  "js/mermaid/",
  "js/plantuml/",
];

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

function shouldIncludeEntry(entryName: string): boolean {
  if (entryName.endsWith("/") || entryName.endsWith(".map")) return false;
  if (INCLUDED_FILES.has(entryName)) return true;
  return INCLUDED_PREFIXES.some((prefix) => entryName.startsWith(prefix));
}

async function readWarBytes(): Promise<Uint8Array> {
  const localPath = process.env.T3CODE_DRAWIO_WAR?.trim();
  if (localPath) {
    return new Uint8Array(await NodeFSP.readFile(localPath));
  }
  const response = await fetch(DRAWIO_WAR_URL);
  if (!response.ok) {
    throw new Error(`Failed to download draw.io ${DRAWIO_VERSION}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

let preparePromise: Promise<string> | null = null;

async function ensureDrawioAssets(): Promise<string> {
  try {
    const marker = (await NodeFSP.readFile(READY_MARKER, "utf8")).trim();
    if (marker === DRAWIO_WAR_SHA256) return CACHE_ROOT;
  } catch {
    // Cache absent or incomplete; extract below.
  }

  const bytes = await readWarBytes();
  const actualSha = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
  if (actualSha !== DRAWIO_WAR_SHA256) {
    throw new Error(
      `draw.io ${DRAWIO_VERSION} checksum mismatch: expected ${DRAWIO_WAR_SHA256}, got ${actualSha}`,
    );
  }

  const stagingDir = `${CACHE_ROOT}.tmp-${process.pid}`;
  await NodeFSP.rm(stagingDir, { recursive: true, force: true });
  await NodeFSP.mkdir(stagingDir, { recursive: true });

  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter((entry) => shouldIncludeEntry(entry.name));
  const createdDirs = new Set<string>([stagingDir]);

  for (const entry of entries) {
    const destination = NodePath.resolve(stagingDir, entry.name);
    if (!destination.startsWith(`${stagingDir}${NodePath.sep}`)) continue;
    const dir = NodePath.dirname(destination);
    if (!createdDirs.has(dir)) {
      await NodeFSP.mkdir(dir, { recursive: true });
      createdDirs.add(dir);
    }
    const content = await entry.async("nodebuffer");
    await NodeFSP.writeFile(destination, content);
  }

  await NodeFSP.writeFile(NodePath.join(stagingDir, ".ready"), `${DRAWIO_WAR_SHA256}\n`, "utf8");
  await NodeFSP.rm(CACHE_ROOT, { recursive: true, force: true });
  await NodeFSP.rename(stagingDir, CACHE_ROOT);
  return CACHE_ROOT;
}

function getDrawioAssets(): Promise<string> {
  preparePromise ??= ensureDrawioAssets().catch((error) => {
    preparePromise = null;
    throw error;
  });
  return preparePromise;
}

/**
 * Ships a trimmed, offline static copy of draw.io's production web app under `/drawio-assets/`.
 * Keeping the files out of git avoids bloating fork rebases; checksum verification pins the release.
 */
export function drawioAssetsPlugin(): Plugin {
  let outDir = "dist";
  let skip = false;

  return {
    name: "t3code:drawio-assets",
    configResolved(config) {
      outDir = NodePath.resolve(config.root, config.build.outDir);
      skip = Boolean(process.env.VITEST);
    },
    async buildStart() {
      if (skip) return;
      await getDrawioAssets();
    },
    configureServer(server) {
      if (skip) return;
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?")[0] ?? "";
        if (!pathname.startsWith(ROUTE)) return next();
        void getDrawioAssets()
          .then((root) => {
            const rel = decodeURIComponent(pathname.slice(ROUTE.length)) || "index.html";
            const filePath = NodePath.resolve(root, rel);
            if (!filePath.startsWith(`${root}${NodePath.sep}`) || !NodeFS.existsSync(filePath)) {
              response.statusCode = 404;
              response.end();
              return;
            }
            const stat = NodeFS.statSync(filePath);
            if (!stat.isFile()) {
              response.statusCode = 404;
              response.end();
              return;
            }
            const ext = NodePath.extname(filePath).toLowerCase();
            response.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
            response.setHeader("Cache-Control", "public, max-age=3600");
            NodeFS.createReadStream(filePath).pipe(response);
          })
          .catch((error) => {
            response.statusCode = 500;
            response.end(error instanceof Error ? error.message : String(error));
          });
      });
    },
    async writeBundle() {
      if (skip) return;
      const root = await getDrawioAssets();
      const target = NodePath.join(outDir, ROUTE.slice(1, -1));
      await NodeFSP.rm(target, { recursive: true, force: true });
      await NodeFSP.cp(root, target, {
        recursive: true,
        filter: (source) => NodePath.basename(source) !== ".ready",
      });
    },
  };
}
