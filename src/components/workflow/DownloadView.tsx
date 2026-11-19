import { useState } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useDownloadStore } from "../../stores/downloadStore";
import {
  cancelVideoDownload,
  getVideoDownloadProgress,
  pickDirectory,
  prepareVideoSession,
  startVideoDownload,
} from "../../services/tauri";
import { useFfmpegStatus } from "../../hooks/useFfmpegStatus";
import { useRuntimeDependencyPreparation } from "../../hooks/useRuntimeDependencyPreparation";
import { confirmDiscardUnsavedChanges } from "../../services/unsavedChanges";
import {
  restoreSubtitleRecovery,
  withDiscardedSubtitleRecovery,
} from "../../services/subtitleRecovery";
import { RuntimeDependencyDialog } from "./RuntimeDependencyDialog";
import { SettingsField, settingsInputClass } from "./settingsForm";
import { Button } from "../ui/button";
import { formatTransferSpeed } from "../../constants/runtimeDependencies";
import { formatDurationSeconds } from "../../utils/formatTime";

export function DownloadView() {
  const setStep = useUiStore((s) => s.setStep);
  const openSettings = useUiStore((s) => s.openSettings);
  const setSession = useProjectStore((s) => s.setSession);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const { ffmpeg, refreshFfmpeg } = useFfmpegStatus();
  const ffmpegPreparation = useRuntimeDependencyPreparation("ffmpeg");
  const {
    mode,
    name,
    videoUrl,
    audioUrl,
    headers,
    saveDir,
    jobId,
    snapshot,
    error,
    completedPath,
    busy,
    setForm,
    startJob,
    applySnapshot,
    setError,
    finishJob,
  } = useDownloadStore();
  const [importing, setImporting] = useState(false);

  const ffmpegMissing = ffmpeg !== null && !ffmpeg.available;
  const separateMode = mode === "separate";
  const canStart =
    name.trim().length > 0 &&
    videoUrl.trim().length > 0 &&
    (!separateMode || audioUrl.trim().length > 0) &&
    !busy &&
    !jobId;

  const handlePickSaveDir = async () => {
    try {
      const dir = await pickDirectory();
      if (dir) setForm({ saveDir: dir });
    } catch (e) {
      setError(`无法选择目录：${String(e)}`);
    }
  };

  const runStart = async () => {
    startJob();
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
      startJob(id);
    } catch (e) {
      setError(String(e));
      finishJob();
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
    try {
      await cancelVideoDownload(jobId);
      const snap = await getVideoDownloadProgress(jobId);
      applySnapshot(snap);
    } catch (e) {
      setError(String(e));
    } finally {
      finishJob();
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
    const discardDecision = await confirmDiscardUnsavedChanges();
    if (!discardDecision.proceed) return;
    setImporting(true);
    setError(null);
    try {
      const session = await prepareVideoSession(completedPath);
      await withDiscardedSubtitleRecovery(
        discardDecision.recoveryVideoPath,
        () => setSession(session),
      );
      const recovery = await restoreSubtitleRecovery(session);
      if (recovery === "invalid" || recovery === "error") {
        const recoveryMessage =
          recovery === "invalid"
            ? "检测到的字幕恢复文件格式无效，已删除"
            : "处理字幕恢复文件失败，已继续打开视频";
        try {
          await message(recoveryMessage, {
            title: "Hikaru Sub",
            kind: recovery === "invalid" ? "warning" : "error",
          });
        } catch {
          // Dialog failure must not block opening the prepared video.
        }
      }
      setStep("import");
    } catch (e) {
      setError(`打开视频失败：${String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  const progressPercent =
    snapshot?.progress !== null && snapshot?.progress !== undefined
      ? Math.round(snapshot.progress * 100)
      : null;
  const speedLabel = formatTransferSpeed(snapshot?.speedBytesPerSec);
  const snapshotFailed =
    snapshot?.status === "failed" ||
    (!busy &&
      Boolean(error) &&
      snapshot !== null &&
      snapshot.status !== "completed" &&
      snapshot.status !== "cancelled");
  const snapshotCancelled = snapshot?.status === "cancelled";
  const snapshotCompleted = snapshot?.status === "completed" || Boolean(completedPath);
  const showProgressCard = !snapshotCompleted && (busy || snapshot !== null);
  const isMerging = snapshot?.phase === "merging";
  const isPreparing = snapshot?.phase === "preparing";
  const failureMessage = snapshot?.error ?? error ?? "下载失败";

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
      <header>
        <h2 className="text-xl font-semibold">视频下载</h2>
        <p className="mt-1 text-sm text-text-muted">
          从 m3u8 地址下载音视频，完成后可进入导入页继续转录或切片
        </p>
      </header>

      {ffmpegMissing && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span className="text-warning">未检测到 FFmpeg，无法下载媒体。</span>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void ffmpegPreparation.requestDependency(async () => {
                await refreshFfmpeg(true);
              })
            }
            className="shrink-0 px-3 py-1.5 text-xs text-warning"
          >
            准备 FFmpeg
          </Button>
        </div>
      )}

      {error && !snapshotFailed && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-border bg-surface-raised p-5">
        <h3 className="mb-4 font-medium">下载模式</h3>
        <div className="flex flex-wrap gap-3">
          <ModeButton
            active={mode === "single"}
            onClick={() => setForm({ mode: "single" })}
            label="单 URL"
            desc="音视频合一或纯音频 m3u8"
          />
          <ModeButton
            active={mode === "separate"}
            onClick={() => setForm({ mode: "separate" })}
            label="分离音视频"
            desc="并发分片下载，完成后合并"
          />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-raised p-5">
        <h3 className="mb-4 font-medium">下载参数</h3>
        <div className="flex flex-col gap-4">
          <SettingsField label="下载名称（必填）">
            <input
              type="text"
              value={name}
              onChange={(e) => setForm({ name: e.target.value })}
              placeholder="例如 episode-01"
              className={settingsInputClass}
              disabled={busy}
            />
          </SettingsField>
          <SettingsField
            label={separateMode ? "视频 m3u8 URL（必填）" : "媒体 m3u8 URL（必填）"}
          >
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setForm({ videoUrl: e.target.value })}
              placeholder="https://example.com/video.m3u8"
              className={settingsInputClass}
              disabled={busy}
            />
          </SettingsField>
          {separateMode && (
            <SettingsField label="音频 m3u8 URL（必填）">
              <input
                type="url"
                value={audioUrl}
                onChange={(e) => setForm({ audioUrl: e.target.value })}
                placeholder="https://example.com/audio.m3u8"
                className={settingsInputClass}
                disabled={busy}
              />
            </SettingsField>
          )}
          <SettingsField label="自定义请求头（可选）">
            <textarea
              value={headers}
              onChange={(e) => setForm({ headers: e.target.value })}
              placeholder={"Referer: https://example.com\nUser-Agent: ..."}
              rows={3}
              className={settingsInputClass}
              disabled={busy}
            />
            <p className="mt-1 text-xs text-text-muted">
              每行一条，格式为 Header: Value。
            </p>
          </SettingsField>
          <SettingsField label="保存目录（可选，默认系统「下载」文件夹）">
            <div className="flex gap-2">
              <input
                type="text"
                value={saveDir}
                onChange={(e) => setForm({ saveDir: e.target.value })}
                placeholder="留空使用默认下载目录"
                className={settingsInputClass}
                disabled={busy}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handlePickSaveDir}
                disabled={busy}
                className="shrink-0 px-3 py-2"
              >
                浏览
              </Button>
            </div>
          </SettingsField>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={handleStart}
            disabled={!canStart}
            className="px-4 py-2"
          >
            {busy ? "下载中…" : "开始下载"}
          </Button>
          {jobId && (
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              className="px-4 py-2"
            >
              取消下载
            </Button>
          )}
        </div>
      </section>

      {showProgressCard && (
        <section className="rounded-xl border border-border bg-surface-raised p-5">
          <h3 className="mb-4 font-medium">
            {snapshotFailed
              ? "下载失败"
              : snapshotCancelled
                ? "下载已取消"
                : "下载进度"}
          </h3>
          {snapshotFailed ? (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
              {failureMessage}
            </div>
          ) : snapshotCancelled ? (
            <p className="text-sm text-text-muted">已取消下载</p>
          ) : progressPercent !== null ? (
            <>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-foreground/80">
                  {formatDurationSeconds(snapshot?.processedMs ?? 0)} /{" "}
                  {formatDurationSeconds(snapshot?.durationMs ?? 0)}
                </span>
                <span className="flex items-center gap-3 font-mono">
                  {speedLabel && (
                    <span className="font-medium text-foreground">
                      {speedLabel}
                    </span>
                  )}
                  <span className="font-semibold text-primary">
                    {progressPercent}%
                  </span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {isMerging && (
                <p className="mt-2 text-xs font-medium text-foreground/80">
                  下载完成，正在合并封装…
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-foreground/80">
              {isMerging
                ? "下载完成，正在合并封装…"
                : isPreparing
                  ? "正在解析播放列表…"
                  : `下载中… 已处理 ${formatDurationSeconds(snapshot?.processedMs ?? 0)}${snapshot?.durationMs ? ` / ${formatDurationSeconds(snapshot.durationMs)}` : ""}`}
              {!isMerging && !isPreparing && speedLabel ? (
                <span className="ml-2 font-mono font-medium text-foreground">
                  {speedLabel}
                </span>
              ) : null}
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
            <Button
              type="button"
              variant="outline"
              onClick={handleReveal}
              className="px-4 py-2"
            >
              打开所在文件夹
            </Button>
            <Button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="px-4 py-2"
            >
              {importing ? "打开中…" : "下一步"}
            </Button>
          </div>
        </section>
      )}

      <RuntimeDependencyDialog
        open={ffmpegPreparation.open}
        kind="ffmpeg"
        reason="下载和封装媒体需要 FFmpeg。"
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
        onChangeSource={() => openSettings("runtime")}
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
          ? "border-accent bg-accent text-accent-foreground ring-2 ring-ring/30"
          : "border-border hover:border-accent/50 hover:bg-surface-overlay"
      }`}
    >
      <span className="text-sm font-medium text-text">{label}</span>
      <span className="mt-0.5 text-xs text-text-muted">{desc}</span>
    </button>
  );
}
