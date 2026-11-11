// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- Native macOS .zip extraction, signature verification, and detached bundle replacement run at the electron-updater boundary outside Effect fibers.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Electron from "electron";
import { AppUpdater, type ResolvedUpdateFileInfo } from "electron-updater";
import type { DownloadUpdateOptions } from "electron-updater/out/AppUpdater.js";
import * as Schema from "effect/Schema";

const CURRENT_MAC_APP_ZIP_FILE_NAME = "update.zip";
const COMMAND_TIMEOUT_MS = 3 * 60 * 1000;
const SWAP_WAIT_MAX_TICKS = 300;
const MAC_DITTO_COMMAND = "/usr/bin/ditto";
const MAC_CODESIGN_COMMAND = "/usr/bin/codesign";
const MAC_PLUTIL_COMMAND = "/usr/bin/plutil";
const MAC_OPEN_COMMAND = "/usr/bin/open";
const MAC_LSREGISTER_COMMAND =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

const STANDARD_T3_MAC_BUNDLE_NAMES = new Set([
  "T3 Code.app",
  "T3 Code (Beta).app",
  "T3 Code (Nightly).app",
  "T3 Code (Alpha).app",
]);

const STALE_STAGE_DIR_PATTERN = /^\..+\.t3(?:update|backup)-(\d+)-[0-9a-f]+$/;

/**
 * Waits for parent PID `$1` to exit, swaps the staged `.app` into place with rollback, and
 * relaunches via `/usr/bin/open`. Positional arguments avoid shell interpolation of bundle paths.
 * @public
 */
export const MAC_ZIP_SWAP_SCRIPT = `
parent_pid="$1"
current_app="$2"
dest_app="$3"
staged_app="$4"
backup_app="$5"
relaunch="$6"
open_cmd="$7"
lsregister_cmd="$8"
max_wait_ticks="$9"
shift 9

ticks=0
while kill -0 "$parent_pid" 2>/dev/null; do
  ticks=$((ticks + 1))
  if [ "$ticks" -ge "$max_wait_ticks" ]; then
    rm -rf "$staged_app"
    exit 1
  fi
  sleep 0.1
done

rm -rf "$backup_app"
if [ -e "$current_app" ]; then
  if ! mv "$current_app" "$backup_app"; then
    rm -rf "$staged_app"
    exit 1
  fi
fi

dest_backup="\${dest_app}.t3destbackup-$$"
rm -rf "$dest_backup"
if [ "$dest_app" != "$current_app" ] && [ -e "$dest_app" ]; then
  if ! mv "$dest_app" "$dest_backup"; then
    if [ -e "$backup_app" ]; then
      mv "$backup_app" "$current_app" 2>/dev/null || true
    fi
    rm -rf "$staged_app"
    exit 1
  fi
fi

if ! mv "$staged_app" "$dest_app"; then
  if [ -e "$dest_backup" ]; then
    mv "$dest_backup" "$dest_app" 2>/dev/null || true
  fi
  if [ -e "$backup_app" ]; then
    mv "$backup_app" "$current_app" 2>/dev/null || true
  fi
  rm -rf "$staged_app"
  exit 1
fi

rm -rf "$backup_app" "$dest_backup"

if [ -n "$lsregister_cmd" ] && [ -x "$lsregister_cmd" ]; then
  "$lsregister_cmd" -f "$dest_app" >/dev/null 2>&1 || true
fi

if [ "$relaunch" = "1" ]; then
  if [ "$#" -gt 0 ]; then
    "$open_cmd" -n "$dest_app" --args "$@" >/dev/null 2>&1 || true
  else
    "$open_cmd" -n "$dest_app" >/dev/null 2>&1 || true
  fi
fi
`.trim();

/** @public */
export class MacZipUpdateInstallError extends Schema.TaggedError<MacZipUpdateInstallError>()(
  "MacZipUpdateInstallError",
  {
    userMessage: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.userMessage;
  }
}

/** @public */
export function hasMacAdHocSignedMetadata(rawPackageJson: string): boolean {
  try {
    const parsed: unknown = JSON.parse(rawPackageJson);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { readonly t3codeMacAdHocSigned?: unknown }).t3codeMacAdHocSigned === true
    );
  } catch {
    return false;
  }
}

