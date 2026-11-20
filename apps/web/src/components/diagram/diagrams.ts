/* oxlint-disable t3code/no-untranslated-copy -- anthonyyu-modal/t3code's own copy stays English (FORK.md) */
import type {
  DiagramBoard,
  DiagramBoardId,
  DiagramDirectory,
  DiagramEngine,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";

export interface DiagramEngineMeta {
  readonly label: string;
  readonly noun: string;
  readonly pluralNoun: string;
  readonly emptyDescription: string;
  readonly unavailableDescription: string;
  readonly startTestId: string;
  readonly panelTestId: string;
}

export const DIAGRAM_ENGINE_META: Readonly<Record<DiagramEngine, DiagramEngineMeta>> = {
  drawio: {
    label: "draw.io",
    noun: "diagram",
    pluralNoun: "diagrams",
    emptyDescription: "Start a draw.io diagram for multi-color labels, containers, and connectors",
    unavailableDescription:
      "This environment's T3 Code server did not answer for draw.io diagrams. If it is older than this app, update it.",
    startTestId: "drawio-start",
    panelTestId: "drawio-panel",
  },
  drawnix: {
    label: "Drawnix",
    noun: "board",
    pluralNoun: "boards",
    emptyDescription: "Start a Drawnix board for inline rich text, flowcharts, and mind maps",
    unavailableDescription:
      "This environment's T3 Code server did not answer for Drawnix boards. If it is older than this app, update it.",
    startTestId: "drawnix-start",
    panelTestId: "drawnix-panel",
  },
};

export const diagramKey = (
  environmentId: EnvironmentId,
  engine: DiagramEngine,
  boardId: DiagramBoardId,
) => `${environmentId}:${engine}:${boardId}`;

/** The diagram a thread's tab shows for this engine, or `null` until one is opened or created. */
export function diagramShownIn(
  directory: DiagramDirectory,
  threadId: ThreadId,
): DiagramBoard | null {
  const boardId = directory.selected[threadId];
  return directory.boards.find((board) => board.boardId === boardId) ?? null;
}

export const diagramsByName = (directory: DiagramDirectory): ReadonlyArray<DiagramBoard> =>
  directory.boards.toSorted((left, right) => left.name.localeCompare(right.name));
