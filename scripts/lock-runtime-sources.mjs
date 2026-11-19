#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(
  root,
  "src-tauri",
  "resources",
  "runtime-dependency-sources.json",
);
const cacheDir = join(root, ".cache", "runtime-sources");

const officialSources = {
  ffmpeg: {
    url:
      process.env.RUNTIME_OFFICIAL_FFMPEG_URL ??
      "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    archive: "zip",
  },
};

const chinaSources = {
  ffmpeg: {
    url:
      process.env.RUNTIME_CHINA_FFMPEG_URL ??
      "https://ghfast.top/https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-06-30-13-34/ffmpeg-n7.1.5-1-g7d0e842004-win64-gpl-7.1.zip",
    archive: "zip",
  },
};

async function downloadAndHash(url, name) {
  await mkdir(cacheDir, { recursive: true });
  const dest = join(cacheDir, name);
  const tmp = `${dest}.part`;
  const hash = createHash("sha256");
  const res = await fetch(url, { redirect: "follow" });

  if (!res.ok || !res.body) {
    throw new Error(`download failed ${url}: HTTP ${res.status}`);
  }

  const stream = Readable.fromWeb(res.body);
  stream.on("data", (chunk) => hash.update(chunk));
  await pipeline(stream, createWriteStream(tmp));
  await rename(tmp, dest);

  const info = await stat(dest);
  return { sha256: hash.digest("hex"), sizeBytes: info.size };
}

async function sourceWithDigest(source, name) {
  const digest = await downloadAndHash(source.url, name);
  return { ...source, ...digest };
}

async function main() {
  const existing = JSON.parse(await readFile(outPath, "utf8"));
  const existingProfiles = existing.platforms?.["windows-x64"] ?? {};
  const officialFfmpeg = await sourceWithDigest(
    officialSources.ffmpeg,
    "official-ffmpeg-windows.zip",
  );
  const chinaFfmpeg =
    chinaSources.ffmpeg.url === officialSources.ffmpeg.url
      ? officialFfmpeg
      : await sourceWithDigest(chinaSources.ffmpeg, "china-ffmpeg-windows.zip");

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platforms: {
      "windows-x64": {
        official: {
          id: "official",
          label: "官方源",
          ffmpeg: officialFfmpeg,
          ...(existingProfiles.official?.nativeAsrCuda
            ? { nativeAsrCuda: existingProfiles.official.nativeAsrCuda }
            : {}),
          huggingfaceEndpoint: null,
          ...(existingProfiles.official?.crispasrCuda
            ? { crispasrCuda: existingProfiles.official.crispasrCuda }
            : {}),
        },
        china: {
          id: "china",
          label: "中国大陆镜像",
          ffmpeg: chinaFfmpeg,
          ...(existingProfiles.china?.nativeAsrCuda
            ? { nativeAsrCuda: existingProfiles.china.nativeAsrCuda }
            : {}),
          huggingfaceEndpoint: "https://hf-mirror.com",
          ...(existingProfiles.china?.crispasrCuda
            ? { crispasrCuda: existingProfiles.china.crispasrCuda }
            : {}),
        },
      },
    },
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  JSON.parse(await readFile(outPath, "utf8"));
  console.log(`wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
