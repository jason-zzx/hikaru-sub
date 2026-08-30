import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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

    expect(prepared.archiveSha256).toBe(
      "958eba83b2426a7904296df4d0756b83ec084c646dfec2f48327cf38abf85d75",
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
  }, 30_000);
});
