import type { SubtitleCue } from "../../types";

/** 翻译批次（用于 API 调用） */
export interface TranslationBatch {
  /** 待翻译的 cue 列表 */
  cues: SubtitleCue[];
  /** 前文上下文（用于术语一致性） */
  contextBefore: SubtitleCue[];
  /** 后文上下文（用于术语一致性） */
  contextAfter: SubtitleCue[];
}

/** 翻译选项 */
export interface TranslationOptions {
  sourceLang: string;
  targetLang: string;
  /** 自定义术语表（可选） */
  glossary?: Record<string, string>;
  /** 上下文窗口大小（前后各 N 条）*/
  contextWindow?: number;
  /** 每批翻译条数 */
  batchSize?: number;
  /** 自定义额外 prompt */
  customPrompt?: string;
  /** API 超时（毫秒） */
  timeout?: number;
}

/** 翻译提供商配置 */
export interface TranslationProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
}

/** 翻译进度回调 */
export interface TranslationProgress {
  /** 已完成批次数 */
  completedBatches: number;
  /** 总批次数 */
  totalBatches: number;
  /** 已翻译 cue 数 */
  completedCues: number;
  /** 总 cue 数 */
  totalCues: number;
  /** 0~1 */
  progress: number;
  /** 当前批次信息（可选） */
  currentBatch?: string;
}

/** 翻译结果 */
export interface TranslationResult {
  /** 翻译后的 cue 列表（含 secondaryText） */
  cues: SubtitleCue[];
  /** 成功数 */
  successCount: number;
  /** 失败数（未能翻译的 cue） */
  failedCount: number;
  /** 错误信息（如果有） */
  errors: string[];
}
