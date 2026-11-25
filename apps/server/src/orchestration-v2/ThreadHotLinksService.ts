import {
  isCompactionCommandMessage,
  OrchestrationV2GetShellSnapshotError,
  ThreadHotLink,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2GetThreadHotLinksInput,
  type OrchestrationV2ThreadHotLinks,
  type RunId,
  type ThreadHotLinkKind,
  type ThreadId,
} from "@t3tools/contracts";
import { limitTitleMessage } from "@t3tools/provider-core/server/threadTitleContext";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import { isAttachmentOnlyBootstrapPrompt } from "@t3tools/shared/composerContextReferences";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const MAX_CANDIDATE_URLS = 24;
const MAX_HOT_LINKS = 6;
const MAX_LABEL_CHARS = 48;
const MAX_MESSAGE_BUDGET = 2_000;
const MAX_TOTAL_MESSAGE_CHARS = 8_000;

const StoredHotLinksJson = Schema.fromJsonString(Schema.Array(ThreadHotLink));
const decodeStoredHotLinks = Schema.decodeUnknownOption(StoredHotLinksJson);
const encodeStoredHotLinks = Schema.encodeSync(StoredHotLinksJson);

function stripAssistantQuotedText(text: string): string {
  const citations = collectAssistantCitations(text);
  if (citations.length === 0) return text;
  let cursor = 0;
  let output = "";
  for (const entry of citations) {
    output += text.slice(cursor, entry.start);
    if (entry.citation.comment) {
      output += entry.citation.comment;
    }
    cursor = entry.end;
  }
  output += text.slice(cursor);
  return output;
}

function cleanCandidateUrlToken(raw: string): string {
  let candidate = raw.replace(/[.,:;!?*]+$/, "");
  const countChar = (value: string, target: string) => {
    let total = 0;
    for (const ch of value) {
      if (ch === target) total += 1;
    }
    return total;
  };
  while (candidate.endsWith(")") && countChar(candidate, ")") > countChar(candidate, "(")) {
    candidate = candidate.slice(0, -1).replace(/[.,:;!?*]+$/, "");
  }
  while (candidate.endsWith("]") && countChar(candidate, "]") > countChar(candidate, "[")) {
    candidate = candidate.slice(0, -1).replace(/[.,:;!?*]+$/, "");
  }
  while (candidate.endsWith("}") && countChar(candidate, "}") > countChar(candidate, "{")) {
    candidate = candidate.slice(0, -1).replace(/[.,:;!?*]+$/, "");
  }
  return candidate;
}

function isLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "0.0.0.0" ||
    lower === "[::1]" ||
    lower === "::1" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local")
  );
}

function extractCandidateHotLinkUrls(userMessageTexts: ReadonlyArray<string>): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const rawText of userMessageTexts) {
    const cleanedText = stripAssistantQuotedText(rawText);
    for (const match of cleanedText.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
      const candidate = cleanCandidateUrlToken(match[0]);
      if (!URL.canParse(candidate)) continue;
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      if (isLocalHostname(parsed.hostname)) continue;
      const normalized = parsed.href;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
      if (urls.length >= MAX_CANDIDATE_URLS) return urls;
    }
  }
  return urls;
}

function classifyThreadHotLinkKind(url: URL): ThreadHotLinkKind {
  const host = url.hostname.toLowerCase();
  if (host === "app.plain.com" || host.endsWith(".plain.com")) return "plain";
  if (host === "slack.com" || host.endsWith(".slack.com")) return "slack";
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host === "linear.app" || host.endsWith(".linear.app")) return "linear";
  if (host === "notion.so" || host === "www.notion.so" || host.endsWith(".notion.site")) {
    return "notion";
  }
  if (host.includes("datadoghq.")) return "datadog";
  if (host === "modal.com" || host.endsWith(".modal.com")) return "modal";
  return "link";
}

