/* oxlint-disable t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */
import { useGT } from "gt-react";
import { MessagesSquareIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";

export const ComposerSideChatToggle = memo(function ComposerSideChatToggle(props: {
  readonly active: boolean;
  readonly disabledReason: string | null;
  readonly onToggle: () => void;
}) {
  const gt = useGT();
  const disabled = props.disabledReason !== null;
  const button = (
    <ComposerControl
      type="button"
      size="sm"
      data-testid="composer-side-chat-toggle"
      aria-pressed={props.active}
      aria-label="Toggle side chat"
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onClick={props.onToggle}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        "aria-pressed:border-info/30 aria-pressed:bg-info/12 aria-pressed:text-info-foreground aria-pressed:hover:bg-info/18 aria-pressed:hover:text-info-foreground",
        "dark:aria-pressed:bg-info/16 dark:aria-pressed:hover:bg-info/22",
      )}
    >
      <ComposerControlIcon
        icon={MessagesSquareIcon}
        size="sm"
        className={props.active ? "text-current" : undefined}
      />
      <span data-composer-control-label className="@max-[460px]/composer-surface:hidden">
        {gt("Side chat")}
      </span>
    </ComposerControl>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
      <TooltipPopup side="top">
        {props.disabledReason !== null ? (
          props.disabledReason
        ) : (
          <>
            <div>
              {props.active
                ? "Next message opens a side chat."
                : gt("Ask a side question while this thread keeps working.")}
            </div>
            <div className="text-muted-foreground">
              {props.active
                ? "Click to send to this thread instead"
                : "Click to toggle, or use /side or /btw"}
            </div>
          </>
        )}
      </TooltipPopup>
    </Tooltip>
  );
});
