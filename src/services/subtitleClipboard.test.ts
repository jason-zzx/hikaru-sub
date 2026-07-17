import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatDialogueEventLine,
  type SubtitleCue,
} from "@/lib/ass";
import {
  buildPasteFromClipboardText,
  copyCuesToSystemClipboard,
  cutCuesToSystemClipboard,
  pasteCuesFromSystemClipboard,
} from "./subtitleClipboard";

const writeMock = vi.fn();
const readMock = vi.fn();

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (...args: unknown[]) => writeMock(...args),
  readText: (...args: unknown[]) => readMock(...args),
}));

function cue(
  id: string,
  startMs: number,
  endMs: number,
  text = id,
): SubtitleCue {
  return {
    id,
    startMs,
    endMs,
    primaryText: text,
    style: "Primary",
    layer: 0,
  };
}

const CUES = [cue("a", 0, 1000), cue("b", 2000, 3000), cue("c", 5000, 6000)];

beforeEach(() => {
  writeMock.mockReset();
  readMock.mockReset();
  writeMock.mockResolvedValue(undefined);
  readMock.mockResolvedValue("");
});

describe("buildPasteFromClipboardText", () => {
  it("pastes valid ASS lines after the target with fresh ids", () => {
    const text = [CUES[0], CUES[1]].map(formatDialogueEventLine).join("\n");
    const ids = ["a2", "b2"];
    const result = buildPasteFromClipboardText(CUES, text, "b", () =>
      ids.shift()!,
    );

    expect(result?.cues.map((item) => item.id)).toEqual([
      "a",
      "b",
      "a2",
      "b2",
      "c",
    ]);
    expect(result?.cues[2]).toMatchObject({
      startMs: 0,
      endMs: 1000,
      primaryText: "a",
    });
    expect(result?.selectedCueIds).toEqual(["a2", "b2"]);
  });

  it("uses 2s fallback timing for plain-text lines after the selected cue", () => {
    const ids = ["p1", "p2"];
    const result = buildPasteFromClipboardText(
      CUES,
      "hello\nworld",
      "b",
      () => ids.shift()!,
    );

    expect(result?.cues.slice(2, 4)).toMatchObject([
      {
        id: "p1",
        startMs: 3000,
        endMs: 5000,
        primaryText: "hello",
        style: "Primary",
        layer: 0,
      },
      {
        id: "p2",
        startMs: 5000,
        endMs: 7000,
        primaryText: "world",
        style: "Primary",
        layer: 0,
      },
    ]);
  });

  it("keeps mixed ASS and plain-text source order", () => {
    const ids = ["x1", "x2"];
    const result = buildPasteFromClipboardText(
      CUES,
      [
        "Dialogue: 1,0:00:01.00,0:00:02.00,Secondary,,0,0,0,,ASS text",
        "plain line",
      ].join("\n"),
      "a",
      () => ids.shift()!,
    );

    expect(result?.cues.slice(1, 3)).toMatchObject([
      {
        id: "x1",
        layer: 1,
        startMs: 1000,
        endMs: 2000,
        style: "Secondary",
        primaryText: "ASS text",
      },
      {
        id: "x2",
        startMs: 1000,
        endMs: 3000,
        primaryText: "plain line",
        style: "Primary",
      },
    ]);
  });

  it("does not paste plain text without a selected base cue", () => {
    expect(
      buildPasteFromClipboardText(CUES, "only plain", null, () => "n1"),
    ).toBeNull();
  });
});

describe("system clipboard orchestration", () => {
  it("writes ASS text on copy", async () => {
    const result = await copyCuesToSystemClipboard(CUES, ["b", "a"]);
    expect(result).toEqual({ ok: true, count: 2 });
    expect(writeMock).toHaveBeenCalledWith(
      [
        "Dialogue: 0,0:00:00.00,0:00:01.00,Primary,,0,0,0,,a",
        "Dialogue: 0,0:00:02.00,0:00:03.00,Primary,,0,0,0,,b",
      ].join("\n"),
    );
  });

  it("does not delete on cut when clipboard write fails", async () => {
    writeMock.mockRejectedValue(new Error("denied"));
    const result = await cutCuesToSystemClipboard(CUES, ["b"]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("剪切失败");
  });

  it("deletes only after successful cut write", async () => {
    const result = await cutCuesToSystemClipboard(CUES, ["b"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.listResult.cues.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("no-ops paste when clipboard is unreadable", async () => {
    readMock.mockRejectedValue(new Error("no text"));
    const result = await pasteCuesFromSystemClipboard(CUES, "a");
    expect(result).toEqual({ ok: false });
  });
});
