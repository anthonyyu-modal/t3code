import type { WhiteboardElement } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyWhiteboardEdit,
  describeWhiteboard,
  mergeWhiteboardElements,
  nextFractionalIndex,
  whiteboardChangeNote,
  whiteboardLayoutWarnings,
  whiteboardChangesSince,
  whiteboardSeenVersions,
  type WhiteboardEdit,
} from "./whiteboardScene.ts";

const NOW = 1_800_000_000_000;

function env() {
  let next = 0;
  return { now: NOW, random: () => 0.5, makeId: () => `gen-${++next}` };
}

function edit(elements: ReadonlyArray<WhiteboardElement>, change: WhiteboardEdit) {
  const outcome = applyWhiteboardEdit(elements, change, env());
  if (!outcome.ok) throw new Error(outcome.problems.join(" "));
  return outcome;
}

const drawn = (id: string, version: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  version,
  versionNonce: 10,
  isDeleted: false,
  updated: NOW,
  ...extra,
});

const twoBoxes = () =>
  edit([], {
    add: [
      { type: "rectangle", id: "plain", x: 0, y: 0, width: 120, height: 70, text: "Plain" },
      { type: "ellipse", id: "trace", x: 300, y: 0, width: 120, height: 70, text: "Trace" },
      { type: "arrow", id: "link", from: "plain", to: "trace", text: "message" },
    ],
  }).elements;

describe("mergeWhiteboardElements", () => {
  it("keeps the newer version of each element, and breaks a tie on the lower nonce", () => {
    const stored = [drawn("a", 3), drawn("b", 2, { versionNonce: 5 }), drawn("c", 1)];
    const incoming = [
      drawn("a", 2, { x: 99 }),
      drawn("b", 2, { versionNonce: 4, x: 7 }),
      drawn("c", 2, { x: 5 }),
      drawn("d", 1),
    ];
    const merged = mergeWhiteboardElements(stored, incoming, NOW);
    expect(merged.changed).toBe(true);
    expect(merged.elements.map((element) => [element.id, element.x])).toEqual([
      ["a", 0],
      ["b", 7],
      ["c", 5],
      ["d", 0],
    ]);
  });

  it("does not let a window that never saw an element delete it or bring a deleted one back", () => {
    const stored = [drawn("agent-added", 1), drawn("gone", 4, { isDeleted: true })];
    const merged = mergeWhiteboardElements(stored, [drawn("gone", 3), drawn("mine", 1)], NOW);
    expect(describeWhiteboard(merged.elements).map((view) => view.id)).toEqual([
      "agent-added",
      "mine",
    ]);
  });

  it("reports no change for a save that carries nothing new", () => {
    const stored = [drawn("a", 3)];
    expect(mergeWhiteboardElements(stored, [drawn("a", 3)], NOW).changed).toBe(false);
    expect(
      mergeWhiteboardElements(stored, [drawn("never-seen", 2, { isDeleted: true })], NOW).changed,
    ).toBe(false);
  });

  it("drops deleted elements once they are a day old and orders the rest by fractional index", () => {
    const day = 24 * 60 * 60 * 1000;
    const stored = [
      drawn("top", 1, { index: "a2" }),
      drawn("old", 2, { isDeleted: true, updated: NOW - day - 1 }),
      drawn("recent", 2, { isDeleted: true, updated: NOW - 1000, index: "a1" }),
      drawn("agent", 1, { index: null }),
      drawn("bottom", 1, { index: "a0" }),
    ];
    expect(mergeWhiteboardElements(stored, [], NOW).elements.map((element) => element.id)).toEqual([
      "bottom",
      "recent",
      "top",
      "agent",
    ]);
  });
});

