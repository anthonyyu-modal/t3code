import "./excalidrawAssets";

import { Excalidraw, MainMenu, WelcomeScreen } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import type { EnvironmentId, WhiteboardRef } from "@t3tools/contracts";
import { useLayoutEffect, useRef, useState } from "react";

import { useRenderedAppearance } from "../../hooks/useTheme";
import { openBoardSession, type BoardSession } from "./boardSession";
import { useRightDragPan } from "./useRightDragPan";

/**
 * One whiteboard: an Excalidraw board the user and agents both draw on. The server holds the
 * board; `boardSession` keeps this window in step with it.
 */
export default function WhiteboardPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly board: WhiteboardRef;
}) {
  const { environmentId } = props;
  const target = useRef(props.board);
  const appearance = useRenderedAppearance();
  const [board, setBoard] = useState<ExcalidrawImperativeAPI | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const session = useRef<BoardSession | null>(null);
  const rightDragPan = useRightDragPan(board);

  // A layout effect, because its cleanup has to read the board before Excalidraw empties it: a
  // parent's layout cleanup runs ahead of a child's unmount, and a passive one runs after it.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the server's copy of the board while the board is mounted, and sends what is unsaved when it closes
  useLayoutEffect(() => {
    if (board === null) return;
    const opened = openBoardSession({
      board,
      environmentId,
      target: target.current,
      onSaveFailed: setSaveFailed,
    });
    session.current = opened;
    return () => {
      session.current = null;
      opened.close();
    };
  }, [board, environmentId]);

  return (
    // The application role keeps typed keys and trackpad pans here: the chat view sends typing from
    // anywhere else to the composer, and treats a sideways swipe as going back. Excalidraw's top
    // bar outgrows the panel just above its own mobile breakpoint, so the Library label goes first.
    <div
      role="application"
      aria-label="Whiteboard"
      className="@container relative h-full min-h-0 w-full @max-[800px]:[&_.sidebar-trigger\_\_label]:hidden!"
      data-testid="whiteboard-panel"
      data-whiteboard-keys
      {...rightDragPan}
    >
      <Excalidraw
        excalidrawAPI={setBoard}
        theme={appearance}
        name="whiteboard"
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false },
        }}
        onChange={(elements, state) => session.current?.changed(elements, state)}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>
              Draw here, or ask the agent to. You both see and edit this board.
            </WelcomeScreen.Center.Heading>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>
      {saveFailed ? (
        <div
          role="status"
          className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md border border-destructive/40 bg-background px-3 py-1.5 text-xs text-destructive shadow-sm"
        >
          Changes are not saved. They will be sent again with your next edit.
        </div>
      ) : null}
    </div>
  );
}
