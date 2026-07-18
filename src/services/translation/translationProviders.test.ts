import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubtitleCue, TranslationApiType } from "@/types";
import { AnthropicTranslationProvider } from "./anthropic";
import { TranslationProvider } from "./base";
import { GeminiTranslationProvider } from "./gemini";
import { createTranslationProvider } from "./index";
import { OpenAITranslationProvider } from "./openai";
import { RequestScheduler } from "./requestScheduler";
import type {
  TranslationOptions,
  TranslationProviderConfig,
} from "./types";

const syntheticKey = "synthetic-test-key";

function config(
  apiType: TranslationApiType,
  overrides: Partial<TranslationProviderConfig> = {},
): TranslationProviderConfig {
  return {
    apiType,
    baseUrl: "https://api.example.invalid/proxy/v1/",
    apiKey: syntheticKey,
    model: "synthetic-model",
    maxConcurrency: 1,
    requestsPerMinute: 100,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cue(id: string, text: string): SubtitleCue {
  return {
    id,
    startMs: 0,
    endMs: 1000,
    primaryText: text,
    style: "Default",
    layer: 0,
  };
}

const options: TranslationOptions = {
  sourceLang: "ja",
  targetLang: "zh-CN",
  batchSize: 2,
  contextWindow: 0,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("translation provider factory", () => {
  it("dispatches all supported API types", () => {
    expect(createTranslationProvider(config("openai-compatible"))).toBeInstanceOf(
      OpenAITranslationProvider,
    );
    expect(createTranslationProvider(config("gemini"))).toBeInstanceOf(
      GeminiTranslationProvider,
    );
    expect(createTranslationProvider(config("anthropic"))).toBeInstanceOf(
      AnthropicTranslationProvider,
    );
  });

  it("rejects empty API keys at the shared provider boundary", () => {
    expect(() =>
      createTranslationProvider(config("openai-compatible", { apiKey: "  " })),
    ).toThrow("API Key 不能为空");
  });
});

describe("OpenAI-compatible contract", () => {
  it("lists models and sends Chat Completions with optional bearer auth", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return requests.length === 1
          ? jsonResponse({ data: [{ id: "model-a" }, { id: "" }] })
          : jsonResponse({ choices: [{ message: { content: "translated" } }] });
      }),
    );
    const provider = new OpenAITranslationProvider(
      config("openai-compatible"),
    );

    await expect(provider.listModels()).resolves.toEqual(["model-a"]);
    await expect(provider.translateSingle(cue("a", "synthetic source"), options)).resolves.toBe(
      "translated",
    );

    expect(requests[0].url).toBe(
      "https://api.example.invalid/proxy/v1/models",
    );
    expect(new Headers(requests[0].init?.headers).get("Authorization")).toBe(
      `Bearer ${syntheticKey}`,
    );
    expect(requests[1].url).toBe(
      "https://api.example.invalid/proxy/v1/chat/completions",
    );
    const body = JSON.parse(String(requests[1].init?.body));
    expect(body).toMatchObject({ model: "synthetic-model", temperature: 0.3 });
    expect(body.messages).toHaveLength(1);
  });

  it("bounds provider errors and redacts configured credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              message: `${syntheticKey} ${"x".repeat(500)}`,
            },
          },
          401,
        ),
      ),
    );
    const provider = new OpenAITranslationProvider(
      config("openai-compatible"),
    );

    const error = await provider.listModels().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(syntheticKey);
    expect((error as Error).message.length).toBeLessThan(340);
  });

  it("redacts an echoed translation request body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) =>
        jsonResponse(
          { error: { message: `rejected request: ${String(init?.body)}` } },
          400,
        ),
      ),
    );
    const provider = new OpenAITranslationProvider(
      config("openai-compatible"),
    );

    const error = await provider
      .translateSingle(cue("a", "synthetic private source"), options)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("synthetic private source");
    expect((error as Error).message).not.toContain(syntheticKey);
  });
});

