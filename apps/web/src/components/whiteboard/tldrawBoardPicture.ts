import type { Editor } from "tldraw";

import { PICTURE_MAX_EDGE, pictureFromBlob } from "./boardPicture";

export async function drawTldrawBoardPicture(editor: Editor) {
  const shapes = editor.getCurrentPageShapesSorted();
  const bounds = editor.getCurrentPageBounds();
  if (shapes.length === 0 || bounds === undefined) throw new Error("The board is empty.");
  const scale = Math.min(1, PICTURE_MAX_EDGE / Math.max(bounds.w + 48, bounds.h + 48));
  const { blob } = await editor.toImage(shapes, {
    format: "png",
    background: true,
    darkMode: false,
    scale,
    pixelRatio: 1,
    padding: 24,
  });
  return pictureFromBlob(blob);
}
