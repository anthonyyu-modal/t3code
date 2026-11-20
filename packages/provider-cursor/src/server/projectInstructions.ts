import * as HostProcess from "@t3tools/shared/HostProcess";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const PROJECT_INSTRUCTIONS_FILENAME = "AGENTS.md";
const MAX_IMPORT_DEPTH = 5;
const MAX_PROJECT_INSTRUCTIONS_BYTES = 64 * 1024;
const MAX_SINGLE_FILE_BYTES = 64 * 1024;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;
const STANDALONE_IMPORT_PATTERN = /^\s*@([^\s`]+)\s*$/;
const INLINE_IMPORT_PATTERN = /(^|[\s([{"'])@([^\s`"'()[\]{},;:!?]+)/g;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

interface ImportedSection {
  readonly relativePath: string;
  readonly content: string;
}

interface ExpandState {
  readonly realCwd: string;
  readonly userHome: string;
  readonly visited: Set<string>;
  readonly imported: Array<ImportedSection>;
  remainingBytes: number;
  truncated: boolean;
}

function isWithinRoot(root: string, candidate: string, path: Path.Path): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function toPosixRelative(root: string, target: string, path: Path.Path): string {
  return path.relative(root, target).replaceAll("\\", "/");
}

function sliceUtf8ToBytes(
  text: string,
  maxBytes: number,
): { readonly text: string; readonly bytes: number; readonly truncated: boolean } {
  const totalBytes = utf8Encoder.encode(text).byteLength;
  if (totalBytes <= maxBytes) return { text, bytes: totalBytes, truncated: false };
  if (maxBytes <= 0) return { text: "", bytes: 0, truncated: true };
  let bytes = 0;
  let result = "";
  for (const ch of text) {
    const chBytes = utf8Encoder.encode(ch).byteLength;
    if (bytes + chBytes > maxBytes) break;
    result += ch;
    bytes += chBytes;
  }
  return { text: result, bytes, truncated: true };
}

function extractInlineImportTokens(line: string): ReadonlyArray<string> {
  const tokens: Array<string> = [];
  let index = 0;
  while (index < line.length) {
    if (line[index] === "`") {
      let ticks = 1;
      while (index + ticks < line.length && line[index + ticks] === "`") ticks += 1;
      const close = line.indexOf("`".repeat(ticks), index + ticks);
      if (close === -1) break;
      index = close + ticks;
      continue;
    }
    const nextTick = line.indexOf("`", index);
    const segment = nextTick === -1 ? line.slice(index) : line.slice(index, nextTick);
    INLINE_IMPORT_PATTERN.lastIndex = 0;
    for (const match of segment.matchAll(INLINE_IMPORT_PATTERN)) {
      const token = match[2];
      if (token) tokens.push(token);
    }
    if (nextTick === -1) break;
    index = nextTick;
  }
  return tokens;
}

function isClosingFence(line: string, fence: string): boolean {
  const trimmed = line.trim();
  const marker = fence[0]!;
  return trimmed.length >= fence.length && [...trimmed].every((ch) => ch === marker);
}

const readBoundedTextFile = Effect.fn("CursorProjectInstructions.readBoundedTextFile")(function* (
  filePath: string,
  realCwd: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realTarget = yield* fileSystem
    .realPath(filePath)
    .pipe(Effect.orElseSucceed(() => undefined));
  if (realTarget === undefined || !isWithinRoot(realCwd, realTarget, path)) return undefined;
  const info = yield* fileSystem.stat(realTarget).pipe(Effect.orElseSucceed(() => undefined));
  if (info?.type !== "File") return undefined;
  const bytes = yield* fileSystem.readFile(realTarget).pipe(Effect.orElseSucceed(() => undefined));
  if (bytes === undefined) return undefined;
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 8192));
  if (sample.includes(0)) return undefined;
  const slice =
    bytes.byteLength > MAX_SINGLE_FILE_BYTES ? bytes.subarray(0, MAX_SINGLE_FILE_BYTES) : bytes;
  return { realPath: realTarget, text: utf8Decoder.decode(slice) };
});

const resolveImportFile = Effect.fn("CursorProjectInstructions.resolveImportFile")(function* (
  rawToken: string,
  fromDir: string,
  state: ExpandState,
) {
  const path = yield* Path.Path;
  const candidates = rawToken.endsWith(".") ? [rawToken, rawToken.slice(0, -1)] : [rawToken];
  for (const candidate of candidates) {
    if (candidate.length === 0) continue;
    const expanded = expandHomePath(candidate, state.userHome);
    const resolved = path.isAbsolute(expanded)
      ? path.resolve(expanded)
      : path.resolve(fromDir, expanded);
    const loaded = yield* readBoundedTextFile(resolved, state.realCwd);
    if (loaded !== undefined) return loaded;
  }
  return undefined;
});

