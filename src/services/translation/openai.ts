import { TranslationProvider } from "./base";
import {
  buildProviderUrl,
  DEFAULT_MODEL_LIST_TIMEOUT,
  fetchWithTimeout,
  providerHttpError,
} from "./http";

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

interface OpenAIModelsResponse {
  data?: Array<{ id?: unknown }>;
}

const DEFAULT_TEMPERATURE = 0.3;

/** OpenAI、DeepSeek、Ollama 和自建 Chat Completions 网关。 */
export class OpenAITranslationProvider extends TranslationProvider {
  async listModels(): Promise<string[]> {
    const response = await fetchWithTimeout(
      buildProviderUrl(this.config.baseUrl, "models"),
      {
        method: "GET",
        headers: this.authHeaders(),
      },
      DEFAULT_MODEL_LIST_TIMEOUT,
    );
    if (!response.ok) {
      throw await providerHttpError(response, [this.config.apiKey]);
    }

    const data = (await response.json()) as OpenAIModelsResponse;
    return [
      ...new Set(
        (data.data ?? [])
          .map((model) =>
            typeof model.id === "string" ? model.id.trim() : "",
          )
          .filter(Boolean),
      ),
    ];
  }

  protected async generateText(
    systemPrompt: string | undefined,
    userPrompt: string,
    timeout: number,
  ): Promise<string> {
    const messages = [
      ...(systemPrompt
        ? [{ role: "system" as const, content: systemPrompt }]
        : []),
      { role: "user" as const, content: userPrompt },
    ];
    const body = JSON.stringify({
      model: this.config.model,
      messages,
      temperature: this.config.temperature ?? DEFAULT_TEMPERATURE,
    });
    const response = await fetchWithTimeout(
      buildProviderUrl(this.config.baseUrl, "chat/completions"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
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

    const data = (await response.json()) as OpenAIChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("API 响应缺少文本内容");
    }
    return content;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}` };
  }
}
