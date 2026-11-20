import type { WhiteboardElement } from "@t3tools/contracts";

import {
  nextFractionalIndex,
  type WhiteboardAddOp,
  type WhiteboardChanges,
  type WhiteboardEdit,
  type WhiteboardEditEnv,
  type WhiteboardEditOutcome,
  type WhiteboardElementView,
  type WhiteboardSeenVersions,
  type WhiteboardStyle,
  type WhiteboardUpdateOp,
} from "./whiteboardScene.ts";

const DEFAULT_PAGE_ID = "page:page";
const DOCUMENT_ID = "document:document";
const DEFAULT_TEXT_SIZE = 20;
const LAYOUT_WARNING_LIMIT = 8;
const TEXT_TYPES = new Set(["geo", "text", "arrow", "note", "frame"]);
const RESIZE_TYPES = new Set([
  "geo",
  "text",
  "arrow",
  "frame",
  "image",
  "video",
  "embed",
  "bookmark",
]);

type Point = readonly [number, number];
type MutableRecord = Record<string, unknown>;

const numberOf = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const stringOf = (value: unknown) => (typeof value === "string" ? value : null);
const live = (record: WhiteboardElement) => record.isDeleted !== true;
const shapeId = (id: string) => (id.startsWith("shape:") ? id : `shape:${id}`);
const publicId = (id: string) => (id.startsWith("shape:") ? id.slice(6) : id);
const groupId = (name: string) => `shape:group:${name}`;
const bindingId = (arrowId: string, terminal: "start" | "end") =>
  `binding:${publicId(arrowId)}:${terminal}`;
const propsOf = (record: WhiteboardElement): MutableRecord =>
  typeof record.props === "object" && record.props !== null ? (record.props as MutableRecord) : {};
const isShape = (record: WhiteboardElement) => record.typeName === "shape";

export const emptyTldrawElements = (): Array<WhiteboardElement> => [
  {
    id: DOCUMENT_ID,
    typeName: "document",
    gridSize: 10,
    name: "",
    meta: {},
    version: 1,
    versionNonce: 1,
    updated: 0,
  },
  {
    id: DEFAULT_PAGE_ID,
    typeName: "page",
    name: "Page 1",
    index: "a1",
    meta: {},
    version: 1,
    versionNonce: 1,
    updated: 0,
  },
];

function richText(text: string) {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line === "" ? [] : [{ type: "text", text: line }],
    })),
  };
}

function plainText(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  const node = value as { type?: unknown; text?: unknown; content?: unknown };
  if (node.type === "text") return stringOf(node.text) ?? "";
  if (node.type === "hardBreak") return "\n";
  if (!Array.isArray(node.content)) return "";
  const separator = node.type === "doc" ? "\n" : "";
  return node.content.map((child) => plainText(child)).join(separator);
}

const COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  black: [30, 30, 30],
  grey: [118, 118, 118],
  "light-violet": [177, 157, 217],
  violet: [155, 109, 198],
  blue: [68, 101, 233],
  "light-blue": [76, 144, 240],
  yellow: [242, 193, 78],
  orange: [232, 133, 60],
  green: [38, 166, 91],
  "light-green": [87, 195, 120],
  "light-red": [240, 129, 129],
  red: [224, 49, 49],
  white: [255, 255, 255],
};

function color(value: string | undefined): string {
  if (value === undefined) return "black";
  if (value in COLORS) return value;
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (match === null) return "black";
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(match[1]!.slice(offset, offset + 2), 16));
  return Object.entries(COLORS).reduce(
    (nearest, [name, candidate]) => {
      const distance = candidate.reduce(
        (total, channel, index) => total + (channel - rgb[index]!) ** 2,
        0,
      );
      return distance < nearest.distance ? { name, distance } : nearest;
    },
    { name: "black", distance: Number.POSITIVE_INFINITY },
  ).name;
}

