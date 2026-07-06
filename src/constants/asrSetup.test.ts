import { describe, expect, it } from "vitest";
import { resolveAsrSetupProfile } from "./asrSetup";

describe("resolveAsrSetupProfile", () => {
  it("uses default dependencies for faster-whisper", () => {
    expect(
      resolveAsrSetupProfile("faster-whisper", "cuda", {
        hasNvidiaGpu: true,
      }),
    ).toBe("default");
  });

  it("maps explicit CPU/CUDA devices for Parakeet", () => {
    expect(
      resolveAsrSetupProfile("parakeet", "cpu", {
        hasNvidiaGpu: true,
      }),
    ).toBe("parakeet-cpu");
    expect(
      resolveAsrSetupProfile("parakeet", "cuda", {
        hasNvidiaGpu: false,
      }),
    ).toBe("parakeet-cuda");
  });

  it("uses GPU probe for auto device", () => {
    expect(
      resolveAsrSetupProfile("qwen3-asr", "auto", {
        hasNvidiaGpu: true,
      }),
    ).toBe("qwen3-cuda");
    expect(
      resolveAsrSetupProfile("qwen3-asr", "auto", {
        hasNvidiaGpu: false,
      }),
    ).toBe("qwen3-cpu");
  });
});
