import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  AsrEngineInfo,
  AsrJobSnapshot,
  AsrModelStatus,
  AsrSetupEnvironment,
  AsrSetupSnapshot,
  AudioExtractProgress,
  BurnSnapshot,
  BurnVideoProbe,
  ClipSnapshot,
  DownloadSnapshot,
  ExtractVideoFrameArgs,
  ExtractVideoFrameResult,
  FfmpegStatus,
  LatestGithubRelease,
  ModelDownloadSnapshot,
  ProbeDownloadMediaArgs,
  ProbeAsrSetupEnvironmentArgs,
  PreviewFontFile,
  PrepareRuntimeDependencyArgs,
  RenderSubtitlePreviewFrameArgs,
  RenderSubtitlePreviewFrameResult,
  RuntimeDependencyKind,
  RuntimeDependencyProbe,
  RuntimeDependencySnapshot,
  RuntimeDependencyStorage,
  StartAsrArgs,
  StartAsrSetupArgs,
  StartBurnArgs,
  StartVideoClipArgs,
  StartVideoDownloadArgs,
  DownloadMediaProbe,
  VideoSession,
} from "../types";

const VIDEO_EXTENSIONS = [
  "mp4",
  "mkv",
  "mov",
  "avi",
  "webm",
  "flv",
  "ts",
  "m4v",
];

const SUBTITLE_EXTENSIONS = ["ass", "srt"];

/** 弹出文件对话框选择视频，取消返回 null。 */
export async function pickVideoFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "视频文件", extensions: VIDEO_EXTENSIONS }],
  });
  return typeof selected === "string" ? selected : null;
}

/** 弹出文件对话框选择字幕文件，取消返回 null。 */
export async function pickSubtitleFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "字幕文件", extensions: SUBTITLE_EXTENSIONS }],
  });
  return typeof selected === "string" ? selected : null;
}

function ensureAssExtension(path: string): string {
  return /\.ass$/i.test(path) ? path : `${path}.ass`;
}

/** 弹出 ASS 另存为对话框，取消返回 null。 */
export async function pickSaveAssFile(defaultPath?: string): Promise<string | null> {
  const selected = await save({
    defaultPath,
    filters: [{ name: "ASS 字幕", extensions: ["ass"] }],
  });
  return typeof selected === "string" ? ensureAssExtension(selected) : null;
}

/** 弹出目录对话框，取消返回 null（如选择保存目录、sidecar 目录）。 */
export async function pickDirectory(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: true });
  return typeof selected === "string" ? selected : null;
}

/** 弹出文件对话框选择可执行文件（如 ffmpeg、python），取消返回 null。 */
export async function pickExecutableFile(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: false });
  return typeof selected === "string" ? selected : null;
}

let ffmpegStatusPromise: Promise<FfmpegStatus> | null = null;

export const FFMPEG_STATUS_INVALIDATED_EVENT =
  "hikaru-sub:ffmpeg-status-invalidated";

export function invalidateFfmpegStatus(): void {
  ffmpegStatusPromise = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(FFMPEG_STATUS_INVALIDATED_EVENT));
  }
}

export async function checkFfmpeg(options: { force?: boolean } = {}): Promise<FfmpegStatus> {
  if (options.force) {
    invalidateFfmpegStatus();
  }
  if (!ffmpegStatusPromise) {
    ffmpegStatusPromise = invoke<FfmpegStatus>("check_ffmpeg").catch((error) => {
      ffmpegStatusPromise = null;
      throw error;
    });
  }
  return ffmpegStatusPromise;
}

/** 提取音轨为 16kHz 单声道 WAV，返回输出路径。 */
export async function extractAudio(
  videoPath: string,
  audioPath: string,
): Promise<string> {
  return invoke<string>("extract_audio", { videoPath, audioPath });
}

/** 订阅音轨提取进度事件，返回取消订阅函数。 */
export async function onAudioExtractProgress(
  handler: (progress: AudioExtractProgress) => void,
): Promise<UnlistenFn> {
  return listen<AudioExtractProgress>("audio_extract_progress", (event) =>
    handler(event.payload),
  );
}

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export async function setSettings(settings: AppSettings): Promise<void> {
  return invoke("set_settings", { settings });
}

export async function prepareVideoSession(videoPath: string): Promise<VideoSession> {
  return invoke<VideoSession>("prepare_video_session", { videoPath });
}

export function transcribedAssPath(session: VideoSession): string {
  return session.transcribedAssPath;
}

export function translatedAssPath(session: VideoSession): string {
  return session.translatedAssPath;
}

