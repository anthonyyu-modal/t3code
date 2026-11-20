import type { WhiteboardElement, WhiteboardFiles } from "@t3tools/contracts";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createTLStore, Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";

import { drawTldrawBoardPicture } from "./tldrawBoardPicture";
import { fromWireRecords } from "./tldrawRecords";

export async function drawTldrawWhiteboard(scene: {
  readonly elements: ReadonlyArray<WhiteboardElement>;
  readonly files: WhiteboardFiles;
}) {
  const records = fromWireRecords(scene.elements, scene.files);
  const store = createTLStore({
    initialData: Object.fromEntries(records.map((record) => [record.id, record])),
  });
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1024px;height:768px;pointer-events:none";
  document.body.append(host);
  const root = createRoot(host);
  let ready!: (editor: Editor) => void;
  const mounted = new Promise<Editor>((resolve) => {
    ready = resolve;
  });
  try {
    root.render(
      createElement(Tldraw, {
        store,
        licenseKey: import.meta.env.VITE_TLDRAW_LICENSE_KEY || undefined,
        onMount: (editor) => {
          ready(editor);
        },
      }),
    );
    return await drawTldrawBoardPicture(await mounted);
  } finally {
    root.unmount();
    host.remove();
  }
}
