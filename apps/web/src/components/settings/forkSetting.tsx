/* oxlint-disable t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */
import { Badge } from "../ui/badge";
import {
  SETTINGS_SEARCH_ITEMS,
  type SettingsSearchItem,
  type SettingsSearchItemId,
} from "./settingsSearch";

const SEARCH_ITEMS: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS;

/**
 * The search anchor and title for a settings row that anthonyyu-modal/t3code adds on top of
 * upstream T3 Code, with a Fork badge beside the title. Fork rows are not translated, so unlike
 * `useSearchableSetting` this reads the title as written and needs no hook.
 */
export function forkSetting(id: SettingsSearchItemId) {
  const item = SEARCH_ITEMS.find((candidate) => candidate.id === id)!;
  return {
    id: item.id,
    title: (
      <span className="inline-flex items-center gap-1.5">
        {item.title}
        <Badge variant="outline" size="sm">
          Fork
        </Badge>
      </span>
    ),
  };
}
