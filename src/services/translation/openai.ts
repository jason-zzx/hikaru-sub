import type { SubtitleCue } from "../../types";
import { TranslationProvider } from "./base";
import type {
  TranslationBatch,
  TranslationOptions,
  TranslationProgress,
  TranslationResult,
} from "./types";

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_CONTEXT_WINDOW = 2;
const DEFAULT_TIMEOUT = 60000;
const DEFAULT_TEMPERATURE = 0.3;

/**
 * OpenAI 兼容 API 翻译适配器
 * 支持：OpenAI、DeepSeek、Ollama、自建网关等
 */
export class OpenAITranslationProvider extends TranslationProvider {
  private buildSystemPrompt(options: TranslationOptions): string {
    const { sourceLang, targetLang, glossary, customPrompt } = options;
    const sourceName = this.getLangName(sourceLang);
    const targetName = this.getLangName(targetLang);

    let prompt = `你是专业的字幕翻译助手。你的任务是将${sourceName}字幕翻译为${targetName}。

翻译要求：
1. 准确传达原意，符合${targetName}表达习惯
2. 保持字幕简洁，适合屏幕显示
3. 保留原文的语气和风格
4. 不要添加解释或额外信息
5. 严格按照 JSON 格式返回结果`;

    if (glossary && Object.keys(glossary).length > 0) {
      prompt += "\n\n术语表（优先使用以下译法）：\n";
      for (const [src, tgt] of Object.entries(glossary)) {
        prompt += `- ${src} → ${tgt}\n`;
      }
    }

    if (customPrompt && customPrompt.trim()) {
      prompt += "\n\n" + customPrompt.trim();
    }

    return prompt;
  }

  private buildBatchPrompt(batch: TranslationBatch): string {
    const { cues, contextBefore, contextAfter } = batch;

    let prompt = "请翻译以下字幕：\n\n";

    // 添加前文上下文
    if (contextBefore.length > 0) {
      prompt += "[前文参考（仅供参考，不需翻译）]\n";
      for (const ctx of contextBefore) {
        prompt += `${ctx.primaryText}\n`;
      }
      prompt += "\n";
    }

    // 待翻译内容
    prompt += "[待翻译内容]\n";
    const inputData = cues.map((c, idx) => ({
      index: idx,
      text: c.primaryText,
    }));
    prompt += JSON.stringify(inputData, null, 2);

    // 添加后文上下文
    if (contextAfter.length > 0) {
      prompt += "\n\n[后文参考（仅供参考，不需翻译）]\n";
      for (const ctx of contextAfter) {
        prompt += `${ctx.primaryText}\n`;
      }
    }

    prompt += `\n\n请返回 JSON 数组格式，每个元素包含 index 和 translation 字段。
示例格式：
[
  {"index": 0, "translation": "翻译结果1"},
  {"index": 1, "translation": "翻译结果2"}
]`;

    return prompt;
  }

