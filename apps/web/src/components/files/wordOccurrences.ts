// Identifier characters across common languages: letters (any script), combining
// marks, digits, `_`, and `$` (JavaScript, PHP, shell).
const WORD_CHAR = String.raw`[\p{L}\p{M}\p{N}_$]`;
// The `v` flag, not `u`: V8 in Node 26 stops matching astral letters such as
// `𝑥` with a property class followed by `$` under `u`.
const WORD = new RegExp(`^${WORD_CHAR}+$`, "v");
const ENDS_WITH_WORD_CHAR = new RegExp(`${WORD_CHAR}$`, "v");
const STARTS_WITH_WORD_CHAR = new RegExp(`^${WORD_CHAR}`, "v");

const MAX_WORD_LENGTH = 256;

export interface WordOccurrence {
  /** Zero-based line, split after each `\n` like Pierre's renderer. */
  readonly lineIndex: number;
  /** UTF-16 offsets within the line. */
  readonly start: number;
  readonly end: number;
}

/**
 * The word to highlight when `lineText.slice(start, end)` is selected, or null
 * unless the selection is exactly one whole identifier-like word.
 */
export function selectedWord(lineText: string, start: number, end: number): string | null {
  if (start < 0 || end > lineText.length || end - start > MAX_WORD_LENGTH) return null;
  const text = lineText.slice(start, end);
  if (!WORD.test(text)) return null;
  // Two code units cover a neighbouring surrogate pair.
  if (ENDS_WITH_WORD_CHAR.test(lineText.slice(Math.max(0, start - 2), start))) return null;
  if (STARTS_WITH_WORD_CHAR.test(lineText.slice(end, end + 2))) return null;
  return text;
}

/** Case-sensitive, whole-word occurrences of `word` in `text`, at most `limit`. */
export function findWordOccurrences(text: string, word: string, limit: number): WordOccurrence[] {
  const pattern = new RegExp(
    `(?<!${WORD_CHAR})${word.replaceAll("$", "\\$")}(?!${WORD_CHAR})`,
    "gv",
  );
  const occurrences: WordOccurrence[] = [];
  let lineIndex = 0;
  let lineStart = 0;
  let newline = text.indexOf("\n");
  for (const match of text.matchAll(pattern)) {
    while (newline !== -1 && newline < match.index) {
      lineIndex += 1;
      lineStart = newline + 1;
      newline = text.indexOf("\n", lineStart);
    }
    const start = match.index - lineStart;
    occurrences.push({ lineIndex, start, end: start + word.length });
    if (occurrences.length >= limit) break;
  }
  return occurrences;
}
