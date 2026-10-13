import * as Schema from "effect/Schema";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * Whether the composer offers to compact a stale Claude thread before sending
 * (the Compact chip). Kept on this device, like the per-environment "Don't ask
 * again" answer that also hides the chip.
 */
export function useResumeCompactionEnabled() {
  return useLocalStorage("t3code:resume-compaction-enabled", true, Schema.Boolean);
}

export function ResumeCompactionSettings() {
  const [enabled, setEnabled] = useResumeCompactionEnabled();

  return (
    <SettingsRow
      {...searchableSetting("resume-compaction")}
      description="Compact a Claude thread with 100k+ tokens before sending once its prompt cache has expired. Applies to this device."
      control={
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="Compact stale Claude threads"
        />
      }
    />
  );
}
