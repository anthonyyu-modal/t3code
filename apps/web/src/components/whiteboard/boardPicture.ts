import { exportToBlob } from "@excalidraw/excalidraw";

// The longest edge Claude reads without downscaling; a larger picture only costs tokens.
export const PICTURE_MAX_EDGE = 1568;

type Scene = Pick<Parameters<typeof exportToBlob>[0], "elements" | "files">;

export async function pictureFromBlob(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return { mimeType: "image/png" as const, data: btoa(binary), ...size };
}

/** The board as the PNG an agent is shown, whoever draws it: a window or the server's own page. */
export async function drawBoardPicture(scene: Scene) {
  const blob = await exportToBlob({
    ...scene,
    // Always the light board, so colours the agent names match what whiteboard_read reports.
    appState: {
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: "#ffffff",
    },
    mimeType: "image/png",
    exportPadding: 24,
    getDimensions: (width: number, height: number) => {
      const scale = Math.min(1, PICTURE_MAX_EDGE / Math.max(width, height));
      return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
    },
  });
  return pictureFromBlob(blob);
}
