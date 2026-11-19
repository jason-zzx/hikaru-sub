import { useState } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { useClipStore } from "../../stores/clipStore";
import { useTaskStore } from "../../stores/taskStore";
import { IconFilePlus } from "../layout/NavIcons";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import {
  cancelVideoClip,
  pickVideoFile,
  startVideoClip,
} from "../../services/tauri";
import { useFfmpegStatus } from "../../hooks/useFfmpegStatus";
import { useRuntimeDependencyPreparation } from "../../hooks/useRuntimeDependencyPreparation";
import { confirmDiscardUnsavedChanges } from "../../services/unsavedChanges";
import { openVideoSession } from "../../services/openVideo";
import { getFileName } from "../../utils/path";
import { ClipDialog } from "./ClipDialog";
import { RuntimeDependencyDialog } from "./RuntimeDependencyDialog";

export function ImportView() {
  const setStep = useUiStore((s) => s.setStep);
  const openSettings = useUiStore((s) => s.openSettings);
  const session = useProjectStore((s) => s.session);

  const clipBusy = useClipStore((s) => s.busy);
  const jobId = useClipStore((s) => s.jobId);
  const snapshot = useClipStore((s) => s.snapshot);
  const clipError = useClipStore((s) => s.error);
  const completedPath = useClipStore((s) => s.completedPath);
  const useAsWorkingVideo = useClipStore((s) => s.useAsWorkingVideo);
  const clipSuccessMessage = useClipStore((s) => s.successMessage);
  const startJob = useClipStore((s) => s.startJob);
  const resetForStart = useClipStore((s) => s.resetForStart);
  const clearAfterCancel = useClipStore((s) => s.clearAfterCancel);
  const clipSetError = useClipStore((s) => s.setError);
  const clearSuccessMessage = useClipStore((s) => s.clearSuccessMessage);

  const upsertTask = useTaskStore((s) => s.upsertTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const { ffmpeg, refreshFfmpeg } = useFfmpegStatus();
  const ffmpegPreparation = useRuntimeDependencyPreparation("ffmpeg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clipOpen, setClipOpen] = useState(false);

  const handleSelectVideo = async () => {
    setError(null);
    let videoPath: string | null;
    try {
      videoPath = await pickVideoFile();
    } catch (e) {
      setError(`无法打开文件对话框：${String(e)}`);
      return;
    }
    if (!videoPath) return;
    setBusy(true);
    try {
      const result = await openVideoSession(videoPath);
      if (!result.ok) {
        if ("error" in result) {
          setError(result.error);
        } else if ("changed" in result) {
          setError("当前字幕已发生变化，已取消打开视频");
        }
        return;
      }
      if (result.recovery === "invalid") {
        setError("检测到的字幕恢复文件格式无效，已删除");
      } else if (result.recovery === "error") {
        setError("处理字幕恢复文件失败，已继续打开视频");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCancelClip = async () => {
    if (!jobId) return;
    let cancelError: string | null = null;
    try {
      await cancelVideoClip(jobId);
    } catch (e) {
      cancelError = String(e);
    } finally {
      clearAfterCancel();
      updateTask("video-clip", { status: "idle" });
      // 任务已终态被移除时 cancel 会失败；仍解锁，仅保留非「不存在」类错误
      if (cancelError && !cancelError.includes("不存在")) {
        clipSetError(cancelError);
      }
    }
  };

  const ffmpegMissing = ffmpeg !== null && !ffmpeg.available;
  const clipProgressPercent =
    snapshot?.progress !== null && snapshot?.progress !== undefined
      ? Math.round(snapshot.progress * 100)
      : null;

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
      <header>
        <h2 className="text-xl font-semibold">导入视频</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          选择视频文件，字幕将保存到视频同目录
        </p>
      </header>

      {ffmpegMissing && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span className="text-warning">
            未检测到 FFmpeg，音轨提取与压制将不可用。
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              void ffmpegPreparation.requestDependency(async () => {
                await refreshFfmpeg(true);
              })
            }
            className="shrink-0 border-warning/50 text-warning hover:bg-warning/20 hover:text-warning"
          >
            准备 FFmpeg
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {clipError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {clipError}
        </div>
      )}

      {clipSuccessMessage && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {clipSuccessMessage}
        </div>
      )}

      {session && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            当前视频
          </p>
          <p className="mt-1 truncate font-medium text-foreground" title={session.videoPath}>
            {getFileName(session.videoPath)}
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={session.videoPath}>
            {session.videoPath}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="default"
              onClick={() => setStep("transcribe")}
              disabled={clipBusy}
            >
              转录
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClipOpen(true)}
              disabled={clipBusy}
            >
              切片
            </Button>
          </div>

          {clipBusy && (
            <div className="mt-4 space-y-3">
              {completedPath && useAsWorkingVideo ? (
                <p className="text-sm text-muted-foreground">正在切换工作视频…</p>
              ) : completedPath ? (
                <p className="text-sm text-muted-foreground">切片完成，正在收尾…</p>
              ) : clipProgressPercent !== null ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">切片进度</span>
                    <span className="font-mono text-primary">{clipProgressPercent}%</span>
                  </div>
                  <Progress value={clipProgressPercent} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">切片中…</p>
              )}
              {snapshot?.fellBackToHard && !completedPath && (
                <p className="text-sm text-warning">已改为硬切</p>
              )}
              {!completedPath && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleCancelClip()}
                >
                  停止切片
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={handleSelectVideo}
          disabled={busy || clipBusy}
          className="h-auto w-full flex-col gap-3 rounded-xl border-dashed bg-card p-10 text-center whitespace-normal hover:border-primary/50 hover:bg-muted"
        >
          <IconFilePlus className="h-7 w-7 text-primary" />
          <span className="font-medium text-foreground">
            {busy ? "处理中…" : "选择视频文件"}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            打开视频，可切片或转录
          </span>
        </Button>
      </div>

      {session && (
        <ClipDialog
          open={clipOpen}
          onOpenChange={setClipOpen}
          videoPath={session.videoPath}
          onStart={async (args) => {
            const discardDecision = args.useAsWorkingVideo
              ? await confirmDiscardUnsavedChanges()
              : { proceed: true, recoveryVideoPath: null };
            if (!discardDecision.proceed) return;

            const run = async () => {
              setClipOpen(false);
              clearSuccessMessage();
              resetForStart();
              upsertTask({ id: "video-clip", label: "视频切片", status: "running", progress: 0 });
              try {
                const id = await startVideoClip({
                  videoPath: session.videoPath,
                  startMs: args.startMs,
                  endMs: args.endMs,
                  mode: args.mode,
                  saveDir: args.saveDir,
                  fileName: args.fileName,
                });
                startJob(id, {
                  useAsWorkingVideo: args.useAsWorkingVideo,
                  discardRecoveryVideoPath:
                    discardDecision.recoveryVideoPath,
                });
              } catch (e) {
                clipSetError(String(e));
                updateTask("video-clip", { status: "error" });
              }
            };
            if (ffmpegMissing) {
              await ffmpegPreparation.requestDependency(async () => {
                const next = await refreshFfmpeg(true);
                if (next.available) await run();
              });
              return;
            }
            await run();
          }}
        />
      )}

      <RuntimeDependencyDialog
        open={ffmpegPreparation.open}
        kind="ffmpeg"
        reason="提取音轨、下载和压制视频需要 FFmpeg。"
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
