# Final Native ASR MVP CPU runtime design

## Summary

T13 将现有 development CTranslate2 worker 收敛为一个可重复构建、可验证并直接纳入 Git 的 Windows x64 CPU runtime ZIP。应用发布流程只校验和解压该 ZIP，不重新编译，也不下载模型。

最小交付链路：

```text
tracked native source + tracked input/toolchain lock
                     |
                     v
          clean Windows build script
                     |
                     v
       byte-identical verified runtime ZIP
                     |
             tracked in Git
                     |
                     v
 pnpm asr:prepare-resource / release workflow
                     |
                     v
   src-tauri/resources/native-asr/ (generated)
                     |
          NSIS + portable packaging
```

Production/default routing remains Python legacy until T18.

## Artifact Boundary

### Tracked source and locks

```text
native-asr/
├─ CMakeLists.txt
├─ CMakePresets.json
├─ runtime/
│  └─ windows-x64-cpu-lock.json
├─ build-inputs/
│  └─ windows-x64-cpu-ct2.zip
└─ artifacts/
   └─ windows-x64-cpu.zip

scripts/
├─ build-native-asr-runtime.ps1
├─ verify-native-asr-runtime.mjs
└─ prepare-asr-resource.mjs
```

`windows-x64-cpu-lock.json` is the human/release entry point. It binds:

- artifact schema/id and ZIP size/SHA-256;
- the compact CTranslate2 DLL/import-library build-input ZIP identity and exact entries;
- platform `windows-x64`, device `cpu`, protocol v1;
- Candidate A config id/hash;
- CT2/oneDNN/pocketfft/tokenizer/toolchain input identities;
- expected archive payload roles;
- forbidden capabilities/file classes;
- size budgets and license inventory roles.

The final runtime ZIP is the only tracked binary shipped to users. Git also tracks one compact, hash-locked CTranslate2 DLL/import-library input ZIP so a clean checkout can rebuild the worker without task-local or private binary paths. The extracted build input and Tauri resource directories are generated and ignored, so Git does not retain unpacked copies.

### Archive layout

```text
windows-x64/cpu/
├─ hikaru-asr-worker.exe
├─ ctranslate2.dll
├─ hikaru_asr_tokenizer.dll
├─ <required Microsoft redistributable DLLs only>
├─ runtime-manifest.json
├─ SHA256SUMS
└─ licenses/
   ├─ THIRD-PARTY-NOTICES.json
   └─ <license texts>
```

The artifact contains no model, Python, CrispASR, CUDA/Vulkan, ONNX Runtime, Silero VAD or development runner/test executable.

## Clean Build Inputs

The build script uses an ignored cache such as `.cache/native-asr-runtime/`, but every acquired input is authorized by the tracked lock before extraction or build.

Required input classes:

- exact CTranslate2 source archive/commit and compact locked DLL/import-library input ZIP;
- exact oneDNN source archive/commit whose CPU runtime is linked into the locked CTranslate2 DLL;
- exact pocketfft source archive/commit;
- vendored nlohmann/json provenance already in `native-asr/`;
- `tokenizer-ffi/Cargo.lock` and Cargo registry checksums;
- exact MSVC compiler, Windows SDK, Rust, CMake and Ninja versions.

The build must not resolve source or libraries from `.trellis/tasks/**/research/local`, the app model cache, `%PATH%` dependency copies or other private absolute roots.

A clean build performs:

1. toolchain version attestation;
2. download/cache hash verification;
3. source extraction into a fresh root;
4. verify/extract the tracked CTranslate2 CPU DLL/import-library input;
5. verify its pinned oneDNN/CTranslate2 provenance through the lock;
6. tokenizer `cargo build --locked --release`;
7. worker/package tests;
8. payload staging, manifest/license generation and ZIP creation.

## CMake Capability Split

The final preset is a separate product package identity, not a renamed historical development preset.

