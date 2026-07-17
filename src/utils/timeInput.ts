/** Default placeholder / empty display: ASS-style `H:MM:SS.cc` with unpadded hours. */
export const TIME_INPUT_TEMPLATE = "0:00:00.00";

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

function digitIndexes(value: string): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) indexes.push(index);
  }
  return indexes;
}

function clampPosition(position: number, length: number): number {
  if (!Number.isFinite(position)) return 0;
  return Math.max(0, Math.min(length, Math.round(position)));
}

export function normalizeTimeInputValue(value: string): string {
  // Preserve field boundaries when the value already has H:MM:SS.cc structure.
  const structured = value.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{2})$/);
  if (structured) {
    return `${Math.min(99, Number(structured[1]))}:${structured[2]}:${structured[3]}.${structured[4]}`;
  }

  const digits = value.replace(/\D/g, "").padEnd(8, "0").slice(0, 8);
  return `${Math.min(99, Number(digits.slice(0, 2)))}:${digits.slice(2, 4)}:${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
}

export function snapTimeInputCaret(position: number, value = TIME_INPUT_TEMPLATE): number {
  const normalized = normalizeTimeInputValue(value);
  const pos = clampPosition(position, normalized.length);
  const indexes = digitIndexes(normalized);

  if (pos === normalized.length || indexes.includes(pos)) return pos;

  const next = indexes.find((index) => index > pos);
  let previous = indexes[0] ?? 0;
  for (const index of indexes) {
    if (index >= pos) break;
    previous = index;
  }

  if (next === undefined) return normalized.length;
  return next - pos <= pos - previous ? next : previous;
}

export function applyTimeInputKey(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  key: string,
): TimeInputEditResult {
  const normalized = normalizeTimeInputValue(value);
  const indexes = digitIndexes(normalized);
  const start = clampPosition(selectionStart, normalized.length);
  let ordinal = indexes.findIndex((index) => index >= start);
  if (ordinal < 0) ordinal = indexes.length - 1;

  if (/^[0-9]$/.test(key)) {
    const target = indexes[ordinal];
    const nextValue = normalizeTimeInputValue(
      normalized.slice(0, target) + key + normalized.slice(target + 1),
    );
    const nextCaret = digitIndexes(nextValue)[ordinal + 1] ?? nextValue.length;
    return {
      value: nextValue,
      selectionStart: nextCaret,
      selectionEnd: nextCaret,
      handled: true,
    };
  }

  if (key === "Backspace") {
    let previous = indexes[0] ?? 0;
    for (const index of indexes) {
      if (index >= start) break;
      previous = index;
    }
    return {
      value: normalized,
      selectionStart: previous,
      selectionEnd: previous,
      handled: true,
    };
  }

  if (key === "Delete") {
    const nextCaret = indexes[ordinal + 1] ?? normalized.length;
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
    selectionEnd: clampPosition(selectionEnd, normalized.length),
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

  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

export function parseTimeInput(input: string): TimeParseResult {
  const normalized = normalizeTimeInputValue(input);
  const match = normalized.match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
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
