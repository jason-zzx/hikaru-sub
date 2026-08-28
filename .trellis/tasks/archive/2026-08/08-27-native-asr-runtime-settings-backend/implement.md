# T16 implementation plan

## Preconditions and activation gate

- T12 Native model manager and T13 CPU runtime package are completed inputs.
- T16 must stay within the MVP route: Windows x64, Faster-Whisper large-v3, CTranslate2 CPU.
- T17 owns visible frontend migration; T18 owns Release/default enablement and package removal of Python.
- Before implementation, review `prd.md` and `design.md`, curate both JSONL manifests, validate the task, and obtain user approval to run `task.py start`.
- Do not commit, push, archive, or alter Git history/remote state without a separate explicit user instruction.

## Step 0 - Lock the no-mixed-route boundary

- Add tests or a small pure policy helper proving one route selection controls engine list, model status/download, and transcription start together.
- Keep the normal Release/default selection legacy in T16.
- Provide a test/debug construction path for `NativeMvp` without a persisted setting or Release environment override.
- Assert that every Native preflight error returns directly and cannot call the sidecar.

Rollback point: remove the policy helper/tests; current legacy behavior remains unchanged.

## Step 1 - Migrate legacy ASR settings input

Write focused Rust tests first:

- old JSON with `pythonPath` and `asrServicePath` still deserializes;
- both fields are cleared/ignored in returned settings;
- serialization omits both keys;
- unrelated ASR, provider, translation, subtitle, and hotkey fields round-trip unchanged;
- parsing/loading does not itself write a replacement file.

Then make the minimum `settings.rs` change:

- retain the fields only as backward-compatible deserialization input;
- clear them during parse/runtime normalization;
- skip them during serialization;
- leave `asrEngine`, `asrModel`, and `asrDevice` untouched.

Focused check:

```bash
cargo test --manifest-path src-tauri/Cargo.toml settings::tests
```

Rollback point: restore prior field serialization/sanitization only; do not rewrite user files.

## Step 2 - Resolve the bundled Native CPU runtime

- Add the smallest shared helper needed to resolve `<resource_dir>/native-asr/windows-x64/cpu` and `hikaru-asr-worker.exe`.
- Read only the runtime-manifest fields needed for consumption-time identity/capability checks; do not duplicate T13's full ZIP/file/license verifier.
- Return a typed/internal runtime status containing path, artifact identity, availability, and controlled error.
- Cover installed-like and portable-like resource layouts with temporary-root tests where possible.
- Preserve `app_paths` for config/cache and existing Tauri resource resolution for bundled application resources.

Focused checks:

```bash
cargo test --manifest-path src-tauri/Cargo.toml dependencies::tests
pnpm asr:runtime:verify
```

Rollback point: remove only the runtime consumer/helper; leave the T13 artifact/resource preparation unchanged.

## Step 3 - Migrate runtime dependency probe, measure, and cleanup

Write focused tests first for the final production payload:

- probe emits FFmpeg, `nativeAsrCpu`, and exact large-v3 model state, with no Python/venv items;
- probe performs no recursive size calculation;
- valid runtime is built-in/unmanaged and missing/invalid runtime is controlled;
- measure emits managed FFmpeg when applicable, models, downloads, and app cache, with no Python/venv/runtime-resource storage item;
- model storage is bounded to managed `deps/models` and covers direct CT2 plus managed HF cache;
- app-cache preservation remains unchanged;
- cleanup rejects `nativeAsrCpu` and cannot escape approved roots.

Then update `dependencies.rs` minimally:

- add `NativeAsrCpu` to the Rust kind;
- stop emitting legacy Python/venv kinds from production probe/measure;
- obtain exact large-v3 readiness from the existing `AsrState.native_models` seam without duplicating model validation;
- keep legacy variants accepted temporarily if needed by current commands/UI;
- keep probe/measure/cleanup async and blocking work in `spawn_blocking`;
- retain writable/elevation checks before managed `deps` cleanup.

Focused check:

```bash
cargo test --manifest-path src-tauri/Cargo.toml dependencies::tests
```

Rollback point: restore the old emitted kind arrays/targets; never delete user storage as part of code rollback.

## Step 4 - Wire engine/model commands to T12 in Native mode

- Add a pure DTO mapper from `NativeAsrModelStatus` to the backward-compatible public status plus disposition/backend/revision/origin/reason.
- Expose a minimal known-engine/catalog helper from `asr_models.rs` only if `list_asr_engines` cannot reuse existing data without duplication.
- In Native mode:
  - `list_asr_engines` returns built-in Faster-Whisper availability and known deferred engines without sidecar startup;
  - `check_asr_model` calls `NativeAsrModelManager.status`;
  - `download_asr_model` calls `NativeAsrModelManager.start_download`;
  - `get_model_download_progress` calls `job_snapshot`, maps `sourceEndpoint` to existing `hfEndpoint`, and preserves not-found/error behavior.
