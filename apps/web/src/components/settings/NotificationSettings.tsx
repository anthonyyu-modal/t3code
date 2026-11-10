import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useGT, useMessages } from "gt-react";
import { useState } from "react";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  sendTestNotification,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { forkSetting } from "./forkSetting";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Asks for notification permission; returns why it was not granted, or `null` once it is. */
async function requestDesktopNotificationPermission(
  setRequesting: (requesting: boolean) => void,
): Promise<string | null> {
  if (typeof Notification === "undefined" || !window.isSecureContext) {
    // oxlint-disable-next-line t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md)
    return "Notifications need a supported browser over HTTPS, or the desktop app.";
  }
  if (Notification.permission === "granted") return null;
  const retry = "Allow notifications in your browser or system settings, then try again.";
  if (Notification.permission === "denied") return retry;
  setRequesting(true);
  const permission = await settlePromise(() => Notification.requestPermission());
  setRequesting(false);
  // oxlint-disable-next-line t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md)
  if (permission._tag === "Failure") return "Notifications are unavailable in this browser.";
  return permission.value === "granted" ? null : retry;
}

export function NotificationSettings() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        gt(
          "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open.",
        )
      }
      control={
        <Select
          value={mode}
          disabled={requesting}
          onValueChange={async (value) => {
            if (
              value !== "off" &&
              value !== "notifications" &&
              value !== "sound" &&
              value !== "notifications-and-sound"
            )
              return;
            setPermissionMessage(null);
            if (hasNotificationSound(value)) unlockNotificationAudio();
            if (hasDesktopNotifications(value)) {
              if (typeof Notification === "undefined" || !window.isSecureContext) {
                setPermissionMessage(
                  gt(
                    "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                  ),
                );
                return;
              }
              setRequesting(true);
              const permission = await settlePromise(() => Notification.requestPermission());
              setRequesting(false);
              if (permission._tag === "Failure") {
                setPermissionMessage(
                  gt(
                    "Notifications are unavailable in this browser. Sound only is still available.",
                  ),
                );
                return;
              }
              if (permission.value !== "granted") {
                setPermissionMessage(
                  gt(
                    "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                  ),
                );
                return;
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={gt("Thread notifications")}
          >
            <SelectValue>{m(NOTIFICATION_MODE_LABELS[mode])}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {m(label)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

/** Posts a notification on demand; see `sendTestNotification` for why macOS needs it. */
export function TestNotificationSettings() {
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  return (
    <SettingsRow
      {...forkSetting("test-notification")}
      description={
        message ??
        // oxlint-disable-next-line t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md)
        "Check that alerts reach you. macOS lists T3 Code in System Settings → Notifications only after it sends one."
      }
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={sending}
          onClick={async () => {
            setSending(true);
            setMessage(await sendTestNotification());
            setSending(false);
          }}
        >
          {/* oxlint-disable-next-line t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */}
          {"Send test"}
        </Button>
      }
    />
  );
}

export function InAppSystemNotificationSettings() {
  const enabled = useScopedSettings(
    (settings) => settings.inAppNotificationsEnabled && settings.inAppSystemNotificationsEnabled,
  );
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...forkSetting("in-app-system-notifications")}
      description={
        permissionMessage ??
        // oxlint-disable-next-line t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md)
        "Also send a system notification when showing an in-app toast, so you still have one to click after the toast disappears."
      }
      control={
        <Switch
          checked={enabled}
          disabled={requesting}
          // oxlint-disable-next-line t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md)
          aria-label="System notifications for in-app alerts"
          onCheckedChange={async (checked) => {
            setPermissionMessage(null);
            if (!checked) {
              updateSettings({ inAppSystemNotificationsEnabled: false });
              return;
            }
            const denial = await requestDesktopNotificationPermission(setRequesting);
            if (denial !== null) {
              setPermissionMessage(denial);
              return;
            }
            updateSettings({
              inAppNotificationsEnabled: true,
              inAppSystemNotificationsEnabled: true,
            });
          }}
        />
      }
    />
  );
}
