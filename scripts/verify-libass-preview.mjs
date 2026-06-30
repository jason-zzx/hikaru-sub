import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [videoPath, assPath, outDirArg, fontDir] = process.argv.slice(2);

if (!videoPath || !assPath) {
  console.error(
    "Usage: node scripts/verify-libass-preview.mjs <video> <ass> [outDir] [fontDir]",
  );
  process.exit(1);
}

const outDir = outDirArg ?? "target/libass-preview";
const times = (process.env.HIKARU_PREVIEW_TIMES ?? "30,60,90")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value >= 0);

if (times.length === 0) {
  console.error("HIKARU_PREVIEW_TIMES must contain at least one second value.");
  process.exit(1);
}

function escapeFilterPath(value) {
  return value.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

function buildAssFilter(assFile, fontDirectory) {
  let filter = `ass=filename='${escapeFilterPath(assFile)}'`;
  if (fontDirectory?.trim()) {
    filter += `:fontsdir='${escapeFilterPath(fontDirectory.trim())}'`;
  }
  return filter;
}

await mkdir(outDir, { recursive: true });

const frames = [];
const filter = buildAssFilter(assPath, fontDir);

for (const seconds of times) {
  const output = path.join(outDir, `ffmpeg-${seconds}s.png`);
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-y",
      "-ss",
      String(seconds),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      filter,
      "-an",
      output,
    ],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  frames.push({ seconds, output });
}

await writeFile(
  path.join(outDir, "manifest.json"),
  `${JSON.stringify({ videoPath, assPath, fontDir: fontDir ?? null, frames }, null, 2)}\n`,
);
