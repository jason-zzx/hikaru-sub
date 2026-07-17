import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEditorHotkeys } from "../../hooks/useEditorHotkeys";
import { selectCueAndSeek } from "../../services/editorActions";
import { useProjectStore } from "../../stores/projectStore";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useUiStore } from "../../stores/uiStore";
import { VideoPlayer } from "../player/VideoPlayer";
import { PlaybackControls } from "../player/PlaybackControls";
import { SubtitleList } from "./SubtitleList";
import {
  SubtitleEditor,
  type SubtitleEditorHistoryHandle,
} from "./SubtitleEditor";
import { EditorToast, type EditorToastMessage, type EditorToastVariant } from "./EditorToast";
import { Timeline } from "./Timeline";
import { HotkeyHelpOverlay } from "./HotkeyHelpOverlay";
import { StyleManager } from "./StyleManager";
import { Button } from "../ui/button";
import {
  getVideoInfo,
  loadAssText,
  pathExists,
  pickSaveAssFile,
  pickSubtitleFile,
  saveAssText,
} from "../../services/tauri";
import { serializeAss } from "@/lib/ass";
import { resolveAssDocumentForSave } from "../../utils/assDocument";
import { parseExternalSubtitleDocument } from "../../utils/subtitleImport";
import type { ActiveSubtitleKind } from "../../types";
import {
  DEFAULT_EDITOR_PANE_LAYOUT,
  EDITOR_LEFT_PANE_MIN_PX,
  EDITOR_LIST_PANE_MIN_PX,
  EDITOR_PANE_SEPARATOR_SIZE_PX,
  EDITOR_RIGHT_PANE_MIN_PX,
  EDITOR_SUBTITLE_PANE_MIN_PX,
  constrainPanePercent,
  readEditorPaneLayout,
  writeEditorPaneLayout,
  type EditorPaneLayout,
} from "./editorPaneLayout";

type EditorPaneBoundary = "vertical" | "horizontal";

interface EditorPaneDrag {
  boundary: EditorPaneBoundary;
  pointerId: number;
}

