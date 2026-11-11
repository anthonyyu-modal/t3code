import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";
import { type AppUpdater, autoUpdater as electronAutoUpdater } from "electron-updater";

import {
  MacZipUpdateInstallError,
  MacZipUpdater,
  shouldUseMacZipUpdater,
} from "./MacZipUpdater.ts";

export type ElectronUpdaterFeedUrl = Parameters<AppUpdater["setFeedURL"]>[0];

const isMacZipUpdateInstallError = Schema.is(MacZipUpdateInstallError);

export class ElectronUpdaterCheckForUpdatesError extends Schema.TaggedError<ElectronUpdaterCheckForUpdatesError>()(
  "ElectronUpdaterCheckForUpdatesError",
  {
    channel: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron updater failed to check for updates on channel ${this.channel ?? "default"}.`;
  }
}

export class ElectronUpdaterDownloadUpdateError extends Schema.TaggedError<ElectronUpdaterDownloadUpdateError>()(
  "ElectronUpdaterDownloadUpdateError",
  {
    channel: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron updater failed to download the update on channel ${this.channel ?? "default"}.`;
  }
}

export class ElectronUpdaterQuitAndInstallError extends Schema.TaggedError<ElectronUpdaterQuitAndInstallError>()(
  "ElectronUpdaterQuitAndInstallError",
  {
    channel: Schema.NullOr(Schema.String),
    isSilent: Schema.Boolean,
    isForceRunAfter: Schema.Boolean,
    detail: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    if (this.detail) return this.detail;
    return `Electron updater failed to quit and install the update on channel ${this.channel ?? "default"} (silent: ${this.isSilent}, force run after: ${this.isForceRunAfter}).`;
  }
}

export const ElectronUpdaterError = Schema.Union([
  ElectronUpdaterCheckForUpdatesError,
  ElectronUpdaterDownloadUpdateError,
  ElectronUpdaterQuitAndInstallError,
]);
export type ElectronUpdaterError = typeof ElectronUpdaterError.Type;

