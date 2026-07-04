import { useState } from "react";
import { useEditorHotkeys } from "../../hooks/useEditorHotkeys";
import { useProjectStore } from "../../stores/projectStore";
import { useUiStore } from "../../stores/uiStore";
import { VideoPlayer } from "../player/VideoPlayer";
import { PlaybackControls } from "../player/PlaybackControls";
import { SubtitleList } from "./SubtitleList";
import { SubtitleEditor } from "./SubtitleEditor";
import { Timeline } from "./Timeline";
import { HotkeyHelpOverlay } from "./HotkeyHelpOverlay";
import { StyleManager } from "./StyleManager";
import { getSettings, saveAssText } from "../../services/tauri";
import { serializeAss } from "@hikaru/ass-core";
import { resolveAssDocumentForSave } from "../../utils/assDocument";
import type { AppSettings } from "../../types";

export function EditorView() {
  const project = useProjectStore((s) => s.project);
  const projectDir = useProjectStore((s) => s.projectDir);
  const cues = useProjectStore((s) => s.cues);
  const assScriptInfo = useProjectStore((s) => s.assScriptInfo);
  const assStyles = useProjectStore((s) => s.assStyles);
  const setAssMetadata = useProjectStore((s) => s.setAssMetadata);
  const isDirty = useProjectStore((s) => s.isDirty);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.canUndo);
  const canRedo = useProjectStore((s) => s.canRedo);
  const markSaved = useProjectStore((s) => s.markSaved);
  const setStep = useUiStore((s) => s.setStep);
  const styleManagerOpen = useUiStore((s) => s.styleManagerOpen);
  const toggleStyleManager = useUiStore((s) => s.toggleStyleManager);

  const handleSave = async () => {
    if (!project || !projectDir || cues.length === 0) return;

    try {
      const settings: AppSettings = await getSettings();
      const doc = resolveAssDocumentForSave(cues, assScriptInfo, assStyles);
      setAssMetadata(doc.scriptInfo, doc.styles);

      const hasTranslation = cues.some((c) => c.secondaryText);
      const baseAssPath =
        project.assPath ?? `${projectDir}/.hikaru/subtitles.ass`;
      const assPath = hasTranslation
        ? baseAssPath.replace(/\.ass$/i, ".translated.ass")
        : baseAssPath;

      await saveAssText(
        assPath,
        serializeAss(doc, { mergeMode: settings.subtitleMergeMode }),
      );
      markSaved();
      alert("保存成功！");
    } catch (err) {
      alert(`保存失败：${err}`);
    }
  };

  const [helpOpen, setHelpOpen] = useState(false);

  useEditorHotkeys({
    onSave: handleSave,
    onToggleHelp: () => setHelpOpen((v) => !v),
    enabled: !helpOpen,
  });

  if (!project || !projectDir) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-text-muted">请先导入或打开项目</p>
          <button
            onClick={() => setStep("import")}
            className="mt-4 rounded bg-primary px-4 py-2 text-sm text-white hover:bg-primary-hover"
          >
            前往导入
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 主编辑区 */}
      <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr_320px] grid-rows-[1fr_120px] gap-px bg-border">
        {/* 字幕列表 */}
        <div className="col-start-1 row-span-2 bg-surface-raised">
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-3 py-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-text-muted">
                字幕列表 ({cues.length})
              </h3>
            </div>
            <div className="flex-1 overflow-hidden">
              <SubtitleList />
            </div>
          </div>
        </div>

        {/* 视频播放器 */}
        <div className="col-start-2 row-start-1 bg-black">
          <VideoPlayer videoPath={project.videoPath} />
        </div>

        {/* 编辑面板 */}
        <div className="col-start-3 row-span-2 flex min-h-0 flex-col bg-surface-raised">
          <div className="border-b border-border px-3 py-2">
            <button
              type="button"
              onClick={toggleStyleManager}
              className="w-full rounded border border-border bg-surface px-3 py-1.5 text-sm text-text hover:border-accent/50 hover:bg-surface-overlay"
            >
              {styleManagerOpen ? "关闭样式库" : "样式管理"}
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <SubtitleEditor />
          </div>
        </div>

        {/* 时间轴 */}
        <div className="col-start-2 row-start-2 bg-surface">
          <Timeline />
        </div>
      </div>

      {/* 播放控制栏 */}
      <PlaybackControls
        onSave={handleSave}
        canUndo={canUndo()}
        canRedo={canRedo()}
        onUndo={undo}
        onRedo={redo}
      />

      {/* 未保存提示 */}
      {isDirty && (
        <div className="pointer-events-none fixed bottom-16 right-4 rounded bg-yellow-500/90 px-3 py-1 text-xs text-white shadow-lg">
          未保存
        </div>
      )}

      <StyleManager />

      {/* 键位速查浮层（? 呼出） */}
      <HotkeyHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
