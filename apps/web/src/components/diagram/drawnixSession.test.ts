import { ThemeColorMode } from "@plait/core";
import { describe, expect, it } from "vite-plus/test";

import { parseDrawnixDocument, serializeDrawnixDocument } from "./drawnixSession";

describe("drawnixSession codec", () => {
  it("round-trips elements, viewport, and theme in standard .drawnix v2 JSON", () => {
    const serialized = serializeDrawnixDocument({
      elements: [{ id: "node-1", type: "geometry" }],
      viewport: { zoom: 1.25, origination: [10, 20] },
      theme: { themeColorMode: ThemeColorMode.dark },
    });
    const parsed = parseDrawnixDocument(serialized);
    expect(parsed).toEqual({
      elements: [{ id: "node-1", type: "geometry" }],
      viewport: { zoom: 1.25, origination: [10, 20] },
      theme: { themeColorMode: ThemeColorMode.dark },
    });
  });

  it("falls back to an empty board when JSON is malformed", () => {
    expect(parseDrawnixDocument("{not-json")).toEqual({ elements: [] });
  });
});
