import type { SubtitleCue } from "../../types";
import type {
  TranslationOptions,
  TranslationProgress,
  TranslationProviderConfig,
  TranslationResult,
} from "./types";

/**
 * 翻译提供商抽象接口
 */
export abstract class TranslationProvider {
  protected config: TranslationProviderConfig;

  constructor(config: TranslationProviderConfig) {
    this.config = config;
  }

  /**
   * 批量翻译字幕条目
   * @param cues 待翻译的 cue 列表
   * @param options 翻译选项
   * @param onProgress 进度回调
   */
  abstract translateBatch(
    cues: SubtitleCue[],
    options: TranslationOptions,
    onProgress?: (progress: TranslationProgress) => void,
  ): Promise<TranslationResult>;

  /**
   * 单条翻译（用于失败重试）
   */
  abstract translateSingle(
    cue: SubtitleCue,
    options: TranslationOptions,
  ): Promise<string>;

  /**
   * 测试连接（验证 API Key 和配置）
   */
  abstract testConnection(): Promise<{ success: boolean; message: string }>;

  /**
   * 获取语言名称（用于提示词）
   */
  protected getLangName(langCode: string): string {
    const langMap: Record<string, string> = {
      ja: "日语",
      en: "英语",
      zh: "中文",
      "zh-CN": "简体中文",
      "zh-TW": "繁体中文",
      ko: "韩语",
      fr: "法语",
      de: "德语",
      es: "西班牙语",
      ru: "俄语",
    };
    return langMap[langCode] || langCode;
  }
}
