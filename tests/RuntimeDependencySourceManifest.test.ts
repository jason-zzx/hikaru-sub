import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("runtime dependency source manifest", () => {
  it("pins binary downloads by checksum and size", () => {
    const manifest = JSON.parse(
      readFileSync(
        "src-tauri/resources/runtime-dependency-sources.json",
        "utf8",
      ),
    );
    const profiles = manifest.platforms["windows-x64"];

    for (const profile of [profiles.official, profiles.china]) {
      for (const key of ["ffmpeg", "python311"] as const) {
        expect(profile[key].url).toMatch(/^https:\/\//);
        expect(profile[key].sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(profile[key].sizeBytes).toBeGreaterThan(1024 * 1024);
        expect(profile[key].archive).toMatch(/^(zip|tar\.gz|tar\.xz|windowsInstaller)$/);
      }
      expect(profile.python311.archive).toBe("tar.gz");
      expect(profile.python311.url).toContain("python-build-standalone");
      expect(profile.python311.stripPrefix).toBe("python");
    }
  });

  it("uses mainland mirrors for China-only heavy downloads", () => {
    const manifest = JSON.parse(
      readFileSync(
        "src-tauri/resources/runtime-dependency-sources.json",
        "utf8",
      ),
    );
    const profiles = manifest.platforms["windows-x64"];

    expect(profiles.china.ffmpeg.url).not.toContain("www.gyan.dev");
    expect(profiles.china.ffmpeg.url).not.toBe(profiles.official.ffmpeg.url);
    expect(profiles.china.pytorchCpuFindLinksUrl).toBe(
      "https://mirrors.aliyun.com/pytorch-wheels/cpu/",
    );
    expect(profiles.china.pytorchCudaFindLinksUrl).toBe(
      "https://mirrors.aliyun.com/pytorch-wheels/cu126/",
    );
    expect(profiles.china.pytorchCpuIndexUrl).toBeNull();
    expect(profiles.china.pytorchCudaIndexUrl).toBeNull();
  });
});