describe("applyWhiteboardEdit", () => {
  it("adds labelled shapes and an arrow bound to both of them", () => {
    const elements = twoBoxes();
    expect(describeWhiteboard(elements)).toEqual([
      { id: "plain", type: "rectangle", x: 0, y: 0, width: 120, height: 70, text: "Plain" },
      { id: "trace", type: "ellipse", x: 300, y: 0, width: 120, height: 70, text: "Trace" },
      {
        id: "link",
        type: "arrow",
        x: 126,
        y: 35,
        width: 168,
        height: 0,
        text: "message",
        from: "plain",
        to: "trace",
        start: [126, 35],
        end: [294, 35],
      },
    ]);
    const plain = elements.find((element) => element.id === "plain");
    expect(plain?.boundElements).toEqual([
      { id: "gen-1", type: "text" },
      { id: "link", type: "arrow" },
    ]);
    const label = elements.find((element) => element.id === "gen-1");
    expect(label).toMatchObject({ containerId: "plain", text: "Plain", textAlign: "center" });
    expect(Number(label?.x) + Number(label?.width) / 2).toBe(60);
  });

  it("moves a shape's label and reroutes its arrows when the shape moves", () => {
    const moved = edit(twoBoxes(), { update: [{ id: "trace", x: 0, y: 300 }] }).elements;
    const arrow = describeWhiteboard(moved).find((view) => view.id === "link");
    expect(arrow).toMatchObject({ start: [60, 76], end: [60, 294] });
    const label = moved.find((element) => element.containerId === "trace");
    expect(Number(label?.y) + Number(label?.height) / 2).toBe(335);
  });

  it("wraps a label inside the width it was given, growing only for its longest word", () => {
    const boxed = (width: number) => {
      const elements = edit([], {
        add: [
          { type: "rectangle", id: "a", x: 0, y: 0, width, height: 20, text: "Trace controller" },
        ],
      }).elements;
      const label = elements.find((element) => element.containerId === "a");
      return { ...describeWhiteboard(elements)[0], shown: label?.text };
    };
    expect(boxed(240)).toMatchObject({ width: 240, height: 45, shown: "Trace controller" });
    expect(boxed(60)).toMatchObject({
      width: 140,
      height: 70,
      text: "Trace controller",
      shown: "Trace\ncontroller",
    });
  });

  it("warns about shapes that overlap and arrows too short for their label", () => {
    const crowded = edit([], {
      add: [
        { type: "rectangle", id: "a", x: 0, y: 0, width: 140, height: 70, text: "Plain" },
        { type: "rectangle", id: "b", x: 200, y: 0, width: 140, height: 70, text: "Trace" },
        { type: "rectangle", id: "c", x: 300, y: 40, width: 140, height: 70 },
        { type: "rectangle", id: "frame", x: -20, y: -20, width: 600, height: 300 },
        { type: "arrow", id: "link", from: "a", to: "b", text: "webhook" },
      ],
    }).elements;
    const all = new Set(crowded.map((element) => String(element.id)));
    expect(whiteboardLayoutWarnings(crowded, all)).toEqual([
      'rectangle "Trace" (id b) overlaps rectangle (id c).',
      'arrow "webhook" from "Plain" to "Trace" (id link) is 48 long but its label needs about 124; move its ends further apart.',
    ]);
    expect(whiteboardLayoutWarnings(crowded, new Set(["a"]))).toEqual([]);
  });

  it("renames a shape through its label and removes the label when the text is emptied", () => {
    const renamed = edit(twoBoxes(), { update: [{ id: "plain", text: "Plain thread" }] }).elements;
    expect(describeWhiteboard(renamed)[0]).toMatchObject({
      id: "plain",
      text: "Plain thread",
      width: 120,
    });
    const cleared = edit(renamed, { update: [{ id: "plain", text: "" }] }).elements;
    expect(describeWhiteboard(cleared)[0]).not.toHaveProperty("text");
  });

  it("removing a shape deletes its label and frees the arrow that pointed at it", () => {
    const elements = edit(twoBoxes(), { remove: ["trace"] }).elements;
    expect(describeWhiteboard(elements).map((view) => view.id)).toEqual(["plain", "link"]);
    expect(describeWhiteboard(elements)[1]).toMatchObject({ from: "plain" });
    expect(describeWhiteboard(elements)[1]).not.toHaveProperty("to");
  });

  it("bumps the version of every element it touches, so open windows accept the change", () => {
    const before = twoBoxes();
    const after = edit(before, { update: [{ id: "plain", backgroundColor: "#a5d8ff" }] }).elements;
    const version = (elements: ReadonlyArray<WhiteboardElement>, id: string) =>
      elements.find((element) => element.id === id)?.version;
    expect(version(after, "plain")).toBe(Number(version(before, "plain")) + 1);
    expect(version(after, "trace")).toBe(version(before, "trace"));
  });

  it("clears the board and draws again in one edit", () => {
    const elements = edit(twoBoxes(), {
      clear: true,
      add: [{ type: "text", x: 10, y: 10, text: "fresh start" }],
    }).elements;
    expect(describeWhiteboard(elements)).toEqual([
      { id: "gen-1", type: "text", x: 10, y: 10, width: 132, height: 25, text: "fresh start" },
    ]);
  });

  it("changes nothing and names each problem when any part of the edit is invalid", () => {
    const before = twoBoxes();
    const outcome = applyWhiteboardEdit(
      before,
      {
        remove: ["nope"],
        update: [{ id: "missing", x: 1 }],
        add: [
          { type: "rectangle", id: "plain", x: 0, y: 0 },
          { type: "ellipse" },
          { type: "arrow", from: "plain", to: "ghost" },
          { type: "line", points: [[0, 0]] },
        ],
      },
      env(),
    );
    expect(outcome).toEqual({
      ok: false,
      problems: [
        'remove: no element has id "nope".',
        'update: no element has id "missing".',
        'add: id "plain" is already used on this board.',
        "add: a ellipse needs x and y.",
        'add: arrow refers to "ghost", which is not on the board.',
        "add: a line needs both from and to, or at least two points.",
      ],
    });
  });
});

