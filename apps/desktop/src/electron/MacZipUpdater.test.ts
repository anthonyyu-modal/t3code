// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- Exercises the POSIX /bin/sh swap helper and temporary .app bundle trees on disk.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, expect, it } from "@effect/vitest";
import type { ResolvedUpdateFileInfo } from "electron-updater";

import {
  MAC_ZIP_SWAP_SCRIPT,
  MacZipUpdateInstallError,
  filterMacRelaunchArgs,
  filterMacUpdateFilesForArch,
  findMacZipUpdateFile,
  hasMacAdHocSignedMetadata,
  parseXmlPlistBundleIdentifier,
  resolveDestinationAppBundlePath,
  resolveMacAppBundlePath,
  shouldUseMacZipUpdater,
  stageMacZipUpdate,
} from "./MacZipUpdater.ts";

function makePlistXml(bundleId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
</dict>
</plist>
`;
}

async function createFakeMacApp(
  appPath: string,
  options: { readonly bundleId?: string; readonly versionMarker?: string } = {},
): Promise<void> {
  const contentsDir = NodePath.join(appPath, "Contents");
  const macOsDir = NodePath.join(contentsDir, "MacOS");
  await NodeFSP.mkdir(macOsDir, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(contentsDir, "Info.plist"),
    makePlistXml(options.bundleId ?? "com.t3tools.t3code"),
    "utf8",
  );
  await NodeFSP.writeFile(
    NodePath.join(macOsDir, "T3 Code (Nightly)"),
    options.versionMarker ?? "v1",
    "utf8",
  );
}

function makeResolvedFile(fileName: string): ResolvedUpdateFileInfo {
  return {
    url: new URL(`https://github.com/anthonyyu-modal/t3code/releases/download/v1.0.0/${fileName}`),
    info: {
      url: fileName,
      sha512: "abc123",
    },
  };
}

