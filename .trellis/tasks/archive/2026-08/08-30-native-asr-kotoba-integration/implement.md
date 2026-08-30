# Native Kotoba ASR Integration Implementation Plan

## Execution Policy

- Implement only after the user reviews/approves this PRD and design and the task is activated.
- Reuse archived accepted K2 code and evidence; do not edit archived T08/K2 artifacts.
- Keep `faster-whisper / large-v3` as the default.
- Do not add Kotoba K3, Python parity, VAD, CUDA/Vulkan, a second worker, new commands, or a second frontend availability source.
- Do not commit, push, merge, rebase, reset, or archive with commit without a separate explicit user instruction.

## 1. Freeze Production Inputs

- [ ] Re-read the archived K2 handoff/lock and confirm the exact engine, model, revision, five file identities, MIT attribution, 128-Mel and no-VAD contracts.
- [ ] Record the new bundled CPU artifact ID and combined Faster-Whisper/Kotoba candidate-config identity before rebuilding.
- [ ] Confirm the model-backed short and >10-minute Japanese audio inputs are available locally; if not, keep automated work unblocked and record the missing manual-smoke prerequisite.

Validation:

```bash
python ./.trellis/scripts/task.py validate .trellis/tasks/08-30-native-asr-kotoba-integration
```

Rollback point: planning/identity edits only; no product code or artifacts changed.

## 2. Add Exact Kotoba Model Delivery

### Tests First

- [ ] Extend `src-tauri/src/asr_models.rs` tests for the repository-style model ID `kotoba-tech/kotoba-whisper-v2.0-faster`.
- [ ] Cover safe nested direct/download paths and rejection of absolute paths, drive prefixes, backslashes, extra separators, dot segments, reserved names and containment escapes.
- [ ] Add exact manifest/readiness coverage for all five Kotoba files, including required `preprocessor_config.json`.
- [ ] Cover direct install, valid exact legacy Hugging Face snapshot reuse, missing/corrupt preprocessor, wrong hash/revision, download staging and one-model failure isolation.
- [ ] Update deferred-model expectations so Kotoba is supported while Qwen3, Parakeet and ReazonSpeech remain `postMvpUnavailable`.

### Implementation

- [ ] Add the exact Kotoba entry to `src-tauri/resources/native-asr-models.json` using the archived file sizes/hashes/license.
- [ ] Generalize model-ID validation to accept one safe segment or exactly one safe `owner/name` product ID without weakening path containment.
- [ ] Keep direct/download path construction inside the existing model module; do not add a second model-path mapper.
- [ ] Remove Kotoba from deferred-only classification.
- [ ] Derive released engine availability from manifest support plus the retained deferred-engine list.

Focused validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models
```

Rollback point: remove the manifest entry and repository-style ID support; existing seven Faster-Whisper entries and paths remain unchanged.

## 3. Enable Kotoba In The Restricted Production Worker

### Tests First

- [ ] Replace the release assertion that expects Kotoba `route_not_built`.
- [ ] Add a restricted-build worker check proving a Kotoba request passes route selection and reaches controlled model/audio validation.
- [ ] Keep a negative check proving unsupported routes remain unavailable.
- [ ] Keep/extend `kotoba_vad_not_qualified`, missing preprocessor, wrong Mel, profile, ownership, dedup, progress and timeline tests.
- [ ] Confirm ordinary Faster-Whisper release-route tests remain unchanged and passing.

### Implementation

- [ ] Change the `HIKARU_ASR_MVP_CPU_RUNTIME` route gate in `native-asr/src/main.cpp` to allow exactly ordinary Faster-Whisper and Kotoba on CTranslate2.
- [ ] Preserve `kotoba_k2_config()` selection and existing no-VAD failure.
- [ ] Update the CMake release test name/script semantics so they no longer describe Kotoba as an unsupported route.
- [ ] Do not add DLLs, alternate backends, model downloads or settings behavior to the worker.

Focused validation:

```bash
# Configure/build the existing restricted Windows x64 CPU preset or release build.
# Then run its configured CTest suite, including ctranslate2-whisper-core and release route checks.
```

Rollback point: restore the ordinary-only restricted route check; no Tauri/frontend route should be enabled until the new worker artifact is ready.

## 4. Rebuild And Attest The Bundled CPU Runtime

- [ ] Update `native-asr/runtime/windows-x64-cpu-lock.json` to a new artifact identity with both engines and the combined candidate-config identity.
- [ ] Keep backend=`ctranslate2`, device=`cpu`, VAD/CrispASR/CUDA/Vulkan=false and modelsBundled=false.
- [ ] Build the deterministic artifact with the existing script.
- [ ] Update the attested ZIP size/hash, worker size/hash, generated runtime manifest, `SHA256SUMS` and resource copy.
- [ ] Verify PE imports and the runtime DLL closed set are unchanged unless the build proves an unavoidable source-level difference; no optional-engine DLL exception is allowed.
- [ ] Update `src-tauri/src/dependencies.rs` artifact ID/capability contract and focused tests to require both engines exactly.
- [ ] Run resource preparation/verification so `src-tauri/resources/native-asr/windows-x64/cpu` matches the new artifact byte-for-byte.

Validation:

```bash
pnpm asr:runtime:build
pnpm asr:runtime:verify
pnpm asr:prepare-resource
cargo test --manifest-path src-tauri/Cargo.toml dependencies
```

Rollback point: restore the previous v2 artifact lock/resource and Tauri artifact constant; leave downloaded models untouched.

## 5. Enable Tauri Production Routing

### Tests First

- [ ] Update `list_asr_engines` tests so Faster-Whisper and Kotoba are available CPU/CTranslate2 engines while Qwen3, Parakeet and ReazonSpeech remain deferred.
- [ ] Generalize request-validation tests for both released engines, `auto|cpu`, Japanese-only and no VAD.
- [ ] Add Kotoba status/start resolution coverage for ready, supported-missing, deferred/unsupported and missing runtime cases.
- [ ] Extend fake/model-backed host coverage for Kotoba success/failure/cancel/crash/recovery/active-gate behavior without duplicating the job reducer tests.

### Implementation

- [ ] Rename/generalize `validate_native_mvp_request` and remove its faster-whisper-only check.
- [ ] Let the model manager disposition remain the engine/model support authority before worker launch.
- [ ] Report engine availability from the manifest-derived catalog.
- [ ] Reuse the existing `ResolvedNativeLaunch`, model role, CPU device, recovery path and job host flow for Kotoba.
- [ ] Preserve controlled errors and zero Python fallback.

Focused validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr
cargo test --manifest-path src-tauri/Cargo.toml asr_worker
```