const font = (value: WhiteboardStyle["fontFamily"]) => {
  switch (value) {
    case "Nunito":
      return "sans";
    case "Cascadia":
      return "mono";
    default:
      return "draw";
  }
};
const align = (value: WhiteboardStyle["textAlign"]) =>
  value === "left" ? "start" : value === "right" ? "end" : "middle";
const verticalAlign = (value: WhiteboardStyle["verticalAlign"]) =>
  value === "top" ? "start" : value === "bottom" ? "end" : "middle";
const size = (value: number | undefined) =>
  value === undefined ? "m" : value <= 1 ? "s" : value <= 2 ? "m" : value <= 4 ? "l" : "xl";
const arrowhead = (value: WhiteboardStyle["endArrowhead"]) => {
  switch (value) {
    case "none":
      return "none";
    case "circle":
    case "circle_outline":
      return "dot";
    case "triangle":
    case "triangle_outline":
      return "triangle";
    case "diamond":
    case "diamond_outline":
      return "diamond";
    case "bar":
      return "bar";
    default:
      return "arrow";
  }
};

function styledProps(current: MutableRecord, style: WhiteboardStyle, type: string): MutableRecord {
  const next = { ...current };
  if (style.strokeColor !== undefined || style.backgroundColor !== undefined) {
    next.color = color(style.strokeColor ?? style.backgroundColor);
  }
  if (style.textColor !== undefined && type !== "text") next.labelColor = color(style.textColor);
  if (type === "text" && style.textColor !== undefined) next.color = color(style.textColor);
  if (style.backgroundColor !== undefined || style.fillStyle !== undefined) {
    next.fill =
      style.backgroundColor === "transparent"
        ? "none"
        : style.fillStyle === "hachure" ||
            style.fillStyle === "cross-hatch" ||
            style.fillStyle === "zigzag"
          ? "pattern"
          : "solid";
  }
  if (style.strokeStyle !== undefined) next.dash = style.strokeStyle;
  if (style.roughness !== undefined) next.dash = style.roughness === 0 ? "solid" : "draw";
  if (style.strokeWidth !== undefined) next.size = size(style.strokeWidth);
  if (style.fontFamily !== undefined) next.font = font(style.fontFamily);
  if (style.fontSize !== undefined) next.scale = style.fontSize / DEFAULT_TEXT_SIZE;
  if (style.textAlign !== undefined) {
    if (type === "text") next.textAlign = align(style.textAlign);
    else next.align = align(style.textAlign);
  }
  if (style.verticalAlign !== undefined && type !== "text" && type !== "arrow") {
    next.verticalAlign = verticalAlign(style.verticalAlign);
  }
  if (type === "arrow") {
    if (style.roundness !== undefined) next.kind = style.roundness === "sharp" ? "elbow" : "arc";
    if (style.startArrowhead !== undefined) next.arrowheadStart = arrowhead(style.startArrowhead);
    if (style.endArrowhead !== undefined) next.arrowheadEnd = arrowhead(style.endArrowhead);
  }
  return next;
}

function baseShape(
  id: string,
  type: string,
  op: WhiteboardAddOp,
  index: string,
  parentId: string,
  env: WhiteboardEditEnv,
): WhiteboardElement {
  return {
    id,
    typeName: "shape",
    type,
    x: op.x ?? 0,
    y: op.y ?? 0,
    rotation: 0,
    index,
    parentId,
    isLocked: false,
    opacity: (op.opacity ?? 100) / 100,
    meta: {},
    props: {},
    version: 1,
    versionNonce: Math.floor(env.random() * 2 ** 31),
    updated: env.now,
  };
}

function geoShape(
  id: string,
  op: WhiteboardAddOp,
  index: string,
  parentId: string,
  env: WhiteboardEditEnv,
): WhiteboardElement {
  const shape = baseShape(id, "geo", op, index, parentId, env);
  return {
    ...shape,
    props: styledProps(
      {
        w: op.width ?? 140,
        h: op.height ?? 70,
        geo: op.type,
        dash: "draw",
        growY: 0,
        url: "",
        scale: 1,
        flipX: false,
        flipY: false,
        color: "black",
        labelColor: "black",
        fill: "none",
        size: "m",
        font: "draw",
        align: "middle",
        verticalAlign: "middle",
        richText: richText(op.text ?? ""),
      },
      op,
      "geo",
    ),
  };
}

