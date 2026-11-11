import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import {
  useProjects,
  useQuietThreadShells,
  useServerConfigs,
  useThreadShell,
} from "../state/entities";
import { makeThreadFixture } from "../test-fixtures";
import type { Project } from "../types";
import Sidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../commandPaletteBus", () => ({
  openCommandPalette: vi.fn(),
  isCommandPaletteOpen: () => false,
}));
vi.mock("./sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: EnvironmentId.make("local"),
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("sidebar header new thread", () => {
  it.each([
    { mode: "normal", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: true, picker: false },
    { mode: "boring", count: 1, shift: false, picker: false },
  ] as const)("$mode sidebar, $count projects, shift=$shift: picker=$picker", async (scenario) => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: scenario.mode === "boring",
    });
    const projects = [project("active"), project("idle")].slice(0, scenario.count);
    const currentProjectRef = {
      environmentId: projects[0]!.environmentId,
      projectId: projects[0]!.id,
    };
    const startThread = vi.fn().mockResolvedValue(null);
    vi.mocked(useProjects).mockReturnValue(projects);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: currentProjectRef,
      defaultProjectFallbackReady: true,
      handleNewThread: startThread,
      routeDraftId: null,
      routeThreadRef: null,
    });
    vi.mocked(openCommandPalette).mockClear();
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New thread", exact: true }), {
      modifiers: scenario.shift ? ["Shift"] : [],
    });

    if (scenario.picker) {
      expect(openCommandPalette).toHaveBeenCalledExactlyOnceWith({ open: "new-thread-in" });
      expect(startThread).not.toHaveBeenCalled();
    } else {
      expect(openCommandPalette).not.toHaveBeenCalled();
      expect(startThread).toHaveBeenCalledExactlyOnceWith(currentProjectRef);
    }
  });
});

