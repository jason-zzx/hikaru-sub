# Independent check — Microsoft Visual C++ Runtime 2026 licensing correction

## Result

Independent review found and fixed one P1 fail-closed gap. No P0/P1 artifact-level Microsoft Runtime licensing blocker remains in the reviewed tree.

The implementation already shipped the correct unchanged official Runtime 2026 DOCX and removed the VS2022 production mismatch. The remaining gap was that a future coordinated lock/notice edit could remove one of the four Microsoft DLLs, append a custom legal claim, remove the Microsoft contract entirely, or alter the human-readable notice while still satisfying the previous lock-relative checks. The verifier and builder now reject those cases against an exact known semantic contract.

## Official authority checked

- VS18 redistribution authority: <https://aka.ms/vs/18/redistribution>
  - Redirected to the official Visual Studio 2026 redistribution page.
  - The page identifies VC145 Visual C++ Runtime files, permits licensed users to distribute unmodified files from `VC\Redist` with their program, and prohibits modification.
- Visual Studio Community 2026 terms: <https://visualstudio.microsoft.com/license-terms/vs2026-ga-community/>
  - The official embedded DOCX names `https://aka.ms/vs/18/redistribution` as the Distributable List.
  - It contains the requirements to add significant primary application functionality, require distributors/end users to accept protective terms, and indemnify Microsoft.
- End-user Runtime terms: <https://visualstudio.microsoft.com/license-terms/vs2026-ga-visualcpp-v14-redist-runtime/>
- Official Runtime 2026 DOCX: <https://visualstudio.microsoft.com/wp-content/uploads/2025/10/Visual-C-V14-License-Redistributable_and_Runtime_ENU.docx>
  - Independently downloaded size: `39553` bytes.
  - Independently downloaded SHA-256: `08651651a7602fc7c0e2763de0fde1ff9f868df2780597cd1775ee9d6441c783`.
  - The document identifies `MICROSOFT VISUAL C++ V14 REDISTRIBUTABLE and RUNTIME`, is dated October 1, 2025, and contains exactly: `BY USING THE SOFTWARE, YOU ACCEPT THESE TERMS. IF YOU DO NOT ACCEPT THEM, DO NOT USE THE SOFTWARE.`

## Artifact and notice findings

- Runtime ZIP: `6859911` bytes, SHA-256 `e84948f668bc0e308ad4d47edb58b9644f0d3c468c9e2071913277416dea7ff3`.
- The ZIP ships the unchanged official DOCX at `licenses/Microsoft-Visual-Cpp-V14-Runtime-2026-License.docx` with the official `39553` / `08651651...` identity.
- `THIRD-PARTY-NOTICES.json` and the human-readable Microsoft notice both:
  - use the VS2026 Runtime terms URL;
  - use the VS18 redistribution URL;
  - bind the local license path;
  - preserve Microsoft's exact use-based acceptance sentence;
  - state that the Microsoft DLLs are excluded from Hikaru Sub's Apache-2.0 project license and governed by the official Runtime 2026 terms;
  - name exactly `msvcp140.dll`, `vcomp140.dll`, `vcruntime140.dll`, and `vcruntime140_1.dll`.
- The four bundled DLLs are byte-identical to the VS18 Community `VC/Redist/MSVC/14.50.35710/x64` copies and retain the locked identities recorded by the task.
- No VS2022 Runtime reference remains in production lock, runtime archive, prepared native resource, or portable native resource. The sole tracked VS2022 occurrence is the intentional negative mutation in `scripts/verify-native-asr-runtime.test.mjs`.
- No custom EULA or click-through claim was added. The only project-authored legal text scopes Hikaru Sub's own Apache-2.0 license and points to Microsoft's unchanged terms; the acceptance sentence is quoted exactly and labelled as Microsoft's statement.

## P1 finding fixed

### Coordinated lock/notice drift could bypass the previous semantic intent

The prior verifier compared several Microsoft fields with constants, but it still derived the DLL list from the mutable lock, accepted any exclusion string containing one substring, did not reject extra component fields/custom claims, and did not validate the human-readable Microsoft notice bytes. It also skipped the Microsoft contract when the mutable redistributable array was removed.

Fixed by:

