import * as Schema from "effect/Schema";
import { useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { forkSetting } from "./forkSetting";
import { searchableSetting } from "./settingsSearch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";

const DEFAULT_MAX_MESSAGES = 2;
const MIN_MAX_MESSAGES = 1;
const MAX_MAX_MESSAGES = 50;

const QuickThreadMaxMessages = Schema.NullOr(
  Schema.Int.check(Schema.isBetween({ minimum: MIN_MAX_MESSAGES, maximum: MAX_MAX_MESSAGES })),
);

/**
 * The most messages you can have written in an Active thread for the sidebar to file it under
 * Quick; null turns the section off. Kept on this device.
 */
export function useQuickThreadMaxMessages() {
  return useLocalStorage(
    "t3code:sidebar:quick-thread-max-messages",
    DEFAULT_MAX_MESSAGES,
    QuickThreadMaxMessages,
  );
}

export function QuickThreadsSettings() {
  const [maxMessages, setMaxMessages] = useQuickThreadMaxMessages();
  return (
    <>
      <SettingsRow
        {...forkSetting("quick-threads")}
        description="Keep short threads in their own Quick section below Active. A thread moves up to Active once you have written more messages in it than the limit. Applies to this device."
        resetAction={
          maxMessages !== DEFAULT_MAX_MESSAGES ? (
            <SettingResetButton
              label="quick section"
              onClick={() => setMaxMessages(DEFAULT_MAX_MESSAGES)}
            />
          ) : null
        }
        control={
          <Switch
            checked={maxMessages !== null}
            onCheckedChange={(checked) => setMaxMessages(checked ? DEFAULT_MAX_MESSAGES : null)}
            aria-label="Quick section"
          />
        }
      />
      {maxMessages !== null ? (
        <SettingsRow
          title={searchableSetting("quick-thread-max-messages").title}
          description="Threads where you have written this many messages or fewer count as quick."
          control={<MaxMessagesInput value={maxMessages} onCommit={setMaxMessages} />}
        />
      ) : null}
    </>
  );
}

function MaxMessagesInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (maxMessages: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [draftSource, setDraftSource] = useState(value);
  if (draftSource !== value) {
    setDraftSource(value);
    setDraft(String(value));
  }

  return (
    <Input
      size="sm"
      type="number"
      min={MIN_MAX_MESSAGES}
      max={MAX_MAX_MESSAGES}
      className="w-full sm:w-24"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = Number(event.target.value);
        if (Number.isInteger(parsed) && parsed >= MIN_MAX_MESSAGES && parsed <= MAX_MAX_MESSAGES) {
          onCommit(parsed);
        }
      }}
      onBlur={() => setDraft(String(value))}
      aria-label="Messages in a quick thread"
    />
  );
}
