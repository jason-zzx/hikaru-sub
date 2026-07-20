import type { AsrSetupEnvironment, AsrSetupProfile } from "../types";

export function resolveAsrSetupProfile(
  engine: string,
  device: string,
  env?: Pick<AsrSetupEnvironment, "hasNvidiaGpu"> | null,
): AsrSetupProfile {
  if (engine === "parakeet") {
    if (device === "cuda") return "parakeet-cuda";
    if (device === "cpu") return "parakeet-cpu";
    return env?.hasNvidiaGpu ? "parakeet-cuda" : "parakeet-cpu";
  }
  if (engine === "qwen3-asr") {
    if (device === "cuda") return "qwen3-cuda";
    if (device === "cpu") return "qwen3-cpu";
    return env?.hasNvidiaGpu ? "qwen3-cuda" : "qwen3-cpu";
  }
  if (engine === "reazonspeech-nemo") {
    if (device === "cuda") return "reazonspeech-cuda";
    if (device === "cpu") return "reazonspeech-cpu";
    return env?.hasNvidiaGpu ? "reazonspeech-cuda" : "reazonspeech-cpu";
  }
  return "default";
}

export const ASR_SETUP_PROFILE_LABEL: Record<AsrSetupProfile, string> = {
  default: "faster-whisper / kotoba-faster-whisper 依赖",
  "parakeet-cpu": "Parakeet CPU 依赖",
  "parakeet-cuda": "Parakeet CUDA 依赖",
  "qwen3-cpu": "Qwen3-ASR CPU 依赖",
  "qwen3-cuda": "Qwen3-ASR CUDA 依赖",
  "reazonspeech-cpu": "ReazonSpeech CPU 依赖",
  "reazonspeech-cuda": "ReazonSpeech CUDA 依赖",
};
