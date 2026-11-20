import type { WhiteboardElement } from "@t3tools/contracts";

const TOMBSTONE_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FONT_SIZE = 20;
const DEFAULT_FONT_FAMILY = 5;
const DEFAULT_STROKE = "#1e1e1e";
const DEFAULT_STROKE_WIDTH = 2;
const DEFAULT_ROUGHNESS = 1;
const DEFAULT_OPACITY = 100;
const BINDING_GAP = 6;
const BOUND_TEXT_PADDING = 5;
const LABEL_INSET = 20;
const LAYOUT_WARNING_LIMIT = 8;
const DEFAULT_SHAPE = { width: 140, height: 70 };
const LABEL_LIST_LIMIT = 12;

type Point = readonly [number, number];
type MutableElement = Record<string, unknown>;

export const WHITEBOARD_ADD_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
] as const;
export type WhiteboardAddType = (typeof WHITEBOARD_ADD_TYPES)[number];

export const WHITEBOARD_STROKE_STYLES = ["solid", "dashed", "dotted"] as const;
export type WhiteboardStrokeStyle = (typeof WHITEBOARD_STROKE_STYLES)[number];

export const WHITEBOARD_FILL_STYLES = ["solid", "hachure", "cross-hatch", "zigzag"] as const;
export type WhiteboardFillStyle = (typeof WHITEBOARD_FILL_STYLES)[number];

export const WHITEBOARD_ROUNDNESS = ["round", "sharp"] as const;
export type WhiteboardRoundness = (typeof WHITEBOARD_ROUNDNESS)[number];

export const WHITEBOARD_ROUGHNESS = [0, 1, 2] as const;
export type WhiteboardRoughness = (typeof WHITEBOARD_ROUGHNESS)[number];

export const WHITEBOARD_FONT_FAMILIES = [
  "Excalifont",
  "Nunito",
  "Lilita One",
  "Comic Shanns",
  "Cascadia",
] as const;
export type WhiteboardFontFamily = (typeof WHITEBOARD_FONT_FAMILIES)[number];

export const WHITEBOARD_TEXT_ALIGNS = ["left", "center", "right"] as const;
export type WhiteboardTextAlign = (typeof WHITEBOARD_TEXT_ALIGNS)[number];

export const WHITEBOARD_VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;
export type WhiteboardVerticalAlign = (typeof WHITEBOARD_VERTICAL_ALIGNS)[number];

export const WHITEBOARD_ARROWHEADS = [
  "none",
  "arrow",
  "bar",
  "triangle",
  "triangle_outline",
  "circle",
  "circle_outline",
  "diamond",
  "diamond_outline",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
] as const;
export type WhiteboardArrowhead = (typeof WHITEBOARD_ARROWHEADS)[number];

// Excalidraw font ids (FONT_FAMILY). Only families whose .woff2 ships with the app are offered.
const FONT_ID_BY_NAME: Readonly<Record<WhiteboardFontFamily, number>> = {
  Excalifont: 5,
  Nunito: 6,
  "Lilita One": 7,
  "Comic Shanns": 8,
  Cascadia: 3,
};

const FONT_NAME_BY_ID: Readonly<Record<number, string>> = {
  1: "Virgil",
  2: "Helvetica",
  3: "Cascadia",
  5: "Excalifont",
  6: "Nunito",
  7: "Lilita One",
  8: "Comic Shanns",
  9: "Liberation Sans",
};

// Line heights match Excalidraw's FONT_METADATA; charWidth is measured conservatively per font.
const FONT_METRICS: Readonly<
  Record<number, { readonly charWidth: number; readonly lineHeight: number }>
> = {
  1: { charWidth: 0.6, lineHeight: 1.25 },
  2: { charWidth: 0.55, lineHeight: 1.15 },
  3: { charWidth: 0.6, lineHeight: 1.2 },
  5: { charWidth: 0.6, lineHeight: 1.25 },
  6: { charWidth: 0.55, lineHeight: 1.35 },
  7: { charWidth: 0.55, lineHeight: 1.15 },
  8: { charWidth: 0.56, lineHeight: 1.25 },
  9: { charWidth: 0.55, lineHeight: 1.15 },
};

const fontMetrics = (fontFamily: number) =>
  FONT_METRICS[fontFamily] ?? FONT_METRICS[DEFAULT_FONT_FAMILY]!;

export interface WhiteboardStyle {
  readonly strokeColor?: string | undefined;
  readonly backgroundColor?: string | undefined;
  readonly fillStyle?: WhiteboardFillStyle | undefined;
  readonly strokeWidth?: number | undefined;
  readonly strokeStyle?: WhiteboardStrokeStyle | undefined;
  readonly roughness?: WhiteboardRoughness | undefined;
  readonly roundness?: WhiteboardRoundness | undefined;
  readonly opacity?: number | undefined;
  readonly group?: string | undefined;
  readonly textColor?: string | undefined;
  readonly fontSize?: number | undefined;
  readonly fontFamily?: WhiteboardFontFamily | undefined;
  readonly textAlign?: WhiteboardTextAlign | undefined;
  readonly verticalAlign?: WhiteboardVerticalAlign | undefined;
  readonly startArrowhead?: WhiteboardArrowhead | undefined;
  readonly endArrowhead?: WhiteboardArrowhead | undefined;
}

export interface WhiteboardAddOp extends WhiteboardStyle {
  readonly type: WhiteboardAddType;
  readonly id?: string | undefined;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly text?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly points?: ReadonlyArray<Point> | undefined;
}

export interface WhiteboardUpdateOp extends WhiteboardStyle {
  readonly id: string;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly text?: string | undefined;
}

export interface WhiteboardEdit {
  readonly clear?: boolean | undefined;
  readonly remove?: ReadonlyArray<string> | undefined;
  readonly update?: ReadonlyArray<WhiteboardUpdateOp> | undefined;
  readonly add?: ReadonlyArray<WhiteboardAddOp> | undefined;
}

export interface WhiteboardEditEnv {
  readonly now: number;
  readonly random: () => number;
  readonly makeId: () => string;
}

export type WhiteboardEditOutcome =
  | {
      readonly ok: true;
      readonly elements: ReadonlyArray<WhiteboardElement>;
      readonly addedIds: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly problems: ReadonlyArray<string> };

/** What an agent reads: one entry per visible thing, with a shape's label folded into the shape. */
export interface WhiteboardElementView {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text?: string;
  readonly from?: string;
  readonly to?: string;
  readonly start?: Point;
  readonly end?: Point;
  readonly strokeColor?: string;
  readonly backgroundColor?: string;
  readonly fillStyle?: string;
  readonly strokeWidth?: number;
  readonly strokeStyle?: string;
  readonly roughness?: number;
  readonly roundness?: WhiteboardRoundness;
  readonly opacity?: number;
  readonly group?: string;
  readonly textColor?: string;
  readonly fontSize?: number;
  readonly fontFamily?: string;
  readonly textAlign?: string;
  readonly verticalAlign?: string;
  readonly startArrowhead?: string;
  readonly endArrowhead?: string;
}

