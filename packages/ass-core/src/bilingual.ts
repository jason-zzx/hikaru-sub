import { DEFAULT_BILINGUAL_OPTIONS, createId } from "./defaults";
import type { AssEvent, BilingualOptions, SubtitleCue } from "./types";

/** 编辑器文本（真实换行）转 ASS 文本（`\N` 硬换行）。 */
export function toAssText(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "\\N");
}

/** ASS 文本转编辑器文本，硬/软换行 `\N`、`\n` 统一为真实换行。 */
export function fromAssText(text: string): string {
  return text.replace(/\\N/g, "\n").replace(/\\n/g, "\n");
}

function makeEvent(
  cue: SubtitleCue,
  style: string,
  text: string,
): AssEvent {
  return {
    kind: "Dialogue",
    layer: cue.layer,
    startMs: cue.startMs,
    endMs: cue.endMs,
    style,
    name: "",
    marginL: 0,
    marginR: 0,
    marginV: 0,
    effect: "",
    text: toAssText(text),
  };
}

/**
 * 单条 cue 展开为 Dialogue 事件：
 * 原文一行；若有译文，再加一行（同 start/end，使用 secondaryStyle）。
 */
export function cueToEvents(
  cue: SubtitleCue,
  options: Partial<BilingualOptions> = {},
): AssEvent[] {
  const opts = { ...DEFAULT_BILINGUAL_OPTIONS, ...options };
  const events: AssEvent[] = [];
  const primaryStyle = cue.style || opts.primaryStyle;
  events.push(makeEvent(cue, primaryStyle, cue.primaryText));
  if (cue.secondaryText && cue.secondaryText.trim() !== "") {
    events.push(makeEvent(cue, opts.secondaryStyle, cue.secondaryText));
  }
  return events;
}

/** 多条 cue 展开为事件列表（按时间排序后输出）。 */
export function cuesToEvents(
  cues: SubtitleCue[],
  options: Partial<BilingualOptions> = {},
): AssEvent[] {
  const sorted = [...cues].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  );
  return sorted.flatMap((cue) => cueToEvents(cue, options));
}

/**
 * 事件列表合并为逻辑 cue：
 * 同 (layer, start, end) 分组，组内若同时存在 secondaryStyle 行与其他行，
 * 合并为「原文 + 译文」单条 cue；否则每行独立成 cue。
 * 仅处理 Dialogue，忽略 Comment。
 */
export function eventsToCues(
  events: AssEvent[],
  options: Partial<BilingualOptions> = {},
): SubtitleCue[] {
  const opts = { ...DEFAULT_BILINGUAL_OPTIONS, ...options };
  const dialogues = events.filter((e) => e.kind === "Dialogue");

  interface Group {
    order: number;
    items: AssEvent[];
  }
  const groups = new Map<string, Group>();
  dialogues.forEach((ev, idx) => {
    const key = `${ev.layer}|${ev.startMs}|${ev.endMs}`;
    let g = groups.get(key);
    if (!g) {
      g = { order: idx, items: [] };
      groups.set(key, g);
    }
    g.items.push(ev);
  });

  const cues: SubtitleCue[] = [];
  for (const { items } of [...groups.values()].sort((a, b) => a.order - b.order)) {
    const secondary = items.find((e) => e.style === opts.secondaryStyle);
    const primary = items.find((e) => e.style !== opts.secondaryStyle);

    if (secondary && primary && items.length <= 2) {
      cues.push({
        id: createId(),
        startMs: primary.startMs,
        endMs: primary.endMs,
        primaryText: fromAssText(primary.text),
        secondaryText: fromAssText(secondary.text),
        style: primary.style,
        layer: primary.layer,
      });
      continue;
    }

    // 无法配对：逐行独立成 cue
    for (const ev of items) {
      cues.push({
        id: createId(),
        startMs: ev.startMs,
        endMs: ev.endMs,
        primaryText: fromAssText(ev.text),
        style: ev.style,
        layer: ev.layer,
      });
    }
  }

  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return cues;
}