describe("Gemini contract", () => {
  it("paginates compatible models and uses native generateContent", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "GET") {
          return url.includes("pageToken=next")
            ? jsonResponse({
                models: [
                  {
                    name: "models/gemini-b",
                    supportedGenerationMethods: ["generateContent"],
                  },
                ],
              })
            : jsonResponse({
                models: [
                  {
                    name: "models/gemini-a",
                    supportedGenerationMethods: ["generateContent"],
                  },
                  {
                    name: "models/embedding-only",
                    supportedGenerationMethods: ["embedContent"],
                  },
                ],
                nextPageToken: "next",
              });
        }
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [{ text: '[{"index":0,"translation":"译文"}]' }],
              },
            },
          ],
        });
      }),
    );
    const provider = new GeminiTranslationProvider(
      config("gemini", { model: "models/gemini-a" }),
    );

    await expect(provider.listModels()).resolves.toEqual([
      "gemini-a",
      "gemini-b",
    ]);
    expect(new Headers(requests[0].init?.headers).get("x-goog-api-key")).toBe(
      syntheticKey,
    );
    const result = await provider.translateBatch(
      [cue("a", "synthetic source")],
      { ...options, batchSize: 1 },
    );

    expect(result.cues[0].secondaryText).toBe("译文");
    const generation = requests.find((request) => request.init?.method === "POST");
    expect(generation?.url).toBe(
      "https://api.example.invalid/proxy/v1/models/gemini-a:generateContent",
    );
    expect(new Headers(generation?.init?.headers).get("x-goog-api-key")).toBe(
      syntheticKey,
    );
    const body = JSON.parse(String(generation?.init?.body));
    expect(body.systemInstruction.parts[0].text).toContain("字幕翻译助手");
    expect(body.contents[0].parts[0].text).toContain("synthetic source");
  });

  it("rejects repeated pagination tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ models: [], nextPageToken: "repeat" })),
    );
    const provider = new GeminiTranslationProvider(config("gemini"));

    await expect(provider.listModels()).rejects.toThrow("分页标记重复");
  });
});

describe("Anthropic contract", () => {
  it("paginates models and uses native Messages headers and body", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "GET") {
          return url.includes("after_id=cursor-a")
            ? jsonResponse({ data: [{ id: "claude-b" }], has_more: false })
            : jsonResponse({
                data: [{ id: "claude-a" }],
                has_more: true,
                last_id: "cursor-a",
              });
        }
        return jsonResponse({
          content: [{ type: "text", text: '[{"index":0,"translation":"译文"}]' }],
        });
      }),
    );
    const provider = new AnthropicTranslationProvider(config("anthropic"));

    await expect(provider.listModels()).resolves.toEqual([
      "claude-a",
      "claude-b",
    ]);
    expect(new Headers(requests[0].init?.headers).get("x-api-key")).toBe(
      syntheticKey,
    );
    const result = await provider.translateBatch(
      [cue("a", "synthetic source")],
      { ...options, batchSize: 1 },
    );

    expect(result.cues[0].secondaryText).toBe("译文");
    const generation = requests.find((request) => request.init?.method === "POST");
    const headers = new Headers(generation?.init?.headers);
    expect(headers.get("x-api-key")).toBe(syntheticKey);
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("anthropic-dangerous-direct-browser-access")).toBe(
      "true",
    );
    const body = JSON.parse(String(generation?.init?.body));
    expect(body).toMatchObject({ model: "synthetic-model", max_tokens: 4096 });
    expect(body.system).toContain("字幕翻译助手");
    expect(body.messages[0].content).toContain("synthetic source");
  });

  it("rejects missing pagination progress", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [], has_more: true })),
    );
    const provider = new AnthropicTranslationProvider(config("anthropic"));

    await expect(provider.listModels()).rejects.toThrow("分页标记无效");
  });
});

