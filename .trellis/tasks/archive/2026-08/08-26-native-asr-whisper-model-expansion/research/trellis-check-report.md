# Trellis checkpoint review — Native Faster-Whisper model expansion

> Historical blocked checkpoint. Superseded by `host-integration-continuation.md` and `final-trellis-check-report.md`; `large-v2` is now enabled and accepted.

## Review result

**Checkpoint code review passed after fixes; task/release completion remains blocked.** No P0 was found. The P1 unsafe enablement was fixed by withholding `large-v2`; the task must remain `in_progress` because the PRD requires all six expansion models and `large-v2` has not passed its short or >10-minute functional gates.

## Findings and fixes

### P1 — `large-v2` was enabled before functional qualification

- Exact repository/revision/file identities are internally consistent, and the model loaded and completed one 498872 ms smoke. This rules out a basic manifest, vocabulary, Mel-shape, or model-load contract failure.
- The same released worker returned structured `invalid_generation` for the required 24102 ms input and failed the >10-minute gate, while the same smoke harness passed the other qualified models. This is not a smoke parser artifact; it is a released-worker functional compatibility defect/gap for `large-v2` generation/timestamp handling.
- The available sanitized evidence does not identify one concrete shared parser/generation correction that could be safely implemented and then satisfy the mandatory runtime revision/requalification rule. A model-name branch or suppressed error would be unsafe.
- **Fixed:** removed only the `large-v2` manifest row, restored `faster-whisper/large-v2` to `postMvpUnavailable`, and updated availability tests so it remains visible but disabled. Existing downloaded model data is untouched. The five passing new models plus `large-v3` remain manifest-backed.
- Native request preflight remains generic over the Faster-Whisper engine; the manifest/model manager remains the single support authority, so no second model registry was introduced.

### P1 review — concurrent managed-directory creation

- The different-model download test exposed a legitimate `AlreadyExists` race while creating shared parent directories.
- The fix accepts only `AlreadyExists`, immediately re-reads the created/colliding entry using `symlink_metadata`, and rejects reparse/symlink-like or non-directory entries before descending. Successful creation is now revalidated through the same check as the concurrent branch.
- The focused concurrent test proves independent job IDs, terminal engine/model/revision identity, and successful publication for both models.
- Residual security note: the existing component-by-component path walk is metadata-based rather than Windows handle-pinned, so it does not claim protection from a malicious cross-process swap after validation. The change does not weaken the existing contract; handle-relative Windows traversal would be the upgrade if elevated hostile-race hardening becomes a requirement.

### P1 hygiene — activation artifact whitespace

- Normalized activation-introduced CRLF/trailing whitespace in the changed task artifacts.
- `git diff --check` now passes.

## Changed files in the shared working tree

- `.trellis/tasks/08-26-native-asr-whisper-model-expansion/check.jsonl`
- `.trellis/tasks/08-26-native-asr-whisper-model-expansion/implement.jsonl`
- `.trellis/tasks/08-26-native-asr-whisper-model-expansion/implement.md`
- `.trellis/tasks/08-26-native-asr-whisper-model-expansion/prd.md`
- `.trellis/tasks/08-26-native-asr-whisper-model-expansion/research/planning-evidence.md`
- `.trellis/tasks/08-26-native-asr-whisper-model-expansion/task.json`
- `src-tauri/resources/native-asr-models.json`
- `src-tauri/src/asr.rs`
- `src-tauri/src/asr_models.rs`
- `src/constants/asr.test.ts`
- `src/hooks/useAsrAvailability.test.tsx`

## Tests added or updated

- Exact immutable manifest closure for the six currently enabled rows (`tiny`, `base`, `small`, `medium`, `large-v3`, `large-v3-turbo`).
- Explicit `large-v2` deferred classification while other non-MVP engines remain deferred.
- Text/JSON vocabulary readiness and cross-model managed-path/readiness isolation.
- Concurrent different-model download/publication and terminal identity isolation.
- Generic Faster-Whisper CPU request preflight without a second support registry.
- Seven-option frontend registry with unchanged `large-v3` default.
- Availability projection: five qualified new rows and `large-v3` enabled/downloadable; `large-v2` visible and disabled with a reason.

## Verification

Passed:

- Focused manifest identity test.
- Focused concurrent different-model download test after the directory-race fix.
- Focused Native request preflight test.
- Focused frontend constants and availability tests.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib asr_models::tests`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib asr::tests`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib asr_worker::tests`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm test`
- `pnpm build` (existing chunk-size advisory only)
- `pnpm asr:runtime:verify` — released archive identity unchanged and verified.
- Targeted `rustfmt --check` for both changed Rust files.
- Trellis task validation.
- `git diff --check`.
- No staged files; no untracked review artifact remains in the repository.

Not completed in this checkpoint:

- Native CTest could not be started because `ctest` is unavailable on the current command PATH.
- No new real-model smoke, installed/portable package smoke, or package rebuild was run. Runtime bytes were not changed, and `large-v2` was intentionally withheld rather than represented as qualified.

## Unresolved blocker and residual risks

- **Release blocker:** the task requires all six expansion models, but `large-v2` remains unavailable until it passes both the 24102 ms short smoke and the Japanese >10-minute smoke with legal output.
- A future worker change invalidates the current runtime identity evidence and requires a new reproducible runtime revision, CTest, all seven model smokes, full `large-v3` regression, installed/portable qualification, package rebuild/audit, and refreshed hashes/licenses/evidence.
- The five newly enabled models have released-worker short-smoke evidence from the implementation handoff, but installed/portable model expansion smoke remains outstanding.

## Exact next action

Run the existing model-backed C++ diagnostic harness against exact `large-v2` and the 24102 ms failing input to capture only the failing window's sanitized generation/timestamp trace and precise parser failure (no transcript text). Turn that concrete failure into a shared-behavior regression in `ctranslate2_whisper_tests.cpp`; fix the generic generation/fallback/timestamp path without checking the model name. Then freeze/rebuild a reproducible runtime revision and run all seven short smokes, the `large-v2` >10-minute smoke, `large-v3` regression/cancel/recovery, Native CTest, full Rust/frontend/build gates, and installed/portable package qualification before restoring the `large-v2` manifest row.
