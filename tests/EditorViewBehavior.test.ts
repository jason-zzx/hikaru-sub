import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../src/components/editor/EditorView.tsx", import.meta.url),
  ),
  "utf8",
);

describe("EditorView Phase 2B behavior guards", () => {
  it("does not use native alert dialogs for save feedback", () => {
    expect(source).not.toContain("alert(");
  });

  it("owns save status and editor toast feedback", () => {
    expect(source).toContain("saving");
    expect(source).toContain("saveError");
    expect(source).toContain("EditorToast");
    expect(source).toContain("保存中");
    expect(source).toContain("保存失败");
    expect(source).toContain("已保存");
    expect(source).not.toContain("保存成功");
  });

  it("passes notify feedback to editor hotkeys and subtitle editor", () => {
    expect(source).toContain("onNotify: notify");
    expect(source).toContain("<SubtitleEditor onNotify={notify}");
  });
});
