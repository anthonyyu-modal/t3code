import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { useRightPanelStore } from "../../rightPanelStore";

const WhiteboardPanel = lazy(() => import("./WhiteboardPanel"));

// The board on screen and the ones left most recently. Each is a whole Excalidraw in memory.
const MAX_LIVE_BOARDS = 5;
const DIALOG_BACKDROPS = "body > .excalidraw-modal-container .Modal__background";

interface LiveBoard {
  readonly threadKey: string;
  readonly threadRef: ScopedThreadRef;
  /** Holds the board's DOM for as long as it lives. A slot puts this element on screen. */
  readonly element: HTMLDivElement;
}

// Excalidraw keeps its undo history, view and pen only inside its mounted component, and the right
// panel builds a tab's content anew each time the tab is shown. So boards are mounted here, apart
// from the panel, least recently shown first.
const useLiveBoards = create<{
  readonly boards: ReadonlyArray<LiveBoard>;
  readonly shownKey: string | null;
}>(() => ({ boards: [], shownKey: null }));

function showBoard(threadRef: ScopedThreadRef): HTMLDivElement {
  const threadKey = scopedThreadKey(threadRef);
  const { boards } = useLiveBoards.getState();
  const board = boards.find((candidate) => candidate.threadKey === threadKey) ?? {
    threadKey,
    threadRef,
    element: Object.assign(document.createElement("div"), { className: "contents" }),
  };
  useLiveBoards.setState({
    shownKey: threadKey,
    boards: [...boards.filter((other) => other !== board), board].slice(-MAX_LIVE_BOARDS),
  });
  return board.element;
}

// Excalidraw puts its dialogs on `body`, outside the board's element, where they would stay on
// screen after the board has left it. A click on a dialog's backdrop closes it, but React hears
// no events while it is committing, which is when a slot is cleaned up.
function closeDialogsAfterCommit() {
  queueMicrotask(() => {
    for (const backdrop of document.querySelectorAll<HTMLElement>(DIALOG_BACKDROPS)) {
      backdrop.click();
    }
  });
}

/** Where the right panel shows a thread's board. The board outlives this element. */
export function WhiteboardSlot({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = threadRef;
  const slot = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the live board's DOM element into this tab, and out again when the tab is hidden
  useLayoutEffect(() => {
    const shown = { environmentId, threadId };
    const threadKey = scopedThreadKey(shown);
    const element = showBoard(shown);
    slot.current?.append(element);
    return () => {
      closeDialogsAfterCommit();
      element.remove();
      if (useLiveBoards.getState().shownKey === threadKey) {
        useLiveBoards.setState({ shownKey: null });
      }
    };
  }, [environmentId, threadId]);

  return <div ref={slot} className="h-full min-h-0 w-full" />;
}

/**
 * Mounts every live board. A board lives while its thread keeps a Whiteboard tab, and until the
 * panel has finished closing around it.
 */
export function LiveWhiteboards() {
  const { boards, shownKey } = useLiveBoards();
  const mounted = useRightPanelStore(
    useShallow((panels) =>
      boards.filter(
        ({ threadKey }) =>
          threadKey === shownKey ||
          panels.byThreadKey[threadKey]?.surfaces.some((surface) => surface.kind === "whiteboard"),
      ),
    ),
  );
  return mounted.map(({ threadKey, threadRef, element }) =>
    createPortal(
      <Suspense fallback={null}>
        <WhiteboardPanel threadRef={threadRef} />
      </Suspense>,
      element,
      threadKey,
    ),
  );
}
