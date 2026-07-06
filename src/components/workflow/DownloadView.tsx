import { type ReactNode, useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import {
  cancelVideoDownload,
  checkFfmpeg,
  createProject,
  getVideoDownloadProgress,
  invalidateFfmpegStatus,
  pickDirectory,
  projectDirFromMeta,
  startVideoDownload,
} from "../../services/tauri";
import type {
  DownloadMode,
  DownloadSnapshot,
  FfmpegStatus,
} from "../../types";
import { useRuntimeDependencyPreparation } from "../../hooks/useRuntimeDependencyPreparation";
import { RuntimeDependencyDialog } from "./RuntimeDependencyDialog";

const POLL_INTERVAL_MS = 700;
const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent/60";

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

export function DownloadView() {
  const setStep = useUiStore((s) => s.setStep);
  const setProject = useProjectStore((s) => s.setProject);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const ffmpegPreparation = useRuntimeDependencyPreparation("ffmpeg");
  const [mode, setMode] = useState<DownloadMode>("single");
  const [name, setName] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [saveDir, setSaveDir] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DownloadSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedPath, setCompletedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  const pollingRef = useRef(false);

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
    return () => {
      pollingRef.current = false;
    };
  }, []);

  const ffmpegMissing = ffmpeg !== null && !ffmpeg.available;
  const separateMode = mode === "separate";
  const canStart =
    name.trim().length > 0 &&
    videoUrl.trim().length > 0 &&
    (!separateMode || audioUrl.trim().length > 0) &&
    !busy &&
    !jobId;

  const pollProgress = async (id: string) => {
    pollingRef.current = true;
    while (pollingRef.current) {
      try {
        const snap = await getVideoDownloadProgress(id);
        setSnapshot(snap);
        if (snap.progress !== null) {
          updateTask("video-download", {
            progress: Math.round(snap.progress * 100),
          });
        }
        if (
          snap.status === "completed" ||
          snap.status === "failed" ||
          snap.status === "cancelled"
        ) {
          pollingRef.current = false;
          setBusy(false);
          setJobId(null);
          if (snap.status === "completed" && snap.outputPath) {
            setCompletedPath(snap.outputPath);
            updateTask("video-download", { status: "success", progress: 100 });
          } else if (snap.status === "failed") {
            setError(snap.error ?? "下载失败");
            updateTask("video-download", { status: "error" });
          } else {
            updateTask("video-download", { status: "idle" });
          }
          break;
        }
      } catch (e) {
        setError(String(e));
        pollingRef.current = false;
        setBusy(false);
        setJobId(null);
        updateTask("video-download", { status: "error" });
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  };

  const handlePickSaveDir = async () => {
    try {
      const dir = await pickDirectory();
      if (dir) setSaveDir(dir);
    } catch (e) {
      setError(`无法选择目录：${String(e)}`);
    }
  };

  const runStart = async () => {
    setError(null);
    setCompletedPath(null);
    setSnapshot(null);
    setBusy(true);
    upsertTask({
      id: "video-download",
      label: "视频下载",
      status: "running",
      progress: 0,
    });
    try {
      const id = await startVideoDownload({
        mode,
        name: name.trim(),
        videoUrl: videoUrl.trim(),
        audioUrl: separateMode ? audioUrl.trim() : null,
        headers: headers.trim() || null,
        saveDir: saveDir.trim() || null,
      });
      setJobId(id);
      void pollProgress(id);
    } catch (e) {
      setError(String(e));
      setBusy(false);
      updateTask("video-download", { status: "error" });
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
    pollingRef.current = false;
    try {
      await cancelVideoDownload(jobId);
      const snap = await getVideoDownloadProgress(jobId);
      setSnapshot(snap);
    } catch (e) {
      setError(String(e));
    } finally {
      setJobId(null);
      setBusy(false);
      updateTask("video-download", { status: "idle" });
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

  const handleImport = async () => {
    if (!completedPath) return;
    setImporting(true);
    setError(null);
    try {
      const meta = await createProject(completedPath);
      setProject(meta, projectDirFromMeta(meta));
      setStep("transcribe");
    } catch (e) {
      setError(`创建项目失败：${String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  const progressPercent =
    snapshot?.progress !== null && snapshot?.progress !== undefined
      ? Math.round(snapshot.progress * 100)
      : null;

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
      <header>
        <h2 className="text-xl font-semibold">视频下载</h2>
        <p className="mt-1 text-sm text-text-muted">
          从 m3u8 地址下载音视频，完成后可导入为 Hikaru Sub 项目
        </p>
      </header>

      {ffmpegMissing && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span className="text-warning">未检测到 FFmpeg，无法下载媒体。</span>
          <button
            type="button"
            onClick={() =>
              void ffmpegPreparation.requestDependency(async () => {
                await refreshFfmpeg(true);
              })
            }
            className="shrink-0 rounded-md border border-warning/50 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20"
          >
            准备 FFmpeg
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-border bg-surface-raised p-5">
        <h3 className="mb-4 font-medium">下载模式</h3>
        <div className="flex flex-wrap gap-3">
          <ModeButton
            active={mode === "single"}
            onClick={() => setMode("single")}
            label="单 URL"
            desc="音视频合一或纯音频 m3u8"
          />
          <ModeButton
            active={mode === "separate"}
            onClick={() => setMode("separate")}
            label="分离音视频"
            desc="并发分片下载，完成后合并"
          />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-raised p-5">
        <h3 className="mb-4 font-medium">下载参数</h3>
        <div className="flex flex-col gap-4">
          <Field label="下载名称（必填）">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 episode-01"
              className={INPUT_CLASS}
              disabled={busy}
            />
          </Field>
          <Field
            label={separateMode ? "视频 m3u8 URL（必填）" : "媒体 m3u8 URL（必填）"}
          >
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://example.com/video.m3u8"
              className={INPUT_CLASS}
              disabled={busy}
            />
          </Field>
          {separateMode && (
            <Field label="音频 m3u8 URL（必填）">
              <input
                type="url"
                value={audioUrl}
                onChange={(e) => setAudioUrl(e.target.value)}
                placeholder="https://example.com/audio.m3u8"
                className={INPUT_CLASS}
                disabled={busy}
              />
            </Field>
          )}
          <Field label="自定义请求头（可选）">
            <textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              placeholder={"Referer: https://example.com\nUser-Agent: ..."}
              rows={3}
              className={INPUT_CLASS}
              disabled={busy}
            />
            <p className="mt-1 text-xs text-text-muted">
              每行一条，格式为 Header: Value。Nico 等站点通常需要 Cookie，建议同时加上{" "}
              <code className="text-text">Referer: https://www.nicovideo.jp/</code>
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Nico 等平台音视频分离，请使用「分离音视频」模式；快速模式会并发下载分片，完成后自动合并。
            </p>
          </Field>
          <Field label="保存目录（可选，默认系统「下载」文件夹）">
            <div className="flex gap-2">
              <input
                type="text"
                value={saveDir}
                onChange={(e) => setSaveDir(e.target.value)}
                placeholder="留空使用默认下载目录"
                className={INPUT_CLASS}
                disabled={busy}
              />
              <button
                type="button"
                onClick={handlePickSaveDir}
                disabled={busy}
                className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-text hover:bg-surface-overlay disabled:opacity-50"
              >
                浏览
              </button>
            </div>
          </Field>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleStart}
            disabled={!canStart}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "下载中…" : "开始下载"}
          </button>
          {jobId && (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-lg border border-border px-4 py-2 text-sm text-text hover:bg-surface-overlay"
            >
              取消下载
            </button>
          )}
        </div>
      </section>

      {(busy || snapshot) && (
        <section className="rounded-xl border border-border bg-surface-raised p-5">
          <h3 className="mb-4 font-medium">下载进度</h3>
          {progressPercent !== null ? (
            <>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-text-muted">
                  {formatMs(snapshot?.processedMs ?? 0)} /{" "}
                  {formatMs(snapshot?.durationMs ?? 0)}
                </span>
                <span className="font-mono text-accent">{progressPercent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-text-muted">
              下载中… 已处理 {formatMs(snapshot?.processedMs ?? 0)}
              {snapshot?.durationMs ? ` / ${formatMs(snapshot.durationMs)}` : ""}
            </p>
          )}
        </section>
      )}

      {completedPath && (
        <section className="rounded-xl border border-border bg-surface-raised p-5">
          <h3 className="mb-2 font-medium">下载完成</h3>
          <p
            className="truncate font-mono text-xs text-text-muted"
            title={completedPath}
          >
            {completedPath}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleReveal}
              className="rounded-lg border border-border px-4 py-2 text-sm text-text hover:bg-surface-overlay"
            >
              打开所在文件夹
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted disabled:opacity-50"
            >
              {importing ? "导入中…" : "导入为项目"}
            </button>
          </div>
        </section>
      )}

      <RuntimeDependencyDialog
        open={ffmpegPreparation.open}
        kind="ffmpeg"
        reason="下载和封装媒体需要 FFmpeg。"
        sizeBytes={ffmpegPreparation.item?.sizeBytes ?? 0}
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
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-[10rem] flex-col rounded-lg border px-4 py-3 text-left transition-colors ${
        active
          ? "border-accent/50 bg-accent/10"
          : "border-border hover:border-accent/30 hover:bg-surface-overlay"
      }`}
    >
      <span className="text-sm font-medium text-text">{label}</span>
      <span className="mt-0.5 text-xs text-text-muted">{desc}</span>
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-text-muted">{label}</span>
      {children}
    </label>
  );
}
