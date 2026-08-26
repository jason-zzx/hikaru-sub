#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));
const microsoftRuntimeLicense = Object.freeze({
  termsUrl:
    "https://visualstudio.microsoft.com/license-terms/vs2026-ga-visualcpp-v14-redist-runtime/",
  redistributionUrl: "https://aka.ms/vs/18/redistribution",
  documentUrl:
    "https://visualstudio.microsoft.com/wp-content/uploads/2025/10/Visual-C-V14-License-Redistributable_and_Runtime_ENU.docx",
  runtimePath: "licenses/Microsoft-Visual-Cpp-V14-Runtime-2026-License.docx",
  noticePath: "licenses/Microsoft-Visual-Cpp-Runtime.txt",
  componentVersion: "14.50.35717",
  licenseName: "Microsoft Visual C++ V14 Redistributable and Runtime 2026 terms",
  projectLicenseExclusion:
    "These Microsoft runtime files are excluded from Hikaru Sub's Apache-2.0 project license and are governed by the Microsoft Visual C++ V14 Redistributable and Runtime 2026 terms.",
  acceptance:
    "BY USING THE SOFTWARE, YOU ACCEPT THESE TERMS. IF YOU DO NOT ACCEPT THEM, DO NOT USE THE SOFTWARE.",
  files: Object.freeze([
    "msvcp140.dll",
    "vcomp140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
  ]),
});

function expectedMicrosoftRuntimeNotice() {
  return [
    "The bundled Microsoft Visual C++ Redistributable runtime files are excluded from",
    "Hikaru Sub's Apache-2.0 project license and are governed by the official Microsoft",
    "Visual C++ V14 Redistributable and Runtime 2026 terms included unchanged at:",
    microsoftRuntimeLicense.runtimePath,
    "",
    `Official terms: ${microsoftRuntimeLicense.termsUrl}`,
    `VS 18 redistribution list: ${microsoftRuntimeLicense.redistributionUrl}`,
    `Acceptance stated by Microsoft: ${microsoftRuntimeLicense.acceptance}`,
    `Files: ${[
      ...microsoftRuntimeLicense.files,
    ].sort((left, right) => left.localeCompare(right)).join(", ")}`,
  ].join("\n");
}
export const defaultRuntimeLock = join(
  defaultRoot,
  "native-asr",
  "runtime",
  "windows-x64-cpu-lock.json",
);

