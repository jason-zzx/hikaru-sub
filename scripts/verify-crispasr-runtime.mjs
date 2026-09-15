import { readFileSync, readdirSync, lstatSync, mkdirSync, mkdtempSync, rmSync, renameSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { assertSafeArchivePath, extractZipSafely, listZipEntries, sha256File } from "./verify-native-asr-runtime.mjs";

const check = (condition) => { if (!condition) throw new Error("CrispASR runtime identity/closure invalid"); };
export function verifyCrispasrTree(root, artifact, device) {
  const engines = artifact?.engines ?? ["qwen3-asr"];
  const shared = JSON.stringify(engines) === JSON.stringify(["qwen3-asr", "parakeet"]);
  check(shared
    ? new RegExp(`^hikaru-asr-crispasr-windows-x64-${device}-shared-[a-z0-9]+(?:-[a-z0-9]+)*$`).test(artifact?.artifactId)
    : JSON.stringify(engines) === '["qwen3-asr"]' && artifact?.artifactId === `hikaru-asr-crispasr-windows-x64-${device}-v1`);
  const names = [];
  function walk(dir, prefix = "") {
    check(!lstatSync(dir).isSymbolicLink());
    for (const name of readdirSync(dir)) {
      const path = prefix + name, absolute = join(dir, name), stat = lstatSync(absolute);
      assertSafeArchivePath(path); check(!stat.isSymbolicLink());
      if (stat.isDirectory()) walk(absolute, path + "/");
      else { check(stat.isFile()); names.push(path); }
    }
  }
  walk(root);
  check(sha256File(join(root, "runtime-manifest.json")) === artifact.manifestSha256);
  const manifest = JSON.parse(readFileSync(join(root, "runtime-manifest.json"), "utf8"));
  check(manifest.artifactId === artifact.artifactId && manifest.schemaVersion === 1 && manifest.protocolVersion === 1);
  check(manifest.platform === "windows-x64" && manifest.arch === "x64");
  check(JSON.stringify(manifest.files) === JSON.stringify(artifact.files));
  check(JSON.stringify(manifest.capabilities) === JSON.stringify({ backend: "crispasr", device, engines, vad: true, crispasr: true, cuda: device === "cuda", vulkan: false, modelsBundled: false }));
  const expected = [...artifact.files.map(f => f.path), "runtime-manifest.json", "SHA256SUMS"].sort();
  check(new Set(expected.map(p => p.toLowerCase())).size === expected.length);
  check(JSON.stringify(names.sort()) === JSON.stringify(expected));
  check(readFileSync(join(root, "SHA256SUMS"), "utf8") === artifact.files.map(f => `${f.sha256}  ${f.path}\n`).join(""));
  for (const file of artifact.files) {
    assertSafeArchivePath(file.path);
    check(file.sizeBytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256));
    const path = join(root, file.path);
    check(lstatSync(path).size === file.sizeBytes && sha256File(path) === file.sha256);
    check(file.path.startsWith("licenses/") || /^(crispasr\.exe|hikaru-asr-worker\.exe|msvcp140\.dll|vcruntime140(_1)?\.dll|vcomp140\.dll)$/.test(file.path)
      || (device === "cuda" && /^(cudart64_12|cublas64_12|cublasLt64_12)\.dll$/.test(file.path)));
    if (/\.(exe|dll)$/.test(file.path)) {
      const bytes = readFileSync(path);
      for (const needle of [".trellis", "C:\\Users\\", "C:/Users/"]) {
        check(!bytes.includes(Buffer.from(needle)) && !bytes.includes(Buffer.from(needle, "utf16le")));
      }
    }
  }
  for (const required of ["crispasr.exe", "hikaru-asr-worker.exe", "msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll", "vcomp140.dll",
    ...(device === "cuda" ? ["cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"] : []),
    "licenses/THIRD-PARTY-NOTICES.json", "licenses/MODEL-SOURCES.json", "licenses/Microsoft-Visual-Cpp-V14-Runtime-2026-License.docx"]) check(expected.includes(required));
  const notices = JSON.parse(readFileSync(join(root, "licenses/THIRD-PARTY-NOTICES.json"), "utf8"));
  check(notices.components.length > 0 && notices.modelsBundled === false);
  for (const component of notices.components) check(expected.includes(component.localLicenseFile) && component.source && component.license);
  const models = JSON.parse(readFileSync(join(root, "licenses/MODEL-SOURCES.json"), "utf8"));
  check(models.weightsBundled === false);
  if (shared) {
    const model = models.assets.find(row => row.logicalModel === "nvidia/parakeet-tdt_ctc-0.6b-ja");
    check(model?.license === "CC-BY-4.0" && model.attribution && model.modificationNotice && model.licenseUrl === "https://creativecommons.org/licenses/by/4.0/");
  }
  return { runtimeRoot: root, artifactId: artifact.artifactId };
}

export function verifyCrispasrArchive({ root, device = "cpu", extractTo, candidateLockPath }) {
  if (candidateLockPath) check(isAbsolute(candidateLockPath));
  const lock = JSON.parse(readFileSync(candidateLockPath ?? join(root, "native-asr/runtime/crispasr-product-lock.json"), "utf8"));
  check(lock.schemaVersion === 1);
  if (candidateLockPath) {
    check(/^shared-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(lock.candidateId) && lock.externalStableAssetPublished === false);
    for (const kind of ["cpu", "cuda"]) {
      check(lock[kind]?.artifactId === `hikaru-asr-crispasr-windows-x64-${kind}-${lock.candidateId}`);
      check(JSON.stringify(lock[kind]?.engines) === '["qwen3-asr","parakeet"]');
    }
  }
  const artifact = lock[device], archive = artifact?.archive;
  check(archive?.root === `windows-x64/crispasr/${device}/`);
  assertSafeArchivePath(archive.path);
  const path = join(root, archive.path);
  check(lstatSync(path).size === archive.sizeBytes && sha256File(path) === archive.sha256);
  const entries = listZipEntries(path), expected = artifact.files.map(f => archive.root + f.path).concat(archive.root + "SHA256SUMS", archive.root + "runtime-manifest.json").sort();
  check(JSON.stringify(entries.map(e => e.path).sort()) === JSON.stringify(expected));
  const temp = mkdtempSync(join(tmpdir(), "hikaru-crispasr-"));
  try {
    extractZipSafely(path, temp);
    const payload = join(temp, archive.root);
    verifyCrispasrTree(payload, artifact, device);
    if (extractTo) {
      const destination = resolve(extractTo), backup = destination + `.previous-${process.pid}`;
      check(!existsSync(backup)); mkdirSync(dirname(destination), { recursive: true });
      if (existsSync(destination)) renameSync(destination, backup);
      try { renameSync(payload, destination); }
      catch (error) { if (existsSync(backup)) renameSync(backup, destination); throw error; }
      rmSync(backup, { recursive: true, force: true });
      return verifyCrispasrTree(destination, artifact, device);
    }
    return { artifactId: artifact.artifactId, archiveSha256: archive.sha256 };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
