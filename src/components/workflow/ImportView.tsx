import { useEffect, useState } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { IconFilePlus, IconFolderOpen } from "../layout/NavIcons";
import {
  checkFfmpeg,
  createProject,
  openProject,
  pickDirectory,
  pickVideoFile,
  projectDirFromMeta,
} from "../../services/tauri";
import type { FfmpegStatus } from "../../types";

const FFMPEG_SOURCE_LABEL: Record<FfmpegStatus["source"], string> = {
  settings: "自定义路径",
  bundled: "随应用捆绑",
  system: "系统 PATH",
};

export function ImportView() {
  const setStep = useUiStore((s) => s.setStep);
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);

  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkFfmpeg()
      .then(setFfmpeg)
      .catch(() => setFfmpeg(null));
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
      const meta = await createProject(videoPath);
      setProject(meta, projectDirFromMeta(meta));
      setStep("transcribe");
    } catch (e) {
      setError(`创建项目失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenProject = async () => {
    setError(null);
    let dir: string | null;
    try {
      dir = await pickDirectory();
    } catch (e) {
      setError(`无法打开目录对话框：${String(e)}`);
      return;
    }
    if (!dir) return;

    setBusy(true);
    try {
      const meta = await openProject(dir);
      setProject(meta, dir);
      setStep("transcribe");
    } catch (e) {
      setError(`打开项目失败：${String(e)}`);
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
          选择视频文件，将在其同目录创建 .hikaru 项目文件夹
        </p>
      </header>

      {ffmpegMissing && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <span className="text-warning">
            未检测到 FFmpeg，音轨提取与压制将不可用。
          </span>
          <button
            type="button"
            onClick={() => setStep("settings")}
            className="shrink-0 rounded-md border border-warning/50 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20"
          >
            前往设置
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {project && (
        <div className="rounded-xl border border-border bg-surface-raised p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted">
            当前项目
          </p>
          <p className="mt-1 truncate font-medium text-text" title={project.videoPath}>
            {fileName(project.videoPath)}
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-text-muted" title={project.videoPath}>
            {project.videoPath}
          </p>
          <button
            type="button"
            onClick={() => setStep("transcribe")}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted"
          >
            继续转录
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
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
            创建新项目并开始转录
          </span>
        </button>

        <button
          type="button"
          onClick={handleOpenProject}
          disabled={busy}
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface-raised p-10 text-center transition-colors hover:border-accent/50 hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-60"
        >
          <IconFolderOpen className="h-7 w-7 text-accent" />
          <span className="font-medium text-text">打开已有项目</span>
          <span className="text-xs text-text-muted">
            选择含 project.json 的 .hikaru 目录
          </span>
        </button>
      </div>

      {ffmpeg?.available && (
        <p className="text-xs text-text-muted">
          FFmpeg 就绪 · 来源：{FFMPEG_SOURCE_LABEL[ffmpeg.source]}
          {ffmpeg.version ? ` · ${ffmpeg.version}` : ""}
        </p>
      )}
    </div>
  );
}
