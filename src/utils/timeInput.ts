export const TIME_INPUT_TEMPLATE = "00:00:00.00";
export const TIME_INPUT_DIGIT_INDEXES = [0, 1, 3, 4, 6, 7, 9, 10] as const;

type TimeDigitIndex = (typeof TIME_INPUT_DIGIT_INDEXES)[number];

export type TimeInputEditResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  handled: boolean;
};

export type TimeParseResult =
  | { ok: true; valueMs: number; normalized: string }
  | { ok: false; message: string };

export type TimeRangeNormalized = {
  startMs: number;
  endMs: number;
  startText: string;
  endText: string;
};

const LAST_TIME_MS = 99 * 3_600_000 + 59 * 60_000 + 59 * 1000 + 990;
const DIGIT_INDEX_SET = new Set<number>(TIME_INPUT_DIGIT_INDEXES);

function clampPosition(position: number): number {
  if (!Number.isFinite(position)) return 0;
  return Math.max(0, Math.min(TIME_INPUT_TEMPLATE.length, Math.round(position)));
}

function isDigitKey(key: string): boolean {
  return /^[0-9]$/.test(key);
}

function digitAtOrAfter(position: number): TimeDigitIndex {
  const pos = clampPosition(position);
  return (
    TIME_INPUT_DIGIT_INDEXES.find((idx) => idx >= pos) ??
    TIME_INPUT_DIGIT_INDEXES[TIME_INPUT_DIGIT_INDEXES.length - 1]
  );
}

function digitAfter(position: number): number {
  const pos = clampPosition(position);
  return (
    TIME_INPUT_DIGIT_INDEXES.find((idx) => idx > pos) ??
    TIME_INPUT_TEMPLATE.length
  );
}

function digitBefore(position: number): number {
  const pos = clampPosition(position);
  for (let i = TIME_INPUT_DIGIT_INDEXES.length - 1; i >= 0; i -= 1) {
    const idx = TIME_INPUT_DIGIT_INDEXES[i];
    if (idx < pos) return idx;
  }
  return 0;
}

export function snapTimeInputCaret(position: number): number {
  const pos = clampPosition(position);
  if (pos === TIME_INPUT_TEMPLATE.length || DIGIT_INDEX_SET.has(pos)) return pos;

  const next = TIME_INPUT_DIGIT_INDEXES.find((idx) => idx > pos);
  const prev = [...TIME_INPUT_DIGIT_INDEXES]
    .reverse()
    .find((idx) => idx < pos);

  if (next === undefined) return TIME_INPUT_TEMPLATE.length;
  if (prev === undefined) return 0;
  return next - pos <= pos - prev ? next : prev;
}

export function normalizeTimeInputValue(value: string): string {
  const digits = value.replace(/\D/g, "").padEnd(8, "0").slice(0, 8);
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
}

export function applyTimeInputKey(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  key: string,
): TimeInputEditResult {
  const normalized = normalizeTimeInputValue(value);
  const start = clampPosition(selectionStart);

  if (isDigitKey(key)) {
    const target = digitAtOrAfter(start);
    const nextValue =
      normalized.slice(0, target) + key + normalized.slice(target + 1);
    const nextCaret = digitAfter(target);
    return {
      value: nextValue,
      selectionStart: nextCaret,
      selectionEnd: nextCaret,
      handled: true,
    };
  }

  if (key === "Backspace") {
    const nextCaret = digitBefore(start);
    return {
      value: normalized,
      selectionStart: nextCaret,
      selectionEnd: nextCaret,
      handled: true,
    };
  }

  if (key === "Delete") {
    const nextCaret = digitAfter(start);
    return {
      value: normalized,
      selectionStart: nextCaret,
      selectionEnd: nextCaret,
      handled: true,
    };
  }

  return {
    value: normalized,
    selectionStart: start,
    selectionEnd: clampPosition(selectionEnd),
    handled: false,
  };
}

export function formatTimeInput(ms: number): string {
  const bounded = Math.max(0, Math.min(LAST_TIME_MS, Math.floor(ms)));
  const totalSeconds = Math.floor(bounded / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((bounded % 1000) / 10);

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

export function parseTimeInput(input: string): TimeParseResult {
  const normalized = normalizeTimeInputValue(input);
  const match = normalized.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!match) return { ok: false, message: "时间格式无效" };

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const centiseconds = Number(match[4]);

  // 直接累加毫秒：分钟/秒 ≥ 60 会自然进位到上一级，
  // 再由 formatTimeInput 重新拆分为合法字段（不报错、不打断输入）。
  const rawMs =
    hours * 3_600_000 +
    minutes * 60_000 +
    seconds * 1000 +
    centiseconds * 10;
  const valueMs = Math.max(0, Math.min(LAST_TIME_MS, rawMs));

  return { ok: true, valueMs, normalized: formatTimeInput(valueMs) };
}

export function normalizeTimeRange(
  startInput: string,
  endInput: string,
  changedField: "start" | "end" = "end",
): TimeRangeNormalized {
  const start = parseTimeInput(startInput);
  const end = parseTimeInput(endInput);

  const startMs = start.ok ? start.valueMs : 0;
  const endMs = end.ok ? end.valueMs : 0;
  const startText = start.ok ? start.normalized : formatTimeInput(0);
  const endText = end.ok ? end.normalized : formatTimeInput(0);

  // 倒序时把用户刚改的那个钳到另一个时间（相等而非倒序），不打断、不报错。
  if (endMs < startMs) {
    if (changedField === "end") {
      return { startMs, endMs: startMs, startText, endText: startText };
    }
    return { startMs: endMs, endMs, startText: endText, endText };
  }

  return { startMs, endMs, startText, endText };
}