describe("nextFractionalIndex", () => {
  it("counts up in Excalidraw's key format, growing a digit when one runs out", () => {
    expect(nextFractionalIndex(null)).toBe("a0");
    expect(nextFractionalIndex("a0")).toBe("a1");
    expect(nextFractionalIndex("a9")).toBe("aA");
    expect(nextFractionalIndex("a0V")).toBe("a1");
    expect(nextFractionalIndex("az")).toBe("b00");
    expect(nextFractionalIndex("b0z")).toBe("b10");
    expect(nextFractionalIndex("Zz")).toBeNull();
  });

  it("puts what an agent adds above everything on the board, in drawing order", () => {
    const indexes = (elements: ReadonlyArray<WhiteboardElement>) =>
      elements.map((element) => element.index);
    const first = twoBoxes();
    expect(indexes(first)).toEqual(["a0", "a1", "a2", "a3", "a4", "a5"]);
    const onTop = edit([...first, drawn("user", 1, { index: "a5V" })], {
      add: [{ type: "text", id: "note", x: 0, y: 0, text: "note" }],
    }).elements;
    expect(indexes(onTop).at(-1)).toBe("a6");
  });
});

describe("whiteboardChangesSince", () => {
  it("reports nothing when the board is as the agent last saw it", () => {
    const elements = twoBoxes();
    expect(whiteboardChangesSince(whiteboardSeenVersions(elements), elements)).toBeNull();
    expect(whiteboardChangesSince(null, [])).toBeNull();
  });

  it("names what the user added, changed and removed, by label", () => {
    const seen = twoBoxes();
    const label = seen.find((element) => element.containerId === "plain");
    const userEdited = mergeWhiteboardElements(
      seen,
      [
        { ...label, version: 2, text: "Plain inbox", originalText: "Plain inbox" },
        { ...seen.find((element) => element.id === "trace"), version: 9, isDeleted: true },
        { ...seen.find((element) => element.containerId === "trace"), version: 9, isDeleted: true },
        drawn("note", 1, { type: "text", text: "why two hops?" }),
      ],
      NOW,
    ).elements;
    const changes = whiteboardChangesSince(whiteboardSeenVersions(seen), userEdited);
    expect(changes).toEqual({
      added: ['text "why two hops?" (id note)'],
      changed: ['rectangle "Plain inbox" (id plain)'],
      removed: ['ellipse "Trace" (id trace)'],
    });
    expect(whiteboardChangeNote(changes ?? { added: [], changed: [], removed: [] }, 4, null)).toBe(
      [
        "The user changed this thread's whiteboard since you last saw it (now revision 4).",
        'Added: text "why two hops?" (id note).',
        'Changed: rectangle "Plain inbox" (id plain).',
        'Removed: ellipse "Trace" (id trace).',
        "Call whiteboard_read for the whole board, or whiteboard_view for a picture of it.",
      ].join("\n"),
    );
  });

  it("treats a board the agent never saw as all additions", () => {
    expect(whiteboardChangesSince(null, twoBoxes())?.added).toEqual([
      'rectangle "Plain" (id plain)',
      'ellipse "Trace" (id trace)',
      'arrow "message" from "Plain" to "Trace" (id link)',
    ]);
  });
});
