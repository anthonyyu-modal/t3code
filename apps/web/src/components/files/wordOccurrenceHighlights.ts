import { DIFFS_TAG_NAME } from "@pierre/diffs";
import { type RefObject, useEffect, useEffectEvent } from "react";

import { findWordOccurrences, selectedWord, type WordOccurrence } from "./wordOccurrences";

const HIGHLIGHT_NAME = "t3-word-occurrence";
// Gutter cells share `data-line-index` with their code row but have no `data-line`.
const CODE_ROW_SELECTOR = "[data-line][data-line-index]";
const MAX_OCCURRENCES = 5_000;
// A drag selection fires selectionchange on every pointer move.
const SELECTION_SETTLE_MS = 80;

/**
 * `::highlight()` rules only style text in their own tree, so this has to ride
 * into each file's shadow root through Pierre's `unsafeCSS`.
 */
export const WORD_OCCURRENCE_UNSAFE_CSS = `
  ::highlight(${HIGHLIGHT_NAME}) {
    background-color: color-mix(in lab, var(--diffs-selection-base) 22%, transparent);
  }
`;

/**
 * Selecting one whole word in the Pierre file under `rootRef` highlights its
 * other whole-word occurrences in `readText()`, the file's current contents.
 */
export function useWordOccurrenceHighlights(
  rootRef: RefObject<HTMLElement | null>,
  readText: () => string,
): void {
  const readCurrentText = useEffectEvent(readText);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Paints highlights into the file view's DOM and listens for selections while mounted.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return installWordOccurrenceHighlights(root, () => readCurrentText());
  }, [rootRef]);
}

function installWordOccurrenceHighlights(root: HTMLElement, readText: () => string): () => void {
  let occurrencesByLine = new Map<number, WordOccurrence[]>();
  let ranges: Range[] = [];
  let observedRoot: ShadowRoot | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let paintFrame: number | undefined;
  // Pierre mounts and replaces rows as the file scrolls, re-highlights, or is
  // edited; ranges into replaced rows stop painting.
  const observer = new MutationObserver(() => {
    paintFrame ??= requestAnimationFrame(paint);
  });

  function clearRanges() {
    const highlight = sharedHighlight();
    for (const range of ranges) highlight?.delete(range);
    ranges = [];
  }

  function paint() {
    paintFrame = undefined;
    clearRanges();
    const highlight = sharedHighlight();
    if (!highlight || !observedRoot) return;
    for (const row of observedRoot.querySelectorAll<HTMLElement>(CODE_ROW_SELECTOR)) {
      for (const occurrence of occurrencesByLine.get(Number(row.dataset.lineIndex)) ?? []) {
        const range = textRange(row, occurrence.start, occurrence.end);
        if (!range) continue;
        highlight.add(range);
        ranges.push(range);
      }
    }
  }

  function clear() {
    observer.disconnect();
    observedRoot = null;
    occurrencesByLine = new Map();
    if (paintFrame !== undefined) cancelAnimationFrame(paintFrame);
    paintFrame = undefined;
    clearRanges();
  }

  function update() {
    settleTimer = undefined;
    const shadowRoot = root.querySelector(DIFFS_TAG_NAME)?.shadowRoot ?? null;
    const word = shadowRoot ? selectedWordIn(shadowRoot) : null;
    if (!shadowRoot || !word) {
      clear();
      return;
    }
    occurrencesByLine = new Map();
    for (const occurrence of findWordOccurrences(readText(), word, MAX_OCCURRENCES)) {
      const line = occurrencesByLine.get(occurrence.lineIndex);
      if (line) line.push(occurrence);
      else occurrencesByLine.set(occurrence.lineIndex, [occurrence]);
    }
    if (observedRoot !== shadowRoot) {
      observer.disconnect();
      observer.observe(shadowRoot, { childList: true, subtree: true, characterData: true });
      observedRoot = shadowRoot;
    }
    paintFrame ??= requestAnimationFrame(paint);
  }

  const onSelectionChange = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(update, SELECTION_SETTLE_MS);
  };
  document.addEventListener("selectionchange", onSelectionChange);
  return () => {
    document.removeEventListener("selectionchange", onSelectionChange);
    clearTimeout(settleTimer);
    clear();
  };
}

function sharedHighlight(): Highlight | undefined {
  if (typeof Highlight === "undefined" || typeof CSS === "undefined" || !CSS.highlights) {
    return undefined;
  }
  let highlight = CSS.highlights.get(HIGHLIGHT_NAME);
  if (!highlight) {
    highlight = new Highlight();
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);
  }
  return highlight;
}

function selectedWordIn(shadowRoot: ShadowRoot): string | null {
  const selection = document.getSelection();
  // The document's own selection API cannot see into shadow roots.
  if (!selection || typeof selection.getComposedRanges !== "function") return null;
  const [range] = selection.getComposedRanges({ shadowRoots: [shadowRoot] });
  if (!range || range.collapsed) return null;
  const row = codeRowOf(range.startContainer);
  if (!row || row !== codeRowOf(range.endContainer) || !shadowRoot.contains(row)) return null;
  return selectedWord(
    row.textContent ?? "",
    textOffsetIn(row, range.startContainer, range.startOffset),
    textOffsetIn(row, range.endContainer, range.endOffset),
  );
}

function codeRowOf(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>(CODE_ROW_SELECTOR) ?? null;
}

function textOffsetIn(row: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(row, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

function textRange(row: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let consumed = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue?.length ?? 0;
    if (!started && start < consumed + length) {
      range.setStart(node, start - consumed);
      started = true;
    }
    if (started && end <= consumed + length) {
      range.setEnd(node, end - consumed);
      return range;
    }
    consumed += length;
  }
  return null;
}