/** @public */
export function shouldUseMacZipUpdater(input: {
  readonly platform: NodeJS.Platform;
  readonly isPackaged: boolean;
  readonly appPath: string;
  readonly readFileSync?: (path: string, encoding: BufferEncoding) => string;
}): boolean {
  if (input.platform !== "darwin" || !input.isPackaged) {
    return false;
  }
  const read = input.readFileSync ?? NodeFS.readFileSync;
  try {
    return hasMacAdHocSignedMetadata(
      read(NodePath.posix.join(input.appPath, "package.json"), "utf8"),
    );
  } catch {
    return false;
  }
}

/** @public */
export function isReadOnlyOrTranslocatedMacPath(targetPath: string): boolean {
  return targetPath.startsWith("/Volumes/") || targetPath.includes("/AppTranslocation/");
}

/** @public */
export function resolveMacAppBundlePath(execPath: string): string | null {
  const normalized = NodePath.posix.normalize(execPath);
  const macOsDir = NodePath.posix.dirname(normalized);
  const contentsDir = NodePath.posix.dirname(macOsDir);
  const bundlePath = NodePath.posix.dirname(contentsDir);
  const bundleBase = NodePath.posix.basename(bundlePath);
  if (
    NodePath.posix.basename(macOsDir) !== "MacOS" ||
    NodePath.posix.basename(contentsDir) !== "Contents" ||
    !bundleBase.endsWith(".app") ||
    bundleBase.length <= ".app".length ||
    bundlePath.includes(".app/Contents/")
  ) {
    return null;
  }
  return bundlePath;
}

/** @public */
export function resolveDestinationAppBundlePath(
  currentAppPath: string,
  extractedAppName: string,
): string {
  const currentName = NodePath.posix.basename(currentAppPath);
  if (STANDARD_T3_MAC_BUNDLE_NAMES.has(currentName)) {
    return NodePath.posix.join(NodePath.posix.dirname(currentAppPath), extractedAppName);
  }
  return currentAppPath;
}

/** @public */
export function filterMacUpdateFilesForArch(
  files: ReadonlyArray<ResolvedUpdateFileInfo>,
  isArm64Mac: boolean,
): ResolvedUpdateFileInfo[] {
  const isArm64File = (file: ResolvedUpdateFileInfo) =>
    file.url.pathname.includes("arm64") || Boolean(file.info.url?.includes("arm64"));
  if (isArm64Mac && files.some(isArm64File)) {
    return files.filter((file) => isArm64File(file));
  }
  return files.filter((file) => !isArm64File(file));
}

/** @public */
export function findMacZipUpdateFile(
  files: ReadonlyArray<ResolvedUpdateFileInfo>,
  preferredArch: string,
): ResolvedUpdateFileInfo | undefined {
  const zipFiles = files.filter(
    (file) =>
      file.url.pathname.toLowerCase().endsWith(".zip") ||
      Boolean(file.info.url?.toLowerCase().endsWith(".zip")),
  );
  return (
    zipFiles.find((file) =>
      [file.url.pathname, file.info.url ?? ""].some((name) => name.includes(preferredArch)),
    ) ?? zipFiles[0]
  );
}

/** @public */
export function filterMacRelaunchArgs(argv: ReadonlyArray<string>): string[] {
  return argv.slice(1).filter((arg) => {
    const lower = arg.toLowerCase();
    return (
      !lower.startsWith("t3code:") && !lower.startsWith("t3code-dev:") && !arg.startsWith("-psn_")
    );
  });
}

/** @public */
export function parseXmlPlistBundleIdentifier(plistXml: string): string | null {
  const match =
    /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>\s*([^<\s][^<]*?)\s*<\/string>/u.exec(plistXml);
  return match?.[1] ?? null;
}