function defaultThreadHotLinkLabel(url: URL, kind: ThreadHotLinkKind): string {
  switch (kind) {
    case "plain": {
      const threadMatch = /\/thread\/(th_[A-Za-z0-9]+)/.exec(url.pathname);
      if (threadMatch?.[1]) return `Plain · …${threadMatch[1].slice(-6)}`;
      return "Plain thread";
    }
    case "slack":
      return "Slack thread";
    case "github": {
      const prOrIssue = /^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/.exec(url.pathname);
      if (prOrIssue) {
        const [, , repo, resource, num] = prOrIssue;
        const prefix = resource === "pull" ? "PR" : "Issue";
        return `${repo} ${prefix} #${num}`.slice(0, MAX_LABEL_CHARS);
      }
      return "GitHub link";
    }
    case "linear": {
      const issueMatch = /\/issue\/([A-Za-z0-9]+-\d+)/.exec(url.pathname);
      return issueMatch?.[1] ? `Linear ${issueMatch[1].toUpperCase()}` : "Linear issue";
    }
    case "notion":
      return "Notion page";
    case "datadog":
      return "Datadog view";
    case "modal":
      return url.pathname.startsWith("/docs") ? "Modal docs" : "Modal app";
    case "link": {
      const host = url.hostname.replace(/^www\./i, "");
      const segment = url.pathname
        .split("/")
        .filter(Boolean)
        .at(-1)
        ?.replace(/[-_]+/g, " ")
        .slice(0, 20);
      return segment ? `${host} · ${segment}`.slice(0, MAX_LABEL_CHARS) : host;
    }
  }
}

function sanitizeHotLinkLabel(rawLabel: string, fallback: string): string {
  const collapsed = rawLabel
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!collapsed || /^https?:\/\//i.test(collapsed)) return fallback;
  if (collapsed.length <= MAX_LABEL_CHARS) return collapsed;
  return `${collapsed.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}…`;
}

function sanitizeExtractedThreadHotLinks(
  generated: ReadonlyArray<{ readonly url: string; readonly label: string }>,
  candidateUrls: ReadonlyArray<string>,
): ThreadHotLink[] {
  const allowed = new Map<string, string>();
  for (const candidate of candidateUrls) {
    allowed.set(candidate, candidate);
    allowed.set(cleanCandidateUrlToken(candidate), candidate);
  }
  const seen = new Set<string>();
  const links: ThreadHotLink[] = [];
  for (const item of generated) {
    const canonical =
      allowed.get(item.url.trim()) ?? allowed.get(cleanCandidateUrlToken(item.url.trim()));
    if (!canonical || seen.has(canonical) || !URL.canParse(canonical)) continue;
    seen.add(canonical);
    const parsed = new URL(canonical);
    const kind = classifyThreadHotLinkKind(parsed);
    const fallback = defaultThreadHotLinkLabel(parsed, kind);
    const label = sanitizeHotLinkLabel(item.label, fallback);
    links.push({ url: canonical, label, kind });
    if (links.length >= MAX_HOT_LINKS) break;
  }
  return links;
}

const PRIORITY_FALLBACK_KINDS = new Set<ThreadHotLinkKind>([
  "plain",
  "slack",
  "linear",
  "notion",
  "datadog",
  "github",
]);

function buildFallbackThreadHotLinks(candidateUrls: ReadonlyArray<string>): ThreadHotLink[] {
  const parsed = candidateUrls.flatMap((url) => {
    if (!URL.canParse(url)) return [];
    const parsedUrl = new URL(url);
    const kind = classifyThreadHotLinkKind(parsedUrl);
    return [{ url, kind, label: defaultThreadHotLinkLabel(parsedUrl, kind) }];
  });
  const prioritized = parsed.filter((entry) => PRIORITY_FALLBACK_KINDS.has(entry.kind));
  if (prioritized.length > 0) return prioritized.slice(0, MAX_HOT_LINKS);
  return candidateUrls.length <= 2 ? parsed.slice(0, 2) : [];
}

function isUserSentHotLinkMessage(
  message: Pick<
    OrchestrationV2ConversationMessage,
    | "role"
    | "createdBy"
    | "streaming"
    | "text"
    | "attachments"
    | "notification"
    | "delegatedCompletion"
    | "idleCompaction"
  >,
): boolean {
  return (
    message.role === "user" &&
    message.createdBy === "user" &&
    !message.streaming &&
    message.notification === undefined &&
    message.delegatedCompletion === undefined &&
    message.idleCompaction === undefined &&
    !isCompactionCommandMessage(message) &&
    !isAttachmentOnlyBootstrapPrompt(message.text) &&
    message.text.trim().length > 0
  );
}

function formatUserMessagesForHotLinks(texts: ReadonlyArray<string>): string {
  if (texts.length === 0) return "";
  const formatted = texts
    .map((raw, index) => {
      const cleaned = stripAssistantQuotedText(raw).trim();
      if (!cleaned) return null;
      return `[Message ${index + 1}]\n${limitTitleMessage(cleaned, MAX_MESSAGE_BUDGET)}`;
    })
    .filter((entry): entry is string => entry !== null);
  if (formatted.length === 0) return "";
  const joined = formatted.join("\n\n");
  return limitTitleMessage(joined, MAX_TOTAL_MESSAGE_CHARS);
}

