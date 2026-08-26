# Trellis Check Report — Native ASR Windows x64 CPU Runtime

## Result

Independent review found and fixed four P1 release-evidence/contract issues. No P0/P1 blockers remain in the reviewed working tree.

## Findings fixed

1. **Stale package evidence for the current artifact**
   - The tracked runtime had advanced to a newer worker identity, while the existing portable ZIP still contained the previous worker.
   - Re-ran `pnpm asr:prepare-resource` and `pnpm release:local` after finalizing the reviewed artifact.
   - Confirmed the final portable manifest is byte-identical to the tracked runtime manifest.
   - Refreshed setup/portable sizes and SHA-256 values in `runtime-package-handoff.json`.

2. **Incomplete build-input/toolchain fail-closed checks**
   - The build declared tokenizer/nlohmann identities in the lock but did not assert them before compiling.
   - Added exact `Cargo.lock` size/hash checks, nlohmann provenance/header/license hash checks, private-path scanning for both CT2 DLL and import library, exact Visual Studio edition/version checking, and Cargo version checking.
   - Added `visualStudioVersion` and `cargoVersion` to the lock/toolchain identity.

3. **Final MVP preset still default-built development-only targets**
   - The final target graph built fake worker, CrispASR, Parakeet, and related test binaries even though they were not staged.
   - Marked those targets `EXCLUDE_FROM_ALL` for `HIKARU_ASR_MVP_CPU_RUNTIME` and excluded their tests from the final CTest preset.
   - Final CTest now runs only protocol, ordinary CT2, CrispASR-route rejection, and non-Whisper-route rejection checks (`4/4` in both independent build roots).

4. **License inventory was hash-bound but not semantically verified**
   - Added a lock-owned component inventory and required Rust-package list.
   - Packaging now emits the notice inventory from that lock.
   - The shared verifier now rejects component drift, Cargo-lock identity drift, missing/invalid/duplicate Rust rows, and missing required tokenizer/onig packages.
   - Added a mutation test for incomplete third-party notices.

## Reviewed contracts

- Final artifact is ordinary faster-whisper / CT2 / CPU only; manifest capabilities disable VAD, CrispASR, CUDA, Vulkan, and bundled models.
- Candidate B ORT/VAD includes, links, copies, and model-backed helpers are compile-time guarded.
- `useVad=true`, CUDA, CrispASR, and Kotoba/non-MVP requests fail through controlled protocol errors.
- Artifact and build-input ZIPs are hash/size locked; runtime archive verifies exact file, manifest, checksum, source/toolchain, import, license, and path closure.
- Runtime payload and CT2 build input contain no user-profile or task-local build paths in checked ASCII/UTF-16 strings.
- Resource preparation and portable packaging consume the same tracked artifact; release packaging does not call CMake.
- Python `asr-service` remains packaged and Release/default routing remains Python legacy.
- Final portable package contains the current reviewed runtime manifest, not a stale predecessor.
- Final measured sizes remain below all budgets; bundled model weights remain zero.

## Final identities

- Runtime ZIP: `6859911` bytes
- Runtime ZIP SHA-256: `e84948f668bc0e308ad4d47edb58b9644f0d3c468c9e2071913277416dea7ff3`
- Unpacked runtime: `26023959` bytes (`<= 262144000`)
- NSIS setup: `11101801` bytes, SHA-256 `92d5d038eeca5a4d3ba5389cf9be6559d8cdbafa7e466acc13f06130abfd89f1`
- Portable ZIP: `15357148` bytes, SHA-256 `38a3c8a398baa769b58e8bfc968733b2f78ddc65f9e36e09d046ebf7377380bb`
- Model weights bundled: `0`

## Verification

- `pnpm exec vitest run scripts/verify-native-asr-runtime.test.mjs --exclude '.trellis/**'` — 10/10 passed, including Microsoft Runtime notice/document drift.
- Final build root D CMake/CTest/package/restricted-launch gate — 4/4 passed; artifact `e84948f…`.
- Final build root E CMake/CTest/package/restricted-launch gate — 4/4 passed; byte-identical artifact `e84948f…`.
- `pnpm asr:runtime:verify` — passed for final tracked artifact.
- `pnpm asr:prepare-resource && pnpm release:local` — passed; NSIS and portable rebuilt from final runtime.
- `pnpm test` — passed.
- `python ./.trellis/scripts/task.py validate 08-20-native-asr-cpu-runtime-package` — passed.
- `git diff --check` — passed.
- No staged files.

## Residual risks

- Two additional from-empty build roots F/G were started concurrently as a reviewer stress rerun but timed out during compilation and were not used as evidence. The accepted identity is backed by the two independent D/E roots, which recompiled all relevant final worker objects and produced byte-identical complete ZIPs; the reviewer changes did not alter inference source or payload binaries beyond the already recompiled target graph/manifest.
- No known Microsoft Runtime packaging risk remains: the unchanged official Runtime 2026 DOCX is locally bundled and hash-locked, the correct VS18 redistribution and VS2026 terms URLs are recorded, and notices explicitly exclude the four DLLs from the project's Apache-2.0 license.

## Main-session follow-up

The final packaged worker SHA-256 is `095a19ca896867efe64a19501594e7a7ee0539f58411051f83504b4900de2c14`, which differed from the worker used by the earlier pre-review model smoke. The main session therefore requalified the final bytes rather than inheriting stale functional evidence:

- installed-like short: `24102 ms`, 5 segments, 9 events — passed;
- portable-like short: `24102 ms`, 5 segments, 9 events — passed;
- installed-like 601-second audio: 168 segments, 193 events — passed;
- portable-like 601-second audio: 168 segments, 193 events — passed;
- Rust production-worker success/pre-ready-rejection tests — 2/2 passed;
- Rust real-worker cancellation test — passed in 8.27 seconds, with worker termination contract `<=2s` preserved by the test assertion.

