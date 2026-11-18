/* oxlint-disable t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */
import {
  WHITEBOARD_NAME_MAX_LENGTH,
  type ScopedThreadRef,
  type Whiteboard,
  type WhiteboardDirectory,
} from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { requestConfirmDialog } from "../../confirmDialog";
import { useAtomCommand } from "../../state/use-atom-command";
import { whiteboardEnvironment } from "../../state/whiteboard";
import { FILE_SURFACE_SUBHEADER_CLASS } from "../files/fileSurfaceChrome";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/menu";
import { boardsByName } from "./boards";

const NAMING_LABEL = { new: "Create", copy: "Duplicate", rename: "Rename" } as const;

/**
 * Names the board a thread's Whiteboard tab shows, and switches the tab to any other board on the
 * server or to a new one.
 */
export function WhiteboardBoardBar(props: {
  readonly threadRef: ScopedThreadRef;
  readonly directory: WhiteboardDirectory;
  readonly board: Whiteboard;
}) {
  const { directory, board } = props;
  const { environmentId, threadId } = props.threadRef;
  const [naming, setNaming] = useState<keyof typeof NAMING_LABEL | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const create = useAtomCommand(whiteboardEnvironment.create);
  const rename = useAtomCommand(whiteboardEnvironment.rename);
  const remove = useAtomCommand(whiteboardEnvironment.remove);
  const select = useAtomCommand(whiteboardEnvironment.select);

  const submitName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (naming === null) return;
    const entered = new FormData(event.currentTarget).get("name");
    const nextName = typeof entered === "string" ? entered.trim() : "";
    if (nextName === "") return;
    const result =
      naming === "rename"
        ? await rename({ environmentId, input: { boardId: board.boardId, name: nextName } })
        : await create({
            environmentId,
            input: {
              name: nextName,
              threadId,
              ...(naming === "copy" ? { copyOf: board.boardId } : {}),
            },
          });
    if (result._tag === "Success") return stopNaming();
    // A refused name stays in the field to be changed.
    const error = squashAtomCommandFailure(result);
    setRefused(error instanceof Error ? error.message : "That name could not be used.");
  };

  const stopNaming = () => {
    setNaming(null);
    setRefused(null);
  };

  const deleteBoard = async () => {
    const confirmed = await requestConfirmDialog(
      `Delete the board "${board.name}"? Its drawing is removed for every thread.`,
      { variant: "destructive" },
    );
    if (confirmed === true) await remove({ environmentId, input: { boardId: board.boardId } });
  };

  if (naming !== null) {
    return (
      <form className={FILE_SURFACE_SUBHEADER_CLASS} data-surface-subheader onSubmit={submitName}>
        <div className="min-w-0 max-w-64 flex-1">
          <Input
            name="name"
            size="compact"
            autoFocus
            required
            maxLength={WHITEBOARD_NAME_MAX_LENGTH}
            defaultValue={naming === "rename" ? board.name : ""}
            placeholder="Board name"
            aria-label="Board name"
            onChange={() => setRefused(null)}
            onKeyDown={(event) => {
              if (event.key === "Escape") stopNaming();
            }}
          />
        </div>
        <Button type="submit" size="xs">
          {NAMING_LABEL[naming]}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={stopNaming}>
          Cancel
        </Button>
        {refused === null ? null : (
          <span role="alert" className="truncate text-xs text-destructive">
            {refused}
          </span>
        )}
      </form>
    );
  }

  return (
    <div className={FILE_SURFACE_SUBHEADER_CLASS} data-surface-subheader>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="xs" variant="secondary" />}
          className="max-w-full min-w-0"
          aria-label={`Board: ${board.name}`}
        >
          <span className="truncate">{board.name}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={board.boardId}
            onValueChange={(boardId) =>
              void select({ environmentId, input: { threadId, boardId } })
            }
          >
            {boardsByName(directory).map((candidate) => (
              <DropdownMenuRadioItem key={candidate.boardId} value={candidate.boardId} closeOnClick>
                <span className="truncate">{candidate.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNaming("new")}>New board…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNaming("copy")}>
            Duplicate this board…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNaming("rename")}>Rename…</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => void deleteBoard()}>
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
