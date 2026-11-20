import { useAtomValue } from "@effect/atom-react";
import { createDiagramEnvironmentAtoms } from "@t3tools/client-runtime/state/diagram";
import type { DiagramDirectory, DiagramEngine, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

export const diagramEnvironment = createDiagramEnvironmentAtoms(connectionAtomRuntime);

/**
 * An engine's shared diagrams and each thread's selected diagram. `unavailable` means the server
 * did not answer for it (for instance an older server before draw.io and Drawnix were added).
 */
export function useDiagramDirectory(
  environmentId: EnvironmentId,
  engine: DiagramEngine,
): DiagramDirectory | "loading" | "unavailable" {
  const result = useAtomValue(diagramEnvironment.directory({ environmentId, input: { engine } }));
  return AsyncResult.getOrElse(result, () =>
    AsyncResult.isFailure(result) ? "unavailable" : "loading",
  );
}
