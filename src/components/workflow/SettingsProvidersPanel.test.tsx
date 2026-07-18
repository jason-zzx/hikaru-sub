// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampProviderInteger,
  createTranslationProviderSettings,
  isTranslationProviderReady,
  TRANSLATION_PROVIDER_LIMITS,
} from "@/constants/translationProviders";
import type { TranslationProviderSettings } from "@/types";
import {
  changeProviderApiType,
  deleteProvider,
  SettingsProvidersPanel,
} from "./SettingsProvidersPanel";
import { createTranslationProvider } from "@/services/translation";

vi.mock("@/services/translation", () => ({
  createTranslationProvider: vi.fn(),
}));

const providers: TranslationProviderSettings[] = [
  {
    id: "alpha",
    name: "Alpha",
    apiType: "openai-compatible",
    baseUrl: "https://api.example.invalid/v1",
    apiKey: "synthetic-test-key",
    model: "existing-model",
    maxConcurrency: 1,
    requestsPerMinute: 10,
  },
  {
    id: "beta",
    name: "Beta",
    apiType: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "synthetic-test-key",
    model: "claude-synthetic",
    maxConcurrency: 2,
    requestsPerMinute: 20,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("provider settings helpers", () => {
  it("resets URL and model when the API type changes", () => {
    const changed = changeProviderApiType(providers[0], "gemini");

    expect(changed).toMatchObject({
      apiType: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "",
      name: "Alpha",
      apiKey: "synthetic-test-key",
      maxConcurrency: 1,
      requestsPerMinute: 10,
    });
  });

  it("repairs the default when deleting providers", () => {
    expect(deleteProvider(providers, "alpha", "alpha")).toEqual({
      providers: [providers[1]],
      defaultProviderId: "beta",
    });
    expect(deleteProvider([providers[0]], "alpha", "alpha")).toEqual({
      providers: [],
      defaultProviderId: undefined,
    });
  });

  it("creates bounded providers and resolves readiness from the default ID", () => {
    const created = createTranslationProviderSettings("new-id");
    expect(created).toMatchObject({
      id: "new-id",
      apiType: "openai-compatible",
      apiKey: "",
      maxConcurrency: 1,
      requestsPerMinute: 10,
    });
    expect(
      clampProviderInteger(99, TRANSLATION_PROVIDER_LIMITS.maxConcurrency),
    ).toBe(50);
    expect(
      clampProviderInteger(-4, TRANSLATION_PROVIDER_LIMITS.requestsPerMinute),
    ).toBe(1);

    const settings = {
      translationProviders: providers,
      defaultTranslationProviderId: "beta",
    };
    const selected = settings.translationProviders.find(
      (provider) => provider.id === settings.defaultTranslationProviderId,
    );
    expect(selected?.id).toBe("beta");
    expect(settings.defaultTranslationProviderId).toBe("beta");
    expect(isTranslationProviderReady(selected)).toBe(true);
    expect(
      isTranslationProviderReady({ ...providers[1], apiKey: "" }),
    ).toBe(false);
    expect(
      isTranslationProviderReady({ ...providers[1], model: "" }),
    ).toBe(false);
    expect(
      settings.translationProviders.find((provider) => provider.id === "missing"),
    ).toBeUndefined();
  });
});

describe("SettingsProvidersPanel", () => {
  function Harness() {
    const [value, setValue] = useState({
      providers,
      defaultProviderId: "alpha" as string | undefined,
    });
    return (
      <SettingsProvidersPanel
        providers={value.providers}
        defaultProviderId={value.defaultProviderId}
        onChange={(nextProviders, defaultProviderId) =>
          setValue({ providers: nextProviders, defaultProviderId })
        }
      />
    );
  }

  it("adds, edits, selects defaults, clamps limits, and deletes", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "new-provider" });
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "新增供应商" }));
    expect(screen.getAllByText("未命名供应商").length).toBeGreaterThan(0);
    expect(
      (screen.getByRole("button", { name: "获取模型" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    const nameInput = screen.getByLabelText("名称");
    await user.clear(nameInput);
    await user.type(nameInput, "New Provider");
    expect(screen.getAllByText("New Provider").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "设为默认" }));
    expect(
      (screen.getByRole("button", { name: "默认供应商" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("最大并发数"), {
      target: { value: "99" },
    });
    fireEvent.change(screen.getByLabelText("每分钟请求数（RPM）"), {
      target: { value: "0" },
    });
    expect(
      (screen.getByLabelText("最大并发数") as HTMLInputElement).value,
    ).toBe("50");
    expect(
      (screen.getByLabelText("每分钟请求数（RPM）") as HTMLInputElement)
        .value,
    ).toBe("1");

    await user.click(screen.getByRole("button", { name: "删除供应商" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.queryByText("New Provider")).toBeNull();
  });

  it("preserves the selected model when discovery fails", async () => {
    vi.mocked(createTranslationProvider).mockReturnValue({
      listModels: vi.fn().mockRejectedValue(new Error("synthetic discovery failure")),
    } as unknown as ReturnType<typeof createTranslationProvider>);
    const user = userEvent.setup();
    render(<Harness />);

    expect((screen.getByLabelText("模型") as HTMLInputElement).value).toBe(
      "existing-model",
    );
    await user.click(screen.getByRole("button", { name: "获取模型" }));

    await waitFor(() => {
      expect(screen.getByText("synthetic discovery failure")).toBeTruthy();
    });
    expect((screen.getByLabelText("模型") as HTMLInputElement).value).toBe(
      "existing-model",
    );
  });

  it("discards model results after switching providers", async () => {
    let resolveModels!: (models: string[]) => void;
    const modelRequest = new Promise<string[]>((resolve) => {
      resolveModels = resolve;
    });
    vi.mocked(createTranslationProvider).mockReturnValue({
      listModels: vi.fn(() => modelRequest),
    } as unknown as ReturnType<typeof createTranslationProvider>);
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "获取模型" }));
    await user.click(screen.getByRole("button", { name: "Beta" }));
    resolveModels(["stale-model"]);
    await modelRequest;

    await waitFor(() => {
      expect((screen.getByLabelText("模型") as HTMLInputElement).value).toBe(
        "claude-synthetic",
      );
      expect(screen.queryByText("stale-model")).toBeNull();
    });
  });
});