  private async callChatAPI(
    messages: OpenAIChatMessage[],
    timeout: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey && {
            Authorization: `Bearer ${this.config.apiKey}`,
          }),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: this.config.temperature ?? DEFAULT_TEMPERATURE,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "unknown error");
        throw new Error(`API 错误 ${response.status}: ${errText}`);
      }

      const data: OpenAIChatResponse = await response.json();
      return data.choices[0]?.message?.content || "";
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseTranslationResponse(
    responseText: string,
    expectedCount: number,
  ): Array<{ index: number; translation: string }> | null {
    try {
      // 尝试提取 JSON 数组（有时模型会在前后加说明文字）
      const jsonMatch = responseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      const jsonText = jsonMatch ? jsonMatch[0] : responseText;
      const parsed = JSON.parse(jsonText);

      if (!Array.isArray(parsed)) return null;
      if (parsed.length !== expectedCount) return null;

      // 验证格式
      for (const item of parsed) {
        if (
          typeof item.index !== "number" ||
          typeof item.translation !== "string"
        ) {
          return null;
        }
      }

      return parsed;
    } catch {
      return null;
    }
  }

  async translateBatch(
    cues: SubtitleCue[],
    options: TranslationOptions,
    onProgress?: (progress: TranslationProgress) => void,
  ): Promise<TranslationResult> {
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;

    const totalBatches = Math.ceil(cues.length / batchSize);
    const results: SubtitleCue[] = [];
    const errors: string[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < cues.length; i += batchSize) {
      const batchIndex = Math.floor(i / batchSize);
      const batchCues = cues.slice(i, i + batchSize);

      // 构造上下文
      const contextBefore = cues.slice(
        Math.max(0, i - contextWindow),
        i,
      );
      const contextAfter = cues.slice(
        i + batchSize,
        i + batchSize + contextWindow,
      );

      const batch: TranslationBatch = {
        cues: batchCues,
        contextBefore,
        contextAfter,
      };

      onProgress?.({
        completedBatches: batchIndex,
        totalBatches,
        completedCues: results.length,
        totalCues: cues.length,
        progress: results.length / cues.length,
        currentBatch: `批次 ${batchIndex + 1}/${totalBatches}（${batchCues.length} 条）`,
      });

      try {
        const systemPrompt = this.buildSystemPrompt(options);
        const userPrompt = this.buildBatchPrompt(batch);

        const responseText = await this.callChatAPI(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          timeout,
        );

        const parsed = this.parseTranslationResponse(
          responseText,
          batchCues.length,
        );

        if (parsed) {
          // 批次成功
          for (const item of parsed) {
            const cue = batchCues[item.index];
            if (cue) {
              results.push({
                ...cue,
                secondaryText: item.translation.trim(),
              });
              successCount++;
            }
          }
        } else {
          // 批次失败，逐条重试
          errors.push(`批次 ${batchIndex + 1} 解析失败，尝试逐条翻译`);
          for (const cue of batchCues) {
            try {
              const translation = await this.translateSingle(cue, options);
              results.push({ ...cue, secondaryText: translation });
              successCount++;
            } catch (err) {
              errors.push(
                `单条翻译失败 [${cue.id}]: ${err instanceof Error ? err.message : String(err)}`,
              );
              results.push({ ...cue }); // 保留原文
              failedCount++;
            }
          }
        }
      } catch (err) {
        // 批次完全失败，逐条重试
        errors.push(
          `批次 ${batchIndex + 1} API 调用失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        for (const cue of batchCues) {
          try {
            const translation = await this.translateSingle(cue, options);
            results.push({ ...cue, secondaryText: translation });
            successCount++;
          } catch (retryErr) {
            errors.push(
              `单条翻译失败 [${cue.id}]: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
            );
            results.push({ ...cue }); // 保留原文
            failedCount++;
          }
        }
      }
    }

    // 最终进度
    onProgress?.({
      completedBatches: totalBatches,
      totalBatches,
      completedCues: results.length,
      totalCues: cues.length,
      progress: 1,
    });

    return { cues: results, successCount, failedCount, errors };
  }

  async translateSingle(
    cue: SubtitleCue,
    options: TranslationOptions,
  ): Promise<string> {
    const { sourceLang, targetLang } = options;
    const sourceName = this.getLangName(sourceLang);
    const targetName = this.getLangName(targetLang);

    const prompt = `请将以下${sourceName}字幕翻译为${targetName}，只返回翻译结果，不要添加其他内容：

${cue.primaryText}`;

    const responseText = await this.callChatAPI(
      [{ role: "user", content: prompt }],
      30000,
    );

    return responseText.trim();
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.callChatAPI(
        [{ role: "user", content: "测试连接，请回复 OK" }],
        10000,
      );
      if (response) {
        return { success: true, message: "连接成功" };
      }
      return { success: false, message: "API 无响应" };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