function textShape(
  id: string,
  op: WhiteboardAddOp,
  index: string,
  parentId: string,
  env: WhiteboardEditEnv,
): WhiteboardElement {
  const shape = baseShape(id, "text", op, index, parentId, env);
  return {
    ...shape,
    props: styledProps(
      {
        color: "black",
        size: "m",
        w: op.width ?? Math.max(8, (op.text ?? "").length * 10),
        font: "draw",
        textAlign: "start",
        autoSize: op.width === undefined,
        scale: 1,
        richText: richText(op.text ?? ""),
      },
      op,
      "text",
    ),
  };
}

function center(
  record: WhiteboardElement,
  elements: ReadonlyMap<string, WhiteboardElement>,
): Point {
  const view = viewOf(record, elements);
  return view === null ? [0, 0] : [view.x + view.width / 2, view.y + view.height / 2];
}

function connection(
  from: WhiteboardElement,
  to: WhiteboardElement,
  byId: ReadonlyMap<string, WhiteboardElement>,
) {
  const [fromX, fromY] = center(from, byId);
  const [toX, toY] = center(to, byId);
  const dx = toX - fromX;
  const dy = toY - fromY;
  const fromView = viewOf(from, byId)!;
  const toView = viewOf(to, byId)!;
  const pointAt = (view: WhiteboardElementView, towardX: number, towardY: number): Point => {
    const cx = view.x + view.width / 2;
    const cy = view.y + view.height / 2;
    const vx = towardX - cx;
    const vy = towardY - cy;
    const scaleX = vx === 0 ? Number.POSITIVE_INFINITY : view.width / 2 / Math.abs(vx);
    const scaleY = vy === 0 ? Number.POSITIVE_INFINITY : view.height / 2 / Math.abs(vy);
    const scale = Math.min(scaleX, scaleY);
    return [cx + vx * scale, cy + vy * scale];
  };
  return {
    start: pointAt(fromView, toX, toY),
    end: pointAt(toView, fromX, fromY),
    dx,
    dy,
  };
}

function arrowShape(
  id: string,
  op: WhiteboardAddOp,
  index: string,
  parentId: string,
  env: WhiteboardEditEnv,
  byId: ReadonlyMap<string, WhiteboardElement>,
): WhiteboardElement {
  const from = op.from === undefined ? undefined : byId.get(shapeId(op.from));
  const to = op.to === undefined ? undefined : byId.get(shapeId(op.to));
  const points = op.points ?? [];
  const first = points[0] ?? [0, 0];
  const last = points[points.length - 1] ?? [100, 0];
  const connected = from !== undefined && to !== undefined ? connection(from, to, byId) : null;
  const start = connected?.start ?? first;
  const end = connected?.end ?? last;
  const shape = baseShape(id, "arrow", { ...op, x: start[0], y: start[1] }, index, parentId, env);
  return {
    ...shape,
    props: styledProps(
      {
        kind: "arc",
        elbowMidPoint: 0.5,
        dash: "draw",
        size: "m",
        fill: "none",
        color: "black",
        labelColor: "black",
        bend: 0,
        start: { x: 0, y: 0 },
        end: { x: end[0] - start[0], y: end[1] - start[1] },
        arrowheadStart: "none",
        arrowheadEnd: op.type === "line" ? "none" : "arrow",
        richText: richText(op.text ?? ""),
        labelPosition: 0.5,
        font: "draw",
        scale: 1,
      },
      op,
      "arrow",
    ),
  };
}