```text
windows-x64-cpu-runtime
  HIKARU_ASR_BUILD_CT2_WORKER=ON
  HIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT=OFF
  HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=OFF
  HIKARU_ASR_ENABLE_CANDIDATE_B_DEVELOPMENT=OFF
  HIKARU_ASR_ENABLE_WHISPER_FALLBACK_PARITY=OFF
  HIKARU_ASR_ENABLE_WHISPER_PARITY_BISECT=OFF
```

The existing CT2 source currently includes Candidate B ORT/VAD code unconditionally. Implementation must add one compile-time boundary so the final preset:

- does not include ORT headers;
- does not link ORT import libraries;
- does not copy ORT DLLs or the VAD model;
- returns a stable structured unsupported/not-built error for `useVad=true` before model loading.

Development-only presets may continue compiling Candidate B. The final worker retains ordinary faster-whisper large-v3 Candidate A behavior only.

GPU requests similarly fail with the existing controlled `cuda_not_built`/unsupported contract; no missing-DLL accident is accepted as capability control.

## Reproducibility Policy

Two builds are reproducible only when the complete ZIP SHA-256 matches. Matching source versions with different output hashes is not sufficient.

To make this achievable:

- use MSVC compiler/linker reproducible flags and path mapping;
- use Rust path remapping and the exact Cargo lock/toolchain;
- exclude PDBs and other non-runtime outputs;
- remove usernames, absolute paths and wall-clock timestamps from generated metadata;
- normalize historical dependency diagnostic source prefixes before locking the link-input ZIP, then reject user-profile/task-local paths in both ASCII and UTF-16 payload bytes;
- sort manifest, checksum and ZIP entries;
- assign all ZIP entries the same fixed lock-derived timestamp;
- use a fresh build/cache output root for each comparison run.

The manifest may contain a fixed source revision or source-date epoch, but not the actual build time.

If two clean builds still differ, the task remains blocked and records the differing file identities; it must not weaken the policy to “functionally equivalent”.

## Manifest And Verification

### Runtime manifest

`runtime-manifest.json` records canonical JSON fields for:

- `schemaVersion`, `artifactId`, `platform`, `arch`;
- protocol and Candidate A config identities;
- enabled/disabled capabilities;
- source and toolchain identities;
- payload `{path, role, sizeBytes, sha256}` rows;
- system DLL allowlist and bundled runtime DLL roles;
- license inventory path/hash.

`SHA256SUMS` is generated from the same sorted payload set. The manifest does not hash itself; the outer tracked lock binds the complete ZIP.

### Shared verifier

`scripts/verify-native-asr-runtime.mjs` owns archive/resource verification so build, tests and release do not implement parallel rules.

It validates:

- outer ZIP size/hash against the tracked lock;
- exact root/layout and normalized relative paths;
- no absolute, drive-prefixed or `..` entries;
- exact payload closure: no missing or undeclared extras;
- every manifest size/hash and the checksum file;
- required license roles;
- forbidden names/extensions/capabilities, including model weights, Python, ORT, VAD, CrispASR and GPU runtime files;
- platform/protocol/config identity equality with the outer lock.

Preparation extracts only after archive verification, extracts into a temporary sibling directory, verifies the extracted tree again, then atomically replaces the generated resource directory.

## DLL Isolation

Package validation has two layers:

1. **Static closure:** inspect the worker and bundled DLL import tables; every non-system dependency must be present and declared. Windows system DLLs are matched against an explicit allowlist.
2. **Restricted launch:** run from staged installed/portable roots with PATH limited to the artifact directory plus Windows System32. Missing/wrong dependency, build-directory leakage or ambient PATH loading must fail.

During model-backed smoke, the Windows validation script records the running worker's loaded modules and rejects every non-system module outside the artifact root. Raw machine paths remain in ignored local logs; tracked handoff contains only role/name/hash and pass/fail.