- Keep legacy command branches intact for the pre-T18 policy and rollback evidence.
- Do not add a second Tauri command or manager instance.

Focused checks:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests
cargo test --manifest-path src-tauri/Cargo.toml asr::tests
```

Rollback point: select the legacy command branches; leave T12 model data and jobs untouched.

## Step 5 - Wire packaged worker launch to exact model resolution

Write/extend focused tests for:

- `auto` and `cpu` resolving to CPU;
- large-v3 ready path becoming the sole `model` role passed to `ResolvedNativeLaunch`;
- missing model, post-MVP model, unknown model, unsupported engine/device, invalid runtime, and VAD-not-built returning controlled errors;
- no error branch calling `ensure_base_url` or starting Python;
- start failure releasing the unactivated reservation;
- existing Native progress/cancel/crash/recovery/slot-release behavior remaining unchanged.

Then update `asr.rs` minimally:

- lazily initialize or setup-initialize one packaged `NativeAsrHost` per process using the T13 worker;
- preserve the same `ActiveJobGate` and shutdown ownership;
- resolve the exact T12 model before constructing `ResolvedNativeLaunch`;
- keep product IDs, language, audio/output paths, VAD values, and recovery behavior on the existing contract;
- keep Release/default route policy legacy until T18.

Focused check:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr::tests
```

If the exact cached model and prepared runtime are locally available, run the existing model-backed host smoke without recording transcript text or private paths. Absence of the 3 GB model does not block unit/full automated checks; T18 owns installed/portable end-to-end release smoke.

Rollback point: restore legacy route selection; the packaged runtime and model cache remain untouched.

## Step 6 - Add the minimum typed frontend handoff

- Add `nativeAsrCpu` to `RuntimeDependencyKind` and `RUNTIME_DEPENDENCY_LABEL`.
- Add a typed Native disposition union and optional metadata to `AsrModelStatus` / `AsrEngineInfo` while retaining current fields.
- Keep existing `src/services/tauri.ts` wrapper names and call sites.
- Update focused constant/type-facing tests.
- Do not remove `AsrEngineSetupPanel`, redesign `ModelManager`, or change final selector/unavailable copy; T17 owns that work.

Focused checks:

```bash
pnpm test -- src/constants/runtimeDependencies.test.ts
pnpm build
```

Rollback point: remove only the additive TypeScript fields/kind after restoring the prior backend payload.

## Step 7 - Cross-layer coherence review

Review the full data flow:

```text
settings JSON
  -> Rust AppSettings
  -> get/set settings

T13 runtime + T12 model
  -> route policy
  -> stable Tauri commands
  -> typed tauri.ts wrappers
  -> existing components / T17 handoff

managed roots
  -> probe (no size)
  -> explicit measure
  -> bounded cleanup
```

Verify specifically:

- no Python/venv probe or requirement remains in the production Native branch;
- no native-download/legacy-launch combination exists;
- no silent Python fallback exists;
- no raw invoke or duplicate frontend state source was added;
- no recursive disk work runs directly on the async worker;
- no bundled runtime cleanup target exists;
- portable/current-video preservation remains intact;
- unrelated FFmpeg/settings/translation/subtitle behavior is unchanged.

## Step 8 - Full validation

Run in this order and fix every failure before completion:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
pnpm test
pnpm build
pnpm asr:runtime:verify
cargo test --manifest-path src-tauri/Cargo.toml
python ./.trellis/scripts/task.py validate 08-27-native-asr-runtime-settings-backend
git diff --check
git status --short
```

Record any environment-limited optional real-model smoke honestly. Do not mark the task complete while required automated checks fail.

## Step 9 - Independent quality gate and handoff

- Run `trellis-check` against the final T16 diff and acceptance criteria.
- Fix all P0/P1 findings and rerun affected/full checks.
- Update `.trellis/spec/` only for architecture/contracts that actually changed after implementation; do not pre-document speculative behavior.
- Record implementation evidence under this task without transcript text, model bytes, secrets, or private absolute paths.
- Present the completed changes and residual T17/T18 work to the user.
- Ask separately whether the user wants a commit. Do not commit automatically.

## Completion checklist

- [x] Settings migration is backward-readable, ignored, non-destructive, and non-serializing.
- [x] Built-in CPU runtime resolution consumes the T13 resource without a duplicate verifier.
- [x] Runtime probe/measure/cleanup emit the Native production contract and preserve async/containment rules.
- [x] Engine/model status and model download commands use T12 in Native mode with compatible payloads.
- [x] Native start uses the exact T12 model path and T13 worker through the existing host.
- [x] One route policy prevents mixed model/inference routing; Release/default remains for T18.
- [x] Minimal TypeScript contracts compile; T17 UX work is not absorbed into T16.
- [x] Required tests/build/runtime verification/task validation/diff checks pass.
- [x] Independent review has no unresolved P0/P1.
- [x] No unauthorized commit, push, archive, or Release cutover occurred.
