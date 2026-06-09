import { OpenAITranslationProvider } from "./openai";
import type { TranslationProviderConfig } from "./types";
import type { TranslationProvider } from "./base";

export { TranslationProvider } from "./base";
export { OpenAITranslationProvider } from "./openai";
export type {
  TranslationBatch,
  TranslationOptions,
  TranslationProgress,
  TranslationProviderConfig,
  TranslationResult,
} from "./types";

/**
 * 创建翻译提供商实例
 */
export function createTranslationProvider(
  config: TranslationProviderConfig,
): TranslationProvider {
  // 首期仅支持 OpenAI 兼容 API，后续可扩展其他提供商
  return new OpenAITranslationProvider(config);
}