export function workspaceDirFromSession(session: VideoSession): string {
  return session.workspacePath;
}

export async function deleteCachedAudio(audioPath: string): Promise<boolean> {
  return invoke<boolean>("delete_cached_audio", { audioPath });
}

/** 判断文件/目录是否存在（如检测已提取的 audio.wav）。 */
export async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path });
}

/** 列出 sidecar 已注册的 ASR 引擎（首次调用会按需拉起 sidecar）。 */
export async function listAsrEngines(): Promise<AsrEngineInfo[]> {
  const res = await invoke<{ engines: AsrEngineInfo[] }>("list_asr_engines");
  return res.engines;
}

/** 创建转录任务，返回 jobId。 */
export async function startAsr(args: StartAsrArgs): Promise<string> {
  return invoke<string>("start_asr", { args });
}

/** 查询转录进度；running 阶段可传 includeSegments=false 仅取进度。 */
export async function getAsrProgress(
  jobId: string,
  includeSegments = true,
): Promise<AsrJobSnapshot> {
  return invoke<AsrJobSnapshot>("get_asr_progress", { jobId, includeSegments });
}

/** 取消转录任务。 */
export async function cancelAsr(jobId: string): Promise<void> {
  await invoke("cancel_asr", { jobId });
}

/** 查询指定引擎/模型在本地缓存的就绪状态。 */
export async function checkAsrModel(
  engine: string,
  model: string,
): Promise<AsrModelStatus> {
  return invoke<AsrModelStatus>("check_asr_model", { engine, model });
}

/** 触发模型下载，返回下载任务 jobId。 */
export async function downloadAsrModel(
  engine: string,
  model: string,
): Promise<string> {
  return invoke<string>("download_asr_model", { engine, model });
}

/** 查询模型下载进度。 */
export async function getModelDownloadProgress(
  jobId: string,
): Promise<ModelDownloadSnapshot> {
  return invoke<ModelDownloadSnapshot>("get_model_download_progress", { jobId });
}

/** 探测 ASR 一键配置所需的模板、Python 与虚拟环境状态。 */
export async function probeAsrSetupEnvironment(
  args: ProbeAsrSetupEnvironmentArgs = {},
): Promise<AsrSetupEnvironment> {
  return invoke<AsrSetupEnvironment>("probe_asr_setup_environment", { args });
}

/** 启动 ASR 引擎依赖配置任务，返回 jobId。 */
export async function startAsrSetup(args: StartAsrSetupArgs): Promise<string> {
  return invoke<string>("start_asr_setup", { args });
}

/** 查询 ASR 引擎依赖配置任务进度。 */
export async function getAsrSetupProgress(
  jobId: string,
): Promise<AsrSetupSnapshot> {
  return invoke<AsrSetupSnapshot>("get_asr_setup_progress", { jobId });
}

/** 取消 ASR 引擎依赖配置任务。 */
export async function cancelAsrSetup(jobId: string): Promise<void> {
  await invoke("cancel_asr_setup", { jobId });
}

/** 探测 FFmpeg、Python、ASR 依赖和模型缓存的运行时状态（不含磁盘占用）。 */
export async function probeRuntimeDependencies(): Promise<RuntimeDependencyProbe> {
  return invoke<RuntimeDependencyProbe>("probe_runtime_dependencies");
}

/** 计算受管依赖目录磁盘占用。 */
export async function measureRuntimeDependencyStorage(options?: {
  preserveVideoPath?: string | null;
}): Promise<RuntimeDependencyStorage> {
  return invoke<RuntimeDependencyStorage>("measure_runtime_dependency_storage", {
    args: {
      preserveVideoPath: options?.preserveVideoPath ?? null,
    },
  });
}

/** 准备一个缺失的运行时依赖，返回后台任务 jobId。 */
export async function prepareRuntimeDependency(
  args: PrepareRuntimeDependencyArgs,
): Promise<string> {
  return invoke<string>("prepare_runtime_dependency", { args });
}

/** 查询运行时依赖准备任务进度。 */
export async function getRuntimeDependencyProgress(
  jobId: string,
): Promise<RuntimeDependencySnapshot> {
  return invoke<RuntimeDependencySnapshot>("get_runtime_dependency_progress", {
    jobId,
  });
}

/** 取消运行时依赖准备任务。 */
export async function cancelRuntimeDependency(jobId: string): Promise<void> {
  await invoke("cancel_runtime_dependency", { jobId });
}

