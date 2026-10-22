import { Editor } from "@pierre/diffs/edit";
import { EditProvider, File } from "@pierre/diffs/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import {
  WORD_OCCURRENCE_UNSAFE_CSS,
  useWordOccurrenceHighlights,
} from "./wordOccurrenceHighlights";

const SOURCE = ["price = 3", "prices = [price, price * 2]", "total = price + len(prices)", ""].join(
  "\n",
);

function Harness({ edit }: { edit: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useWordOccurrenceHighlights(rootRef, () => SOURCE);
  return (
    <div ref={rootRef}>
      <EditProvider createEditor={(type, options, key) => new Editor(type, options, key)}>
        <File
          file={{ name: "prices.txt", contents: SOURCE }}
          edit={edit}
          options={{ disableFileHeader: true, unsafeCSS: WORD_OCCURRENCE_UNSAFE_CSS }}
        />
      </EditProvider>
    </div>
  );
}

function highlighted(): string[] {
  return [...(CSS.highlights.get("t3-word-occurrence") ?? [])].map((range) => {
    const { startContainer, startOffset, endOffset } = range;
    const row = startContainer.parentElement?.closest<HTMLElement>("[data-line]");
    return `${row?.dataset.line}:${startOffset}:${startContainer.nodeValue?.slice(startOffset, endOffset)}`;
  });
}

describe("word occurrence highlights", () => {
  it.each([
    { mode: "view", edit: false },
    { mode: "edit", edit: true },
  ])("highlights whole-word occurrences of a selected word ($mode mode)", async ({ edit }) => {
    await using screen = await render(<Harness edit={edit} />);
    using _selection = {
      [Symbol.dispose]: () => document.getSelection()?.removeAllRanges(),
    };
    const shadowRoot = () => screen.container.querySelector("diffs-container")?.shadowRoot;
    const row = (line: number) =>
      shadowRoot()?.querySelector<HTMLElement>(`[data-line="${line}"]`) ?? null;
    const selectInRow = (line: number, start: number, end: number) => {
      const text = row(line)!.firstElementChild!.firstChild!;
      document.getSelection()!.setBaseAndExtent(text, start, text, end);
    };
    await vi.waitFor(() => expect(row(3)).not.toBeNull());
    await vi.waitFor(() =>
      expect(shadowRoot()?.querySelector("[contenteditable]") != null).toBe(edit),
    );

    const occurrences = ["1:0:price", "2:10:price", "2:17:price", "3:8:price"];
    selectInRow(1, 0, 5);
    await vi.waitFor(() => expect(highlighted().toSorted()).toEqual(occurrences));

    // "price" inside "prices" is not a whole word.
    selectInRow(2, 0, 5);
    await vi.waitFor(() => expect(highlighted()).toEqual([]));

    selectInRow(3, 8, 13);
    await vi.waitFor(() => expect(highlighted().toSorted()).toEqual(occurrences));

    document.getSelection()!.collapseToStart();
    await vi.waitFor(() => expect(highlighted()).toEqual([]));
  });
});
