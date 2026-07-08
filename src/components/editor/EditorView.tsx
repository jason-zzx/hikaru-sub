import { useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
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
import { Button } from "../ui/button";
import {
  getSettings,
  getVideoInfo,
  loadAssText,
  pathExists,
  pickSaveAssFile,
  pickSubtitleFile,
  saveAssText,
} from "../../services/tauri";
import { serializeAss } from "@hikaru/ass-core";
import { resolveAssDocumentForSave } from "../../utils/assDocument";
import { parseExternalSubtitleDocument } from "../../utils/subtitleImport";
import type { ActiveSubtitleKind, AppSettings } from "../../types";

export function EditorView() {
  const session = useProjectStore((s) => s.session);
  const activeSubtitlePath = useProjectStore((s) => s.activeSubtitlePath);
  const activeSubtitleKind = useProjectStore((s) => s.activeSubtitleKind);
  const cues = useProjectStore((s) => s.cues);
  const assScriptInfo = useProjectStore((s) => s.assScriptInfo);
  const assStyles = useProjectStore((s) => s.assStyles);
  const setAssMetadata = useProjectStore((s) => s.setAssMetadata);
  const setActiveSubtitle = useProjectStore((s) => s.setActiveSubtitle);
  const loadAssDocument = useProjectStore((s) => s.loadAssDocument);
  const isDirty = useProjectStore((s) => s.isDirty);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.canUndo);
  const canRedo = useProjectStore((s) => s.canRedo);
  const markDirty = useProjectStore((s) => s.markDirty);
  const markSaved = useProjectStore((s) => s.markSaved);
  const setStep = useUiStore((s) => s.setStep);
  const styleManagerOpen = useUiStore((s) => s.styleManagerOpen);
  const toggleStyleManager = useUiStore((s) => s.toggleStyleManager);

  const [helpOpen, setHelpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<EditorToastMessage | null>(null);
  const [subtitleFileExists, setSubtitleFileExists] = useState(false);
  const toastIdRef = useRef(0);
  const currentSubtitlePath =
    activeSubtitlePath ??
    (activeSubtitleKind === "translated"
      ? null
      : session?.transcribedAssPath ?? null);
  const needsSaveTarget = activeSubtitleKind === "translated" && !activeSubtitlePath;

  const notify = (variant: EditorToastVariant, text: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, variant, text });
  };

  const saveStatus = saving
    ? { label: "保存中…", className: "border-border text-text-muted" }
    : saveError
      ? { label: "保存失败", className: "border-danger/50 text-danger" }
      : needsSaveTarget
        ? { label: "待保存", className: "border-warning/50 text-warning" }
        : isDirty
          ? { label: "未保存", className: "border-warning/50 text-warning" }
          : { label: "已保存", className: "border-success/50 text-success" };

  useEffect(() => {
    if (!currentSubtitlePath) {
      setSubtitleFileExists(false);
      return;
    }

    let cancelled = false;
    pathExists(currentSubtitlePath)
      .then((exists) => {
        if (!cancelled) setSubtitleFileExists(exists);
      })
      .catch(() => {
        if (!cancelled) setSubtitleFileExists(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentSubtitlePath]);

  const writeSubtitleFile = async (
    savePath: string,
    saveKind: ActiveSubtitleKind,
  ) => {
    const settings: AppSettings = await getSettings();
    const doc = resolveAssDocumentForSave(cues, assScriptInfo, assStyles, {
      title: "Hikaru Sub",
    });
    setAssMetadata(doc.scriptInfo, doc.styles);

    await saveAssText(
      savePath,
      serializeAss(doc, { mergeMode: settings.subtitleMergeMode }),
    );
    setActiveSubtitle(saveKind, savePath);
    setSubtitleFileExists(true);
    markSaved();
    setSaveError(null);
    return savePath;
  };

  const handleSave = async () => {
    if (saving || !session) return;

    setSaving(true);
    setSaveError(null);

    try {
      let savePath = activeSubtitlePath;
      const saveKind: ActiveSubtitleKind = activeSubtitleKind ?? "transcribed";
      if (!savePath) {
        if (saveKind === "translated") {
          savePath = await pickSaveAssFile(session.translatedAssPath);
          if (!savePath) return;
        } else {
          savePath = session.transcribedAssPath;
        }
      }
      await writeSubtitleFile(savePath, saveKind);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
      notify("error", `保存失败：${message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectSubtitleFile = async () => {
    if (!session) return;

    try {
      const subtitlePath = await pickSubtitleFile();
      if (!subtitlePath) return;

      const [subtitleText, videoInfo] = await Promise.all([
        loadAssText(subtitlePath),
        getVideoInfo(session.videoPath),
      ]);
      const doc = parseExternalSubtitleDocument({
        path: subtitlePath,
        text: subtitleText,
        playRes: { width: videoInfo.width, height: videoInfo.height },
      });

      loadAssDocument(doc, { kind: "translated", path: null });
      markDirty();
      setSubtitleFileExists(false);
      setSaveError(null);
      notify("info", "已载入字幕文件，首次保存时请选择保存位置");
    } catch (err) {
      notify("error", `选择字幕文件失败：${String(err)}`);
    }
  };

  const handleRevealSubtitleFile = async () => {
    if (!currentSubtitlePath) return;

    try {
      const exists = await pathExists(currentSubtitlePath);
      setSubtitleFileExists(exists);
      if (!exists) return;
      await revealItemInDir(currentSubtitlePath);
    } catch (err) {
      notify("error", `无法在文件夹中显示：${String(err)}`);
    }
  };

  useEditorHotkeys({
    onSave: handleSave,
    onToggleHelp: () => setHelpOpen((v) => !v),
    onNotify: notify,
    enabled: !helpOpen,
  });

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-text-muted">请先打开视频</p>
          <Button className="mt-4 px-4 py-2" onClick={() => setStep("import")}>
            前往导入
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
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
          <Button
            type="button"
            variant="outline"
            onClick={handleSave}
            disabled={saving || !session}
            className="px-3 py-1.5 text-sm hover:border-accent/50"
            title="保存 (Ctrl+S)"
          >
            {saving ? "保存中…" : "保存"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleSelectSubtitleFile}
            disabled={saving}
            className="px-3 py-1.5 text-sm hover:border-accent/50"
          >
            选择字幕文件
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleRevealSubtitleFile}
            disabled={!subtitleFileExists}
            className="px-3 py-1.5 text-sm hover:border-accent/50"
          >
            在文件夹中显示
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={toggleStyleManager}
            className="px-3 py-1.5 text-sm hover:border-accent/50"
          >
            {styleManagerOpen ? "关闭样式库" : "样式管理"}
          </Button>
        </div>
      </div>

      {/* 主编辑区 */}
      <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr_320px] grid-rows-[minmax(0,1fr)_168px] gap-px overflow-hidden bg-border">
        {/* 字幕列表 */}
        <div className="col-start-1 row-span-2 min-h-0 overflow-hidden bg-surface-raised">
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-3 py-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-text-muted">
                字幕列表 ({cues.length})
              </h3>
            </div>
            <div className="flex-1 overflow-hidden">
              <SubtitleList onNotify={notify} />
            </div>
          </div>
        </div>

        {/* 视频播放器 */}
        <div className="col-start-2 row-start-1 min-h-0 overflow-hidden bg-black">
          <VideoPlayer videoPath={session.videoPath} />
        </div>

        {/* 编辑面板 */}
        <div className="col-start-3 row-span-2 flex min-h-0 flex-col overflow-hidden bg-surface-raised">
          <div className="min-h-0 flex-1">
            <SubtitleEditor onNotify={notify} />
          </div>
        </div>

        {/* 时间轴 */}
        <div className="col-start-2 row-start-2 min-h-0 overflow-hidden bg-surface">
          <Timeline />
        </div>
      </div>

      {/* 播放控制栏 */}
      <PlaybackControls
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
