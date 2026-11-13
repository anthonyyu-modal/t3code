import {
  WHITEBOARD_MAX_FILE_DATA_URL_LENGTH,
  type WhiteboardElement,
  type WhiteboardFiles,
} from "@t3tools/contracts";

/** The slice of an Excalidraw element that syncing reads. */
export interface SyncElement {
  readonly id: string;
  readonly version: number;
  readonly type?: string;
  readonly isDeleted?: boolean;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly fileId?: string | null;
}

export interface SyncFile {
  readonly mimeType: string;
  readonly dataURL: string;
  readonly created?: number;
}

/** Element versions the server is known to hold; anything else in the window still needs saving. */
export type SyncedVersions = Map<string, number>;

export function unsavedElements<T extends SyncElement>(
  elements: ReadonlyArray<T>,
  synced: SyncedVersions,
): Array<T> {
  return elements.filter((element) => synced.get(element.id) !== element.version);
}

/** Excalidraw leaves `undefined` properties on elements, which are not JSON and fail to encode. */
export function toWireElements(elements: ReadonlyArray<SyncElement>): Array<WhiteboardElement> {
  return JSON.parse(JSON.stringify(elements)) as Array<WhiteboardElement>;
}

export function markSynced(synced: SyncedVersions, elements: ReadonlyArray<WhiteboardElement>) {
  for (const element of elements) {
    if (typeof element.id === "string" && typeof element.version === "number") {
      synced.set(element.id, element.version);
    }
  }
}

/** Images on the board the server has not been sent. Ones over the size limit stay on this device. */
export function unsentFiles(
  files: Readonly<Record<string, SyncFile>>,
  elements: ReadonlyArray<SyncElement>,
  sent: ReadonlySet<string>,
): WhiteboardFiles {
  const unsent: Record<string, SyncFile> = {};
  for (const element of elements) {
    const fileId = element.fileId;
    if (element.isDeleted === true || typeof fileId !== "string" || sent.has(fileId)) continue;
    const file = files[fileId];
    if (file === undefined || file.dataURL.length > WHITEBOARD_MAX_FILE_DATA_URL_LENGTH) continue;
    unsent[fileId] = {
      mimeType: file.mimeType,
      dataURL: file.dataURL,
      ...(file.created === undefined ? {} : { created: file.created }),
    };
  }
  return unsent;
}

export interface Viewport {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
}

/** Whether any of the elements lies partly or wholly outside what the window shows. */
export function anyOutsideViewport(elements: ReadonlyArray<SyncElement>, view: Viewport): boolean {
  const left = -view.scrollX;
  const top = -view.scrollY;
  const right = left + view.width / view.zoom;
  const bottom = top + view.height / view.zoom;
  return elements.some((element) => {
    const x = element.x ?? 0;
    const y = element.y ?? 0;
    return (
      x < left || y < top || x + (element.width ?? 0) > right || y + (element.height ?? 0) > bottom
    );
  });
}
