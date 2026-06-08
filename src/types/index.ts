export type WorkflowStep =
  | "welcome"
  | "import"
  | "transcribe"
  | "translate"
  | "editor"
  | "burn"
  | "settings";

export interface AsrConfig {
  engine: string;
  model: string;
  device: "cpu" | "cuda" | "auto";
}

export interface TranslationConfig {
  provider: string;
  baseUrl: string;
  model: string;
  temperature?: number;
}

export interface ProjectMeta {
  version: number;
  videoPath: string;
  audioPath?: string;
  assPath?: string;
  sourceLang: string;
  targetLang: string;
  asr: AsrConfig;
  translation: TranslationConfig;
}

export interface SubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  primaryText: string;
  secondaryText?: string;
  style: string;
  layer: number;
}

export interface AppSettings {
  ffmpegPath?: string;
  pythonPath?: string;
  asrServicePath?: string;
  defaultSourceLang: string;
  defaultTargetLang: string;
}

export interface FfmpegStatus {
  available: boolean;
  path: string;
  version?: string;
}