export class ElectronUpdater extends Context.Service<
  ElectronUpdater,
  {
    readonly setFeedURL: (options: ElectronUpdaterFeedUrl) => Effect.Effect<void>;
    readonly setAutoDownload: (value: boolean) => Effect.Effect<void>;
    readonly setAutoInstallOnAppQuit: (value: boolean) => Effect.Effect<void>;
    readonly setChannel: (channel: string) => Effect.Effect<void>;
    readonly setAllowPrerelease: (value: boolean) => Effect.Effect<void>;
    readonly allowDowngrade: Effect.Effect<boolean>;
    readonly setAllowDowngrade: (value: boolean) => Effect.Effect<void>;
    readonly setFullChangelog: (value: boolean) => Effect.Effect<void>;
    readonly setDisableDifferentialDownload: (value: boolean) => Effect.Effect<void>;
    readonly checkForUpdates: Effect.Effect<void, ElectronUpdaterCheckForUpdatesError>;
    readonly downloadUpdate: Effect.Effect<void, ElectronUpdaterDownloadUpdateError>;
    readonly quitAndInstall: (options: {
      readonly isSilent: boolean;
      readonly isForceRunAfter: boolean;
    }) => Effect.Effect<void, ElectronUpdaterQuitAndInstallError>;
    readonly on: <Args extends ReadonlyArray<unknown>>(
      eventName: string,
      listener: (...args: Args) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/electron/ElectronUpdater") {}

let cachedUpdater: AppUpdater | undefined;

const resolveUpdater = Effect.gen(function* () {
  if (cachedUpdater !== undefined) return cachedUpdater;
  const platform = yield* HostProcess.Platform;
  const arch = yield* HostProcess.Architecture;
  const execPath = yield* HostProcess.ExecutablePath;
  const argv = yield* HostProcess.Arguments;
  cachedUpdater = shouldUseMacZipUpdater({
    platform,
    isPackaged: Electron.app.isPackaged,
    appPath: Electron.app.getAppPath(),
  })
    ? new MacZipUpdater({ arch, execPath, argv })
    : electronAutoUpdater;
  return cachedUpdater;
});

/** @public */
export const make = ElectronUpdater.of({
  setFeedURL: Effect.fn("ElectronUpdater.setFeedURL")(function* (options) {
    const updater = yield* resolveUpdater;
    yield* Effect.sync(() => {
      updater.setFeedURL(options);
    });
  }),
  setAutoDownload: Effect.fn("ElectronUpdater.setAutoDownload")(function* (value) {
    const updater = yield* resolveUpdater;
    yield* Effect.sync(() => {
      updater.autoDownload = value;
    });
  }),
  setAutoInstallOnAppQuit: Effect.fn("ElectronUpdater.setAutoInstallOnAppQuit")(function* (value) {
    const updater = yield* resolveUpdater;
    yield* Effect.sync(() => {
      updater.autoInstallOnAppQuit = value;
    });
  }),
  setChannel: Effect.fn("ElectronUpdater.setChannel")(function* (channel) {
    const updater = yield* resolveUpdater;
    yield* Effect.sync(() => {
      updater.channel = channel;
    });
  }),
  setAllowPrerelease: Effect.fn("ElectronUpdater.setAllowPrerelease")(function* (value) {
    const updater = yield* resolveUpdater;
    yield* Effect.sync(() => {
      updater.allowPrerelease = value;
    });
  }),
  allowDowngrade: resolveUpdater.pipe(Effect.map((updater) => updater.allowDowngrade)),
  setAllowDowngrade: Effect.fn("ElectronUpdater.setAllowDowngrade")(function* (value) {
    const updater = yield* resolveUpdater;
    yield* Effect.sync(() => {
      updater.allowDowngrade = value;
    });
  }),
  setFullChangelog: Effect.fn("ElectronUpdater.setFullChangelog")(function* (value) {
    const updater = yield* resolveUpdater;
    yield* Effect.sync(() => {
      updater.fullChangelog = value;
    });
  }),
  setDisableDifferentialDownload: Effect.fn("ElectronUpdater.setDisableDifferentialDownload")(
    function* (value) {
      const updater = yield* resolveUpdater;
      yield* Effect.sync(() => {
        updater.disableDifferentialDownload = value;
      });
    },
  ),
  checkForUpdates: Effect.gen(function* () {
    const updater = yield* resolveUpdater;
    const channel = updater.channel;
    yield* Effect.tryPromise({
      try: () => updater.checkForUpdates(),
      catch: (cause) => new ElectronUpdaterCheckForUpdatesError({ channel, cause }),
    });
  }),
  downloadUpdate: Effect.gen(function* () {
    const updater = yield* resolveUpdater;
    const channel = updater.channel;
    yield* Effect.tryPromise({
      try: () => updater.downloadUpdate(),
      catch: (cause) => new ElectronUpdaterDownloadUpdateError({ channel, cause }),
    });
  }),
  quitAndInstall: Effect.fn("ElectronUpdater.quitAndInstall")(function* ({
    isSilent,
    isForceRunAfter,
  }) {
    const updater = yield* resolveUpdater;
    const channel = updater.channel;
    if (updater instanceof MacZipUpdater) {
      yield* Effect.tryPromise({
        try: () => updater.quitAndInstallAsync(isSilent, isForceRunAfter),
        catch: (cause) =>
          new ElectronUpdaterQuitAndInstallError({
            channel,
            isSilent,
            isForceRunAfter,
            ...(isMacZipUpdateInstallError(cause) ? { detail: cause.userMessage } : {}),
            cause,
          }),
      });
      return;
    }
    yield* Effect.try({
      try: () => updater.quitAndInstall(isSilent, isForceRunAfter),
      catch: (cause) =>
        new ElectronUpdaterQuitAndInstallError({
          channel,
          isSilent,
          isForceRunAfter,
          cause,
        }),
    });
  }),
  on: Effect.fn("ElectronUpdater.on")(function* (eventName, listener) {
    const updater = yield* resolveUpdater;
    const eventTarget = updater as unknown as {
      on: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
      removeListener: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
    };
    const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        eventTarget.on(eventName, untypedListener);
      }),
      () =>
        Effect.sync(() => {
          eventTarget.removeListener(eventName, untypedListener);
        }),
    );
  }),
});

export const layer = Layer.succeed(ElectronUpdater, make);
