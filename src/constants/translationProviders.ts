import type {
  TranslationApiType,
  TranslationProviderSettings,
} from "@/types";

export const TRANSLATION_API_TYPES: Array<{
  value: TranslationApiType;
  label: string;
}> = [
  { value: "openai-compatible", label: "OpenAI 兼容" },
  { value: "gemini", label: "Gemini" },
  { value: "anthropic", label: "Anthropic" },
];

export const TRANSLATION_API_DEFAULT_URLS: Record<TranslationApiType, string> = {
  "openai-compatible": "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "https://api.anthropic.com/v1",
};

export const TRANSLATION_PROVIDER_LIMITS = {
  maxConcurrency: { min: 1, max: 50, defaultValue: 1 },
  requestsPerMinute: { min: 1, max: 100, defaultValue: 10 },
} as const;

export function clampProviderInteger(
  value: number,
  limits: { min: number; max: number; defaultValue: number },
): number {
  if (!Number.isFinite(value)) return limits.defaultValue;
  return Math.min(limits.max, Math.max(limits.min, Math.trunc(value)));
}

export function createTranslationProviderSettings(
  id: string = crypto.randomUUID(),
): TranslationProviderSettings {
  return {
    id,
    name: "",
    apiType: "openai-compatible",
    baseUrl: TRANSLATION_API_DEFAULT_URLS["openai-compatible"],
    apiKey: "",
    model: "",
    maxConcurrency: TRANSLATION_PROVIDER_LIMITS.maxConcurrency.defaultValue,
    requestsPerMinute:
      TRANSLATION_PROVIDER_LIMITS.requestsPerMinute.defaultValue,
  };
}

export function isTranslationProviderReady(
  provider: TranslationProviderSettings | undefined,
): provider is TranslationProviderSettings {
  return Boolean(
    provider?.name.trim() &&
      provider.baseUrl.trim() &&
      provider.apiKey.trim() &&
      provider.model.trim(),
  );
}
