import { WHITEBOARD_MAX_FILE_DATA_URL_LENGTH } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  anyOutsideViewport,
  holdsEverySynced,
  markSynced,
  toWireElements,
  unsavedElements,
  unsentFiles,
} from "./whiteboardSync";

describe("whiteboardSync", () => {
  it("saves only elements whose version the server does not hold yet", () => {
    const synced = new Map<string, number>();
    const elements = [
      { id: "a", version: 3 },
      { id: "b", version: 1, isDeleted: true },
    ];
    expect(unsavedElements(elements, synced)).toEqual(elements);
    markSynced(synced, toWireElements(elements));
    expect(unsavedElements(elements, synced)).toEqual([]);
    expect(unsavedElements([{ id: "a", version: 4 }, elements[1]!], synced)).toEqual([
      { id: "a", version: 4 },
    ]);
  });

  it("notices a swapped scene by an element that is gone instead of deleted", () => {
    const synced = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const mine = { id: "new", version: 1 };
    expect(holdsEverySynced([{ id: "a", version: 5 }, mine], synced)).toBe(false);
    expect(
      holdsEverySynced(
        [{ id: "a", version: 5 }, { id: "b", version: 3, isDeleted: true }, mine],
        synced,
      ),
    ).toBe(true);
  });

  it("drops the undefined properties Excalidraw leaves on elements, which cannot be encoded", () => {
    const element = { id: "a", version: 1, customData: undefined, link: null };
    expect(toWireElements([element])).toEqual([{ id: "a", version: 1, link: null }]);
  });

  it("sends each image on the board once, and keeps oversized ones on this device", () => {
    const image = (fileId: string, isDeleted = false) => ({
      id: `element-${fileId}`,
      version: 1,
      type: "image",
      fileId,
      isDeleted,
    });
    const file = (dataURL: string) => ({ mimeType: "image/png", dataURL, created: 1 });
    const files = {
      small: file("data:image/png;base64,AAAA"),
      sent: file("data:image/png;base64,BBBB"),
      erased: file("data:image/png;base64,CCCC"),
      huge: file("x".repeat(WHITEBOARD_MAX_FILE_DATA_URL_LENGTH + 1)),
    };
    const elements = [image("small"), image("sent"), image("erased", true), image("huge")];
    expect(unsentFiles(files, elements, new Set(["sent"]))).toEqual({ small: files.small });
  });

  it("notices a drawing that falls outside what the window shows", () => {
    const view = { scrollX: -100, scrollY: 0, width: 800, height: 600, zoom: 2 };
    const box = (x: number, y: number) => ({ id: "a", version: 1, x, y, width: 50, height: 50 });
    expect(anyOutsideViewport([box(120, 20), box(440, 240)], view)).toBe(false);
    expect(anyOutsideViewport([box(120, 20), box(480, 20)], view)).toBe(true);
    expect(anyOutsideViewport([box(60, 20)], view)).toBe(true);
  });
});
