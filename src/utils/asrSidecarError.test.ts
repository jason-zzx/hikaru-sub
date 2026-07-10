import { describe, expect, it } from "vitest";
import {
  ASR_ENGINE_NOT_INSTALLED_HINT,
  ASR_ENGINE_NOT_INSTALLED_LABEL,
  isAsrEngineNotInstalledError,
  isSelectedAsrEngineUnavailable,
} from "./asrSidecarError";

describe("isAsrEngineNotInstalledError", () => {
  it("detects missing Python dependency readiness from sidecar spawn", () => {
    expect(
      isAsrEngineNotInstalledError(
        "sidecar 未输出就绪端口（请检查 Python 依赖是否已安装）",
      ),
    ).toBe(true);
  });

  it("detects ModuleNotFoundError style failures", () => {
    expect(
      isAsrEngineNotInstalledError(
        "启动 sidecar 失败：ModuleNotFoundError: No module named 'fastapi'",
      ),
    ).toBe(true);
  });

  it("does not treat unrelated sidecar connection errors as missing engine", () => {
    expect(isAsrEngineNotInstalledError("无法连接 sidecar：timeout")).toBe(
      false,
    );
  });
});

describe("ASR engine not installed copy", () => {
  it("exposes user-facing label and setup hint", () => {
    expect(ASR_ENGINE_NOT_INSTALLED_LABEL).toBe("ASR 引擎未安装");
    expect(ASR_ENGINE_NOT_INSTALLED_HINT).toContain("配置当前引擎依赖");
  });
});

describe("isSelectedAsrEngineUnavailable", () => {
  it("keeps the state unknown until the engine list has loaded", () => {
    expect(isSelectedAsrEngineUnavailable(null, "kotoba-faster-whisper")).toBe(
      false,
    );
  });

  it("treats a missing or unavailable selected engine as unavailable", () => {
    expect(
      isSelectedAsrEngineUnavailable(
        [{ name: "faster-whisper", available: true }],
        "kotoba-faster-whisper",
      ),
    ).toBe(true);
    expect(
      isSelectedAsrEngineUnavailable(
        [{ name: "kotoba-faster-whisper", available: false }],
        "kotoba-faster-whisper",
      ),
    ).toBe(true);
  });

  it("accepts the selected engine only when it is listed as available", () => {
    expect(
      isSelectedAsrEngineUnavailable(
        [{ name: "kotoba-faster-whisper", available: true }],
        "kotoba-faster-whisper",
      ),
    ).toBe(false);
  });
});
