import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { verifyRuntimeArchive } from "./verify-native-asr-runtime.mjs";

const temporaryRoots = [];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createZip(source, archive, extraEntry) {
  const script = String.raw`
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source = [System.IO.Path]::GetFullPath($env:HIKARU_TEST_SOURCE)
$archivePath = [System.IO.Path]::GetFullPath($env:HIKARU_TEST_ZIP)
if ([System.IO.File]::Exists($archivePath)) { [System.IO.File]::Delete($archivePath) }
$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::CreateNew)
$zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $source -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($source.TrimEnd([char]92).Length).TrimStart([char]92).Replace([char]92, [char]47)
    $entry = $zip.CreateEntry("windows-x64/cpu/$relative", [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = [System.DateTimeOffset]::Parse('2026-06-06T12:54:06Z')
    $input = [System.IO.File]::OpenRead($_.FullName)
    $output = $entry.Open()
    try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
  }
  if ($env:HIKARU_TEST_EXTRA_ENTRY) {
    $entry = $zip.CreateEntry($env:HIKARU_TEST_EXTRA_ENTRY)
    $output = $entry.Open()
    try {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('escape')
      $output.Write($bytes, 0, $bytes.Length)
    } finally { $output.Dispose() }
  }
} finally { $zip.Dispose(); $stream.Dispose() }
`;
  const result = spawnSync(
    process.platform === "win32" ? "powershell.exe" : "pwsh",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        HIKARU_TEST_SOURCE: source,
        HIKARU_TEST_ZIP: archive,
        HIKARU_TEST_EXTRA_ENTRY: extraEntry ?? "",
      },
    },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function fixture({
  extraManifestFile,
  extraUntrackedFile,
  removeRequired,
  manifestMutation,
  extraArchiveEntry,
  licenseContent = "license\n",
  noticeMutation,
  lockMutation,
  microsoftLicense = false,
  microsoftLicenseContent = "official Microsoft Runtime 2026 license bytes",
  microsoftNoticeContent,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "hikaru-runtime-test-"));
  temporaryRoots.push(root);
  const tree = join(root, "tree");
  const licenseInventory = {
    components: [
      {
        name: "fixture-runtime",
        version: "1.0.0",
        license: "MIT",
        source: "https://example.invalid/fixture",
      },
    ],
    requiredRustPackages: ["tokenizers"],
  };
  const microsoftSource = {
    version: "2026",
    termsUrl:
      "https://visualstudio.microsoft.com/license-terms/vs2026-ga-visualcpp-v14-redist-runtime/",
    redistributionUrl: "https://aka.ms/vs/18/redistribution",
    url:
      "https://visualstudio.microsoft.com/wp-content/uploads/2025/10/Visual-C-V14-License-Redistributable_and_Runtime_ENU.docx",
    archiveName: "Visual-C-V14-License-Redistributable_and_Runtime-2026-ENU.docx",
    runtimePath: "licenses/Microsoft-Visual-Cpp-V14-Runtime-2026-License.docx",
    sizeBytes: Buffer.byteLength("official Microsoft Runtime 2026 license bytes"),
    sha256: createHash("sha256")
      .update("official Microsoft Runtime 2026 license bytes")
      .digest("hex"),
    acceptance:
      "BY USING THE SOFTWARE, YOU ACCEPT THESE TERMS. IF YOU DO NOT ACCEPT THEM, DO NOT USE THE SOFTWARE.",
  };
  const microsoftFiles = [
    "msvcp140.dll",
    "vcomp140.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
  ];
  const expectedMicrosoftNotice = [
    "The bundled Microsoft Visual C++ Redistributable runtime files are excluded from",
    "Hikaru Sub's Apache-2.0 project license and are governed by the official Microsoft",
    "Visual C++ V14 Redistributable and Runtime 2026 terms included unchanged at:",
    microsoftSource.runtimePath,
    "",
    `Official terms: ${microsoftSource.termsUrl}`,
    `VS 18 redistribution list: ${microsoftSource.redistributionUrl}`,
    `Acceptance stated by Microsoft: ${microsoftSource.acceptance}`,
    `Files: ${[...microsoftFiles]
      .sort((left, right) => left.localeCompare(right))
      .join(", ")}`,
  ].join("\n");
  if (microsoftLicense) {
    licenseInventory.components.push({
      name: "Microsoft Visual C++ Redistributable",
      version: "14.50.35717",
      license: "Microsoft Visual C++ V14 Redistributable and Runtime 2026 terms",
      source: microsoftSource.termsUrl,
      redistributionSource: microsoftSource.redistributionUrl,
      localLicenseFile: microsoftSource.runtimePath,
      projectLicenseExcluded: true,
      projectLicenseExclusion:
        "These Microsoft runtime files are excluded from Hikaru Sub's Apache-2.0 project license and are governed by the Microsoft Visual C++ V14 Redistributable and Runtime 2026 terms.",
      acceptance: microsoftSource.acceptance,
      files: microsoftFiles,
    });
  }
  const notice = {
    schemaVersion: 1,
    artifactId: "fixture",
    components: structuredClone(licenseInventory.components),
    rustCargoLockSha256: "b".repeat(64),
    rustPackages: [
      {
        name: "tokenizers",
        version: "0.22.1",
        license: "Apache-2.0",
        source: "registry",
      },
    ],
  };
  if (noticeMutation) noticeMutation(notice);
  const files = [
    ["hikaru-asr-worker.exe", "worker", "worker"],
    ["ctranslate2.dll", "runtime", "ct2"],
    ["hikaru_asr_tokenizer.dll", "runtime", "tokenizer"],
    [
      "licenses/THIRD-PARTY-NOTICES.json",
      "license-inventory",
      `${JSON.stringify(notice)}\n`,
    ],
    ["licenses/test-license.txt", "license", licenseContent],
  ];
  if (microsoftLicense) {
    files.push(
      [microsoftSource.runtimePath, "license", microsoftLicenseContent],
      [
        "licenses/Microsoft-Visual-Cpp-Runtime.txt",
        "license",
        microsoftNoticeContent ?? expectedMicrosoftNotice,
      ],
      ...microsoftFiles.map((path) => [path, "microsoft-runtime", `runtime:${path}`]),
    );
  }
  if (extraManifestFile) files.push(extraManifestFile);
  const filtered = files.filter(([path]) => path !== removeRequired);
  for (const [path, , content] of filtered) write(join(tree, ...path.split("/")), content);
  if (extraUntrackedFile) write(join(tree, ...extraUntrackedFile.split("/")), "extra");
  const rows = filtered.map(([path, role]) => {
    const absolute = join(tree, ...path.split("/"));
    return { path, role, sizeBytes: statSync(absolute).size, sha256: sha256(absolute) };
  });
  const sources = { fixture: "source", tokenizer: { cargoLockSha256: "b".repeat(64) } };
  if (microsoftLicense) sources.microsoftVisualCppRuntimeLicense = microsoftSource;
  const manifest = {
    schemaVersion: 1,
    artifactId: "fixture",
    platform: "windows-x64",
    arch: "x64",
    protocolVersion: 1,
    candidateConfig: { id: "candidate", sha256: "a".repeat(64) },
    capabilities: {
      backend: "ctranslate2",
      device: "cpu",
      engines: ["faster-whisper", "kotoba-faster-whisper"],
      vad: false,
      crispasr: false,
      cuda: false,
      vulkan: false,
      modelsBundled: false,
    },
    sources,
    toolchain: { fixture: "toolchain" },
    systemDllAllowlist: ["kernel32.dll"],
    imports: {
      "hikaru-asr-worker.exe": ["ctranslate2.dll", "hikaru_asr_tokenizer.dll", "KERNEL32.dll"],
      "ctranslate2.dll": ["KERNEL32.dll"],
      "hikaru_asr_tokenizer.dll": ["KERNEL32.dll"],
    },
    files: rows,
  };
  if (manifestMutation) manifestMutation(manifest);
  write(join(tree, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  write(
    join(tree, "SHA256SUMS"),
    `${rows
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((row) => `${row.sha256}  ${row.path}`)
      .join("\n")}\n`,
  );
  const archive = join(root, "runtime.zip");
  createZip(tree, archive, extraArchiveEntry);
  const requiredFiles = [
    { path: "hikaru-asr-worker.exe", role: "worker" },
    { path: "ctranslate2.dll", role: "runtime" },
    { path: "hikaru_asr_tokenizer.dll", role: "runtime" },
    { path: "licenses/THIRD-PARTY-NOTICES.json", role: "license-inventory" },
    { path: "licenses/test-license.txt", role: "license" },
  ];
  if (microsoftLicense) {
    requiredFiles.push(
      { path: microsoftSource.runtimePath, role: "license" },
      { path: "licenses/Microsoft-Visual-Cpp-Runtime.txt", role: "license" },
      ...microsoftFiles.map((path) => ({ path, role: "microsoft-runtime" })),
    );
  }
  const lock = {
    schemaVersion: 1,
    artifact: {
      id: "fixture",
      path: "runtime.zip",
      root: "windows-x64/cpu/",
      sizeBytes: statSync(archive).size,
      sha256: sha256(archive),
    },
    platform: "windows-x64",
    arch: "x64",
    protocolVersion: 1,
    candidateConfig: { id: "candidate", sha256: "a".repeat(64) },
    capabilities: manifest.capabilities,
    sources: manifest.sources,
    toolchain: manifest.toolchain,
    licenseInventory,
    redistributables: microsoftLicense
      ? microsoftFiles.map((fileName) => ({ fileName }))
      : [],
    requiredFiles,
    importOwners: [
      "hikaru-asr-worker.exe",
      "ctranslate2.dll",
      "hikaru_asr_tokenizer.dll",
    ],
    systemDllAllowlist: ["kernel32.dll"],
    forbiddenPathFragments: ["python", "onnxruntime", "silero", "cuda", "crispasr"],
    forbiddenExtensions: [".bin", ".onnx", ".gguf", ".pdb"],
    budgets: { unpackedRuntimeBytes: 1_000_000 },
  };
  if (lockMutation) lockMutation(lock);
  const lockPath = join(root, "lock.json");
  write(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  return { archive, lockPath };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Native ASR runtime verifier", () => {
  it("accepts an exact closed runtime", () => {
    const { archive, lockPath } = fixture();
    expect(verifyRuntimeArchive({ archivePath: archive, lockPath }).manifest.artifactId).toBe(
      "fixture",
    );
  }, 20_000);

  it("rejects outer archive tampering", () => {
    const { archive, lockPath } = fixture();
    writeFileSync(archive, Buffer.concat([readFileSync(archive), Buffer.from("tamper")]));
    expect(() => verifyRuntimeArchive({ archivePath: archive, lockPath })).toThrow(
      /outer archive size or SHA-256 mismatch/,
    );
  });

  it("rejects missing and undeclared runtime files", () => {
    const missing = fixture({ removeRequired: "ctranslate2.dll" });
    expect(() => verifyRuntimeArchive({ archivePath: missing.archive, lockPath: missing.lockPath })).toThrow(
      /required runtime role is missing/,
    );
    const extra = fixture({ extraUntrackedFile: "rogue.dll" });
    expect(() => verifyRuntimeArchive({ archivePath: extra.archive, lockPath: extra.lockPath })).toThrow(
      /runtime file closure mismatch/,
    );
    const declaredExtra = fixture({
      extraManifestFile: ["notes.txt", "license", "extra"],
    });
    expect(() =>
      verifyRuntimeArchive({
        archivePath: declaredExtra.archive,
        lockPath: declaredExtra.lockPath,
      }),
    ).toThrow(/manifest file closure does not match the outer lock/);
  }, 20_000);

  it("rejects forbidden payloads and unknown DLL imports", () => {
    const forbidden = fixture({ extraManifestFile: ["python.dll", "runtime", "bad"] });
    expect(() =>
      verifyRuntimeArchive({ archivePath: forbidden.archive, lockPath: forbidden.lockPath }),
    ).toThrow(/forbidden runtime path/);
    const importDrift = fixture({
      manifestMutation(manifest) {
        manifest.imports["hikaru-asr-worker.exe"].push("wrong.dll");
      },
    });
    expect(() =>
      verifyRuntimeArchive({ archivePath: importDrift.archive, lockPath: importDrift.lockPath }),
    ).toThrow(/undeclared non-system DLL import/);
    const ownerDrift = fixture({
      lockMutation(lock) {
        lock.importOwners = ["hikaru-asr-worker.exe", "HIKARU-ASR-WORKER.EXE"];
      },
    });
    expect(() =>
      verifyRuntimeArchive({ archivePath: ownerDrift.archive, lockPath: ownerDrift.lockPath }),
    ).toThrow(/runtime import owner lock is invalid/);
  }, 20_000);

  it("rejects private build paths embedded in payload bytes", () => {
    const leaked = fixture({ licenseContent: "C:\\Users\\builder\\secret" });
    expect(() =>
      verifyRuntimeArchive({ archivePath: leaked.archive, lockPath: leaked.lockPath }),
    ).toThrow(/private build path is embedded/);
  }, 20_000);

  it("rejects incomplete third-party notice inventories", () => {
    const missingRustPackage = fixture({
      noticeMutation(notice) {
        notice.rustPackages = [];
      },
    });
    expect(() =>
      verifyRuntimeArchive({
        archivePath: missingRustPackage.archive,
        lockPath: missingRustPackage.lockPath,
      }),
    ).toThrow(/third-party notice inventory|Rust license inventory/);
  }, 20_000);

  it("rejects Microsoft Runtime license contract and document drift", () => {
    const noticeDrift = fixture({
      microsoftLicense: true,
      noticeMutation(notice) {
        notice.components.find(
          (component) => component.name === "Microsoft Visual C++ Redistributable",
        ).projectLicenseExcluded = false;
      },
    });
    expect(() =>
      verifyRuntimeArchive({
        archivePath: noticeDrift.archive,
        lockPath: noticeDrift.lockPath,
      }),
    ).toThrow(/third-party notice inventory/);

    const lockDrift = fixture({
      microsoftLicense: true,
      lockMutation(lock) {
        lock.sources.microsoftVisualCppRuntimeLicense.termsUrl =
          "https://visualstudio.microsoft.com/license-terms/vs2022-cruntime/";
      },
    });
    expect(() =>
      verifyRuntimeArchive({ archivePath: lockDrift.archive, lockPath: lockDrift.lockPath }),
    ).toThrow(/Microsoft Visual C\+\+ Runtime 2026 license contract/);

    const documentDrift = fixture({
      microsoftLicense: true,
      microsoftLicenseContent: "tampered license bytes",
    });
    expect(() =>
      verifyRuntimeArchive({
        archivePath: documentDrift.archive,
        lockPath: documentDrift.lockPath,
      }),
    ).toThrow(/license document identity mismatch/);

    const dllListDrift = fixture({
      microsoftLicense: true,
      lockMutation(lock) {
        lock.redistributables = lock.redistributables.filter(
          (row) => row.fileName !== "vcomp140.dll",
        );
        lock.licenseInventory.components.find(
          (component) => component.name === "Microsoft Visual C++ Redistributable",
        ).files = lock.licenseInventory.components
          .find((component) => component.name === "Microsoft Visual C++ Redistributable")
          .files.filter((fileName) => fileName !== "vcomp140.dll");
      },
    });
    expect(() =>
      verifyRuntimeArchive({
        archivePath: dllListDrift.archive,
        lockPath: dllListDrift.lockPath,
      }),
    ).toThrow(/Microsoft Visual C\+\+ Runtime 2026 license contract/);

    const removedContract = fixture({
      microsoftLicense: true,
      lockMutation(lock) {
        lock.redistributables = [];
        lock.licenseInventory.components = lock.licenseInventory.components.filter(
          (component) => component.name !== "Microsoft Visual C++ Redistributable",
        );
      },
    });
    expect(() =>
      verifyRuntimeArchive({
        archivePath: removedContract.archive,
        lockPath: removedContract.lockPath,
      }),
    ).toThrow(/Microsoft Visual C\+\+ Runtime 2026 license contract/);

    const inventedClaim = fixture({
      microsoftLicense: true,
      lockMutation(lock) {
        lock.licenseInventory.components.find(
          (component) => component.name === "Microsoft Visual C++ Redistributable",
        ).projectLicenseExclusion += " Custom redistribution rights are granted.";
      },
    });
    expect(() =>
      verifyRuntimeArchive({
        archivePath: inventedClaim.archive,
        lockPath: inventedClaim.lockPath,
      }),
    ).toThrow(/Microsoft Visual C\+\+ Runtime 2026 license contract/);

    const humanNoticeDrift = fixture({
      microsoftLicense: true,
      microsoftNoticeContent: "custom unsupported legal claim",
    });
    expect(() =>
      verifyRuntimeArchive({
        archivePath: humanNoticeDrift.archive,
        lockPath: humanNoticeDrift.lockPath,
      }),
    ).toThrow(/human-readable notice mismatch/);
  }, 60_000);

  it("rejects manifest identity and file hash drift", () => {
    const identity = fixture({
      manifestMutation(manifest) {
        manifest.protocolVersion = 2;
      },
    });
    expect(() => verifyRuntimeArchive({ archivePath: identity.archive, lockPath: identity.lockPath })).toThrow(
      /manifest identity/,
    );
    const hash = fixture({
      manifestMutation(manifest) {
        manifest.files[0].sha256 = "0".repeat(64);
      },
    });
    expect(() => verifyRuntimeArchive({ archivePath: hash.archive, lockPath: hash.lockPath })).toThrow(
      /manifest\/checksum mismatch/,
    );
    for (const engines of [
      ["faster-whisper"],
      ["kotoba-faster-whisper", "faster-whisper"],
      ["faster-whisper", "kotoba-faster-whisper", "qwen3-asr"],
    ]) {
      const capability = fixture({
        lockMutation(lock) {
          lock.capabilities = { ...lock.capabilities, engines };
        },
      });
      expect(() =>
        verifyRuntimeArchive({
          archivePath: capability.archive,
          lockPath: capability.lockPath,
        }),
      ).toThrow(/manifest identity/);
    }
  }, 30_000);

  it("preserves the previous extraction on verification failure and swaps valid output", () => {
    const valid = fixture();
    const destination = join(dirname(valid.lockPath), "prepared");
    write(join(destination, "sentinel.txt"), "old");
    const result = verifyRuntimeArchive({
      archivePath: valid.archive,
      lockPath: valid.lockPath,
      extractTo: destination,
    });
    expect(existsSync(join(destination, "sentinel.txt"))).toBe(false);
    expect(existsSync(result.runtimeRoot)).toBe(true);

    const tampered = fixture();
    const preserved = join(dirname(tampered.lockPath), "prepared");
    write(join(preserved, "sentinel.txt"), "old");
    writeFileSync(
      tampered.archive,
      Buffer.concat([readFileSync(tampered.archive), Buffer.from("tamper")]),
    );
    expect(() =>
      verifyRuntimeArchive({
        archivePath: tampered.archive,
        lockPath: tampered.lockPath,
        extractTo: preserved,
      }),
    ).toThrow(/outer archive size or SHA-256 mismatch/);
    expect(readFileSync(join(preserved, "sentinel.txt"), "utf8")).toBe("old");
  }, 20_000);

  it("rejects ZIP traversal and case-colliding entries before extraction", () => {
    const traversal = fixture({ extraArchiveEntry: "../escape.txt" });
    expect(() =>
      verifyRuntimeArchive({ archivePath: traversal.archive, lockPath: traversal.lockPath }),
    ).toThrow(/unsafe archive entry/);
    const collision = fixture({
      extraArchiveEntry: "windows-x64/cpu/CTRANSLATE2.DLL",
    });
    expect(() =>
      verifyRuntimeArchive({ archivePath: collision.archive, lockPath: collision.lockPath }),
    ).toThrow(/archive entry is outside the exact runtime root or duplicated/);
  }, 20_000);
});
