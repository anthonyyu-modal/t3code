import "./components/whiteboard/excalidrawAssets";

import { restoreElements } from "@excalidraw/excalidraw";
import type { WhiteboardElement, WhiteboardEngine, WhiteboardFiles } from "@t3tools/contracts";

import { drawBoardPicture } from "./components/whiteboard/boardPicture";

type Files = Parameters<typeof drawBoardPicture>[0]["files"];

/** The server opens this page to draw a board whether or not a window has it open. */
export const drawWhiteboard = async (scene: {
  readonly engine?: WhiteboardEngine | undefined;
  readonly elements: ReadonlyArray<WhiteboardElement>;
  readonly files: WhiteboardFiles;
}) => {
  if (scene.engine === "tldraw") {
    const { drawTldrawWhiteboard } = await import("./components/whiteboard/tldrawPicturePage");
    return drawTldrawWhiteboard(scene);
  }
  return drawBoardPicture({
    elements: restoreElements(scene.elements as never, null, { repairBindings: true }),
    files: scene.files as unknown as Files,
  });
};

Object.assign(window, { drawWhiteboard });
