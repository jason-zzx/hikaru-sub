import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPortableArchive,
  createPortableStaging,
  packageMetadata,
  preparePortableNativeRuntime,
  portableArchiveName,
  portableStageName,
} from "../scripts/package-portable.mjs";

const rootFile = (path: string) =>
  fileURLToPath(new URL(`../${path}`, import.meta.url));

const tempRoots: string[] = [];

async function makeReleaseDir() {
  const root = mkdtempSync(join(tmpdir(), "hikaru-sub-portable-"));
  tempRoots.push(root);
  const releaseDir = join(root, "src-tauri", "target", "release");
  const resourceDir = join(root, "src-tauri", "resources");

  await mkdir(join(resourceDir, "asr-service"), { recursive: true });
  await mkdir(join(resourceDir, "native-asr", "windows-x64", "cpu"), {
    recursive: true,
  });
  await mkdir(join(releaseDir, "asr-service", "benchmarks"), { recursive: true });
  await mkdir(join(releaseDir, "resources"), { recursive: true });
  await mkdir(join(releaseDir, "deps", "ffmpeg", "current"), {
    recursive: true,
  });
  await mkdir(join(releaseDir, "tauri-generated"), { recursive: true });

  await writeFile(join(releaseDir, "hikaru-sub.exe"), "exe");
  await writeFile(join(resourceDir, "runtime-dependency-sources.json"), "{}");
  await writeFile(join(resourceDir, "asr-service", "main.py"), "print('ok')");
  await writeFile(
    join(resourceDir, "native-asr", "windows-x64", "cpu", "runtime-manifest.json"),
    "{}",
  );
  await writeFile(join(releaseDir, "asr-service", "benchmarks", "stale.wav"), "stale");
  await writeFile(join(releaseDir, "resources", "icon.ico"), "icon");
  await writeFile(join(releaseDir, "hikaru_sub.pdb"), "debug");
  await writeFile(join(releaseDir, "deps", "ffmpeg", "current", "ffmpeg.exe"), "ffmpeg");
  await writeFile(join(releaseDir, "tauri-generated", "cache.txt"), "cache");

  return { root, releaseDir };
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("portable package", () => {
  it("reads the archive version from the root package metadata", async () => {
    const { root } = await makeReleaseDir();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ version: "0.2.0" }),
    );
    await mkdir(join(root, "src-tauri"), { recursive: true });
    await writeFile(
      join(root, "src-tauri", "tauri.conf.json"),
      JSON.stringify({ productName: "Hikaru Sub", version: "../package.json" }),
    );

    expect(packageMetadata(root)).toEqual({
      productName: "Hikaru Sub",
      version: "0.2.0",
    });
  });

  it("uses a Windows x64 portable zip name that matches the NSIS artifact style", () => {
    expect(
      portableArchiveName({
        productName: "Hikaru Sub",
        version: "0.1.0",
        arch: "x64",
      }),
    ).toBe("Hikaru Sub_0.1.0_x64-portable.zip");
    expect(
      portableStageName({
        productName: "Hikaru Sub",
        version: "0.1.0",
        arch: "x64",
      }),
    ).toBe("Hikaru Sub_0.1.0_x64-portable");
  });

  it("stages only approved Native app resources", async () => {
    const { root, releaseDir } = await makeReleaseDir();

    const result = createPortableStaging({
      root,
      releaseDir,
      productName: "Hikaru Sub",
      version: "0.1.0",
      arch: "x64",
    });

    expect(result.archivePath).toBe(
      join(
        root,
        "src-tauri",
        "target",
        "release",
        "bundle",
        "portable",
        "Hikaru Sub_0.1.0_x64-portable.zip",
      ),
    );
    expect(existsSync(join(result.stageDir, "hikaru-sub.exe"))).toBe(true);
    expect(existsSync(join(result.stageDir, "runtime-dependency-sources.json"))).toBe(
      true,
    );
    expect(existsSync(join(result.stageDir, "asr-service"))).toBe(false);
    expect(
      existsSync(
        join(
          result.stageDir,
          "native-asr",
          "windows-x64",
          "cpu",
          "runtime-manifest.json",
        ),
      ),
    ).toBe(true);
    expect(existsSync(join(result.stageDir, "resources"))).toBe(false);
    expect(existsSync(join(result.stageDir, "deps"))).toBe(false);
    expect(existsSync(join(result.stageDir, "tauri-generated"))).toBe(false);
    expect(existsSync(join(result.stageDir, "hikaru_sub.pdb"))).toBe(false);
    expect(existsSync(join(result.stageDir, ".portable"))).toBe(true);
    expect(statSync(join(result.stageDir, ".portable")).isFile()).toBe(true);
  });

  it.skipIf(process.platform !== "win32")(
    "creates a zip archive from staged portable files on Windows",
    async () => {
      const { root, releaseDir } = await makeReleaseDir();
      const result = createPortableStaging({
        root,
        releaseDir,
        productName: "Hikaru Sub",
        version: "0.1.0",
        arch: "x64",
      });

      createPortableArchive(result);

      expect(statSync(result.archivePath).size).toBeGreaterThan(0);
    },
    20_000,
  );

  it("re-verifies the tracked native runtime before portable staging", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const lock = JSON.parse(
      readFileSync(
        join(root, "native-asr", "runtime", "windows-x64-cpu-lock.json"),
        "utf8",
      ),
    );
    expect(preparePortableNativeRuntime(root).archiveSha256).toBe(
      lock.artifact.sha256,
    );
  }, 30_000);

  it("wires local and GitHub release packaging to create the portable zip", () => {
    const packageJson = JSON.parse(readFileSync(rootFile("package.json"), "utf8"));
    const workflow = readFileSync(rootFile(".github/workflows/release.yml"), "utf8");

    expect(packageJson.scripts["release:portable"]).toBe(
      "node scripts/package-portable.mjs",
    );
    expect(packageJson.scripts["release:local"]).toBe(
      "pnpm asr:prepare-resource && tauri build && pnpm release:portable",
    );
    expect(workflow).toContain("pnpm release:portable");
    expect(workflow).toContain("src-tauri/target/release/bundle/portable/*.zip");
  });
});