function runSwapScript(args: ReadonlyArray<string>): Promise<{
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      "/bin/sh",
      ["-c", MAC_ZIP_SWAP_SCRIPT, "t3code-mac-zip-updater", ...args],
      { encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

describe("MacZipUpdater", () => {
  it("activates only for packaged darwin builds stamped with t3codeMacAdHocSigned", () => {
    assert.isTrue(hasMacAdHocSignedMetadata('{"name":"t3code","t3codeMacAdHocSigned":true}'));
    assert.isFalse(hasMacAdHocSignedMetadata('{"name":"t3code","t3codeMacAdHocSigned":false}'));
    assert.isFalse(hasMacAdHocSignedMetadata('{"name":"t3code"}'));
    assert.isFalse(hasMacAdHocSignedMetadata("not-json"));

    const readAdHoc = () => '{"t3codeMacAdHocSigned":true}';
    assert.isTrue(
      shouldUseMacZipUpdater({
        platform: "darwin",
        isPackaged: true,
        appPath: "/Applications/T3 Code (Nightly).app/Contents/Resources/app.asar",
        readFileSync: readAdHoc,
      }),
    );
    assert.isFalse(
      shouldUseMacZipUpdater({
        platform: "darwin",
        isPackaged: false,
        appPath: "/repo",
        readFileSync: readAdHoc,
      }),
    );
    assert.isFalse(
      shouldUseMacZipUpdater({
        platform: "linux",
        isPackaged: true,
        appPath: "/opt/T3 Code/resources/app.asar",
        readFileSync: readAdHoc,
      }),
    );
    assert.isFalse(
      shouldUseMacZipUpdater({
        platform: "darwin",
        isPackaged: true,
        appPath: "/Applications/T3 Code (Nightly).app/Contents/Resources/app.asar",
        readFileSync: () => '{"name":"t3code"}',
      }),
    );
  });

  it("resolves outer .app bundle paths and rejects non-bundle or nested helper executables", () => {
    assert.equal(
      resolveMacAppBundlePath(
        "/Applications/T3 Code (Nightly).app/Contents/MacOS/T3 Code (Nightly)",
      ),
      "/Applications/T3 Code (Nightly).app",
    );
    assert.equal(
      resolveMacAppBundlePath(
        "/Users/anthony/Applications/T3 Code (Nightly).app/Contents/MacOS/T3 Code (Nightly)",
      ),
      "/Users/anthony/Applications/T3 Code (Nightly).app",
    );
    assert.isNull(
      resolveMacAppBundlePath(
        "/Applications/T3 Code (Nightly).app/Contents/Frameworks/T3 Code (Nightly) Helper.app/Contents/MacOS/T3 Code (Nightly) Helper",
      ),
    );
    assert.isNull(resolveMacAppBundlePath("/usr/local/bin/node"));
  });

  it("preserves custom bundle names while following standard stage bundle names", () => {
    assert.equal(
      resolveDestinationAppBundlePath(
        "/Applications/T3 Code (Nightly).app",
        "T3 Code (Nightly).app",
      ),
      "/Applications/T3 Code (Nightly).app",
    );
    assert.equal(
      resolveDestinationAppBundlePath("/Applications/T3 Code (Nightly).app", "T3 Code (Beta).app"),
      "/Applications/T3 Code (Beta).app",
    );
    assert.equal(
      resolveDestinationAppBundlePath("/Applications/My Custom T3.app", "T3 Code (Nightly).app"),
      "/Applications/My Custom T3.app",
    );
  });

  it("selects the architecture-matching .zip archive over .dmg assets", () => {
    const files = [
      makeResolvedFile("T3-Code-0.1.9-nightly.20261110.21-arm64.dmg"),
      makeResolvedFile("T3-Code-0.1.9-nightly.20261110.21-arm64.zip"),
      makeResolvedFile("T3-Code-0.1.9-nightly.20261110.21-x64.dmg"),
      makeResolvedFile("T3-Code-0.1.9-nightly.20261110.21-x64.zip"),
    ];

    const arm64Filtered = filterMacUpdateFilesForArch(files, true);
    assert.equal(
      findMacZipUpdateFile(arm64Filtered, "arm64")?.info.url,
      "T3-Code-0.1.9-nightly.20261110.21-arm64.zip",
    );

    const x64Filtered = filterMacUpdateFilesForArch(files, false);
    assert.equal(
      findMacZipUpdateFile(x64Filtered, "x64")?.info.url,
      "T3-Code-0.1.9-nightly.20261110.21-x64.zip",
    );
  });

  it("strips deep links and LaunchServices PSN arguments from relaunch args", () => {
    assert.deepEqual(
      filterMacRelaunchArgs([
        "/Applications/T3 Code (Nightly).app/Contents/MacOS/T3 Code (Nightly)",
        "-psn_0_12345",
        "--enable-logging",
        "t3code://thread/123",
        "T3CODE-DEV://pair?token=abc",
      ]),
      ["--enable-logging"],
    );
  });

  it("parses CFBundleIdentifier from XML Info.plist files", () => {
    assert.equal(
      parseXmlPlistBundleIdentifier(makePlistXml("com.t3tools.t3code")),
      "com.t3tools.t3code",
    );
    assert.isNull(parseXmlPlistBundleIdentifier("<plist><dict></dict></plist>"));
  });

  it("unpacks with ditto --noqtn, verifies codesign and bundle ID, stages beside the app, and prunes dead-PID leftovers", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-mac-zip-stage-test-"));
    try {
      const appsDir = NodePath.join(root, "Applications");
      const currentAppPath = NodePath.join(appsDir, "T3 Code (Nightly).app");
      await createFakeMacApp(currentAppPath, { versionMarker: "old-version" });

      const staleStageDir = NodePath.join(
        appsDir,
        ".T3 Code (Nightly).app.t3update-999999-a1b2c3d4e5f6",
      );
      const liveStageDir = NodePath.join(
        appsDir,
        ".T3 Code (Nightly).app.t3update-4242-a1b2c3d4e5f6",
      );
      await NodeFSP.mkdir(staleStageDir, { recursive: true });
      await NodeFSP.mkdir(liveStageDir, { recursive: true });

      const zipPath = NodePath.join(root, "T3-Code-0.1.9-arm64.zip");
      await NodeFSP.writeFile(zipPath, "fake-zip-bytes", "utf8");

      const calls: Array<{ readonly file: string; readonly args: ReadonlyArray<string> }> = [];
      let extractedTempDir: string | undefined;

      const staged = await stageMacZipUpdate({
        zipPath,
        currentAppPath,
        pid: 5150,
        tempBaseDir: root,
        isPidAlive: (pid) => pid === 4242,
        runCommand: async (file, args) => {
          calls.push({ file, args });
          if (file === "/usr/bin/ditto" && args[0] === "--noqtn" && args[1] === "-x") {
            const extractDir = args[4]!;
            extractedTempDir = extractDir;
            await createFakeMacApp(NodePath.join(extractDir, "T3 Code (Nightly).app"), {
              versionMarker: "new-version",
            });
            return { stdout: "", stderr: "" };
          }
          if (file === "/usr/bin/codesign") {
            return { stdout: "", stderr: "" };
          }
          if (file === "/usr/bin/ditto" && args[0] === "--noqtn" && args.length === 3) {
            await NodeFSP.cp(args[1]!, args[2]!, { recursive: true });
            return { stdout: "", stderr: "" };
          }
          throw new Error(`Unexpected command: ${file} ${args.join(" ")}`);
        },
      });

      assert.equal(staged.currentAppPath, currentAppPath);
      assert.equal(staged.destAppPath, currentAppPath);
      assert.equal(NodePath.dirname(staged.stagedAppPath), appsDir);
      assert.equal(
        await NodeFSP.readFile(
          NodePath.join(staged.stagedAppPath, "Contents", "MacOS", "T3 Code (Nightly)"),
          "utf8",
        ),
        "new-version",
      );

      assert.equal(calls.length, 3);
      assert.deepEqual(calls[0]?.args.slice(0, 4), ["--noqtn", "-x", "-k", zipPath]);
      assert.deepEqual(calls[1]?.args.slice(0, 3), ["--verify", "--deep", "--strict"]);
      assert.equal(calls[2]?.file, "/usr/bin/ditto");
      assert.equal(calls[2]?.args[0], "--noqtn");

      await expect(NodeFSP.access(extractedTempDir!)).rejects.toThrow();
      await expect(NodeFSP.access(staleStageDir)).rejects.toThrow();
      await NodeFSP.access(liveStageDir);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("aborts before touching Applications when codesign or bundle ID verification fails", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-mac-zip-reject-test-"));
    try {
      const appsDir = NodePath.join(root, "Applications");
      const currentAppPath = NodePath.join(appsDir, "T3 Code (Nightly).app");
      await createFakeMacApp(currentAppPath, { versionMarker: "intact" });
      const zipPath = NodePath.join(root, "update.zip");
      await NodeFSP.writeFile(zipPath, "zip", "utf8");

      await expect(
        stageMacZipUpdate({
          zipPath,
          currentAppPath: "/Volumes/T3 Code Installer/T3 Code (Nightly).app",
          tempBaseDir: root,
        }),
      ).rejects.toThrow(MacZipUpdateInstallError);

      await expect(
        stageMacZipUpdate({
          zipPath,
          currentAppPath,
          tempBaseDir: root,
          runCommand: async (file, args) => {
            if (file === "/usr/bin/ditto" && args[1] === "-x") {
              await createFakeMacApp(NodePath.join(args[4]!, "T3 Code (Nightly).app"), {
                bundleId: "com.evil.other",
              });
              return { stdout: "", stderr: "" };
            }
            throw new Error("should not reach codesign on bundle ID mismatch");
          },
        }),
      ).rejects.toThrow(/does not match com\.t3tools\.t3code/);

      await expect(
        stageMacZipUpdate({
          zipPath,
          currentAppPath,
          tempBaseDir: root,
          runCommand: async (file, args) => {
            if (file === "/usr/bin/ditto" && args[1] === "-x") {
              await createFakeMacApp(NodePath.join(args[4]!, "T3 Code (Nightly).app"));
              return { stdout: "", stderr: "" };
            }
            if (file === "/usr/bin/codesign") {
              throw new Error("a sealed resource is missing or invalid");
            }
            throw new Error("should not stage after codesign failure");
          },
        }),
      ).rejects.toThrow(/code signature verification/);

      assert.deepEqual(await NodeFSP.readdir(appsDir), ["T3 Code (Nightly).app"]);
      assert.equal(
        await NodeFSP.readFile(
          NodePath.join(currentAppPath, "Contents", "MacOS", "T3 Code (Nightly)"),
          "utf8",
        ),
        "intact",
      );
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("waits for the exiting parent PID, swaps a spaced .app bundle, refreshes LaunchServices, and relaunches", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-mac-swap-sh-test-"));
    try {
      const appsDir = NodePath.join(root, "Applications");
      const currentAppPath = NodePath.join(appsDir, "T3 Code (Nightly).app");
      const stagedAppPath = NodePath.join(appsDir, ".T3 Code (Nightly).app.t3update-123");
      const backupAppPath = NodePath.join(appsDir, ".T3 Code (Nightly).app.t3backup-123");
      await createFakeMacApp(currentAppPath, { versionMarker: "v1" });
      await createFakeMacApp(stagedAppPath, { versionMarker: "v2" });

      const invocationsFile = NodePath.join(root, "invocations.log");
      const fakeOpen = NodePath.join(root, "fake-open.sh");
      const fakeLsregister = NodePath.join(root, "fake-lsregister.sh");
      await NodeFSP.writeFile(
        fakeOpen,
        `#!/bin/sh\nprintf 'open:%s\\n' "$*" >> "${invocationsFile}"\n`,
        { mode: 0o755 },
      );
      await NodeFSP.writeFile(
        fakeLsregister,
        `#!/bin/sh\nprintf 'lsregister:%s\\n' "$*" >> "${invocationsFile}"\n`,
        { mode: 0o755 },
      );

      const sleeper = NodeChildProcess.spawn(
        process.execPath,
        ["-e", "setTimeout(() => {}, 150)"],
        {
          stdio: "ignore",
        },
      );
      const parentPid = sleeper.pid!;

      const result = await runSwapScript([
        String(parentPid),
        currentAppPath,
        currentAppPath,
        stagedAppPath,
        backupAppPath,
        "1",
        fakeOpen,
        fakeLsregister,
        "50",
        "--flag-one",
      ]);

      assert.equal(result.code, 0);
      assert.equal(
        await NodeFSP.readFile(
          NodePath.join(currentAppPath, "Contents", "MacOS", "T3 Code (Nightly)"),
          "utf8",
        ),
        "v2",
      );
      await expect(NodeFSP.access(stagedAppPath)).rejects.toThrow();
      await expect(NodeFSP.access(backupAppPath)).rejects.toThrow();

      const invocations = (await NodeFSP.readFile(invocationsFile, "utf8")).trim().split("\n");
      assert.deepEqual(invocations, [
        `lsregister:-f ${currentAppPath}`,
        `open:-n ${currentAppPath} --args --flag-one`,
      ]);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back the original .app bundle if moving the staged bundle fails, and aborts cleanly on parent wait timeout", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-mac-swap-rollback-"));
    try {
      const appsDir = NodePath.join(root, "Applications");
      const currentAppPath = NodePath.join(appsDir, "T3 Code (Nightly).app");
      const missingStagedPath = NodePath.join(appsDir, ".missing-staged.app");
      const backupAppPath = NodePath.join(appsDir, ".T3 Code (Nightly).app.t3backup-rollback");
      await createFakeMacApp(currentAppPath, { versionMarker: "keep-me" });

      // Dead PID 99999999 exits the wait loop immediately; missing staged_app makes the second mv fail.
      const rollbackResult = await runSwapScript([
        "99999999",
        currentAppPath,
        currentAppPath,
        missingStagedPath,
        backupAppPath,
        "0",
        "/usr/bin/true",
        "",
        "5",
      ]);
      assert.equal(rollbackResult.code, 1);
      assert.equal(
        await NodeFSP.readFile(
          NodePath.join(currentAppPath, "Contents", "MacOS", "T3 Code (Nightly)"),
          "utf8",
        ),
        "keep-me",
      );
      await expect(NodeFSP.access(backupAppPath)).rejects.toThrow();

      // Live process.pid never exits during the 2-tick timeout; staged_app is cleaned up and current_app stays untouched.
      const stagedTimeoutPath = NodePath.join(appsDir, ".T3 Code (Nightly).app.t3update-timeout");
      await createFakeMacApp(stagedTimeoutPath, { versionMarker: "v2" });
      const timeoutResult = await runSwapScript([
        String(process.pid),
        currentAppPath,
        currentAppPath,
        stagedTimeoutPath,
        backupAppPath,
        "0",
        "/usr/bin/true",
        "",
        "2",
      ]);
      assert.equal(timeoutResult.code, 1);
      await expect(NodeFSP.access(stagedTimeoutPath)).rejects.toThrow();
      assert.equal(
        await NodeFSP.readFile(
          NodePath.join(currentAppPath, "Contents", "MacOS", "T3 Code (Nightly)"),
          "utf8",
        ),
        "keep-me",
      );
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
