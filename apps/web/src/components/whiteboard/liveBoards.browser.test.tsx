import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { useRightPanelStore } from "../../rightPanelStore";
import { LiveWhiteboards, WhiteboardSlot } from "./liveBoards";

// Stands in for Excalidraw: like its undo history, the count lives only in the mounted component.
vi.mock("./WhiteboardPanel", () => ({
  default: function Board() {
    const [edits, setEdits] = useState(0);
    return <button onClick={() => setEdits(edits + 1)}>{`${edits} edits`}</button>;
  },
}));

const threadRef = {
  environmentId: EnvironmentId.make("environment-a"),
  threadId: ThreadId.make("thread-1"),
};

function setWhiteboardTab(open: boolean) {
  useRightPanelStore.setState({
    byThreadKey: {
      [scopedThreadKey(threadRef)]: {
        isOpen: true,
        activeSurfaceId: null,
        surfaces: open ? [{ id: "whiteboard", kind: "whiteboard" }] : [],
      },
    },
  });
}

const panel = (shown: boolean) => (
  <>
    <LiveWhiteboards />
    {shown ? <WhiteboardSlot threadRef={threadRef} /> : null}
  </>
);

it("keeps a board mounted while its tab is hidden, until the tab closes", async () => {
  setWhiteboardTab(true);
  // No router: the board and its slot use neither links nor navigation.
  await using screen = await render(panel(true), { router: false });
  await userEvent.click(screen.getByRole("button", { name: "0 edits" }));

  await screen.rerender(panel(false));
  await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
  await screen.rerender(panel(true));
  await expect.element(screen.getByRole("button", { name: "1 edits" })).toBeVisible();

  await screen.rerender(panel(false));
  await act(() => setWhiteboardTab(false));
  await act(() => setWhiteboardTab(true));
  await screen.rerender(panel(true));
  await expect.element(screen.getByRole("button", { name: "0 edits" })).toBeVisible();
});