`runtime-package-handoff.json` now binds both functional smoke and host compatibility to that final worker SHA.

## Microsoft Runtime licensing correction

The earlier VS2022 link-only notice was replaced after checking the installed VS18 `Redist.txt`, the VS18 redistribution list, the Visual Studio Community 2026 distribution conditions, and the official Visual C++ V14 Runtime 2026 terms.

- Bundled unchanged official document: `licenses/Microsoft-Visual-Cpp-V14-Runtime-2026-License.docx`.
- Document: `39553` bytes, SHA-256 `08651651a7602fc7c0e2763de0fde1ff9f868df2780597cd1775ee9d6441c783`.
- Notice records the correct VS2026 terms, VS18 redistribution list, local license path, Microsoft use-based acceptance text, and explicit exclusion of the four DLLs from Hikaru Sub's Apache-2.0 project license.
- Build and verifier reject URL/path/acceptance/exclusion/file-list/document identity drift.
- The four Microsoft DLLs and worker bytes are unchanged.
- Independent D/E rebuilds produced byte-identical corrected ZIPs; installed/portable short and 601-second smoke and Rust host/cancel checks were rerun.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed and fixed the runtime package without production cutover or post-MVP engine scope; final artifact, release packages, verifier, target graph, lock, handoff, and focused/full checks are consistent."
    }
  ],
  "changedFiles": [
    "native-asr/CMakeLists.txt",
    "native-asr/runtime/windows-x64-cpu-lock.json",
    "native-asr/artifacts/windows-x64-cpu.zip",
    "scripts/build-native-asr-runtime.ps1",
    "scripts/package-native-asr-runtime.mjs",
    "scripts/verify-native-asr-runtime.mjs",
    "scripts/verify-native-asr-runtime.test.mjs",
    ".trellis/tasks/08-20-native-asr-cpu-runtime-package/research/runtime-package-handoff.json",
    ".trellis/tasks/08-20-native-asr-cpu-runtime-package/research/trellis-check-report.md"
  ],
  "testsAddedOrUpdated": [
    "scripts/verify-native-asr-runtime.test.mjs",
    "native-asr CTest final MVP target selection"
  ],
  "commandsRun": [
    {
      "command": "pnpm exec vitest run scripts/verify-native-asr-runtime.test.mjs --exclude '.trellis/**'",
      "result": "passed",
      "summary": "1 file, 10 mutation/closure tests passed, including Microsoft Runtime notice/document drift"
    },
    {
      "command": "pwsh scripts/build-native-asr-runtime.ps1 ... build-d -Resume",
      "result": "passed",
      "summary": "Final target graph built; 4/4 CTest; restricted launch passed; produced corrected e84948f..."
    },
    {
      "command": "pwsh scripts/build-native-asr-runtime.ps1 ... build-e -Resume",
      "result": "passed",
      "summary": "Independent target graph built; 4/4 CTest; produced byte-identical corrected e84948f..."
    },
    {
      "command": "pwsh scripts/build-native-asr-runtime.ps1 ... build-f/build-g",
      "result": "failed",
      "summary": "Optional concurrent from-empty stress reruns timed out during compilation and were not used as acceptance evidence"
    },
    {
      "command": "pnpm asr:runtime:verify",
      "result": "passed",
      "summary": "Verified final 6859911-byte artifact SHA-256 e84948f..."
    },
    {
      "command": "pnpm asr:prepare-resource && pnpm release:local",
      "result": "passed",
      "summary": "Rebuilt final NSIS and portable packages from the reviewed runtime"
    },
    {
      "command": "pnpm test",
      "result": "passed",
      "summary": "Full Vitest suite passed"
    },
    {
      "command": "python ./.trellis/scripts/task.py validate 08-20-native-asr-cpu-runtime-package",
      "result": "passed",
      "summary": "Task context manifests validated"
    },
    {
      "command": "git diff --check",
      "result": "passed",
      "summary": "No whitespace errors"
    }
  ],
  "validationOutput": [
    "Runtime ZIP 6859911 bytes / e84948f668bc0e308ad4d47edb58b9644f0d3c468c9e2071913277416dea7ff3",
    "Unpacked runtime 26023959 bytes <= 262144000",
    "NSIS setup 11101801 bytes <= 83886080",
    "Portable ZIP 15357148 bytes <= 94371840",
    "Portable package embeds the final tracked runtime manifest",
    "No staged files"
  ],
  "residualRisks": [
    "Optional fresh F/G stress builds timed out and were not used; D/E independent roots are the byte-identical acceptance evidence"
  ],
  "noStagedFiles": true,
  "diffSummary": "Final Windows x64 CPU-only Native ASR artifact/build-input lock, deterministic builder and semantic verifier, MVP target exclusion, shared NSIS/portable resource preparation, model-backed/package evidence, and independent review fixes.",
  "reviewFindings": [
    "fixed P1: stale NSIS/portable evidence referenced the previous worker identity",
    "fixed P1: locked tokenizer/nlohmann/toolchain identities were not fully asserted before build",
    "fixed P1: final MVP preset default-built development-only fake/CrispASR/Parakeet targets",
    "fixed P1: third-party notice inventory lacked semantic verification",
    "fixed P1: VS2022 link-only Microsoft runtime notice was replaced with lock-bound official Runtime 2026 terms and project-license exclusion",
    "no blockers remain"
  ],
  "manualNotes": "No commit, push, archive, staging, or production route cutover was performed."
}
```
