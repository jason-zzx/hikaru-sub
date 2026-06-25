export const ASR_ENGINE_OPTIONS = [
  { value: "faster-whisper", label: "faster-whisper" },
  { value: "parakeet", label: "parakeet" },
  { value: "qwen3-asr", label: "qwen3" },
];

export const ASR_ENGINE_MODELS: Record<string, Array<{ value: string; label: string }>> = {
  "faster-whisper": ["tiny", "base", "small", "medium", "large-v2", "large-v3"].map((m) => ({
    value: m,
    label: m,
  })),
  parakeet: [
    {
      value: "nvidia/parakeet-tdt_ctc-0.6b-ja",
      label: "parakeet-tdt_ctc-0.6b-ja",
    },
  ],
  "qwen3-asr": [
    {
      value: "Qwen/Qwen3-ASR-1.7B",
      label: "Qwen3-ASR-1.7B",
    },
  ],
};

export function defaultAsrModel(engine: string): string {
  return ASR_ENGINE_MODELS[engine]?.[0]?.value ?? "large-v3";
}

export function asrModelOptions(engine: string): Array<{ value: string; label: string }> {
  return ASR_ENGINE_MODELS[engine] ?? ASR_ENGINE_MODELS["faster-whisper"];
}
