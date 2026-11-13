import { useAtomValue } from "@effect/atom-react";
import { createWhiteboardEnvironmentAtoms } from "@t3tools/client-runtime/state/whiteboard";
import type { EnvironmentId, WhiteboardDirectory } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

export const whiteboardEnvironment = createWhiteboardEnvironmentAtoms(connectionAtomRuntime);

/**
 * The environment's shared boards and each thread's choice of board. `unavailable` means the
 * server could not give them and never has, as a server from before shared boards cannot.
 */
export function useWhiteboardDirectory(
  environmentId: EnvironmentId,
): WhiteboardDirectory | "loading" | "unavailable" {
  const result = useAtomValue(whiteboardEnvironment.directory({ environmentId, input: {} }));
  return AsyncResult.getOrElse(result, () =>
    AsyncResult.isFailure(result) ? "unavailable" : "loading",
  );
}
