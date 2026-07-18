import type { SubtitleCue } from "../../types";
import { RequestScheduler } from "./requestScheduler";
import type {
  TranslationOptions,
  TranslationProgress,
  TranslationProviderConfig,
  TranslationResult,
} from "./types";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_CONTEXT_WINDOW = 2;
const DEFAULT_TIMEOUT = 60_000;

interface TranslationBatch {
  cues: SubtitleCue[];
  contextBefore: SubtitleCue[];
  contextAfter: SubtitleCue[];
}

interface BatchResult {
  cues: SubtitleCue[];
  successCount: number;
  errors: string[];
}

export abstract class TranslationProvider {
  protected readonly config: TranslationProviderConfig;
  private readonly scheduler: RequestScheduler;

  constructor(config: TranslationProviderConfig) {
    if (!config.apiKey.trim()) {
      throw new Error("API Key 不能为空");
    }
    this.config = config;
    this.scheduler = new RequestScheduler(
      config.maxConcurrency,
      config.requestsPerMinute,
    );
  }

  abstract listModels(): Promise<string[]>;

  protected abstract generateText(
    systemPrompt: string | undefined,
    userPrompt: string,
    timeout: number,
  ): Promise<string>;

  async translateBatch(
    cues: SubtitleCue[],
    options: TranslationOptions,
    onProgress?: (progress: TranslationProgress) => void,
  ): Promise<TranslationResult> {
    const batchSize = Math.max(
      1,
      Math.trunc(options.batchSize ?? DEFAULT_BATCH_SIZE),
    );
    const contextWindow = Math.max(
      0,
      Math.trunc(options.contextWindow ?? DEFAULT_CONTEXT_WINDOW),
    );
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const totalBatches = Math.ceil(cues.length / batchSize);

    if (cues.length === 0) {
      onProgress?.({
        completedBatches: 0,
        totalBatches: 0,
        completedCues: 0,
        totalCues: 0,
        progress: 1,
      });
      return { cues: [], successCount: 0, failedCount: 0, errors: [] };
    }

    const batchResults = new Array<BatchResult>(totalBatches);
    let completedBatches = 0;
    let completedCues = 0;

    onProgress?.({
      completedBatches,
      totalBatches,
      completedCues,
      totalCues: cues.length,
      progress: 0,
      currentBatch: `等待翻译（共 ${totalBatches} 批次）`,
    });

    await Promise.all(
      Array.from({ length: totalBatches }, async (_, batchIndex) => {
        const start = batchIndex * batchSize;
        const batchCues = cues.slice(start, start + batchSize);
        const batch: TranslationBatch = {
          cues: batchCues,
          contextBefore: cues.slice(Math.max(0, start - contextWindow), start),
          contextAfter: cues.slice(
            start + batchSize,
            start + batchSize + contextWindow,
          ),
        };

        batchResults[batchIndex] = await this.translateOneBatch(
          batch,
          batchIndex,
          options,
          timeout,
        );
        completedBatches += 1;
        completedCues += batchCues.length;
        onProgress?.({
          completedBatches,
          totalBatches,
          completedCues,
          totalCues: cues.length,
          progress: completedCues / cues.length,
          currentBatch: `已完成 ${completedBatches}/${totalBatches} 批次`,
        });
      }),
    );

    const translatedCues = batchResults.flatMap((result) => result.cues);
    const successCount = batchResults.reduce(
      (total, result) => total + result.successCount,
      0,
    );
    return {
      cues: translatedCues,
      successCount,
      failedCount: cues.length - successCount,
      errors: batchResults.flatMap((result) => result.errors),
    };
  }

  async translateSingle(
    cue: SubtitleCue,
    options: TranslationOptions,
  ): Promise<string> {
    const sourceName = this.getLangName(options.sourceLang);
    const targetName = this.getLangName(options.targetLang);
    const prompt = `请将以下${sourceName}字幕翻译为${targetName}，只返回翻译结果，不要添加其他内容：\n\n${cue.primaryText}`;
    const response = await this.scheduleGeneration(
      undefined,
      prompt,
      options.timeout ?? 30_000,
    );
    return response.trim();
  }

