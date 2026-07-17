import { describe, expect, it } from "vitest";
import {
  applyTimeInputKey,
  formatTimeInput,
  normalizeTimeInputValue,
  normalizeTimeRange,
  parseTimeInput,
  snapTimeInputCaret,
  TIME_INPUT_TEMPLATE,
} from "./timeInput";

describe("formatTimeInput", () => {
  it("formats milliseconds as H:MM:SS.CS with unpadded hours", () => {
    expect(formatTimeInput(0)).toBe("0:00:00.00");
    expect(formatTimeInput(1234)).toBe("0:00:01.23");
    expect(formatTimeInput(3723450)).toBe("1:02:03.45");
    expect(formatTimeInput(10 * 3_600_000)).toBe("10:00:00.00");
  });

  it("clamps negative values to zero and values over 99h to the fixed input maximum", () => {
    expect(formatTimeInput(-100)).toBe("0:00:00.00");
    expect(formatTimeInput(400_000_000)).toBe("99:59:59.99");
  });
});

describe("normalizeTimeInputValue", () => {
  it("fills H:MM:SS.CS slots from digits with unpadded hours", () => {
    expect(normalizeTimeInputValue("01020345")).toBe("1:02:03.45");
    expect(normalizeTimeInputValue("1a2b3")).toBe("12:30:00.00");
    expect(normalizeTimeInputValue("123456789")).toBe("12:34:56.78");
    expect(normalizeTimeInputValue("10000000")).toBe("10:00:00.00");
  });

  it("does not left-shift a single-digit hour in structured H:MM:SS.cc input", () => {
    expect(normalizeTimeInputValue("1:02:03.45")).toBe("1:02:03.45");
    expect(normalizeTimeInputValue("01:02:03.45")).toBe("1:02:03.45");
  });
});

describe("snapTimeInputCaret", () => {
  it("keeps digit positions and moves separators to the nearest digit slot", () => {
    expect(TIME_INPUT_TEMPLATE).toBe("0:00:00.00");
    // 0:00:00.00 → digit indexes 0,2,3,5,6,8,9
    expect(snapTimeInputCaret(0)).toBe(0);
    expect(snapTimeInputCaret(1)).toBe(2);
    expect(snapTimeInputCaret(2)).toBe(2);
    expect(snapTimeInputCaret(4)).toBe(5);
    expect(snapTimeInputCaret(7)).toBe(8);
    expect(snapTimeInputCaret(10)).toBe(10);
  });

  it("snaps against two-digit hour values", () => {
    // 10:00:00.00 → digit indexes 0,1,3,4,6,7,9,10
    expect(snapTimeInputCaret(0, "10:00:00.00")).toBe(0);
    expect(snapTimeInputCaret(2, "10:00:00.00")).toBe(3);
    expect(snapTimeInputCaret(3, "10:00:00.00")).toBe(3);
  });
});

