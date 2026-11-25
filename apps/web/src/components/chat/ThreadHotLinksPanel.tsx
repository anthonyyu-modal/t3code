/* oxlint-disable t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadHotLink, ThreadId } from "@t3tools/contracts";
import {
  ActivityIcon,
  BoxIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HashIcon,
  InboxIcon,
  LayersIcon,
  RefreshCwIcon,
} from "lucide-react";
import { type MouseEvent, useState } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

function formatHotLinkSubtitle(link: ThreadHotLink): string {
  if (!URL.canParse(link.url)) return link.kind;
  const parsed = new URL(link.url);
  switch (link.kind) {
    case "plain": {
      const threadMatch = /\/thread\/(th_[A-Za-z0-9]+)/.exec(parsed.pathname);
      return threadMatch?.[1] ? `Plain · …${threadMatch[1].slice(-6)}` : "Plain";
    }
    case "slack": {
      const workspace = parsed.hostname.replace(/\.slack\.com$/i, "");
      return workspace && workspace !== "app" && workspace !== "slack.com"
        ? `Slack · ${workspace}`
        : "Slack";
    }
    case "github": {
      const repoMatch = /^\/([^/]+\/[^/]+)/.exec(parsed.pathname);
      return repoMatch?.[1] ? `GitHub · ${repoMatch[1]}` : "GitHub";
    }
    case "linear": {
      const issueMatch = /\/issue\/([A-Za-z0-9]+-\d+)/.exec(parsed.pathname);
      return issueMatch?.[1] ? `Linear · ${issueMatch[1].toUpperCase()}` : "Linear";
    }
    case "notion":
      return "Notion";
    case "datadog":
      return "Datadog";
    case "modal":
      return "Modal";
    case "link":
      return parsed.hostname.replace(/^www\./i, "");
  }
}

function HotLinkKindIcon({ kind }: { readonly kind: ThreadHotLink["kind"] }) {
  switch (kind) {
    case "plain":
      return <InboxIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />;
    case "slack":
      return <HashIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />;
    case "github":
      return <CodeIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />;
    case "linear":
      return <LayersIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />;
    case "notion":
      return <FileTextIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />;
    case "datadog":
      return <ActivityIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />;
    case "modal":
      return <BoxIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />;
    case "link":
      return <ExternalLinkIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />;
  }
}

interface ThreadHotLinksPanelProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

export function ThreadHotLinksPanel(props: ThreadHotLinksPanelProps) {
  return <ThreadHotLinksList key={`${props.environmentId}:${props.threadId}`} {...props} />;
}

function ThreadHotLinksList(props: ThreadHotLinksPanelProps) {
  const supportsHotLinks =
    useEnvironment(props.environmentId)?.serverConfig?.environment.capabilities.threadHotLinks ===
    true;
  const shell = useQuietThreadShell(scopeThreadRef(props.environmentId, props.threadId));
  const messageRevision = shell?.latestUserAuthoredMessageAt ?? shell?.latestUserMessageAt ?? null;
  const queryResult = useEnvironmentQuery(
    supportsHotLinks && shell !== null
      ? orchestrationEnvironment.threadHotLinks({
          environmentId: props.environmentId,
          input: { threadId: props.threadId, messageRevision },
        })
      : null,
  );
  const refreshCommand = useAtomCommand(orchestrationEnvironment.refreshThreadHotLinks, {
    reportFailure: false,
  });
  const [refreshedState, setRefreshedState] = useState<{
    readonly revision: string | null;
    readonly links: ReadonlyArray<ThreadHotLink>;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const { copyToClipboard } = useCopyToClipboard<{ readonly url: string }>({
    onCopy: ({ url }) => {
      setCopiedUrl(url);
      window.setTimeout(() => {
        setCopiedUrl((current) => (current === url ? null : current));
      }, 1_500);
    },
  });

  const queriedLinks = queryResult.data?.links ?? [];
  const links =
    refreshedState !== null && refreshedState.revision === messageRevision
      ? refreshedState.links
      : queriedLinks;

  if (!supportsHotLinks || (links.length === 0 && !refreshing)) {
    return null;
  }

  const openExternalLink = async (url: string, event: MouseEvent<HTMLElement>) => {
    if (event.button > 1) return;
    event.preventDefault();
    const localApi = readLocalApi();
    if (localApi) {
      await localApi.shell.openExternal(url).catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open link",
            description: error instanceof Error ? error.message : String(error),
          }),
        );
      });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const result = await refreshCommand({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, refresh: true },
    });
    setRefreshing(false);
    if (result._tag === "Success") {
      setRefreshedState({ revision: messageRevision, links: result.value.links });
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not refresh hot links",
          description: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-hot-links-heading"
      title="Hot links"
      actions={
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                size="icon-xs"
                variant="ghost"
                part="icon"
                aria-label="Refresh hot links"
                disabled={refreshing}
                onClick={() => void handleRefresh()}
              />
            }
          >
            <RefreshCwIcon aria-hidden className={cn("size-3", refreshing && "animate-spin")} />
          </TooltipTrigger>
          <TooltipPopup side="left">Re-extract hot links from your messages</TooltipPopup>
        </Tooltip>
      }
    >
      <ul className="m-0 list-none p-0">
        {links.map((link) => (
          <li key={link.url} className="group relative flex items-center rounded-lg">
            <Tooltip>
              <TooltipTrigger
                delay={200}
                render={
                  <ThreadDetailsControl
                    size="sm"
                    variant="ghost"
                    part="row"
                    multiline
                    onClick={(event) => void openExternalLink(link.url, event)}
                    onAuxClick={(event) => void openExternalLink(link.url, event)}
                  />
                }
              >
                <HotLinkKindIcon kind={link.kind} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 pe-6">
                  <span className="truncate text-sm font-medium leading-4 text-foreground/85">
                    {link.label}
                  </span>
                  <span className="truncate text-2xs font-normal leading-4 text-muted-foreground">
                    {formatHotLinkSubtitle(link)}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipPopup side="left" className="max-w-xs break-all">
                {link.url}
              </TooltipPopup>
            </Tooltip>
            <div className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ThreadDetailsControl
                      size="icon-xs"
                      variant="ghost"
                      part="icon"
                      aria-label={`Copy link for ${link.label}`}
                      onClick={() => copyToClipboard(link.url, { url: link.url })}
                    />
                  }
                >
                  {copiedUrl === link.url ? (
                    <CheckIcon aria-hidden className="size-3" />
                  ) : (
                    <CopyIcon aria-hidden className="size-3" />
                  )}
                </TooltipTrigger>
                <TooltipPopup side="left">Copy URL</TooltipPopup>
              </Tooltip>
            </div>
          </li>
        ))}
      </ul>
    </ThreadDetailsSection>
  );
}
