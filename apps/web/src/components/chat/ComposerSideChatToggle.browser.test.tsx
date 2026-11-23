import { createMemoryHistory } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { MessageId, RunId, type OrchestrationV2Run } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  dispatchedCommands,
  installFakeEnvironment,
  rejectPendingCommand,
  threadWithHistory,
  type FakeDriver,
  type FakeThread,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const insertText = (text: string) => cdp().send("Input.insertText", { text });

async function renderThread(
  thread: FakeThread,
  options?: Parameters<typeof installFakeEnvironment>[1],
) {
  await page.viewport(1400, 900);
  const environment = installFakeEnvironment([thread], {
    acceptCommands: true,
    ...options,
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  const app = await render(<AppRoot router={router} />, { router: false });
  await expect.element(page.getByText(`Answer 0 for ${thread.id}.`)).toBeVisible();
  return {
    [Symbol.asyncDispose]: async () => {
      await app[Symbol.asyncDispose]();
      environment[Symbol.dispose]();
    },
  };
}

it("toggles side chat mode from the composer button, sends without /side, resets on send, and disarms on Escape", async () => {
  const thread = threadWithHistory("side-toggle-basic", 1);
  await using _rendered = await renderThread(thread);

  const editor = page.getByRole("textbox", { name: `Message ${thread.title}`, exact: true });
  const toggle = page.getByRole("button", { name: "Toggle side chat", exact: true });
  const sideChatTabs = page.getByRole("button", { name: "Side chat", exact: true });

  await expect.element(toggle).toBeVisible();
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");

  // Arming with an empty composer updates visuals, ignores bare Enter, and disarms on Escape.
  await userEvent.click(toggle);
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  await expect
    .element(page.getByRole("button", { name: "Send in side chat", exact: true }))
    .toBeDisabled();
  await userEvent.keyboard("{Enter}");
  expect(dispatchedCommands().filter((command) => command.type === "thread.fork")).toHaveLength(0);
  await userEvent.keyboard("{Escape}");
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");

  // Type first, then toggle side chat on and send without any `/side` prefix.
  await userEvent.click(editor);
  await insertText("why did the build fail?");
  await userEvent.click(toggle);
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  await expect
    .element(page.getByRole("button", { name: "Send in side chat", exact: true }))
    .toBeEnabled();

  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(dispatchedCommands()).toContainEqual(
      expect.objectContaining({ type: "thread.fork", sideChat: true }),
    ),
  );
  await vi.waitFor(() =>
    expect(dispatchedCommands()).toContainEqual(
      expect.objectContaining({ type: "message.dispatch", text: "why did the build fail?" }),
    ),
  );
  await expect.element(sideChatTabs).toHaveLength(1);
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");

  // The opened side chat pane does not offer nested side-chat toggles.
  const pane = page.elementLocator(document.querySelector("[data-side-chat-pane]") as HTMLElement);
  await expect.element(pane).toBeVisible();
  await expect
    .element(pane.getByRole("button", { name: "Toggle side chat", exact: true }))
    .not.toBeInTheDocument();
});

it("selects /side or /btw mid-prompt to toggle side chat mode instead of prefixing text", async () => {
  const thread = threadWithHistory("side-toggle-slash", 1);
  await using _rendered = await renderThread(thread);

  const editor = page.getByRole("textbox", { name: `Message ${thread.title}`, exact: true });
  const toggle = page.getByRole("button", { name: "Toggle side chat", exact: true });

  await userEvent.click(editor);
  await insertText("explain this error /btw");
  const btwOption = page.getByRole("option", { name: /\/btw/ });
  await expect.element(btwOption).toBeVisible();
  await userEvent.keyboard("{Enter}");

  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  await vi.waitFor(() =>
    expect((editor.element() as HTMLElement).innerText.trim()).toBe("explain this error"),
  );

  // Picking /side again while armed toggles side chat mode back off.
  await insertText(" /side");
  const sideOption = page.getByRole("option", { name: /^\/side/ });
  await expect.element(sideOption).toBeVisible();
  await expect.element(sideOption.getByText("Turn off side chat mode")).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  await vi.waitFor(() =>
    expect((editor.element() as HTMLElement).innerText.trim()).toBe("explain this error"),
  );

  // Arm again via /btw at the end and send.
  await insertText(" /btw");
  await expect.element(page.getByRole("option", { name: /\/btw/ })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("{Enter}");

  await vi.waitFor(() =>
    expect(dispatchedCommands()).toContainEqual(
      expect.objectContaining({ type: "message.dispatch", text: "explain this error" }),
    ),
  );
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
});

it("syncs with typed /side prefix, strips it when toggled off, and restores toggle state on failure", async () => {
  const thread = threadWithHistory("side-toggle-restore", 1);
  let holdFork = false;
  await using _rendered = await renderThread(thread, {
    holdCommand: (command) => holdFork && command.type === "thread.fork",
  });

  const editor = page.getByRole("textbox", { name: `Message ${thread.title}`, exact: true });
  const toggle = page.getByRole("button", { name: "Toggle side chat", exact: true });

  // Typing `/side ...` directly lights up the toggle; clicking it off strips the prefix.
  await userEvent.click(editor);
  await insertText("/side check the logs");
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(toggle);
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  await vi.waitFor(() =>
    expect((editor.element() as HTMLElement).innerText.trim()).toBe("check the logs"),
  );

  // When a toggled send fails, both the draft text and the toggle state are restored.
  holdFork = true;
  await userEvent.click(toggle);
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(dispatchedCommands().filter((command) => command.type === "thread.fork")).toHaveLength(
      1,
    ),
  );
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");

  await rejectPendingCommand("Side chats are paused.");
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  await vi.waitFor(() =>
    expect((editor.element() as HTMLElement).innerText.trim()).toBe("check the logs"),
  );
});

it("sends to a side chat while the main thread is running without steering or queueing", async () => {
  const base = threadWithHistory("side-toggle-running", 1);
  const firstRun = base.runs[0]!;
  const runningRun: OrchestrationV2Run = {
    ...firstRun,
    id: RunId.make("side-toggle-running-active"),
    ordinal: 2,
    userMessageId: MessageId.make("side-toggle-running-user-1"),
    status: "running",
    startedAt: DateTime.makeUnsafe("2026-03-17T19:13:00.000Z"),
    completedAt: null,
  };
  const thread: FakeThread = { ...base, runs: [...base.runs, runningRun] };
  await using _rendered = await renderThread(thread);

  const editor = page.getByRole("textbox", { name: `Message ${thread.title}`, exact: true });
  const toggle = page.getByRole("button", { name: "Toggle side chat", exact: true });

  await userEvent.click(editor);
  await insertText("quick question while busy");
  await expect
    .element(page.getByRole("button", { name: "Steer message", exact: true }))
    .toBeVisible();

  await userEvent.click(toggle);
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  await expect
    .element(page.getByRole("button", { name: "Send in side chat", exact: true }))
    .toBeVisible();

  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(dispatchedCommands()).toContainEqual(
      expect.objectContaining({ type: "thread.fork", sideChat: true }),
    ),
  );
  await vi.waitFor(() =>
    expect(dispatchedCommands()).toContainEqual(
      expect.objectContaining({ type: "message.dispatch", text: "quick question while busy" }),
    ),
  );
});

it("hides the side chat toggle on a new draft thread before the first message", async () => {
  await page.viewport(1400, 900);
  const existing = threadWithHistory("side-toggle-draft-peer", 1);
  using _environment = installFakeEnvironment([existing], { acceptCommands: true });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const draftId = DraftId.make("draft-side-toggle");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId);
  const router = getRouter(createMemoryHistory({ initialEntries: [`/draft/${draftId}`] }));
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });

  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  await expect.element(page.getByText("render", { exact: true }).first()).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Toggle side chat", exact: true }))
    .not.toBeInTheDocument();
});
