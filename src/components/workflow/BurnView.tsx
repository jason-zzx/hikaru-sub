import { type ReactNode, useEffect, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { serializeAss } from "@hikaru/ass-core";
import { useSubtitleMergeMode } from "../../hooks/useSubtitleMergeMode";
import { useBurnStore } from "../../stores/burnStore";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useUiStore } from "../../stores/uiStore";
import {
  cancelBurn,
  checkFfmpeg,
  getSettings,
  pickDirectory,
  saveAssText,
  startBurnSubtitles,
} from "../../services/tauri";
import { resolveAssDocumentForSave } from "../../utils/assDocument";
import type { BurnMode, FfmpegStatus } from "../../types";
import { AssSubtitleOverlay } from "../player/AssSubtitleOverlay";
import { Select } from "../ui/Select";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent/60";

const HARD_SUB_PRESETS = [
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
];

function formatMs(ms: number): string {
  if (!ms || ms < 0) return "0:00";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function pathDir(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(0, idx) : "";
}

function pathStem(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  return name.replace(/\.[^.]+$/, "") || "output";
}

function defaultOutputFileName(videoPath: string, mode: BurnMode): string {
  const stem = pathStem(videoPath);
  return `${stem}${mode === "hardSubMp4" ? ".burned.mp4" : ".subbed.mkv"}`;
}

export function BurnView() {
  const project = useProjectStore((s) => s.project);
  const projectDir = useProjectStore((s) => s.projectDir);
  const cues = useProjectStore((s) => s.cues);
  const assStyles = useProjectStore((s) => s.assStyles);
  const assScriptInfo = useProjectStore((s) => s.assScriptInfo);
  const isDirty = useProjectStore((s) => s.isDirty);
  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const currentTimeMs = usePlaybackStore((s) => s.currentTimeMs);
  const mergeMode = useSubtitleMergeMode();
  const setStep = useUiStore((s) => s.setStep);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const jobId = useBurnStore((s) => s.jobId);
  const snapshot = useBurnStore((s) => s.snapshot);
  const error = useBurnStore((s) => s.error);
  const busy = useBurnStore((s) => s.busy);
  const completedPath = useBurnStore((s) => s.completedPath);
  const startJob = useBurnStore((s) => s.startJob);
  const setError = useBurnStore((s) => s.setError);
  const resetForStart = useBurnStore((s) => s.resetForStart);
  const clearAfterCancel = useBurnStore((s) => s.clearAfterCancel);

  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [mode, setMode] = useState<BurnMode>("hardSubMp4");
  const [outputDir, setOutputDir] = useState("");
  const [crf, setCrf] = useState(20);
  const [preset, setPreset] = useState("veryfast");
  const [fontDir, setFontDir] = useState("");

  const previewCue = useMemo(() => {
    return (
      cues.find((cue) => cue.id === selectedCueId) ??
      cues.find(
        (cue) => currentTimeMs >= cue.startMs && currentTimeMs <= cue.endMs,
      ) ??
      cues[0] ??
      null
    );
  }, [cues, currentTimeMs, selectedCueId]);

  const previewAspectRatio =
    assScriptInfo && assScriptInfo.playResX > 0 && assScriptInfo.playResY > 0
      ? `${assScriptInfo.playResX} / ${assScriptInfo.playResY}`
      : "16 / 9";

  const outputFileName = useMemo(() => {
    if (!project) return "";
    return defaultOutputFileName(project.videoPath, mode);
  }, [project, mode]);

  useEffect(() => {
    checkFfmpeg()
      .then(setFfmpeg)
      .catch(() => setFfmpeg(null));
  }, []);

  useEffect(() => {
    if (!project) return;
    setOutputDir((current) => current || pathDir(project.videoPath));
  }, [project]);

  const ffmpegMissing = ffmpeg !== null && !ffmpeg.available;
  const outputPath =
    outputDir.trim() && outputFileName
      ? `${outputDir.replace(/[\\/]+$/, "")}/${outputFileName}`
      : "";
  const progressPercent =
    snapshot?.progress !== null && snapshot?.progress !== undefined
      ? Math.round(snapshot.progress * 100)
      : null;
  const canStart =
    Boolean(project && projectDir && project.videoPath && cues.length > 0) &&
    Boolean(outputPath) &&
    !ffmpegMissing &&
    !busy;

  const handlePickOutputDir = async () => {
    try {
      const dir = await pickDirectory();
      if (dir) setOutputDir(dir);
    } catch (e) {
      setError(`无法选择目录：${String(e)}`);
    }
  };

  const handlePickFontDir = async () => {
    try {
      const dir = await pickDirectory();
      if (dir) setFontDir(dir);
    } catch (e) {
      setError(`无法选择字体目录：${String(e)}`);
    }
  };

  const handleStart = async () => {
    if (!project || !projectDir || !outputPath) return;
    resetForStart();
    upsertTask({
      id: "burn",
      label: "字幕压制",
      status: "running",
      progress: 0,
    });

    try {
      const settings = await getSettings();
      const doc = resolveAssDocumentForSave(cues, assScriptInfo, assStyles);
      const assText = serializeAss(doc, {
        mergeMode: settings.subtitleMergeMode,
      });
      const burnAssPath = `${projectDir}/burn.input.ass`;
      await saveAssText(burnAssPath, assText);

      const id = await startBurnSubtitles({
        videoPath: project.videoPath,
        assPath: burnAssPath,
        outputPath,
        mode,
        crf: mode === "hardSubMp4" ? crf : null,
        preset: mode === "hardSubMp4" ? preset : null,
        fontDir:
          mode === "hardSubMp4" && fontDir.trim() ? fontDir.trim() : null,
      });
      startJob(id);
    } catch (e) {
      setError(String(e));
      clearAfterCancel();
      updateTask("burn", { status: "error" });
    }
  };

  const handleCancel = async () => {
    if (!jobId) return;
    try {
      await cancelBurn(jobId);
    } catch (e) {
      setError(String(e));
      clearAfterCancel();
      updateTask("burn", { status: "idle" });
    }
  };

  const handleReveal = async () => {
    if (!completedPath) return;
    try {
      await revealItemInDir(completedPath);
    } catch (e) {
      setError(`无法打开文件夹：${String(e)}`);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
      <header>
        <h2 className="text-xl font-semibold">字幕压制</h2>
        <p className="mt-1 text-sm text-text-muted">
          使用 FFmpeg 将字幕硬压或软封到视频
        </p>
      </header>

      {ffmpegMissing && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span className="text-warning">未检测到 FFmpeg，无法压制视频。</span>
          <button
            type="button"
            onClick={() => setStep("settings")}
            className="shrink-0 rounded-md border border-warning/50 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20"
          >
            前往设置
          </button>
        </div>
      )}

      {!project ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-border bg-surface-raised">
          <p className="text-text-muted">请先导入或打开项目</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-xl border border-border bg-surface-raised p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium">字幕样式预览</h3>
              <span className="text-xs text-text-muted">
                {mergeMode === "inline" ? "行内拼接" : "分离双行"}
              </span>
            </div>

            <div
              className="relative w-full overflow-hidden rounded-lg bg-black"
              style={{ aspectRatio: previewAspectRatio }}
            >
              {previewCue ? (
                <AssSubtitleOverlay
                  cue={previewCue}
                  styles={assStyles}
                  scriptInfo={assScriptInfo}
                  mergeMode={mergeMode}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-text-muted">
                  暂无字幕可预览
                </div>
              )}
            </div>

            <p className="mt-3 text-xs text-text-muted">
              预览为 CSS 近似效果；最终硬字幕由 FFmpeg/libass 渲染，细节可能略有差异。
            </p>
          </section>

          <aside className="rounded-xl border border-border bg-surface-raised p-4">
            <h3 className="text-sm font-medium">导出设置</h3>

            <div className="mt-4 space-y-4">
              <Field label="输出模式">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <ModeButton
                    active={mode === "hardSubMp4"}
                    onClick={() => setMode("hardSubMp4")}
                    label="硬字幕 MP4"
                    desc="字幕渲染进画面"
                    disabled={busy}
                  />
                  <ModeButton
                    active={mode === "softSubMkv"}
                    onClick={() => setMode("softSubMkv")}
                    label="软字幕 MKV"
                    desc="保留 ASS 字幕轨"
                    disabled={busy}
                  />
                </div>
              </Field>

              <Field label="输出目录">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={outputDir}
                    onChange={(e) => setOutputDir(e.target.value)}
                    className={INPUT_CLASS}
                  />
                  <button
                    type="button"
                    onClick={handlePickOutputDir}
                    className="shrink-0 rounded-lg border border-border px-3 text-sm hover:bg-surface"
                  >
                    选择
                  </button>
                </div>
              </Field>

              <Field label="输出文件">
                <p className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-muted">
                  {outputFileName || "—"}
                </p>
              </Field>

              {mode === "hardSubMp4" && (
                <>
                  <Field label="CRF">
                    <input
                      type="number"
                      min={0}
                      max={51}
                      value={crf}
                      onChange={(e) => setCrf(Number(e.target.value))}
                      className={INPUT_CLASS}
                    />
                  </Field>

                  <Field label="编码预设">
                    <Select
                      value={preset}
                      onChange={setPreset}
                      disabled={busy}
                      options={HARD_SUB_PRESETS.map((value) => ({
                        value,
                        label: value,
                      }))}
                    />
                  </Field>

                  <Field label="字体目录（可选）">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={fontDir}
                        onChange={(e) => setFontDir(e.target.value)}
                        placeholder="帮助 libass 找到 ASS 指定字体"
                        className={INPUT_CLASS}
                      />
                      <button
                        type="button"
                        onClick={handlePickFontDir}
                        className="shrink-0 rounded-lg border border-border px-3 text-sm hover:bg-surface"
                      >
                        选择
                      </button>
                    </div>
                  </Field>
                </>
              )}

              <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted">
                预览与压制都会优先使用 ASS 指定字体；字体缺失时浏览器和 libass
                会各自回退，结果可能不完全一致。
              </p>

              {busy && (
                <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted">
                  压制在后台进行，可切换到其他页面；底部状态栏会显示进度。
                </p>
              )}

              {isDirty && (
                <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  当前有未保存编辑；压制会使用当前界面中的最新字幕。
                </p>
              )}

              {error && (
                <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}

              {snapshot && (
                <div className="space-y-2">
                  <div className="h-2 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full bg-accent transition-all"
                      style={{ width: `${progressPercent ?? 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-text-muted">
                    {progressPercent !== null ? `${progressPercent}%` : "准备中"}
                    {snapshot.durationMs > 0
                      ? ` · ${formatMs(snapshot.processedMs)} / ${formatMs(snapshot.durationMs)}`
                      : ""}
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                {busy ? (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 rounded-lg border border-danger/40 px-4 py-2 text-sm text-danger hover:bg-danger/10"
                  >
                    取消
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!canStart}
                    onClick={handleStart}
                    className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    开始导出
                  </button>
                )}
                {completedPath && (
                  <button
                    type="button"
                    onClick={handleReveal}
                    className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface"
                  >
                    打开位置
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  desc,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2 text-left transition ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-surface text-text hover:border-accent/50"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="mt-1 block text-xs text-text-muted">{desc}</span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
