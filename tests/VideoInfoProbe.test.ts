import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ffmpegSource = readFileSync(
  fileURLToPath(new URL("../src-tauri/src/ffmpeg.rs", import.meta.url)),
  "utf8",
);

describe("video info probe", () => {
  it("uses the shared ffprobe resolver instead of replacing every ffmpeg path segment", () => {
    const getVideoInfoBody = ffmpegSource.slice(
      ffmpegSource.indexOf("pub async fn get_video_info"),
      ffmpegSource.indexOf("/// 提取音频波形数据"),
    );

    expect(getVideoInfoBody).toContain("resolve_ffprobe(&app, &settings)");
    expect(getVideoInfoBody).not.toContain('replace("ffmpeg", "ffprobe")');
  });
});
