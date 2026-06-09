#!/usr/bin/env node
// 按当前平台下载静态 FFmpeg 二进制到 src-tauri/binaries/。
// 仅在打包发布前需要运行；开发时运行时会回退到系统 PATH 的 ffmpeg。
//
//   pnpm ffmpeg:fetch
//
// 可用环境变量覆盖下载地址：FFMPEG_URL（指向 zip/tar.xz 压缩包）。

import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, readdir, copyFile, chmod, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const binDir = join(__dirname, "..", "src-tauri", "binaries");

// 各平台默认静态构建下载源（可通过 FFMPEG_URL 覆盖）。
const SOURCES = {
  "win32-x64": {
    url: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    archive: "zip",
    member: "ffmpeg.exe",
    out: "ffmpeg.exe",
  },
  "linux-x64": {
    url: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",
    archive: "tar.xz",
    member: "ffmpeg",
    out: "ffmpeg",
  },
  "darwin-x64": {
    url: "https://evermeet.cx/ffmpeg/getrelease/zip",
    archive: "zip",
    member: "ffmpeg",
    out: "ffmpeg",
  },
  "darwin-arm64": {
    url: "https://www.osxexperts.net/ffmpeg7arm.zip",
    archive: "zip",
    member: "ffmpeg",
    out: "ffmpeg",
  },
};

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function fail(msg) {
  console.error(`\n[fetch-ffmpeg] ${msg}\n`);
  process.exit(1);
}

function which(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [cmd], { stdio: "ignore" }).status === 0;
}

async function download(url, dest) {
  console.log(`[fetch-ffmpeg] 下载 ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    fail(`下载失败：HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    fail(`命令失败：${cmd} ${args.join(" ")}`);
  }
}

// 在目录树中查找指定文件名，返回绝对路径。
async function findMember(root, member) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = await findMember(full, member);
      if (found) return found;
    } else if (entry.name === member) {
      return full;
    }
  }
  return null;
}

async function extract(archivePath, kind, workDir) {
  if (kind === "tar.xz") {
    if (!which("tar")) fail("需要 tar 解压 tar.xz，请先安装。");
    run("tar", ["-xf", archivePath, "-C", workDir]);
  } else if (kind === "zip") {
    if (process.platform === "win32") {
      run("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Force -Path '${archivePath}' -DestinationPath '${workDir}'`,
      ]);
    } else if (which("unzip")) {
      run("unzip", ["-o", "-q", archivePath, "-d", workDir]);
    } else {
      fail("需要 unzip 解压 zip，请先安装。");
    }
  } else {
    fail(`不支持的压缩格式：${kind}`);
  }
}

async function main() {
  const key = platformKey();
  const source = SOURCES[key];
  if (!source) {
    fail(
      `暂无 ${key} 的默认下载源。请手动将 ffmpeg 放到 ${binDir}/，` +
        `或设置 FFMPEG_URL 指向压缩包后重试。`,
    );
  }
  const url = process.env.FFMPEG_URL || source.url;

  await mkdir(binDir, { recursive: true });
  const work = await mkdirTemp();
  const archivePath = join(work, `ffmpeg-archive.${source.archive.replace(".", "_")}`);

  try {
    await download(url, archivePath);
    await extract(archivePath, source.archive, work);

    const member = await findMember(work, source.member);
    if (!member) {
      fail(`压缩包内未找到 ${source.member}`);
    }

    const dest = join(binDir, source.out);
    await copyFile(member, dest);
    if (process.platform !== "win32") {
      await chmod(dest, 0o755);
    }
    const info = await stat(dest);
    console.log(
      `[fetch-ffmpeg] 完成：${dest}（${(info.size / 1e6).toFixed(1)} MB）`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function mkdirTemp() {
  const dir = join(tmpdir(), `hikaru-ffmpeg-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

main().catch((e) => fail(e?.message ?? String(e)));
