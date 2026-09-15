import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyCrispasrArchive, verifyCrispasrTree } from "./verify-crispasr-runtime.mjs";
import { sha256File } from "./verify-native-asr-runtime.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
describe("independent CrispASR CPU artifact", () => {
  it("retains publication only for the exact uploaded CUDA archive, never rebuilt bytes", () => {
    execFileSync("python", ["-c", `
import copy, json, runpy
from pathlib import Path
producer = runpy.run_path('native-asr/runtime/full-cli/package.py')
check = producer['is_published_cuda_archive']
lock = json.loads(Path('native-asr/runtime/crispasr-product-lock.json').read_text(encoding='utf-8'))
assert lock['productEnablementAllowed'] and lock['externalStableAssetPublished']
archive = lock['cuda']['archive']
assert check(archive, lock)
for key in ['sha256', 'sizeBytes', 'root', 'path']:
    changed = dict(archive)
    changed[key] = 'changed' if isinstance(changed[key], str) else changed[key] + 1
    assert not check(changed, lock), key
unpublished = copy.deepcopy(lock)
unpublished['externalStableAssetPublished'] = False
assert not check(archive, unpublished)
assert not check(archive, {})
`], { cwd: root, stdio: "pipe" });
  });
  it("requires explicit shared identity, exact capabilities, model credit and full DLL closure", () => {
    const temp = mkdtempSync(join(tmpdir(), "crispasr-shared-"));
    try {
      // Synthetic metadata over the verified CPU payload, not new model proof.
      const target = join(temp, "runtime");
      verifyCrispasrArchive({ root, extractTo: target });
      const artifact = JSON.parse(readFileSync(join(root, "native-asr/runtime/crispasr-product-lock.json"), "utf8")).cpu;
      const manifest = JSON.parse(readFileSync(join(target, "runtime-manifest.json"), "utf8"));
      artifact.artifactId = manifest.artifactId = "hikaru-asr-crispasr-windows-x64-cpu-shared-fixture";
      artifact.engines = manifest.capabilities.engines = ["qwen3-asr", "parakeet"];
      const modelPath = join(target, "licenses/MODEL-SOURCES.json");
      const models = JSON.parse(readFileSync(modelPath, "utf8"));
      models.assets = models.assets.filter(row => row.logicalModel !== "nvidia/parakeet-tdt_ctc-0.6b-ja");
      models.assets.push({ logicalModel: "nvidia/parakeet-tdt_ctc-0.6b-ja", license: "CC-BY-4.0",
        attribution: "Synthetic credit", modificationNotice: "Synthetic conversion", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" });
      const relock = () => {
        writeFileSync(modelPath, JSON.stringify(models));
        for (const file of artifact.files) {
          const path = join(target, file.path);
          file.sizeBytes = readFileSync(path).length;
          file.sha256 = sha256File(path);
        }
        manifest.files = artifact.files;
        writeFileSync(join(target, "runtime-manifest.json"), JSON.stringify(manifest));
        artifact.manifestSha256 = sha256File(join(target, "runtime-manifest.json"));
        writeFileSync(join(target, "SHA256SUMS"), artifact.files.map(f => `${f.sha256}  ${f.path}\n`).join(""));
      };
      relock();
      verifyCrispasrTree(target, artifact, "cpu");
      for (const engines of [["parakeet"], ["parakeet", "qwen3-asr"], ["qwen3-asr"]]) {
        expect(() => verifyCrispasrTree(target, { ...artifact, engines }, "cpu")).toThrow();
      }
      delete models.assets.at(-1).attribution;
      relock();
      expect(() => verifyCrispasrTree(target, artifact, "cpu")).toThrow();
      models.assets.at(-1).attribution = "Synthetic credit";
      // Even a self-consistent manifest cannot omit a required runtime DLL.
      artifact.files = artifact.files.filter(f => f.path !== "vcomp140.dll");
      rmSync(join(target, "vcomp140.dll"));
      relock();
      expect(() => verifyCrispasrTree(target, artifact, "cpu")).toThrow();
      expect(() => verifyCrispasrArchive({ root, candidateLockPath: "relative.json" })).toThrow();
      expect(() => verifyCrispasrArchive({ root, candidateLockPath: join(root, "native-asr/runtime/crispasr-product-lock.json") })).toThrow();
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }, 60000);
  it("verifies the real archive and rejects missing, extra, corrupt, wrong-device and manifest data", () => {
    const temp = mkdtempSync(join(tmpdir(), "crispasr-verify-"));
    try {
      const target = join(temp, "runtime"), lock = JSON.parse(readFileSync(join(root,"native-asr/runtime/crispasr-product-lock.json"),"utf8"));
      verifyCrispasrArchive({root, extractTo: target});
      expect(() => verifyCrispasrTree(target,lock.cpu,"cuda")).toThrow();
      const worker = join(target,"hikaru-asr-worker.exe"), bytes=readFileSync(worker);
      rmSync(worker); expect(() => verifyCrispasrTree(target,lock.cpu,"cpu")).toThrow();
      writeFileSync(worker,Buffer.alloc(bytes.length)); expect(() => verifyCrispasrTree(target,lock.cpu,"cpu")).toThrow();
      writeFileSync(worker,bytes);
      for (const name of ["ctranslate2.dll","cudart64_12.dll","model.gguf","raw.wav"]) {
        writeFileSync(join(target,name),"unwanted");expect(() => verifyCrispasrTree(target,lock.cpu,"cpu")).toThrow();rmSync(join(target,name));
      }
      const manifest=join(target,"runtime-manifest.json");writeFileSync(manifest,"{}");
      expect(() => verifyCrispasrTree(target,lock.cpu,"cpu")).toThrow();
    } finally {rmSync(temp,{recursive:true,force:true});}
  },60000);
});
