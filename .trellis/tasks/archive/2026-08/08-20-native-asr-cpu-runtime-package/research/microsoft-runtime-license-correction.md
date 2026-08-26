# Microsoft Visual C++ Runtime 2026 license correction

## Result

Corrected the bundled VC145 licensing boundary without changing inference, routing, UI, or the four Microsoft DLL bytes. The previous VS2022 link-only notice is no longer present in production lock/build metadata.

## Official authority and identity

- VS18 redistribution list: <https://aka.ms/vs/18/redistribution>
- Applicable Runtime terms page: <https://visualstudio.microsoft.com/license-terms/vs2026-ga-visualcpp-v14-redist-runtime/>
- Official immutable document URL: <https://visualstudio.microsoft.com/wp-content/uploads/2025/10/Visual-C-V14-License-Redistributable_and_Runtime_ENU.docx>
- Runtime path: `licenses/Microsoft-Visual-Cpp-V14-Runtime-2026-License.docx`
- Size: `39553` bytes
- SHA-256: `08651651a7602fc7c0e2763de0fde1ff9f868df2780597cd1775ee9d6441c783`
- Microsoft acceptance text preserved in the lock and notice: `BY USING THE SOFTWARE, YOU ACCEPT THESE TERMS. IF YOU DO NOT ACCEPT THEM, DO NOT USE THE SOFTWARE.`

The unchanged official DOCX is now bundled locally. The generated notice explicitly states that `msvcp140.dll`, `vcomp140.dll`, `vcruntime140.dll`, and `vcruntime140_1.dll` are excluded from Hikaru Sub's Apache-2.0 project license and are governed by the Microsoft Visual C++ V14 Redistributable and Runtime 2026 terms. No custom EULA or click-through UI was added.

## Fail-closed behavior

- The lock owns the VS2026 terms URL, VS18 redistribution URL, immutable DOCX URL, runtime path, size, SHA-256, use-based acceptance sentence, project-license exclusion, and exact four-DLL list.
- The builder downloads/reuses only the locked DOCX identity before compilation, copies it unchanged, and rechecks its staged identity.
- The package continues to generate `THIRD-PARTY-NOTICES.json` from lock-owned component metadata and calls the shared extracted-runtime verifier before ZIP creation.
- The verifier rejects wrong terms/redistribution/document URLs, wrong local path, missing use-acceptance/project-license exclusion, wrong DLL list, missing required license role, notice drift, or DOCX size/hash drift.
- The focused suite now has 10 tests, including Microsoft notice semantics, VS2022 substitution, and license-document mutation.

## Final identities

- Runtime ZIP: `6859911` bytes
- Runtime ZIP SHA-256: `e84948f668bc0e308ad4d47edb58b9644f0d3c468c9e2071913277416dea7ff3`
- Unpacked runtime: `26023959` bytes (`<= 262144000`)
- Payload files: `17`
- Worker: `466944` bytes, SHA-256 `095a19ca896867efe64a19501594e7a7ee0539f58411051f83504b4900de2c14` (unchanged)
- NSIS setup: `11101801` bytes, SHA-256 `92d5d038eeca5a4d3ba5389cf9be6559d8cdbafa7e466acc13f06130abfd89f1`
- Portable ZIP: `15357148` bytes, SHA-256 `38a3c8a398baa769b58e8bfc968733b2f78ddc65f9e36e09d046ebf7377380bb`
- Bundled model weights: `0`

Microsoft DLL identities remained unchanged:

| File | Bytes | SHA-256 |
|---|---:|---|
| `msvcp140.dll` | 553552 | `def46aa6a8f72f27bafac0c43334419486a4d1dcdb6c479a8ef7034b3e1fa4cb` |
| `vcomp140.dll` | 213064 | `31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7` |
| `vcruntime140.dll` | 123472 | `184146852727a9db4eea06178716bec3cdbb1015c911f6b0f915b184ad7775b2` |
| `vcruntime140_1.dll` | 47264 | `e6bfb3662ab4b1969a73441dbe35c96d51441b6bff8cf1fe7430bd5b246ca605` |

## Requalification and validation

- Independent resumed build roots D/E each ran final `4/4` CTest, restricted launch, and packaging; complete ZIPs were byte-identical.
- Installed-like short smoke: `24102 ms`, 5 segments, 9 events.
- Portable-like short smoke: `24102 ms`, 5 segments, 9 events.
- Installed-like 601-second smoke: 168 segments, 193 events.
- Portable-like 601-second smoke: 168 segments, 193 events.
- Rust production worker success/pre-ready rejection: 2/2 passed.
- Rust real-worker cancellation: passed in 8.06 seconds; the test's worker termination assertion remains `<=2s`.
- Portable manifest equals the prepared final manifest and contains the locked official DOCX.
- Setup, portable, and unpacked runtime remain below budgets.

## Commands run

- `pnpm exec vitest run scripts/verify-native-asr-runtime.test.mjs --exclude '.trellis/**'`
- `pwsh -NoProfile -File scripts/build-native-asr-runtime.ps1 -WorkRoot .cache/native-asr-runtime/build-d -OutputPath .cache/native-asr-runtime/windows-x64-cpu-license-d.zip -Resume`
- `pwsh -NoProfile -File scripts/build-native-asr-runtime.ps1 -WorkRoot .cache/native-asr-runtime/build-e -OutputPath .cache/native-asr-runtime/windows-x64-cpu-license-e.zip -Resume`
- `cmp` of D/E complete ZIPs
- `pnpm asr:runtime:verify`
- `pnpm asr:prepare-resource`
- installed/portable short and 601-second `scripts/smoke-native-asr-runtime.mjs` runs
- filtered Rust production-worker and cancellation tests
- `pnpm release:local`
- `pnpm test`
- `pnpm build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm version:check`
- `python ./.trellis/scripts/task.py validate 08-20-native-asr-cpu-runtime-package`
- `git diff --check`
- staged-file check

