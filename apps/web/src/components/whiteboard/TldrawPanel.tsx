/* oxlint-disable t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */
import type { EnvironmentId, WhiteboardId } from "@t3tools/contracts";
import { createTLStore, Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import { useLayoutEffect, useRef, useState } from "react";

import { useRenderedAppearance } from "../../hooks/useTheme";
import { openTldrawBoardSession } from "./tldrawBoardSession";

export default function TldrawPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly boardId: WhiteboardId;
}) {
  const { environmentId, boardId } = props;
  const appearance = useRenderedAppearance();
  const [store] = useState(() => createTLStore());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const rightDrag = useRef<{
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly camera: { x: number; y: number; z: number };
  } | null>(null);
  const preventMenu = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the server's native tldraw records and flushes local edits before the board unmounts
  useLayoutEffect(() => {
    if (editor === null) return;
    const session = openTldrawBoardSession({
      editor,
      environmentId,
      target: boardId,
      onSaveFailed: setSaveFailed,
    });
    return session.close;
  }, [editor, environmentId, boardId]);

  return (
    <div
      role="application"
      aria-label="Whiteboard"
      className="relative h-full min-h-0 w-full [&_.tlui-layout]:h-full"
      data-testid="whiteboard-panel"
      data-whiteboard-keys
      data-whiteboard-engine="tldraw"
      onPointerDownCapture={(event) => {
        if (event.button !== 2) {
          preventMenu.current = false;
          return;
        }
        if (editor === null) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        rightDrag.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          camera: editor.getCamera(),
        };
        preventMenu.current = true;
      }}
      onPointerMoveCapture={(event) => {
        const drag = rightDrag.current;
        if (drag === null || drag.pointerId !== event.pointerId || editor === null) return;
        event.preventDefault();
        event.stopPropagation();
        editor.setCamera({
          x: drag.camera.x + (drag.clientX - event.clientX) / drag.camera.z,
          y: drag.camera.y + (drag.clientY - event.clientY) / drag.camera.z,
          z: drag.camera.z,
        });
      }}
      onPointerUpCapture={(event) => {
        if (rightDrag.current?.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        rightDrag.current = null;
      }}
      onPointerCancelCapture={() => {
        rightDrag.current = null;
      }}
      onContextMenuCapture={(event) => {
        if (!preventMenu.current) return;
        event.preventDefault();
        event.stopPropagation();
        preventMenu.current = false;
      }}
    >
      <Tldraw
        store={store}
        colorScheme={appearance}
        licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY || undefined}
        onMount={(mounted) => {
          setEditor(mounted);
          return () => setEditor(null);
        }}
      />
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
