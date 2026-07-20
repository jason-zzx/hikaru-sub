export const KOTOBA_FASTER_WHISPER_DESCRIPTION =
  "基于 faster-whisper 的日语优化模型";

export const REAZONSPEECH_NEMO_DESCRIPTION =
  "ReazonSpeech NeMo v2 日语模型：原生整段推理，取消在当前推理返回后生效";

export const ASR_ENGINE_OPTIONS = [
  { value: "faster-whisper", label: "faster-whisper" },
  { value: "kotoba-faster-whisper", label: "kotoba-faster-whisper" },
  { value: "parakeet", label: "parakeet" },
  { value: "qwen3-asr", label: "qwen3" },
  { value: "reazonspeech-nemo", label: "ReazonSpeech NeMo" },
];

export const ASR_ENGINE_MODELS: Record<string, Array<{ value: string; label: string }>> = {
  "faster-whisper": [
    "tiny",
    "base",
    "small",
    "medium",
    "large-v2",
    "large-v3",
    "large-v3-turbo",
  ].map((m) => ({
    value: m,
    label: m,
  })),
  "kotoba-faster-whisper": [
    {
      value: "kotoba-tech/kotoba-whisper-v2.0-faster",
      label: "kotoba-whisper-v2.0-faster",
    },
  ],
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
  "reazonspeech-nemo": [
    {
      value: "reazon-research/reazonspeech-nemo-v2",
      label: "reazonspeech-nemo-v2",
    },
  ],
};

export function defaultAsrModel(engine: string): string {
  if (engine === "faster-whisper") return "large-v3";
  return ASR_ENGINE_MODELS[engine]?.[0]?.value ?? "large-v3";
}

export function asrModelOptions(engine: string): Array<{ value: string; label: string }> {
  return ASR_ENGINE_MODELS[engine] ?? ASR_ENGINE_MODELS["faster-whisper"];
}
