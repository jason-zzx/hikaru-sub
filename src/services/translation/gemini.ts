import { TranslationProvider } from "./base";
import {
  buildProviderUrl,
  DEFAULT_MODEL_LIST_TIMEOUT,
  fetchWithTimeout,
  providerHttpError,
} from "./http";

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: unknown }>;
    };
  }>;
}

interface GeminiModelsResponse {
  models?: Array<{
    name?: unknown;
    supportedGenerationMethods?: unknown;
  }>;
  nextPageToken?: unknown;
}

const DEFAULT_TEMPERATURE = 0.3;

export class GeminiTranslationProvider extends TranslationProvider {
  async listModels(): Promise<string[]> {
    const models = new Set<string>();
    const seenTokens = new Set<string>();
    let pageToken: string | undefined;

    for (;;) {
      const url = buildProviderUrl(this.config.baseUrl, "models");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await fetchWithTimeout(
        url,
        { method: "GET", headers: this.authHeaders() },
        DEFAULT_MODEL_LIST_TIMEOUT,
      );
      if (!response.ok) {
        throw await providerHttpError(response, [this.config.apiKey]);
      }

      const data = (await response.json()) as GeminiModelsResponse;
      for (const model of data.models ?? []) {
        const methods = Array.isArray(model.supportedGenerationMethods)
          ? model.supportedGenerationMethods
          : [];
        if (
          typeof model.name === "string" &&
          methods.includes("generateContent")
        ) {
          const id = this.normalizeModel(model.name.trim());
          if (id) models.add(id);
        }
      }

      const nextToken =
        typeof data.nextPageToken === "string"
          ? data.nextPageToken.trim()
          : "";
      if (!nextToken) return [...models];
      if (seenTokens.has(nextToken)) {
        throw new Error("Gemini 模型列表分页标记重复");
      }
      seenTokens.add(nextToken);
      pageToken = nextToken;
    }
  }

  protected async generateText(
    systemPrompt: string | undefined,
    userPrompt: string,
    timeout: number,
  ): Promise<string> {
    const model = this.normalizeModel(this.config.model.trim());
    if (!model) throw new Error("Gemini 模型不能为空");

    const body = JSON.stringify({
      ...(systemPrompt
        ? { systemInstruction: { parts: [{ text: systemPrompt }] } }
        : {}),
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: this.config.temperature ?? DEFAULT_TEMPERATURE,
      },
    });
    const response = await fetchWithTimeout(
      buildProviderUrl(
        this.config.baseUrl,
        `models/${encodeURIComponent(model)}:generateContent`,
      ),
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

    const data = (await response.json()) as GeminiGenerateResponse;
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("");
    if (!text.trim()) throw new Error("Gemini 响应缺少文本内容");
    return text;
  }

  private normalizeModel(model: string): string {
    return model.replace(/^models\//, "");
  }

  private authHeaders(): Record<string, string> {
    return { "x-goog-api-key": this.config.apiKey };
  }
}