describe("applyTimeInputKey", () => {
  it("replaces the current digit slot and moves to the next digit slot", () => {
    expect(applyTimeInputKey("0:00:00.00", 0, 0, "1")).toEqual({
      value: "1:00:00.00",
      selectionStart: 2,
      selectionEnd: 2,
      handled: true,
    });
    expect(applyTimeInputKey("1:00:00.00", 2, 2, "2")).toEqual({
      value: "1:20:00.00",
      selectionStart: 3,
      selectionEnd: 3,
      handled: true,
    });
  });

  it("edits two-digit hours with overwrite semantics", () => {
    expect(applyTimeInputKey("10:00:00.00", 0, 0, "2")).toEqual({
      value: "20:00:00.00",
      selectionStart: 1,
      selectionEnd: 1,
      handled: true,
    });
    expect(applyTimeInputKey("20:00:00.00", 1, 1, "1")).toEqual({
      value: "21:00:00.00",
      selectionStart: 3,
      selectionEnd: 3,
      handled: true,
    });
    expect(applyTimeInputKey("10:00:00.00", 0, 0, "0")).toEqual({
      value: "0:00:00.00",
      selectionStart: 2,
      selectionEnd: 2,
      handled: true,
    });
  });

  it("skips separators when replacing digits", () => {
    expect(applyTimeInputKey("12:00:00.00", 2, 2, "3")).toEqual({
      value: "12:30:00.00",
      selectionStart: 4,
      selectionEnd: 4,
      handled: true,
    });
  });

  it("Backspace and Delete move the caret without deleting characters", () => {
    expect(applyTimeInputKey("12:00:00.00", 1, 1, "Backspace")).toEqual({
      value: "12:00:00.00",
      selectionStart: 0,
      selectionEnd: 0,
      handled: true,
    });
    expect(applyTimeInputKey("12:00:00.00", 1, 1, "Delete")).toEqual({
      value: "12:00:00.00",
      selectionStart: 3,
      selectionEnd: 3,
      handled: true,
    });
  });

  it("returns handled=false for keys owned by the browser or the caller", () => {
    expect(applyTimeInputKey("12:00:00.00", 1, 1, "ArrowLeft").handled).toBe(false);
    expect(applyTimeInputKey("12:00:00.00", 1, 1, "Enter").handled).toBe(false);
    expect(applyTimeInputKey("12:00:00.00", 1, 1, "a").handled).toBe(false);
  });
});

describe("parseTimeInput", () => {
  it("parses normalized fixed-mask values", () => {
    expect(parseTimeInput("1:02:03.45")).toEqual({
      ok: true,
      valueMs: 3723450,
      normalized: "1:02:03.45",
    });
    expect(parseTimeInput("01:02:03.45")).toEqual({
      ok: true,
      valueMs: 3723450,
      normalized: "1:02:03.45",
    });
  });

  it("normalizes before parsing", () => {
    expect(parseTimeInput("01020345")).toEqual({
      ok: true,
      valueMs: 3723450,
      normalized: "1:02:03.45",
    });
  });

  it("carries over minute and second overflow instead of rejecting", () => {
    expect(parseTimeInput("0:60:00.00")).toEqual({
      ok: true,
      valueMs: 3600000,
      normalized: "1:00:00.00",
    });
    expect(parseTimeInput("0:00:60.00")).toEqual({
      ok: true,
      valueMs: 60000,
      normalized: "0:01:00.00",
    });
  });
});

describe("normalizeTimeRange", () => {
  it("returns parsed milliseconds and normalized text for valid ranges", () => {
    expect(normalizeTimeRange("0:00:01.00", "0:00:02.50")).toEqual({
      startMs: 1000,
      endMs: 2500,
      startText: "0:00:01.00",
      endText: "0:00:02.50",
    });
  });

  it("clamps the changed end time to the start time when end precedes start", () => {
    expect(normalizeTimeRange("0:00:02.00", "0:00:01.00", "end")).toEqual({
      startMs: 2000,
      endMs: 2000,
      startText: "0:00:02.00",
      endText: "0:00:02.00",
    });
  });

  it("clamps the changed start time to the end time when start exceeds end", () => {
    expect(normalizeTimeRange("0:00:02.00", "0:00:01.00", "start")).toEqual({
      startMs: 1000,
      endMs: 1000,
      startText: "0:00:01.00",
      endText: "0:00:01.00",
    });
  });

  it("defaults to treating end as the changed field", () => {
    expect(normalizeTimeRange("0:00:02.00", "0:00:01.00")).toEqual({
      startMs: 2000,
      endMs: 2000,
      startText: "0:00:02.00",
      endText: "0:00:02.00",
    });
  });

  it("carries over overflow fields before comparing", () => {
    expect(normalizeTimeRange("0:60:00.00", "0:00:02.00")).toEqual({
      startMs: 3600000,
      endMs: 3600000,
      startText: "1:00:00.00",
      endText: "1:00:00.00",
    });
  });
});
