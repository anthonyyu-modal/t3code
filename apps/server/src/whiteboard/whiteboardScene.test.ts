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

  it("styles a dark banner with a centred white label at fontSize 44", () => {
    const elements = edit([], {
      add: [
        {
          type: "rectangle",
          id: "banner",
          x: 0,
          y: 0,
          width: 1000,
          height: 80,
          backgroundColor: "#343a40",
          strokeColor: "#343a40",
          text: "Architecture Overview",
          textColor: "#ffffff",
          fontSize: 44,
        },
      ],
    }).elements;
    expect(describeWhiteboard(elements)).toEqual([
      {
        id: "banner",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 1000,
        height: 80,
        text: "Architecture Overview",
        strokeColor: "#343a40",
        backgroundColor: "#343a40",
        textColor: "#ffffff",
        fontSize: 44,
      },
    ]);
    const label = elements.find((element) => element.containerId === "banner");
    expect(label).toMatchObject({
      strokeColor: "#ffffff",
      fontSize: 44,
      fontFamily: 5,
      textAlign: "center",
      verticalAlign: "middle",
    });
    expect(Number(label?.x) + Number(label?.width) / 2).toBe(500);
    expect(Number(label?.y) + Number(label?.height) / 2).toBe(40);
  });

  it("supports text alignment on free text (with and without width) and shape labels", () => {
    const elements = edit([], {
      add: [
        { type: "text", id: "centered", x: 500, y: 0, text: "Center", textAlign: "center" },
        { type: "text", id: "right", x: 500, y: 40, text: "Right", textAlign: "right" },
        {
          type: "text",
          id: "wrapped",
          x: 100,
          y: 100,
          width: 240,
          text: "Right aligned inside a fixed width box",
          textAlign: "right",
        },
        {
          type: "rectangle",
          id: "tl",
          x: 0,
          y: 200,
          width: 200,
          height: 100,
          text: "Top left",
          textAlign: "left",
          verticalAlign: "top",
        },
        {
          type: "rectangle",
          id: "br",
          x: 300,
          y: 200,
          width: 200,
          height: 100,
          text: "Bottom right",
          textAlign: "right",
          verticalAlign: "bottom",
        },
      ],
    }).elements;

    const byId = new Map(elements.map((element) => [String(element.id), element]));
    const centered = byId.get("centered")!;
    expect(Number(centered.x) + Number(centered.width) / 2).toBe(500);
    expect(centered.autoResize).toBe(true);

    const right = byId.get("right")!;
    expect(Number(right.x) + Number(right.width)).toBe(500);

    const wrapped = byId.get("wrapped")!;
    expect(wrapped.x).toBe(100);
    expect(wrapped.width).toBe(240);
    expect(wrapped.autoResize).toBe(false);
    expect(String(wrapped.text)).toContain("\n");

    const tlLabel = elements.find((element) => element.containerId === "tl")!;
    expect(tlLabel).toMatchObject({ x: 5, y: 205, textAlign: "left", verticalAlign: "top" });

    const brLabel = elements.find((element) => element.containerId === "br")!;
    expect(Number(brLabel.x) + Number(brLabel.width)).toBe(495);
    expect(Number(brLabel.y) + Number(brLabel.height)).toBe(295);
    expect(brLabel).toMatchObject({ textAlign: "right", verticalAlign: "bottom" });

    const views = new Map(describeWhiteboard(elements).map((view) => [view.id, view]));
    expect(views.get("centered")?.textAlign).toBe("center");
    expect(views.get("right")?.textAlign).toBe("right");
    expect(views.get("tl")).toMatchObject({ textAlign: "left", verticalAlign: "top" });
    expect(views.get("br")).toMatchObject({ textAlign: "right", verticalAlign: "bottom" });

    // Growing a right-aligned autoResize text keeps its right edge pinned at 500.
    const updated = edit(elements, {
      update: [
        { id: "right", text: "Much longer right text" },
        { id: "tl", x: 50, y: 250, textColor: "#1971c2" },
      ],
    }).elements;
    const movedRight = updated.find((element) => element.id === "right")!;
    expect(Number(movedRight.x) + Number(movedRight.width)).toBe(500);
    const movedTlLabel = updated.find((element) => element.containerId === "tl")!;
    expect(movedTlLabel).toMatchObject({
      x: 55,
      y: 255,
      strokeColor: "#1971c2",
      textAlign: "left",
      verticalAlign: "top",
    });
  });

  it("maps every shipped font family with its Excalidraw lineHeight and decodes legacy fonts", () => {
    const elements = edit([], {
      add: [
        { type: "text", id: "f5", x: 0, y: 0, text: "Excalifont", fontFamily: "Excalifont" },
        { type: "text", id: "f6", x: 0, y: 40, text: "Nunito", fontFamily: "Nunito" },
        { type: "text", id: "f7", x: 0, y: 80, text: "Lilita", fontFamily: "Lilita One" },
        { type: "text", id: "f8", x: 0, y: 120, text: "Shanns", fontFamily: "Comic Shanns" },
        { type: "text", id: "f3", x: 0, y: 160, text: "Cascadia", fontFamily: "Cascadia" },
      ],
    }).elements;
    const raw = (id: string) => elements.find((element) => element.id === id)!;
    expect(raw("f5")).toMatchObject({ fontFamily: 5, lineHeight: 1.25, height: 25 });
    expect(raw("f6")).toMatchObject({ fontFamily: 6, lineHeight: 1.35, height: 27 });
    expect(raw("f7")).toMatchObject({ fontFamily: 7, lineHeight: 1.15, height: 23 });
    expect(raw("f8")).toMatchObject({ fontFamily: 8, lineHeight: 1.25, height: 25 });
    expect(raw("f3")).toMatchObject({ fontFamily: 3, lineHeight: 1.2, height: 24 });

    const withLegacy = [
      ...elements,
      drawn("legacy", 1, { type: "text", text: "Old", fontFamily: 1, fontSize: 20 }),
    ];
    const views = new Map(describeWhiteboard(withLegacy).map((view) => [view.id, view]));
    expect(views.get("f5")).not.toHaveProperty("fontFamily");
    expect(views.get("f6")?.fontFamily).toBe("Nunito");
    expect(views.get("f7")?.fontFamily).toBe("Lilita One");
    expect(views.get("f8")?.fontFamily).toBe("Comic Shanns");
    expect(views.get("f3")?.fontFamily).toBe("Cascadia");
    expect(views.get("legacy")?.fontFamily).toBe("Virgil");
  });

  it("supports strokeWidth, arrowheads, opacity, fillStyle, roughness, roundness and updates", () => {
    const elements = edit([], {
      add: [
        {
          type: "rectangle",
          id: "a",
          x: 0,
          y: 0,
          width: 180,
          height: 80,
          strokeWidth: 4,
          backgroundColor: "#e7f5ff",
          fillStyle: "hachure",
          roughness: 0,
          roundness: "sharp",
          opacity: 50,
          text: "Styled",
        },
        { type: "rectangle", id: "b", x: 400, y: 0, width: 140, height: 80, text: "Target" },
        {
          type: "arrow",
          id: "both",
          from: "a",
          to: "b",
          strokeWidth: 4,
          startArrowhead: "arrow",
          endArrowhead: "diamond_outline",
          roundness: "sharp",
        },
        {
          type: "arrow",
          id: "plain-arrow",
          points: [
            [0, 140],
            [200, 140],
          ],
          endArrowhead: "none",
        },
      ],
    }).elements;

    const views = new Map(describeWhiteboard(elements).map((view) => [view.id, view]));
    expect(views.get("a")).toMatchObject({
      strokeWidth: 4,
      fillStyle: "hachure",
      roughness: 0,
      roundness: "sharp",
      opacity: 50,
    });
    expect(views.get("both")).toMatchObject({
      strokeWidth: 4,
      startArrowhead: "arrow",
      endArrowhead: "diamond_outline",
      roundness: "sharp",
    });
    expect(views.get("plain-arrow")).toMatchObject({ endArrowhead: "none" });
    expect(views.get("plain-arrow")).not.toHaveProperty("startArrowhead");

    // Bound label inherits container opacity, and updating opacity alone keeps label box intact.
    const labelBefore = elements.find((element) => element.containerId === "a")!;
    expect(labelBefore.opacity).toBe(50);

    const updated = edit(elements, {
      update: [
        {
          id: "a",
          strokeWidth: 2,
          fillStyle: "solid",
          roughness: 1,
          roundness: "round",
          opacity: 100,
        },
        { id: "both", startArrowhead: "none", endArrowhead: "arrow", roundness: "round" },
        { id: "plain-arrow", startArrowhead: "crowfoot_many", endArrowhead: "triangle" },
      ],
    }).elements;
    const labelAfter = updated.find((element) => element.containerId === "a")!;
    expect(labelAfter).toMatchObject({
      opacity: 100,
      x: labelBefore.x,
      y: labelBefore.y,
      width: labelBefore.width,
      height: labelBefore.height,
    });
    const nextViews = new Map(describeWhiteboard(updated).map((view) => [view.id, view]));
    expect(nextViews.get("a")).not.toHaveProperty("strokeWidth");
    expect(nextViews.get("a")).not.toHaveProperty("fillStyle");
    expect(nextViews.get("a")).not.toHaveProperty("roughness");
    expect(nextViews.get("a")).not.toHaveProperty("roundness");
    expect(nextViews.get("a")).not.toHaveProperty("opacity");
    expect(nextViews.get("both")).not.toHaveProperty("startArrowhead");
    expect(nextViews.get("both")).not.toHaveProperty("endArrowhead");
    expect(nextViews.get("both")).not.toHaveProperty("roundness");
    expect(nextViews.get("plain-arrow")).toMatchObject({
      startArrowhead: "crowfoot_many",
      endArrowhead: "triangle",
    });
  });

  it("groups elements on add and update, syncs bound labels, and ungroups with empty string", () => {
    const elements = edit([], {
      add: [
        {
          type: "rectangle",
          id: "card",
          x: 0,
          y: 0,
          width: 300,
          height: 150,
          strokeColor: "#1971c2",
          backgroundColor: "#ffffff",
          group: "card-1",
        },
        {
          type: "text",
          id: "card-name",
          x: 16,
          y: 12,
          width: 268,
          text: "Launcher",
          fontSize: 24,
          textColor: "#1971c2",
          group: "card-1",
        },
        {
          type: "text",
          id: "card-desc",
          x: 16,
          y: 50,
          width: 268,
          text: "Finds or creates the conversation sandbox.",
          fontSize: 16,
          group: "card-1",
        },
        {
          type: "rectangle",
          id: "labelled",
          x: 400,
          y: 0,
          width: 160,
          height: 80,
          text: "Grouped box",
          group: "box-g",
        },
      ],
    }).elements;

    const views = new Map(describeWhiteboard(elements).map((view) => [view.id, view]));
    expect(views.get("card")?.group).toBe("card-1");
    expect(views.get("card-name")).toMatchObject({ group: "card-1", strokeColor: "#1971c2" });
    expect(views.get("card-desc")?.group).toBe("card-1");
    expect(views.get("labelled")?.group).toBe("box-g");
    const boundLabel = elements.find((element) => element.containerId === "labelled")!;
    expect(boundLabel.groupIds).toEqual(["box-g"]);
    expect(whiteboardLayoutWarnings(elements, new Set(["card", "card-name", "card-desc"]))).toEqual(
      [],
    );

    const ungrouped = edit(elements, {
      update: [
        { id: "card-desc", group: "other" },
        { id: "labelled", group: "" },
      ],
    }).elements;
    const nextViews = new Map(describeWhiteboard(ungrouped).map((view) => [view.id, view]));
    expect(nextViews.get("card-desc")?.group).toBe("other");
    expect(nextViews.get("labelled")).not.toHaveProperty("group");
    expect(ungrouped.find((element) => element.containerId === "labelled")?.groupIds).toEqual([]);

    // User-created nested groups report the outermost group id.
    const nested = [drawn("n", 1, { groupIds: ["inner", "outer"] })];
    expect(describeWhiteboard(nested)[0]?.group).toBe("outer");
  });

  it("refuses invalid style values and incompatible types without changing the board", () => {
    const before = twoBoxes();
    const bad = applyWhiteboardEdit(
      before,
      {
        update: [
          { id: "plain", opacity: 120, startArrowhead: "arrow" },
          { id: "plain", group: "   " },
        ],
        add: [
          {
            type: "text",
            x: 0,
            y: 0,
            text: "hi",
            fontFamily: "Comic Sans" as never,
            textAlign: "justify" as never,
            verticalAlign: "top",
            strokeWidth: 4,
            roundness: "sharp",
          },
          {
            type: "rectangle",
            x: 0,
            y: 0,
            strokeWidth: 0,
            opacity: -5,
            roughness: 3 as never,
            fillStyle: "dots" as never,
            group: "",
          },
          {
            type: "ellipse",
            x: 0,
            y: 0,
            roundness: "sharp",
          },
          {
            type: "line",
            points: [
              [0, 0],
              [100, 0],
            ],
            endArrowhead: "arrow",
          },
          {
            type: "arrow",
            points: [
              [0, 0],
              [100, 0],
            ],
            startArrowhead: "star" as never,
            verticalAlign: "top",
          },
        ],
      },
      env(),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.problems).toEqual([
      "update: opacity must be between 0 and 100, got 120.",
      "update: startArrowhead only applies to arrows, not rectangle.",
      'update: group cannot be blank, got "   ".',
      "add: strokeWidth does not apply to text.",
      "add: roundness does not apply to text.",
      'add: invalid fontFamily "Comic Sans".',
      'add: invalid textAlign "justify".',
      "add: verticalAlign only applies to shapes, not text.",
      'add: invalid fillStyle "dots".',
      "add: strokeWidth must be positive, got 0.",
      'add: invalid roughness "3".',
      "add: opacity must be between 0 and 100, got -5.",
      'add: group cannot be empty, got "".',
      "add: roundness does not apply to ellipse.",
      "add: endArrowhead only applies to arrows, not line.",
      "add: verticalAlign only applies to shapes, not arrow.",
      'add: invalid startArrowhead "star".',
    ]);
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
    expect(
      whiteboardChangeNote(changes ?? { added: [], changed: [], removed: [] }, 4, "Flow"),
    ).toBe(
      [
        'The whiteboard "Flow", which this thread\'s Whiteboard tab shows, changed since you last saw it (now revision 4).',
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
