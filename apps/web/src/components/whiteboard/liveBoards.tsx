/* oxlint-disable t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */
import type { EnvironmentId, ScopedThreadRef, WhiteboardId } from "@t3tools/contracts";
import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

import { useWhiteboardDirectory } from "../../state/whiteboard";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { boardKey, boardShownIn } from "./boards";
import { WhiteboardBoardBar } from "./WhiteboardBoardBar";
import { WhiteboardStart } from "./WhiteboardStart";

const WhiteboardPanel = lazy(() => import("./WhiteboardPanel"));

// The board on screen and the ones left most recently. Each is a whole Excalidraw in memory.
const MAX_LIVE_BOARDS = 5;
const DIALOG_BACKDROPS = "body > .excalidraw-modal-container .Modal__background";

interface LiveBoard {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly boardId: WhiteboardId;
  /** Holds the board's DOM for as long as it lives. A slot puts this element on screen. */
  readonly element: HTMLDivElement;
}

// Excalidraw keeps its undo history, view and pen only inside its mounted component, and the right
// panel builds a tab's content anew each time the tab is shown. So boards are mounted here, apart
// from the panel, least recently shown first. A board that two threads show is one board here
// too, so it keeps its history from one thread to the next.
const useLiveBoards = create<{ readonly boards: ReadonlyArray<LiveBoard> }>(() => ({ boards: [] }));

function showBoard(environmentId: EnvironmentId, boardId: WhiteboardId): HTMLDivElement {
  const key = boardKey(environmentId, boardId);
  const { boards } = useLiveBoards.getState();
  const live = boards.find((candidate) => candidate.key === key) ?? {
    key,
    environmentId,
    boardId,
    element: Object.assign(document.createElement("div"), { className: "contents" }),
  };
  useLiveBoards.setState({
    boards: [...boards.filter((other) => other !== live), live].slice(-MAX_LIVE_BOARDS),
  });
  return live.element;
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

function BoardSlot(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: WhiteboardId;
}) {
  const { environmentId, boardId } = props;
  const slot = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the live board's DOM element into this tab, and out again when the tab is hidden or shows another board
  useLayoutEffect(() => {
    const element = showBoard(environmentId, boardId);
    slot.current?.append(element);
    return () => {
      closeDialogsAfterCommit();
      element.remove();
    };
  }, [environmentId, boardId]);

  return <div ref={slot} className="min-h-0 flex-1" />;
}

/** A thread's Whiteboard tab: its choice of board, and that board. The board outlives the tab. */
export function WhiteboardSlot({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const directory = useWhiteboardDirectory(threadRef.environmentId);
  if (directory === "loading") return null;
  if (directory === "unavailable") {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Whiteboard unavailable</EmptyTitle>
          <EmptyDescription>
            This environment's T3 Code server did not answer for its whiteboards. If it is older
            than this app, update it.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const board = boardShownIn(directory, threadRef.threadId);
  if (board === null) return <WhiteboardStart threadRef={threadRef} directory={directory} />;
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* Keyed by board: a name half typed for one board must not go to the next one shown. */}
      <WhiteboardBoardBar
        key={board.boardId}
        threadRef={threadRef}
        directory={directory}
        board={board}
      />
      <BoardSlot environmentId={threadRef.environmentId} boardId={board.boardId} />
    </div>
  );
}

function LiveBoardMount({ live }: { readonly live: LiveBoard }) {
  const { boardId, environmentId } = live;
  const directory = useWhiteboardDirectory(environmentId);
  // A deleted board has nowhere left to save to.
  const deleted =
    typeof directory !== "string" && !directory.boards.some((board) => board.boardId === boardId);
  if (deleted) return null;
  return createPortal(
    <Suspense fallback={null}>
      <WhiteboardPanel environmentId={environmentId} boardId={boardId} />
    </Suspense>,
    live.element,
  );
}

/** Mounts every live board, wherever in the app its tab happens to be. */
export function LiveWhiteboards() {
  const boards = useLiveBoards((state) => state.boards);
  return boards.map((live) => <LiveBoardMount key={live.key} live={live} />);
}
