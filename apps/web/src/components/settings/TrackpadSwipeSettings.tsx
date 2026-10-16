import * as Schema from "effect/Schema";

import { isElectron } from "~/env";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { isMacPlatform } from "~/lib/utils";
import { Switch } from "../ui/switch";
import { forkSetting } from "./forkSetting";
import { SettingsRow } from "./settingsLayout";

/** Whether a two-finger trackpad swipe goes back and forward in the macOS desktop app. Kept on this device. */
export function useTrackpadSwipeEnabled() {
  return useLocalStorage("t3code:trackpad-swipe-navigation-enabled", true, Schema.Boolean);
}

export function TrackpadSwipeSettings() {
  const [enabled, setEnabled] = useTrackpadSwipeEnabled();
  if (!isElectron || !isMacPlatform(navigator.platform)) return null;

  return (
    <SettingsRow
      {...forkSetting("trackpad-swipe-navigation")}
      description="Swipe left or right with two fingers to go back and forward, like ⌘[ and ⌘]. Applies to this device."
      control={
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="Swipe to go back and forward"
        />
      }
    />
  );
}