## Residual conditions

No known artifact-level Microsoft Runtime licensing defect remains. Redistribution still presumes a validly licensed VS18 user and compliance by the distributor with Microsoft's general trade-law and indemnity conditions; these are conditions of the official license, not missing runtime-package files or notices.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Bundled and hash-locked the unchanged official Runtime 2026 DOCX, corrected VS18/VS2026 authority and project-license exclusion metadata, added fail-closed semantics/document checks, and changed no inference or production routing scope."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Two independent final roots produced byte-identical ZIPs; final installed/portable model smoke, Rust host/cancel, release packages, focused/full tests, identities, budgets, and no-staged-files are recorded above."
    }
  ],
  "changedFiles": [
    "native-asr/runtime/windows-x64-cpu-lock.json",
    "native-asr/artifacts/windows-x64-cpu.zip",
    "scripts/build-native-asr-runtime.ps1",
    "scripts/verify-native-asr-runtime.mjs",
    "scripts/verify-native-asr-runtime.test.mjs",
    ".trellis/spec/tauri/media-ffmpeg-asr.md",
    ".trellis/tasks/08-20-native-asr-cpu-runtime-package/prd.md",
    ".trellis/tasks/08-20-native-asr-cpu-runtime-package/design.md",
    ".trellis/tasks/08-20-native-asr-cpu-runtime-package/research/runtime-package-handoff.json",
    ".trellis/tasks/08-20-native-asr-cpu-runtime-package/research/trellis-check-report.md",
    ".trellis/tasks/08-20-native-asr-cpu-runtime-package/research/microsoft-runtime-license-correction.md"
  ],
  "testsAddedOrUpdated": [
    "scripts/verify-native-asr-runtime.test.mjs"
  ],
  "commandsRun": [
    {
      "command": "pnpm exec vitest run scripts/verify-native-asr-runtime.test.mjs --exclude '.trellis/**'",
      "result": "passed",
      "summary": "10/10 verifier tests passed, including Microsoft notice and document drift."
    },
    {
      "command": "build-native-asr-runtime.ps1 for build-d and build-e with -Resume",
      "result": "passed",
      "summary": "4/4 CTest and restricted launch passed in each root; complete corrected ZIPs were byte-identical."
    },
    {
      "command": "pnpm asr:runtime:verify && pnpm asr:prepare-resource",
      "result": "passed",
      "summary": "Verified and extracted final e84948f... artifact."
    },
    {
      "command": "installed/portable short and 601-second smoke-native-asr-runtime.mjs",
      "result": "passed",
      "summary": "Both layouts produced identical valid event/segment counts."
    },
    {
      "command": "filtered Rust production-worker and cancellation tests",
      "result": "passed",
      "summary": "2/2 host tests and the cancellation test passed against final worker bytes."
    },
    {
      "command": "pnpm release:local",
      "result": "passed",
      "summary": "Rebuilt NSIS and portable packages with the locked local Runtime 2026 DOCX."
    },
    {
      "command": "pnpm test && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml",
      "result": "passed",
      "summary": "Full application gates passed; build retained the pre-existing chunk-size warning."
    },
    {
      "command": "pnpm version:check && task.py validate && git diff --check",
      "result": "passed",
      "summary": "Version, Trellis context, JSON/evidence, and whitespace checks passed."
    }
  ],
  "validationOutput": [
    "Official DOCX 39553 bytes / 08651651a7602fc7c0e2763de0fde1ff9f868df2780597cd1775ee9d6441c783",
    "Runtime ZIP 6859911 bytes / e84948f668bc0e308ad4d47edb58b9644f0d3c468c9e2071913277416dea7ff3",
    "Worker unchanged: 095a19ca896867efe64a19501594e7a7ee0539f58411051f83504b4900de2c14",
    "NSIS 11101801 bytes; portable 15357148 bytes; unpacked runtime 26023959 bytes",
    "Four Microsoft DLL identities unchanged",
    "No staged files"
  ],
  "residualRisks": [
    "No artifact-level licensing defect known; distribution remains subject to the official license's valid-VS-license, trade-law, and indemnity conditions."
  ],
  "noStagedFiles": true,
  "diffSummary": "Replaced the incorrect VS2022 link-only Microsoft runtime notice with a lock-bound unchanged official Runtime 2026 DOCX, semantic notice/document verification, refreshed deterministic artifact and release evidence, and no inference/UI/cutover changes.",
  "reviewFindings": [
    "fixed blocker: VS2022 terms URL did not match VS18/VC145 runtime",
    "fixed blocker: applicable Runtime 2026 end-user terms were not locally bundled",
    "fixed blocker: verifier did not enforce Microsoft project-license exclusion/use-acceptance/document identity",
    "no blockers remain"
  ],
  "manualNotes": "No commit, push, staging, archive, Git-history change, click-through UI, custom EULA, production cutover, model-cache mutation, or remote release action was performed."
}
```
