import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../src/components/editor/SubtitleEditor.tsx", import.meta.url),
  ),
  "utf8",
);

describe("SubtitleEditor 快捷键行为约束", () => {
  it("IME 组词保护：Enter 处理前检查 isComposing", () => {
    expect(source).toContain("isComposing");
  });

  it("Esc 放弃草稿：blur 前置守卫避免 onBlur 重复提交", () => {
    expect(source).toContain("escapingRef");
  });

  it("Enter 提交后走 nextAfterCommit 决定去向（含最后一条追加）", () => {
    expect(source).toContain("nextAfterCommit");
    expect(source).toContain("appendCueAfter");
  });

  it("文本草稿仅随 id/store 文本变化重置；时间字段跟随 store 值", () => {
    expect(source).toContain("selectedCue?.id");
    expect(source).toContain("selectedCue?.startMs");
    expect(source).toContain("selectedCue?.endMs");
  });

  it("响应 Insert 新建后的聚焦请求", () => {
    expect(source).toContain("editorFocusNonce");
  });

  it("删除按钮不再使用原生 confirm，删除可通过撤销恢复", () => {
    expect(source).not.toContain("confirm(");
    expect(source).toContain("selectCueAfterDelete");
  });

  it("时间输入使用 Aegisub 式固定掩码工具", () => {
    expect(source).toContain("applyTimeInputKey");
    expect(source).toContain("snapTimeInputCaret");
    expect(source).toContain("normalizeTimeRange");
  });

  it("新建与追加字幕使用唯一 id 包装", () => {
    expect(source).toContain("createCueAtPlayheadWithUniqueId");
    expect(source).toContain("appendCueAfterWithUniqueId");
  });
});
