import { TranslationProvider } from "./base";
import {
  buildProviderUrl,
  DEFAULT_MODEL_LIST_TIMEOUT,
  fetchWithTimeout,
  providerHttpError,
} from "./http";

interface AnthropicMessageResponse {
  content?: Array<{
    type?: unknown;
    text?: unknown;
  }>;
}

interface AnthropicModelsResponse {
  data?: Array<{ id?: unknown }>;
  has_more?: unknown;
  last_id?: unknown;
}

const DEFAULT_TEMPERATURE = 0.3;

export class AnthropicTranslationProvider extends TranslationProvider {
  async listModels(): Promise<string[]> {
    const models = new Set<string>();
    const seenCursors = new Set<string>();
    let afterId: string | undefined;

    for (;;) {
      const url = buildProviderUrl(this.config.baseUrl, "models");
      url.searchParams.set("limit", "100");
      if (afterId) url.searchParams.set("after_id", afterId);
      const response = await fetchWithTimeout(
        url,
        { method: "GET", headers: this.headers() },
        DEFAULT_MODEL_LIST_TIMEOUT,
      );
      if (!response.ok) {
        throw await providerHttpError(response, [this.config.apiKey]);
      }

      const data = (await response.json()) as AnthropicModelsResponse;
      for (const model of data.data ?? []) {
        if (typeof model.id === "string" && model.id.trim()) {
          models.add(model.id.trim());
        }
      }

      if (data.has_more !== true) return [...models];
      const nextCursor =
        typeof data.last_id === "string" ? data.last_id.trim() : "";
      if (!nextCursor || seenCursors.has(nextCursor)) {
        throw new Error("Anthropic 模型列表分页标记无效");
      }
      seenCursors.add(nextCursor);
      afterId = nextCursor;
    }
  }

  protected async generateText(
    systemPrompt: string | undefined,
    userPrompt: string,
    timeout: number,
  ): Promise<string> {
    const body = JSON.stringify({
      model: this.config.model,
      max_tokens: 4096,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: userPrompt }],
      temperature: this.config.temperature ?? DEFAULT_TEMPERATURE,
    });
    const response = await fetchWithTimeout(
      buildProviderUrl(this.config.baseUrl, "messages"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers(),
        },
        body,
      },
      timeout,
    );
    if (!response.ok) {
      throw await providerHttpError(response, [
        this.config.apiKey,
        body,
        systemPrompt,
        userPrompt,
      ]);
    }

    const data = (await response.json()) as AnthropicMessageResponse;
    const text = (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("");
    if (!text.trim()) throw new Error("Anthropic 响应缺少文本内容");
    return text;
  }

  private headers(): Record<string, string> {
    return {
      "x-api-key": this.config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }
}
