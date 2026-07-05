import { useRef, useState } from "react";
import { useEditorHotkeys } from "../../hooks/useEditorHotkeys";
import { useProjectStore } from "../../stores/projectStore";
import { useUiStore } from "../../stores/uiStore";
import { VideoPlayer } from "../player/VideoPlayer";
import { PlaybackControls } from "../player/PlaybackControls";
import { SubtitleList } from "./SubtitleList";
import { SubtitleEditor } from "./SubtitleEditor";
import { EditorToast, type EditorToastMessage, type EditorToastVariant } from "./EditorToast";
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

  const [helpOpen, setHelpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<EditorToastMessage | null>(null);
  const toastIdRef = useRef(0);

  const notify = (variant: EditorToastVariant, text: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, variant, text });
  };

  const saveStatus = saving
    ? { label: "保存中…", className: "border-border text-text-muted" }
    : saveError
      ? { label: "保存失败", className: "border-danger/50 text-danger" }
      : isDirty
        ? { label: "未保存", className: "border-warning/50 text-warning" }
        : { label: "已保存", className: "border-success/50 text-success" };

  const handleSave = async () => {
    if (saving || !project || !projectDir || cues.length === 0) return;

    setSaving(true);
    setSaveError(null);

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
      setSaveError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
      notify("error", `保存失败：${message}`);
    } finally {
      setSaving(false);
    }
  };

  useEditorHotkeys({
    onSave: handleSave,
    onToggleHelp: () => setHelpOpen((v) => !v),
    onNotify: notify,
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
      {/* 顶部保存状态与编辑页工具条 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-surface-raised px-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-text">字幕编辑</h2>
          <span className="text-xs text-text-muted">{cues.length} 条字幕</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded border px-2 py-1 text-xs ${saveStatus.className}`}
            title={saveError ? `保存失败：${saveError}` : undefined}
          >
            {saveStatus.label}
          </span>
          <button
            type="button"
            onClick={toggleStyleManager}
            className="rounded border border-border bg-surface px-3 py-1.5 text-sm text-text hover:border-accent/50 hover:bg-surface-overlay"
          >
            {styleManagerOpen ? "关闭样式库" : "样式管理"}
          </button>
        </div>
      </div>

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
          <div className="min-h-0 flex-1">
            <SubtitleEditor onNotify={notify} />
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

      {/* 编辑页局部反馈 */}
      <EditorToast message={toast} onClose={() => setToast(null)} />

      <StyleManager />

      {/* 键位速查浮层（? 呼出） */}
      <HotkeyHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
