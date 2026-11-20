/* oxlint-disable t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */
import type { DiagramDirectory, DiagramEngine, ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import { diagramEnvironment } from "../../state/diagram";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { DIAGRAM_ENGINE_META, diagramsByName } from "./diagrams";

/**
 * Empty state for a thread's draw.io or Drawnix tab until it creates or picks a shared document.
 */
export function DiagramStart(props: {
  readonly engine: DiagramEngine;
  readonly threadRef: ScopedThreadRef;
  readonly directory: DiagramDirectory;
}) {
  const { engine, directory } = props;
  const { environmentId, threadId } = props.threadRef;
  const meta = DIAGRAM_ENGINE_META[engine];
  const [starting, setStarting] = useState(false);
  const create = useAtomCommand(diagramEnvironment.create);
  const select = useAtomCommand(diagramEnvironment.select);
  const boards = diagramsByName(directory);

  const startBoard = async () => {
    setStarting(true);
    await create({ environmentId, input: { engine, threadId } });
    setStarting(false);
  };

  return (
    <Empty size="compact" data-testid={meta.startTestId}>
      <EmptyHeader>
        <EmptyTitle>
          No {meta.label} {meta.noun} open in this thread
        </EmptyTitle>
        <EmptyDescription>
          {meta.emptyDescription}
          {boards.length === 0 ? "." : `, or open one you already have.`} Every thread can open
          every {meta.noun}.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button disabled={starting} onClick={() => void startBoard()}>
          New {meta.noun}
        </Button>
        {boards.length === 0 ? null : (
          <ul
            aria-label={`${meta.label} ${meta.pluralNoun}`}
            className="flex max-h-56 w-full flex-col overflow-y-auto"
          >
            {boards.map((board) => (
              <li key={board.boardId} className="flex min-w-0 justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void select({
                      environmentId,
                      input: { engine, threadId, boardId: board.boardId },
                    })
                  }
                >
                  <span className="truncate">{board.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </EmptyContent>
    </Empty>
  );
}
