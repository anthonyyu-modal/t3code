import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  WhiteboardFiles,
  WhiteboardId,
  WhiteboardSceneEvent,
  WhiteboardStreamEvent,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import type { Editor, TLRecord } from "tldraw";

import { observeResize } from "../../lib/observeResize";
import { randomUUID } from "../../lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { whiteboardEnvironment } from "../../state/whiteboard";
import { drawTldrawBoardPicture } from "./tldrawBoardPicture";
import {
  fromWireRecord,
  missingTldrawFiles,
  toWireRecord,
  unsentTldrawFiles,
} from "./tldrawRecords";

const SAVE_DEBOUNCE_MS = 400;
const QUIET = { reportFailure: false } as const;

export function openTldrawBoardSession(input: {
  readonly editor: Editor;
  readonly environmentId: EnvironmentId;
  readonly target: WhiteboardId;
  readonly onSaveFailed: (failed: boolean) => void;
}) {
  const { editor, environmentId, target, onSaveFailed } = input;
  const store = editor.store;
  const clientId = randomUUID();
  const synced = new Map<string, number>();
  const localVersions = new Map<string, number>();
  const localNonces = new Map<string, number>();
  const removedTypes = new Map<string, string>();
  const sentFileIds = new Set<string>();
  const dirty = new Set<string>();
  let cachedFiles: WhiteboardFiles = {};
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;
  let resave = false;
  let loaded = false;
  let closed = false;
  let lastEvent: WhiteboardStreamEvent | null = null;
  let zoomPending = false;
  let eventQueue = Promise.resolve();

  const zoomToDrawing = () => {
    const { width, height } = editor.getContainer().getBoundingClientRect();
    if (width === 0 || height === 0) {
      zoomPending = true;
      return;
    }
    zoomPending = false;
    editor.zoomToFit();
  };
  const stopObserving = observeResize(editor.getContainer(), () => {
    if (zoomPending) zoomToDrawing();
  });

  const serverScene = async () => {
    const result = await runAtomCommand(
      appAtomRegistry,
      whiteboardEnvironment.get,
      { environmentId, input: { boardId: target } },
      QUIET,
    );
    return result._tag === "Success" ? result.value : null;
  };

  const flush = async () => {
    if (saving) {
      resave = true;
      return;
    }
    const records = store.serialize("document");
    const changedIds = [...dirty];
    const sent = changedIds.map((id) => {
      const version = (localVersions.get(id) ?? synced.get(id) ?? 0) + 1;
      localVersions.set(id, version);
      const versionNonce = Math.floor(Math.random() * 2 ** 31);
      localNonces.set(id, versionNonce);
      const record = records[id as TLRecord["id"]];
      if (record !== undefined) return toWireRecord(record, version, Date.now(), versionNonce);
      return {
        id,
        typeName: removedTypes.get(id) ?? "shape",
        version,
        versionNonce,
        updated: Date.now(),
        isDeleted: true,
      };
    });
    const files = unsentTldrawFiles(Object.values(records), sentFileIds);
    if (sent.length === 0 && Object.keys(files).length === 0) return;
    dirty.clear();
    saving = true;
    const result = await runAtomCommand(
      appAtomRegistry,
      whiteboardEnvironment.save,
      { environmentId, input: { boardId: target, clientId, elements: sent, files } },
      QUIET,
    );
    saving = false;
    if (result._tag === "Success") {
      for (const element of sent) synced.set(String(element.id), Number(element.version));
      for (const fileId of Object.keys(files)) sentFileIds.add(fileId);
    } else {
      for (const id of changedIds) dirty.add(id);
    }
    onSaveFailed(result._tag !== "Success");
    if (resave) {
      resave = false;
      if (closed) void flush();
      else scheduleSave();
    } else if (result._tag !== "Success" && !closed) {
      scheduleSave();
    }
  };

  const scheduleSave = () => {
    if (!loaded || closed) return;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flush();
    }, SAVE_DEBOUNCE_MS);
  };

  const unlisten = store.listen(
    ({ changes }) => {
      if (!loaded || closed) return;
      for (const [id, record] of Object.entries(changes.added)) {
        dirty.add(id);
        removedTypes.set(id, record.typeName);
      }
      for (const [id, [, record]] of Object.entries(changes.updated)) {
        dirty.add(id);
        removedTypes.set(id, record.typeName);
      }
      for (const [id, record] of Object.entries(changes.removed)) {
        dirty.add(id);
        removedTypes.set(id, record.typeName);
      }
      scheduleSave();
    },
    { source: "user", scope: "document" },
  );

  const applyScene = async (event: WhiteboardSceneEvent) => {
    if (missingTldrawFiles(event.elements, cachedFiles)) {
      const scene = await serverScene();
      if (scene !== null) cachedFiles = { ...cachedFiles, ...scene.files };
    }
    if (closed) return;
    const firstScene = !loaded;
    loaded = true;
    const before = new Map(synced);
    for (const element of event.elements) {
      if (typeof element.id === "string" && typeof element.version === "number") {
        synced.set(element.id, element.version);
      }
    }
    for (const fileId of event.fileIds) sentFileIds.add(fileId);
    if (event.clientId === clientId) return;

    const put: Array<TLRecord> = [];
    const remove: Array<TLRecord["id"]> = [];
    for (const element of event.elements) {
      if (typeof element.id !== "string" || typeof element.version !== "number") continue;
      const id = element.id as TLRecord["id"];
      const localVersion = localVersions.get(id) ?? before.get(id) ?? 0;
      const localWinsTie =
        localVersion === element.version &&
        (localNonces.get(id) ?? Number.MAX_SAFE_INTEGER) <=
          (typeof element.versionNonce === "number" ? element.versionNonce : 0);
      if (dirty.has(id) && (localVersion > element.version || localWinsTie)) continue;
      if (before.get(id) === element.version && !dirty.has(id)) continue;
      dirty.delete(id);
      localVersions.set(id, element.version);
      if (typeof element.versionNonce === "number") localNonces.set(id, element.versionNonce);
      if (element.isDeleted === true) remove.push(id);
      else put.push(fromWireRecord(element, cachedFiles));
    }
    if (put.length > 0 || remove.length > 0) {
      store.mergeRemoteChanges(() => {
        if (remove.length > 0) store.remove(remove);
        if (put.length > 0) store.put(put);
      });
    }
    if (firstScene || event.editor === "agent") zoomToDrawing();
  };

  const sendPicture = async (requestId: string) => {
    const picture = await drawTldrawBoardPicture(editor);
    await runAtomCommand(
      appAtomRegistry,
      whiteboardEnvironment.submitSnapshot,
      { environmentId, input: { requestId, ...picture } },
      QUIET,
    );
  };

  const unsubscribe = appAtomRegistry.subscribe(
    whiteboardEnvironment.events({ environmentId, input: { boardId: target } }),
    (result) => {
      const event = AsyncResult.getOrElse(result, () => null);
      if (event === null || event === lastEvent) return;
      lastEvent = event;
      if (event.type === "scene") {
        eventQueue = eventQueue.then(() => applyScene(event));
      } else {
        void sendPicture(event.requestId);
      }
    },
    { immediate: true },
  );

  return {
    close: () => {
      closed = true;
      unsubscribe();
      unlisten();
      stopObserving();
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = null;
      void flush();
    },
  };
}
