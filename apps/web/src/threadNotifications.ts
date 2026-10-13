import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";

import completionUrl from "./assets/notification-completion.mp3";
import inputUrl from "./assets/notification-input.mp3";

type NotificationMode = ClientSettings["notificationMode"];
export const NOTIFICATION_MODE_LABELS = {
  off: "Off",
  notifications: "Notifications only",
  sound: "Sound only",
  "notifications-and-sound": "Notifications with sound",
} satisfies Record<NotificationMode, string>;

export function hasNotificationSound(mode: NotificationMode) {
  return mode === "sound" || mode === "notifications-and-sound";
}

export function hasDesktopNotifications(mode: NotificationMode) {
  return mode === "notifications" || mode === "notifications-and-sound";
}

const TAG_HASH_OFFSET_BASIS = 0xcbf29ce484222325n;
const TAG_HASH_PRIME = 0x100000001b3n;
const TAG_HASH_MASK = 0xffffffffffffffffn;

/** Windows drops toast notifications with the 73-character environment/thread tag. */
export function threadNotificationTag(environmentId: EnvironmentId, threadId: ThreadId): string {
  const key = `${environmentId}:${threadId}`;
  let hash = TAG_HASH_OFFSET_BASIS;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= BigInt(key.charCodeAt(index));
    hash = (hash * TAG_HASH_PRIME) & TAG_HASH_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

const TEST_NOTIFICATION_SHOW_TIMEOUT_MS = 5000;

/**
 * Posts a notification on demand. macOS lists an app in System Settings →
 * Notifications only after it posts one, so this is how a fresh install becomes
 * something the user can allow there. Resolves to a status line for Settings.
 */
export async function sendTestNotification(): Promise<string> {
  if (typeof Notification === "undefined" || !window.isSecureContext) {
    return "Notifications need a supported browser over HTTPS, or the desktop app.";
  }
  let shown: boolean;
  try {
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== "granted") {
      return "Notifications are blocked. Allow them in your browser or system settings, then send another test.";
    }
    const notification = new Notification("Test notification", {
      body: "Thread alerts from T3 Code look like this.",
      tag: "test-notification",
      silent: true,
    });
    notification.addEventListener("click", () => {
      notification.close();
      window.focus();
    });
    // Electron reports only success: when macOS refuses a notification the page
    // gets no error event, so a missing `show` is the failure signal.
    shown = await new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => resolve(false), TEST_NOTIFICATION_SHOW_TIMEOUT_MS);
      const settle = (value: boolean) => () => {
        window.clearTimeout(timeout);
        resolve(value);
      };
      notification.addEventListener("show", settle(true), { once: true });
      notification.addEventListener("error", settle(false), { once: true });
    });
  } catch {
    return "Notifications are unavailable in this browser.";
  }
  const mac = window.desktopBridge?.getClientPlatform?.() === "darwin";
  if (shown) {
    return mac
      ? "Test notification sent. If no banner appeared, choose an alert style for T3 Code in System Settings → Notifications."
      : "Test notification sent.";
  }
  return mac
    ? "macOS did not show the test notification. Allow T3 Code in System Settings → Notifications. If T3 Code is not listed there, this build's code signature is incomplete."
    : "The test notification was not shown. Check your browser and system notification settings.";
}

let originalFavicon: HTMLLinkElement | undefined;
let badgeFavicon: HTMLLinkElement | undefined;

export function setNotificationBadge(count: number) {
  const bridge = window.desktopBridge;
  let image: string | null = null;
  if (count > 0 && (!bridge || bridge.getClientPlatform() === "win32")) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#e5484d";
      context.beginPath();
      context.arc(32, 32, 28, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "white";
      context.font = `600 ${count > 9 ? 30 : 40}px "Segoe UI", sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(count > 9 ? "9+" : String(count), 32, 34);
      image = canvas.toDataURL("image/png");
    }
  }
  if (!bridge) {
    if (image) {
      if (!badgeFavicon) {
        originalFavicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? undefined;
        badgeFavicon = document.createElement("link");
        badgeFavicon.rel = "icon";
        badgeFavicon.type = "image/png";
        badgeFavicon.sizes.value = "64x64";
        originalFavicon?.remove();
        document.head.append(badgeFavicon);
      }
      badgeFavicon.href = image;
    } else if (badgeFavicon) {
      badgeFavicon.remove();
      badgeFavicon = undefined;
      if (originalFavicon) document.head.append(originalFavicon);
      originalFavicon = undefined;
    }
  }
  void bridge?.setNotificationBadge({ count, image }).catch(() => undefined);
}

let audioContext: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();
/** When each sound's current playback ends, on the audio context's clock. */
const playingUntil = new Map<string, number>();

/** Called from a gesture so browsers allow later background playback. */
export function unlockNotificationAudio() {
  audioContext ??= new AudioContext();
  void audioContext.resume().catch(() => undefined);
}

export async function playNotificationSound(
  kind: "completion" | "input",
  shouldPlay: () => boolean,
) {
  if (!audioContext || audioContext.state !== "running") return;
  const context = audioContext;
  const url = kind === "completion" ? completionUrl : inputUrl;
  try {
    let buffer = buffers.get(url);
    if (!buffer) {
      buffer = fetch(url)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data));
      buffers.set(url, buffer);
    }
    const decoded = await buffer;
    if (!shouldPlay() || context.state !== "running") return;
    // Coalesce same-sound bursts after decode to avoid clipping; input and completion alerts keep separate slots.
    if (context.currentTime < (playingUntil.get(url) ?? 0)) return;
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    source.start();
    playingUntil.set(url, context.currentTime + decoded.duration);
  } catch {
    buffers.delete(url);
  }
}
