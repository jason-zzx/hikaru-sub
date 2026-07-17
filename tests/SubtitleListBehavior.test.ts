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
  it("开始/结束时间使用 ASS H:MM:SS.cc（10ms）并紧凑列宽", () => {
    expect(source).toContain("formatAssTime(cue.startMs)");
    expect(source).toContain("formatAssTime(cue.endMs)");
    expect(source).not.toContain("formatPlaybackTime(cue.startMs, true)");
    expect(source).not.toContain("formatPlaybackTime(cue.endMs, true)");
  });

  it("以对齐列显示样式名，缺失样式时高亮警告", () => {
    expect(source).toContain("assStyles");
    expect(source).toContain("cue.style");
    expect(source).toContain("knownStyleNames");
    expect(source).toContain("styleMissing");
    expect(source).toContain("text-warning");
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

  it("Shift/Ctrl 多选时禁止浏览器原生文字选中", () => {
    expect(source).toContain("select-none");
    expect(source).toContain("event.preventDefault()");
    expect(source).toMatch(/if \(event\.shiftKey\)[\s\S]*?event\.preventDefault\(\)/);
    expect(source).toMatch(
      /else if \(event\.ctrlKey \|\| event\.metaKey\)[\s\S]*?event\.preventDefault\(\)/,
    );
  });

  it("支持整条字幕复制、剪切、粘贴并走 undoable 批量替换", () => {
    expect(source).toContain("copyCuesToSystemClipboard");
    expect(source).toContain("cutCuesToSystemClipboard");
    expect(source).toContain("pasteCuesFromSystemClipboard");
    expect(source).toContain("replaceCues");
    expect(source).toContain("复制行");
    expect(source).toContain("剪切行");
    expect(source).toContain("粘贴行");
    expect(source).not.toContain("hasCueRowClipboard");
    expect(source).not.toContain("useSubtitleMergeMode");
  });

  it("右键菜单项悬停时有明确高亮样式", () => {
    expect(source).toContain("hover:bg-surface-overlay");
    expect(source).toContain("hover:text-text");
  });
});