describe("shared request scheduling and pipeline", () => {
  it("reserves concurrency slots and spaces FIFO request starts by RPM", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const scheduler = new RequestScheduler(2, 100);
    const starts: number[] = [];
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const jobs = Array.from({ length: 3 }, () =>
      scheduler.schedule(
        () =>
          new Promise<void>((resolve) => {
            starts.push(Date.now());
            active += 1;
            maxActive = Math.max(maxActive, active);
            releases.push(() => {
              active -= 1;
              resolve();
            });
          }),
      ),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(600);
    expect(starts).toEqual([0, 600]);
    releases[0]();
    await vi.advanceTimersByTimeAsync(600);
    expect(starts).toEqual([0, 600, 1200]);
    releases[1]();
    releases[2]();
    await Promise.all(jobs);
    expect(maxActive).toBe(2);
  });

  it("spaces starts from the actual callback time after a delayed timer", async () => {
    let now = 0;
    const timers: Array<{ dueAt: number; callback: () => void }> = [];
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal(
      "setTimeout",
      (callback: () => void, delay = 0) => {
        timers.push({ dueAt: now + Number(delay), callback });
        return timers.length;
      },
    );
    const scheduler = new RequestScheduler(3, 100);
    const starts: number[] = [];
    const jobs = Array.from({ length: 3 }, () =>
      scheduler.schedule(async () => {
        starts.push(Date.now());
      }),
    );

    const runDueTimers = async () => {
      timers.sort((a, b) => a.dueAt - b.dueAt);
      while (timers[0]?.dueAt <= now) {
        timers.shift()?.callback();
        await Promise.resolve();
      }
    };

    now = 5_000;
    await runDueTimers();
    expect(starts).toEqual([5_000]);
    now = 5_600;
    await runDueTimers();
    now = 6_200;
    await runDueTimers();
    await Promise.all(jobs);

    expect(starts).toEqual([5_000, 5_600, 6_200]);
    nowSpy.mockRestore();
  });

  it("falls back through the same concurrency-1 limiter without deadlock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const starts: number[] = [];
    const progress: number[] = [];

    class FallbackProvider extends TranslationProvider {
      async listModels() {
        return [];
      }

      protected async generateText() {
        starts.push(Date.now());
        if (starts.length === 1) return "[]";
        return `translated-${starts.length - 1}`;
      }
    }

    const provider = new FallbackProvider(config("openai-compatible"));
    const translation = provider.translateBatch(
      [cue("a", "first"), cue("b", "second")],
      options,
      (value) => progress.push(value.progress),
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(starts).toEqual([0, 600, 1200]);
    expect(result.cues.map((item) => item.secondaryText)).toEqual([
      "translated-1",
      "translated-2",
    ]);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress[progress.length - 1]).toBe(1);
  });

  it("falls back for out-of-range indexes and missing translations", async () => {
    vi.useFakeTimers();

    class InvalidResponseProvider extends TranslationProvider {
      constructor(
        providerConfig: TranslationProviderConfig,
        private readonly batchResponse: string,
      ) {
        super(providerConfig);
      }

      async listModels() {
        return [];
      }

      protected async generateText(
        _systemPrompt: string | undefined,
        userPrompt: string,
      ) {
        return userPrompt.includes("[待翻译内容]")
          ? this.batchResponse
          : "fallback-result";
      }
    }

    for (const response of [
      '[{"index":1,"translation":"out-of-range"}]',
      '[{"index":0}]',
      '[{"index":0,"translation":"  "}]',
    ]) {
      const provider = new InvalidResponseProvider(
        config("openai-compatible"),
        response,
      );
      const run = provider.translateBatch(
        [cue("a", "synthetic source")],
        { ...options, batchSize: 1 },
      );
      await vi.runAllTimersAsync();
      const result = await run;
      expect(result.cues[0].secondaryText).toBe("fallback-result");
      expect(result.errors[0]).toContain("响应索引或 JSON 格式无效");
    }
  });

  it("rejects duplicate indexes and preserves source order across completion order", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    class OrderedProvider extends TranslationProvider {
      async listModels() {
        return [];
      }

      protected async generateText(
        _systemPrompt: string | undefined,
        userPrompt: string,
      ) {
        if (userPrompt.includes('"text": "duplicate"')) {
          return '[{"index":0,"translation":"bad-a"},{"index":0,"translation":"bad-b"}]';
        }
        if (!userPrompt.includes("[待翻译内容]")) {
          return `fallback-${userPrompt.includes("duplicate") ? "a" : "b"}`;
        }
        const first = userPrompt.includes('"text": "first"');
        await new Promise((resolve) => setTimeout(resolve, first ? 1200 : 0));
        return `[{"index":0,"translation":"${first ? "first-result" : "second-result"}"}]`;
      }
    }

    const ordered = new OrderedProvider(
      config("openai-compatible", { maxConcurrency: 2 }),
    );
    const orderedRun = ordered.translateBatch(
      [cue("a", "first"), cue("b", "second")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const orderedResult = await orderedRun;
    expect(orderedResult.cues.map((item) => item.secondaryText)).toEqual([
      "first-result",
      "second-result",
    ]);

    const duplicate = new OrderedProvider(config("openai-compatible"));
    const duplicateRun = duplicate.translateBatch(
      [cue("a", "duplicate"), cue("b", "other")],
      options,
    );
    await vi.runAllTimersAsync();
    const duplicateResult = await duplicateRun;
    expect(duplicateResult.errors[0]).toContain("响应索引或 JSON 格式无效");
    expect(duplicateResult.cues.map((item) => item.secondaryText)).toEqual([
      "fallback-a",
      "fallback-b",
    ]);
  });
});
