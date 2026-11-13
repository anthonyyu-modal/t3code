import { EnvironmentId, ThreadId, type WhiteboardDirectory } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { LiveWhiteboards, WhiteboardSlot } from "./liveBoards";

const state = vi.hoisted(() => ({ directory: "loading" as WhiteboardDirectory | "loading" }));

vi.mock("../../state/whiteboard", () => ({
  useWhiteboardDirectory: () => state.directory,
}));

// The picker talks to the server, which this test has none of.
vi.mock("./WhiteboardBoardBar", () => ({ WhiteboardBoardBar: () => null }));

// Stands in for Excalidraw: like its undo history, the count lives only in the mounted component.
vi.mock("./WhiteboardPanel", () => ({
  default: function Board(props: { readonly board: { readonly kind: string } }) {
    const [edits, setEdits] = useState(0);
    return (
      <button
        onClick={() => setEdits(edits + 1)}
      >{`${props.board.kind} board, ${edits} edits`}</button>
    );
  },
}));

const environmentId = EnvironmentId.make("environment-a");
const threadA = { environmentId, threadId: ThreadId.make("thread-a") };
const threadB = { environmentId, threadId: ThreadId.make("thread-b") };
const plan = { boardId: "plan", name: "Plan" };

function setup(directory: WhiteboardDirectory) {
  state.directory = directory;
}

const panel = (threadRef: typeof threadA | null) => (
  <>
    <LiveWhiteboards />
    {threadRef === null ? null : <WhiteboardSlot threadRef={threadRef} />}
  </>
);

it("keeps a board mounted while no tab shows it", async () => {
  setup({ boards: [], selected: {} });
  // No router: the board and its slot use neither links nor navigation.
  await using screen = await render(panel(threadA), { router: false });
  await userEvent.click(screen.getByRole("button", { name: "thread board, 0 edits" }));

  await screen.rerender(panel(null));
  await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
  await screen.rerender(panel(threadA));
  await expect.element(screen.getByRole("button", { name: "thread board, 1 edits" })).toBeVisible();
});

it("shows a shared board as one board in every thread, until it is deleted", async () => {
  setup({ boards: [plan], selected: { "thread-a": "plan", "thread-b": "plan" } });
  // No router: the board and its slot use neither links nor navigation.
  await using screen = await render(panel(threadA), { router: false });
  await userEvent.click(screen.getByRole("button", { name: "shared board, 0 edits" }));

  await screen.rerender(panel(threadB));
  await expect.element(screen.getByRole("button", { name: "shared board, 1 edits" })).toBeVisible();

  setup({ boards: [], selected: {} });
  await screen.rerender(panel(threadB));
  await expect.element(screen.getByRole("button", { name: "thread board, 0 edits" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /shared board/ }))
    .not.toBeInTheDocument();
});
