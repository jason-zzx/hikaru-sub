import { useEffect, useState } from "react";
import { parseAss } from "@hikaru/ass-core";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { IconFilePlus } from "../layout/NavIcons";
import { Button } from "../ui/button";
import {
  checkFfmpeg,
  invalidateFfmpegStatus,
  loadAssText,
  pathExists,
  pickVideoFile,
  prepareVideoSession,
  transcribedAssPath,
  translatedAssPath,
} from "../../services/tauri";
import type { FfmpegStatus } from "../../types";
import { useRuntimeDependencyPreparation } from "../../hooks/useRuntimeDependencyPreparation";
import { RuntimeDependencyDialog } from "./RuntimeDependencyDialog";

const FFMPEG_SOURCE_LABEL: Record<FfmpegStatus["source"], string> = {
  settings: "自定义路径",
  managed: "受管下载",
  system: "系统 PATH",
};

export function ImportView() {
  const setStep = useUiStore((s) => s.setStep);
  const session = useProjectStore((s) => s.session);
  const setSession = useProjectStore((s) => s.setSession);

  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const ffmpegPreparation = useRuntimeDependencyPreparation("ffmpeg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshFfmpeg = async (force = false) => {
    if (force) invalidateFfmpegStatus();
    const next = await checkFfmpeg({ force });
    setFfmpeg(next);
    return next;
  };

  useEffect(() => {
    refreshFfmpeg().catch(() => setFfmpeg(null));
  }, []);

  const fileName = (path: string) => path.split(/[/\\]/).pop() ?? path;

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
      const session = await prepareVideoSession(videoPath);
      setSession(session);

      const { loadAssDocument } = useProjectStore.getState();
      const translatedPath = translatedAssPath(session);
      const transcribedPath = transcribedAssPath(session);

      let loaded = false;
      if (await pathExists(translatedPath)) {
        try {
          loadAssDocument(parseAss(await loadAssText(translatedPath)), {
            kind: "translated",
            path: translatedPath,
          });
          loaded = true;
        } catch {
          loaded = false;
        }
      }
      if (!loaded && await pathExists(transcribedPath)) {
        try {
          loadAssDocument(parseAss(await loadAssText(transcribedPath)), {
            kind: "transcribed",
            path: transcribedPath,
          });
        } catch {
          // Treat unreadable subtitle files as an incomplete stage.
        }
      }
      setStep("transcribe");
    } catch (e) {
      setError(`打开视频失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const ffmpegMissing = ffmpeg !== null && !ffmpeg.available;

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
      <header>
        <h2 className="text-xl font-semibold">导入视频</h2>
        <p className="mt-1 text-sm text-text-muted">
          选择视频文件，字幕将保存到视频同目录
        </p>
      </header>

      {ffmpegMissing && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span className="text-warning">
            未检测到 FFmpeg，音轨提取与压制将不可用。
          </span>
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

      {session && (
        <div className="rounded-xl border border-border bg-surface-raised p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted">
            当前视频
          </p>
          <p className="mt-1 truncate font-medium text-text" title={session.videoPath}>
            {fileName(session.videoPath)}
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-text-muted" title={session.videoPath}>
            {session.videoPath}
          </p>
          <Button
            type="button"
            variant="default"
            onClick={() => setStep("transcribe")}
            className="mt-4"
          >
            继续转录
          </Button>
        </div>
      )}

      <div className="grid gap-4">
        <button
          type="button"
          onClick={handleSelectVideo}
          disabled={busy}
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface-raised p-10 text-center transition-colors hover:border-accent/50 hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-60"
        >
          <IconFilePlus className="h-7 w-7 text-accent" />
          <span className="font-medium text-text">
            {busy ? "处理中…" : "选择视频文件"}
          </span>
          <span className="text-xs text-text-muted">
            打开视频并开始转录
          </span>
        </button>
      </div>

      {ffmpeg?.available && (
        <p className="text-xs text-text-muted">
          FFmpeg 就绪 · 来源：{FFMPEG_SOURCE_LABEL[ffmpeg.source]}
          {ffmpeg.version ? ` · ${ffmpeg.version}` : ""}
        </p>
      )}

      <RuntimeDependencyDialog
        open={ffmpegPreparation.open}
        kind="ffmpeg"
        reason="提取音轨、下载和压制视频需要 FFmpeg。"
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
