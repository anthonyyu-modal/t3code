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
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

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
      {...searchableSetting("test-notification")}
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