const expandDocument = Effect.fn("CursorProjectInstructions.expandDocument")(function* (
  fileRealPath: string,
  rawText: string,
  depth: number,
  state: ExpandState,
): Effect.fn.Return<string, never, FileSystem.FileSystem | Path.Path> {
  const path = yield* Path.Path;
  const currentDir = path.dirname(fileRealPath);
  const lines = rawText.split(/\r?\n/);
  const outLines: Array<string> = [];
  const inlineImported: Array<ImportedSection> = [];
  let openFence: string | undefined;

  for (const line of lines) {
    if (openFence !== undefined) {
      outLines.push(line);
      if (isClosingFence(line, openFence)) openFence = undefined;
      continue;
    }
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fenceMatch?.[1] !== undefined) {
      openFence = fenceMatch[1];
      outLines.push(line);
      continue;
    }

    if (depth < MAX_IMPORT_DEPTH && state.remainingBytes > 0) {
      const standaloneMatch = STANDALONE_IMPORT_PATTERN.exec(line);
      if (standaloneMatch?.[1] !== undefined) {
        const loaded = yield* resolveImportFile(standaloneMatch[1], currentDir, state);
        if (loaded !== undefined && !state.visited.has(loaded.realPath)) {
          state.visited.add(loaded.realPath);
          const fittedRaw = sliceUtf8ToBytes(loaded.text, state.remainingBytes);
          state.remainingBytes -= fittedRaw.bytes;
          if (fittedRaw.truncated) state.truncated = true;
          const expanded = yield* expandDocument(loaded.realPath, fittedRaw.text, depth + 1, state);
          const trimmed = expanded.trim();
          if (trimmed.length > 0) {
            if (depth === 0) {
              state.imported.push({
                relativePath: toPosixRelative(state.realCwd, loaded.realPath, path),
                content: trimmed,
              });
            }
            outLines.push(trimmed);
            continue;
          }
        }
        outLines.push(line);
        continue;
      }

      const inlineTokens = extractInlineImportTokens(line);
      for (const token of inlineTokens) {
        if (state.remainingBytes <= 0) {
          state.truncated = true;
          break;
        }
        const loaded = yield* resolveImportFile(token, currentDir, state);
        if (loaded === undefined || state.visited.has(loaded.realPath)) continue;
        state.visited.add(loaded.realPath);
        const fittedRaw = sliceUtf8ToBytes(loaded.text, state.remainingBytes);
        state.remainingBytes -= fittedRaw.bytes;
        if (fittedRaw.truncated) state.truncated = true;
        const expanded = yield* expandDocument(loaded.realPath, fittedRaw.text, depth + 1, state);
        const trimmed = expanded.trim();
        if (trimmed.length === 0) continue;
        const section = {
          relativePath: toPosixRelative(state.realCwd, loaded.realPath, path),
          content: trimmed,
        };
        if (depth === 0) state.imported.push(section);
        inlineImported.push(section);
      }
    }

    outLines.push(line);
  }

  const body = outLines.join("\n").trim();
  if (inlineImported.length === 0) return body;
  const suffix = inlineImported
    .map(
      (entry) => `<imported_file path="${entry.relativePath}">\n${entry.content}\n</imported_file>`,
    )
    .join("\n\n");
  return body.length === 0 ? suffix : `${body}\n\n${suffix}`;
});

/**
 * Loads `<cwd>/AGENTS.md` for Cursor runs where `@cursor/sdk` skips project rules (or expands
 * `@path` imports that the SDK never resolves), keeping every expanded target inside `<cwd>`.
 */
export const loadCursorProjectInstructions = Effect.fn("loadCursorProjectInstructions")(
  function* (input: {
    readonly cwd: string;
    readonly includeRootFile: boolean;
    readonly environment?: NodeJS.ProcessEnv;
  }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const realCwd = yield* fileSystem
      .realPath(input.cwd)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (realCwd === undefined) return undefined;

    const rootFile = yield* readBoundedTextFile(
      path.join(realCwd, PROJECT_INSTRUCTIONS_FILENAME),
      realCwd,
    );
    if (rootFile === undefined || rootFile.text.trim().length === 0) return undefined;

    const env = input.environment ?? process.env;
    const userHome =
      env.HOME?.trim() || env.USERPROFILE?.trim() || (yield* HostProcess.HomeDirectory);
    const rootBytes = utf8Encoder.encode(rootFile.text).byteLength;
    const state: ExpandState = {
      realCwd,
      userHome,
      visited: new Set([rootFile.realPath]),
      imported: [],
      remainingBytes: Math.max(
        0,
        MAX_PROJECT_INSTRUCTIONS_BYTES - (input.includeRootFile ? rootBytes : 0),
      ),
      truncated: rootBytes > MAX_PROJECT_INSTRUCTIONS_BYTES,
    };

    const expanded = yield* expandDocument(rootFile.realPath, rootFile.text, 0, state);
    if (!input.includeRootFile) {
      if (state.imported.length === 0) return undefined;
      const body = state.imported
        .map(
          (entry) =>
            `<imported_file path="${entry.relativePath}">\n${entry.content}\n</imported_file>`,
        )
        .join("\n\n");
      const truncatedNote = state.truncated
        ? "\n\n[truncated: imported project instructions exceeded 64 KB limit]"
        : "";
      return `<project_instruction_imports from="${rootFile.realPath}">\n${body}${truncatedNote}\n</project_instruction_imports>`;
    }

    const fitted = sliceUtf8ToBytes(expanded, MAX_PROJECT_INSTRUCTIONS_BYTES);
    if (fitted.text.trim().length === 0) return undefined;
    const truncatedNote =
      state.truncated || fitted.truncated
        ? "\n\n[truncated: project instructions exceeded 64 KB limit]"
        : "";
    return `<project_instructions path="${rootFile.realPath}">\n${fitted.text.trim()}${truncatedNote}\n</project_instructions>`;
  },
);
