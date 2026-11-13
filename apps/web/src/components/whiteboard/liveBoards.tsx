import type { EnvironmentId, ScopedThreadRef, WhiteboardRef } from "@t3tools/contracts";
import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

import { useWhiteboardDirectory } from "../../state/whiteboard";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { boardKey, boardShownIn } from "./boards";
import { WhiteboardBoardBar } from "./WhiteboardBoardBar";

const WhiteboardPanel = lazy(() => import("./WhiteboardPanel"));

// The board on screen and the ones left most recently. Each is a whole Excalidraw in memory.
const MAX_LIVE_BOARDS = 5;
const DIALOG_BACKDROPS = "body > .excalidraw-modal-container .Modal__background";

interface LiveBoard {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly board: WhiteboardRef;
  /** Holds the board's DOM for as long as it lives. A slot puts this element on screen. */
  readonly element: HTMLDivElement;
}

// Excalidraw keeps its undo history, view and pen only inside its mounted component, and the right
// panel builds a tab's content anew each time the tab is shown. So boards are mounted here, apart
// from the panel, least recently shown first. A shared board that two threads show is one board
// here too, so it keeps its history from one thread to the next.
const useLiveBoards = create<{ readonly boards: ReadonlyArray<LiveBoard> }>(() => ({ boards: [] }));

function showBoard(environmentId: EnvironmentId, board: WhiteboardRef): HTMLDivElement {
  const key = boardKey(environmentId, board);
  const { boards } = useLiveBoards.getState();
  const live = boards.find((candidate) => candidate.key === key) ?? {
    key,
    environmentId,
    board,
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
  readonly board: WhiteboardRef;
}) {
  const { environmentId, board } = props;
  const slot = useRef<HTMLDivElement>(null);
  // The ref is a new object on every render, so the effect follows what it names.
  const threadId = board.kind === "thread" ? board.threadId : null;
  const boardId = board.kind === "shared" ? board.boardId : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the live board's DOM element into this tab, and out again when the tab is hidden or shows another board
  useLayoutEffect(() => {
    const shown: WhiteboardRef | null =
      threadId !== null
        ? { kind: "thread", threadId }
        : boardId !== null
          ? { kind: "shared", boardId }
          : null;
    if (shown === null) return;
    const element = showBoard(environmentId, shown);
    slot.current?.append(element);
    return () => {
      closeDialogsAfterCommit();
      element.remove();
    };
  }, [environmentId, threadId, boardId]);

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
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <WhiteboardBoardBar threadRef={threadRef} directory={directory} board={board} />
      <BoardSlot environmentId={threadRef.environmentId} board={board} />
    </div>
  );
}

function LiveBoardMount({ live }: { readonly live: LiveBoard }) {
  const { board, environmentId } = live;
  const directory = useWhiteboardDirectory(environmentId);
  // A deleted shared board has nowhere left to save to.
  const deleted =
    board.kind === "shared" &&
    typeof directory !== "string" &&
    !directory.boards.some((shared) => shared.boardId === board.boardId);
  if (deleted) return null;
  return createPortal(
    <Suspense fallback={null}>
      <WhiteboardPanel environmentId={environmentId} board={board} />
    </Suspense>,
    live.element,
  );
}

/** Mounts every live board, wherever in the app its tab happens to be. */
export function LiveWhiteboards() {
  const boards = useLiveBoards((state) => state.boards);
  return boards.map((live) => <LiveBoardMount key={live.key} live={live} />);
}
