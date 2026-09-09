import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyCrispasrArchive, verifyCrispasrTree } from "./verify-crispasr-runtime.mjs";

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
