import "./excalidrawAssets";

import { Excalidraw, MainMenu, WelcomeScreen } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useRenderedAppearance } from "../../hooks/useTheme";
import { openBoardSession, type BoardSession } from "./boardSession";
import { useRightDragPan } from "./useRightDragPan";

/**
 * This thread's whiteboard: an Excalidraw board the user and the agent both draw on. The server
 * holds the board; `boardSession` keeps this window in step with it.
 */
export default function WhiteboardPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = threadRef;
  const appearance = useRenderedAppearance();
  const [board, setBoard] = useState<ExcalidrawImperativeAPI | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const session = useRef<BoardSession | null>(null);
  const rightDragPan = useRightDragPan(board);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the server's copy of the board while the tab is mounted, and sends what is unsaved when it closes
  useEffect(() => {
    if (board === null) return;
    const opened = openBoardSession({
      board,
      threadRef: { environmentId, threadId },
      onSaveFailed: setSaveFailed,
    });
    session.current = opened;
    return () => {
      session.current = null;
      opened.close();
    };
  }, [board, environmentId, threadId]);

  return (
    // The application role keeps typed keys here: the chat view sends typing from anywhere else to
    // the composer, which would swallow Excalidraw's single-key tool shortcuts.
    <div
      role="application"
      aria-label="Whiteboard"
      className="relative h-full min-h-0 w-full"
      data-testid="whiteboard-panel"
      {...rightDragPan}
    >
      <Excalidraw
        excalidrawAPI={setBoard}
        theme={appearance}
        name="whiteboard"
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false },
        }}
        onChange={(elements) => session.current?.changed(elements)}
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
