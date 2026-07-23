import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubtitleCue, TranslationApiType } from "@/types";
import { AnthropicTranslationProvider } from "./anthropic";
import { TranslationProvider } from "./base";
import { GeminiTranslationProvider } from "./gemini";
import { GenerationError } from "./http";
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

type GenerateTextResponder = (
  systemPrompt: string | undefined,
  userPrompt: string,
  timeout: number,
  signal?: AbortSignal,
) => string | Promise<string>;

class StubProvider extends TranslationProvider {
  constructor(
    providerConfig: TranslationProviderConfig,
    private readonly responder: GenerateTextResponder,
  ) {
    super(providerConfig);
  }

  async listModels() {
    return [];
  }

  protected async generateText(
    systemPrompt: string | undefined,
    userPrompt: string,
    timeout: number,
    signal?: AbortSignal,
  ) {
    return this.responder(systemPrompt, userPrompt, timeout, signal);
  }
}

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
    expect(body).toMatchObject({ model: "synthetic-model" });
    expect(body).not.toHaveProperty("temperature");
    expect(body.messages).toHaveLength(1);

    const configuredProvider = new OpenAITranslationProvider(
      config("openai-compatible", { temperature: 0.7 }),
    );
    await configuredProvider.translateSingle(cue("b", "synthetic source"), options);
    const configuredBody = JSON.parse(
      String(requests[requests.length - 1]?.init?.body),
    );
    expect(configuredBody.temperature).toBe(0.7);
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

  it("includes a bounded structured generation failure reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { message: `upstream overloaded ${"x".repeat(500)}` } },
          503,
        ),
      ),
    );
    const provider = new OpenAITranslationProvider(
      config("openai-compatible"),
    );

    const error = await provider
      .translateSingle(cue("a", "synthetic source"), options)
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GenerationError);
    expect((error as Error).message).toContain("API 错误 503: upstream overloaded");
    expect((error as Error).message.length).toBeLessThan(230);
  });

  it("masks an invalid API key with one compact marker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              message: `Incorrect API key provided: ${syntheticKey}.`,
            },
          },
          401,
        ),
      ),
    );
    const provider = new OpenAITranslationProvider(
      config("openai-compatible"),
    );

    const error = await provider
      .translateSingle(cue("a", "synthetic source"), options)
      .catch((value: unknown) => value);

    expect((error as Error).message).toBe(
      "API 错误 401: Incorrect API key provided: ***.",
    );
    expect((error as Error).message).not.toContain("已隐藏");
  });

  it("suppresses an oversized reason with a sensitive value crossing the old boundary", async () => {
    const oldBoundary = 180 * 4;
    const reason = `${"x".repeat(oldBoundary - 2)}${syntheticKey}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { message: reason } }, 401)),
    );
    const provider = new OpenAITranslationProvider(
      config("openai-compatible"),
    );

    const error = await provider
      .translateSingle(cue("a", "synthetic source"), options)
      .catch((value: unknown) => value);

    expect((error as Error).message).toBe("API 错误 401");
    expect((error as Error).message).not.toContain(syntheticKey);
  });

  it("redacts an exact sensitive value after a Unicode case-folding prefix", async () => {
    const foldingPrefix = "\u0130 prefix";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              message: `${foldingPrefix} ${syntheticKey.toUpperCase()}`,
            },
          },
          401,
        ),
      ),
    );
    const provider = new OpenAITranslationProvider(
      config("openai-compatible"),
    );

    const error = await provider
      .translateSingle(cue("a", "synthetic source"), options)
      .catch((value: unknown) => value);

    expect((error as Error).message).toBe(
      `API 错误 401: ${foldingPrefix} ***`,
    );
    expect((error as Error).message).not.toContain(syntheticKey.toUpperCase());
  });

  it("suppresses a structured reason containing a 4-character API key fragment", async () => {
    const keyFragment = syntheticKey.slice(0, 4);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { message: `credential prefix: ${keyFragment}` } },
          401,
        ),
      ),
    );
    const provider = new OpenAITranslationProvider(
      config("openai-compatible"),
    );

    const error = await provider
      .translateSingle(cue("a", "synthetic source"), options)
      .catch((value: unknown) => value);

    expect((error as Error).message).toBe("API 错误 401");
    expect((error as Error).message).not.toContain(keyFragment);
  });

  it("does not expose non-JSON generation response bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("private upstream body", { status: 502 })),
    );
    const provider = new OpenAITranslationProvider(
      config("openai-compatible"),
    );

    const error = await provider
      .translateSingle(cue("a", "synthetic source"), options)
      .catch((value: unknown) => value);

    expect((error as Error).message).toBe("API 错误 502");
    expect((error as Error).message).not.toContain("private upstream body");
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

  it("redacts short subtitle, glossary, and custom-prompt fragments", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              message: `${syntheticKey.toUpperCase()} 猫 用語 秘密訳 秘密指示 SECRET`,
            },
          },
          400,
        ),
      ),
    );
    const provider = new OpenAITranslationProvider(
      config("openai-compatible"),
    );
    const translation = provider.translateBatch(
      [cue("a", "猫")],
      {
        ...options,
        batchSize: 1,
        glossary: { 用語: "秘密訳" },
        customPrompt: "秘密指示\nSecret",
      },
    );
    await vi.runAllTimersAsync();
    const details = (await translation).errors.join(" ");

    expect(details).toContain("API 错误 400");
    expect(details).not.toContain(syntheticKey);
    expect(details).not.toContain(syntheticKey.toUpperCase());
    expect(details).not.toContain("猫");
    expect(details).not.toContain("用語");
    expect(details).not.toContain("秘密訳");
    expect(details).not.toContain("秘密指示");
    expect(details).not.toContain("SECRET");
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
    expect(body).not.toHaveProperty("generationConfig");

    const configuredProvider = new GeminiTranslationProvider(
      config("gemini", { model: "gemini-a", temperature: 1 }),
    );
    await configuredProvider.translateSingle(cue("b", "synthetic source"), options);
    const configuredBody = JSON.parse(
      String(requests[requests.length - 1]?.init?.body),
    );
    expect(configuredBody.generationConfig.temperature).toBe(1);
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
    expect(body).not.toHaveProperty("temperature");
    expect(body.system).toContain("字幕翻译助手");
    expect(body.messages[0].content).toContain("synthetic source");

    const configuredProvider = new AnthropicTranslationProvider(
      config("anthropic", { temperature: 0.4 }),
    );
    await configuredProvider.translateSingle(cue("b", "synthetic source"), options);
    const configuredBody = JSON.parse(
      String(requests[requests.length - 1]?.init?.body),
    );
    expect(configuredBody.temperature).toBe(0.4);
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
  it("places the strict JSON contract last and declares the batch index range", async () => {
    let systemPrompt = "";
    let userPrompt = "";
    const provider = new StubProvider(
      config("openai-compatible"),
      (nextSystemPrompt, nextUserPrompt) => {
        systemPrompt = nextSystemPrompt ?? "";
        userPrompt = nextUserPrompt;
        return '[{"index":0,"translation":"一"},{"index":1,"translation":"二"},{"index":2,"translation":"三"}]';
      },
    );

    const result = await provider.translateBatch(
      [cue("a", "first"), cue("b", "second"), cue("c", "third")],
      {
        ...options,
        batchSize: 3,
        customPrompt: "custom translation guidance",
      },
    );

    expect(result.successCount).toBe(3);
    expect(systemPrompt).toContain("custom translation guidance");
    expect(systemPrompt).toContain("只输出一个有效的 JSON 数组");
    expect(systemPrompt).toContain(
      "禁止使用 Markdown 代码围栏，包括 ```json 和 ```",
    );
    expect(systemPrompt).toContain(
      '[{"index":0,"translation":"第一条译文"},{"index":1,"translation":"第二条译文"}]',
    );
    expect(systemPrompt.indexOf("custom translation guidance")).toBeLessThan(
      systemPrompt.indexOf("输出格式要求"),
    );
    expect(userPrompt).toContain(
      "本批共有3条内容，必须按顺序以index 0开始，以index 2结束。",
    );
  });

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

  it("starts a priority retry before queued normal requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const scheduler = new RequestScheduler(1, 100);
    const starts: string[] = [];
    let releaseFirst!: () => void;
    const first = scheduler.schedule(
      () =>
        new Promise<void>((resolve) => {
          starts.push("first");
          releaseFirst = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const normal = scheduler.schedule(async () => {
      starts.push("normal");
    });
    const retry = scheduler.schedule(
      async () => {
        starts.push("retry");
      },
      undefined,
      true,
    );

    releaseFirst();
    await first;
    await vi.advanceTimersByTimeAsync(600);
    await retry;
    await vi.advanceTimersByTimeAsync(600);
    await normal;

    expect(starts).toEqual(["first", "retry", "normal"]);
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

  it("rejects pre-aborted requests without queueing them", async () => {
    const scheduler = new RequestScheduler(1, 100);
    const controller = new AbortController();
    const run = vi.fn(async () => undefined);
    controller.abort();

    await expect(scheduler.schedule(run, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("cancels queued requests before they start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const scheduler = new RequestScheduler(1, 100);
    let releaseFirst!: () => void;
    const starts: string[] = [];
    const first = scheduler.schedule(
      () =>
        new Promise<void>((resolve) => {
          starts.push("first");
          releaseFirst = resolve;
        }),
    );
    const controller = new AbortController();
    const queued = scheduler.schedule(async () => {
      starts.push("queued");
    }, controller.signal);

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    releaseFirst();
    await first;
    await vi.runAllTimersAsync();

    expect(starts).toEqual(["first"]);
  });

  it("cancels requests waiting for the RPM start timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const scheduler = new RequestScheduler(2, 100);
    const starts: string[] = [];
    const first = scheduler.schedule(async () => {
      starts.push("first");
    });
    const controller = new AbortController();
    const waiting = scheduler.schedule(async () => {
      starts.push("waiting");
    }, controller.signal);

    await vi.advanceTimersByTimeAsync(0);
    await first;
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(600);

    expect(starts).toEqual(["first"]);
  });

  it("aborts in-flight generation without starting fallback", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null = null;
    const fetchMock = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal ?? null;
          requestSignal?.addEventListener(
            "abort",
            () => reject(requestSignal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAITranslationProvider(
      config("openai-compatible"),
    );
    const controller = new AbortController();
    const translation = provider.translateBatch(
      [cue("a", "synthetic private source")],
      { ...options, batchSize: 1, signal: controller.signal },
    );

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    const result = await translation;

    expect(controller.signal.aborted).toBe(true);
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      successCount: 0,
      failedCount: 1,
      cancelled: true,
      errors: [],
    });
    expect(result.cues[0].secondaryText).toBeUndefined();
  });

  it("retains completed single fallbacks when cancellation interrupts the rest", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const starts: string[] = [];

    const provider = new StubProvider(
      config("openai-compatible"),
      (_systemPrompt, userPrompt, _timeout, signal) => {
        starts.push(userPrompt);
        if (userPrompt.includes("[待翻译内容]")) return "[]";
        if (userPrompt.includes("first")) return "translated-first";
        return new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    );
    const controller = new AbortController();
    const translation = provider.translateBatch(
      [cue("a", "first"), cue("b", "second")],
      { ...options, signal: controller.signal },
    );

    await vi.advanceTimersByTimeAsync(600);
    expect(starts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(600);
    expect(starts).toHaveLength(3);
    controller.abort();
    const result = await translation;

    expect(result.cancelled).toBe(true);
    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.cues.map((item) => item.secondaryText)).toEqual([
      "translated-first",
      undefined,
    ]);
  });

  it("keeps completed batches in source order after cancellation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const provider = new StubProvider(
      config("openai-compatible", { maxConcurrency: 2 }),
      (_systemPrompt, userPrompt, _timeout, signal) => {
        if (userPrompt.includes('"text": "first"')) {
          return '[{"index":0,"translation":"translated-first"}]';
        }
        return new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    );
    const controller = new AbortController();
    const translation = provider.translateBatch(
      [cue("a", "first"), cue("b", "second")],
      { ...options, batchSize: 1, signal: controller.signal },
    );

    await vi.advanceTimersByTimeAsync(600);
    controller.abort();
    const result = await translation;

    expect(result.cancelled).toBe(true);
    expect(result.cues.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.cues.map((item) => item.secondaryText)).toEqual([
      "translated-first",
      undefined,
    ]);
  });

  it("does not retry or expose arbitrary generation errors", async () => {
    vi.useFakeTimers();
    let calls = 0;

    const provider = new StubProvider(config("openai-compatible"), () => {
      calls += 1;
      throw new Error(
        `${syntheticKey} synthetic private source custom private prompt`,
      );
    });
    const translation = provider.translateBatch(
      [cue("a", "synthetic private source")],
      { ...options, batchSize: 1, customPrompt: "custom private prompt" },
    );
    await vi.runAllTimersAsync();
    const result = await translation;
    const details = result.errors.join(" ");

    expect(calls).toBe(1);
    expect(details).toContain("翻译请求失败");
    expect(details).not.toContain(syntheticKey);
    expect(details).not.toContain("synthetic private source");
    expect(details).not.toContain("custom private prompt");
  });

  it("retries a controlled fetch network failure once", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("network unavailable");
        return jsonResponse({
          choices: [
            {
              message: {
                content: '[{"index":0,"translation":"translated"}]',
              },
            },
          ],
        });
      }),
    );
    const provider = new OpenAITranslationProvider(
      config("openai-compatible"),
    );
    const translation = provider.translateBatch(
      [cue("a", "source")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(calls).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("does not count blank fallback text as a translation", async () => {
    vi.useFakeTimers();

    const provider = new StubProvider(
      config("openai-compatible"),
      (_systemPrompt, userPrompt) =>
        userPrompt.includes("[待翻译内容]") ? "[]" : "  ",
    );
    const translation = provider.translateBatch(
      [cue("a", "synthetic source")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.cues[0].secondaryText).toBeUndefined();
    expect(result.errors[result.errors.length - 1]).toContain("响应格式无效");
  });

  it("retries a fallback cue once after a transient failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let calls = 0;

    const provider = new StubProvider(
      config("openai-compatible"),
      (_systemPrompt, userPrompt) => {
        calls += 1;
        if (userPrompt.includes("[待翻译内容]")) return "[]";
        if (calls === 3) {
          throw new GenerationError("http", 503, "upstream overloaded");
        }
        return "translated";
      },
    );
    const translation = provider.translateBatch(
      [cue("a", "source")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(calls).toBe(4);
    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.cues[0].secondaryText).toBe("translated");
  });

  it("marks a fallback cue failed only after two transient failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let calls = 0;

    const provider = new StubProvider(
      config("openai-compatible"),
      (_systemPrompt, userPrompt) => {
        calls += 1;
        if (userPrompt.includes("[待翻译内容]")) return "[]";
        throw new GenerationError("http", 503, "upstream overloaded");
      },
    );
    const translation = provider.translateBatch(
      [cue("a", "source")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(calls).toBe(4);
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.errors).toContain(
      "批次 1 条目 1 失败: API 错误 503: upstream overloaded",
    );
  });

  it("does not retry a deterministic fallback failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let calls = 0;

    const provider = new StubProvider(
      config("openai-compatible"),
      (_systemPrompt, userPrompt) => {
        calls += 1;
        if (userPrompt.includes("[待翻译内容]")) return "[]";
        throw new GenerationError("http", 401, "invalid API key");
      },
    );
    const translation = provider.translateBatch(
      [cue("a", "source")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(calls).toBe(3);
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.errors).toContain(
      "批次 1 条目 1 失败: API 错误 401: invalid API key",
    );
  });

  it("does not fallback when the provider response envelope is invalid", async () => {
    vi.useFakeTimers();
    let calls = 0;

    const provider = new StubProvider(config("openai-compatible"), () => {
      calls += 1;
      throw new GenerationError("response");
    });
    const translation = provider.translateBatch(
      [cue("a", "synthetic source")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(calls).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.errors).toEqual(["批次 1 失败: 响应格式无效"]);
  });

  it("does not fan out timeout failures into single-cue requests", async () => {
    vi.useFakeTimers();
    let calls = 0;

    const provider = new StubProvider(config("openai-compatible"), () => {
      calls += 1;
      throw new DOMException("timed out", "TimeoutError");
    });
    const translation = provider.translateBatch(
      [cue("a", "synthetic source")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(calls).toBe(2);
    expect(result.cancelled).toBe(false);
    expect(result.cues[0].secondaryText).toBeUndefined();
    expect(result.errors[0]).toContain("请求超时");
  });

  it("retries the same batch once after a transient failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let calls = 0;

    const provider = new StubProvider(config("openai-compatible"), () => {
      calls += 1;
      if (calls === 1) {
        throw new GenerationError("http", 503, "upstream overloaded");
      }
      return '[{"index":0,"translation":"translated"}]';
    });
    const translation = provider.translateBatch(
      [cue("a", "source")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(calls).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.cues[0].secondaryText).toBe("translated");
  });

  it.each([408, 409, 425, 429, 500, 599])(
    "retries transient HTTP %i once",
    async (status) => {
      vi.useFakeTimers();
      let calls = 0;

      const provider = new StubProvider(config("openai-compatible"), () => {
        calls += 1;
        if (calls === 1) throw new GenerationError("http", status);
        return '[{"index":0,"translation":"translated"}]';
      });
      const translation = provider.translateBatch(
        [cue("a", "source")],
        { ...options, batchSize: 1 },
      );
      await vi.runAllTimersAsync();
      const result = await translation;

      expect(calls).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.errors).toEqual([]);
    },
  );

  it.each([400, 401, 422, 499, 600])(
    "does not retry deterministic HTTP %i",
    async (status) => {
      vi.useFakeTimers();
      let calls = 0;

      const provider = new StubProvider(config("openai-compatible"), () => {
        calls += 1;
        throw new GenerationError("http", status);
      });
      const translation = provider.translateBatch(
        [cue("a", "source")],
        { ...options, batchSize: 1 },
      );
      await vi.runAllTimersAsync();
      const result = await translation;

      expect(calls).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.errors).toEqual([`批次 1 失败: API 错误 ${status}`]);
    },
  );

  it("continues after one transient failure and resets after success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const starts: string[] = [];

    const provider = new StubProvider(
      config("openai-compatible", { requestsPerMinute: 100 }),
      (_systemPrompt, userPrompt) => {
        const text = ["first", "second", "third", "fourth"].find((value) =>
          userPrompt.includes(`"text": "${value}"`),
        );
        starts.push(text ?? "unknown");
        if (text === "first" || text === "third") {
          throw new GenerationError("http", 503, "upstream overloaded");
        }
        return `[{"index":0,"translation":"translated-${text}"}]`;
      },
    );
    const translation = provider.translateBatch(
      [
        cue("a", "first"),
        cue("b", "second"),
        cue("c", "third"),
        cue("d", "fourth"),
      ],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(starts).toEqual([
      "first",
      "first",
      "second",
      "third",
      "third",
      "fourth",
    ]);
    expect(result.successCount).toBe(2);
    expect(result.failedCount).toBe(2);
    expect(result.errors).toEqual([
      "批次 1 失败: API 错误 503: upstream overloaded",
      "批次 3 失败: API 错误 503: upstream overloaded",
    ]);
  });

  it("stops after two consecutive transient failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let calls = 0;

    const provider = new StubProvider(
      config("openai-compatible", { requestsPerMinute: 100 }),
      () => {
        calls += 1;
        throw new GenerationError("http", 503, "upstream overloaded");
      },
    );
    const translation = provider.translateBatch(
      [cue("a", "first"), cue("b", "second"), cue("c", "third")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(calls).toBe(4);
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(3);
    expect(result.errors).toEqual([
      "批次 1 失败: API 错误 503: upstream overloaded",
      "批次 2 失败: API 错误 503: upstream overloaded",
    ]);
  });

  it("preserves completed batches and stops later work on provider-wide failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const starts: string[] = [];

    const provider = new StubProvider(
      config("openai-compatible", { requestsPerMinute: 100 }),
      (_systemPrompt, userPrompt) => {
        if (userPrompt.includes('"text": "first"')) {
          starts.push("first");
          return '[{"index":0,"translation":"translated-first"}]';
        }
        starts.push("second");
        throw new GenerationError("http", 401);
      },
    );
    const translation = provider.translateBatch(
      [cue("a", "first"), cue("b", "second"), cue("c", "third")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(starts).toEqual(["first", "second"]);
    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(2);
    expect(result.cues.map((item) => item.secondaryText)).toEqual([
      "translated-first",
      undefined,
      undefined,
    ]);
    expect(result.errors).toEqual(["批次 2 失败: API 错误 401"]);
  });

  it("stops queued batches after the first provider-wide failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let calls = 0;

    const provider = new StubProvider(
      config("openai-compatible", { requestsPerMinute: 100 }),
      () => {
        calls += 1;
        throw new GenerationError("http", 401);
      },
    );
    const translation = provider.translateBatch(
      [cue("a", "a"), cue("b", "b"), cue("c", "c")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(calls).toBe(1);
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(3);
    expect(result.errors).toEqual(["批次 1 失败: API 错误 401"]);
  });

  it("keeps batch mode when the second formatted response is valid", async () => {
    vi.useFakeTimers();
    let calls = 0;

    const provider = new StubProvider(config("openai-compatible"), () => {
      calls += 1;
      return calls === 1
        ? "[]"
        : '[{"index":0,"translation":"translated"}]';
    });
    const translation = provider.translateBatch(
      [cue("a", "source")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(calls).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.cues[0].secondaryText).toBe("translated");
    expect(result.errors).toEqual([]);
  });

  it("prioritizes the batch format retry over queued batches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const starts: Array<{ cue: string; at: number }> = [];
    let firstAttempts = 0;

    const provider = new StubProvider(
      config("openai-compatible"),
      (_systemPrompt, userPrompt) => {
        const isFirst = userPrompt.includes('"text": "first"');
        starts.push({ cue: isFirst ? "first" : "second", at: Date.now() });
        if (isFirst) {
          firstAttempts += 1;
          if (firstAttempts === 1) return "[]";
          return '[{"index":0,"translation":"first-result"}]';
        }
        return '[{"index":0,"translation":"second-result"}]';
      },
    );
    const translation = provider.translateBatch(
      [cue("a", "first"), cue("b", "second")],
      { ...options, batchSize: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(starts).toEqual([
      { cue: "first", at: 0 },
      { cue: "first", at: 600 },
      { cue: "second", at: 1200 },
    ]);
    expect(result.cues.map((item) => item.secondaryText)).toEqual([
      "first-result",
      "second-result",
    ]);
  });

  it("falls back after two batch format failures without deadlock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const starts: number[] = [];
    const progress: number[] = [];

    const provider = new StubProvider(config("openai-compatible"), () => {
      starts.push(Date.now());
      if (starts.length <= 2) return "[]";
      return `translated-${starts.length - 2}`;
    });
    const translation = provider.translateBatch(
      [cue("a", "first"), cue("b", "second")],
      options,
      (value) => progress.push(value.progress),
    );
    await vi.runAllTimersAsync();
    const result = await translation;

    expect(starts).toEqual([0, 600, 1200, 1800]);
    expect(result.cues.map((item) => item.secondaryText)).toEqual([
      "translated-1",
      "translated-2",
    ]);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress[progress.length - 1]).toBe(1);
  });

  it("falls back for out-of-range indexes and missing translations", async () => {
    vi.useFakeTimers();

    for (const response of [
      '[{"index":1,"translation":"out-of-range"}]',
      '[{"index":0}]',
      '[{"index":0,"translation":"  "}]',
    ]) {
      const provider = new StubProvider(
        config("openai-compatible"),
        (_systemPrompt, userPrompt) =>
          userPrompt.includes("[待翻译内容]")
            ? response
            : "fallback-result",
      );
      const run = provider.translateBatch(
        [cue("a", "synthetic source")],
        { ...options, batchSize: 1 },
      );
      await vi.runAllTimersAsync();
      const result = await run;
      expect(result.cues[0].secondaryText).toBe("fallback-result");
      expect(result.errors[0]).toContain("响应格式无效");
    }
  });

  it("rejects duplicate indexes and preserves source order across completion order", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const responder: GenerateTextResponder = async (
      _systemPrompt,
      userPrompt,
    ) => {
      if (userPrompt.includes('"text": "duplicate"')) {
        return '[{"index":0,"translation":"bad-a"},{"index":0,"translation":"bad-b"}]';
      }
      if (!userPrompt.includes("[待翻译内容]")) {
        return `fallback-${userPrompt.includes("duplicate") ? "a" : "b"}`;
      }
      const first = userPrompt.includes('"text": "first"');
      await new Promise((resolve) => setTimeout(resolve, first ? 1200 : 0));
      return `[{"index":0,"translation":"${first ? "first-result" : "second-result"}"}]`;
    };

    const ordered = new StubProvider(
      config("openai-compatible", { maxConcurrency: 2 }),
      responder,
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

    const duplicate = new StubProvider(
      config("openai-compatible"),
      responder,
    );
    const duplicateRun = duplicate.translateBatch(
      [cue("a", "duplicate"), cue("b", "other")],
      options,
    );
    await vi.runAllTimersAsync();
    const duplicateResult = await duplicateRun;
    expect(duplicateResult.errors[0]).toContain("响应格式无效");
    expect(duplicateResult.cues.map((item) => item.secondaryText)).toEqual([
      "fallback-a",
      "fallback-b",
    ]);
  });
});
