import { describe, expect, it } from "vitest";
import {
  RUNTIME_DEPENDENCY_LABEL,
  RUNTIME_SOURCE_MODE_LABEL,
  formatDependencyBytes,
} from "./runtimeDependencies";

describe("runtime dependency constants", () => {
  it("labels managed dependency kinds", () => {
    expect(RUNTIME_DEPENDENCY_LABEL.ffmpeg).toBe("FFmpeg");
    expect(RUNTIME_DEPENDENCY_LABEL.python311).toBe("Python 3.11");
    expect(RUNTIME_DEPENDENCY_LABEL.asrVenv).toBe("ASR 引擎依赖");
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
});
