import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));

const installedReleaseEntries = [
  "hikaru-sub.exe",
  "runtime-dependency-sources.json",
  "asr-service",
];

export function portableStageName({ productName, version, arch }) {
  return `${productName}_${version}_${arch}-portable`;
}

export function portableArchiveName({ productName, version, arch }) {
  return `${portableStageName({ productName, version, arch })}.zip`;
}

export function createPortableStaging({
  root = defaultRoot,
  releaseDir = join(root, "src-tauri", "target", "release"),
  productName,
  version,
  arch = "x64",
}) {
  const exePath = join(releaseDir, "hikaru-sub.exe");
  const asrResource = join(releaseDir, "asr-service");

  if (!existsSync(exePath)) {
    throw new Error(`missing release executable: ${exePath}`);
  }
  if (!existsSync(asrResource)) {
    throw new Error(`missing ASR resource directory: ${asrResource}`);
  }

  const portableDir = join(releaseDir, "bundle", "portable");
  const stageDir = join(
    portableDir,
    portableStageName({ productName, version, arch }),
  );
  const archivePath = join(
    portableDir,
    portableArchiveName({ productName, version, arch }),
  );

  rmSync(stageDir, { recursive: true, force: true });
  rmSync(archivePath, { force: true });
  mkdirSync(stageDir, { recursive: true });

  for (const entry of installedReleaseEntries) {
    const source = join(releaseDir, entry);
    const target = join(stageDir, entry);
    if (!existsSync(source)) {
      throw new Error(`missing release package entry: ${source}`);
    }
    cpSync(source, target, { recursive: true });
  }

  writeFileSync(join(stageDir, ".portable"), "");

  return { archivePath, stageDir };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function zipWithPowerShell(stageDir, archivePath) {
  run("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "$ErrorActionPreference='Stop'; Compress-Archive -LiteralPath $env:HIKARU_SUB_PORTABLE_STAGE -DestinationPath $env:HIKARU_SUB_PORTABLE_ARCHIVE -Force",
  ], {
    env: {
      ...process.env,
      HIKARU_SUB_PORTABLE_STAGE: stageDir,
      HIKARU_SUB_PORTABLE_ARCHIVE: archivePath,
    },
  });
}

function zipWithZip(stageDir, archivePath) {
  run("zip", ["-r", archivePath, basename(stageDir)], {
    cwd: dirname(stageDir),
  });
}

export function createPortableArchive(paths) {
  if (process.platform === "win32") {
    zipWithPowerShell(paths.stageDir, paths.archivePath);
  } else {
    zipWithZip(paths.stageDir, paths.archivePath);
  }
}

function packageMetadata(root) {
  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const tauriConfig = JSON.parse(
    readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
  );

  return {
    productName: tauriConfig.productName,
    version: tauriConfig.version ?? packageJson.version,
  };
}

export function packagePortable({
  root = defaultRoot,
  arch = process.env.HIKARU_PORTABLE_ARCH ?? "x64",
} = {}) {
  const metadata = packageMetadata(root);
  const staged = createPortableStaging({
    root,
    productName: metadata.productName,
    version: metadata.version,
    arch,
  });
  createPortableArchive(staged);
  return staged;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = packagePortable();
  console.log(`created portable package: ${result.archivePath}`);
}
