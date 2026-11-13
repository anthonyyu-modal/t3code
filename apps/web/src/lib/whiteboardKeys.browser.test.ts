import { describe, expect, it } from "vite-plus/test";

import { isWhiteboardKey } from "./whiteboardKeys";

function keydown(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("isWhiteboardKey", () => {
  it.each([
    ["a tool key", { key: "r" }, "MacIntel", true],
    ["Escape", { key: "Escape" }, "MacIntel", true],
    ["an Alt chord", { key: "®", code: "KeyR", altKey: true }, "MacIntel", true],
    ["F6, which leaves the board", { key: "F6" }, "MacIntel", false],
    ["duplicate", { key: "d", metaKey: true }, "MacIntel", true],
    ["duplicate on Linux", { key: "d", ctrlKey: true }, "Linux x86_64", true],
    ["Ctrl+D on a Mac, which is not Excalidraw's", { key: "d", ctrlKey: true }, "MacIntel", false],
    ["the sidebar toggle", { key: "b", metaKey: true }, "MacIntel", false],
    [
      "send to back on a Mac",
      { key: "“", code: "BracketLeft", metaKey: true, altKey: true },
      "MacIntel",
      true,
    ],
    [
      "previous thread on a Mac",
      { key: "{", code: "BracketLeft", metaKey: true, shiftKey: true },
      "MacIntel",
      false,
    ],
    [
      "send to back on Linux",
      { key: "{", code: "BracketLeft", ctrlKey: true, shiftKey: true },
      "Linux x86_64",
      true,
    ],
  ] as const)("%s", (_name, init, platform, expected) => {
    const board = document.body.appendChild(document.createElement("div"));
    board.setAttribute("data-whiteboard-keys", "");
    const canvas = board.appendChild(document.createElement("canvas"));
    const outside = document.body.appendChild(document.createElement("div"));
    try {
      expect(isWhiteboardKey(keydown(canvas, init), platform)).toBe(expected);
      expect(isWhiteboardKey(keydown(outside, init), platform)).toBe(false);
    } finally {
      board.remove();
      outside.remove();
    }
  });
});
