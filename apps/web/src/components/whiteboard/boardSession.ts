import {
  CaptureUpdateAction,
  exportToBlob,
  reconcileElements,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  ScopedThreadRef,
  WhiteboardSceneEvent,
  WhiteboardStreamEvent,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { randomUUID } from "../../lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { whiteboardEnvironment } from "../../state/whiteboard";
import {
  anyOutsideViewport,
  markSynced,
  toWireElements,
  unsavedElements,
  unsentFiles,
  type SyncElement,
  type SyncedVersions,
} from "./whiteboardSync";

const SAVE_DEBOUNCE_MS = 400;
// The longest edge Claude reads without downscaling; a larger picture only costs tokens.
const PICTURE_MAX_EDGE = 1568;
const QUIET = { reportFailure: false } as const;

type RemoteElements = Parameters<typeof reconcileElements>[1];

export interface BoardSession {
  /** Call with the board's elements and state whenever Excalidraw reports a change. */
  readonly changed: (elements: ReadonlyArray<SyncElement>, state: AppState) => void;
  /** Stops following the server and sends whatever is still unsaved. */
  readonly close: () => void;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Keeps one open board in step with the server's copy: sends what this window changed, merges
 * what the agent or another window changed, and draws the board as a picture when the agent asks.
 */
export function openBoardSession(input: {
  readonly board: ExcalidrawImperativeAPI;
  readonly threadRef: ScopedThreadRef;
  readonly onSaveFailed: (failed: boolean) => void;
}): BoardSession {
  const { board, onSaveFailed } = input;
  const { environmentId, threadId } = input.threadRef;
  const clientId = randomUUID();
  const synced: SyncedVersions = new Map();
  const sentFileIds = new Set<string>();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;
  let resave = false;
  let loaded = false;
  let lastEvent: WhiteboardStreamEvent | null = null;
  // Drawn while the board was off screen. It has no size there, so nothing can be brought into
  // view until it is back.
  const unseen = new Set<string>();

  // Whatever the agent draws or moves has to end up where the user can see it.
  const bringIntoView = (
    drawn: ReadonlyArray<SyncElement>,
    state: AppState,
    look: { readonly always: boolean; readonly animate: boolean },
  ) => {
    if (drawn.length === 0) return;
    if (state.width === 0 || state.height === 0) {
      for (const element of drawn) unseen.add(element.id);
      return;
    }
    const outOfSight = anyOutsideViewport(drawn, {
      scrollX: state.scrollX,
      scrollY: state.scrollY,
      width: state.width,
      height: state.height,
      zoom: state.zoom.value,
    });
    if (look.always || outOfSight) {
      board.scrollToContent(undefined, { fitToContent: true, animate: look.animate });
    }
  };

  const flush = async () => {
    if (saving) {
      resave = true;
      return;
    }
    const elements = board.getSceneElementsIncludingDeleted();
    const unsaved = unsavedElements(elements, synced);
    const files = unsentFiles(board.getFiles(), elements, sentFileIds);
    if (unsaved.length === 0 && Object.keys(files).length === 0) return;
    saving = true;
    const sent = toWireElements(unsaved);
    const result = await runAtomCommand(
      appAtomRegistry,
      whiteboardEnvironment.save,
      { environmentId, input: { threadId, clientId, elements: sent, files } },
      QUIET,
    );
    saving = false;
    if (result._tag === "Success") {
      markSynced(synced, sent);
      for (const fileId of Object.keys(files)) sentFileIds.add(fileId);
    }
    onSaveFailed(result._tag !== "Success");
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

  const loadMissingFiles = async (fileIds: ReadonlyArray<string>) => {
    const held = board.getFiles();
    if (fileIds.every((fileId) => fileId in held)) return;
    const result = await runAtomCommand(
      appAtomRegistry,
      whiteboardEnvironment.get,
      { environmentId, input: { threadId } },
      QUIET,
    );
    if (result._tag !== "Success") return;
    board.addFiles(
      Object.entries(result.value.files).map(([id, file]) => ({
        id,
        mimeType: file.mimeType,
        dataURL: file.dataURL,
        created: file.created ?? Date.now(),
      })) as unknown as Parameters<ExcalidrawImperativeAPI["addFiles"]>[0],
    );
  };

  const applyScene = (event: WhiteboardSceneEvent) => {
    markSynced(synced, event.elements);
    for (const fileId of event.fileIds) sentFileIds.add(fileId);
    const firstScene = !loaded;
    loaded = true;
    if (event.clientId === clientId) return;
    const local = board.getSceneElementsIncludingDeleted();
    const before = new Map(local.map((element) => [element.id, element.version]));
    const remote = restoreElements(event.elements as never, null, { repairBindings: true });
    board.updateScene({
      elements: reconcileElements(local, remote as unknown as RemoteElements, board.getAppState()),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    // Excalidraw may adjust an element it takes in (repaired bindings, a missing index). That is
    // not the user's edit, so it must not be saved back as one.
    const incoming = new Set(remote.map((element) => element.id));
    for (const element of board.getSceneElementsIncludingDeleted()) {
      if (incoming.has(element.id) && before.get(element.id) !== element.version) {
        synced.set(element.id, element.version);
      }
    }
    void loadMissingFiles(event.fileIds);
    if (!firstScene && event.editor !== "agent") return;
    const drawn = remote.filter(
      (element) => !element.isDeleted && (before.get(element.id) ?? 0) < element.version,
    );
    bringIntoView(drawn, board.getAppState(), { always: firstScene, animate: !firstScene });
  };

  const sendPicture = async (requestId: string) => {
    let size = { width: 0, height: 0 };
    const blob = await exportToBlob({
      elements: board.getSceneElements(),
      // Always the light board, so colours the agent names match what whiteboard_read reports.
      appState: {
        exportBackground: true,
        exportWithDarkMode: false,
        viewBackgroundColor: "#ffffff",
      },
      files: board.getFiles(),
      mimeType: "image/png",
      exportPadding: 24,
      getDimensions: (width: number, height: number) => {
        const scale = Math.min(1, PICTURE_MAX_EDGE / Math.max(width, height));
        size = { width: Math.round(width * scale), height: Math.round(height * scale) };
        return { ...size, scale };
      },
    });
    await runAtomCommand(
      appAtomRegistry,
      whiteboardEnvironment.submitSnapshot,
      {
        environmentId,
        input: {
          threadId,
          requestId,
          mimeType: "image/png" as const,
          data: await blobToBase64(blob),
          ...size,
        },
      },
      QUIET,
    );
  };

  const unsubscribe = appAtomRegistry.subscribe(
    whiteboardEnvironment.events({ environmentId, input: { threadId } }),
    (result) => {
      const event = AsyncResult.getOrElse(result, () => null);
      if (event === null || event === lastEvent) return;
      lastEvent = event;
      if (event.type === "scene") applyScene(event);
      else void sendPicture(event.requestId);
    },
    { immediate: true },
  );

  return {
    changed: (elements, state) => {
      if (unseen.size > 0 && state.width > 0 && state.height > 0) {
        const drawn = elements.filter((element) => unseen.has(element.id) && !element.isDeleted);
        unseen.clear();
        bringIntoView(drawn, state, { always: false, animate: false });
      }
      // Until the first scene arrives, every element would look unsaved.
      if (loaded && unsavedElements(elements, synced).length > 0) scheduleSave();
    },
    close: () => {
      unsubscribe();
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = null;
      void flush();
    },
  };
}
