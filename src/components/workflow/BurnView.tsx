import { type ReactNode, useEffect, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { serializeAss } from "@hikaru/ass-core";
import { useBurnStore } from "../../stores/burnStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useUiStore } from "../../stores/uiStore";
import {
  cancelBurn,
  checkFfmpeg,
  getSettings,
  invalidateFfmpegStatus,
  pickDirectory,
  probeBurnVideo,
  saveAssText,
  startBurnSubtitles,
} from "../../services/tauri";
import { resolveAssDocumentForSave } from "../../utils/assDocument";
import type {
  BurnMode,
  BurnVideoEncoder,
  BurnVideoProbe,
  FfmpegStatus,
} from "../../types";
import { Select } from "../ui/select-adapter";
import { Button } from "../ui/button";
import { useRuntimeDependencyPreparation } from "../../hooks/useRuntimeDependencyPreparation";
import { RuntimeDependencyDialog } from "./RuntimeDependencyDialog";

const INPUT_CLASS =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

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

type BurnExportStrategy = "highQuality" | "nearSource" | "customBitrate";

const DEFAULT_VIDEO_BITRATE_KBPS = 12_000;

const EXPORT_STRATEGY_OPTIONS: Array<{
  value: BurnExportStrategy;
  label: string;
}> = [
  { value: "highQuality", label: "高质量" },
  { value: "nearSource", label: "接近原片" },
  { value: "customBitrate", label: "自定义码率" },
];

const ENCODER_LABELS: Record<BurnVideoEncoder, string> = {
  auto: "自动",
  libX264: "CPU / libx264",
  h264Nvenc: "NVIDIA NVENC",
  h264Qsv: "Intel Quick Sync",
  h264Amf: "AMD AMF",
  h264Videotoolbox: "Apple VideoToolbox",
};

const ENCODER_OPTIONS: BurnVideoEncoder[] = [
  "auto",
  "libX264",
  "h264Nvenc",
  "h264Qsv",
  "h264Amf",
  "h264Videotoolbox",
];

function clampVideoBitrate(kbps: number): number {
  return Math.min(Math.max(Math.round(kbps), 100), 200_000);
}

function nearSourceBitrate(probe: BurnVideoProbe | null): number {
  return clampVideoBitrate(probe?.videoBitrateKbps ?? DEFAULT_VIDEO_BITRATE_KBPS);
}

function highQualityBitrate(probe: BurnVideoProbe | null): number {
  const source = probe?.videoBitrateKbps ?? DEFAULT_VIDEO_BITRATE_KBPS;
  return clampVideoBitrate(Math.max(DEFAULT_VIDEO_BITRATE_KBPS, source * 1.35));
}

function formatBitrate(kbps: number | null | undefined): string {
  return kbps && kbps > 0 ? `${kbps.toLocaleString()} kbps` : "未知";
}

function parseBitrateInput(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 100) return null;
  return clampVideoBitrate(parsed);
}

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
  const session = useProjectStore((s) => s.session);
  const cues = useProjectStore((s) => s.cues);
  const assStyles = useProjectStore((s) => s.assStyles);
  const assScriptInfo = useProjectStore((s) => s.assScriptInfo);
  const isDirty = useProjectStore((s) => s.isDirty);
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
  const ffmpegPreparation = useRuntimeDependencyPreparation("ffmpeg");
  const [mode, setMode] = useState<BurnMode>("hardSubMp4");
  const [outputDir, setOutputDir] = useState("");
  const [exportStrategy, setExportStrategy] =
    useState<BurnExportStrategy>("highQuality");
  const [burnProbe, setBurnProbe] = useState<BurnVideoProbe | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probingBurnVideo, setProbingBurnVideo] = useState(false);
  const [crf, setCrf] = useState(16);
  const [preset, setPreset] = useState("medium");
  const [videoEncoder, setVideoEncoder] = useState<BurnVideoEncoder>("auto");
  const [videoBitrateKbps, setVideoBitrateKbps] = useState(
    String(DEFAULT_VIDEO_BITRATE_KBPS),
  );
  const [fontDir, setFontDir] = useState("");

  const outputFileName = useMemo(() => {
    if (!session) return "";
    return defaultOutputFileName(session.videoPath, mode);
  }, [session, mode]);

  const effectiveVideoBitrateKbps = useMemo(
    () => parseBitrateInput(videoBitrateKbps),
    [videoBitrateKbps],
  );

  const encoderOptions = useMemo(() => {
    const available = new Set(burnProbe?.availableEncoders ?? []);
    return ENCODER_OPTIONS.filter((value) => {
      return (
        value === "auto" ||
        !burnProbe ||
        available.has(value) ||
        value === videoEncoder
      );
    }).map((value) => ({
      value,
      label:
        value === "auto" && burnProbe
          ? `自动（${ENCODER_LABELS[burnProbe.preferredEncoder]}）`
          : ENCODER_LABELS[value],
    }));
  }, [burnProbe, videoEncoder]);

  const applyStrategyPreset = (
    strategy: BurnExportStrategy,
    probeForPreset = burnProbe,
  ) => {
    if (strategy === "customBitrate") return;
    setVideoEncoder("auto");
    setPreset("medium");
    if (strategy === "highQuality") {
      setCrf(16);
      setVideoBitrateKbps(String(highQualityBitrate(probeForPreset)));
      return;
    }
    setCrf(18);
    setVideoBitrateKbps(String(nearSourceBitrate(probeForPreset)));
  };

  const markCustomStrategy = () => {
    setExportStrategy((current) =>
      current === "customBitrate" ? current : "customBitrate",
    );
  };

  const handleStrategyChange = (value: string) => {
    const strategy = value as BurnExportStrategy;
    setExportStrategy(strategy);
    applyStrategyPreset(strategy);
  };

  const refreshFfmpeg = async (force = false) => {
    if (force) invalidateFfmpegStatus();
    const next = await checkFfmpeg({ force });
    setFfmpeg(next);
    return next;
  };

  useEffect(() => {
    refreshFfmpeg().catch(() => setFfmpeg(null));
  }, []);

  useEffect(() => {
    if (!session) return;
    setOutputDir((current) => current || pathDir(session.videoPath));
  }, [session]);

  useEffect(() => {
    setBurnProbe(null);
    setProbeError(null);
    setProbingBurnVideo(false);
  }, [session?.videoPath]);

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
    Boolean(session && session.videoPath && cues.length > 0) &&
    Boolean(outputPath) &&
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

  const handleProbeBurnVideo = async () => {
    if (!session?.videoPath || probingBurnVideo) return;
    const videoPath = session.videoPath;
    setProbingBurnVideo(true);
    setProbeError(null);
    try {
      const probe = await probeBurnVideo(videoPath);
      setBurnProbe(probe);
      setVideoEncoder((current) =>
        current === "auto" || probe.availableEncoders.includes(current)
          ? current
          : "auto",
      );
      if (exportStrategy === "highQuality") {
        setVideoBitrateKbps(String(highQualityBitrate(probe)));
      } else if (exportStrategy === "nearSource") {
        setVideoBitrateKbps(String(nearSourceBitrate(probe)));
      }
    } catch {
      setProbeError("无法探测原片码率，将使用默认推荐值。");
    } finally {
      setProbingBurnVideo(false);
    }
  };

  const runStart = async () => {
    if (!session || !outputPath) return;
    resetForStart();
    upsertTask({
      id: "burn",
      label: "字幕压制",
      status: "running",
      progress: 0,
    });

    try {
      const settings = await getSettings();
      const doc = resolveAssDocumentForSave(cues, assScriptInfo, assStyles, {
        title: "Hikaru Sub",
      });
      const assText = serializeAss(doc, {
        mergeMode: settings.subtitleMergeMode,
      });
      await saveAssText(session.burnAssPath, assText);

      const id = await startBurnSubtitles({
        videoPath: session.videoPath,
        assPath: session.burnAssPath,
        outputPath,
        mode,
        crf: mode === "hardSubMp4" ? crf : null,
        preset: mode === "hardSubMp4" ? preset : null,
        videoEncoder: mode === "hardSubMp4" ? videoEncoder : null,
        videoBitrateKbps:
          mode === "hardSubMp4" ? effectiveVideoBitrateKbps : null,
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

  const handleStart = async () => {
    if (ffmpegMissing) {
      await ffmpegPreparation.requestDependency(async () => {
        const next = await refreshFfmpeg(true);
        if (next.available) await runStart();
      });
      return;
    }
    await runStart();
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
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void ffmpegPreparation.requestDependency(async () => {
                await refreshFfmpeg(true);
              })
            }
            className="shrink-0 border-warning/50 px-3 text-xs font-medium text-warning hover:bg-warning/20"
          >
            准备 FFmpeg
          </Button>
        </div>
      )}

      {!session ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-border bg-surface-raised">
          <p className="text-text-muted">请先打开视频</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <section className="w-full rounded-xl border border-border bg-surface-raised p-4">
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePickOutputDir}
                    className="shrink-0 px-3 text-sm"
                  >
                    选择
                  </Button>
                </div>
              </Field>

              <Field label="输出文件">
                <p className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-muted">
                  {outputFileName || "—"}
                </p>
              </Field>

              {mode === "hardSubMp4" && (
                <>
                  <Field label="导出策略">
                    <Select
                      value={exportStrategy}
                      onChange={handleStrategyChange}
                      disabled={busy}
                      options={EXPORT_STRATEGY_OPTIONS}
                    />
                  </Field>

                  <Field label="视频编码">
                    <Select
                      value={videoEncoder}
                      onChange={(value) => {
                        setVideoEncoder(value as BurnVideoEncoder);
                        markCustomStrategy();
                      }}
                      disabled={busy}
                      options={encoderOptions}
                    />
                  </Field>

                  <Field label="视频码率（kbps）">
                    <input
                      type="number"
                      min={100}
                      max={200000}
                      step={500}
                      value={videoBitrateKbps}
                      onChange={(e) => {
                        setVideoBitrateKbps(e.target.value);
                        markCustomStrategy();
                      }}
                      disabled={busy}
                      className={INPUT_CLASS}
                    />
                  </Field>

                  <Field label="CRF（无视频码率时）">
                    <input
                      type="number"
                      min={0}
                      max={51}
                      value={crf}
                      onChange={(e) => {
                        setCrf(Number(e.target.value));
                        markCustomStrategy();
                      }}
                      disabled={busy}
                      className={INPUT_CLASS}
                    />
                  </Field>

                  <Field label="编码预设">
                    <Select
                      value={preset}
                      onChange={(value) => {
                        setPreset(value);
                        markCustomStrategy();
                      }}
                      disabled={busy}
                      options={HARD_SUB_PRESETS.map((value) => ({
                        value,
                        label: value,
                      }))}
                    />
                  </Field>

                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted">
                    <span>
                      原片码率：{formatBitrate(burnProbe?.videoBitrateKbps)}；自动编码：
                      {burnProbe ? ENCODER_LABELS[burnProbe.preferredEncoder] : "未检测"}。
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleProbeBurnVideo}
                      disabled={busy || probingBurnVideo}
                      className="px-2.5 py-1 text-xs text-text hover:border-accent/50"
                    >
                      {probingBurnVideo ? "检测中…" : "检测原片参数"}
                    </Button>
                  </div>

                  {probeError && (
                    <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                      {probeError}
                    </p>
                  )}

                  <Field label="字体目录（可选）">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={fontDir}
                        onChange={(e) => setFontDir(e.target.value)}
                        placeholder="帮助 libass 找到 ASS 指定字体"
                        className={INPUT_CLASS}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handlePickFontDir}
                        className="shrink-0 px-3 text-sm"
                      >
                        选择
                      </Button>
                    </div>
                  </Field>
                </>
              )}

              {mode === "hardSubMp4" && (
                <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted">
                  硬字幕压制会使用系统字体；如 ASS 指定字体未被 FFmpeg 找到，可在字体目录中补充。
                </p>
              )}

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
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleCancel}
                    className="flex-1 px-4 py-2 text-sm"
                  >
                    取消
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="default"
                    disabled={!canStart}
                    onClick={handleStart}
                    className="flex-1 px-4 py-2 text-sm font-medium"
                  >
                    开始导出
                  </Button>
                )}
                {completedPath && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleReveal}
                    className="px-4 py-2 text-sm"
                  >
                    打开位置
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
      <RuntimeDependencyDialog
        open={ffmpegPreparation.open}
        kind="ffmpeg"
        reason="压制或封装字幕需要 FFmpeg。"
        sizeBytes={ffmpegPreparation.item?.expectedDownloadBytes ?? 0}
        targetPath={ffmpegPreparation.item?.path ?? "安装目录/deps/ffmpeg/current"}
        sourceLabel={ffmpegPreparation.sourceLabel}
        status={
          ffmpegPreparation.snapshot?.status === "running" ||
          ffmpegPreparation.snapshot?.status === "pending"
            ? "running"
            : ffmpegPreparation.snapshot?.status === "completed"
              ? "completed"
              : ffmpegPreparation.snapshot?.status === "failed"
                ? "failed"
                : "idle"
        }
        progressPercent={ffmpegPreparation.progressPercent}
        error={ffmpegPreparation.error}
        onConfirm={ffmpegPreparation.confirmPrepare}
        onCancel={() => ffmpegPreparation.setOpen(false)}
        onChangeSource={() => setStep("settings")}
      />
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
      className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-accent bg-accent text-accent-foreground ring-2 ring-ring/30"
          : "border-border hover:border-accent/50 hover:bg-surface-overlay"
      }`}
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
