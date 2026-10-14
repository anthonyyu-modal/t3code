import { Badge } from "../ui/badge";
import { searchableSetting, type SettingsSearchItemId } from "./settingsSearch";

/**
 * searchableSetting for a row that anthonyyu-modal/t3code adds on top of
 * upstream T3 Code: the same anchor, with a Fork badge beside the title.
 */
export function forkSetting(id: SettingsSearchItemId) {
  const setting = searchableSetting(id);
  return {
    ...setting,
    title: (
      <span className="inline-flex items-center gap-1.5">
        {setting.title}
        <Badge variant="outline" size="sm">
          Fork
        </Badge>
      </span>
    ),
  };
}
