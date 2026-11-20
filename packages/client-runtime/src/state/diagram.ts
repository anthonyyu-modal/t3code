import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createDiagramEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    get: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:diagram:get",
      tag: WS_METHODS.diagramGet,
    }),
    save: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:diagram:save",
      tag: WS_METHODS.diagramSave,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:diagram:create",
      tag: WS_METHODS.diagramCreate,
    }),
    rename: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:diagram:rename",
      tag: WS_METHODS.diagramRename,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:diagram:delete",
      tag: WS_METHODS.diagramDelete,
    }),
    select: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:diagram:select",
      tag: WS_METHODS.diagramSelect,
    }),
    events: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:diagram:events",
      tag: WS_METHODS.subscribeDiagram,
      transform: (stream) => stream.pipe(Stream.rechunk(1)),
      idleTtlMs: 0,
    }),
    directory: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:diagram:directory",
      tag: WS_METHODS.subscribeDiagramDirectory,
    }),
  };
}
