import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { type MouseEvent, type PointerEvent, useRef } from "react";

const DRAG_THRESHOLD_PX = 4;
const RIGHT_BUTTON = 2;

interface RightDrag {
  readonly pointerId: number;
  readonly canvas: HTMLCanvasElement;
  readonly x: number;
  readonly y: number;
  readonly moved: boolean;
}

/**
 * Pans the board while the right mouse button drags across the canvas, which Excalidraw only does
 * for Space-drag and the middle button. A right click that does not drag still opens its menu.
 */
export function useRightDragPan(board: ExcalidrawImperativeAPI | null) {
  const drag = useRef<RightDrag | null>(null);

  const end = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active === null || event.pointerId !== active.pointerId) return null;
    drag.current = null;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    return active;
  };

  return {
    onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== RIGHT_BUTTON || board === null) return;
      if (!(event.target instanceof HTMLCanvasElement)) return;
      drag.current = {
        pointerId: event.pointerId,
        canvas: event.target,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.stopPropagation();
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => {
      const active = drag.current;
      if (active === null || board === null || event.pointerId !== active.pointerId) return;
      event.stopPropagation();
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      if (!active.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      const state = board.getAppState();
      board.updateScene({
        appState: {
          scrollX: state.scrollX + dx / state.zoom.value,
          scrollY: state.scrollY + dy / state.zoom.value,
        },
      });
      drag.current = { ...active, x: event.clientX, y: event.clientY, moved: true };
    },
    onPointerUpCapture: (event: PointerEvent<HTMLDivElement>) => {
      const finished = end(event);
      if (finished === null || finished.moved) return;
      finished.canvas.dispatchEvent(
        new window.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: RIGHT_BUTTON,
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      );
    },
    onPointerCancelCapture: (event: PointerEvent<HTMLDivElement>) => {
      end(event);
    },
    // macOS raises the menu when the button goes down, before a drag can start, so the browser's
    // own event is dropped and the release above raises the menu instead.
    onContextMenuCapture: (event: MouseEvent<HTMLDivElement>) => {
      if (!event.nativeEvent.isTrusted || event.button !== RIGHT_BUTTON) return;
      if (!(event.target instanceof HTMLCanvasElement)) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
