import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { useRightDragPan } from "./useRightDragPan";

const board = {
  getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 1 } }),
  updateScene: () => {},
} as unknown as ExcalidrawImperativeAPI;

function Board() {
  return (
    <div {...useRightDragPan(board)}>
      <canvas data-testid="canvas" width={200} height={200} />
    </div>
  );
}

// Chromium on macOS and Linux raises the browser's menu as the button goes down, after the hook
// has captured the pointer. Left uncancelled, the desktop app opens its native Cut/Copy/Paste menu,
// which holds the mouse and stalls the pan.
it("keeps the native menu shut on a right click and opens the board's own on release", async () => {
  await using screen = await render(<Board />);
  // Captured at the window, ahead of the board, and read once dispatch has finished.
  const events: MouseEvent[] = [];
  const record = (event: MouseEvent) => events.push(event);
  window.addEventListener("contextmenu", record, true);
  using _listener = {
    [Symbol.dispose]: () => window.removeEventListener("contextmenu", record, true),
  };

  await userEvent.click(screen.getByTestId("canvas"), { button: "right" });

  const menus = events.map((event) => ({
    trusted: event.isTrusted,
    cancelled: event.defaultPrevented,
    onCanvas: event.target instanceof HTMLCanvasElement,
  }));
  const native = menus.filter((menu) => menu.trusted);
  expect(native.length).toBeGreaterThan(0);
  expect(native.every((menu) => menu.cancelled)).toBe(true);
  expect(menus.filter((menu) => !menu.trusted)).toEqual([
    { trusted: false, cancelled: false, onCanvas: true },
  ]);
});
