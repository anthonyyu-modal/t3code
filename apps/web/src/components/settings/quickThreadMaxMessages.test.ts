import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { readLocalStorageValue, writeLocalStorageValue } from "~/hooks/useLocalStorage";
import {
  DEFAULT_QUICK_THREAD_MAX_MESSAGES,
  QUICK_THREAD_MAX_MESSAGES_KEY,
  StoredQuickThreadMaxMessages,
  quickThreadMaxMessagesFromStored,
  quickThreadMaxMessagesToStored,
} from "./quickThreadMaxMessages";

function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
    dispatchEvent: () => true,
  });
  return store;
}

// The same round trip useQuickThreadMaxMessages makes through local storage.
function save(maxMessages: number | null) {
  writeLocalStorageValue(
    QUICK_THREAD_MAX_MESSAGES_KEY,
    quickThreadMaxMessagesToStored(maxMessages),
    DEFAULT_QUICK_THREAD_MAX_MESSAGES,
    StoredQuickThreadMaxMessages,
  );
}

function load(): number | null {
  return quickThreadMaxMessagesFromStored(
    readLocalStorageValue(
      QUICK_THREAD_MAX_MESSAGES_KEY,
      DEFAULT_QUICK_THREAD_MAX_MESSAGES,
      StoredQuickThreadMaxMessages,
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("quick thread max messages", () => {
  it("is on at the default limit when nothing is saved", () => {
    stubLocalStorage();
    expect(load()).toBe(DEFAULT_QUICK_THREAD_MAX_MESSAGES);
  });

  it("stays off after it is turned off", () => {
    const store = stubLocalStorage();
    save(null);
    expect(store.get(QUICK_THREAD_MAX_MESSAGES_KEY)).toBe('"off"');
    expect(load()).toBeNull();
  });

  it("keeps a custom limit, including one saved before off was stored as a string", () => {
    const store = stubLocalStorage();
    save(5);
    expect(load()).toBe(5);
    store.set(QUICK_THREAD_MAX_MESSAGES_KEY, "7");
    expect(load()).toBe(7);
  });
});
