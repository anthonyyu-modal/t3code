import type {
  DiagramBoardId,
  DiagramEngine,
  EnvironmentId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

import { useDiagramDirectory } from "../../state/diagram";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { DiagramBoardBar } from "./DiagramBoardBar";
import { DiagramStart } from "./DiagramStart";
import { DIAGRAM_ENGINE_META, diagramKey, diagramShownIn } from "./diagrams";

const DrawioPanel = lazy(() => import("./DrawioPanel"));
const DrawnixPanel = lazy(() => import("./DrawnixPanel"));

const MAX_LIVE_DIAGRAMS_PER_ENGINE = 5;

type ElementWithMoveBefore = Element & {
  moveBefore?: (node: Node, child: Node | null) => void;
};

interface LiveDiagram {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly engine: DiagramEngine;
  readonly boardId: DiagramBoardId;
  readonly element: HTMLDivElement;
}

// Both draw.io (iframe) and Drawnix (Plait/Slate) hold undo stacks and camera state inside their
// mounted view. Keeping draw.io elements connected via a hidden parking host plus atomic
// `moveBefore` preserves the iframe context without reloading on tab switches.
const useLiveDiagrams = create<{ readonly diagrams: ReadonlyArray<LiveDiagram> }>(() => ({
  diagrams: [],
}));

let parkingHost: HTMLDivElement | null = null;

function ensureParkingHost(): HTMLDivElement {
  if (parkingHost !== null && parkingHost.isConnected) return parkingHost;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.dataset.diagramParking = "";
  Object.assign(host.style, {
    position: "fixed",
    left: "-10000px",
    top: "-10000px",
    width: "1024px",
    height: "768px",
    visibility: "hidden",
    pointerEvents: "none",
    overflow: "hidden",
  });
  document.body.append(host);
  parkingHost = host;
  return host;
}

function moveElementInto(target: Element, element: HTMLElement): void {
  const parent = target as ElementWithMoveBefore;
  if (typeof parent.moveBefore === "function" && element.isConnected) {
    parent.moveBefore(element, null);
    return;
  }
  target.append(element);
}

function showDiagram(
  environmentId: EnvironmentId,
  engine: DiagramEngine,
  boardId: DiagramBoardId,
): HTMLDivElement {
  const key = diagramKey(environmentId, engine, boardId);
  const { diagrams } = useLiveDiagrams.getState();
  const existing = diagrams.find((candidate) => candidate.key === key);
  const live =
    existing ??
    ({
      key,
      environmentId,
      engine,
      boardId,
      element: Object.assign(document.createElement("div"), {
        className: engine === "drawio" ? "h-full w-full" : "contents",
      }),
    } satisfies LiveDiagram);
  const otherEngines = diagrams.filter((entry) => entry.engine !== engine);
  const sameEngine = [
    ...diagrams.filter((entry) => entry.engine === engine && entry !== live),
    live,
  ];
  const kept = sameEngine.slice(-MAX_LIVE_DIAGRAMS_PER_ENGINE);
  const evicted = sameEngine.slice(0, sameEngine.length - kept.length);
  for (const stale of evicted) stale.element.remove();
  useLiveDiagrams.setState({ diagrams: [...otherEngines, ...kept] });
  return live.element;
}

function DiagramCanvasSlot(props: {
  readonly environmentId: EnvironmentId;
  readonly engine: DiagramEngine;
  readonly boardId: DiagramBoardId;
}) {
  const { environmentId, engine, boardId } = props;
  const slot = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the live diagram DOM into the visible tab slot and parks it when hidden
  useLayoutEffect(() => {
    const element = showDiagram(environmentId, engine, boardId);
    const target = slot.current;
    if (target) moveElementInto(target, element);
    return () => {
      if (engine === "drawio") {
        moveElementInto(ensureParkingHost(), element);
      } else {
        element.remove();
      }
    };
  }, [environmentId, engine, boardId]);

  return <div ref={slot} className="min-h-0 flex-1" />;
}

/** A thread's draw.io or Drawnix right-panel tab. Mounted editors outlive tab switches. */
export function DiagramSlot(props: {
  readonly engine: DiagramEngine;
  readonly threadRef: ScopedThreadRef;
}) {
  const { engine, threadRef } = props;
  const meta = DIAGRAM_ENGINE_META[engine];
  const directory = useDiagramDirectory(threadRef.environmentId, engine);
  if (directory === "loading") return null;
  if (directory === "unavailable") {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{meta.label} unavailable</EmptyTitle>
          <EmptyDescription>{meta.unavailableDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const board = diagramShownIn(directory, threadRef.threadId);
  if (board === null) {
    return <DiagramStart engine={engine} threadRef={threadRef} directory={directory} />;
  }
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <DiagramBoardBar
        key={`${engine}:${board.boardId}`}
        engine={engine}
        threadRef={threadRef}
        directory={directory}
        board={board}
      />
      <DiagramCanvasSlot
        environmentId={threadRef.environmentId}
        engine={engine}
        boardId={board.boardId}
      />
    </div>
  );
}

function LiveDiagramMount({ live }: { readonly live: LiveDiagram }) {
  const { environmentId, engine, boardId } = live;
  const directory = useDiagramDirectory(environmentId, engine);
  const deleted =
    typeof directory !== "string" && !directory.boards.some((board) => board.boardId === boardId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops a parked iframe container from document.body once its board is deleted
  useLayoutEffect(() => {
    if (deleted) live.element.remove();
  }, [deleted, live.element]);
  if (deleted) return null;
  return createPortal(
    <Suspense fallback={null}>
      {engine === "drawio" ? (
        <DrawioPanel environmentId={environmentId} boardId={boardId} />
      ) : (
        <DrawnixPanel environmentId={environmentId} boardId={boardId} />
      )}
    </Suspense>,
    live.element,
  );
}

/** Mounts every live draw.io and Drawnix board so tab switches preserve undo history and zoom. */
export function LiveDiagrams() {
  const diagrams = useLiveDiagrams((state) => state.diagrams);
  return diagrams.map((live) => <LiveDiagramMount key={live.key} live={live} />);
}
