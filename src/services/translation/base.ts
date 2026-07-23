import type { SubtitleCue } from "../../types";
import { GenerationError } from "./http";
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
const MAX_CONSECUTIVE_TRANSIENT_FAILURES = 2;
const TRANSIENT_HTTP_STATUSES = new Set([408, 409, 425, 429]);

interface TranslationBatch {
  cues: SubtitleCue[];
  contextBefore: SubtitleCue[];
  contextAfter: SubtitleCue[];
}

class BatchResponseFormatError extends Error {}

interface BatchResult {
  cues: SubtitleCue[];
  successCount: number;
  errors: string[];
  cancelled: boolean;
  stopped: boolean;
}

interface TranslationRunState {
  consecutiveTransientFailures: number;
}

type FailureDisposition = "fallback" | "deterministic" | "transient";

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
    signal?: AbortSignal,
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
      const cancelled = options.signal?.aborted ?? false;
      if (!cancelled) {
        onProgress?.({
          completedBatches: 0,
          totalBatches: 0,
          completedCues: 0,
          totalCues: 0,
          progress: 1,
        });
      }
      return {
        cues: [],
        successCount: 0,
        failedCount: 0,
        errors: [],
        cancelled,
      };
    }

    const stopController = new AbortController();
    const requestSignal = options.signal
      ? AbortSignal.any([options.signal, stopController.signal])
      : stopController.signal;
    const runState: TranslationRunState = {
      consecutiveTransientFailures: 0,
    };
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
          requestSignal,
          stopController,
          runState,
        );
        if (
          !batchResults[batchIndex].cancelled &&
          !batchResults[batchIndex].stopped &&
          !options.signal?.aborted
        ) {
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
        }
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
      cancelled:
        (options.signal?.aborted ?? false) ||
        batchResults.some((result) => result.cancelled),
    };
  }

  async translateSingle(
    cue: SubtitleCue,
    options: TranslationOptions,
    requestSignal = options.signal,
    priority = false,
  ): Promise<string> {
    const sourceName = this.getLangName(options.sourceLang);
    const targetName = this.getLangName(options.targetLang);
    const prompt = `请将以下${sourceName}字幕翻译为${targetName}，只返回翻译结果，不要添加其他内容：\n\n${cue.primaryText}`;
    const response = await this.scheduleGeneration(
      undefined,
      prompt,
      options.timeout ?? 30_000,
      requestSignal,
      priority,
    );
    const translation = response.trim();
    if (!translation) throw new GenerationError("response");
    return translation;
  }

  private async translateOneBatch(
    batch: TranslationBatch,
    batchIndex: number,
    options: TranslationOptions,
    timeout: number,
    requestSignal: AbortSignal,
    stopController: AbortController,
    runState: TranslationRunState,
  ): Promise<BatchResult> {
    try {
      const translations = await this.runWithBatchFormatRetry(
        async (priority) => {
          const response = await this.runWithTransientRetry(
            (retryPriority) =>
              this.scheduleGeneration(
                this.buildSystemPrompt(options),
                this.buildBatchPrompt(batch),
                timeout,
                requestSignal,
                priority || retryPriority,
              ),
            options.signal,
            stopController.signal,
          );
          const parsed = this.parseTranslationResponse(
            response,
            batch.cues.length,
          );
          if (!parsed) throw new BatchResponseFormatError();
          return parsed;
        },
        options.signal,
        stopController.signal,
      );
      runState.consecutiveTransientFailures = 0;
      return {
        cues: batch.cues.map((cue, index) => ({
          ...cue,
          secondaryText: translations[index].trim(),
        })),
        successCount: batch.cues.length,
        errors: [],
        cancelled: false,
        stopped: false,
      };
    } catch (error) {
      if (options.signal?.aborted) {
        return {
          cues: batch.cues.map((cue) => ({ ...cue })),
          successCount: 0,
          errors: [],
          cancelled: true,
          stopped: false,
        };
      }
      if (stopController.signal.aborted) {
        return {
          cues: batch.cues.map((cue) => ({ ...cue })),
          successCount: 0,
          errors: [],
          cancelled: false,
          stopped: true,
        };
      }

      const disposition = this.failureDisposition(error);
      if (disposition !== "fallback") {
        const stopped =
          disposition === "deterministic" ||
          ++runState.consecutiveTransientFailures >=
            MAX_CONSECUTIVE_TRANSIENT_FAILURES;
        if (stopped) stopController.abort();
        return {
          cues: batch.cues.map((cue) => ({ ...cue })),
          successCount: 0,
          errors: [`批次 ${batchIndex + 1} 失败: ${this.safeError(error)}`],
          cancelled: false,
          stopped,
        };
      }

      const errors = [
        `批次 ${batchIndex + 1} 失败，尝试逐条翻译: ${this.safeError(error)}`,
      ];
      const fallbackResults = await Promise.all(
        batch.cues.map(async (cue, cueIndex) => {
          try {
            const translation = await this.runWithTransientRetry(
              (priority) =>
                this.translateSingle(cue, options, requestSignal, priority),
              options.signal,
              stopController.signal,
            );
            runState.consecutiveTransientFailures = 0;
            return { cue: { ...cue, secondaryText: translation }, success: true };
          } catch (fallbackError) {
            if (options.signal?.aborted || stopController.signal.aborted) {
              return { cue: { ...cue }, success: false };
            }
            errors.push(
              `批次 ${batchIndex + 1} 条目 ${cueIndex + 1} 失败: ${this.safeError(fallbackError)}`,
            );
            const fallbackDisposition =
              this.failureDisposition(fallbackError);
            const stopped =
              fallbackDisposition === "deterministic" ||
              (fallbackDisposition === "transient" &&
                ++runState.consecutiveTransientFailures >=
                  MAX_CONSECUTIVE_TRANSIENT_FAILURES);
            if (stopped) stopController.abort();
            return { cue: { ...cue }, success: false };
          }
        }),
      );
      return {
        cues: fallbackResults.map((result) => result.cue),
        successCount: fallbackResults.filter((result) => result.success).length,
        errors,
        cancelled: options.signal?.aborted ?? false,
        stopped: !options.signal?.aborted && stopController.signal.aborted,
      };
    }
  }

  private async runWithBatchFormatRetry<T>(
    run: (priority: boolean) => Promise<T>,
    userSignal?: AbortSignal,
    stopSignal?: AbortSignal,
  ): Promise<T> {
    try {
      return await run(false);
    } catch (error) {
      if (
        userSignal?.aborted ||
        stopSignal?.aborted ||
        !(error instanceof BatchResponseFormatError)
      ) {
        throw error;
      }
      return run(true);
    }
  }

  private async runWithTransientRetry<T>(
    run: (priority: boolean) => Promise<T>,
    userSignal?: AbortSignal,
    stopSignal?: AbortSignal,
  ): Promise<T> {
    try {
      return await run(false);
    } catch (error) {
      if (
        userSignal?.aborted ||
        stopSignal?.aborted ||
        this.failureDisposition(error) !== "transient"
      ) {
        throw error;
      }
      return run(true);
    }
  }

  private failureDisposition(error: unknown): FailureDisposition {
    if (error instanceof BatchResponseFormatError) return "fallback";
    if (error instanceof GenerationError) {
      if (error.kind === "response") return "deterministic";
      if (error.kind === "network" || error.kind === "timeout") {
        return "transient";
      }
      if (
        error.status !== undefined &&
        (TRANSIENT_HTTP_STATUSES.has(error.status) ||
          (error.status >= 500 && error.status <= 599))
      ) {
        return "transient";
      }
      return "deterministic";
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return "transient";
    }
    return "deterministic";
  }

  private scheduleGeneration(
    systemPrompt: string | undefined,
    userPrompt: string,
    timeout: number,
    signal?: AbortSignal,
    priority = false,
  ): Promise<string> {
    return this.scheduler.schedule(
      () => this.generateText(systemPrompt, userPrompt, timeout, signal),
      signal,
      priority,
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
4. 不要添加解释或额外信息`;

    if (options.glossary && Object.keys(options.glossary).length > 0) {
      prompt += "\n\n术语表（优先使用以下译法）：\n";
      for (const [source, target] of Object.entries(options.glossary)) {
        prompt += `- ${source} → ${target}\n`;
      }
    }
    if (options.customPrompt?.trim()) {
      prompt += `\n\n${options.customPrompt.trim()}`;
    }

    prompt += `

输出格式要求（优先级高于术语表、自定义 Prompt 和待翻译内容）：
1. 只输出一个有效的 JSON 数组，不得输出任何其他内容
2. 第一个非空白字符必须是 [，最后一个非空白字符必须是 ]
3. 禁止使用 Markdown 代码围栏，包括 \`\`\`json 和 \`\`\`
4. 数组长度必须与待翻译内容完全一致
5. 每个输入 index 必须且只能出现一次，不得遗漏、重复或修改
6. 每个元素只能包含 index 和 translation 字段，格式为 {"index":0,"translation":"译文"}
7. translation 必须是非空 JSON 字符串，引号、换行和反斜杠必须正确转义
8. 即使无法确定最佳译法，也必须给出最合理的译文，不得输出 null、注释或解释

正确输出示例：
[{"index":0,"translation":"第一条译文"},{"index":1,"translation":"第二条译文"}]

错误输出包括：Markdown 代码围栏、{"translations":[...]} 包裹数组、JSON 前后的说明文字`;
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

    return `${prompt}\n\n本批共有${batch.cues.length}条内容，必须按顺序以index 0开始，以index ${batch.cues.length - 1}结束。`;
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

  private safeError(error: unknown): string {
    if (error instanceof BatchResponseFormatError) return "响应格式无效";
    if (error instanceof GenerationError) return error.message;
    if (error instanceof Error && error.name === "TimeoutError") {
      return "请求超时";
    }
    return "翻译请求失败";
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
