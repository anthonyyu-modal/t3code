import { getLocalStorageItem } from "./hooks/useLocalStorage";
import {
  buildThreadThumbnailPrompt,
  DEFAULT_THREAD_THUMBNAIL_CONFIG,
  readThreadThumbnailJson,
  ThreadThumbnailConfig,
  threadThumbnailRequestInit,
} from "./threadThumbnails.logic";

export const THREAD_THUMBNAIL_CONFIG_KEY = "t3code:thread-thumbnails";

// A new thread's title starts as its first message and is replaced by a
// generated one moments later, so a title is drawn only once it has held still.
const TITLE_SETTLE_MS = 20_000;
// Endpoints that scale to zero can spend a minute or more on a cold start.
const REQUEST_TIMEOUT_MS = 180_000;
// Shown at 48px; twice that stays sharp on Retina displays.
const THUMBNAIL_PIXELS = 96;
const MAX_BACKOFF_MS = 30 * 60_000;

export interface ThreadThumbnail {
  readonly title: string;
  readonly dataUrl: string;
}

export interface ThreadThumbnailStatus {
  readonly lastError: string | null;
  readonly pausedUntil: number;
}

const DATABASE_NAME = "t3code:thread-thumbnails";
const STORE_NAME = "images";
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(STORE_NAME);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () => reject(new Error("Thumbnail cache is blocked.")));
  }));
}

async function withStore<A>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<A> | void,
) {
  const transaction = (await openDatabase()).transaction(STORE_NAME, mode);
  const request = use(transaction.objectStore(STORE_NAME));
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error));
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  return request?.result;
}

const thumbnails = new Map<string, ThreadThumbnail>();
const listeners = new Set<() => void>();
let status: ThreadThumbnailStatus = { lastError: null, pausedUntil: 0 };
let loaded: Promise<void> | undefined;

function notify() {
  for (const listener of listeners) listener();
}

function load() {
  return (loaded ??= (async () => {
    try {
      const [keys, values] = await Promise.all([
        withStore("readonly", (store) => store.getAllKeys()),
        withStore("readonly", (store) => store.getAll()),
      ]);
      keys?.forEach((key, index) => {
        const value: unknown = values?.[index];
        if (
          typeof key === "string" &&
          typeof value === "object" &&
          value !== null &&
          "title" in value &&
          "dataUrl" in value &&
          typeof value.title === "string" &&
          typeof value.dataUrl === "string" &&
          !thumbnails.has(key)
        ) {
          thumbnails.set(key, { title: value.title, dataUrl: value.dataUrl });
        }
      });
    } catch {
      // Without IndexedDB, thumbnails last until reload.
    }
    notify();
  })());
}

export function subscribeThreadThumbnails(listener: () => void) {
  void load();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getThreadThumbnail = (threadKey: string) => thumbnails.get(threadKey);
export const getThreadThumbnailStatus = () => status;

const wanted = new Map<string, string>();
const firstSeen = new Map<string, number>();
const failed = new Set<string>();
let failures = 0;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const attemptKey = (threadKey: string, title: string) => `${threadKey}\n${title}`;

/** Asks for a thumbnail of this title while the caller is mounted. */
export function wantThreadThumbnail(threadKey: string, title: string) {
  const key = attemptKey(threadKey, title);
  if (!firstSeen.has(key)) firstSeen.set(key, Date.now());
  wanted.set(threadKey, title);
  scheduleThreadThumbnails();
  return () => {
    if (wanted.get(threadKey) === title) wanted.delete(threadKey);
  };
}

function scheduleThreadThumbnails(delay = 0) {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void work();
  }, delay);
}

/** Clears the failure backoff, so a fixed endpoint is retried right away. */
export function retryThreadThumbnails() {
  failed.clear();
  failures = 0;
  status = { lastError: null, pausedUntil: 0 };
  notify();
  scheduleThreadThumbnails();
}

