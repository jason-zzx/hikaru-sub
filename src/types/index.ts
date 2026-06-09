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

export type FfmpegSource = "settings" | "bundled" | "system";

export interface FfmpegStatus {
  available: boolean;
  path: string;
  source: FfmpegSource;
  version?: string;
}

export interface AudioExtractProgress {
  /** 已处理时长（毫秒） */
  processedMs: number;
  /** 视频总时长（毫秒），未知时为 0 */
  durationMs: number;
  /** 0~1，总时长未知时为 null */
  percent: number | null;
}
