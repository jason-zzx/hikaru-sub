import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { prepareAsrResources } from "./prepare-asr-resource.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots = [];

function copy(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("ASR release resource preparation", () => {
  it("removes a stale Python sidecar resource and prepares the locked Native runtime", () => {
    const root = mkdtempSync(join(tmpdir(), "hikaru-asr-resource-"));
    temporaryRoots.push(root);

    copy(
      join(repositoryRoot, "native-asr", "runtime", "windows-x64-cpu-lock.json"),
      join(root, "native-asr", "runtime", "windows-x64-cpu-lock.json"),
    );
    copy(
      join(repositoryRoot, "native-asr", "artifacts", "windows-x64-cpu.zip"),
      join(root, "native-asr", "artifacts", "windows-x64-cpu.zip"),
    );

    const lockPath = "native-asr/runtime/crispasr-product-lock.json";
    const lock = JSON.parse(readFileSync(join(repositoryRoot, lockPath), "utf8"));
    for (const path of [lockPath, lock.cpu.archive.path]) {
      copy(join(repositoryRoot, path), join(root, path));
    }

    const staleSidecar = join(
      root,
      "src-tauri",
      "resources",
      "asr-service",
      "main.py",
    );
    mkdirSync(dirname(staleSidecar), { recursive: true });
    writeFileSync(staleSidecar, "print('stale')");

    const prepared = prepareAsrResources(root);
    const crispasr = join(root, "src-tauri/resources/native-asr/windows-x64/crispasr/cpu/crispasr.exe");
    expect(existsSync(crispasr)).toBe(true);
    prepareAsrResources(root);
    expect(existsSync(crispasr)).toBe(true);

    expect(prepared.archiveSha256).toBe(
      "5177c87160e7b8e78685b7d61c99acf29f740071c7cbe79fdae2ba9d5cb1fbcf",
    );
    expect(existsSync(join(root, "src-tauri", "resources", "asr-service"))).toBe(
      false,
    );
    expect(
      existsSync(
        join(
          root,
          "src-tauri",
          "resources",
          "native-asr",
          "windows-x64",
          "cpu",
          "runtime-manifest.json",
        ),
      ),
    ).toBe(true);
  }, 60_000);
});
