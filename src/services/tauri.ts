import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  AudioExtractProgress,
  FfmpegStatus,
  ProjectMeta,
} from "../types";

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
