import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { loadCursorProjectInstructions } from "./projectInstructions.ts";

describe("loadCursorProjectInstructions", () => {
  it.effect("returns undefined when AGENTS.md is absent or blank", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "cursor-agents-empty-",
      });

      const missing = yield* loadCursorProjectInstructions({
        cwd: workspace,
        includeRootFile: true,
        environment: { HOME: workspace },
      });
      assert.isUndefined(missing);

      yield* fileSystem.writeFileString(path.join(workspace, "AGENTS.md"), "   \n\t\n");
      const blank = yield* loadCursorProjectInstructions({
        cwd: workspace,
        includeRootFile: true,
        environment: { HOME: workspace },
      });
      assert.isUndefined(blank);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("expands standalone, nested, home-in-cwd, and inline @path imports", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "cursor-agents-expand-",
      });

      yield* fileSystem.makeDirectory(path.join(workspace, "docs"), { recursive: true });
      yield* fileSystem.makeDirectory(path.join(workspace, "agent-memory"), { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(workspace, "agent-memory", "MEMORY.md"),
        "Memory index line",
      );
      yield* fileSystem.writeFileString(
        path.join(workspace, "docs", "child.md"),
        "Child rule body",
      );
      yield* fileSystem.writeFileString(
        path.join(workspace, "docs", "parent.md"),
        "Parent header\n@./child.md",
      );
      yield* fileSystem.writeFileString(
        path.join(workspace, "docs", "style.md"),
        "Use strict types.",
      );
      yield* fileSystem.writeFileString(
        path.join(workspace, "AGENTS.md"),
        [
          "# Workspace rules",
          "@~/agent-memory/MEMORY.md",
          "@docs/parent.md",
          "Follow @docs/style.md. Also ignore user@example.com and @t3tools/contracts.",
          "Inline code `@docs/style.md` stays literal.",
          "```md",
          "@docs/child.md",
          "```",
        ].join("\n"),
      );

      const loaded = yield* loadCursorProjectInstructions({
        cwd: workspace,
        includeRootFile: true,
        environment: { HOME: workspace },
      });
      assert.isDefined(loaded);
      assert.include(loaded!, "<project_instructions path=");
      assert.include(loaded!, "# Workspace rules");
      assert.include(loaded!, "Memory index line");
      assert.include(loaded!, "Parent header\nChild rule body");
      assert.include(
        loaded!,
        '<imported_file path="docs/style.md">\nUse strict types.\n</imported_file>',
      );
      assert.include(loaded!, "user@example.com and @t3tools/contracts");
      assert.include(loaded!, "```md\n@docs/child.md\n```");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("blocks @path traversal, outside-cwd home paths, and symlinks escaping cwd", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-agents-boundary-" });
      const workspace = path.join(root, "repo");
      const home = path.join(root, "home");
      yield* fileSystem.makeDirectory(workspace, { recursive: true });
      yield* fileSystem.makeDirectory(home, { recursive: true });

      const parentSecret = path.join(root, "secret.txt");
      const homeSecret = path.join(home, "token.txt");
      yield* fileSystem.writeFileString(parentSecret, "PARENT_SECRET_VALUE");
      yield* fileSystem.writeFileString(homeSecret, "HOME_SECRET_VALUE");
      yield* fileSystem.writeFileString(path.join(workspace, "safe.md"), "SAFE_LOCAL_RULE");
      yield* fileSystem.writeFileString(path.join(workspace, "binary.bin"), "abc\0SECRET_BINARY");
      if (symlinksSupported) {
        yield* fileSystem.symlink(parentSecret, path.join(workspace, "escape-link.md"));
      }
      yield* fileSystem.writeFileString(
        path.join(workspace, "AGENTS.md"),
        [
          "@safe.md",
          "@../secret.txt",
          `@${parentSecret}`,
          "@~/token.txt",
          "@escape-link.md",
          "@binary.bin",
        ].join("\n"),
      );

      const loaded = yield* loadCursorProjectInstructions({
        cwd: workspace,
        includeRootFile: true,
        environment: { HOME: home },
      }).pipe(Effect.provideService(HostProcess.HomeDirectory, home));

      assert.isDefined(loaded);
      assert.include(loaded!, "SAFE_LOCAL_RULE");
      assert.notInclude(loaded!, "PARENT_SECRET_VALUE");
      assert.notInclude(loaded!, "HOME_SECRET_VALUE");
      assert.notInclude(loaded!, "SECRET_BINARY");
      assert.include(loaded!, "@../secret.txt");
      assert.include(loaded!, "@~/token.txt");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.skipIf(!symlinksSupported)("ignores a symlinked AGENTS.md pointing outside cwd", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-agents-symlink-" });
      const workspace = path.join(root, "repo");
      yield* fileSystem.makeDirectory(workspace, { recursive: true });
      const outside = path.join(root, "outside.md");
      yield* fileSystem.writeFileString(outside, "OUTSIDE_CONTENT");
      yield* fileSystem.symlink(outside, path.join(workspace, "AGENTS.md"));

      const loaded = yield* loadCursorProjectInstructions({
        cwd: workspace,
        includeRootFile: true,
        environment: { HOME: root },
      });
      assert.isUndefined(loaded);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("handles import cycles, deduplication, and full-access imports-only mode", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "cursor-agents-cycles-",
      });

      yield* fileSystem.writeFileString(path.join(workspace, "a.md"), "From A\n@b.md");
      yield* fileSystem.writeFileString(path.join(workspace, "b.md"), "From B\n@a.md");
      yield* fileSystem.writeFileString(path.join(workspace, "AGENTS.md"), "Root\n@a.md\n@b.md");

      const full = yield* loadCursorProjectInstructions({
        cwd: workspace,
        includeRootFile: true,
        environment: { HOME: workspace },
      });
      assert.isDefined(full);
      assert.equal(full!.split("From A").length - 1, 1);
      assert.equal(full!.split("From B").length - 1, 1);

      const importsOnly = yield* loadCursorProjectInstructions({
        cwd: workspace,
        includeRootFile: false,
        environment: { HOME: workspace },
      });
      assert.isDefined(importsOnly);
      assert.include(importsOnly!, "<project_instruction_imports from=");
      assert.notInclude(importsOnly!, "\nRoot\n");
      assert.equal(importsOnly!.split("From A").length - 1, 1);
      assert.equal(importsOnly!.split("From B").length - 1, 1);

      yield* fileSystem.writeFileString(
        path.join(workspace, "AGENTS.md"),
        "Plain root rules only.",
      );
      const noImports = yield* loadCursorProjectInstructions({
        cwd: workspace,
        includeRootFile: false,
        environment: { HOME: workspace },
      });
      assert.isUndefined(noImports);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("truncates oversized project instructions at the 64 KB budget", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-agents-cap-" });

      yield* fileSystem.writeFileString(path.join(workspace, "big.md"), "x".repeat(80 * 1024));
      yield* fileSystem.writeFileString(path.join(workspace, "AGENTS.md"), "Header\n@big.md");

      const loaded = yield* loadCursorProjectInstructions({
        cwd: workspace,
        includeRootFile: true,
        environment: { HOME: workspace },
      });
      assert.isDefined(loaded);
      assert.include(loaded!, "[truncated: project instructions exceeded 64 KB limit]");
      assert.isBelow(new TextEncoder().encode(loaded!).byteLength, 70 * 1024);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
