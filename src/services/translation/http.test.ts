// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  buildProviderUrl,
  fetchWithTimeout,
  GenerationError,
  getHttpFetch,
} from "./http";

describe("http translation client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds provider URLs with clean path joining", () => {
    expect(
      buildProviderUrl("http://localhost:1234/v1/", "/models").toString(),
    ).toBe("http://localhost:1234/v1/models");
    expect(
      buildProviderUrl("http://127.0.0.1:1234/v1", "chat/completions").toString(),
    ).toBe("http://127.0.0.1:1234/v1/chat/completions");
  });

  it("resolves global fetch when running outside Tauri desktop runtime", () => {
    const originalInternals = (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    try {
      delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      expect(getHttpFetch()).toBe(globalThis.fetch);
    } finally {
      if (originalInternals !== undefined) {
        (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ =
          originalInternals;
      }
    }
  });

  it("resolves tauriFetch when running inside Tauri desktop runtime", () => {
    const originalInternals = (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    try {
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
      expect(getHttpFetch()).toBe(tauriFetch);
    } finally {
      if (originalInternals !== undefined) {
        (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ =
          originalInternals;
      } else {
        delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      }
    }
  });

  it("handles fetch with timeout", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", mockFetch);
    const url = new URL("http://localhost:1234/v1/models");
    const response = await fetchWithTimeout(url, { method: "GET" }, 5000);
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps network errors to GenerationError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    const url = new URL("http://localhost:1234/v1/models");
    await expect(
      fetchWithTimeout(url, { method: "GET" }, 5000),
    ).rejects.toThrow(GenerationError);
  });
});
