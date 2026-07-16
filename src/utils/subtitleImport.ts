import {
  PRIMARY_STYLE,
  createDefaultDocument,
  createDefaultStyles,
  parseAss,
  type AssDocument,
  type SubtitleCue,
} from "@/lib/ass";

export interface ExternalSubtitlePlayRes {
  width: number;
  height: number;
}

export interface ParseExternalSubtitleDocumentArgs {
  path: string;
  text: string;
  playRes: ExternalSubtitlePlayRes;
}

function extensionOf(path: string): string {
  const filename = path.split(/[\\/]/).pop() ?? path;
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

function withVideoPlayRes(
  doc: AssDocument,
  playRes: ExternalSubtitlePlayRes,
): AssDocument {
  return {
    ...doc,
    scriptInfo: {
      ...doc.scriptInfo,
      playResX: playRes.width,
      playResY: playRes.height,
    },
    styles: doc.styles.length > 0 ? doc.styles : createDefaultStyles(),
  };
}

function parseSrtTime(input: string): number | null {
  const match = input
    .trim()
    .match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return null;

  const hours = Number(match[1] ?? "0");
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4].padEnd(3, "0"));
  if (![hours, minutes, seconds, millis].every(Number.isFinite)) return null;

  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

function parseSrtCue(lines: string[], index: number): SubtitleCue | null {
  const body = [...lines];
  if (/^\d+$/.test(body[0]?.trim() ?? "")) {
    body.shift();
  }

  const timeLineIndex = body.findIndex((line) => line.includes("-->"));
  if (timeLineIndex < 0) return null;

  const [startRaw, endRaw] = body[timeLineIndex]
    .split("-->")
    .map((part) => part.trim().split(/\s+/)[0]);
  const startMs = parseSrtTime(startRaw ?? "");
  const endMs = parseSrtTime(endRaw ?? "");
  if (startMs === null || endMs === null || endMs <= startMs) return null;

  const text = body.slice(timeLineIndex + 1).join("\n").trim();
  if (!text) return null;

  return {
    id: `srt_${index}`,
    startMs,
    endMs,
    primaryText: text,
    style: PRIMARY_STYLE,
    layer: 0,
  };
}

function parseSrtDocument(
  text: string,
  playRes: ExternalSubtitlePlayRes,
): AssDocument {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n|\r/g, "\n");
  const cues = normalized
    .split(/\n{2,}/)
    .map((block, index) =>
      parseSrtCue(
        block
          .split("\n")
          .map((line) => line.trimEnd())
          .filter((line) => line.trim() !== ""),
        index + 1,
      ),
    )
    .filter((cue): cue is SubtitleCue => cue !== null);

  if (cues.length === 0) {
    throw new Error("未识别字幕内容");
  }

  const doc = createDefaultDocument("Hikaru Sub", playRes.width, playRes.height);
  return { ...doc, cues };
}

export function parseExternalSubtitleDocument({
  path,
  text,
  playRes,
}: ParseExternalSubtitleDocumentArgs): AssDocument {
  const ext = extensionOf(path);
  if (ext === "ass") {
    return withVideoPlayRes(parseAss(text, { mergeBilingual: false }), playRes);
  }
  if (ext === "srt") {
    return parseSrtDocument(text, playRes);
  }

  throw new Error("不支持的字幕格式");
}
