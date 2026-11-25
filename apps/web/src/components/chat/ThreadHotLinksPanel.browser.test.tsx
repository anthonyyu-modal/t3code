import { EnvironmentId, ThreadId, type ThreadHotLink } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { readLocalApi } from "../../localApi";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { makeThreadFixture } from "../../test-fixtures";
import { ThreadHotLinksPanel } from "./ThreadHotLinksPanel";

vi.mock("../../localApi", { spy: true });
vi.mock("../../state/entities", { spy: true });
vi.mock("../../state/environments", { spy: true });
vi.mock("../../state/query", { spy: true });
vi.mock("../../state/use-atom-command", { spy: true });

describe("ThreadHotLinksPanel", () => {
  it("renders Plain and Slack hot links, opens externally on click, and refreshes on demand", async () => {
    const environmentId = EnvironmentId.make("local");
    const threadId = ThreadId.make("thread-1");
    const plainUrl =
      "https://app.plain.com/workspace/w_01KWMBPKHR6KG1HJYJKR5CW91N/thread/th_01M71FTBJTCH5N6QCNHJDD9ZNP";
    const slackUrl = "https://modal-com.slack.com/archives/C082J7T719B/p1794248046987359";
    const initialLinks: ReadonlyArray<ThreadHotLink> = [
      { url: plainUrl, label: "Plain · no_new_privs", kind: "plain" },
      { url: slackUrl, label: "Slack · Triton latency", kind: "slack" },
    ];
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const refreshMock = vi.fn().mockResolvedValue({
      _tag: "Success" as const,
      value: {
        links: [{ url: plainUrl, label: "Plain · Refreshed subject", kind: "plain" as const }],
      },
    });

    vi.mocked(useEnvironment).mockReturnValue({
      serverConfig: { environment: { capabilities: { threadHotLinks: true } } },
    } as never);
    vi.mocked(useQuietThreadShell).mockReturnValue(
      makeThreadFixture({
        id: threadId,
        environmentId,
        latestUserMessageAt: "2026-11-11T22:00:00.000Z",
      }),
    );
    vi.mocked(useEnvironmentQuery).mockReturnValue({
      data: { links: initialLinks },
      dataUpdatedAt: 1,
      error: null,
      failure: null,
      isPending: false,
      isSuccess: true,
      refresh: vi.fn(),
    });
    vi.mocked(useAtomCommand).mockReturnValue(refreshMock as never);
    vi.mocked(readLocalApi).mockReturnValue({
      shell: { openExternal },
    } as never);

    await using screen = await render(
      <ThreadHotLinksPanel environmentId={environmentId} threadId={threadId} />,
    );

    await expect.element(screen.getByText("Hot links")).toBeVisible();
    await expect.element(screen.getByText("Plain · no_new_privs")).toBeVisible();
    await expect.element(screen.getByText("Plain · …DD9ZNP")).toBeVisible();
    await expect.element(screen.getByText("Slack · Triton latency")).toBeVisible();
    await expect.element(screen.getByText("Slack · modal-com")).toBeVisible();

    await userEvent.click(screen.getByText("Plain · no_new_privs"));
    expect(openExternal).toHaveBeenCalledWith(plainUrl);

    await userEvent.click(screen.getByRole("button", { name: "Refresh hot links" }));
    expect(refreshMock).toHaveBeenCalledWith({
      environmentId,
      input: { threadId, refresh: true },
    });
    await expect.element(screen.getByText("Plain · Refreshed subject")).toBeVisible();
  });
});
