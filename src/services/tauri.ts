import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, FfmpegStatus, ProjectMeta } from "../types";

export async function checkFfmpeg(): Promise<FfmpegStatus> {
  return invoke<FfmpegStatus>("check_ffmpeg");
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
