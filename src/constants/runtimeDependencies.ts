import type {
  RuntimeDependencyKind,
  RuntimeDependencySourceMode,
} from "../types";

export const RUNTIME_DEPENDENCY_LABEL: Record<RuntimeDependencyKind, string> = {
  ffmpeg: "FFmpeg",
  nativeAsrCpu: "CPU 运行依赖",
  nativeAsrCuda: "CUDA 运行依赖",
  crispasrCpu: "CPU 运行依赖",
  crispasrCuda: "CUDA 运行依赖",
  asrModels: "ASR 模型缓存",
  downloads: "临时下载缓存",
  appCache: "应用缓存",
};

export const RUNTIME_SOURCE_MODE_LABEL: Record<
  RuntimeDependencySourceMode,
  string
> = {
  official: "官方源",
  china: "中国大陆镜像",
};

export function formatDependencyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];

  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}
