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
import {
  readRuntimeLock,
  verifyRuntimeArchive,
} from "./verify-native-asr-runtime.mjs";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));

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
  const resourceDir = join(root, "src-tauri", "resources");
  const runtimeSources = join(resourceDir, "runtime-dependency-sources.json");
  const nativeAsrResource = join(resourceDir, "native-asr");

  if (!existsSync(exePath)) {
    throw new Error(`missing release executable: ${exePath}`);
  }
  if (!existsSync(runtimeSources)) {
    throw new Error(`missing runtime source manifest: ${runtimeSources}`);
  }
  if (!existsSync(nativeAsrResource)) {
    throw new Error(`missing Native ASR resource directory: ${nativeAsrResource}`);
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

  for (const [source, entry] of [
    [exePath, "hikaru-sub.exe"],
    [runtimeSources, "runtime-dependency-sources.json"],
    [nativeAsrResource, "native-asr"],
  ]) {
    cpSync(source, join(stageDir, entry), { recursive: true });
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

export function packageMetadata(root) {
  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const tauriConfig = JSON.parse(
    readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
  );

  return {
    productName: tauriConfig.productName,
    version: packageJson.version,
  };
}

export function preparePortableNativeRuntime(root = defaultRoot) {
  const lockPath = join(root, "native-asr", "runtime", "windows-x64-cpu-lock.json");
  const lock = readRuntimeLock(lockPath);
  return verifyRuntimeArchive({
    archivePath: join(root, lock.artifact.path),
    lockPath,
    extractTo: join(root, "src-tauri", "resources", "native-asr"),
  });
}

export function packagePortable({
  root = defaultRoot,
  arch = process.env.HIKARU_PORTABLE_ARCH ?? "x64",
} = {}) {
  preparePortableNativeRuntime(root);
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
