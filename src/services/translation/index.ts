import { AnthropicTranslationProvider } from "./anthropic";
import { GeminiTranslationProvider } from "./gemini";
import { OpenAITranslationProvider } from "./openai";
import type { TranslationProvider } from "./base";
import type { TranslationProviderConfig } from "./types";

export type { TranslationProgress } from "./types";

export function createTranslationProvider(
  config: TranslationProviderConfig,
): TranslationProvider {
  switch (config.apiType) {
    case "gemini":
      return new GeminiTranslationProvider(config);
    case "anthropic":
      return new AnthropicTranslationProvider(config);
    case "openai-compatible":
      return new OpenAITranslationProvider(config);
  }
}
