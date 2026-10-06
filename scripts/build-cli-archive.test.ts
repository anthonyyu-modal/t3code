import { describe, expect, it } from "vite-plus/test";

import { splitSeaBlobNoteSegment } from "./build-cli-archive.ts";

const PHDR_SIZE = 56;
const PT_NOTE = 4;
const PT_PHDR = 6;
const BASE_VADDR = 0x400000;
const MiB = 1024 * 1024;

const padded = (size: number) => Math.ceil(size / 4) * 4;

function note(name: string, type: number, descSize: number) {
  const nameBytes = new TextEncoder().encode(`${name}\0`);
  const bytes = new Uint8Array(12 + padded(nameBytes.length) + padded(descSize));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, nameBytes.length, true);
  view.setUint32(4, descSize, true);
  view.setUint32(8, type, true);
  bytes.set(nameBytes, 12);
  return bytes;
}

function writePhdr(view: DataView, at: number, type: number, offset: number, size: number) {
  view.setUint32(at, type, true);
  view.setBigUint64(at + 8, BigInt(offset), true);
  view.setBigUint64(at + 16, BigInt(BASE_VADDR + offset), true);
  view.setBigUint64(at + 24, BigInt(BASE_VADDR + offset), true);
  view.setBigUint64(at + 32, BigInt(size), true);
  view.setBigUint64(at + 40, BigInt(size), true);
  view.setBigUint64(at + 48, BigInt(type === PT_NOTE ? 4 : 8), true);
}

/**
 * A minimal ELF64 laid out like --build-sea output: node's build-id note and
 * the SEA blob share the last PT_NOTE, and PT_PHDR reserves room past the table.
 */
function fakeSeaExecutable(blobSize: number, phdrSlots = 4) {
  const buildId = note("GNU", 3, 20);
  const blob = note("NODE_SEA_BLOB", 0, blobSize);
  const phoff = 64;
  const notesOffset = phoff + phdrSlots * PHDR_SIZE;
  const bytes = new Uint8Array(notesOffset + buildId.length + blob.length);
  const view = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  view.setUint16(16, 2, true);
  view.setBigUint64(0x20, BigInt(phoff), true);
  view.setUint16(0x36, PHDR_SIZE, true);
  view.setUint16(0x38, 2, true);
  writePhdr(view, phoff, PT_PHDR, phoff, phdrSlots * PHDR_SIZE);
  writePhdr(view, phoff + PHDR_SIZE, PT_NOTE, notesOffset, buildId.length + blob.length);
  bytes.set(buildId, notesOffset);
  bytes.set(blob, notesOffset + buildId.length);
  return { bytes, buildIdSize: buildId.length };
}

/** Every PT_NOTE in header order, with the note names a loader walking it would see. */
function noteSegments(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const phoff = Number(view.getBigUint64(0x20, true));
  const segments = [];
  for (let index = 0; index < view.getUint16(0x38, true); index++) {
    const at = phoff + index * PHDR_SIZE;
    if (view.getUint32(at, true) !== PT_NOTE) continue;
    const offset = Number(view.getBigUint64(at + 8, true));
    const vaddr = Number(view.getBigUint64(at + 16, true));
    const size = Number(view.getBigUint64(at + 32, true));
    const names = [];
    for (let cursor = offset; cursor + 12 <= offset + size;) {
      const nameSize = view.getUint32(cursor, true);
      names.push(new TextDecoder().decode(bytes.subarray(cursor + 12, cursor + 11 + nameSize)));
      cursor += 12 + padded(nameSize) + padded(view.getUint32(cursor + 4, true));
    }
    segments.push({ offset, vaddr, size, names });
  }
  return segments;
}

describe("splitSeaBlobNoteSegment", () => {
  it("moves node's notes into a small last PT_NOTE and keeps the blob reachable", () => {
    const { bytes, buildIdSize } = fakeSeaExecutable(5 * MiB);

    const blobSize = splitSeaBlobNoteSegment(bytes);

    const segments = noteSegments(bytes);
    expect(segments.map((segment) => segment.names)).toEqual([["NODE_SEA_BLOB"], ["GNU"]]);
    expect(segments.at(-1)?.size).toBe(buildIdSize);
    expect(segments[0]?.size).toBe(blobSize);
    for (const segment of segments) {
      expect(segment.vaddr - segment.offset).toBe(BASE_VADDR);
    }
  });

  it("leaves an executable whose last PT_NOTE is within the limit untouched", () => {
    const { bytes } = fakeSeaExecutable(1 * MiB);
    const original = bytes.slice();

    expect(splitSeaBlobNoteSegment(bytes)).toBeNull();
    expect(Buffer.compare(bytes, original)).toBe(0);
  });

  it("refuses to write past the room PT_PHDR reserves for the table", () => {
    const { bytes } = fakeSeaExecutable(5 * MiB, 2);

    expect(() => splitSeaBlobNoteSegment(bytes)).toThrow("no free program header slot");
  });
});