export interface WhiteboardChanges {
  readonly added: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

export type WhiteboardSeenVersions = Readonly<Record<string, number>>;

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const idOf = (element: WhiteboardElement) => str(element.id);
const isLive = (element: WhiteboardElement) => element.isDeleted !== true;
const isShapeType = (type: string) =>
  type === "rectangle" || type === "ellipse" || type === "diamond";
const isLinearType = (type: string) => type === "arrow" || type === "line";
const isLinear = (element: WhiteboardElement) =>
  element.type === "arrow" || element.type === "line";
const supportsRoundness = (type: string) =>
  type === "rectangle" || type === "diamond" || type === "arrow" || type === "line";
const round = (value: number) => Math.round(value);

const isIn = <T extends string | number>(list: ReadonlyArray<T>, value: unknown): value is T =>
  (list as ReadonlyArray<unknown>).includes(value);

const groupIdsOf = (element: WhiteboardElement): ReadonlyArray<string> =>
  Array.isArray(element.groupIds)
    ? element.groupIds.filter(
        (id: unknown): id is string => typeof id === "string" && id.length > 0,
      )
    : [];

const roundnessValue = (type: string, roundness: WhiteboardRoundness | undefined) => {
  if (roundness === "sharp" || type === "ellipse" || type === "text") return null;
  return type === "rectangle" ? { type: 3 } : { type: 2 };
};

const arrowheadValue = (value: WhiteboardArrowhead) => (value === "none" ? null : value);

const readArrowhead = (value: unknown): string | null => {
  if (value === null) return "none";
  if (value === "dot") return "circle";
  return typeof value === "string" ? value : null;
};

const asTextAlign = (value: unknown): WhiteboardTextAlign | null =>
  isIn(WHITEBOARD_TEXT_ALIGNS, value) ? value : null;

const asVerticalAlign = (value: unknown): WhiteboardVerticalAlign | null =>
  isIn(WHITEBOARD_VERTICAL_ALIGNS, value) ? value : null;

const boundRefs = (element: WhiteboardElement): ReadonlyArray<{ id: string; type: string }> =>
  Array.isArray(element.boundElements)
    ? element.boundElements.flatMap((ref: unknown) => {
        if (typeof ref !== "object" || ref === null) return [];
        const { id, type } = ref as { id?: unknown; type?: unknown };
        return typeof id === "string" && typeof type === "string" ? [{ id, type }] : [];
      })
    : [];

const bindingTarget = (binding: unknown): string | null =>
  typeof binding === "object" && binding !== null
    ? str((binding as { elementId?: unknown }).elementId)
    : null;

const relativePoints = (element: WhiteboardElement): ReadonlyArray<Point> =>
  Array.isArray(element.points)
    ? element.points.flatMap((point: unknown) =>
        Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number"
          ? [[point[0], point[1]] as const]
          : [],
      )
    : [];

function supersedes(incoming: WhiteboardElement, current: WhiteboardElement): boolean {
  const incomingVersion = num(incoming.version);
  const currentVersion = num(current.version);
  if (incomingVersion !== currentVersion) return incomingVersion > currentVersion;
  return num(incoming.versionNonce) < num(current.versionNonce);
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * The fractional index just above `after`, in the key format Excalidraw orders elements by. An
 * element saved without one is re-indexed by every window, which bumps its version and so reads
 * as a user's edit. `null` when `after` is not a key this can count up from.
 */
export function nextFractionalIndex(after: string | null): string | null {
  if (after === null) return "a0";
  const head = after.charCodeAt(0);
  if (head < 97 || head > 122) return null;
  const digits = Array.from(after.slice(1, head - 95), (digit) => BASE62.indexOf(digit));
  if (digits.length !== head - 96 || digits.includes(-1)) return null;
  for (let place = digits.length - 1; place >= 0; place--) {
    if ((digits[place] ?? 0) < BASE62.length - 1) {
      digits[place] = (digits[place] ?? 0) + 1;
      return after[0] + digits.map((digit) => BASE62[digit]).join("");
    }
    digits[place] = 0;
  }
  return head === 122 ? null : String.fromCharCode(head + 1) + "0".repeat(digits.length + 1);
}

/** Excalidraw orders by fractional `index`; elements without one stay on top. */
function orderElements(elements: ReadonlyArray<WhiteboardElement>): Array<WhiteboardElement> {
  const indexed = elements.filter((element) => typeof element.index === "string");
  const unindexed = elements.filter((element) => typeof element.index !== "string");
  indexed.sort((a, b) => {
    const left = a.index as string;
    const right = b.index as string;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return [...indexed, ...unindexed];
}

/**
 * Per element, the higher version wins and a tie goes to the lower nonce, the rule Excalidraw's own
 * collaboration uses. Windows send deleted elements too, so a merge cannot bring one back.
 */
export function mergeWhiteboardElements(
  stored: ReadonlyArray<WhiteboardElement>,
  incoming: ReadonlyArray<WhiteboardElement>,
  now: number,
): { readonly elements: ReadonlyArray<WhiteboardElement>; readonly changed: boolean } {
  const byId = new Map<string, WhiteboardElement>();
  for (const element of stored) {
    const id = idOf(element);
    if (id !== null) byId.set(id, element);
  }
  let changed = false;
  for (const element of incoming) {
    const id = idOf(element);
    if (id === null) continue;
    const current = byId.get(id);
    if (current === undefined ? isLive(element) : supersedes(element, current)) {
      byId.set(id, element);
      changed = true;
    }
  }
  const kept = [...byId.values()].filter(
    (element) => isLive(element) || now - num(element.updated, now) < TOMBSTONE_RETENTION_MS,
  );
  return { elements: orderElements(kept), changed };
}

function viewOf(
  element: WhiteboardElement,
  byId: ReadonlyMap<string, WhiteboardElement>,
): WhiteboardElementView | null {
  const id = idOf(element);
  const type = str(element.type);
  if (id === null || type === null) return null;
  const x = num(element.x);
  const y = num(element.y);
  const labelId = boundRefs(element).find((ref) => ref.type === "text")?.id;
  const label = labelId === undefined ? undefined : byId.get(labelId);
  // A removed shape keeps the name its removed label gave it.
  const labelled = label !== undefined && (isLive(label) || !isLive(element));
  const written = type === "text" ? element : labelled ? label : undefined;
  // `text` holds the line breaks Excalidraw added to fit a shape; `originalText` is what was typed.
  const text = written === undefined ? null : (str(written.originalText) ?? str(written.text));
  const points = isLinear(element) ? relativePoints(element) : [];
  const first = points[0];
  const last = points[points.length - 1];
  const from = bindingTarget(element.startBinding);
  const to = bindingTarget(element.endBinding);
  const strokeColor = str(element.strokeColor);
  const backgroundColor = str(element.backgroundColor);
  const fillStyle = str(element.fillStyle);
  const strokeWidth = num(element.strokeWidth, DEFAULT_STROKE_WIDTH);
  const strokeStyle = str(element.strokeStyle);
  const roughness = num(element.roughness, DEFAULT_ROUGHNESS);
  const opacity = num(element.opacity, DEFAULT_OPACITY);
  const groups = groupIdsOf(element);
  const group = groups[groups.length - 1];
  const labelColor = type !== "text" && labelled ? str(label.strokeColor) : null;
  const fontSize =
    written === undefined ? DEFAULT_FONT_SIZE : num(written.fontSize, DEFAULT_FONT_SIZE);
  const fontFamilyId =
    written === undefined ? DEFAULT_FONT_FAMILY : num(written.fontFamily, DEFAULT_FONT_FAMILY);
  const fontFamily = FONT_NAME_BY_ID[fontFamilyId];
  const textAlign = written === undefined ? null : str(written.textAlign);
  const defaultTextAlign = type === "text" ? "left" : "center";
  const verticalAlign = isShapeType(type) && labelled ? str(label.verticalAlign) : null;
  const startArrowhead =
    type === "arrow" && element.startArrowhead !== undefined && element.startArrowhead !== null
      ? readArrowhead(element.startArrowhead)
      : null;
  const endArrowhead =
    type === "arrow" && element.endArrowhead !== undefined && element.endArrowhead !== "arrow"
      ? readArrowhead(element.endArrowhead)
      : null;
  return {
    id,
    type,
    x: round(x),
    y: round(y),
    width: round(num(element.width)),
    height: round(num(element.height)),
    ...(text ? { text } : {}),
    ...(from !== null ? { from } : {}),
    ...(to !== null ? { to } : {}),
    ...(first && last && points.length > 1
      ? {
          start: [round(x + first[0]), round(y + first[1])] as const,
          end: [round(x + last[0]), round(y + last[1])] as const,
        }
      : {}),
    ...(strokeColor !== null && strokeColor !== DEFAULT_STROKE ? { strokeColor } : {}),
    ...(backgroundColor !== null && backgroundColor !== "transparent" ? { backgroundColor } : {}),
    ...(type !== "text" && type !== "arrow" && fillStyle !== null && fillStyle !== "solid"
      ? { fillStyle }
      : {}),
    ...(type !== "text" && strokeWidth !== DEFAULT_STROKE_WIDTH ? { strokeWidth } : {}),
    ...(type !== "text" && strokeStyle !== null && strokeStyle !== "solid" ? { strokeStyle } : {}),
    ...(type !== "text" && roughness !== DEFAULT_ROUGHNESS ? { roughness } : {}),
    ...(supportsRoundness(type) && element.roundness === null
      ? { roundness: "sharp" as const }
      : {}),
    ...(opacity !== DEFAULT_OPACITY ? { opacity: round(opacity) } : {}),
    ...(group !== undefined ? { group } : {}),
    ...(labelColor !== null && labelColor !== DEFAULT_STROKE ? { textColor: labelColor } : {}),
    ...(written !== undefined && fontSize !== DEFAULT_FONT_SIZE
      ? { fontSize: round(fontSize) }
      : {}),
    ...(written !== undefined && fontFamilyId !== DEFAULT_FONT_FAMILY && fontFamily !== undefined
      ? { fontFamily }
      : {}),
    ...(textAlign !== null && textAlign !== defaultTextAlign ? { textAlign } : {}),
    ...(verticalAlign !== null && verticalAlign !== "middle" ? { verticalAlign } : {}),
    ...(startArrowhead !== null ? { startArrowhead } : {}),
    ...(endArrowhead !== null ? { endArrowhead } : {}),
  };
}

const liveById = (elements: ReadonlyArray<WhiteboardElement>) =>
  new Map(
    elements.flatMap((element) => {
      const id = idOf(element);
      return id !== null && isLive(element) ? [[id, element] as const] : [];
    }),
  );

/** A label inside a live shape or arrow is reported as that container's `text`, not on its own. */
const containerOf = (element: WhiteboardElement, live: ReadonlyMap<string, WhiteboardElement>) => {
  const containerId = element.type === "text" ? str(element.containerId) : null;
  return containerId !== null && live.has(containerId) ? containerId : null;
};

export function describeWhiteboard(
  elements: ReadonlyArray<WhiteboardElement>,
): ReadonlyArray<WhiteboardElementView> {
  const live = liveById(elements);
  return [...live.values()].flatMap((element) => {
    if (containerOf(element, live) !== null) return [];
    const view = viewOf(element, live);
    return view === null ? [] : [view];
  });
}

const clip = (value: string) => {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

function labelOf(
  view: WhiteboardElementView,
  views: ReadonlyMap<string, WhiteboardElementView>,
): string {
  const named = (id: string | undefined) => {
    const text = id === undefined ? undefined : views.get(id)?.text;
    return text ? `"${clip(text)}"` : id;
  };
  const ends =
    view.from !== undefined || view.to !== undefined
      ? ` from ${named(view.from) ?? "a free end"} to ${named(view.to) ?? "a free end"}`
      : "";
  return `${view.type}${view.text ? ` "${clip(view.text)}"` : ""}${ends} (id ${view.id})`;
}

export function whiteboardSeenVersions(
  elements: ReadonlyArray<WhiteboardElement>,
): WhiteboardSeenVersions {
  return Object.fromEntries(
    [...liveById(elements)].map(([id, element]) => [id, num(element.version)] as const),
  );
}

/** What changed since `seen` was recorded; `null` when nothing did. A never-seen board is all additions. */
export function whiteboardChangesSince(
  seen: WhiteboardSeenVersions | null,
  elements: ReadonlyArray<WhiteboardElement>,
): WhiteboardChanges | null {
  const live = liveById(elements);
  const all = new Map(
    elements.flatMap((element) => {
      const id = idOf(element);
      return id === null ? [] : [[id, element] as const];
    }),
  );
  const views = new Map(describeWhiteboard(elements).map((view) => [view.id, view] as const));
  const added = new Set<string>();
  const changed = new Set<string>();
  for (const [id, element] of live) {
    const owner = containerOf(element, live) ?? id;
    const before = seen?.[id];
    if (before === undefined) {
      if (owner === id) added.add(id);
      else changed.add(owner);
    } else if (before !== num(element.version)) {
      changed.add(owner);
    }
  }
  const removed: Array<string> = [];
  for (const id of Object.keys(seen ?? {})) {
    if (live.has(id)) continue;
    const gone = all.get(id);
    const owner = gone === undefined ? null : containerOf(gone, live);
    if (owner !== null) {
      changed.add(owner);
      continue;
    }
    if (gone !== undefined && gone.type === "text" && str(gone.containerId) !== null) continue;
    const view = gone === undefined ? null : viewOf(gone, all);
    removed.push(view === null ? `element (id ${id})` : labelOf(view, views));
  }
  for (const id of added) changed.delete(id);
  if (added.size === 0 && changed.size === 0 && removed.length === 0) return null;
  const labels = (ids: Iterable<string>) =>
    [...ids].flatMap((id) => {
      const view = views.get(id);
      return view === undefined ? [] : [labelOf(view, views)];
    });
  return { added: labels(added), changed: labels(changed), removed };
}

const listed = (labels: ReadonlyArray<string>) =>
  labels.length <= LABEL_LIST_LIMIT
    ? labels.join("; ")
    : `${labels.slice(0, LABEL_LIST_LIMIT).join("; ")}; and ${labels.length - LABEL_LIST_LIMIT} more`;

export function whiteboardChangeNote(
  changes: WhiteboardChanges,
  revision: number,
  boardName: string,
): string {
  return [
    `The whiteboard "${boardName}", which this thread's Whiteboard tab shows, changed since you last saw it (now revision ${revision}).`,
    ...(changes.added.length > 0 ? [`Added: ${listed(changes.added)}.`] : []),
    ...(changes.changed.length > 0 ? [`Changed: ${listed(changes.changed)}.`] : []),
    ...(changes.removed.length > 0 ? [`Removed: ${listed(changes.removed)}.`] : []),
    "Call whiteboard_read for the whole board, or whiteboard_view for a picture of it.",
  ].join("\n");
}

/** Tells an agent which board its thread's Whiteboard tab shows now; `null` when that board was deleted. */
export function whiteboardSwitchNote(
  shown: {
    readonly name: string;
    readonly revision: number;
    readonly elementCount: number;
  } | null,
): string {
  if (shown === null) {
    return [
      "The board this thread's Whiteboard tab showed was deleted, so the tab shows no board now.",
      "whiteboard_edit starts a new board, or draws on one you name with board.",
    ].join("\n");
  }
  const holds =
    shown.elementCount === 0 ? "It is empty." : `It holds ${shown.elementCount} elements.`;
  return [
    `This thread's Whiteboard tab now shows the board "${shown.name}" (revision ${shown.revision}). ${holds}`,
    "The whiteboard tools now act on this board. Call whiteboard_read before you draw on it.",
  ].join("\n");
}

const randomInt = (env: WhiteboardEditEnv) => Math.floor(env.random() * 2 ** 31);

const touch = (element: WhiteboardElement, env: WhiteboardEditEnv, patch: MutableElement) => ({
  ...element,
  ...patch,
  version: num(element.version) + 1,
  versionNonce: randomInt(env),
  updated: env.now,
});

function textSize(text: string, fontSize: number, fontFamily = DEFAULT_FONT_FAMILY) {
  const { charWidth, lineHeight } = fontMetrics(fontFamily);
  const lines = text.split("\n");
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return {
    width: Math.ceil(longest * fontSize * charWidth),
    height: Math.ceil(lines.length * fontSize * lineHeight),
  };
}

/** The share of a shape's box its label may fill, as Excalidraw lays bound text out. */
const labelRoom = (element: WhiteboardElement) =>
  element.type === "ellipse" ? 0.71 : element.type === "diamond" ? 0.5 : 1;

/** Breaks a label at spaces to fit `maxWidth`. A word longer than that keeps its own line. */
function wrapLabel(
  text: string,
  fontSize: number,
  maxWidth: number,
  fontFamily = DEFAULT_FONT_FAMILY,
): string {
  const { charWidth } = fontMetrics(fontFamily);
  const perLine = Math.max(1, Math.floor(maxWidth / (fontSize * charWidth)));
  return text
    .split("\n")
    .map((paragraph) => {
      const lines: Array<string> = [];
      let line = "";
      for (const word of paragraph.split(" ")) {
        const longer = line === "" ? word : `${line} ${word}`;
        if (line === "" || longer.length <= perLine) {
          line = longer;
        } else {
          lines.push(line);
          line = word;
        }
      }
      return [...lines, line].join("\n");
    })
    .join("\n");
}

function boundTextPosition(
  container: WhiteboardElement,
  size: { readonly width: number; readonly height: number },
  textAlign: WhiteboardTextAlign,
  verticalAlign: WhiteboardVerticalAlign,
): Point {
  if (isLinear(container)) {
    const points = relativePoints(container);
    const first = points[0] ?? [0, 0];
    const last = points[points.length - 1] ?? first;
    return [
      num(container.x) + (first[0] + last[0]) / 2 - size.width / 2,
      num(container.y) + (first[1] + last[1]) / 2 - size.height / 2,
    ];
  }
  const cx = num(container.x);
  const cy = num(container.y);
  const width = num(container.width);
  const height = num(container.height);
  const insetX =
    container.type === "ellipse"
      ? (width / 2) * (1 - Math.SQRT2 / 2)
      : container.type === "diamond"
        ? width / 4
        : 0;
  const insetY =
    container.type === "ellipse"
      ? (height / 2) * (1 - Math.SQRT2 / 2)
      : container.type === "diamond"
        ? height / 4
        : 0;
  const maxW =
    container.type === "ellipse"
      ? Math.round((width / 2) * Math.SQRT2) - BOUND_TEXT_PADDING * 2
      : container.type === "diamond"
        ? Math.round(width / 2) - BOUND_TEXT_PADDING * 2
        : width - BOUND_TEXT_PADDING * 2;
  const maxH =
    container.type === "ellipse"
      ? Math.round((height / 2) * Math.SQRT2) - BOUND_TEXT_PADDING * 2
      : container.type === "diamond"
        ? Math.round(height / 2) - BOUND_TEXT_PADDING * 2
        : height - BOUND_TEXT_PADDING * 2;
  const originX = cx + BOUND_TEXT_PADDING + insetX;
  const originY = cy + BOUND_TEXT_PADDING + insetY;
  const x =
    textAlign === "left"
      ? originX
      : textAlign === "right"
        ? originX + (maxW - size.width)
        : cx + width / 2 - size.width / 2;
  const y =
    verticalAlign === "top"
      ? originY
      : verticalAlign === "bottom"
        ? originY + (maxH - size.height)
        : cy + height / 2 - size.height / 2;
  return [x, y];
}

const centerOf = (element: WhiteboardElement): Point => [
  num(element.x) + num(element.width) / 2,
  num(element.y) + num(element.height) / 2,
];

/** Where the line from an element's centre toward `toward` leaves its outline, plus a small gap. */
function edgePoint(element: WhiteboardElement, toward: Point): Point {
  const [cx, cy] = centerOf(element);
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  const halfWidth = num(element.width) / 2;
  const halfHeight = num(element.height) / 2;
  const length = Math.hypot(dx, dy);
  if (length === 0 || halfWidth === 0 || halfHeight === 0) return [cx, cy];
  const scale =
    element.type === "ellipse"
      ? 1 / Math.hypot(dx / halfWidth, dy / halfHeight)
      : element.type === "diamond"
        ? 1 / (Math.abs(dx) / halfWidth + Math.abs(dy) / halfHeight)
        : Math.min(
            dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx),
            dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy),
          );
  return [
    cx + dx * scale + (dx / length) * BINDING_GAP,
    cy + dy * scale + (dy / length) * BINDING_GAP,
  ];
}

function linearGeometry(points: ReadonlyArray<Point>) {
  const [originX, originY] = points[0] ?? [0, 0];
  const relative = points.map(([x, y]) => [x - originX, y - originY] as const);
  const xs = relative.map(([x]) => x);
  const ys = relative.map(([, y]) => y);
  return {
    x: originX,
    y: originY,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    points: relative,
  };
}

const connect = (from: WhiteboardElement, to: WhiteboardElement) =>
  linearGeometry([edgePoint(from, centerOf(to)), edgePoint(to, centerOf(from))]);

function baseElement(
  env: WhiteboardEditEnv,
  type: string,
  id: string,
  box: { x: number; y: number; width: number; height: number },
  style: WhiteboardStyle,
): MutableElement {
  return {
    id,
    type,
    ...box,
    angle: 0,
    strokeColor: style.strokeColor ?? DEFAULT_STROKE,
    backgroundColor: style.backgroundColor ?? "transparent",
    fillStyle: style.fillStyle ?? "solid",
    strokeWidth: style.strokeWidth ?? DEFAULT_STROKE_WIDTH,
    strokeStyle: style.strokeStyle ?? "solid",
    roughness: style.roughness ?? DEFAULT_ROUGHNESS,
    opacity: style.opacity ?? DEFAULT_OPACITY,
    groupIds: style.group === undefined || style.group === "" ? [] : [style.group],
    frameId: null,
    index: null,
    roundness: roundnessValue(type, style.roundness),
    seed: randomInt(env),
    version: 1,
    versionNonce: randomInt(env),
    isDeleted: false,
    boundElements: null,
    updated: env.now,
    link: null,
    locked: false,
  };
}

function textElement(
  env: WhiteboardEditEnv,
  id: string,
  box: { x: number; y: number; width: number; height: number },
  options: {
    readonly text: string;
    readonly originalText: string;
    readonly fontSize: number;
    readonly fontFamily: number;
    readonly textAlign: WhiteboardTextAlign;
    readonly verticalAlign: WhiteboardVerticalAlign;
    readonly containerId: string | null;
    readonly autoResize: boolean;
    readonly strokeColor?: string | undefined;
    readonly opacity?: number | undefined;
    readonly groupIds?: ReadonlyArray<string> | undefined;
  },
): MutableElement {
  return {
    ...baseElement(env, "text", id, box, {
      strokeColor: options.strokeColor,
      opacity: options.opacity,
    }),
    groupIds: options.groupIds ? [...options.groupIds] : [],
    roundness: null,
    text: options.text,
    originalText: options.originalText,
    fontSize: options.fontSize,
    fontFamily: options.fontFamily,
    textAlign: options.textAlign,
    verticalAlign: options.verticalAlign,
    containerId: options.containerId,
    autoResize: options.autoResize,
    lineHeight: fontMetrics(options.fontFamily).lineHeight,
  };
}

const withBound = (element: WhiteboardElement, ref: { id: string; type: string }) => [
  ...boundRefs(element).filter((existing) => existing.id !== ref.id),
  ref,
];

class Scene {
  readonly order: Array<string> = [];
  readonly byId = new Map<string, WhiteboardElement>();
  readonly env: WhiteboardEditEnv;
  private topIndex: string | null = null;
  private indexable = true;

  constructor(elements: ReadonlyArray<WhiteboardElement>, env: WhiteboardEditEnv) {
    this.env = env;
    for (const element of elements) {
      const id = idOf(element);
      if (id === null) continue;
      this.order.push(id);
      this.byId.set(id, element);
      const index = str(element.index);
      // New elements go on top, which needs every element below them to carry an index.
      if (index === null) this.indexable = false;
      else if (this.topIndex === null || index > this.topIndex) this.topIndex = index;
    }
  }

  live(id: string | undefined): WhiteboardElement | undefined {
    const element = id === undefined ? undefined : this.byId.get(id);
    return element !== undefined && isLive(element) ? element : undefined;
  }

  put(element: MutableElement) {
    const id = element.id as string;
    if (this.byId.has(id)) {
      this.byId.set(id, element);
      return;
    }
    const index = this.indexable ? nextFractionalIndex(this.topIndex) : null;
    if (index === null) this.indexable = false;
    else this.topIndex = index;
    this.order.push(id);
    this.byId.set(id, { ...element, index });
  }

  patch(id: string, patch: MutableElement) {
    const element = this.byId.get(id);
    if (element !== undefined) this.byId.set(id, touch(element, this.env, patch));
  }

  elements(): ReadonlyArray<WhiteboardElement> {
    return this.order.flatMap((id) => {
      const element = this.byId.get(id);
      return element === undefined ? [] : [element];
    });
  }

  label(containerId: string): WhiteboardElement | undefined {
    const container = this.byId.get(containerId);
    const ref = container && boundRefs(container).find((bound) => bound.type === "text");
    return this.live(ref?.id);
  }

  /**
   * Writes, moves or removes a container's label. A shape keeps the width it was given: the label
   * wraps inside it, and the shape grows only as far as the label's longest word and height need.
   */
  setLabel(containerId: string, text: string, style: WhiteboardStyle) {
    const original = this.byId.get(containerId);
    if (original === undefined) return;
    const existing = this.label(containerId);
    if (text === "") {
      if (existing === undefined) return;
      const id = existing.id as string;
      this.patch(id, { isDeleted: true });
      this.patch(containerId, {
        boundElements: boundRefs(original).filter((ref) => ref.id !== id),
      });
      return;
    }
    const fontSize = style.fontSize ?? num(existing?.fontSize, DEFAULT_FONT_SIZE);
    const fontFamily =
      style.fontFamily === undefined
        ? num(existing?.fontFamily, DEFAULT_FONT_FAMILY)
        : FONT_ID_BY_NAME[style.fontFamily];
    const textAlign = style.textAlign ?? asTextAlign(existing?.textAlign) ?? "center";
    const verticalAlign = isLinear(original)
      ? "middle"
      : (style.verticalAlign ?? asVerticalAlign(existing?.verticalAlign) ?? "middle");
    const strokeColor = style.textColor ?? str(existing?.strokeColor) ?? DEFAULT_STROKE;
    const room = labelRoom(original);
    const shown = isLinear(original)
      ? text
      : wrapLabel(text, fontSize, num(original.width) * room - LABEL_INSET, fontFamily);
    const size = textSize(shown, fontSize, fontFamily);
    if (!isLinear(original)) {
      const fit = {
        width: Math.max(num(original.width), Math.ceil((size.width + LABEL_INSET) / room)),
        height: Math.max(num(original.height), Math.ceil((size.height + LABEL_INSET) / room)),
      };
      if (fit.width !== original.width || fit.height !== original.height) {
        this.patch(containerId, fit);
      }
    }
    const container = this.byId.get(containerId) ?? original;
    const [x, y] = boundTextPosition(container, size, textAlign, verticalAlign);
    const opacity = style.opacity ?? num(container.opacity, DEFAULT_OPACITY);
    const groupIds =
      style.group !== undefined ? (style.group === "" ? [] : [style.group]) : groupIdsOf(container);
    if (existing !== undefined) {
      this.patch(existing.id as string, {
        text: shown,
        originalText: text,
        fontSize,
        fontFamily,
        lineHeight: fontMetrics(fontFamily).lineHeight,
        textAlign,
        verticalAlign,
        strokeColor,
        opacity,
        groupIds: [...groupIds],
        ...size,
        x,
        y,
      });
      return;
    }
    const id = this.env.makeId();
    this.put(
      textElement(
        this.env,
        id,
        { x, y, ...size },
        {
          text: shown,
          originalText: text,
          fontSize,
          fontFamily,
          textAlign,
          verticalAlign,
          containerId,
          autoResize: true,
          strokeColor,
          opacity,
          groupIds,
        },
      ),
    );
    this.patch(containerId, { boundElements: withBound(container, { id, type: "text" }) });
  }

  /** Straight two-point connectors follow their shapes; hand-routed ones keep the user's path. */
  rerouteConnectors(shapeId: string) {
    const shape = this.byId.get(shapeId);
    if (shape === undefined) return;
    for (const ref of boundRefs(shape)) {
      const connector = this.live(ref.id);
      if (connector === undefined || !isLinear(connector)) continue;
      const from = this.live(bindingTarget(connector.startBinding) ?? undefined);
      const to = this.live(bindingTarget(connector.endBinding) ?? undefined);
      if (from === undefined || to === undefined || relativePoints(connector).length !== 2)
        continue;
      this.patch(ref.id, connect(from, to));
      const label = this.label(ref.id);
      const moved = this.byId.get(ref.id);
      if (label !== undefined && moved !== undefined) {
        const [x, y] = boundTextPosition(
          moved,
          { width: num(label.width), height: num(label.height) },
          "center",
          "middle",
        );
        this.patch(label.id as string, { x, y });
      }
    }
  }

  remove(id: string) {
    const element = this.live(id);
    if (element === undefined) return;
    this.patch(id, { isDeleted: true });
    for (const ref of boundRefs(element)) {
      const bound = this.live(ref.id);
      if (bound === undefined) continue;
      if (ref.type === "text") {
        this.patch(ref.id, { isDeleted: true });
      } else if (isLinear(bound)) {
        this.patch(ref.id, {
          ...(bindingTarget(bound.startBinding) === id ? { startBinding: null } : {}),
          ...(bindingTarget(bound.endBinding) === id ? { endBinding: null } : {}),
        });
      }
    }
    if (!isLinear(element)) return;
    for (const targetId of [
      bindingTarget(element.startBinding),
      bindingTarget(element.endBinding),
    ]) {
      const target = this.live(targetId ?? undefined);
      if (target === undefined || targetId === null) continue;
      this.patch(targetId, { boundElements: boundRefs(target).filter((ref) => ref.id !== id) });
    }
  }
}

function checkStyle(
  prefix: string,
  type: string | null,
  style: WhiteboardStyle & {
    readonly width?: number | undefined;
    readonly height?: number | undefined;
  },
  isUpdate: boolean,
  problems: Array<string>,
) {
  if (style.width !== undefined && (!Number.isFinite(style.width) || style.width <= 0)) {
    problems.push(`${prefix}: width must be positive, got ${String(style.width)}.`);
  }
  if (style.height !== undefined && (!Number.isFinite(style.height) || style.height <= 0)) {
    problems.push(`${prefix}: height must be positive, got ${String(style.height)}.`);
  }
  for (const field of ["strokeColor", "backgroundColor", "textColor"] as const) {
    const value = style[field];
    if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
      problems.push(`${prefix}: invalid ${field} "${String(value)}".`);
    }
  }
  if (style.strokeStyle !== undefined) {
    if (!isIn(WHITEBOARD_STROKE_STYLES, style.strokeStyle)) {
      problems.push(`${prefix}: invalid strokeStyle "${String(style.strokeStyle)}".`);
    } else if (type === "text") {
      problems.push(`${prefix}: strokeStyle does not apply to text.`);
    }
  }
  if (style.fillStyle !== undefined) {
    if (!isIn(WHITEBOARD_FILL_STYLES, style.fillStyle)) {
      problems.push(`${prefix}: invalid fillStyle "${String(style.fillStyle)}".`);
    } else if (type === "text" || type === "arrow") {
      problems.push(`${prefix}: fillStyle does not apply to ${type}.`);
    }
  }
  if (style.strokeWidth !== undefined) {
    if (
      typeof style.strokeWidth !== "number" ||
      !Number.isFinite(style.strokeWidth) ||
      style.strokeWidth <= 0
    ) {
      problems.push(`${prefix}: strokeWidth must be positive, got ${String(style.strokeWidth)}.`);
    } else if (type === "text") {
      problems.push(`${prefix}: strokeWidth does not apply to text.`);
    }
  }
  if (style.roughness !== undefined) {
    if (!isIn(WHITEBOARD_ROUGHNESS, style.roughness)) {
      problems.push(`${prefix}: invalid roughness "${String(style.roughness)}".`);
    } else if (type === "text") {
      problems.push(`${prefix}: roughness does not apply to text.`);
    }
  }
  if (style.roundness !== undefined) {
    if (!isIn(WHITEBOARD_ROUNDNESS, style.roundness)) {
      problems.push(`${prefix}: invalid roundness "${String(style.roundness)}".`);
    } else if (type !== null && !supportsRoundness(type)) {
      problems.push(`${prefix}: roundness does not apply to ${type}.`);
    }
  }
  if (
    style.opacity !== undefined &&
    (typeof style.opacity !== "number" ||
      !Number.isFinite(style.opacity) ||
      style.opacity < 0 ||
      style.opacity > 100)
  ) {
    problems.push(`${prefix}: opacity must be between 0 and 100, got ${String(style.opacity)}.`);
  }
  if (style.group !== undefined) {
    if (typeof style.group !== "string") {
      problems.push(`${prefix}: invalid group "${String(style.group)}".`);
    } else if (!isUpdate && style.group.trim() === "") {
      problems.push(`${prefix}: group cannot be empty, got "${style.group}".`);
    } else if (isUpdate && style.group !== "" && style.group.trim() === "") {
      problems.push(`${prefix}: group cannot be blank, got "${style.group}".`);
    }
  }
  if (
    style.fontSize !== undefined &&
    (typeof style.fontSize !== "number" || !Number.isFinite(style.fontSize) || style.fontSize <= 0)
  ) {
    problems.push(`${prefix}: fontSize must be positive, got ${String(style.fontSize)}.`);
  }
  if (style.fontFamily !== undefined && !isIn(WHITEBOARD_FONT_FAMILIES, style.fontFamily)) {
    problems.push(`${prefix}: invalid fontFamily "${String(style.fontFamily)}".`);
  }
  if (style.textAlign !== undefined && !isIn(WHITEBOARD_TEXT_ALIGNS, style.textAlign)) {
    problems.push(`${prefix}: invalid textAlign "${String(style.textAlign)}".`);
  }
  if (style.verticalAlign !== undefined) {
    if (!isIn(WHITEBOARD_VERTICAL_ALIGNS, style.verticalAlign)) {
      problems.push(`${prefix}: invalid verticalAlign "${String(style.verticalAlign)}".`);
    } else if (type !== null && !isShapeType(type)) {
      problems.push(`${prefix}: verticalAlign only applies to shapes, not ${type}.`);
    }
  }
  for (const field of ["startArrowhead", "endArrowhead"] as const) {
    const value = style[field];
    if (value === undefined) continue;
    if (!isIn(WHITEBOARD_ARROWHEADS, value)) {
      problems.push(`${prefix}: invalid ${field} "${String(value)}".`);
    } else if (type !== null && type !== "arrow") {
      problems.push(`${prefix}: ${field} only applies to arrows, not ${type}.`);
    }
  }
}

function checkEdit(scene: Scene, edit: WhiteboardEdit): ReadonlyArray<string> {
  const problems: Array<string> = [];
  const survivesClear = (id: string) => edit.clear !== true && scene.live(id) !== undefined;
  for (const id of edit.remove ?? []) {
    if (scene.live(id) === undefined) problems.push(`remove: no element has id "${id}".`);
  }
  for (const op of edit.update ?? []) {
    if (!survivesClear(op.id) || edit.remove?.includes(op.id)) {
      problems.push(`update: no element has id "${op.id}".`);
      continue;
    }
    const type = str(scene.live(op.id)?.type);
    if (type === "text" && op.text === "") {
      problems.push(`update: text element "${op.id}" cannot have empty text; use remove.`);
    }
    checkStyle("update", type, op, true, problems);
  }
  const newIds = new Set<string>();
  for (const op of edit.add ?? []) {
    if (op.id === undefined) continue;
    if (scene.byId.has(op.id) || newIds.has(op.id)) {
      problems.push(`add: id "${op.id}" is already used on this board.`);
    }
    newIds.add(op.id);
  }
  const resolvable = (id: string) =>
    newIds.has(id) || (survivesClear(id) && !edit.remove?.includes(id));
  for (const op of edit.add ?? []) {
    if (!isIn(WHITEBOARD_ADD_TYPES, op.type)) {
      problems.push(`add: invalid type "${String(op.type)}".`);
      continue;
    }
    checkStyle("add", op.type, op, false, problems);
    const linear = isLinearType(op.type);
    if (!linear) {
      if (op.x === undefined || op.y === undefined) {
        problems.push(`add: a ${op.type} needs x and y.`);
      }
      if (op.type === "text" && !op.text) problems.push("add: a text element needs text.");
      continue;
    }
    for (const end of [op.from, op.to]) {
      if (end !== undefined && !resolvable(end)) {
        problems.push(`add: ${op.type} refers to "${end}", which is not on the board.`);
      }
    }
    const connects = op.from !== undefined && op.to !== undefined;
    if (!connects && (op.points === undefined || op.points.length < 2)) {
      problems.push(`add: a ${op.type} needs both from and to, or at least two points.`);
    }
  }
  return problems;
}

function addShape(scene: Scene, op: WhiteboardAddOp, id: string) {
  const x = op.x ?? 0;
  const y = op.y ?? 0;
  if (op.type === "text") {
    const rawText = op.text ?? "";
    const fontSize = op.fontSize ?? DEFAULT_FONT_SIZE;
    const fontFamily =
      op.fontFamily === undefined ? DEFAULT_FONT_FAMILY : FONT_ID_BY_NAME[op.fontFamily];
    const textAlign = op.textAlign ?? "left";
    const autoResize = op.width === undefined;
    const shown = autoResize ? rawText : wrapLabel(rawText, fontSize, op.width!, fontFamily);
    const measured = textSize(shown, fontSize, fontFamily);
    const width = autoResize ? measured.width : Math.max(op.width!, measured.width);
    const boxX = autoResize
      ? textAlign === "center"
        ? x - width / 2
        : textAlign === "right"
          ? x - width
          : x
      : x;
    scene.put(
      textElement(
        scene.env,
        id,
        { x: boxX, y, width, height: measured.height },
        {
          text: shown,
          originalText: rawText,
          fontSize,
          fontFamily,
          textAlign,
          verticalAlign: "top",
          containerId: null,
          autoResize,
          strokeColor: op.textColor ?? op.strokeColor,
          opacity: op.opacity,
          groupIds: op.group === undefined ? [] : [op.group],
        },
      ),
    );
    return;
  }
  const size = {
    width: op.width ?? DEFAULT_SHAPE.width,
    height: op.height ?? DEFAULT_SHAPE.height,
  };
  scene.put(baseElement(scene.env, op.type, id, { x, y, ...size }, op));
  if (op.text) scene.setLabel(id, op.text, op);
}

function addConnector(scene: Scene, op: WhiteboardAddOp, id: string) {
  const from = scene.live(op.from);
  const to = scene.live(op.to);
  const geometry =
    from !== undefined && to !== undefined ? connect(from, to) : linearGeometry(op.points ?? []);
  const binding = (target: WhiteboardElement | undefined) =>
    target === undefined ? null : { elementId: target.id, focus: 0, gap: BINDING_GAP };
  const bound = from !== undefined && to !== undefined;
  scene.put({
    ...baseElement(scene.env, op.type, id, geometry, op),
    points: geometry.points,
    lastCommittedPoint: null,
    startBinding: bound ? binding(from) : null,
    endBinding: bound ? binding(to) : null,
    startArrowhead:
      op.type === "arrow" && op.startArrowhead !== undefined
        ? arrowheadValue(op.startArrowhead)
        : null,
    endArrowhead:
      op.type === "arrow"
        ? op.endArrowhead === undefined
          ? "arrow"
          : arrowheadValue(op.endArrowhead)
        : null,
    ...(op.type === "arrow" ? { elbowed: false } : {}),
  });
  if (bound) {
    for (const target of [from, to]) {
      const targetId = target.id as string;
      const current = scene.byId.get(targetId);
      if (current === undefined) continue;
      scene.patch(targetId, { boundElements: withBound(current, { id, type: op.type }) });
    }
  }
  if (op.text) scene.setLabel(id, op.text, op);
}

function updateElement(scene: Scene, op: WhiteboardUpdateOp) {
  const element = scene.live(op.id);
  if (element === undefined) return;
  const type = str(element.type) ?? "";
  const nextGroupIds = op.group === undefined ? undefined : op.group === "" ? [] : [op.group];
  if (type === "text") {
    const rawText = op.text ?? str(element.originalText) ?? str(element.text) ?? "";
    const fontSize = op.fontSize ?? num(element.fontSize, DEFAULT_FONT_SIZE);
    const fontFamily =
      op.fontFamily === undefined
        ? num(element.fontFamily, DEFAULT_FONT_FAMILY)
        : FONT_ID_BY_NAME[op.fontFamily];
    const textAlign = op.textAlign ?? asTextAlign(element.textAlign) ?? "left";
    const autoResize = op.width !== undefined ? false : element.autoResize !== false;
    const needsLayout =
      op.text !== undefined ||
      op.fontSize !== undefined ||
      op.fontFamily !== undefined ||
      op.width !== undefined;
    let x = op.x ?? num(element.x);
    let width = num(element.width);
    let height = num(element.height);
    let shown = str(element.text) ?? rawText;
    if (needsLayout) {
      const targetWidth = op.width ?? width;
      shown = autoResize ? rawText : wrapLabel(rawText, fontSize, targetWidth, fontFamily);
      const measured = textSize(shown, fontSize, fontFamily);
      const prevWidth = num(element.width);
      width = autoResize ? measured.width : Math.max(targetWidth, measured.width);
      height = measured.height;
      if (autoResize && op.x === undefined) {
        const prevX = num(element.x);
        x =
          textAlign === "center"
            ? prevX + (prevWidth - width) / 2
            : textAlign === "right"
              ? prevX + (prevWidth - width)
              : prevX;
      }
    }
    const textColor = op.textColor ?? op.strokeColor;
    scene.patch(op.id, {
      x,
      y: op.y ?? num(element.y),
      width,
      height,
      ...(textColor === undefined ? {} : { strokeColor: textColor }),
      ...(op.opacity === undefined ? {} : { opacity: op.opacity }),
      ...(nextGroupIds === undefined ? {} : { groupIds: nextGroupIds }),
      ...(op.textAlign === undefined ? {} : { textAlign }),
      ...(op.fontFamily === undefined
        ? {}
        : { fontFamily, lineHeight: fontMetrics(fontFamily).lineHeight }),
      ...(op.width === undefined ? {} : { autoResize: false }),
      ...(needsLayout ? { text: shown, originalText: rawText, fontSize } : {}),
    });
    return;
  }
  scene.patch(op.id, {
    x: op.x ?? num(element.x),
    y: op.y ?? num(element.y),
    width: op.width ?? num(element.width),
    height: op.height ?? num(element.height),
    ...(op.strokeColor === undefined ? {} : { strokeColor: op.strokeColor }),
    ...(op.backgroundColor === undefined ? {} : { backgroundColor: op.backgroundColor }),
    ...(op.fillStyle === undefined ? {} : { fillStyle: op.fillStyle }),
    ...(op.strokeWidth === undefined ? {} : { strokeWidth: op.strokeWidth }),
    ...(op.strokeStyle === undefined ? {} : { strokeStyle: op.strokeStyle }),
    ...(op.roughness === undefined ? {} : { roughness: op.roughness }),
    ...(op.roundness === undefined ? {} : { roundness: roundnessValue(type, op.roundness) }),
    ...(op.opacity === undefined ? {} : { opacity: op.opacity }),
    ...(nextGroupIds === undefined ? {} : { groupIds: nextGroupIds }),
    ...(type === "arrow" && op.startArrowhead !== undefined
      ? { startArrowhead: arrowheadValue(op.startArrowhead) }
      : {}),
    ...(type === "arrow" && op.endArrowhead !== undefined
      ? { endArrowhead: arrowheadValue(op.endArrowhead) }
      : {}),
  });
  const label = scene.label(op.id);
  const reshaped = [op.x, op.y, op.width, op.height].some((value) => value !== undefined);
  const labelStyled = [
    op.fontSize,
    op.fontFamily,
    op.textAlign,
    op.verticalAlign,
    op.textColor,
  ].some((value) => value !== undefined);
  if (op.text !== undefined || (label !== undefined && (reshaped || labelStyled))) {
    scene.setLabel(op.id, op.text ?? str(label?.originalText) ?? str(label?.text) ?? "", op);
  } else if (label !== undefined && (op.opacity !== undefined || nextGroupIds !== undefined)) {
    scene.patch(label.id as string, {
      ...(op.opacity === undefined ? {} : { opacity: op.opacity }),
      ...(nextGroupIds === undefined ? {} : { groupIds: [...nextGroupIds] }),
    });
  }
  scene.rerouteConnectors(op.id);
}

/**
 * What an agent cannot see without a picture: among the elements it just touched, shapes that
 * partly cover each other and arrows too short for their label.
 */
export function whiteboardLayoutWarnings(
  elements: ReadonlyArray<WhiteboardElement>,
  touchedIds: ReadonlySet<string>,
): ReadonlyArray<string> {
  const live = liveById(elements);
  const views = new Map(describeWhiteboard(elements).map((view) => [view.id, view] as const));
  const name = (id: string) => {
    const view = views.get(id);
    return view === undefined ? id : labelOf(view, views);
  };
  const warnings: Array<string> = [];
  const shapes = [...views.values()].filter(
    (view) => view.type !== "arrow" && view.type !== "line" && view.type !== "freedraw",
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
      // One shape wholly inside another is a deliberate grouping.
      if (apart || inside(a, b) || inside(b, a)) continue;
      warnings.push(`${name(a.id)} overlaps ${name(b.id)}.`);
    }
  }
  for (const [id, element] of live) {
    if (!isLinear(element) || !touchedIds.has(id)) continue;
    const label = boundRefs(element).find((ref) => ref.type === "text");
    const labelWidth = label === undefined ? null : num(live.get(label.id)?.width, 0);
    const points = relativePoints(element);
    const first = points[0];
    const last = points[points.length - 1];
    if (labelWidth === null || labelWidth === 0 || first === undefined || last === undefined)
      continue;
    const length = Math.hypot(last[0] - first[0], last[1] - first[1]);
    const needed = labelWidth + 2 * LABEL_INSET;
    if (length < needed) {
      warnings.push(
        `${name(id)} is ${round(length)} long but its label needs about ${round(needed)}; move its ends further apart.`,
      );
    }
  }
  return warnings.length <= LAYOUT_WARNING_LIMIT
    ? warnings
    : [
        ...warnings.slice(0, LAYOUT_WARNING_LIMIT),
        `And ${warnings.length - LAYOUT_WARNING_LIMIT} more layout problems.`,
      ];
}

/** Applies an agent's edit, or names every problem and changes nothing. */
export function applyWhiteboardEdit(
  elements: ReadonlyArray<WhiteboardElement>,
  edit: WhiteboardEdit,
  env: WhiteboardEditEnv,
): WhiteboardEditOutcome {
  const scene = new Scene(elements, env);
  const problems = checkEdit(scene, edit);
  if (problems.length > 0) return { ok: false, problems };
  if (edit.clear === true) {
    for (const id of scene.order) {
      if (scene.live(id) !== undefined) scene.patch(id, { isDeleted: true });
    }
  }
  for (const id of edit.remove ?? []) scene.remove(id);
  for (const op of edit.update ?? []) updateElement(scene, op);
  const adds = (edit.add ?? []).map((op) => ({ op, id: op.id ?? env.makeId() }));
  for (const { op, id } of adds) {
    if (op.type !== "arrow" && op.type !== "line") addShape(scene, op, id);
  }
  for (const { op, id } of adds) {
    if (op.type === "arrow" || op.type === "line") addConnector(scene, op, id);
  }
  return { ok: true, elements: scene.elements(), addedIds: adds.map(({ id }) => id) };
}