- fixing the Microsoft component version, license name, exact exclusion sentence, accepted component key set, and exact four-DLL set in the shared verifier;
- requiring the exact four DLLs to retain the `microsoft-runtime` role;
- requiring both the official DOCX and human-readable notice as license files;
- rejecting removal of the Microsoft contract for the production artifact identity;
- validating the human-readable notice as exact deterministic text, preventing appended unsupported claims;
- adding `--lock-only` verification and invoking it in the builder before CMake configure/compilation;
- extending the focused mutation test to reject four-DLL list reduction, whole-contract removal, appended custom rights, and human-readable notice drift.

The change does not alter the runtime ZIP, worker, DLLs, manifest, release packages, routing, model data, UI, or production default. A resumed final build reproduced the already-attested ZIP byte-for-byte.

## Final evidence checked

- Worker remains `466944` bytes / SHA-256 `095a19ca896867efe64a19501594e7a7ee0539f58411051f83504b4900de2c14`.
- Rebuilt review ZIP matched the tracked runtime byte-for-byte: `6859911` / `e84948f...`.
- Unpacked runtime: `26023959` bytes, below `262144000`.
- Portable ZIP directly contains the same official DOCX and final runtime manifest.
- Current NSIS setup on disk matches handoff evidence: `11101801` bytes / `92d5d038eeca5a4d3ba5389cf9be6559d8cdbafa7e466acc13f06130abfd89f1`.
- Current portable ZIP on disk matches handoff evidence: `15357148` bytes / `38a3c8a398baa769b58e8bfc968733b2f78ddc65f9e36e09d046ebf7377380bb`.
- `runtime-package-handoff.json` binds functional smoke and host compatibility to the unchanged final worker SHA and binds the corrected Runtime 2026 license identity.
- No files are staged.

## Verification commands

- Official Runtime DOCX download and SHA-256 comparison — passed (`39553` / `08651651...`).
- Official Community 2026 DOCX clause extraction — passed; redistribution list and distribution requirements were present.
- Official VS18 redistribution page redirect/content check — passed; VC145, `VC\Redist`, and unmodified-file language were present.
- Runtime/portable ZIP inspection and production VS2022 scan — passed.
- `node scripts/verify-native-asr-runtime.mjs --lock native-asr/runtime/windows-x64-cpu-lock.json --lock-only` — passed.
- `pnpm exec vitest run scripts/verify-native-asr-runtime.test.mjs --exclude '.trellis/**'` — 10/10 passed after the stricter mutations were added.
- `pnpm asr:runtime:verify` — passed for `e84948f...`.
- `pwsh -NoProfile -File scripts/build-native-asr-runtime.ps1 -WorkRoot .cache/native-asr-runtime/build-d -OutputPath .cache/native-asr-runtime/windows-x64-cpu-license-review.zip -Resume` — lock validation ran before CMake; 4/4 CTest passed; restricted launch passed; output was byte-identical to the tracked ZIP.
- `pnpm asr:prepare-resource` — passed for the corrected final artifact.
- `pnpm test` — passed.
- `pnpm build` — passed with the existing chunk-size warning.
- `cargo test --manifest-path src-tauri/Cargo.toml` — passed.
- `pnpm version:check` — passed.
- `python ./.trellis/scripts/task.py validate 08-20-native-asr-cpu-runtime-package` — passed.
- `git diff --check` and staged-file check — passed; no staged files.

## Residual conditions

