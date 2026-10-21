import * as Schema from "effect/Schema";

// Fork: thread thumbnails come from an image model the user hosts. The request
// follows OpenAI's images API so any compatible server (or a small Modal app)
// can answer it.

export const ThreadThumbnailConfig = Schema.Struct({
  enabled: Schema.Boolean,
  endpoint: Schema.String,
  token: Schema.String,
  prompt: Schema.String,
});
export type ThreadThumbnailConfig = typeof ThreadThumbnailConfig.Type;

// Qwen-Image draws quoted words as lettering and its distilled variants ignore
// "no text", so the title stays unquoted and "pictogram" steers away from letters.
export const DEFAULT_THREAD_THUMBNAIL_PROMPT =
  "App icon in a flat, modern vector style, like a macOS dock icon. It depicts {title}, shown as one simple pictogram on a rounded square with a solid color background.";

export const DEFAULT_THREAD_THUMBNAIL_CONFIG: ThreadThumbnailConfig = {
  enabled: false,
  endpoint: "",
  token: "",
  prompt: DEFAULT_THREAD_THUMBNAIL_PROMPT,
};

/** Titles that do not say what a thread is about yet. */
export function isThumbnailableTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length > 0 && trimmed !== "New thread";
}

export function buildThreadThumbnailPrompt(template: string, title: string): string {
  const source = template.trim() || DEFAULT_THREAD_THUMBNAIL_PROMPT;
  const cleanTitle = title.trim().replace(/\s+/gu, " ");
  return source.includes("{title}")
    ? source.replaceAll("{title}", cleanTitle)
    : `${source}\n\nTask: ${cleanTitle}`;
}

export function threadThumbnailRequestInit(
  config: Pick<ThreadThumbnailConfig, "token">,
  prompt: string,
  signal?: AbortSignal,
): RequestInit {
  const token = config.token.trim();
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ prompt, n: 1, size: "512x512", response_format: "b64_json" }),
    ...(signal ? { signal } : {}),
  };
}

export type ThreadThumbnailImageSource =
  | { readonly kind: "base64"; readonly data: string }
  | { readonly kind: "url"; readonly url: string };

/** Reads `{ data: [{ b64_json | url }] }`, the OpenAI images response. */
export function readThreadThumbnailJson(body: unknown): ThreadThumbnailImageSource | null {
  if (typeof body !== "object" || body === null || !("data" in body)) return null;
  const first: unknown = Array.isArray(body.data) ? body.data[0] : undefined;
  if (typeof first !== "object" || first === null) return null;
  if ("b64_json" in first && typeof first.b64_json === "string" && first.b64_json.length > 0) {
    return { kind: "base64", data: first.b64_json };
  }
  if ("url" in first && typeof first.url === "string" && first.url.length > 0) {
    return { kind: "url", url: first.url };
  }
  return null;
}
