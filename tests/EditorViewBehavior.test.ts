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
    expect(source).toContain("<SubtitleList onNotify={notify}");
    expect(source).toContain("<SubtitleEditor onNotify={notify}");
  });

  it("isolates scrollable timeline content from resizing the editor grid", () => {
    expect(source).toContain("grid-rows-[minmax(0,1fr)_168px]");
    expect(source).toContain("overflow-hidden");
    expect(source).toContain("col-start-2 row-start-1 min-h-0 overflow-hidden bg-black");
    expect(source).toContain("col-start-2 row-start-2 min-h-0 overflow-hidden bg-surface");
  });

  it("saves back to the active visible subtitle file", () => {
    const oldHiddenSubtitlePath = "/.hi" + "karu/sub" + "titles.ass";
    const oldProjectAssPath = "project." + "assPath";

    expect(source).toContain("activeSubtitlePath");
    expect(source).toContain("let savePath = activeSubtitlePath");
    expect(source).toContain('const saveKind: ActiveSubtitleKind = activeSubtitleKind ?? "transcribed"');
    expect(source).toContain("pickSaveAssFile(session.translatedAssPath)");
    expect(source).toContain("savePath = session.transcribedAssPath");
    expect(source).not.toContain(oldProjectAssPath);
    expect(source).not.toContain(oldHiddenSubtitlePath);
  });

  it("opens or reveals visible subtitle files without falling back to hidden project files", () => {
    expect(source).toContain("handleSelectSubtitleFile");
    expect(source).toContain("pickSubtitleFile()");
    expect(source).toContain("parseExternalSubtitleDocument");
    expect(source).toContain('loadAssDocument(doc, { kind: "translated", path: null })');
    expect(source).toContain("pickSaveAssFile(session.translatedAssPath)");
    expect(source).toContain("pathExists(currentSubtitlePath)");
    expect(source).toContain("revealItemInDir(currentSubtitlePath)");
    expect(source).toContain("disabled={!subtitleFileExists}");
    expect(source).toContain("选择字幕文件");
    expect(source).not.toContain("打开字幕文件");
  });
});