  private async translateOneBatch(
    batch: TranslationBatch,
    batchIndex: number,
    options: TranslationOptions,
    timeout: number,
  ): Promise<BatchResult> {
    try {
      const response = await this.scheduleGeneration(
        this.buildSystemPrompt(options),
        this.buildBatchPrompt(batch),
        timeout,
      );
      const translations = this.parseTranslationResponse(
        response,
        batch.cues.length,
      );
      if (!translations) {
        throw new Error("响应索引或 JSON 格式无效");
      }
      return {
        cues: batch.cues.map((cue, index) => ({
          ...cue,
          secondaryText: translations[index].trim(),
        })),
        successCount: batch.cues.length,
        errors: [],
      };
    } catch (error) {
      const errors = [
        `批次 ${batchIndex + 1} 失败，尝试逐条翻译: ${this.errorMessage(error)}`,
      ];
      let successCount = 0;
      const fallbackCues = await Promise.all(
        batch.cues.map(async (cue) => {
          try {
            const translation = await this.translateSingle(cue, options);
            successCount += 1;
            return { ...cue, secondaryText: translation };
          } catch (fallbackError) {
            errors.push(
              `单条翻译失败 [${cue.id}]: ${this.errorMessage(fallbackError)}`,
            );
            return { ...cue };
          }
        }),
      );
      return { cues: fallbackCues, successCount, errors };
    }
  }

  private scheduleGeneration(
    systemPrompt: string | undefined,
    userPrompt: string,
    timeout: number,
  ): Promise<string> {
    return this.scheduler.schedule(() =>
      this.generateText(systemPrompt, userPrompt, timeout),
    );
  }

  private buildSystemPrompt(options: TranslationOptions): string {
    const sourceName = this.getLangName(options.sourceLang);
    const targetName = this.getLangName(options.targetLang);
    let prompt = `你是专业的字幕翻译助手。你的任务是将${sourceName}字幕翻译为${targetName}。

翻译要求：
1. 准确传达原意，符合${targetName}表达习惯
2. 保持字幕简洁，适合屏幕显示
3. 保留原文的语气和风格
4. 不要添加解释或额外信息
5. 严格按照 JSON 格式返回结果`;

    if (options.glossary && Object.keys(options.glossary).length > 0) {
      prompt += "\n\n术语表（优先使用以下译法）：\n";
      for (const [source, target] of Object.entries(options.glossary)) {
        prompt += `- ${source} → ${target}\n`;
      }
    }
    if (options.customPrompt?.trim()) {
      prompt += `\n\n${options.customPrompt.trim()}`;
    }
    return prompt;
  }

  private buildBatchPrompt(batch: TranslationBatch): string {
    let prompt = "请翻译以下字幕：\n\n";
    if (batch.contextBefore.length > 0) {
      prompt += "[前文参考（仅供参考，不需翻译）]\n";
      prompt += `${batch.contextBefore.map((cue) => cue.primaryText).join("\n")}\n\n`;
    }

    prompt += "[待翻译内容]\n";
    prompt += JSON.stringify(
      batch.cues.map((cue, index) => ({ index, text: cue.primaryText })),
      null,
      2,
    );

    if (batch.contextAfter.length > 0) {
      prompt += "\n\n[后文参考（仅供参考，不需翻译）]\n";
      prompt += batch.contextAfter.map((cue) => cue.primaryText).join("\n");
    }

    return `${prompt}\n\n请返回 JSON 数组格式，每个元素包含 index 和 translation 字段。`;
  }

  private parseTranslationResponse(
    responseText: string,
    expectedCount: number,
  ): string[] | null {
    try {
      const jsonMatch = responseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      const parsed: unknown = JSON.parse(jsonMatch?.[0] ?? responseText);
      if (!Array.isArray(parsed) || parsed.length !== expectedCount) return null;

      const translations = new Array<string>(expectedCount);
      const seen = new Set<number>();
      for (const item of parsed) {
        if (
          typeof item !== "object" ||
          item === null ||
          !("index" in item) ||
          !("translation" in item)
        ) {
          return null;
        }
        const { index, translation } = item as {
          index: unknown;
          translation: unknown;
        };
        if (
          typeof index !== "number" ||
          !Number.isInteger(index) ||
          index < 0 ||
          index >= expectedCount ||
          seen.has(index) ||
          typeof translation !== "string" ||
          !translation.trim()
        ) {
          return null;
        }
        seen.add(index);
        translations[index] = translation;
      }
      return seen.size === expectedCount ? translations : null;
    } catch {
      return null;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

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
