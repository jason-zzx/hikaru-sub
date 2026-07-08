import { describe, expect, it } from "vitest";
import { getMissingGlyphCodePointsForBuffer } from "./fontCoverage";

function writeU16(bytes: number[], offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeU32(bytes: number[], offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function minimalFormat4Font(supportedCodePoint: number): ArrayBuffer {
  const cmapOffset = 28;
  const subtableOffset = 12;
  const format4Offset = cmapOffset + subtableOffset;
  const format4Length = 32;
  const totalLength = cmapOffset + subtableOffset + format4Length;
  const bytes = new Array(totalLength).fill(0);

  writeU32(bytes, 0, 0x00010000);
  writeU16(bytes, 4, 1);
  bytes[12] = 0x63;
  bytes[13] = 0x6d;
  bytes[14] = 0x61;
  bytes[15] = 0x70;
  writeU32(bytes, 20, cmapOffset);
  writeU32(bytes, 24, subtableOffset + format4Length);

  writeU16(bytes, cmapOffset, 0);
  writeU16(bytes, cmapOffset + 2, 1);
  writeU16(bytes, cmapOffset + 4, 3);
  writeU16(bytes, cmapOffset + 6, 1);
  writeU32(bytes, cmapOffset + 8, subtableOffset);

  writeU16(bytes, format4Offset, 4);
  writeU16(bytes, format4Offset + 2, format4Length);
  writeU16(bytes, format4Offset + 6, 4);
  writeU16(bytes, format4Offset + 14, supportedCodePoint);
  writeU16(bytes, format4Offset + 16, 0xffff);
  writeU16(bytes, format4Offset + 20, supportedCodePoint);
  writeU16(bytes, format4Offset + 22, 0xffff);
  writeU16(bytes, format4Offset + 24, (1 - supportedCodePoint) & 0xffff);
  writeU16(bytes, format4Offset + 26, 1);

  return new Uint8Array(bytes).buffer;
}

function minimalFormat4Ttc(supportedCodePoint: number): ArrayBuffer {
  const sfntOffset = 16;
  const cmapOffset = 44;
  const subtableOffset = 12;
  const format4Offset = cmapOffset + subtableOffset;
  const format4Length = 32;
  const totalLength = cmapOffset + subtableOffset + format4Length;
  const bytes = new Array(totalLength).fill(0);

  bytes[0] = 0x74;
  bytes[1] = 0x74;
  bytes[2] = 0x63;
  bytes[3] = 0x66;
  writeU32(bytes, 4, 0x00010000);
  writeU32(bytes, 8, 1);
  writeU32(bytes, 12, sfntOffset);

  writeU32(bytes, sfntOffset, 0x00010000);
  writeU16(bytes, sfntOffset + 4, 1);
  bytes[sfntOffset + 12] = 0x63;
  bytes[sfntOffset + 13] = 0x6d;
  bytes[sfntOffset + 14] = 0x61;
  bytes[sfntOffset + 15] = 0x70;
  writeU32(bytes, sfntOffset + 20, cmapOffset);
  writeU32(bytes, sfntOffset + 24, subtableOffset + format4Length);

  writeU16(bytes, cmapOffset, 0);
  writeU16(bytes, cmapOffset + 2, 1);
  writeU16(bytes, cmapOffset + 4, 3);
  writeU16(bytes, cmapOffset + 6, 1);
  writeU32(bytes, cmapOffset + 8, subtableOffset);

  writeU16(bytes, format4Offset, 4);
  writeU16(bytes, format4Offset + 2, format4Length);
  writeU16(bytes, format4Offset + 6, 4);
  writeU16(bytes, format4Offset + 14, supportedCodePoint);
  writeU16(bytes, format4Offset + 16, 0xffff);
  writeU16(bytes, format4Offset + 20, supportedCodePoint);
  writeU16(bytes, format4Offset + 22, 0xffff);
  writeU16(bytes, format4Offset + 24, (1 - supportedCodePoint) & 0xffff);
  writeU16(bytes, format4Offset + 26, 1);

  return new Uint8Array(bytes).buffer;
}

describe("fontCoverage", () => {
  it("detects missing glyphs from a format 4 cmap table", () => {
    const missing = getMissingGlyphCodePointsForBuffer(
      minimalFormat4Font(0x4e2d),
      [0x4e2d, 0x6587],
    );

    expect(missing).toEqual([0x6587]);
  });

  it("uses absolute table offsets inside TTC font collections", () => {
    const missing = getMissingGlyphCodePointsForBuffer(
      minimalFormat4Ttc(0x4e2d),
      [0x4e2d, 0x6587],
    );

    expect(missing).toEqual([0x6587]);
  });
});