/** 清理受管运行时依赖、下载缓存或应用缓存。 */
export async function cleanupRuntimeDependency(
  kind: RuntimeDependencyKind,
  options?: { preserveVideoPath?: string | null },
): Promise<void> {
  await invoke("cleanup_runtime_dependency", {
    args: {
      kind,
      preserveVideoPath: options?.preserveVideoPath ?? null,
    },
  });
}

/** 保存 ASS 文本到文件。 */
export async function saveAssText(
  assPath: string,
  assText: string,
): Promise<void> {
  return invoke("save_ass_text", { assPath, assText });
}

/** 加载 ASS 文件内容。 */
export async function loadAssText(assPath: string): Promise<string> {
  return invoke<string>("load_ass_text", { assPath });
}

/** 获取视频信息（分辨率、时长）。 */
export async function getVideoInfo(videoPath: string): Promise<import("../types").VideoInfo> {
  return invoke<import("../types").VideoInfo>("get_video_info", { videoPath });
}

/** 枚举系统字体与额外字体目录，并返回本地 HTTP 可读 URL。 */
export async function discoverPreviewFonts(
  extraDirs: string[] = [],
): Promise<PreviewFontFile[]> {
  return invoke<PreviewFontFile[]>("discover_preview_fonts", { extraDirs });
}

/** 通过 FFmpeg/libass 渲染一帧硬字幕预览图。 */
export async function renderSubtitlePreviewFrame(
  args: RenderSubtitlePreviewFrameArgs,
): Promise<RenderSubtitlePreviewFrameResult> {
  return invoke<RenderSubtitlePreviewFrameResult>(
    "render_subtitle_preview_frame",
    { args },
  );
}

/** 探测 m3u8 媒体流信息。 */
export async function probeDownloadMedia(
  args: ProbeDownloadMediaArgs,
): Promise<DownloadMediaProbe> {
  return invoke<DownloadMediaProbe>("probe_download_media", { args });
}

/** 启动 m3u8 视频下载，返回 jobId。 */
export async function startVideoDownload(
  args: StartVideoDownloadArgs,
): Promise<string> {
  return invoke<string>("start_video_download", { args });
}

/** 查询视频下载进度。 */
export async function getVideoDownloadProgress(
  jobId: string,
): Promise<DownloadSnapshot> {
  return invoke<DownloadSnapshot>("get_video_download_progress", { jobId });
}

/** 注册本地视频路径到媒体 HTTP 服务，返回可播放的 http://127.0.0.1 URL。 */
export async function registerMediaPlayback(path: string): Promise<string> {
  return invoke<string>("register_media_playback", { path });
}

/** 取消视频下载。 */
export async function cancelVideoDownload(jobId: string): Promise<void> {
  await invoke("cancel_video_download", { jobId });
}

/** 启动字幕压制/封装任务，返回 jobId。 */
export async function startBurnSubtitles(
  args: StartBurnArgs,
): Promise<string> {
  return invoke<string>("start_burn_subtitles", { args });
}

/** 探测硬字幕导出推荐设置（原视频码率、可用编码器）。 */
export async function probeBurnVideo(videoPath: string): Promise<BurnVideoProbe> {
  return invoke<BurnVideoProbe>("probe_burn_video", { videoPath });
}

/** 查询字幕压制进度。 */
export async function getBurnProgress(jobId: string): Promise<BurnSnapshot> {
  return invoke<BurnSnapshot>("get_burn_progress", { jobId });
}

/** 取消字幕压制任务。 */
export async function cancelBurn(jobId: string): Promise<void> {
  await invoke("cancel_burn", { jobId });
}

/** 启动视频剪辑任务，返回 jobId。 */
export async function startVideoClip(
  args: StartVideoClipArgs,
): Promise<string> {
  return invoke<string>("start_video_clip", { args });
}

/** 查询视频剪辑进度。 */
export async function getVideoClipProgress(
  jobId: string,
): Promise<ClipSnapshot> {
  return invoke<ClipSnapshot>("get_video_clip_progress", { jobId });
}

/** 取消视频剪辑任务。 */
export async function cancelVideoClip(jobId: string): Promise<void> {
  await invoke("cancel_video_clip", { jobId });
}

/** 从视频提取指定时间点的帧图。 */
export async function extractVideoFrame(
  args: ExtractVideoFrameArgs,
): Promise<ExtractVideoFrameResult> {
  return invoke<ExtractVideoFrameResult>("extract_video_frame", { args });
}

/** 通过 GitHub /releases/latest 重定向解析最新正式版。 */
export async function fetchLatestGithubRelease(): Promise<LatestGithubRelease> {
  return invoke<LatestGithubRelease>("fetch_latest_github_release");
}
