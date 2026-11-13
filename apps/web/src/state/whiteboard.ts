import { createWhiteboardEnvironmentAtoms } from "@t3tools/client-runtime/state/whiteboard";

import { connectionAtomRuntime } from "../connection/runtime";

export const whiteboardEnvironment = createWhiteboardEnvironmentAtoms(connectionAtomRuntime);