describe("sidebar forked threads", () => {
  it("nests forks as compact sub-rows beneath their parent, toggles collapse, and shows a parent chip when orphaned", async () => {
    await page.viewport(1280, 800);
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    localStorage.removeItem("t3code:sidebar:collapsed-fork-parents");
    stack.defer(() => {
      localStorage.removeItem("t3code:sidebar:collapsed-fork-parents");
      __setClientSettingsForTests(previousSettings);
    });
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: false,
    });
    const environmentId = EnvironmentId.make("local");
    const t3Project = project("t3code");
    const parent = makeThreadFixture({
      id: ThreadId.make("parent-1"),
      environmentId,
      projectId: t3Project.id,
      title: "Migrate auth session store",
      branch: "feat/sqlite-sessions",
      userAuthoredMessageCount: 4,
      createdAt: "2026-03-09T10:00:00.000Z",
    });
    const forkDistinctBranch = makeThreadFixture({
      id: ThreadId.make("fork-1"),
      environmentId,
      projectId: t3Project.id,
      title: "Try WAL mode pool",
      branch: "feat/sqlite-wal",
      userAuthoredMessageCount: 1,
      createdAt: "2026-03-09T10:05:00.000Z",
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "fork",
      },
    });
    const forkSameBranch = makeThreadFixture({
      id: ThreadId.make("fork-2"),
      environmentId,
      projectId: t3Project.id,
      title: "Benchmark DuckDB",
      branch: "feat/sqlite-sessions",
      userAuthoredMessageCount: 1,
      createdAt: "2026-03-09T10:02:00.000Z",
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "fork",
      },
    });
    const sideChat = makeThreadFixture({
      id: ThreadId.make("btw-1"),
      environmentId,
      projectId: t3Project.id,
      title: "Why does WAL checkpoint block?",
      branch: "feat/sqlite-sessions",
      userAuthoredMessageCount: 1,
      createdAt: "2026-03-09T10:01:00.000Z",
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "fork",
        sideChat: true,
      },
    });
    const settledParent = makeThreadFixture({
      id: ThreadId.make("settled-parent"),
      environmentId,
      projectId: t3Project.id,
      title: "Legacy auth cleanup",
      settledOverride: "settled",
      settledAt: "2026-03-09T09:00:00.000Z",
      userAuthoredMessageCount: 4,
    });
    const settledParentSideChat = makeThreadFixture({
      id: ThreadId.make("settled-parent-btw"),
      environmentId,
      projectId: t3Project.id,
      title: "Old side tangent",
      userAuthoredMessageCount: 1,
      createdAt: "2026-03-09T09:10:00.000Z",
      lineage: {
        rootThreadId: settledParent.id,
        parentThreadId: settledParent.id,
        relationshipToParent: "fork",
        sideChat: true,
      },
    });
    const orphanActiveFork = makeThreadFixture({
      id: ThreadId.make("orphan-fork"),
      environmentId,
      projectId: t3Project.id,
      title: "Keep token refresh alive",
      userAuthoredMessageCount: 4,
      createdAt: "2026-03-09T09:30:00.000Z",
      lineage: {
        rootThreadId: settledParent.id,
        parentThreadId: settledParent.id,
        relationshipToParent: "fork",
      },
    });
    const shells = [
      parent,
      forkDistinctBranch,
      forkSameBranch,
      sideChat,
      settledParent,
      settledParentSideChat,
      orphanActiveFork,
    ];
    const shellByKey = new Map(
      shells.map((shell) => [`${shell.environmentId}:${shell.id}`, shell]),
    );
    useRightPanelStore.setState({ byThreadKey: {} });
    stack.defer(() => useRightPanelStore.setState({ byThreadKey: {} }));
    vi.mocked(useProjects).mockReturnValue([t3Project]);
    vi.mocked(useQuietThreadShells).mockReturnValue(shells);
    vi.mocked(useThreadShell).mockImplementation((ref) =>
      ref === null ? null : (shellByKey.get(`${ref.environmentId}:${ref.threadId}`) ?? null),
    );
    vi.mocked(useServerConfigs).mockReturnValue(new Map([[environmentId, {} as never]]));
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: { environmentId, projectId: t3Project.id },
      defaultProjectFallbackReady: true,
      handleNewThread: vi.fn().mockResolvedValue(null),
      routeDraftId: null,
      routeThreadRef: null,
    });

    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    const forkRows = screen.getByTestId("sidebar-row-fork");
    await expect
      .element(forkRows.nth(0))
      .toHaveAttribute("aria-label", "Try WAL mode pool, t3code");
    await expect.element(forkRows.nth(1)).toHaveAttribute("aria-label", "Benchmark DuckDB, t3code");
    await expect
      .element(forkRows.nth(2))
      .toHaveAttribute("aria-label", "Why does WAL checkpoint block?, t3code");
    expect(forkRows.nth(0).element().textContent).toContain("feat/sqlite-wal");
    expect(forkRows.nth(1).element().textContent).not.toContain("feat/sqlite-sessions");
    await expect.element(screen.getByText("Old side tangent")).not.toBeInTheDocument();

    await userEvent.click(forkRows.nth(2));
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, {
        environmentId,
        threadId: parent.id,
      }),
    ).toEqual({
      id: `side-chat:${sideChat.id}`,
      kind: "side-chat",
      threadId: sideChat.id,
    });

    await expect
      .element(screen.getByRole("button", { name: "Open parent thread: Legacy auth cleanup" }))
      .toBeVisible();

    const collapseToggle = screen.getByRole("button", { name: "Collapse 3 branches" });
    await userEvent.click(collapseToggle);
    await expect.element(screen.getByTestId("sidebar-row-fork")).not.toBeInTheDocument();

    const expandToggle = screen.getByRole("button", { name: "Expand 3 branches" });
    await userEvent.click(expandToggle);
    await expect
      .element(forkRows.nth(0))
      .toHaveAttribute("aria-label", "Try WAL mode pool, t3code");
  });
});