function arrowBinding(
  arrow: string,
  target: string,
  terminal: "start" | "end",
  env: WhiteboardEditEnv,
): WhiteboardElement {
  return {
    id: bindingId(arrow, terminal),
    typeName: "binding",
    type: "arrow",
    fromId: arrow,
    toId: target,
    props: {
      terminal,
      normalizedAnchor: { x: 0.5, y: 0.5 },
      isExact: false,
      isPrecise: false,
      snap: "none",
    },
    meta: {},
    version: 1,
    versionNonce: Math.floor(env.random() * 2 ** 31),
    updated: env.now,
  };
}

function freehandSize(props: MutableRecord, type: string): Point | null {
  const segments = type === "draw" || type === "highlight" ? props.segments : null;
  const rawPoints = type === "line" ? props.points : null;
  const points = Array.isArray(segments)
    ? segments.flatMap((segment) =>
        typeof segment === "object" &&
        segment !== null &&
        Array.isArray((segment as { points?: unknown }).points)
          ? (segment as { points: Array<{ x?: unknown; y?: unknown }> }).points
          : [],
      )
    : Array.isArray(rawPoints)
      ? rawPoints
      : typeof rawPoints === "object" && rawPoints !== null
        ? Object.values(rawPoints)
        : [];
  let maxX = 0;
  let maxY = 0;
  for (const point of points) {
    if (typeof point !== "object" || point === null) continue;
    maxX = Math.max(maxX, numberOf((point as { x?: unknown }).x));
    maxY = Math.max(maxY, numberOf((point as { y?: unknown }).y));
  }
  return points.length === 0 ? null : [maxX, maxY];
}

function worldOffset(
  record: WhiteboardElement,
  byId: ReadonlyMap<string, WhiteboardElement>,
): Point {
  let x = 0;
  let y = 0;
  let parentId = stringOf(record.parentId);
  const visited = new Set<string>();
  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined || !isShape(parent)) break;
    x += numberOf(parent.x);
    y += numberOf(parent.y);
    parentId = stringOf(parent.parentId);
  }
  return [x, y];
}

