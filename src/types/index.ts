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
  asrEngine: string;
  asrModel: string;
  asrDevice: string;
  translationBaseUrl: string;
  translationModel: string;
  translationApiKey?: string;
  defaultSourceLang: string;
  defaultTargetLang: string;
  translationBatchSize: number;
  translationContextWindow: number;
  translationCustomPrompt?: string;
  translationGlossary?: string;
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

/** ASR sidecar 输出的时间片段（与 ass-core AsrSegment 同构）。 */
export interface AsrSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface AsrEngineInfo {
  name: string;
  /** 依赖是否就绪（如 faster-whisper 是否已安装） */
  available: boolean;
}

export type AsrJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AsrJobSnapshot {
  id: string;
  status: AsrJobStatus;
  /** 0~1 */
  progress: number;
  durationMs: number;
  processedMs: number;
  segmentCount: number;
  detectedLanguage: string | null;
  error: string | null;
  /** 仅在请求包含片段时返回 */
  segments?: AsrSegment[];
}

export interface StartAsrArgs {
  audioPath: string;
  engine: string;
  model: string;
  device: string;
  language?: string | null;
}

/** ASR 模型在本地缓存中的就绪状态。 */
export interface AsrModelStatus {
  engine: string;
  model: string;
  /** 引擎依赖是否就绪（不就绪时无法检测/下载） */
  available: boolean;
  /** 模型文件是否已在本地缓存 */
  downloaded: boolean;
}

export type ModelDownloadStatus = "running" | "completed" | "failed";

export interface ModelDownloadSnapshot {
  id: string;
  status: ModelDownloadStatus;
  /** 0~1，总大小未知时为 0 */
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
}

export interface VideoInfo {
  width: number;
  height: number;
  durationMs: number;
}