No known artifact-level Microsoft Runtime licensing defect remains. Distribution still requires a validly licensed VS18 user and distributor compliance with the official Community terms, including general trade-law and indemnity obligations. Those are obligations of the distributor, not additional files or custom terms that belong in this runtime artifact. This report is an engineering verification against the cited Microsoft terms, not independent legal advice.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed only the requested Microsoft Runtime 2026 licensing boundary and tightened three shared verifier/builder/test files; runtime, inference, routing, UI, model, and release identities were not widened or changed."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Official online DOCX and VS18/VS2026 authority were independently checked; exact artifact/package identities, semantic mutations, a resumed deterministic build, focused/full tests, and no-staged-files are recorded."
    }
  ],
  "changedFiles": [
    "scripts/verify-native-asr-runtime.mjs",
    "scripts/verify-native-asr-runtime.test.mjs",
    "scripts/build-native-asr-runtime.ps1",
    ".trellis/tasks/08-20-native-asr-cpu-runtime-package/research/microsoft-runtime-license-check.md"
  ],
  "testsAddedOrUpdated": [
    "scripts/verify-native-asr-runtime.test.mjs — exact four-DLL list, contract-removal, custom-claim, and human-readable-notice drift coverage"
  ],
  "commandsRun": [
    {
      "command": "official Microsoft DOCX/page download, parse, and SHA-256 checks",
      "result": "passed",
      "summary": "Official Runtime DOCX matched 39553 bytes / 08651651...; Community terms and VS18 redistribution authority contained the expected clauses."
    },
    {
      "command": "pnpm exec vitest run scripts/verify-native-asr-runtime.test.mjs --exclude '.trellis/**'",
      "result": "passed",
      "summary": "10/10 verifier tests passed with the stricter Microsoft semantic mutations."
    },
    {
      "command": "node scripts/verify-native-asr-runtime.mjs --lock native-asr/runtime/windows-x64-cpu-lock.json --lock-only",
      "result": "passed",
      "summary": "Exact Microsoft Runtime contract accepted independently of artifact extraction."
    },
    {
      "command": "pnpm asr:runtime:verify && pnpm asr:prepare-resource",
      "result": "passed",
      "summary": "Final corrected e84948f... artifact verified and atomically prepared."
    },
    {
      "command": "pwsh -NoProfile -File scripts/build-native-asr-runtime.ps1 -WorkRoot .cache/native-asr-runtime/build-d -OutputPath .cache/native-asr-runtime/windows-x64-cpu-license-review.zip -Resume",
      "result": "passed",
      "summary": "Lock validation preceded CMake; 4/4 CTest and restricted launch passed; rebuilt ZIP was byte-identical to the tracked artifact."
    },
    {
      "command": "pnpm test && pnpm build && cargo test --manifest-path src-tauri/Cargo.toml",
      "result": "passed",
      "summary": "Full application test/build/Rust gates passed; frontend build retained only the existing chunk-size warning."
    },
    {
      "command": "pnpm version:check && python ./.trellis/scripts/task.py validate 08-20-native-asr-cpu-runtime-package && git diff --check",
      "result": "passed",
      "summary": "Version, Trellis context, and whitespace checks passed."
    }
  ],
  "validationOutput": [
    "Official Runtime 2026 DOCX: 39553 bytes / 08651651a7602fc7c0e2763de0fde1ff9f868df2780597cd1775ee9d6441c783",
    "Runtime ZIP: 6859911 bytes / e84948f668bc0e308ad4d47edb58b9644f0d3c468c9e2071913277416dea7ff3",
    "Worker unchanged: 466944 bytes / 095a19ca896867efe64a19501594e7a7ee0539f58411051f83504b4900de2c14",
    "NSIS: 11101801 bytes / 92d5d038eeca5a4d3ba5389cf9be6559d8cdbafa7e466acc13f06130abfd89f1",
    "Portable ZIP: 15357148 bytes / 38a3c8a398baa769b58e8bfc968733b2f78ddc65f9e36e09d046ebf7377380bb",
    "Production artifacts contain no VS2022 Runtime metadata",
    "No staged files"
  ],
  "residualRisks": [
    "No artifact-level blocker; distribution remains subject to the official license's valid-VS-license, trade-law, and indemnity conditions."
  ],
  "noStagedFiles": true,
  "diffSummary": "Independent review preserved the final runtime bytes while making Microsoft Runtime licensing fail closed against list reduction, contract removal, custom legal claims, notice drift, and late build-time validation.",
  "reviewFindings": [
    "fixed P1: exact four-DLL and no-custom-claims semantics could previously drift together with the mutable lock/notice",
    "fixed P1: Microsoft contract removal could bypass the previous conditional validation",
    "fixed P1: builder did not validate the semantic license lock before compilation",
    "no P0/P1 blockers remain"
  ],
  "manualNotes": "No commit, push, staging, archive, Git-history change, custom EULA, click-through UI, production cutover, or remote release action was performed."
}
```
