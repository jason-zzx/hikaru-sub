import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readRuntimeLock,
  verifyRuntimeArchive,
} from "./verify-native-asr-runtime.mjs";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));

export function prepareAsrResources(root = defaultRoot) {
  const legacyTarget = join(root, "src-tauri", "resources", "asr-service");
  const runtimeLockPath = join(
    root,
    "native-asr",
    "runtime",
    "windows-x64-cpu-lock.json",
  );
  const nativeRuntimeTarget = join(root, "src-tauri", "resources", "native-asr");

  rmSync(legacyTarget, { recursive: true, force: true });

  const runtimeLock = readRuntimeLock(runtimeLockPath);
  return verifyRuntimeArchive({
    archivePath: join(root, runtimeLock.artifact.path),
    lockPath: runtimeLockPath,
    extractTo: nativeRuntimeTarget,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const verifiedRuntime = prepareAsrResources();
  console.log(
    `prepared Native ASR runtime: ${verifiedRuntime.runtimeRoot} (${verifiedRuntime.archiveSha256})`,
  );
}