function viewOf(
  record: WhiteboardElement,
  byId: ReadonlyMap<string, WhiteboardElement>,
): WhiteboardElementView | null {
  if (!isShape(record) || record.type === "group") return null;
  const id = stringOf(record.id);
  const type = stringOf(record.type);
  if (id === null || type === null) return null;
  const props = propsOf(record);
  const [parentX, parentY] = worldOffset(record, byId);
  const x = numberOf(record.x) + parentX;
  const y = numberOf(record.y) + parentY;
  const text = plainText(props.richText) || (type === "frame" ? stringOf(props.name) : null);
  const bindings = [...byId.values()].filter(
    (candidate) =>
      live(candidate) && candidate.typeName === "binding" && candidate.fromId === record.id,
  );
  const startBinding = bindings.find((binding) => propsOf(binding).terminal === "start");
  const endBinding = bindings.find((binding) => propsOf(binding).terminal === "end");
  const from = stringOf(startBinding?.toId);
  const to = stringOf(endBinding?.toId);
  const fromShape = from === null ? undefined : byId.get(from);
  const toShape = to === null ? undefined : byId.get(to);
  const connected =
    fromShape !== undefined && toShape !== undefined ? connection(fromShape, toShape, byId) : null;
  const startPoint = props.start as { x?: unknown; y?: unknown } | undefined;
  const endPoint = props.end as { x?: unknown; y?: unknown } | undefined;
  const start: Point = connected?.start ?? [
    x + numberOf(startPoint?.x),
    y + numberOf(startPoint?.y),
  ];
  const end: Point = connected?.end ?? [x + numberOf(endPoint?.x), y + numberOf(endPoint?.y)];
  const arrow = type === "arrow";
  const freehand = freehandSize(props, type);
  const width = arrow
    ? Math.abs(end[0] - start[0])
    : numberOf(props.w, freehand?.[0] ?? (type === "note" ? 200 : 0));
  const height = arrow
    ? Math.abs(end[1] - start[1])
    : numberOf(props.h, freehand?.[1] ?? (type === "note" ? 200 : 0));
  const parent = byId.get(stringOf(record.parentId) ?? "");
  const group =
    parent?.type === "group" ? stringOf((parent.meta as MutableRecord).whiteboardGroup) : null;
  const scale = numberOf(props.scale, 1);
  const resultType =
    arrow && props.arrowheadEnd === "none" && props.arrowheadStart === "none"
      ? "line"
      : type === "geo"
        ? (stringOf(props.geo) ?? "rectangle")
        : type;
  return {
    id: publicId(id),
    type: resultType,
    x: Math.round(arrow ? Math.min(start[0], end[0]) : x),
    y: Math.round(arrow ? Math.min(start[1], end[1]) : y),
    width: Math.round(width),
    height: Math.round(
      arrow ? height : height || (text === null ? 0 : DEFAULT_TEXT_SIZE * scale * 1.25),
    ),
    ...(text ? { text } : {}),
    ...(from !== null ? { from: publicId(from) } : {}),
    ...(to !== null ? { to: publicId(to) } : {}),
    ...(arrow ? { start, end } : {}),
    ...(props.color !== undefined && props.color !== "black"
      ? { strokeColor: String(props.color) }
      : {}),
    ...(props.fill !== undefined && props.fill !== "none"
      ? { backgroundColor: String(props.color), fillStyle: String(props.fill) }
      : {}),
    ...(props.dash !== undefined && props.dash !== "draw" && props.dash !== "solid"
      ? { strokeStyle: String(props.dash) }
      : {}),
    ...(props.kind === "elbow" ? { roundness: "sharp" as const } : {}),
    ...(numberOf(record.opacity, 1) !== 1
      ? { opacity: Math.round(numberOf(record.opacity, 1) * 100) }
      : {}),
    ...(group !== null ? { group } : {}),
    ...(props.labelColor !== undefined && props.labelColor !== "black"
      ? { textColor: String(props.labelColor) }
      : {}),
    ...(scale !== 1 ? { fontSize: Math.round(DEFAULT_TEXT_SIZE * scale) } : {}),
    ...(props.font !== undefined && props.font !== "draw"
      ? { fontFamily: String(props.font) }
      : {}),
    ...(props.align !== undefined && props.align !== "middle"
      ? { textAlign: props.align === "start" ? "left" : "right" }
      : {}),
    ...(props.textAlign !== undefined && props.textAlign !== "start"
      ? { textAlign: props.textAlign === "middle" ? "center" : "right" }
      : {}),
    ...(props.verticalAlign !== undefined && props.verticalAlign !== "middle"
      ? { verticalAlign: props.verticalAlign === "start" ? "top" : "bottom" }
      : {}),
    ...(arrow && props.arrowheadStart !== "none"
      ? { startArrowhead: String(props.arrowheadStart) }
      : {}),
    ...(arrow && props.arrowheadEnd !== "arrow" && props.arrowheadEnd !== "none"
      ? { endArrowhead: String(props.arrowheadEnd) }
      : {}),
  };
}

export function describeTldrawWhiteboard(
  elements: ReadonlyArray<WhiteboardElement>,
): ReadonlyArray<WhiteboardElementView> {
  const byId = new Map(elements.map((element) => [String(element.id), element] as const));
  return elements.flatMap((element) => {
    if (!live(element)) return [];
    const view = viewOf(element, byId);
    return view === null ? [] : [view];
  });
}

export function tldrawSeenVersions(
  elements: ReadonlyArray<WhiteboardElement>,
): WhiteboardSeenVersions {
  return Object.fromEntries(
    elements.flatMap((element) =>
      isShape(element) && live(element) && element.type !== "group"
        ? [[String(element.id), numberOf(element.version)] as const]
        : [],
    ),
  );
}

