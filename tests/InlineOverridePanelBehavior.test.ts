import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../src/components/editor/InlineOverridePanel.tsx", import.meta.url),
  ),
  "utf8",
);

describe("InlineOverridePanel behavior", () => {
  it("exposes Phase 3 supported inline override controls with Chinese labels", () => {
    expect(source).toContain("更多标签");
    expect(source).toContain("文字");
    expect(source).toContain("描边");
    expect(source).toContain("阴影");
    expect(source).toContain("描边粗细");
    expect(source).toContain("阴影距离");
    expect(source).toContain("对齐");
    expect(source).toContain("ALIGNMENT_VALUES");
    expect(source).toContain("onApplyAlignment");
    expect(source).toContain("effectiveAlignment");
  });

  it("does not expose manual newline, hard-space, reset, or alpha buttons", () => {
    expect(source).not.toContain("\\\\N");
    expect(source).not.toContain("\\\\h");
    expect(source).not.toContain("\\\\r");
    expect(source).not.toContain("\\\\alpha");
  });

  it("commits numeric controls through blur only on Enter", () => {
    const numericCommitCalls =
      source.match(/commitNumber\("(outline|shadow)", (outlineDraft|shadowDraft)\)/g) ??
      [];

    expect(numericCommitCalls).toHaveLength(2);
    expect(source).toContain("event.currentTarget.blur()");
  });
});