Rollback point: report Kotoba deferred and reject it before launch while retaining the new model files/cache for a later patch.

## 6. Synchronize The Frontend Minimally

### Tests First

- [ ] Update `src/hooks/useAsrAvailability.test.tsx` to include enabled Kotoba CPU and downloadable/ready Kotoba model states.
- [ ] Keep Qwen3, Parakeet, ReazonSpeech and CUDA disabled.
- [ ] Add/adjust a settings test proving Kotoba can be selected without changing the default or rewriting saved values.
- [ ] Add/adjust a transcription test proving the existing start request carries the Kotoba engine/model when selected and still uses the existing download/start lifecycle.

### Implementation

- [ ] Reuse `ASR_ENGINE_OPTIONS`, `ASR_ENGINE_MODELS`, `useAsrAvailability`, `ModelManager`, `SettingsTranscriptionPanel` and `TranscribeView`.
- [ ] Change production frontend code only if an existing hard-coded deferred assumption prevents the backend-supported status from rendering correctly.
- [ ] Keep `defaultAsrModel("faster-whisper") === "large-v3"` and do not migrate the default engine.
- [ ] Keep user-facing Kotoba copy factual: Japanese-optimized, Native CPU, model downloaded on demand; no quality-superiority claim.

Focused validation:

```bash
pnpm test -- src/constants/asr.test.ts src/hooks/useAsrAvailability.test.tsx src/components/workflow/SettingsTranscriptionPanel.test.tsx src/components/workflow/TranscribeView.test.tsx
pnpm build
```

Rollback point: no new frontend module/state exists; reverting backend availability returns the existing UI to disabled automatically.

## 7. Cross-Layer And Model-Backed Validation

- [ ] Run the full frontend and Rust suites.
- [ ] Run the configured restricted Native worker CTest suite.
- [ ] Download or reuse the exact Kotoba model through the production model manager.
- [ ] Run short Japanese audio end-to-end through bundled resource -> Tauri -> worker -> job snapshot -> ASS.
- [ ] Run >10-minute Japanese audio and verify completion, progress, non-empty UTF-8 text, ordered positive-duration audio-bounded segments and valid ASS.
- [ ] Verify cancel, offline cached rerun and one error path (for example missing/corrupt preprocessor).
- [ ] Verify installed and portable layouts when package artifacts/environment are available.
- [ ] Confirm the seven Faster-Whisper models remain independently supported and large-v3 remains default.
- [ ] Confirm package contents include no model weights, Python runtime/venv/sidecar, CUDA/Vulkan or VAD dependencies.

Full validation:

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm asr:runtime:verify
```

Manual/model-backed evidence must record the exact artifact/model identities and distinguish unexecuted checks from failures.

## 8. Documentation And Final Review

- [ ] Update README/CHANGELOG/notices only for behavior that actually shipped.
- [ ] Update `AGENTS.md` production support text from seven Faster-Whisper models to seven Faster-Whisper models plus the exact Native Kotoba CPU route, while retaining no-VAD/no-GPU/no-Python constraints.
- [ ] Update `.trellis/spec/tauri` and `.trellis/spec/frontend` only if implementation establishes a durable new contract; do not describe task-specific mechanics as global rules.
- [ ] Search production code/docs for stale claims that Kotoba is post-MVP unavailable or excluded from the CPU worker.
- [ ] Run `trellis-check` and resolve every verified issue.
- [ ] Perform the PRD convergence pass and verify every acceptance criterion has evidence.
- [ ] Ask the user for final functional acceptance; do not commit or archive without separate explicit authorization.

Search targets:

```text
kotoba-faster-whisper
route_not_built
HIKARU_ASR_MVP_CPU_RUNTIME
postMvpUnavailable
该引擎将在后续版本支持
engines == ["faster-whisper"]
hikaru-asr-windows-x64-cpu-v2
```

## Final Rollback Boundary

If Kotoba fails model-backed functional or packaging gates:

1. keep the exact model/cache and archived K2 evidence untouched;
2. restore Kotoba to visible/unavailable in Tauri/frontend;
3. restore the previous attested CPU artifact if the new artifact is implicated;
4. leave all seven Faster-Whisper routes, defaults, settings, projects and subtitles unchanged;
5. publish the concrete integration blocker without reopening K3/quality revision inside this parent.
