import type { PreviewFontFile } from "../types";

export interface FontGlyphCoverageResult {
  fontName: string;
  checkedCodePoints: number[];
  missingCodePoints: number[];
}

interface ParsedFontCoverage {
  supportsCodePoint: (codePoint: number) => boolean;
}

const parsedFontCache = new Map<string, Promise<ParsedFontCoverage>>();

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function inRange(view: DataView, offset: number, length: number): boolean {
  return offset >= 0 && length >= 0 && offset + length <= view.byteLength;
}

function tableOffset(view: DataView, fontOffset: number, tag: string): number | null {
  if (!inRange(view, fontOffset, 12)) return null;
  const tableCount = view.getUint16(fontOffset + 4, false);
  const recordsOffset = fontOffset + 12;

  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = recordsOffset + index * 16;
    if (!inRange(view, recordOffset, 16)) return null;
    if (readTag(view, recordOffset) === tag) {
      return view.getUint32(recordOffset + 8, false);
    }
  }

  return null;
}

function fontOffsets(view: DataView): number[] {
  if (!inRange(view, 0, 4)) return [];
  const tag = readTag(view, 0);
  if (tag !== "ttcf") return [0];

  if (!inRange(view, 0, 12)) return [];
  const count = view.getUint32(8, false);
  const offsets: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const offsetPosition = 12 + index * 4;
    if (!inRange(view, offsetPosition, 4)) break;
    offsets.push(view.getUint32(offsetPosition, false));
  }
  return offsets;
}

function format0Supports(view: DataView, offset: number, codePoint: number): boolean {
  if (codePoint > 0xff || !inRange(view, offset, 262)) return false;
  return view.getUint8(offset + 6 + codePoint) !== 0;
}

function format4Supports(view: DataView, offset: number, codePoint: number): boolean {
  if (codePoint > 0xffff || !inRange(view, offset, 16)) return false;
  const length = view.getUint16(offset + 2, false);
  if (!inRange(view, offset, length)) return false;

  const segCount = view.getUint16(offset + 6, false) / 2;
  if (!Number.isInteger(segCount) || segCount <= 0) return false;

  const endCodeOffset = offset + 14;
  const startCodeOffset = endCodeOffset + segCount * 2 + 2;
  const idDeltaOffset = startCodeOffset + segCount * 2;
  const idRangeOffsetOffset = idDeltaOffset + segCount * 2;

  for (let index = 0; index < segCount; index += 1) {
    const endCode = view.getUint16(endCodeOffset + index * 2, false);
    const startCode = view.getUint16(startCodeOffset + index * 2, false);
    if (codePoint < startCode || codePoint > endCode) continue;

    const delta = view.getInt16(idDeltaOffset + index * 2, false);
    const rangeOffsetPosition = idRangeOffsetOffset + index * 2;
    const rangeOffset = view.getUint16(rangeOffsetPosition, false);
    if (rangeOffset === 0) {
      return ((codePoint + delta) & 0xffff) !== 0;
    }

    const glyphOffset =
      rangeOffsetPosition + rangeOffset + (codePoint - startCode) * 2;
    if (!inRange(view, glyphOffset, 2)) return false;
    const glyph = view.getUint16(glyphOffset, false);
    if (glyph === 0) return false;
    return ((glyph + delta) & 0xffff) !== 0;
  }

  return false;
}

function format6Supports(view: DataView, offset: number, codePoint: number): boolean {
  if (!inRange(view, offset, 10)) return false;
  const length = view.getUint16(offset + 2, false);
  if (!inRange(view, offset, length)) return false;
  const firstCode = view.getUint16(offset + 6, false);
  const entryCount = view.getUint16(offset + 8, false);
  if (codePoint < firstCode || codePoint >= firstCode + entryCount) return false;
  const glyphOffset = offset + 10 + (codePoint - firstCode) * 2;
  return inRange(view, glyphOffset, 2) && view.getUint16(glyphOffset, false) !== 0;
}

function format12Supports(view: DataView, offset: number, codePoint: number): boolean {
  if (!inRange(view, offset, 16)) return false;
  const length = view.getUint32(offset + 4, false);
  if (!inRange(view, offset, length)) return false;
  const groupCount = view.getUint32(offset + 12, false);
  let left = 0;
  let right = groupCount - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const groupOffset = offset + 16 + mid * 12;
    if (!inRange(view, groupOffset, 12)) return false;
    const startCode = view.getUint32(groupOffset, false);
    const endCode = view.getUint32(groupOffset + 4, false);
    if (codePoint < startCode) {
      right = mid - 1;
    } else if (codePoint > endCode) {
      left = mid + 1;
    } else {
      return true;
    }
  }

  return false;
}

function subtableSupports(view: DataView, offset: number, codePoint: number): boolean {
  if (!inRange(view, offset, 2)) return false;
  const format = view.getUint16(offset, false);
  if (format === 0) return format0Supports(view, offset, codePoint);
  if (format === 4) return format4Supports(view, offset, codePoint);
  if (format === 6) return format6Supports(view, offset, codePoint);
  if (format === 12 || format === 13) return format12Supports(view, offset, codePoint);
  return false;
}

function parseFontCoverage(buffer: ArrayBuffer): ParsedFontCoverage {
  const view = new DataView(buffer);
  const cmapSubtableOffsets = new Set<number>();

  for (const fontOffset of fontOffsets(view)) {
    const cmapOffset = tableOffset(view, fontOffset, "cmap");
    if (cmapOffset === null || !inRange(view, cmapOffset, 4)) continue;

    const recordCount = view.getUint16(cmapOffset + 2, false);
    for (let index = 0; index < recordCount; index += 1) {
      const recordOffset = cmapOffset + 4 + index * 8;
      if (!inRange(view, recordOffset, 8)) break;
      cmapSubtableOffsets.add(
        cmapOffset + view.getUint32(recordOffset + 4, false),
      );
    }
  }

  const subtableOffsets = [...cmapSubtableOffsets];
  return {
    supportsCodePoint(codePoint) {
      return subtableOffsets.some((offset) =>
        subtableSupports(view, offset, codePoint),
      );
    },
  };
}

async function loadParsedFont(font: PreviewFontFile): Promise<ParsedFontCoverage> {
  const key = font.url || font.path;
  const cached = parsedFontCache.get(key);
  if (cached) return cached;

  const promise = fetch(font.url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`无法读取字体文件：${font.fileName}`);
      }
      return response.arrayBuffer();
    })
    .then(parseFontCoverage);
  parsedFontCache.set(key, promise);
  return promise;
}

export function getMissingGlyphCodePointsForBuffer(
  buffer: ArrayBuffer,
  codePoints: number[],
): number[] {
  const font = parseFontCoverage(buffer);
  return [...new Set(codePoints)].filter(
    (codePoint) => !font.supportsCodePoint(codePoint),
  );
}

export async function checkPreviewFontGlyphs(
  font: PreviewFontFile,
  fontName: string,
  codePoints: number[],
): Promise<FontGlyphCoverageResult> {
  const parsed = await loadParsedFont(font);
  const checkedCodePoints = [...new Set(codePoints)];
  return {
    fontName,
    checkedCodePoints,
    missingCodePoints: checkedCodePoints.filter(
      (codePoint) => !parsed.supportsCodePoint(codePoint),
    ),
  };
}
