import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, WhiteboardActivityEvent } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { useRightPanelStore } from "../../rightPanelStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentSummaries } from "../../state/presentation";
import { whiteboardEnvironment } from "../../state/whiteboard";

/** Opens the thread's Whiteboard tab when its agent draws. A tab that is already there stays where the user left it. */
function revealAgentDrawing(environmentId: EnvironmentId, event: WhiteboardActivityEvent) {
  if (event.editor !== "agent") return;
  const threadRef = scopeThreadRef(environmentId, event.threadId);
  const panels = useRightPanelStore.getState();
  panels.openProactive(
    threadRef,
    { id: "whiteboard", kind: "whiteboard" },
    panels.userActionRevisionByThreadKey[scopedThreadKey(threadRef)] ?? 0,
  );
}

function watchEnvironment(environmentId: EnvironmentId): () => void {
  let last: WhiteboardActivityEvent | null = null;
  return appAtomRegistry.subscribe(
    whiteboardEnvironment.activity({ environmentId, input: {} }),
    (result) => {
      const event = AsyncResult.getOrElse(result, () => null);
      if (event === null || event === last) return;
      last = event;
      revealAgentDrawing(environmentId, event);
    },
    { immediate: true },
  );
}

/** Follows every connected environment for the life of the page: an agent in any thread can draw. */
export function startAgentDrawnWhiteboards(): () => void {
  const watched = new Map<EnvironmentId, () => void>();
  const stopEnvironments = appAtomRegistry.subscribe(
    environmentSummaries.connectedEnvironmentIdsAtom,
    (environmentIds) => {
      for (const [environmentId, stop] of watched) {
        if (environmentIds.includes(environmentId)) continue;
        stop();
        watched.delete(environmentId);
      }
      for (const environmentId of environmentIds) {
        if (!watched.has(environmentId))
          watched.set(environmentId, watchEnvironment(environmentId));
      }
    },
    { immediate: true },
  );
  return () => {
    stopEnvironments();
    for (const stop of watched.values()) stop();
  };
}
