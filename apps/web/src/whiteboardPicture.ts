import "./components/whiteboard/excalidrawAssets";

import { restoreElements } from "@excalidraw/excalidraw";
import type { WhiteboardElement, WhiteboardFiles } from "@t3tools/contracts";

import { drawBoardPicture } from "./components/whiteboard/boardPicture";

type Files = Parameters<typeof drawBoardPicture>[0]["files"];

/**
 * The page the server opens in its own headless browser to draw a board that no window has open
 * (apps/server/src/whiteboard/WhiteboardPictures.ts). It is sent the board's live elements and
 * the images they show, and takes them in the way a window takes in the server's scene.
 */
export const drawWhiteboard = (scene: {
  readonly elements: ReadonlyArray<WhiteboardElement>;
  readonly files: WhiteboardFiles;
}) =>
  drawBoardPicture({
    elements: restoreElements(scene.elements as never, null, { repairBindings: true }),
    files: scene.files as unknown as Files,
  });

Object.assign(window, { drawWhiteboard });
