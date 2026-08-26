#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  readRuntimeLock,
  sha256File,
  verifyExtractedRuntime,
} from "./verify-native-asr-runtime.mjs";

function fail(message) {
  throw new Error(`Native ASR runtime packaging failed: ${message}`);
}

function walkFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
      else fail(`unsupported staging entry: ${path}`);
    }
  }
  visit(root);
  return files.sort();
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createNotices(lock, cargoMetadata) {
  const rustPackages = cargoMetadata.packages
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? null,
      source: pkg.source ?? "workspace",
    }))
    .sort((left, right) =>
      `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
    );
  if (rustPackages.some((pkg) => pkg.license === null)) {
    fail("the locked Rust dependency graph contains a package without license metadata");
  }
  for (const required of lock.licenseInventory.requiredRustPackages) {
    if (!rustPackages.some((pkg) => pkg.name === required)) {
      fail(`required Rust license inventory package is missing: ${required}`);
    }
  }
  return {
    schemaVersion: 1,
    artifactId: lock.artifact.id,
    components: lock.licenseInventory.components,
    rustCargoLockSha256: lock.sources.tokenizer.cargoLockSha256,
    rustPackages,
  };
}

function createDeterministicZip(sourceRoot, archivePath, timestamp) {
  const script = String.raw`
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source = [System.IO.Path]::GetFullPath($env:HIKARU_RUNTIME_STAGE)
$archivePath = [System.IO.Path]::GetFullPath($env:HIKARU_RUNTIME_ARCHIVE)
$timestamp = [System.DateTimeOffset]::Parse($env:HIKARU_RUNTIME_TIMESTAMP)
if ([System.IO.File]::Exists($archivePath)) { [System.IO.File]::Delete($archivePath) }
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($archivePath)) | Out-Null
$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::CreateNew)
$zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $source -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($source.TrimEnd([char]92).Length).TrimStart([char]92).Replace([char]92, [char]47)
    $entry = $zip.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $timestamp
    $input = [System.IO.File]::OpenRead($_.FullName)
    $output = $entry.Open()
    try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
  }
} finally { $zip.Dispose(); $stream.Dispose() }
`;
  const result = spawnSync(
    process.platform === "win32" ? "pwsh.exe" : "pwsh",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        HIKARU_RUNTIME_STAGE: resolve(sourceRoot),
        HIKARU_RUNTIME_ARCHIVE: resolve(archivePath),
        HIKARU_RUNTIME_TIMESTAMP: timestamp,
      },
      windowsHide: true,
    },
  );
  if (result.status !== 0) fail((result.stderr || result.stdout).trim());
}

export function packageRuntime({ stageRoot, lockPath, cargoMetadataPath, importsPath, outputPath }) {
  const lock = readRuntimeLock(lockPath);
  const runtimeRoot = join(stageRoot, ...lock.artifact.root.split("/").filter(Boolean));
  const cargoMetadata = JSON.parse(readFileSync(cargoMetadataPath, "utf8"));
  const imports = JSON.parse(readFileSync(importsPath, "utf8"));
  const noticesPath = join(runtimeRoot, "licenses", "THIRD-PARTY-NOTICES.json");
  writeJson(noticesPath, createNotices(lock, cargoMetadata));
  rmSync(join(runtimeRoot, "runtime-manifest.json"), { force: true });
  rmSync(join(runtimeRoot, "SHA256SUMS"), { force: true });

  const roleByPath = new Map(lock.requiredFiles.map((row) => [row.path, row.role]));
  const files = walkFiles(runtimeRoot);
  const required = [...roleByPath.keys()].sort();
  if (JSON.stringify(files) !== JSON.stringify(required)) {
    fail(`staged file closure does not match the lock: ${JSON.stringify(files)}`);
  }
  const rows = files.map((path) => {
    const absolute = join(runtimeRoot, ...path.split("/"));
    return {
      path,
      role: roleByPath.get(path),
      sizeBytes: statSync(absolute).size,
      sha256: sha256File(absolute),
    };
  });
  const normalizedImports = Object.fromEntries(
    Object.entries(imports)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([owner, values]) => [
        owner,
        [...new Set(values.map((value) => String(value)))].sort((a, b) =>
          a.toLowerCase().localeCompare(b.toLowerCase()),
        ),
      ]),
  );
  const manifest = {
    schemaVersion: 1,
    artifactId: lock.artifact.id,
    platform: lock.platform,
    arch: lock.arch,
    protocolVersion: lock.protocolVersion,
    candidateConfig: lock.candidateConfig,
    capabilities: lock.capabilities,
    sources: lock.sources,
    toolchain: lock.toolchain,
    systemDllAllowlist: lock.systemDllAllowlist,
    imports: normalizedImports,
    files: rows,
  };
  writeJson(join(runtimeRoot, "runtime-manifest.json"), manifest);
  writeFileSync(
    join(runtimeRoot, "SHA256SUMS"),
    `${rows.map((row) => `${row.sha256}  ${row.path}`).join("\n")}\n`,
  );
  const verified = verifyExtractedRuntime(stageRoot, lock);
  createDeterministicZip(
    stageRoot,
    outputPath,
    new Date(lock.artifact.sourceDateEpoch * 1000).toISOString(),
  );
  return {
    ...verified,
    archiveSizeBytes: statSync(outputPath).size,
    archiveSha256: sha256File(outputPath),
  };
}

function value(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = packageRuntime({
      stageRoot: resolve(value("--stage") ?? fail("--stage is required")),
      lockPath: resolve(value("--lock") ?? fail("--lock is required")),
      cargoMetadataPath: resolve(
        value("--cargo-metadata") ?? fail("--cargo-metadata is required"),
      ),
      importsPath: resolve(value("--imports") ?? fail("--imports is required")),
      outputPath: resolve(value("--output") ?? fail("--output is required")),
    });
    console.log(
      JSON.stringify({
        archiveSizeBytes: result.archiveSizeBytes,
        archiveSha256: result.archiveSha256,
        unpackedBytes: result.unpackedBytes,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
