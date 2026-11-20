import {
  WHITEBOARD_MAX_FILE_DATA_URL_LENGTH,
  type WhiteboardElement,
  type WhiteboardFiles,
} from "@t3tools/contracts";
import type { TLRecord } from "tldraw";

const SYNC_FIELDS = ["version", "versionNonce", "updated", "isDeleted"] as const;

export function fromWireRecord(element: WhiteboardElement, files: WhiteboardFiles): TLRecord {
  const record = { ...element };
  for (const field of SYNC_FIELDS) delete record[field];
  if (record.typeName === "asset" && typeof record.id === "string") {
    const file = files[record.id];
    if (file !== undefined) {
      record.props = { ...(record.props as object), src: file.dataURL };
    }
  }
  return record as unknown as TLRecord;
}

export function fromWireRecords(
  elements: ReadonlyArray<WhiteboardElement>,
  files: WhiteboardFiles,
): Array<TLRecord> {
  return elements
    .filter((element) => element.isDeleted !== true)
    .map((element) => fromWireRecord(element, files));
}

export function toWireRecord(
  record: TLRecord,
  version: number,
  updated: number,
  versionNonce: number,
): WhiteboardElement {
  const wire: Record<string, unknown> = { ...record };
  if (wire.typeName === "asset") {
    const props = wire.props as { src?: unknown } | undefined;
    if (typeof props?.src === "string" && props.src.startsWith("data:")) {
      wire.props = { ...props, src: null };
    }
  }
  return { ...wire, version, versionNonce, updated, isDeleted: false };
}

export function unsentTldrawFiles(
  records: ReadonlyArray<TLRecord>,
  sent: ReadonlySet<string>,
): WhiteboardFiles {
  const files: Record<string, { mimeType: string; dataURL: string }> = {};
  for (const record of records) {
    if (record.typeName !== "asset" || sent.has(record.id)) continue;
    const props = record.props as { src?: unknown; mimeType?: unknown };
    if (typeof props.src !== "string" || !props.src.startsWith("data:")) continue;
    if (props.src.length > WHITEBOARD_MAX_FILE_DATA_URL_LENGTH) continue;
    const mimeType =
      typeof props.mimeType === "string"
        ? props.mimeType
        : (props.src.slice(5).split(";", 1)[0] ?? "application/octet-stream");
    files[record.id] = { mimeType, dataURL: props.src };
  }
  return files;
}

export function missingTldrawFiles(
  elements: ReadonlyArray<WhiteboardElement>,
  files: WhiteboardFiles,
): boolean {
  return elements.some(
    (element) =>
      element.isDeleted !== true &&
      element.typeName === "asset" &&
      typeof element.id === "string" &&
      (element.props as { src?: unknown } | undefined)?.src === null &&
      files[element.id] === undefined,
  );
}
