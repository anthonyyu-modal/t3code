import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  type AssistantCitation,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { toastManager } from "../ui/toast";
import {
  AssistantSelectionToolbar,
  hasActiveAssistantSelection,
} from "./AssistantSelectionToolbar";
import type { ChatComposerHandle } from "./ChatComposer";
import { useChatShortcuts } from "./useChatShortcuts";

const threadRef = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-1"),
};

function selectText(element: HTMLElement) {
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function CitationHarness(props: { text: string; cited: AssistantCitation[]; inert?: boolean }) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  useChatShortcuts({
    enabled: true,
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    scriptKeybindings: [],
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: false,
      isWeb: true,
      isDesktop: false,
      modelPickerOpen: false,
      assistantSelection: hasActiveAssistantSelection(),
    }),
    threadFindActive: false,
    composerRef: { current: {} as ChatComposerHandle },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: {},
    fallback: () => undefined,
  });
  return (
    <div inert={props.inert} ref={setViewport} className="h-40 w-80 overflow-auto">
      <div data-assistant-citation-source="msg-1">
        <p data-testid="response-text">{props.text}</p>
      </div>
      <AssistantSelectionToolbar
        viewport={viewport}
        threadRef={threadRef}
        onCite={(citation) => {
          props.cited.push(citation);
          return true;
        }}
      />
    </div>
  );
}

// router: false because AssistantSelectionToolbar and useChatShortcuts do not navigate.
const options = { router: false } as const;

it("cites the selected assistant passage with the default shortcut and clears the selection", async () => {
  const cited: AssistantCitation[] = [];
  await using screen = await render(
    <CitationHarness text="Quoted reply text" cited={cited} />,
    options,
  );
  const paragraph = screen.getByTestId("response-text").element() as HTMLElement;
  selectText(paragraph);

  await userEvent.keyboard("{Control>}{Shift>}.{/Shift}{/Control}");

  expect(cited).toHaveLength(1);
  expect(cited[0]?.text).toBe("Quoted reply text");
  expect(window.getSelection()?.isCollapsed).toBe(true);
});

it("ignores selections inside an inert background timeline", async () => {
  const cited: AssistantCitation[] = [];
  await using screen = await render(
    <CitationHarness text="Background reply" cited={cited} inert />,
    options,
  );
  selectText(screen.getByTestId("response-text").element() as HTMLElement);

  await userEvent.keyboard("{Control>}{Shift>}.{/Shift}{/Control}");

  expect(cited).toEqual([]);
});

it("warns instead of citing when the selected passage exceeds the maximum length", async () => {
  const cited: AssistantCitation[] = [];
  const longText = "a".repeat(ASSISTANT_CITATION_MAX_TEXT_LENGTH + 1);
  await using screen = await render(<CitationHarness text={longText} cited={cited} />, options);
  using toast = vi.spyOn(toastManager, "add");
  selectText(screen.getByTestId("response-text").element() as HTMLElement);

  await userEvent.keyboard("{Control>}{Shift>}.{/Shift}{/Control}");

  expect(cited).toEqual([]);
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({ type: "warning", title: "Selection is too long to cite" }),
  );
});