function viewLabel(view: WhiteboardElementView, views: ReadonlyMap<string, WhiteboardElementView>) {
  const named = (id: string | undefined) => {
    if (id === undefined) return "a free end";
    const text = (views.get(shapeId(id)) ?? views.get(id))?.text;
    return text ? `"${text}"` : id;
  };
  const ends =
    view.from !== undefined || view.to !== undefined
      ? ` from ${named(view.from)} to ${named(view.to)}`
      : "";
  return `${view.type}${view.text ? ` "${view.text.replace(/\s+/g, " ").slice(0, 60)}"` : ""}${ends} (id ${view.id})`;
}

export function tldrawChangesSince(
  seen: WhiteboardSeenVersions | null,
  elements: ReadonlyArray<WhiteboardElement>,
): WhiteboardChanges | null {
  const byId = new Map(elements.map((element) => [String(element.id), element] as const));
  const views = new Map(
    describeTldrawWhiteboard(elements).map((view) => [shapeId(view.id), view] as const),
  );
  const added: Array<string> = [];
  const changed: Array<string> = [];
  for (const [id, view] of views) {
    const before = seen?.[id];
    if (before === undefined) added.push(viewLabel(view, views));
    else if (before !== numberOf(byId.get(id)?.version)) changed.push(viewLabel(view, views));
  }
  const removed = Object.keys(seen ?? {}).flatMap((id) => {
    const record = byId.get(id);
    return record === undefined || live(record) ? [] : [`element (id ${publicId(id)})`];
  });
  return added.length === 0 && changed.length === 0 && removed.length === 0
    ? null
    : { added, changed, removed };
}

function touch(record: WhiteboardElement, patch: MutableRecord, env: WhiteboardEditEnv) {
  return {
    ...record,
    ...patch,
    version: numberOf(record.version) + 1,
    versionNonce: Math.floor(env.random() * 2 ** 31),
    updated: env.now,
  };
}

function checkEdit(
  byId: ReadonlyMap<string, WhiteboardElement>,
  edit: WhiteboardEdit,
): ReadonlyArray<string> {
  const problems: Array<string> = [];
  const survives = (id: string) => {
    const record = byId.get(shapeId(id));
    return edit.clear !== true && record !== undefined && live(record) && isShape(record);
  };
  for (const id of edit.remove ?? []) {
    const record = byId.get(shapeId(id));
    if (record === undefined || !live(record) || !isShape(record)) {
      problems.push(`remove: no element has id "${id}".`);
    }
  }
  for (const op of edit.update ?? []) {
    if (!survives(op.id) || edit.remove?.includes(op.id)) {
      problems.push(`update: no element has id "${op.id}".`);
      continue;
    }
    const current = byId.get(shapeId(op.id))!;
    const type = String(current.type);
    if (op.text !== undefined && !TEXT_TYPES.has(type)) {
      problems.push(`update: text does not apply to ${type}.`);
    }
    if (type === "text" && op.text === "") {
      problems.push(`update: text element "${op.id}" cannot have empty text; use remove.`);
    }
    if ((op.width !== undefined || op.height !== undefined) && !RESIZE_TYPES.has(type)) {
      problems.push(`update: width and height do not apply to ${type}.`);
    }
    for (const [name, value] of [
      ["width", op.width],
      ["height", op.height],
    ] as const) {
      if (value !== undefined && value <= 0)
        problems.push(`update: ${name} must be positive, got ${value}.`);
    }
  }
  const added = new Set<string>();
  for (const op of edit.add ?? []) {
    if (op.id !== undefined) {
      const id = shapeId(op.id);
      if (byId.has(id) || added.has(id))
        problems.push(`add: id "${op.id}" is already used on this board.`);
      added.add(id);
    }
    if (
      (op.type === "rectangle" ||
        op.type === "ellipse" ||
        op.type === "diamond" ||
        op.type === "text") &&
      (op.x === undefined || op.y === undefined)
    ) {
      problems.push(`add: a ${op.type} needs x and y.`);
    }
    if (op.type === "text" && !op.text) problems.push("add: a text element needs text.");
    if (op.type === "arrow" || op.type === "line") {
      if (op.from === undefined && op.to === undefined && (op.points?.length ?? 0) < 2) {
        problems.push(`add: a ${op.type} needs both from and to, or at least two points.`);
      }
      for (const target of [op.from, op.to]) {
        if (target !== undefined && !survives(target) && !added.has(shapeId(target))) {
          problems.push(`add: ${op.type} refers to "${target}", which is not on the board.`);
        }
      }
    }
    if (op.opacity !== undefined && (op.opacity < 0 || op.opacity > 100)) {
      problems.push(`add: opacity must be between 0 and 100, got ${op.opacity}.`);
    }
  }
  return problems;
}