async function computeHotLinksFingerprint(
  candidateUrls: ReadonlyArray<string>,
  userMessages: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, candidateUrls, userMessages }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class ThreadHotLinksService extends Context.Service<
  ThreadHotLinksService,
  {
    readonly getThreadHotLinks: (
      input: OrchestrationV2GetThreadHotLinksInput,
    ) => Effect.Effect<OrchestrationV2ThreadHotLinks, OrchestrationV2GetShellSnapshotError>;
  }
>()("t3/orchestration-v2/ThreadHotLinksService") {}

const EMPTY_HOT_LINKS: OrchestrationV2ThreadHotLinks = { links: [] };

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;

  yield* sql`
    CREATE TABLE IF NOT EXISTS fork_thread_hot_links (
      thread_id TEXT NOT NULL PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      links_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) WITHOUT ROWID
  `.pipe(Effect.orDie);

  const inFlight = new Map<
    string,
    Deferred.Deferred<OrchestrationV2ThreadHotLinks, OrchestrationV2GetShellSnapshotError>
  >();

  const userMessagesThroughRun = Effect.fn("ThreadHotLinksService.userMessagesThroughRun")(
    function* (threadId: ThreadId, runId: RunId) {
      const source = yield* threads.getThreadRecords(threadId, ["messages", "runs"], {
        messageRoles: ["user"],
      });
      const ordinals = new Map(
        source.runs
          .filter((run) => run.status !== "rolled_back")
          .map((run) => [run.id, run.ordinal]),
      );
      const forkOrdinal = ordinals.get(runId) ?? -1;
      const messages = source.messages.filter((message) => {
        if (!isUserSentHotLinkMessage(message)) return false;
        if (message.runId === null) return source.thread.historyOrigin === "v1_import";
        return (ordinals.get(message.runId) ?? Infinity) <= forkOrdinal;
      });
      return { thread: source.thread, messages };
    },
  );

  const collectThreadUserTexts = Effect.fn("ThreadHotLinksService.collectThreadUserTexts")(
    function* (threadId: ThreadId) {
      const projection = yield* threads.getThreadRecords(threadId, ["messages", "runs"], {
        messageRoles: ["user"],
      });
      if (projection.thread.deletedAt !== null) {
        return { thread: projection.thread, texts: [] as string[] };
      }
      const activeRunIds = new Set(
        projection.runs.filter((run) => run.status !== "rolled_back").map((run) => run.id),
      );
      const localMessages = projection.messages.filter(
        (message) =>
          isUserSentHotLinkMessage(message) &&
          (message.runId === null
            ? projection.thread.historyOrigin === "v1_import"
            : activeRunIds.has(message.runId)),
      );

      const ancestorBatches: Array<ReadonlyArray<OrchestrationV2ConversationMessage>> = [];
      const visitedThreads = new Set<ThreadId>([threadId]);
      let forkedFrom = projection.thread.forkedFrom;
      while (forkedFrom?.type === "run" && !visitedThreads.has(forkedFrom.threadId)) {
        visitedThreads.add(forkedFrom.threadId);
        const ancestor = yield* userMessagesThroughRun(forkedFrom.threadId, forkedFrom.runId).pipe(
          Effect.orElseSucceed(() => null),
        );
        if (ancestor === null) break;
        ancestorBatches.push(ancestor.messages);
        forkedFrom = ancestor.thread.forkedFrom;
      }

      const allMessages = [...ancestorBatches.reverse().flat(), ...localMessages];
      return {
        thread: projection.thread,
        texts: allMessages.map((message) => message.text),
      };
    },
  );

  const computeAndPersist = Effect.fn("ThreadHotLinksService.computeAndPersist")(function* (input: {
    readonly threadId: ThreadId;
    readonly fingerprint: string;
    readonly candidateUrls: ReadonlyArray<string>;
    readonly userMessages: string;
    readonly refresh: boolean;
  }) {
    if (!input.refresh) {
      const cachedRows = yield* sql<{ readonly links_json: string }>`
        SELECT links_json
        FROM fork_thread_hot_links
        WHERE thread_id = ${input.threadId} AND fingerprint = ${input.fingerprint}
      `;
      const cached = cachedRows[0];
      if (cached !== undefined) {
        const decoded = decodeStoredHotLinks(cached.links_json);
        if (Option.isSome(decoded)) {
          return { links: decoded.value } satisfies OrchestrationV2ThreadHotLinks;
        }
      }
    }

    const { thread } = yield* threads.getThreadRecords(input.threadId, []);
    const project = yield* projects.get(thread.projectId);
    if (Option.isNone(project)) {
      return { links: buildFallbackThreadHotLinks(input.candidateUrls) };
    }
    const settings = resolveProjectSettings(
      yield* serverSettings.getSettings,
      thread.projectId,
    ).settings;
    const worktreePath = thread.worktreePath;
    const worktreeExists =
      worktreePath !== null &&
      (yield* fileSystem.exists(worktreePath).pipe(Effect.orElseSucceed(() => false)));

    const generated = yield* (
      textGeneration.generateThreadHotLinks
        ? textGeneration.generateThreadHotLinks({
            cwd: worktreeExists ? worktreePath : project.value.workspaceRoot,
            userMessages: input.userMessages,
            candidateUrls: input.candidateUrls,
            modelSelection: settings.textGenerationModelSelection,
            projectId: thread.projectId,
          })
        : Effect.die("generateThreadHotLinks unavailable")
    ).pipe(
      Effect.map((result) => ({
        fromModel: true as const,
        links: sanitizeExtractedThreadHotLinks(result.links, input.candidateUrls),
      })),
      Effect.catchCause((cause) =>
        Effect.logWarning("Thread hot link extraction fell back to deterministic URL matching", {
          threadId: input.threadId,
          cause,
        }).pipe(
          Effect.as({
            fromModel: false as const,
            links: buildFallbackThreadHotLinks(input.candidateUrls),
          }),
        ),
      ),
    );

    if (generated.fromModel) {
      const nowIso = DateTime.formatIso(yield* DateTime.now);
      const linksJson = encodeStoredHotLinks(generated.links);
      yield* sql`
        INSERT INTO fork_thread_hot_links (thread_id, fingerprint, links_json, updated_at)
        VALUES (${input.threadId}, ${input.fingerprint}, ${linksJson}, ${nowIso})
        ON CONFLICT (thread_id) DO UPDATE SET
          fingerprint = excluded.fingerprint,
          links_json = excluded.links_json,
          updated_at = excluded.updated_at
      `;
    }

    return { links: generated.links } satisfies OrchestrationV2ThreadHotLinks;
  });

  const getThreadHotLinks: ThreadHotLinksService["Service"]["getThreadHotLinks"] = Effect.fn(
    "ThreadHotLinksService.getThreadHotLinks",
  )(function* (input) {
    const { texts } = yield* collectThreadUserTexts(input.threadId).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationV2GetShellSnapshotError({
            message: "Failed to load thread hot links",
            cause,
          }),
      ),
    );
    const candidateUrls = extractCandidateHotLinkUrls(texts);
    if (candidateUrls.length === 0) {
      return EMPTY_HOT_LINKS;
    }
    const userMessages = formatUserMessagesForHotLinks(texts);
    if (!userMessages) {
      return EMPTY_HOT_LINKS;
    }
    const fingerprint = yield* Effect.promise(() =>
      computeHotLinksFingerprint(candidateUrls, userMessages),
    );
    const dedupeKey = `${input.threadId}:${fingerprint}:${input.refresh === true ? "refresh" : "cache"}`;
    const existing = inFlight.get(dedupeKey);
    if (existing !== undefined) {
      return yield* Deferred.await(existing);
    }
    const deferred = yield* Deferred.make<
      OrchestrationV2ThreadHotLinks,
      OrchestrationV2GetShellSnapshotError
    >();
    inFlight.set(dedupeKey, deferred);
    return yield* computeAndPersist({
      threadId: input.threadId,
      fingerprint,
      candidateUrls,
      userMessages,
      refresh: input.refresh === true,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationV2GetShellSnapshotError({
            message: "Failed to extract thread hot links",
            cause,
          }),
      ),
      Effect.tap((result) => Deferred.succeed(deferred, result)),
      Effect.tapError((error) => Deferred.fail(deferred, error)),
      Effect.onInterrupt(() => Deferred.interrupt(deferred)),
      Effect.ensuring(Effect.sync(() => void inFlight.delete(dedupeKey))),
    );
  });

  return ThreadHotLinksService.of({ getThreadHotLinks });
});

export const layer = Layer.effect(ThreadHotLinksService, make);