export type MacUpdateCommandRunner = (
  file: string,
  args: ReadonlyArray<string>,
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

function defaultRunCommand(
  file: string,
  args: ReadonlyArray<string>,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      file,
      [...args],
      { encoding: "utf8", timeout: COMMAND_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

async function readBundleIdentifier(
  appBundlePath: string,
  runCommand: MacUpdateCommandRunner,
): Promise<string | null> {
  const plistPath = NodePath.join(appBundlePath, "Contents", "Info.plist");
  let bytes: Buffer;
  try {
    bytes = await NodeFSP.readFile(plistPath);
  } catch {
    return null;
  }
  if (bytes.subarray(0, 8).toString("ascii") === "bplist00") {
    try {
      const { stdout } = await runCommand(MAC_PLUTIL_COMMAND, [
        "-extract",
        "CFBundleIdentifier",
        "raw",
        "-o",
        "-",
        plistPath,
      ]);
      const trimmed = stdout.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }
  return parseXmlPlistBundleIdentifier(bytes.toString("utf8"));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

async function pruneStaleSiblingStageDirectories(
  parentDir: string,
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<void> {
  let entries: NodeFS.Dirent[];
  try {
    entries = await NodeFSP.readdir(parentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const match = STALE_STAGE_DIR_PATTERN.exec(entry.name);
    if (!match?.[1]) continue;
    const ownerPid = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0 || isAlive(ownerPid)) continue;
    await NodeFSP.rm(NodePath.join(parentDir, entry.name), { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await NodeFSP.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface StagedMacZipUpdate {
  readonly currentAppPath: string;
  readonly destAppPath: string;
  readonly stagedAppPath: string;
  readonly backupAppPath: string;
}

/**
 * Verifies (`codesign --verify --deep --strict` + `CFBundleIdentifier`) and stages the `.zip`
 * update beside the running `.app` before quitting so any failure leaves the running app intact.
 * @public
 */
export async function stageMacZipUpdate(input: {
  readonly zipPath: string;
  readonly currentAppPath: string;
  readonly pid?: number;
  readonly tempBaseDir?: string;
  readonly runCommand?: MacUpdateCommandRunner;
  readonly isPidAlive?: (pid: number) => boolean;
}): Promise<StagedMacZipUpdate> {
  const pid = input.pid ?? process.pid;
  const tempBaseDir = input.tempBaseDir ?? NodeOS.tmpdir();
  const runCommand = input.runCommand ?? defaultRunCommand;
  const currentAppPath = input.currentAppPath;

  if (!currentAppPath.endsWith(".app")) {
    throw new MacZipUpdateInstallError({
      userMessage: "Automatic updates require running T3 Code from a macOS .app bundle.",
    });
  }
  if (isReadOnlyOrTranslocatedMacPath(currentAppPath)) {
    throw new MacZipUpdateInstallError({
      userMessage: "Move T3 Code to Applications before installing updates.",
    });
  }
  if (!(await fileExists(input.zipPath))) {
    throw new MacZipUpdateInstallError({
      userMessage: "Downloaded update archive is missing; download it again.",
    });
  }

  const parentDir = NodePath.dirname(currentAppPath);
  try {
    await NodeFSP.access(parentDir, NodeFS.constants.W_OK);
    await NodeFSP.access(currentAppPath, NodeFS.constants.W_OK);
  } catch (cause) {
    throw new MacZipUpdateInstallError({
      userMessage: `Cannot update T3 Code in ${parentDir} because your user account does not have write permission there.`,
      cause,
    });
  }

  const expectedBundleId = await readBundleIdentifier(currentAppPath, runCommand);
  if (!expectedBundleId) {
    throw new MacZipUpdateInstallError({
      userMessage: "Could not read the current app bundle identifier from Contents/Info.plist.",
    });
  }

  await pruneStaleSiblingStageDirectories(parentDir, input.isPidAlive);

  const extractDir = await NodeFSP.mkdtemp(NodePath.join(tempBaseDir, "t3code-mac-zip-update-"));
  try {
    try {
      await runCommand(MAC_DITTO_COMMAND, ["--noqtn", "-x", "-k", input.zipPath, extractDir]);
    } catch (cause) {
      throw new MacZipUpdateInstallError({
        userMessage: "Failed to unpack the downloaded macOS update archive.",
        cause,
      });
    }

    const extractedEntries = await NodeFSP.readdir(extractDir, { withFileTypes: true });
    const appBundles = extractedEntries.filter(
      (entry) => entry.isDirectory() && entry.name.endsWith(".app") && !entry.name.startsWith("."),
    );
    if (appBundles.length !== 1 || !appBundles[0]) {
      throw new MacZipUpdateInstallError({
        userMessage: "Downloaded update archive did not contain a valid macOS .app bundle.",
      });
    }

    const extractedAppName = appBundles[0].name;
    const extractedAppPath = NodePath.join(extractDir, extractedAppName);
    const extractedBundleId = await readBundleIdentifier(extractedAppPath, runCommand);
    if (!extractedBundleId || extractedBundleId !== expectedBundleId) {
      throw new MacZipUpdateInstallError({
        userMessage: `Downloaded update bundle identifier (${extractedBundleId ?? "missing"}) does not match ${expectedBundleId}.`,
      });
    }

    try {
      await runCommand(MAC_CODESIGN_COMMAND, ["--verify", "--deep", "--strict", extractedAppPath]);
    } catch (cause) {
      throw new MacZipUpdateInstallError({
        userMessage: "Downloaded update failed macOS code signature verification.",
        cause,
      });
    }

    const destAppPath = resolveDestinationAppBundlePath(currentAppPath, extractedAppName);
    const nonce = `${pid}-${NodeCrypto.randomBytes(6).toString("hex")}`;
    const stagedAppPath = NodePath.join(
      parentDir,
      `.${NodePath.basename(destAppPath)}.t3update-${nonce}`,
    );
    const backupAppPath = NodePath.join(
      parentDir,
      `.${NodePath.basename(currentAppPath)}.t3backup-${nonce}`,
    );

    try {
      await runCommand(MAC_DITTO_COMMAND, ["--noqtn", extractedAppPath, stagedAppPath]);
    } catch (cause) {
      await NodeFSP.rm(stagedAppPath, { recursive: true, force: true }).catch(() => undefined);
      throw new MacZipUpdateInstallError({
        userMessage: `Could not stage the verified update into ${parentDir}.`,
        cause,
      });
    }

    return {
      currentAppPath,
      destAppPath,
      stagedAppPath,
      backupAppPath,
    };
  } finally {
    await NodeFSP.rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** @public */
export async function spawnDetachedMacSwapHelper(input: {
  readonly staged: StagedMacZipUpdate;
  readonly parentPid: number;
  readonly relaunch: boolean;
  readonly relaunchArgs: ReadonlyArray<string>;
  readonly openCommand?: string;
  readonly lsregisterCommand?: string;
  readonly maxWaitTicks?: number;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      "/bin/sh",
      [
        "-c",
        MAC_ZIP_SWAP_SCRIPT,
        "t3code-mac-zip-updater",
        String(input.parentPid),
        input.staged.currentAppPath,
        input.staged.destAppPath,
        input.staged.stagedAppPath,
        input.staged.backupAppPath,
        input.relaunch ? "1" : "0",
        input.openCommand ?? MAC_OPEN_COMMAND,
        input.lsregisterCommand ?? MAC_LSREGISTER_COMMAND,
        String(input.maxWaitTicks ?? SWAP_WAIT_MAX_TICKS),
        ...input.relaunchArgs,
      ],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    child.once("error", reject);
    child.once("spawn", () => {
      child.removeListener("error", reject);
      child.unref();
      resolve();
    });
  });
}

interface HttpDownloadExecutor {
  download(url: URL, destination: string, options: unknown): Promise<string>;
}

export interface MacZipUpdaterHostRuntime {
  readonly arch: string;
  readonly execPath: string;
  readonly argv: ReadonlyArray<string>;
}

/**
 * Fork: replaces `MacUpdater` (`Squirrel.Mac`) on ad hoc signed macOS builds so verified `.zip`
 * updates install without failing `cdhash` designated-requirement checks or adding quarantine.
 * @public
 */
export class MacZipUpdater extends AppUpdater {
  private readonly hostRuntime: MacZipUpdaterHostRuntime;
  private downloadedZipPath: string | null = null;
  private installInFlight = false;

  constructor(hostRuntime: MacZipUpdaterHostRuntime) {
    super(undefined);
    this.hostRuntime = hostRuntime;
  }

  private getHttpExecutor(): HttpDownloadExecutor {
    return (this as unknown as { readonly httpExecutor: HttpDownloadExecutor }).httpExecutor;
  }

  protected override async doDownloadUpdate(
    downloadUpdateOptions: DownloadUpdateOptions,
  ): Promise<Array<string>> {
    const provider = downloadUpdateOptions.updateInfoAndProvider.provider;
    const isArm64Mac =
      this.hostRuntime.arch === "arm64" || Electron.app.runningUnderARM64Translation === true;
    const archFiltered = filterMacUpdateFilesForArch(
      provider.resolveFiles(downloadUpdateOptions.updateInfoAndProvider.info),
      isArm64Mac,
    );
    const zipFileInfo = findMacZipUpdateFile(
      archFiltered,
      isArm64Mac ? "arm64" : this.hostRuntime.arch,
    );
    if (!zipFileInfo) {
      throw new MacZipUpdateInstallError({
        userMessage: "No macOS .zip update archive was listed in the update manifest.",
      });
    }

    return this.executeDownload({
      fileExtension: "zip",
      fileInfo: zipFileInfo,
      downloadUpdateOptions,
      task: async (destinationFile, downloadOptions) => {
        const cacheDir = this.downloadedUpdateHelper?.cacheDir;
        const cachedUpdateFilePath = cacheDir
          ? NodePath.join(cacheDir, CURRENT_MAC_APP_ZIP_FILE_NAME)
          : null;
        let shouldDownloadFull = true;
        if (
          !downloadUpdateOptions.disableDifferentialDownload &&
          cachedUpdateFilePath !== null &&
          (await fileExists(cachedUpdateFilePath))
        ) {
          shouldDownloadFull = await this.differentialDownloadInstaller(
            zipFileInfo,
            downloadUpdateOptions,
            destinationFile,
            provider,
            CURRENT_MAC_APP_ZIP_FILE_NAME,
          );
        }
        if (shouldDownloadFull) {
          await this.getHttpExecutor().download(zipFileInfo.url, destinationFile, downloadOptions);
        }
      },
      done: async (event) => {
        this.downloadedZipPath = event.downloadedFile;
        const cacheDir = this.downloadedUpdateHelper?.cacheDir;
        if (!downloadUpdateOptions.disableDifferentialDownload && cacheDir) {
          await NodeFSP.copyFile(
            event.downloadedFile,
            NodePath.join(cacheDir, CURRENT_MAC_APP_ZIP_FILE_NAME),
          ).catch((error: unknown) => {
            this._logger.warn(
              `Unable to cache update.zip for future differential downloads: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        }
        this.dispatchUpdateDownloaded(event);
      },
    });
  }

  override quitAndInstall(isSilent = false, isForceRunAfter = false): void {
    void this.quitAndInstallAsync(isSilent, isForceRunAfter).catch((error: unknown) => {
      this.dispatchError(
        error instanceof Error
          ? error
          : new MacZipUpdateInstallError({ userMessage: String(error), cause: error }),
      );
    });
  }

  async quitAndInstallAsync(isSilent = false, isForceRunAfter = false): Promise<void> {
    if (this.installInFlight) {
      throw new MacZipUpdateInstallError({
        userMessage: "An update installation is already in progress.",
      });
    }
    const zipPath = this.downloadedZipPath ?? this.downloadedUpdateHelper?.file ?? null;
    if (!zipPath) {
      throw new MacZipUpdateInstallError({
        userMessage: "No downloaded update archive is ready to install.",
      });
    }
    const currentAppPath = resolveMacAppBundlePath(this.hostRuntime.execPath);
    if (!currentAppPath) {
      throw new MacZipUpdateInstallError({
        userMessage: "Automatic updates require running T3 Code from a macOS .app bundle.",
      });
    }

    this.installInFlight = true;
    const shouldRelaunch = isSilent ? isForceRunAfter : this.autoRunAppAfterInstall;
    let staged: StagedMacZipUpdate | undefined;
    try {
      staged = await stageMacZipUpdate({
        zipPath,
        currentAppPath,
      });
      await spawnDetachedMacSwapHelper({
        staged,
        parentPid: process.pid,
        relaunch: shouldRelaunch,
        relaunchArgs: filterMacRelaunchArgs(this.hostRuntime.argv),
      });
    } catch (error) {
      if (staged) {
        await NodeFSP.rm(staged.stagedAppPath, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
      this.installInFlight = false;
      throw error;
    }

    setImmediate(() => {
      Electron.autoUpdater.emit("before-quit-for-update");
      Electron.app.quit();
    });
  }
}