export function applyTldrawEdit(
  elements: ReadonlyArray<WhiteboardElement>,
  edit: WhiteboardEdit,
  env: WhiteboardEditEnv,
): WhiteboardEditOutcome {
  const records = new Map(elements.map((element) => [String(element.id), element] as const));
  const problems = checkEdit(records, edit);
  if (problems.length > 0) return { ok: false, problems };
  const firstPage = elements.find((element) => element.typeName === "page" && live(element));
  const pageId = stringOf(firstPage?.id) ?? DEFAULT_PAGE_ID;
  const nextIndex = () => {
    const indices = [...records.values()]
      .filter((record) => isShape(record) && live(record))
      .map((record) => stringOf(record.index))
      .filter((index): index is string => index !== null)
      .sort();
    return nextFractionalIndex(indices.at(-1) ?? null) ?? `a${records.size}`;
  };
  const put = (record: WhiteboardElement) => records.set(String(record.id), record);
  const tombstone = (id: string) => {
    const record = records.get(id);
    if (record === undefined || !live(record)) return;
    put(touch(record, { isDeleted: true }, env));
    if (isShape(record)) {
      for (const binding of records.values()) {
        if (
          live(binding) &&
          binding.typeName === "binding" &&
          (binding.fromId === id || binding.toId === id)
        ) {
          put(touch(binding, { isDeleted: true }, env));
        }
      }
      for (const child of records.values()) {
        if (live(child) && isShape(child) && child.parentId === id) tombstone(String(child.id));
      }
    }
  };
  if (edit.clear === true) {
    for (const record of records.values()) {
      if (live(record) && (isShape(record) || record.typeName === "binding")) {
        put(touch(record, { isDeleted: true }, env));
      }
    }
  }
  for (const id of edit.remove ?? []) tombstone(shapeId(id));

  const ensureGroup = (name: string) => {
    const id = groupId(name);
    const existing = records.get(id);
    if (existing !== undefined && live(existing)) return existing;
    const group = baseShape(
      id,
      "group",
      { type: "rectangle", x: 0, y: 0 },
      nextIndex(),
      pageId,
      env,
    );
    const created = { ...group, meta: { whiteboardGroup: name } };
    put(created);
    return created;
  };
  const placement = (op: WhiteboardAddOp | WhiteboardUpdateOp, current?: WhiteboardElement) => {
    if (op.group === undefined && current !== undefined) {
      const [px, py] = worldOffset(current, records);
      return {
        parentId: current.parentId,
        x: op.x === undefined ? undefined : op.x - px,
        y: op.y === undefined ? undefined : op.y - py,
      };
    }
    if (op.group === "") {
      const [px, py] = current === undefined ? [0, 0] : worldOffset(current, records);
      return {
        parentId: pageId,
        x: op.x === undefined ? numberOf(current?.x) + px : op.x,
        y: op.y === undefined ? numberOf(current?.y) + py : op.y,
      };
    }
    if (op.group !== undefined) {
      const group = ensureGroup(op.group);
      const [gx, gy] = worldOffset(group, records);
      return {
        parentId: groupId(op.group),
        x: op.x === undefined ? numberOf(current?.x) : op.x - gx,
        y: op.y === undefined ? numberOf(current?.y) : op.y - gy,
      };
    }
    const [px, py] = current === undefined ? [0, 0] : worldOffset(current, records);
    return {
      parentId: pageId,
      x: op.x === undefined ? op.x : op.x - px,
      y: op.y === undefined ? op.y : op.y - py,
    };
  };

  for (const op of edit.update ?? []) {
    const id = shapeId(op.id);
    const current = records.get(id);
    if (current === undefined) continue;
    const type = String(current.type);
    const place = placement(op, current);
    const props = styledProps(propsOf(current), op, type === "geo" ? "geo" : type);
    if (op.text !== undefined) {
      if (type === "frame") props.name = op.text;
      else props.richText = richText(op.text);
    }
    if (type === "arrow") {
      const end = props.end as { x?: unknown; y?: unknown } | undefined;
      const endX = numberOf(end?.x);
      const endY = numberOf(end?.y);
      if (op.width !== undefined || op.height !== undefined) {
        props.end = {
          x: op.width === undefined ? endX : op.width * (endX < 0 ? -1 : 1),
          y: op.height === undefined ? endY : op.height * (endY < 0 ? -1 : 1),
        };
      }
    } else {
      if (op.width !== undefined) {
        props.w = op.width;
        if (type === "text") props.autoSize = false;
      }
      if (op.height !== undefined && type !== "text") props.h = op.height;
    }
    put(
      touch(
        current,
        {
          ...(place.x === undefined ? {} : { x: place.x }),
          ...(place.y === undefined ? {} : { y: place.y }),
          parentId: place.parentId,
          ...(op.opacity === undefined ? {} : { opacity: op.opacity / 100 }),
          props,
        },
        env,
      ),
    );
  }

  const adds = (edit.add ?? []).map((op) => ({ op, id: op.id ?? env.makeId() }));
  for (const { op, id } of adds) {
    if (op.type === "arrow" || op.type === "line") continue;
    const recordId = shapeId(id);
    const place = placement(op);
    const index = nextIndex();
    const maker = op.type === "text" ? textShape : geoShape;
    put(maker(recordId, { ...op, x: place.x, y: place.y }, index, String(place.parentId), env));
  }
  for (const { op, id } of adds) {
    if (op.type !== "arrow" && op.type !== "line") continue;
    const recordId = shapeId(id);
    const place = placement(op);
    const index = nextIndex();
    put(
      arrowShape(
        recordId,
        { ...op, x: place.x, y: place.y },
        index,
        String(place.parentId),
        env,
        records,
      ),
    );
    if (op.from !== undefined) put(arrowBinding(recordId, shapeId(op.from), "start", env));
    if (op.to !== undefined) put(arrowBinding(recordId, shapeId(op.to), "end", env));
  }
  return { ok: true, elements: [...records.values()], addedIds: adds.map(({ id }) => id) };
}