function fail(message) {
  throw new Error(`Native ASR runtime verification failed: ${message}`);
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readRuntimeLock(path = defaultRuntimeLock) {
  const lock = JSON.parse(readFileSync(path, "utf8"));
  if (lock.schemaVersion !== 1) fail("unsupported lock schema");
  if (!lock.artifact?.root?.endsWith("/")) fail("artifact root must end with /");
  if (
    !Array.isArray(lock.licenseInventory?.components) ||
    lock.licenseInventory.components.length === 0 ||
    !Array.isArray(lock.licenseInventory.requiredRustPackages)
  ) {
    fail("license inventory lock is missing");
  }
  const redistributables = Array.isArray(lock.redistributables)
    ? lock.redistributables
    : [];
  const component = lock.licenseInventory.components.find(
    (row) => row.name === "Microsoft Visual C++ Redistributable",
  );
  const requiresMicrosoftRuntimeContract =
    lock.artifact?.id === "hikaru-asr-windows-x64-cpu-v1" ||
    redistributables.length > 0 ||
    component !== undefined ||
    lock.requiredFiles?.some((row) => row.role === "microsoft-runtime");
  if (requiresMicrosoftRuntimeContract) {
    const source = lock.sources?.microsoftVisualCppRuntimeLicense;
    const redistributableFiles = redistributables
      .map((row) => row.fileName)
      .sort((left, right) => left.localeCompare(right));
    const expectedRedistributableFiles = [...microsoftRuntimeLicense.files].sort((left, right) =>
      left.localeCompare(right),
    );
    const expectedComponentKeys = [
      "acceptance",
      "files",
      "license",
      "localLicenseFile",
      "name",
      "projectLicenseExcluded",
      "projectLicenseExclusion",
      "redistributionSource",
      "source",
      "version",
    ].sort();
    if (
      source?.version !== "2026" ||
      source.termsUrl !== microsoftRuntimeLicense.termsUrl ||
      source.redistributionUrl !== microsoftRuntimeLicense.redistributionUrl ||
      source.url !== microsoftRuntimeLicense.documentUrl ||
      source.runtimePath !== microsoftRuntimeLicense.runtimePath ||
      source.acceptance !== microsoftRuntimeLicense.acceptance ||
      !Number.isSafeInteger(source.sizeBytes) ||
      source.sizeBytes <= 0 ||
      !/^[0-9a-f]{64}$/.test(source.sha256) ||
      component?.version !== microsoftRuntimeLicense.componentVersion ||
      component?.license !== microsoftRuntimeLicense.licenseName ||
      component?.source !== microsoftRuntimeLicense.termsUrl ||
      component?.redistributionSource !== microsoftRuntimeLicense.redistributionUrl ||
      component?.localLicenseFile !== microsoftRuntimeLicense.runtimePath ||
      component?.projectLicenseExcluded !== true ||
      component?.projectLicenseExclusion !== microsoftRuntimeLicense.projectLicenseExclusion ||
      component?.acceptance !== microsoftRuntimeLicense.acceptance ||
      !sameJson(Object.keys(component ?? {}).sort(), expectedComponentKeys) ||
      !sameJson(
        [...(component?.files ?? [])].sort((left, right) => left.localeCompare(right)),
        expectedRedistributableFiles,
      ) ||
      !sameJson(redistributableFiles, expectedRedistributableFiles) ||
      !lock.requiredFiles?.some(
        (row) => row.path === microsoftRuntimeLicense.runtimePath && row.role === "license",
      ) ||
      !lock.requiredFiles?.some(
        (row) => row.path === microsoftRuntimeLicense.noticePath && row.role === "license",
      ) ||
      expectedRedistributableFiles.some(
        (fileName) =>
          !lock.requiredFiles?.some(
            (row) => row.path === fileName && row.role === "microsoft-runtime",
          ),
      )
    ) {
      fail("Microsoft Visual C++ Runtime 2026 license contract is invalid");
    }
  }
  return lock;
}

function powerShellExecutable() {
  return process.platform === "win32" ? "powershell.exe" : "pwsh";
}

function runPowerShell(script, env) {
  const result = spawnSync(
    powerShellExecutable(),
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      env: { ...process.env, ...env },
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `PowerShell ZIP operation failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

export function listZipEntries(archivePath) {
  const output = runPowerShell(
    String.raw`
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($env:HIKARU_ZIP_PATH)
try {
  $rows = @($archive.Entries | ForEach-Object {
    [pscustomobject]@{ path = $_.FullName; length = $_.Length }
  })
  ConvertTo-Json -Compress -InputObject $rows
} finally {
  $archive.Dispose()
}
`,
    { HIKARU_ZIP_PATH: resolve(archivePath) },
  );
  return output ? JSON.parse(output) : [];
}

export function assertSafeArchivePath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.endsWith("/")
  ) {
    fail(`unsafe archive entry: ${JSON.stringify(path)}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    fail(`unsafe archive entry: ${JSON.stringify(path)}`);
  }
}

export function extractZipSafely(archivePath, destination) {
  const entries = listZipEntries(archivePath);
  for (const entry of entries) assertSafeArchivePath(entry.path);
  mkdirSync(destination, { recursive: true });
  runPowerShell(
    String.raw`
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($env:HIKARU_ZIP_PATH)
$destination = [System.IO.Path]::GetFullPath($env:HIKARU_ZIP_DEST)
$prefix = $destination.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
try {
  foreach ($entry in $archive.Entries) {
    $target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($destination, $entry.FullName))
    if (-not $target.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "ZIP entry escaped destination: $($entry.FullName)"
    }
    $parent = [System.IO.Path]::GetDirectoryName($target)
    [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
  }
} finally {
  $archive.Dispose()
}
`,
    {
      HIKARU_ZIP_PATH: resolve(archivePath),
      HIKARU_ZIP_DEST: resolve(destination),
    },
  );
  return entries;
}

function walkFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`symbolic link is forbidden: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
      else fail(`unsupported filesystem entry: ${path}`);
    }
  }
  visit(root);
  return files.sort();
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseChecksums(text) {
  const rows = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})  ([^\r\n]+)$/.exec(line);
    if (!match || rows.has(match[2])) fail("SHA256SUMS is malformed or duplicated");
    rows.set(match[2], match[1]);
  }
  return rows;
}

function assertNoPrivateBuildPath(absolutePath, relativePath) {
  const bytes = readFileSync(absolutePath);
  const ascii = bytes.toString("latin1").toLowerCase();
  const utf16 = bytes.toString("utf16le").toLowerCase();
  const hasPrivatePath = (text) =>
    /[a-z]:\\users\\/.test(text) ||
    text.includes("/users/") ||
    text.includes(".trellis\\tasks") ||
    text.includes(".trellis/tasks") ||
    text.includes("research\\local") ||
    text.includes("research/local");
  if (hasPrivatePath(ascii) || hasPrivatePath(utf16)) {
    fail(`private build path is embedded in runtime payload: ${relativePath}`);
  }
}

function verifyLicenseInventory(runtimeRoot, lock) {
  let inventory;
  try {
    inventory = JSON.parse(
      readFileSync(join(runtimeRoot, "licenses", "THIRD-PARTY-NOTICES.json"), "utf8"),
    );
  } catch {
    fail("third-party notice inventory is invalid JSON");
  }
  if (
    inventory.schemaVersion !== 1 ||
    inventory.artifactId !== lock.artifact.id ||
    !sameJson(inventory.components, lock.licenseInventory.components) ||
    inventory.rustCargoLockSha256 !== lock.sources.tokenizer.cargoLockSha256 ||
    !Array.isArray(inventory.rustPackages) ||
    inventory.rustPackages.length === 0
  ) {
    fail("third-party notice inventory does not match the outer lock");
  }
  const seen = new Set();
  for (const pkg of inventory.rustPackages) {
    const identity = `${pkg.name}@${pkg.version}`;
    if (
      typeof pkg.name !== "string" ||
      typeof pkg.version !== "string" ||
      typeof pkg.license !== "string" ||
      pkg.license.length === 0 ||
      seen.has(identity)
    ) {
      fail(`invalid Rust license inventory row: ${identity}`);
    }
    seen.add(identity);
  }
  for (const required of lock.licenseInventory.requiredRustPackages) {
    if (!inventory.rustPackages.some((pkg) => pkg.name === required)) {
      fail(`required Rust license inventory package is missing: ${required}`);
    }
  }
  const microsoftSource = lock.sources?.microsoftVisualCppRuntimeLicense;
  if (microsoftSource) {
    const documentPath = join(runtimeRoot, ...microsoftSource.runtimePath.split("/"));
    if (
      !existsSync(documentPath) ||
      statSync(documentPath).size !== microsoftSource.sizeBytes ||
      sha256File(documentPath) !== microsoftSource.sha256
    ) {
      fail("Microsoft Visual C++ Runtime 2026 license document identity mismatch");
    }
    const noticePath = join(runtimeRoot, ...microsoftRuntimeLicense.noticePath.split("/"));
    if (
      !existsSync(noticePath) ||
      readFileSync(noticePath, "utf8") !== expectedMicrosoftRuntimeNotice()
    ) {
      fail("Microsoft Visual C++ Runtime 2026 human-readable notice mismatch");
    }
  }
}

function assertNoForbiddenPath(path, lock) {
  const lower = path.toLowerCase();
  if (lock.forbiddenPathFragments.some((fragment) => lower.includes(fragment))) {
    fail(`forbidden runtime path: ${path}`);
  }
  if (lock.forbiddenExtensions.some((extension) => lower.endsWith(extension))) {
    fail(`forbidden runtime file extension: ${path}`);
  }
}

export function verifyExtractedRuntime(extractedRoot, lock = readRuntimeLock()) {
  const runtimeRoot = join(extractedRoot, ...lock.artifact.root.split("/").filter(Boolean));
  if (!existsSync(runtimeRoot) || !statSync(runtimeRoot).isDirectory()) {
    fail(`runtime root is missing: ${lock.artifact.root}`);
  }
  const manifestPath = join(runtimeRoot, "runtime-manifest.json");
  const sumsPath = join(runtimeRoot, "SHA256SUMS");
  if (!existsSync(manifestPath) || !existsSync(sumsPath)) {
    fail("runtime manifest or SHA256SUMS is missing");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.artifactId !== lock.artifact.id ||
    manifest.platform !== lock.platform ||
    manifest.arch !== lock.arch ||
    manifest.protocolVersion !== lock.protocolVersion ||
    !sameJson(manifest.candidateConfig, lock.candidateConfig) ||
    !sameJson(manifest.capabilities, lock.capabilities) ||
    !sameJson(manifest.sources, lock.sources) ||
    !sameJson(manifest.toolchain, lock.toolchain) ||
    !sameJson(manifest.systemDllAllowlist, lock.systemDllAllowlist)
  ) {
    fail("runtime manifest identity does not match the outer lock");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail("runtime manifest file inventory is empty");
  }
  const manifestRows = new Map();
  const canonicalManifestPaths = new Set();
  for (const row of manifest.files) {
    assertSafeArchivePath(row.path);
    assertNoForbiddenPath(row.path, lock);
    if (
      manifestRows.has(row.path) ||
      canonicalManifestPaths.has(row.path.toLowerCase()) ||
      !Number.isSafeInteger(row.sizeBytes) ||
      row.sizeBytes < 0 ||
      !/^[0-9a-f]{64}$/.test(row.sha256) ||
      typeof row.role !== "string"
    ) {
      fail(`invalid manifest file row: ${JSON.stringify(row)}`);
    }
    manifestRows.set(row.path, row);
    canonicalManifestPaths.add(row.path.toLowerCase());
  }
  for (const required of lock.requiredFiles) {
    const row = manifestRows.get(required.path);
    if (!row || row.role !== required.role) {
      fail(`required runtime role is missing or changed: ${required.path}`);
    }
  }
  const lockedPaths = lock.requiredFiles.map((row) => row.path).sort();
  if (!sameJson([...manifestRows.keys()].sort(), lockedPaths)) {
    fail("runtime manifest file closure does not match the outer lock");
  }
  const expectedFiles = [
    ...manifestRows.keys(),
    "runtime-manifest.json",
    "SHA256SUMS",
  ].sort();
  const actualFiles = walkFiles(runtimeRoot);
  if (!sameJson(actualFiles, expectedFiles)) {
    fail(`runtime file closure mismatch: ${JSON.stringify(actualFiles)}`);
  }
  const checksums = parseChecksums(readFileSync(sumsPath, "utf8"));
  if (!sameJson([...checksums.keys()].sort(), [...manifestRows.keys()].sort())) {
    fail("SHA256SUMS file closure does not match the manifest");
  }
  let unpackedBytes = statSync(manifestPath).size + statSync(sumsPath).size;
  for (const [path, row] of manifestRows) {
    const absolute = join(runtimeRoot, ...path.split("/"));
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink()) {
      fail(`manifest file is missing or symbolic: ${path}`);
    }
    assertNoPrivateBuildPath(absolute, path);
    const size = statSync(absolute).size;
    const sha256 = sha256File(absolute);
    if (size !== row.sizeBytes || sha256 !== row.sha256 || checksums.get(path) !== sha256) {
      fail(`manifest/checksum mismatch: ${path}`);
    }
    unpackedBytes += size;
  }
  if (unpackedBytes > lock.budgets.unpackedRuntimeBytes) {
    fail(`unpacked runtime exceeds budget: ${unpackedBytes}`);
  }
  verifyLicenseInventory(runtimeRoot, lock);
  const bundledDlls = new Set(
    [...manifestRows.keys()]
      .filter((path) => !path.includes("/") && path.toLowerCase().endsWith(".dll"))
      .map((path) => path.toLowerCase()),
  );
  const systemDlls = new Set(lock.systemDllAllowlist.map((name) => name.toLowerCase()));
  const importOwners = [
    "hikaru-asr-worker.exe",
    "ctranslate2.dll",
    "hikaru_asr_tokenizer.dll",
  ];
  if (!manifest.imports || !sameJson(Object.keys(manifest.imports).sort(), importOwners.sort())) {
    fail("runtime import closure owners are incomplete");
  }
  for (const [owner, imports] of Object.entries(manifest.imports)) {
    if (!Array.isArray(imports) || imports.length === 0) fail(`empty import list: ${owner}`);
    for (const imported of imports) {
      const lower = imported.toLowerCase();
      if (!bundledDlls.has(lower) && !systemDlls.has(lower)) {
        fail(`undeclared non-system DLL import: ${owner} -> ${imported}`);
      }
    }
  }
  return { manifest, runtimeRoot, unpackedBytes };
}

export function verifyRuntimeArchive({
  archivePath,
  lockPath = defaultRuntimeLock,
  extractTo,
}) {
  const lock = readRuntimeLock(lockPath);
  if (!Number.isSafeInteger(lock.artifact.sizeBytes) || !/^[0-9a-f]{64}$/.test(lock.artifact.sha256)) {
    fail("outer artifact identity has not been finalized");
  }
  if (!existsSync(archivePath)) fail(`archive is missing: ${archivePath}`);
  const size = statSync(archivePath).size;
  const sha256 = sha256File(archivePath);
  if (size !== lock.artifact.sizeBytes || sha256 !== lock.artifact.sha256) {
    fail("outer archive size or SHA-256 mismatch");
  }
  const entries = listZipEntries(archivePath);
  if (entries.length === 0) fail("archive is empty");
  const seen = new Set();
  for (const entry of entries) {
    assertSafeArchivePath(entry.path);
    const canonicalPath = entry.path.toLowerCase();
    if (!entry.path.startsWith(lock.artifact.root) || seen.has(canonicalPath)) {
      fail(`archive entry is outside the exact runtime root or duplicated: ${entry.path}`);
    }
    seen.add(canonicalPath);
  }
  const temporary = mkdtempSync(join(tmpdir(), "hikaru-asr-runtime-"));
  try {
    extractZipSafely(archivePath, temporary);
    const result = verifyExtractedRuntime(temporary, lock);
    if (extractTo) {
      const destination = resolve(extractTo);
      const staging = `${destination}.tmp-${process.pid}`;
      const backup = `${destination}.backup-${process.pid}`;
      rmSync(staging, { recursive: true, force: true });
      rmSync(backup, { recursive: true, force: true });
      mkdirSync(dirname(staging), { recursive: true });
      renameSync(temporary, staging);
      try {
        if (existsSync(destination)) renameSync(destination, backup);
        renameSync(staging, destination);
        rmSync(backup, { recursive: true, force: true });
      } catch (error) {
        if (!existsSync(destination) && existsSync(backup)) renameSync(backup, destination);
        throw error;
      } finally {
        rmSync(staging, { recursive: true, force: true });
        rmSync(backup, { recursive: true, force: true });
      }
      return {
        ...result,
        runtimeRoot: join(destination, ...lock.artifact.root.split("/").filter(Boolean)),
        archiveSizeBytes: size,
        archiveSha256: sha256,
      };
    }
    return { ...result, archiveSizeBytes: size, archiveSha256: sha256 };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function cliValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const lockPath = resolve(cliValue("--lock") ?? defaultRuntimeLock);
    const lock = readRuntimeLock(lockPath);
    if (process.argv.includes("--lock-only")) {
      console.log(`validated Native ASR runtime lock: ${lock.artifact.id}`);
    } else {
      const archivePath = resolve(
        cliValue("--archive") ?? join(defaultRoot, lock.artifact.path),
      );
      const result = verifyRuntimeArchive({
        archivePath,
        lockPath,
        extractTo: cliValue("--extract"),
      });
      console.log(
        `verified Native ASR runtime: ${result.archiveSha256} (${result.archiveSizeBytes} bytes)`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
