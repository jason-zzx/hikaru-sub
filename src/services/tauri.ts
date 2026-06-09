import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  AsrEngineInfo,
  AsrJobSnapshot,
  AsrModelStatus,
  AudioExtractProgress,
  FfmpegStatus,
  ModelDownloadSnapshot,
  ProjectMeta,
  StartAsrArgs,
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

/** 弹出文件对话框选择视频，取消返回 null。 */
export async function pickVideoFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "视频文件", extensions: VIDEO_EXTENSIONS }],
  });
  return typeof selected === "string" ? selected : null;
}

/** 弹出目录对话框，取消返回 null（如选择项目目录、sidecar 目录）。 */
export async function pickDirectory(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: true });
  return typeof selected === "string" ? selected : null;
}

/** 弹出文件对话框选择可执行文件（如 ffmpeg、python），取消返回 null。 */
export async function pickExecutableFile(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: false });
  return typeof selected === "string" ? selected : null;
}

/** 从项目元数据推断 .hikaru 目录（取 audio/ass 路径的父目录）。 */
export function projectDirFromMeta(meta: ProjectMeta): string {
  const ref = meta.audioPath ?? meta.assPath ?? "";
  const idx = Math.max(ref.lastIndexOf("/"), ref.lastIndexOf("\\"));
  return idx >= 0 ? ref.slice(0, idx) : ref;
}

export async function checkFfmpeg(): Promise<FfmpegStatus> {
  return invoke<FfmpegStatus>("check_ffmpeg");
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

export async function createProject(videoPath: string): Promise<ProjectMeta> {
  return invoke<ProjectMeta>("create_project", { videoPath });
}

export async function openProject(projectDir: string): Promise<ProjectMeta> {
  return invoke<ProjectMeta>("open_project", { projectDir });
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