export function tldrawLayoutWarnings(
  elements: ReadonlyArray<WhiteboardElement>,
  touchedIds: ReadonlySet<string>,
): ReadonlyArray<string> {
  const views = describeTldrawWhiteboard(elements);
  const byId = new Map(views.map((view) => [view.id, view] as const));
  const warnings: Array<string> = [];
  const shapes = views.filter(
    (view) =>
      view.type !== "arrow" &&
      view.type !== "line" &&
      view.type !== "draw" &&
      view.type !== "highlight",
  );
  for (const [index, a] of shapes.entries()) {
    for (const b of shapes.slice(index + 1)) {
      if (!touchedIds.has(a.id) && !touchedIds.has(b.id)) continue;
      const apart =
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y;
      const inside = (inner: WhiteboardElementView, outer: WhiteboardElementView) =>
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height;
      if (!apart && !inside(a, b) && !inside(b, a)) {
        warnings.push(`${viewLabel(a, byId)} overlaps ${viewLabel(b, byId)}.`);
      }
    }
  }
  return warnings.length <= LAYOUT_WARNING_LIMIT
    ? warnings
    : [
        ...warnings.slice(0, LAYOUT_WARNING_LIMIT),
        `And ${warnings.length - LAYOUT_WARNING_LIMIT} more layout problems.`,
      ];
}