export function EditorView() {
  const session = useProjectStore((s) => s.session);
  const activeSubtitlePath = useProjectStore((s) => s.activeSubtitlePath);
  const activeSubtitleKind = useProjectStore((s) => s.activeSubtitleKind);
  const cues = useProjectStore((s) => s.cues);
  const isDirty = useProjectStore((s) => s.isDirty);
  // Subscribe to stack lengths so undo/redo buttons re-render.
  const pastLen = useProjectStore((s) => s.history.past.length);
  const futureLen = useProjectStore((s) => s.history.future.length);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const markDirty = useProjectStore((s) => s.markDirty);
  const markSaved = useProjectStore((s) => s.markSaved);
  const captureSaveSnapshot = useProjectStore((s) => s.captureSaveSnapshot);
  const setAssMetadata = useProjectStore((s) => s.setAssMetadata);
  const setActiveSubtitle = useProjectStore((s) => s.setActiveSubtitle);
  const loadAssDocument = useProjectStore((s) => s.loadAssDocument);
  const acceptTextSession = useProjectStore((s) => s.acceptTextSession);
  const setStep = useUiStore((s) => s.setStep);
  const styleManagerOpen = useUiStore((s) => s.styleManagerOpen);
  const toggleStyleManager = useUiStore((s) => s.toggleStyleManager);

  const [helpOpen, setHelpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<EditorToastMessage | null>(null);
  const [subtitleFileExists, setSubtitleFileExists] = useState(false);
  const [hasPendingTimeDraft, setHasPendingTimeDraft] = useState(false);
  const toastIdRef = useRef(0);
  const editorRef = useRef<SubtitleEditorHistoryHandle>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const paneDragRef = useRef<EditorPaneDrag | null>(null);
  const [preferredPaneLayout, setPreferredPaneLayout] =
    useState<EditorPaneLayout>(() => readEditorPaneLayout());
  const preferredPaneLayoutRef = useRef(preferredPaneLayout);
  const [draggingBoundary, setDraggingBoundary] =
    useState<EditorPaneBoundary | null>(null);

  const currentSubtitlePath =
    activeSubtitlePath ??
    (activeSubtitleKind === "translated"
      ? null
      : session?.transcribedAssPath ?? null);
  const needsSaveTarget = activeSubtitleKind === "translated" && !activeSubtitlePath;

  const applyPreferredPaneLayout = useCallback((layout: EditorPaneLayout) => {
    preferredPaneLayoutRef.current = layout;
    setPreferredPaneLayout(layout);
  }, []);

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

  // 进入编辑页时强制选中第一条并 seek（空列表跳过）
  useEffect(() => {
    const { cues } = useProjectStore.getState();
    if (cues.length > 0) {
      selectCueAndSeek(cues[0]);
    }
  }, []);

  // Accept text session/group whenever the active cue changes.
  useEffect(() => {
    let prev = usePlaybackStore.getState().selectedCueId;
    return usePlaybackStore.subscribe((state) => {
      if (state.selectedCueId !== prev) {
        prev = state.selectedCueId;
        acceptTextSession();
      }
    });
  }, [acceptTextSession]);

  const runUndo = useCallback(() => {
    editorRef.current?.commitPendingTimeDraft();
    undo();
  }, [undo]);

  const runRedo = useCallback(() => {
    if (hasPendingTimeDraft) return;
    redo();
  }, [hasPendingTimeDraft, redo]);

  const canUndo = pastLen > 0 || hasPendingTimeDraft;
  const canRedo = futureLen > 0 && !hasPendingTimeDraft;

  const handleSave = async () => {
    if (saving || !session) return;

    setSaving(true);
    setSaveError(null);

    try {
      let savePath = activeSubtitlePath;
      const saveKind: ActiveSubtitleKind = activeSubtitleKind ?? "transcribed";
      // Path selection first — cancel leaves drafts untouched.
      if (!savePath) {
        if (saveKind === "translated") {
          savePath = await pickSaveAssFile(session.translatedAssPath);
          if (!savePath) return;
        } else {
          savePath = session.transcribedAssPath;
        }
      }

      // After a path exists: flush time draft, resolve metadata, capture snapshot.
      editorRef.current?.commitPendingTimeDraft();
      const live = useProjectStore.getState();
      const doc = resolveAssDocumentForSave(
        live.cues,
        live.assScriptInfo,
        live.assStyles,
        { title: "Hikaru Sub" },
      );
      setAssMetadata(doc.scriptInfo, doc.styles);
      const snap = captureSaveSnapshot();
      const assText = serializeAss(
        {
          scriptInfo: snap.scriptInfo ?? doc.scriptInfo,
          styles: snap.styles.length > 0 ? snap.styles : doc.styles,
          cues: snap.cues,
        },
        { preserveOrder: true },
      );

      await saveAssText(savePath, assText);
      setActiveSubtitle(saveKind, savePath);
      setSubtitleFileExists(true);
      markSaved(snap.token);
      setSaveError(null);
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
      if (doc.cues.length > 0) {
        selectCueAndSeek(doc.cues[0]);
      }
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

  const startPaneDrag = (
    boundary: EditorPaneBoundary,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    paneDragRef.current = { boundary, pointerId: event.pointerId };
    setDraggingBoundary(boundary);
  };

  const movePaneBoundary = (
    boundary: EditorPaneBoundary,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const drag = paneDragRef.current;
    const workspace = workspaceRef.current;
    if (
      !drag ||
      drag.boundary !== boundary ||
      drag.pointerId !== event.pointerId ||
      !workspace
    ) {
      return;
    }

    const rect = workspace.getBoundingClientRect();
    const current = preferredPaneLayoutRef.current;
    if (boundary === "vertical") {
      const availableWidth = rect.width - EDITOR_PANE_SEPARATOR_SIZE_PX;
      if (availableWidth <= 0) return;
      const desiredPercent =
        ((event.clientX - rect.left - EDITOR_PANE_SEPARATOR_SIZE_PX / 2) /
          availableWidth) *
        100;
      applyPreferredPaneLayout({
        ...current,
        leftPercent: constrainPanePercent(
          desiredPercent,
          rect.width,
          EDITOR_LEFT_PANE_MIN_PX,
          EDITOR_RIGHT_PANE_MIN_PX,
        ),
      });
      return;
    }

    const availableHeight = rect.height - EDITOR_PANE_SEPARATOR_SIZE_PX;
    if (availableHeight <= 0) return;
    const desiredPercent =
      ((event.clientY - rect.top - EDITOR_PANE_SEPARATOR_SIZE_PX / 2) /
        availableHeight) *
      100;
    applyPreferredPaneLayout({
      ...current,
      listPercent: constrainPanePercent(
        desiredPercent,
        rect.height,
        EDITOR_LIST_PANE_MIN_PX,
        EDITOR_SUBTITLE_PANE_MIN_PX,
      ),
    });
  };

  const finishPaneDrag = (
    boundary: EditorPaneBoundary,
    event: ReactPointerEvent<HTMLDivElement>,
    persist: boolean,
  ) => {
    const drag = paneDragRef.current;
    if (
      !drag ||
      drag.boundary !== boundary ||
      drag.pointerId !== event.pointerId
    ) {
      return;
    }

    paneDragRef.current = null;
    setDraggingBoundary(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (persist) writeEditorPaneLayout(preferredPaneLayoutRef.current);
  };

  const resetPaneLayout = () => {
    const defaults = { ...DEFAULT_EDITOR_PANE_LAYOUT };
    applyPreferredPaneLayout(defaults);
    writeEditorPaneLayout(defaults);
  };

  useEditorHotkeys({
    onSave: handleSave,
    onToggleHelp: () => setHelpOpen((v) => !v),
    onUndo: runUndo,
    onRedo: runRedo,
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

      {/* 主编辑区：左视频+时间轴 / 右列表+编辑器 */}
      <div
        ref={workspaceRef}
        className="grid min-h-0 flex-1 overflow-hidden bg-border"
        style={{
          gridTemplateColumns: `minmax(${EDITOR_LEFT_PANE_MIN_PX}px, ${preferredPaneLayout.leftPercent}fr) ${EDITOR_PANE_SEPARATOR_SIZE_PX}px minmax(${EDITOR_RIGHT_PANE_MIN_PX}px, ${100 - preferredPaneLayout.leftPercent}fr)`,
        }}
      >
        {/* 左侧：视频 + 时间轴 */}
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_226px] gap-px overflow-hidden bg-border">
          <div className="min-h-0 overflow-hidden bg-muted">
            <VideoPlayer videoPath={session.videoPath} />
          </div>
          <div className="min-h-0 overflow-hidden bg-surface">
            <Timeline />
          </div>
        </div>

        <div
          role="separator"
          aria-label="调整视频与字幕区域宽度，双击恢复默认布局"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(preferredPaneLayout.leftPercent)}
          title="拖动调整宽度；双击恢复默认布局"
          onPointerDown={(event) => startPaneDrag("vertical", event)}
          onPointerMove={(event) => movePaneBoundary("vertical", event)}
          onPointerUp={(event) => finishPaneDrag("vertical", event, true)}
          onPointerCancel={(event) =>
            finishPaneDrag("vertical", event, false)
          }
          onLostPointerCapture={(event) =>
            finishPaneDrag("vertical", event, false)
          }
          onDoubleClick={resetPaneLayout}
          className={`group relative z-10 flex cursor-col-resize touch-none select-none justify-center bg-surface-raised transition-colors hover:bg-accent/10 ${draggingBoundary === "vertical" ? "bg-accent/10" : ""}`}
        >
          <span
            aria-hidden="true"
            className={`w-px transition-colors ${draggingBoundary === "vertical" ? "bg-accent" : "bg-border group-hover:bg-accent"}`}
          />
        </div>

        {/* 右侧：字幕列表 + 编辑面板 */}
        <div
          className="grid min-h-0 overflow-hidden"
          style={{
            gridTemplateRows: `minmax(${EDITOR_LIST_PANE_MIN_PX}px, ${preferredPaneLayout.listPercent}fr) ${EDITOR_PANE_SEPARATOR_SIZE_PX}px minmax(${EDITOR_SUBTITLE_PANE_MIN_PX}px, ${100 - preferredPaneLayout.listPercent}fr)`,
          }}
        >
          <div className="min-h-0 overflow-hidden bg-surface-raised">
            <div className="flex h-full flex-col">
              <div className="shrink-0 border-b border-border px-3 py-2">
                <h3 className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  字幕列表 ({cues.length})
                </h3>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <SubtitleList onNotify={notify} />
              </div>
            </div>
          </div>

          <div
            role="separator"
            aria-label="调整字幕列表与字幕编辑区域高度，双击恢复默认布局"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(preferredPaneLayout.listPercent)}
            title="拖动调整高度；双击恢复默认布局"
            onPointerDown={(event) => startPaneDrag("horizontal", event)}
            onPointerMove={(event) => movePaneBoundary("horizontal", event)}
            onPointerUp={(event) => finishPaneDrag("horizontal", event, true)}
            onPointerCancel={(event) =>
              finishPaneDrag("horizontal", event, false)
            }
            onLostPointerCapture={(event) =>
              finishPaneDrag("horizontal", event, false)
            }
            onDoubleClick={resetPaneLayout}
            className={`group relative z-10 flex cursor-row-resize touch-none select-none items-center bg-surface-raised transition-colors hover:bg-accent/10 ${draggingBoundary === "horizontal" ? "bg-accent/10" : ""}`}
          >
            <span
              aria-hidden="true"
              className={`h-px w-full transition-colors ${draggingBoundary === "horizontal" ? "bg-accent" : "bg-border group-hover:bg-accent"}`}
            />
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden bg-surface-raised">
            <SubtitleEditor
              ref={editorRef}
              onNotify={notify}
              onPendingTimeDraftChange={setHasPendingTimeDraft}
            />
          </div>
        </div>
      </div>

      {/* 播放控制栏 */}
      <PlaybackControls
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={runUndo}
        onRedo={runRedo}
      />

      {/* 编辑页局部反馈 */}
      <EditorToast message={toast} onClose={() => setToast(null)} />

      <StyleManager />

      {/* 键位速查浮层（? 呼出） */}
      <HotkeyHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
