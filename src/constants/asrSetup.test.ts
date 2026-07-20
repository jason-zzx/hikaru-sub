import { describe, expect, it } from "vitest";
import { ASR_SETUP_PROFILE_LABEL, resolveAsrSetupProfile } from "./asrSetup";

describe("resolveAsrSetupProfile", () => {
  it("uses default dependencies for faster-whisper", () => {
    expect(
      resolveAsrSetupProfile("faster-whisper", "cuda", {
        hasNvidiaGpu: true,
      }),
    ).toBe("default");
  });

  it("reuses default dependencies for kotoba-faster-whisper", () => {
    expect(
      resolveAsrSetupProfile("kotoba-faster-whisper", "cuda", {
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

  it("maps ReazonSpeech devices and auto GPU probe", () => {
    expect(
      resolveAsrSetupProfile("reazonspeech-nemo", "cpu", {
        hasNvidiaGpu: true,
      }),
    ).toBe("reazonspeech-cpu");
    expect(
      resolveAsrSetupProfile("reazonspeech-nemo", "cuda", {
        hasNvidiaGpu: false,
      }),
    ).toBe("reazonspeech-cuda");
    expect(
      resolveAsrSetupProfile("reazonspeech-nemo", "auto", {
        hasNvidiaGpu: true,
      }),
    ).toBe("reazonspeech-cuda");
    expect(
      resolveAsrSetupProfile("reazonspeech-nemo", "auto", {
        hasNvidiaGpu: false,
      }),
    ).toBe("reazonspeech-cpu");
  });
});

describe("ASR_SETUP_PROFILE_LABEL", () => {
  it("names the dependencies shared by faster-whisper and kotoba-faster-whisper", () => {
    expect(ASR_SETUP_PROFILE_LABEL.default).toBe(
      "faster-whisper / kotoba-faster-whisper 依赖",
    );
  });

  it("names ReazonSpeech profiles", () => {
    expect(ASR_SETUP_PROFILE_LABEL["reazonspeech-cpu"]).toBe("ReazonSpeech CPU 依赖");
    expect(ASR_SETUP_PROFILE_LABEL["reazonspeech-cuda"]).toBe("ReazonSpeech CUDA 依赖");
  });
});
