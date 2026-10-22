import * as Schema from "effect/Schema";

import { useLocalStorage } from "~/hooks/useLocalStorage";

export const QUICK_THREAD_MAX_MESSAGES_KEY = "t3code:sidebar:quick-thread-max-messages";
export const DEFAULT_QUICK_THREAD_MAX_MESSAGES = 2;
export const MIN_QUICK_THREAD_MAX_MESSAGES = 1;
export const MAX_QUICK_THREAD_MAX_MESSAGES = 50;

/**
 * Saved as "off" rather than null: the local storage hook deletes an entry written as null, and a
 * missing entry reads back as the default, which would turn the section straight back on.
 */
export const StoredQuickThreadMaxMessages = Schema.Union([
  Schema.Literal("off"),
  Schema.Int.check(
    Schema.isBetween({
      minimum: MIN_QUICK_THREAD_MAX_MESSAGES,
      maximum: MAX_QUICK_THREAD_MAX_MESSAGES,
    }),
  ),
]);
export type StoredQuickThreadMaxMessages = typeof StoredQuickThreadMaxMessages.Type;

export const quickThreadMaxMessagesFromStored = (
  stored: StoredQuickThreadMaxMessages,
): number | null => (stored === "off" ? null : stored);

export const quickThreadMaxMessagesToStored = (
  maxMessages: number | null,
): StoredQuickThreadMaxMessages => maxMessages ?? "off";

/**
 * The most messages you can have written in an Active thread for the sidebar to file it under
 * Quick; null turns the section off. Kept on this device.
 */
export function useQuickThreadMaxMessages(): [number | null, (maxMessages: number | null) => void] {
  const [stored, setStored] = useLocalStorage(
    QUICK_THREAD_MAX_MESSAGES_KEY,
    DEFAULT_QUICK_THREAD_MAX_MESSAGES,
    StoredQuickThreadMaxMessages,
  );
  return [
    quickThreadMaxMessagesFromStored(stored),
    (maxMessages) => setStored(quickThreadMaxMessagesToStored(maxMessages)),
  ];
}
