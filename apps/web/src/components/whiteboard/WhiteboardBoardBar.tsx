import {
  WHITEBOARD_NAME_MAX_LENGTH,
  type ScopedThreadRef,
  type SharedWhiteboard,
  type WhiteboardDirectory,
  type WhiteboardRef,
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
import { boardName } from "./boards";

const OWN_BOARD = "thread";

type Naming =
  | { readonly action: "new" | "copy" }
  | { readonly action: "rename"; readonly shared: SharedWhiteboard };

const NAMING_LABEL = { new: "Create", copy: "Copy", rename: "Rename" } as const;

/**
 * Names the board a thread's Whiteboard tab shows and switches it: the thread's own board, or a
 * shared one that every thread on the server can open.
 */
export function WhiteboardBoardBar(props: {
  readonly threadRef: ScopedThreadRef;
  readonly directory: WhiteboardDirectory;
  readonly board: WhiteboardRef;
}) {
  const { directory, board } = props;
  const { environmentId, threadId } = props.threadRef;
  const [naming, setNaming] = useState<Naming | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const create = useAtomCommand(whiteboardEnvironment.create);
  const rename = useAtomCommand(whiteboardEnvironment.rename);
  const remove = useAtomCommand(whiteboardEnvironment.remove);
  const select = useAtomCommand(whiteboardEnvironment.select);

  const name = boardName(directory, board);
  const shared =
    board.kind === "shared"
      ? (directory.boards.find((candidate) => candidate.boardId === board.boardId) ?? null)
      : null;
  const sharedBoards = directory.boards.toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );

  const submitName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (naming === null) return;
    const entered = new FormData(event.currentTarget).get("name");
    const nextName = typeof entered === "string" ? entered.trim() : "";
    if (nextName === "") return;
    const result =
      naming.action === "rename"
        ? await rename({
            environmentId,
            input: { boardId: naming.shared.boardId, name: nextName },
          })
        : await create({
            environmentId,
            input: {
              name: nextName,
              threadId,
              ...(naming.action === "copy" ? { copyOf: board } : {}),
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

  const deleteBoard = async (target: SharedWhiteboard) => {
    const confirmed = await requestConfirmDialog(
      `Delete the shared board "${target.name}"? Its drawing is removed for every thread.`,
      { variant: "destructive" },
    );
    if (confirmed === true) await remove({ environmentId, input: { boardId: target.boardId } });
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
            defaultValue={naming.action === "rename" ? naming.shared.name : ""}
            placeholder="Board name"
            aria-label="Board name"
            onChange={() => setRefused(null)}
            onKeyDown={(event) => {
              if (event.key === "Escape") stopNaming();
            }}
          />
        </div>
        <Button type="submit" size="xs">
          {NAMING_LABEL[naming.action]}
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
          aria-label={`Board: ${name}`}
        >
          <span className="truncate">{name}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={shared?.boardId ?? OWN_BOARD}
            onValueChange={(value) =>
              void select({
                environmentId,
                input: { threadId, boardId: value === OWN_BOARD ? null : value },
              })
            }
          >
            <DropdownMenuRadioItem value={OWN_BOARD} closeOnClick>
              <span>{boardName(directory, { kind: "thread", threadId })}</span>
            </DropdownMenuRadioItem>
            {sharedBoards.map((candidate) => (
              <DropdownMenuRadioItem key={candidate.boardId} value={candidate.boardId} closeOnClick>
                <span className="truncate">{candidate.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNaming({ action: "new" })}>
            New shared board…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNaming({ action: "copy" })}>
            Copy this board to a shared board…
          </DropdownMenuItem>
          {shared === null ? null : (
            <>
              <DropdownMenuItem onClick={() => setNaming({ action: "rename", shared })}>
                Rename…
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => void deleteBoard(shared)}>
                Delete…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="truncate text-xs text-muted-foreground">
        {shared === null ? "Only in this thread" : "Shared with every thread"}
      </span>
    </div>
  );
}
