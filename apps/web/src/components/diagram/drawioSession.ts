import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { DiagramBoardId, DiagramDocumentEvent, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { randomUUID } from "../../lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { diagramEnvironment } from "../../state/diagram";

const SAVE_DEBOUNCE_MS = 400;
const QUIET = { reportFailure: false } as const;

interface DrawioIncomingMessage {
  readonly event?: string;
  readonly xml?: string;
}

export interface DrawioSession {
  readonly setAppearance: (appearance: "light" | "dark") => void;
  readonly close: () => void;
}

/**
 * Bridges a mounted draw.io embed iframe with the server's `.drawio` file over postMessage:
 * loads initial XML, debounces autosaves, and live-merges remote edits without reloading.
 */
export function openDrawioSession(input: {
  readonly iframe: HTMLIFrameElement;
  readonly expectedOrigin: string;
  readonly environmentId: EnvironmentId;
  readonly boardId: DiagramBoardId;
  readonly initialAppearance: "light" | "dark";
  readonly onReady: () => void;
  readonly onSaveFailed: (failed: boolean) => void;
}): DrawioSession {
  const { iframe, expectedOrigin, environmentId, boardId, onReady, onSaveFailed } = input;
  const clientId = randomUUID();
  let appearance = input.initialAppearance;
  let editorReady = false;
  let loadedIntoEditor = false;
  let syncedXml: string | null = null;
  let pendingXml: string | null = null;
  let lastEvent: DiagramDocumentEvent | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;
  let resave = false;
  let closed = false;

  const post = (message: Record<string, unknown>) => {
    const targetWindow = iframe.contentWindow;
    if (!targetWindow) return;
    targetWindow.postMessage(JSON.stringify(message), expectedOrigin);
  };

  const loadXmlIntoEditor = (xml: string) => {
    loadedIntoEditor = true;
    post({
      action: "load",
      xml,
      autosave: 1,
      noSaveBtn: 1,
      noExitBtn: 1,
      dark: appearance === "dark",
    });
  };

  const flush = async () => {
    if (saving) {
      resave = true;
      return;
    }
    const nextXml = pendingXml;
    if (nextXml === null || nextXml === syncedXml) return;
    saving = true;
    const result = await runAtomCommand(
      appAtomRegistry,
      diagramEnvironment.save,
      { environmentId, input: { engine: "drawio", boardId, clientId, content: nextXml } },
      QUIET,
    );
    saving = false;
    if (result._tag === "Success") {
      syncedXml = nextXml;
      if (pendingXml === nextXml) pendingXml = null;
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

  const handleMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    if (expectedOrigin !== "null" && event.origin !== expectedOrigin) return;
    if (typeof event.data !== "string" || event.data.length === 0) return;
    let message: DrawioIncomingMessage;
    try {
      message = JSON.parse(event.data) as DrawioIncomingMessage;
    } catch {
      return;
    }
    if (message.event === "init") {
      editorReady = true;
      if (syncedXml !== null && !loadedIntoEditor) {
        loadXmlIntoEditor(syncedXml);
      }
      return;
    }
    if (message.event === "load") {
      onReady();
      return;
    }
    if (
      (message.event === "autosave" || message.event === "save") &&
      typeof message.xml === "string" &&
      message.xml.length > 0
    ) {
      if (!loadedIntoEditor) return;
      if (message.xml === syncedXml) return;
      pendingXml = message.xml;
      scheduleSave();
    }
  };

  window.addEventListener("message", handleMessage);

  const unsubscribe = appAtomRegistry.subscribe(
    diagramEnvironment.events({ environmentId, input: { engine: "drawio", boardId } }),
    (result) => {
      const event = AsyncResult.getOrElse(result, () => null);
      if (event === null || event === lastEvent) return;
      lastEvent = event;
      syncedXml = event.content;
      if (!editorReady) return;
      if (!loadedIntoEditor) {
        loadXmlIntoEditor(event.content);
        return;
      }
      if (event.clientId === clientId) return;
      pendingXml = null;
      post({ action: "merge", xml: event.content });
    },
    { immediate: true },
  );

  return {
    setAppearance: (nextAppearance) => {
      if (nextAppearance === appearance) return;
      appearance = nextAppearance;
      if (!editorReady || !loadedIntoEditor) return;
      const xml = pendingXml ?? syncedXml;
      if (xml !== null) loadXmlIntoEditor(xml);
    },
    close: () => {
      closed = true;
      window.removeEventListener("message", handleMessage);
      unsubscribe();
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = null;
      void flush();
    },
  };
}
