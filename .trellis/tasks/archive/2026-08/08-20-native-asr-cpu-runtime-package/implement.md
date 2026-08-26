# Final Native ASR MVP CPU runtime implementation plan

> Status: implemented and locally verified. Do not commit, push or change remote state without separate explicit authorization.

## Step 1 - Load contracts and freeze the runtime lock schema

- Load `trellis-before-dev` for ASR/Tauri/package work.
- Read the current task artifacts, parent release-first artifacts, archived T06 selected CPU lock, `native-asr/CMakeLists.txt`, release scripts and path/runtime specs.
- Add `native-asr/runtime/windows-x64-cpu-lock.json` with:
  - platform/protocol/Candidate A identities;
  - exact source/toolchain fields;
  - expected payload/license roles;
  - forbidden capabilities/file classes;
  - setup/portable/unpacked budgets;
  - final archive size/hash fields populated only after the reproducibility gate.
- Add minimal lock/verifier fixture tests before implementation.

Rollback: remove the new lock/schema tests; no runtime or package input changes yet.

## Step 2 - Remove archived-local and Candidate B dependencies from the final build

- Change `native-asr/CMakeLists.txt` so final CT2 source/oneDNN/pocketfft paths are explicit verified inputs rather than defaults below archived task `research/local`.
- Add one Candidate B development compile option and guard its ORT/VAD includes, implementation, link libraries, copied DLL/model assets and tests.
- Add final Windows x64 CPU runtime preset/config with CUDA, CrispASR, Candidate B, fallback parity and parity discovery disabled.
- Keep historical development presets available only where their exact ignored inputs still exist.
- Make `useVad=true` on the final worker return a stable structured not-built/unsupported error before model loading.
- Keep CPU Candidate A defaults, protocol v1 and `cuda_not_built` behavior unchanged.

Focused checks:

```powershell
cmake --preset windows-x64-cpu-runtime
cmake --build --preset windows-x64-cpu-runtime --target hikaru-asr-worker hikaru-asr-ctranslate2-tests hikaru-asr-protocol-tests
ctest --preset windows-x64-cpu-runtime
```

Also inspect the produced import closure and prove no ORT/VAD/CrispASR/GPU file is needed or copied.

Rollback: remove the final preset/option and restore the previous CMake dependency path/link behavior; production remains Python legacy.

## Step 3 - Implement clean deterministic runtime construction

- Add `scripts/build-native-asr-runtime.ps1`.
- Attest exact MSVC, Windows SDK, Rust, CMake and Ninja versions before downloads or compilation.
- Download/reuse source archives only through lock-bound URL/size/SHA-256 checks under `.cache/native-asr-runtime/`.
- Verify/extract the Git-tracked CTranslate2 DLL/import-library input, then build tokenizer and worker in fresh roots with reproducible/path-remapping flags; the lock preserves the pinned CTranslate2/oneDNN source provenance.
- Stage only runtime payload files discovered by the explicit allowlist/import closure.
- Generate deterministic third-party notices from the actual delivered dependency set.
- Generate canonical `runtime-manifest.json` and sorted `SHA256SUMS` without private paths or current timestamps.
- Create ZIP entries in sorted order with one fixed source-date timestamp.

Run the script twice with separate build roots and compare every payload hash and the complete ZIP SHA-256. Any difference blocks the task.

Rollback: delete only generated build/cache/staging output and the new build script; do not alter user caches or archived evidence.

## Step 4 - Implement the shared verifier and mutation tests

- Add `scripts/verify-native-asr-runtime.mjs` with reusable verification functions and a CLI.
- Verify outer archive identity, safe entry paths, exact payload closure, manifest/checksum agreement, capability/forbidden-file rules and license inventory.
- Verify the extracted tree using the same canonical rules.
- Add the smallest runnable test set covering:
  - valid fixture;
  - archive/manifest/file hash drift;
  - missing/extra/wrong DLL;
  - traversal/absolute/drive path;
  - Python/model/ORT/VAD/CrispASR/GPU contamination;
  - protocol/config/platform mismatch.

Focused check:

```bash
pnpm test -- scripts/verify-native-asr-runtime.test.ts
```

Rollback: remove verifier/tests; the artifact is not accepted without them.

## Step 5 - Integrate verified resource preparation

- Extend `scripts/prepare-asr-resource.mjs` instead of adding a second release pipeline.
- Preserve existing clean Python template copy.
- Verify the tracked runtime ZIP against its lock, extract to a temporary sibling, verify the extracted tree, then atomically replace `src-tauri/resources/native-asr/`.
- Ignore generated extracted directories; keep the final runtime ZIP, compact CTranslate2 link-input ZIP and lock tracked.
- Update `scripts/package-portable.mjs` so portable staging requires and copies the emitted `native-asr` directory.
- Update script tests for missing/tampered runtime and installed/portable entry closure.
- Keep `.github/workflows/ci.yml`, `.github/workflows/release.yml` and `pnpm release:local` on the shared `pnpm asr:prepare-resource` path; add explicit verification steps only if needed for clear logs.

