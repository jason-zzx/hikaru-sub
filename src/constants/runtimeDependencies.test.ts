import { describe, expect, it } from "vitest";
import {
  RUNTIME_DEPENDENCY_LABEL,
  RUNTIME_SOURCE_MODE_LABEL,
  formatDependencyBytes,
  formatDependencyPath,
} from "./runtimeDependencies";

describe("runtime dependency constants", () => {
  it("labels production dependency kinds", () => {
    expect(RUNTIME_DEPENDENCY_LABEL.ffmpeg).toBe("FFmpeg");
    expect(RUNTIME_DEPENDENCY_LABEL.nativeAsrCpu).toBe("CPU 运行依赖");
    expect(RUNTIME_DEPENDENCY_LABEL.crispasrCpu).toBe("CPU 运行依赖");
    expect(RUNTIME_DEPENDENCY_LABEL.nativeAsrCuda).toBe("CUDA 运行依赖");
    expect(RUNTIME_DEPENDENCY_LABEL.crispasrCuda).toBe("CUDA 运行依赖");
    expect(RUNTIME_DEPENDENCY_LABEL.asrModels).toBe("ASR 模型缓存");
  });

  it("labels source modes", () => {
    expect(RUNTIME_SOURCE_MODE_LABEL.official).toBe("官方源");
    expect(RUNTIME_SOURCE_MODE_LABEL.china).toBe("中国大陆镜像");
  });

  it("formats byte counts for Settings", () => {
    expect(formatDependencyBytes(512)).toBe("512 B");
    expect(formatDependencyBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatDependencyBytes(25 * 1024 * 1024)).toBe("25.0 MB");
  });

  it("normalizes dependency paths for display", () => {
    expect(
      formatDependencyPath("\\\\?\\C:\\app\\deps\\asr-runtime\\cuda\\current"),
    ).toBe("C:\\app\\deps\\asr-runtime\\cuda\\current");
    expect(formatDependencyPath("C:\\app\\deps\\asr-runtime/crispasr/cuda/current")).toBe(
      "C:\\app\\deps\\asr-runtime\\crispasr\\cuda\\current",
    );
    expect(formatDependencyPath("C:\\app\\deps\\ffmpeg\\current")).toBe(
      "C:\\app\\deps\\ffmpeg\\current",
    );
    expect(formatDependencyPath("/usr/local/bin")).toBe("/usr/local/bin");
  });
});
