import type { PlaitElement, PlaitTheme, Viewport } from "@plait/core";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { DiagramBoardId, DiagramDocumentEvent, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { randomUUID } from "../../lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { diagramEnvironment } from "../../state/diagram";

const SAVE_DEBOUNCE_MS = 400;
const QUIET = { reportFailure: false } as const;

export interface DrawnixDocument {
  readonly elements: PlaitElement[];
  readonly viewport?: Viewport | undefined;
  readonly theme?: PlaitTheme | undefined;
}

export function parseDrawnixDocument(raw: string): DrawnixDocument {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { elements: [] };
    const record = parsed as Record<string, unknown>;
    const elements = Array.isArray(record.elements) ? (record.elements as PlaitElement[]) : [];
    const viewport =
      record.viewport && typeof record.viewport === "object"
        ? (record.viewport as Viewport)
        : undefined;
    const theme =
      record.theme && typeof record.theme === "object" ? (record.theme as PlaitTheme) : undefined;
    return {
      elements,
      ...(viewport === undefined ? {} : { viewport }),
      ...(theme === undefined ? {} : { theme }),
    };
  } catch {
    return { elements: [] };
  }
}

export function serializeDrawnixDocument(doc: DrawnixDocument): string {
  return JSON.stringify({
    type: "drawnix",
    version: 2,
    source: "t3code",
    elements: doc.elements,
    ...(doc.viewport === undefined ? {} : { viewport: doc.viewport }),
    ...(doc.theme === undefined ? {} : { theme: doc.theme }),
  });
}

export interface DrawnixSession {
  readonly changed: (doc: DrawnixDocument) => void;
  readonly close: () => void;
}

/**
 * Keeps one mounted Drawnix board in step with the server's `.drawnix` file: loads initial state,
 * debounces local edits, and forwards updates from other windows.
 */
export function openDrawnixSession(input: {
  readonly environmentId: EnvironmentId;
  readonly boardId: DiagramBoardId;
  readonly onInitialLoad: (doc: DrawnixDocument) => void;
  readonly onRemoteUpdate: (doc: DrawnixDocument) => void;
  readonly onSaveFailed: (failed: boolean) => void;
}): DrawnixSession {
  const { environmentId, boardId, onInitialLoad, onRemoteUpdate, onSaveFailed } = input;
  const clientId = randomUUID();
  let loaded = false;
  let syncedContent: string | null = null;
  let pendingContent: string | null = null;
  let lastEvent: DiagramDocumentEvent | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;
  let resave = false;
  let closed = false;

  const flush = async () => {
    if (saving) {
      resave = true;
      return;
    }
    const nextContent = pendingContent;
    if (nextContent === null || nextContent === syncedContent) return;
    saving = true;
    const result = await runAtomCommand(
      appAtomRegistry,
      diagramEnvironment.save,
      { environmentId, input: { engine: "drawnix", boardId, clientId, content: nextContent } },
      QUIET,
    );
    saving = false;
    if (result._tag === "Success") {
      syncedContent = nextContent;
      if (pendingContent === nextContent) pendingContent = null;
    }
    if (!closed) onSaveFailed(result._tag !== "Success");
    if (resave) {
      resave = false;
      scheduleSave();
    }
  };

  const scheduleSave = () => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flush();
    }, SAVE_DEBOUNCE_MS);
  };

  const unsubscribe = appAtomRegistry.subscribe(
    diagramEnvironment.events({ environmentId, input: { engine: "drawnix", boardId } }),
    (result) => {
      const event = AsyncResult.getOrElse(result, () => null);
      if (event === null || event === lastEvent) return;
      lastEvent = event;
      syncedContent = event.content;
      const parsed = parseDrawnixDocument(event.content);
      if (!loaded) {
        loaded = true;
        onInitialLoad(parsed);
        return;
      }
      if (event.clientId === clientId) return;
      pendingContent = null;
      onRemoteUpdate(parsed);
    },
    { immediate: true },
  );

  return {
    changed: (doc) => {
      if (!loaded) return;
      const nextContent = serializeDrawnixDocument(doc);
      if (nextContent === syncedContent) return;
      pendingContent = nextContent;
      scheduleSave();
    },
    close: () => {
      closed = true;
      unsubscribe();
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = null;
      void flush();
    },
  };
}