Focused checks:

```bash
pnpm asr:prepare-resource
pnpm test -- scripts/package-portable.test.ts scripts/verify-native-asr-runtime.test.ts
pnpm build
```

Rollback: remove native extraction from preparation and portable entries; legacy Python resource preparation remains intact.

## Step 6 - Validate DLL closure and restricted-path loading

- Add a Windows package check that inspects worker/DLL imports and classifies system versus bundled dependencies.
- Stage installed-like and portable-like roots from the verified artifact.
- Launch the worker with PATH restricted to the artifact root plus Windows System32.
- Assert missing/wrong bundled DLLs fail before acceptance and the valid artifact does not load a non-system module outside its root.
- Keep raw module paths and machine details below ignored task-local output; tracked evidence records sanitized role/name/hash results only.

Rollback: delete package-check output; do not weaken the verifier or add ambient PATH exceptions.

## Step 7 - Produce and track the final runtime ZIP

- Run two clean deterministic builds using the frozen lock/toolchain.
- Require byte-identical payload and ZIP output.
- Copy the accepted ZIP to `native-asr/artifacts/windows-x64-cpu.zip`.
- Populate the outer lock with final archive size/SHA-256/artifact id.
- Re-run verification from a clean checkout-style resource directory.
- Confirm tracked artifact size is below GitHub's per-file limit and does not contain private paths, logs, PDBs, tests or models.

Rollback: remove the ZIP and clear final artifact fields from the lock; do not promote a non-reproducible build.

## Step 8 - Run T12-backed functional smoke

Precondition: exact T12-ready large-v3 cache exists and validates.

- Use the packaged worker from installed-like and portable-like roots.
- Run one short 16 kHz mono WAV and one `>10` minute WAV.
- Validate JSONL protocol, clean exit, non-empty UTF-8 text, ordered positive-duration audio-bounded segments and zero stdout contamination.
- Re-run Rust host compatibility with the packaged worker for success, cancel `<=2s`, abnormal exit/recovery, fallback ASS and active-job release.
- Ensure CPU cancellation uses the no-VAD MVP route.
- Record quality/performance metrics only as diagnostics.

Suggested commands/environment shape:

```powershell
$env:HIKARU_ASR_PRODUCTION_WORKER = <packaged worker>
$env:HIKARU_ASR_CT2_MODEL_PATH = <T12 ready large-v3>
$env:HIKARU_ASR_CT2_AUDIO_PATH = <short wav>
$env:HIKARU_ASR_CT2_CANCEL_AUDIO_PATH = <long wav>
cargo test --manifest-path src-tauri/Cargo.toml asr_worker -- --nocapture
# Run the package smoke CLI separately for complete >10-minute installed/portable transcription.
```

If T12 is not ready, keep this task in progress with an explicit dependency blocker; do not mark it complete from model-free tests alone.

Rollback: remove only task-local smoke output; do not delete the shared model cache or benchmark media.

## Step 9 - Build packages and enforce budgets

- Run `pnpm asr:prepare-resource` from a clean generated resource state.
- Build NSIS and portable outputs using the verified tracked ZIP.
- Measure:
  - runtime ZIP;
  - unpacked runtime;
  - Windows setup;
  - portable ZIP;
  - bundled model-weight count.
- Require setup `<=80 MB`, portable `<=90 MB`, unpacked runtime `<=250 MB`, model weights `0`.
- Produce a sanitized T13 handoff containing artifact id/hash, payload/license roles, reproducibility result, package sizes and smoke results for T18.

Suggested commands:

```bash
pnpm release:local
pnpm version:check
```

Rollback: remove generated package output and handoff; keep production/default Python legacy.

## Step 10 - Full quality gate and independent review

Run:

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
python ./.trellis/scripts/task.py validate 08-20-native-asr-cpu-runtime-package
git diff --check
git status --short
```

Also run the final CMake/CTest, verifier mutation suite, two-clean-build comparison, restricted DLL/PATH checks, installed/portable short + long smoke, package-size check and privacy/license scan.

Independent review must check:

- artifact scope is CPU Candidate A only;
- no archived/local/private build dependency remains;
- reproducibility is byte-identical rather than approximate;
- manifest/hash/license closure matches actual bytes;
- app release consumes the tracked ZIP and does not rebuild;
- production/default has not cut over;
- T18 can consume the exact final identity;
- no user data, model cache or remote state was changed.

Fix every P0/P1 finding and rerun the affected gate before completion.

## Completion Gate

Planning is ready for activation only when:

- PRD/design/implement are user-approved;
- `implement.jsonl` and `check.jsonl` contain real spec/research entries;
- task scope is set and single-repo mode is confirmed (`package: null` is intentional);
- task validation passes;
- the user separately approves `task.py start` and implementation.

Implementation is complete only when every acceptance criterion is evidenced. Do not commit or archive without the user's separate explicit instruction.
