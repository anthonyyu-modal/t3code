/* oxlint-disable t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */
import type { ScopedThreadRef, WhiteboardDirectory } from "@t3tools/contracts";
import { useState } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { whiteboardEnvironment } from "../../state/whiteboard";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { boardsByName } from "./boards";

/**
 * A thread's Whiteboard tab until the thread has a board: starts one, named after the thread, or
 * opens one of the server's.
 */
export function WhiteboardStart(props: {
  readonly threadRef: ScopedThreadRef;
  readonly directory: WhiteboardDirectory;
}) {
  const { environmentId, threadId } = props.threadRef;
  const [starting, setStarting] = useState(false);
  const create = useAtomCommand(whiteboardEnvironment.create);
  const select = useAtomCommand(whiteboardEnvironment.select);
  const boards = boardsByName(props.directory);

  const startBoard = async () => {
    setStarting(true);
    await create({ environmentId, input: { threadId } });
    setStarting(false);
  };

  return (
    <Empty size="compact" data-testid="whiteboard-start">
      <EmptyHeader>
        <EmptyTitle>No board open in this thread</EmptyTitle>
        <EmptyDescription>
          Start a board to draw on with the agent
          {boards.length === 0 ? "." : ", or open one you already have."} Every thread can open
          every board.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button disabled={starting} onClick={() => void startBoard()}>
          New board
        </Button>
        {boards.length === 0 ? null : (
          <ul aria-label="Boards" className="flex max-h-56 w-full flex-col overflow-y-auto">
            {boards.map((board) => (
              <li key={board.boardId} className="flex min-w-0 justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void select({ environmentId, input: { threadId, boardId: board.boardId } })
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