export async function clearThreadThumbnails() {
  thumbnails.clear();
  notify();
  try {
    await withStore("readwrite", (store) => store.clear());
  } catch {
    // The in-memory copies are already gone.
  }
  retryThreadThumbnails();
}

function readConfig(): ThreadThumbnailConfig {
  try {
    return (
      getLocalStorageItem(THREAD_THUMBNAIL_CONFIG_KEY, ThreadThumbnailConfig) ??
      DEFAULT_THREAD_THUMBNAIL_CONFIG
    );
  } catch {
    return DEFAULT_THREAD_THUMBNAIL_CONFIG;
  }
}

async function work() {
  if (running) return;
  const config = readConfig();
  if (!config.enabled || config.endpoint.trim() === "") return;
  await load();
  const now = Date.now();
  if (now < status.pausedUntil) return scheduleThreadThumbnails(status.pausedUntil - now);

  let next: readonly [string, string] | undefined;
  let wait = Number.POSITIVE_INFINITY;
  for (const [threadKey, title] of wanted) {
    const key = attemptKey(threadKey, title);
    if (thumbnails.get(threadKey)?.title === title || failed.has(key)) continue;
    const readyIn = (firstSeen.get(key) ?? now) + TITLE_SETTLE_MS - now;
    if (readyIn <= 0) {
      next = [threadKey, title];
      break;
    }
    wait = Math.min(wait, readyIn);
  }
  if (!next) {
    if (Number.isFinite(wait)) scheduleThreadThumbnails(wait);
    return;
  }

  const [threadKey, title] = next;
  running = true;
  try {
    const dataUrl = await generateThreadThumbnailImage(
      config,
      title,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    );
    thumbnails.set(threadKey, { title, dataUrl });
    failures = 0;
    status = { lastError: null, pausedUntil: 0 };
    notify();
    await withStore("readwrite", (store) => store.put({ title, dataUrl }, threadKey)).catch(
      () => undefined,
    );
  } catch (cause) {
    failed.add(attemptKey(threadKey, title));
    failures += 1;
    status = {
      lastError: cause instanceof Error ? cause.message : String(cause),
      pausedUntil: Date.now() + Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** (failures - 1)),
    };
    notify();
  } finally {
    running = false;
    scheduleThreadThumbnails();
  }
}

async function squareThumbnail(image: Blob) {
  const bitmap = await createImageBitmap(image);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = THUMBNAIL_PIXELS;
    canvas.height = THUMBNAIL_PIXELS;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      THUMBNAIL_PIXELS,
      THUMBNAIL_PIXELS,
    );
    return canvas.toDataURL("image/webp", 0.85);
  } finally {
    bitmap.close();
  }
}

/** Draws one thumbnail and returns it as a small WebP data URL. */
export async function generateThreadThumbnailImage(
  config: ThreadThumbnailConfig,
  title: string,
  signal: AbortSignal,
) {
  const prompt = buildThreadThumbnailPrompt(config.prompt, title);
  let response: Response;
  try {
    response = await fetch(
      config.endpoint.trim(),
      threadThumbnailRequestInit(config, prompt, signal),
    );
  } catch (cause) {
    if (signal.aborted) throw new Error("The image endpoint did not answer in time.", { cause });
    // A CORS refusal and an unreachable host look the same from here.
    throw new Error(
      "Could not reach the image endpoint. Check the URL and that it allows cross-origin requests.",
      { cause },
    );
  }
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? `The image endpoint refused the request (${response.status}). Check the API token.`
        : `The image endpoint answered ${response.status}.`,
    );
  }
  if (response.headers.get("content-type")?.startsWith("image/")) {
    return squareThumbnail(await response.blob());
  }
  const source = readThreadThumbnailJson(await response.json().catch(() => null));
  if (!source) throw new Error("The image endpoint's response has no image.");
  const image =
    source.kind === "base64"
      ? new Blob([Uint8Array.from(atob(source.data), (character) => character.charCodeAt(0))])
      : await (await fetch(source.url, { signal })).blob();
  return squareThumbnail(image);
}
