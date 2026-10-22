import { describe, expect, it } from "vite-plus/test";

import { findWordOccurrences, selectedWord } from "./wordOccurrences";

function select(line: string, word: string, from = 0): string | null {
  const start = line.indexOf(word, from);
  return selectedWord(line, start, start + word.length);
}

describe("selectedWord", () => {
  it("accepts a whole identifier", () => {
    expect(select("total = price * qty", "price")).toBe("price");
    expect(select("self._cache_key = key", "_cache_key")).toBe("_cache_key");
    expect(select("const $el = $(node)", "$el")).toBe("$el");
    expect(select("x2 = x1 + 10", "x1")).toBe("x1");
    expect(select("return 404", "404")).toBe("404");
  });

  it("accepts identifiers in other scripts", () => {
    expect(select("größe = länge * 2", "größe")).toBe("größe");
    expect(select("变量 = 1", "变量")).toBe("变量");
    expect(select("𝑥 = 1", "𝑥")).toBe("𝑥");
  });

  it("rejects part of a word", () => {
    expect(select("prices = price", "price")).toBeNull();
    expect(select("prices = price", "price", 1)).toBe("price");
    expect(select("_price", "price")).toBeNull();
    expect(select("$price", "price")).toBeNull();
    expect(select("price2", "price")).toBeNull();
    expect(select("é𝑥", "𝑥")).toBeNull();
    expect(select("𝑥y", "y")).toBeNull();
  });

  it("rejects selections that are not a single word", () => {
    expect(select("a.b", "a.b")).toBeNull();
    expect(select("foo bar", "foo bar")).toBeNull();
    expect(select("call()", "()")).toBeNull();
    expect(selectedWord("abc", 1, 1)).toBeNull();
    expect(selectedWord("a".repeat(300), 0, 300)).toBeNull();
  });
});

describe("findWordOccurrences", () => {
  it("finds whole-word matches with zero-based lines and offsets", () => {
    const text = ["total = 0", "for price in prices:", "    total += price", ""].join("\n");
    expect(findWordOccurrences(text, "price", 100)).toEqual([
      { lineIndex: 1, start: 4, end: 9 },
      { lineIndex: 2, start: 13, end: 18 },
    ]);
    expect(findWordOccurrences(text, "total", 100)).toEqual([
      { lineIndex: 0, start: 0, end: 5 },
      { lineIndex: 2, start: 4, end: 9 },
    ]);
  });

  it("is case-sensitive", () => {
    expect(findWordOccurrences("Foo foo FOO foo", "foo", 100)).toEqual([
      { lineIndex: 0, start: 4, end: 7 },
      { lineIndex: 0, start: 12, end: 15 },
    ]);
  });

  it("treats _, $, digits, and other scripts as part of a word", () => {
    expect(findWordOccurrences("$x x _x x1 éx x", "x", 100).map((match) => match.start)).toEqual([
      3, 14,
    ]);
    expect(findWordOccurrences("$el = $el2 + $el", "$el", 100).map((match) => match.start)).toEqual(
      [0, 13],
    );
  });

  it("keeps carriage returns at the end of a line, like Pierre's rows", () => {
    expect(findWordOccurrences("a\r\nb a\r\na", "a", 100)).toEqual([
      { lineIndex: 0, start: 0, end: 1 },
      { lineIndex: 1, start: 2, end: 3 },
      { lineIndex: 2, start: 0, end: 1 },
    ]);
  });

  it("stops at the limit", () => {
    expect(findWordOccurrences("a a a a", "a", 2)).toHaveLength(2);
  });
});