Microsoft runtime DLLs are bundled only when import analysis proves they are required. VC145 files must remain byte-identical to the VS18 `VC/Redist` copies, be explicitly excluded from Hikaru Sub's Apache-2.0 project license, and be governed by the locally bundled unchanged **Microsoft Visual C++ V14 Redistributable and Runtime 2026** DOCX. The lock binds the immutable document URL/size/SHA-256, correct VS2026 terms page, VS18 redistribution list and Microsoft's use-based acceptance sentence; no custom EULA or VS2022 substitution is accepted. The DLLs are not added speculatively.

## Release Consumption

`prepare-asr-resource.mjs` keeps its current Python template preparation while adding native runtime preparation:

```text
native-asr/artifacts/windows-x64-cpu.zip
  -> verify against native-asr/runtime/windows-x64-cpu-lock.json
  -> extract/verify atomically
  -> src-tauri/resources/native-asr/windows-x64/cpu/
```

Because `tauri.conf.json` already bundles `src-tauri/resources/`, NSIS consumes the generated tree without another binary list. `package-portable.mjs` adds the emitted `native-asr` resource directory to its exact portable entry list.

CI and `.github/workflows/release.yml` continue calling `pnpm asr:prepare-resource`; therefore local release, NSIS and portable use the same preparation path. They never call CMake.

T13 does not remove `asr-service`, alter production route selection or expose the runtime in settings/UI. T16～T18 own those changes.

## Functional Smoke

### Model-free package checks

- archive/manifest/license verification;
- wrong/missing/extra DLL mutations;
- manifest/hash mutation;
- traversal entry rejection;
- restricted-path process start and controlled malformed/unsupported requests;
- installed-like and portable-like staged layout discovery.

### T12-backed smoke

After the exact large-v3 cache is available, run the packaged worker from both layouts against:

- one short 16 kHz mono WAV;
- one WAV longer than ten minutes.

The smoke parser checks protocol order, terminal exit, non-empty valid UTF-8 text, ordered positive-duration audio-bounded segments and no stdout contamination. It records timing only as diagnostic.

The Rust native host compatibility suite is rerun with the packaged worker to retain cancel, crash/recovery, active-gate and fallback ASS coverage. CPU cancellation uses the no-VAD MVP route rather than Candidate B.

## Size And License Handoff

Final evidence records:

- tracked runtime ZIP size;
- unpacked runtime size;
- NSIS setup size;
- portable ZIP size;
- payload count by role;
- bundled model-weight count (`0`);
- third-party notice inventory and hashes.

Budgets are fixed at setup `80 MB`, portable `90 MB`, unpacked runtime `250 MB`. A budget failure blocks T13/T18 and is not waived by functional success.

## Compatibility

- Protocol v1 and Tauri command/state contracts remain unchanged.
- Candidate A algorithm/config identity remains unchanged.
- Model path and model identity remain owned by T12.
- Existing Python legacy packaging remains until T18; T13 only adds a verified native resource.
- Post-MVP models reuse the artifact unless they require an explicitly reviewed runtime revision.

## Rollback

- Remove the tracked runtime/build-input ZIPs, lock and native preparation call.
- Restore portable staging to its previous entry list.
- Remove the final CMake preset/build script while retaining historical native source and tests.
- Production remains Python legacy; no user data or managed model/cache cleanup is involved.

## Decisions

- **D1:** Track the compressed final runtime plus one compact CTranslate2 link-input ZIP, never unpacked binaries; only the final runtime is shipped.
- **D2:** App release verifies/extracts; it never rebuilds the runtime.
- **D3:** Byte-identical ZIP is the reproducibility gate.
- **D4:** Candidate B ORT/VAD is compiled out of the MVP artifact rather than merely omitted at copy time.
- **D5:** Existing release resource preparation is extended instead of creating a parallel packaging pipeline.
- **D6:** No production cutover occurs in T13.
