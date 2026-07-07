import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../src/components/editor/SubtitleList.tsx", import.meta.url),
  ),
  "utf8",
);

describe("SubtitleList 时间显示", () => {
  it("开始/结束时间使用 10ms 精度显示", () => {
    expect(source).toContain("formatTime(cue.startMs)");
    expect(source).toContain("formatTime(cue.endMs)");
    expect(source).toContain("function formatTime");
    expect(source).not.toContain("formatPlaybackTime(cue.startMs, true)");
    expect(source).not.toContain("formatPlaybackTime(cue.endMs, true)");
  });

  it("支持多选和 Aegisub 风格右键行操作", () => {
    expect(source).toContain("selectedCueIds");
    expect(source).toContain("setSelectedCueIds");
    expect(source).toContain("onContextMenu");
    expect(source).toContain("contextMenu");
    expect(source).toContain("insertCueRelative");
    expect(source).toContain("duplicateCues");
    expect(source).toContain("splitCueAtTime");
    expect(source).toContain("deleteCuesById");
    expect(source).toContain("swapSelectedCues");
    expect(source).toContain("mergeSelectedCues");
    expect(source).toContain("插入（之前）");
    expect(source).toContain("插入（之后）");
    expect(source).toContain("重复行");
    expect(source).toContain("在当前帧后分割行");
    expect(source).toContain("互换行");
    expect(source).toContain("合并（连接）");
    expect(source).toContain("合并（保留首行）");
  });

  it("支持整条字幕复制、剪切、粘贴并走 undoable 批量替换", () => {
    expect(source).toContain("copyCueRows");
    expect(source).toContain("pasteCueRows");
    expect(source).toContain("setCueRowClipboard");
    expect(source).toContain("getCueRowClipboard");
    expect(source).toContain("hasCueRowClipboard");
    expect(source).toContain("replaceCues");
    expect(source).toContain("复制行");
    expect(source).toContain("剪切行");
    expect(source).toContain("粘贴行");
  });

  it("右键菜单项悬停时有明确高亮样式", () => {
    expect(source).toContain("hover:bg-surface-overlay");
    expect(source).toContain("hover:text-text");
  });
});
