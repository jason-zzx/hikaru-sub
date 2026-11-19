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
      for (const key of ["ffmpeg", "nativeAsrCuda", "crispasrCuda"] as const) {
        expect(profile[key].url).toMatch(/^https:\/\//);
        expect(profile[key].sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(profile[key].sizeBytes).toBeGreaterThan(1024 * 1024);
        expect(profile[key].archive).toBe("zip");
      }
      expect(profile.python311).toBeUndefined();
      expect(profile.pipIndexUrl).toBeUndefined();
    }
  });

  it("pins both published CUDA downloads to the current VAD artifact", () => {
    const manifest = JSON.parse(
      readFileSync("src-tauri/resources/runtime-dependency-sources.json", "utf8"),
    );
    const lock = JSON.parse(
      readFileSync("native-asr/runtime/windows-x64-cuda-lock.json", "utf8"),
    );
    const expected = {
      archive: "zip",
      sha256: lock.artifact.sha256,
      sizeBytes: lock.artifact.sizeBytes,
    };

    const profiles = manifest.platforms["windows-x64"];
    expect(lock.productEnablementAllowed).toBe(true);
    expect(lock.publicationGate).toEqual({
      externalStableAssetPublished: true,
      runtimeDependencySourceRowPresent: true,
    });
    for (const profile of [profiles.official, profiles.china]) {
      expect(profile.nativeAsrCuda).toMatchObject(expected);
      expect(profile.nativeAsrCuda.url).toContain(`${lock.artifact.id}.zip`);
    }
    expect(profiles.china.nativeAsrCuda.url).toBe(`https://ghfast.top/${profiles.official.nativeAsrCuda.url}`);
    expect(profiles.china.nativeAsrCuda.sha256).toBe(profiles.official.nativeAsrCuda.sha256);
    expect(profiles.china.nativeAsrCuda.sizeBytes).toBe(profiles.official.nativeAsrCuda.sizeBytes);
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
    expect(profiles.china.huggingfaceEndpoint).toBe("https://hf-mirror.com");
    expect(profiles.official.huggingfaceEndpoint).toBeNull();
  });
});
