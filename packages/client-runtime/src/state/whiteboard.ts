import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createWhiteboardEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    get: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:whiteboard:get",
      tag: WS_METHODS.whiteboardGet,
    }),
    save: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:whiteboard:save",
      tag: WS_METHODS.whiteboardSave,
    }),
    submitSnapshot: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:whiteboard:submit-snapshot",
      tag: WS_METHODS.whiteboardSubmitSnapshot,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:whiteboard:create",
      tag: WS_METHODS.whiteboardCreate,
    }),
    rename: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:whiteboard:rename",
      tag: WS_METHODS.whiteboardRename,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:whiteboard:delete",
      tag: WS_METHODS.whiteboardDelete,
    }),
    select: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:whiteboard:select",
      tag: WS_METHODS.whiteboardSelect,
    }),
    events: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:whiteboard:events",
      tag: WS_METHODS.subscribeWhiteboard,
      // Stream atoms publish only the last value per chunk; a picture request must not be skipped.
      transform: (stream) => stream.pipe(Stream.rechunk(1)),
      // The server counts subscribers to know whether a tab can draw a picture, so leave at once.
      idleTtlMs: 0,
    }),
    directory: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:whiteboard:directory",
      tag: WS_METHODS.subscribeWhiteboardDirectory,
    }),
    activity: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:whiteboard:activity",
      tag: WS_METHODS.subscribeWhiteboardActivity,
      transform: (stream) => stream.pipe(Stream.rechunk(1)),
    }),
  };
}
