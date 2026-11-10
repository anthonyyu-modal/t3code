import { settlePromise } from "@t3tools/client-runtime/state/runtime";
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
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

async function requestDesktopNotificationPermission(
  setRequesting: (requesting: boolean) => void,
  options?: { readonly soundFallback?: boolean },
): Promise<string | null> {
  const suffix = options?.soundFallback ? " Sound only is still available." : "";
  if (typeof Notification === "undefined" || !window.isSecureContext) {
    return `Notifications need a supported browser over HTTPS, or the desktop app.${suffix}`;
  }
  if (Notification.permission === "granted") {
    return null;
  }
  if (Notification.permission === "denied") {
    return options?.soundFallback
      ? `Allow notifications in your browser or system settings, then choose this option again.${suffix}`
      : "Allow notifications in your browser or system settings, then try again.";
  }
  setRequesting(true);
  const permission = await settlePromise(() => Notification.requestPermission());
  setRequesting(false);
  if (permission._tag === "Failure") {
    return `Notifications are unavailable in this browser.${suffix}`;
  }
  if (permission.value !== "granted") {
    return options?.soundFallback
      ? `Allow notifications in your browser or system settings, then choose this option again.${suffix}`
      : "Allow notifications in your browser or system settings, then try again.";
  }
  return null;
}

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open."
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
              const denial = await requestDesktopNotificationPermission(setRequesting, {
                soundFallback: true,
              });
              if (denial !== null) {
                setPermissionMessage(denial);
                return;
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thread notifications">
            <SelectValue>{NOTIFICATION_MODE_LABELS[mode]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {label}
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
          Send test
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
        "Also send a system notification when showing an in-app toast, so you still have one to click after the toast disappears."
      }
      control={
        <Switch
          checked={enabled}
          disabled={requesting}
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
