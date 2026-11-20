/* oxlint-disable t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */
import {
  DIAGRAM_NAME_MAX_LENGTH,
  type DiagramBoard,
  type DiagramDirectory,
  type DiagramEngine,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ChevronDownIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { diagramEnvironment } from "../../state/diagram";
import { useAtomCommand } from "../../state/use-atom-command";
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
import { DIAGRAM_ENGINE_META, diagramsByName } from "./diagrams";

const NAMING_LABEL = { new: "Create", copy: "Duplicate", rename: "Rename" } as const;

/**
 * Names the active draw.io or Drawnix document for a thread's tab, and switches, duplicates,
 * renames, or deletes shared documents for that engine.
 */
export function DiagramBoardBar(props: {
  readonly engine: DiagramEngine;
  readonly threadRef: ScopedThreadRef;
  readonly directory: DiagramDirectory;
  readonly board: DiagramBoard;
}) {
  const { engine, directory, board } = props;
  const { environmentId, threadId } = props.threadRef;
  const meta = DIAGRAM_ENGINE_META[engine];
  const [naming, setNaming] = useState<keyof typeof NAMING_LABEL | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const create = useAtomCommand(diagramEnvironment.create);
  const rename = useAtomCommand(diagramEnvironment.rename);
  const remove = useAtomCommand(diagramEnvironment.remove);
  const select = useAtomCommand(diagramEnvironment.select);

  const stopNaming = () => {
    setNaming(null);
    setRefused(null);
  };

  const submitName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (naming === null) return;
    const entered = new FormData(event.currentTarget).get("name");
    const nextName = typeof entered === "string" ? entered.trim() : "";
    if (nextName === "") return;
    const result =
      naming === "rename"
        ? await rename({
            environmentId,
            input: { engine, boardId: board.boardId, name: nextName },
          })
        : await create({
            environmentId,
            input: {
              engine,
              name: nextName,
              threadId,
              ...(naming === "copy" ? { copyOf: board.boardId } : {}),
            },
          });
    if (result._tag === "Success") return stopNaming();
    const error = squashAtomCommandFailure(result);
    setRefused(error instanceof Error ? error.message : "That name could not be used.");
  };

  const deleteBoard = async () => {
    const confirmed = await requestConfirmDialog(
      `Delete the ${meta.label} ${meta.noun} "${board.name}"? It is removed for every thread.`,
      { variant: "destructive" },
    );
    if (confirmed === true) {
      await remove({ environmentId, input: { engine, boardId: board.boardId } });
    }
  };

  if (naming !== null) {
    const placeholder = `${meta.label} ${meta.noun} name`;
    return (
      <form className={FILE_SURFACE_SUBHEADER_CLASS} data-surface-subheader onSubmit={submitName}>
        <div className="min-w-0 max-w-64 flex-1">
          <Input
            name="name"
            size="compact"
            autoFocus
            required
            maxLength={DIAGRAM_NAME_MAX_LENGTH}
            defaultValue={naming === "rename" ? board.name : ""}
            placeholder={placeholder}
            aria-label={placeholder}
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
          aria-label={`${meta.label}: ${board.name}`}
        >
          <span className="truncate">{board.name}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={board.boardId}
            onValueChange={(boardId) =>
              void select({ environmentId, input: { engine, threadId, boardId } })
            }
          >
            {diagramsByName(directory).map((candidate) => (
              <DropdownMenuRadioItem key={candidate.boardId} value={candidate.boardId} closeOnClick>
                <span className="truncate">{candidate.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNaming("new")}>New {meta.noun}…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNaming("copy")}>
            Duplicate this {meta.noun}…
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
