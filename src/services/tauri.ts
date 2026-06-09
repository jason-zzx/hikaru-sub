import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  AudioExtractProgress,
  FfmpegStatus,
  ProjectMeta,
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
