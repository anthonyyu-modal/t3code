import type { WhiteboardElement } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyTldrawEdit,
  describeTldrawWhiteboard,
  emptyTldrawElements,
  tldrawChangesSince,
  tldrawSeenVersions,
} from "./tldrawScene.ts";
import type { WhiteboardEdit } from "./whiteboardScene.ts";

const NOW = 1_800_000_000_000;
const env = () => {
  let next = 0;
  return { now: NOW, random: () => 0.5, makeId: () => `generated-${++next}` };
};
const edit = (elements: ReadonlyArray<WhiteboardElement>, change: WhiteboardEdit) => {
  const outcome = applyTldrawEdit(elements, change, env());
  if (!outcome.ok) throw new Error(outcome.problems.join(" "));
  return outcome.elements;
};
const twoBoxes = () =>
  edit(emptyTldrawElements(), {
    add: [
      { type: "rectangle", id: "plain", x: 0, y: 0, width: 120, height: 70, text: "Plain" },
      { type: "ellipse", id: "trace", x: 300, y: 0, width: 120, height: 70, text: "Trace" },
      { type: "arrow", id: "link", from: "plain", to: "trace", text: "message" },
    ],
  });

describe("tldraw whiteboard edits", () => {
  it("adds native shapes and arrow bindings and reads them through the shared tool model", () => {
    const elements = twoBoxes();
    expect(describeTldrawWhiteboard(elements)).toEqual([
      {
        id: "plain",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 120,
        height: 70,
        text: "Plain",
      },
      {
        id: "trace",
        type: "ellipse",
        x: 300,
        y: 0,
        width: 120,
        height: 70,
        text: "Trace",
      },
      {
        id: "link",
        type: "arrow",
        x: 120,
        y: 35,
        width: 180,
        height: 0,
        text: "message",
        from: "plain",
        to: "trace",
        start: [120, 35],
        end: [300, 35],
      },
    ]);
    expect(elements.filter((element) => element.typeName === "binding")).toHaveLength(2);
    expect(elements.find((element) => element.id === "shape:plain")).toMatchObject({
      typeName: "shape",
      type: "geo",
      parentId: "page:page",
      props: { geo: "rectangle", w: 120, h: 70 },
    });
  });

  it("leaves bindings native while reporting their rerouted endpoints after a shape moves", () => {
    const before = twoBoxes();
    const after = edit(before, { update: [{ id: "trace", x: 0, y: 300 }] });
    expect(describeTldrawWhiteboard(after).find((view) => view.id === "link")).toMatchObject({
      start: [60, 70],
      end: [60, 300],
    });
    expect(after.find((element) => element.id === "shape:link")?.version).toBe(
      before.find((element) => element.id === "shape:link")?.version,
    );
  });

  it("preserves rich-text marks on geometry edits and replaces text only when asked", () => {
    const before = twoBoxes();
    const shape = before.find((element) => element.id === "shape:plain")!;
    const richText = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Plain", marks: [{ type: "bold" }] }],
        },
      ],
    };
    const withRichText = before.map((element) =>
      element.id === shape.id
        ? { ...element, props: { ...(element.props as object), richText } }
        : element,
    );
    const moved = edit(withRichText, { update: [{ id: "plain", x: 40 }] });
    const movedShape = moved.find((element) => element.id === "shape:plain")!;
    expect((movedShape.props as { richText?: unknown }).richText).toEqual(richText);
    const renamed = edit(moved, { update: [{ id: "plain", text: "Controller" }] });
    expect(describeTldrawWhiteboard(renamed)[0]?.text).toBe("Controller");
  });

  it("uses native group parents and keeps world coordinates stable when ungrouping", () => {
    const grouped = edit(emptyTldrawElements(), {
      add: [
        { type: "rectangle", id: "a", x: 100, y: 100, group: "flow" },
        { type: "rectangle", id: "b", x: 400, y: 100, group: "flow" },
      ],
    });
    const group = grouped.find((element) => element.type === "group")!;
    expect(group.id).toBe("shape:group:flow");
    expect(describeTldrawWhiteboard(grouped).map((view) => view.group)).toEqual(["flow", "flow"]);
    const movedGroup = grouped.map((element) =>
      element.id === group.id ? { ...element, x: 50, y: 20 } : element,
    );
    expect(describeTldrawWhiteboard(movedGroup)[0]).toMatchObject({ x: 150, y: 120 });
    const ungrouped = edit(movedGroup, { update: [{ id: "a", group: "" }] });
    expect(ungrouped.find((element) => element.id === "shape:a")).toMatchObject({
      parentId: "page:page",
      x: 150,
      y: 120,
    });
  });

  it("renames native frames and rejects edits that would invent invalid shape props", () => {
    const frame = {
      id: "shape:frame",
      typeName: "shape",
      type: "frame",
      x: 0,
      y: 0,
      parentId: "page:page",
      index: "a1",
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {},
      props: { w: 400, h: 300, name: "Before", color: "black" },
      version: 1,
    };
    const renamed = edit([...emptyTldrawElements(), frame], {
      update: [{ id: "frame", text: "After", width: 500 }],
    });
    const updated = renamed.find((element) => element.id === "shape:frame")!;
    expect(updated.props).toMatchObject({ name: "After", w: 500 });
    expect(updated.props).not.toHaveProperty("richText");
    const draw = { ...frame, id: "shape:drawing", type: "draw", props: { segments: [] } };
    const outcome = applyTldrawEdit(
      [...emptyTldrawElements(), draw],
      { update: [{ id: "drawing", width: 100 }] },
      env(),
    );
    expect(outcome).toEqual({
      ok: false,
      problems: ["update: width and height do not apply to draw."],
    });
  });

  it("reports user changes against native shape versions", () => {
    const before = twoBoxes();
    const seen = tldrawSeenVersions(before);
    const after = edit(before, { update: [{ id: "plain", x: 40 }], remove: ["trace"] });
    expect(tldrawChangesSince(seen, after)).toEqual({
      added: [],
      changed: ['rectangle "Plain" (id plain)'],
      removed: ["element (id trace)"],
    });
  });

  it("rejects an invalid edit before changing any record", () => {
    const before = twoBoxes();
    const outcome = applyTldrawEdit(
      before,
      { update: [{ id: "plain", x: 500 }], add: [{ type: "text", x: 0, y: 0 }] },
      env(),
    );
    expect(outcome).toEqual({ ok: false, problems: ["add: a text element needs text."] });
    expect(describeTldrawWhiteboard(before)[0]?.x).toBe(0);
  });
});
