# ReazonSpeech R2 implementation plan

> Status: final-check fixes and complete reacquisition are complete under `R2-vad12-pad30-overlap-top-level-v1`: `stop-revise + better-than-r1`. The generic T09/T10 CrispASR decoder is restored, R2 Step 6 uses a separate required manifest/lane decoder, and long-v2 retains the exact reviewed `zero_duration_top_level_result` fingerprint on its 62nd attempt (zero-based window `61`) after 61 completed calls. Release/default and the Reazon native route remain unchanged.

## Preconditions

- Completed T10 R1 evidence is immutable baseline authority.
- T09 `parakeet-family: development-gpu-ready` remains the development device input, not formal GPU qualification.
- Primary candidate is `R2-vad12-pad30-overlap-top-level-v1`; no secondary candidate is pre-authorized.
- User-reviewed relaxation: preserve official/default `speechPadMs=30`; `12000ms` is the unpadded VAD/rechunk core cap, while direct-ABI inference windows may be at most `12060ms` and overlap only adjacent windows by at most the native final-padding bound of `60ms`.
- Release/default remains Python legacy and Reazon native route remains disabled throughout.
- Models, VAD assets, audio, binaries, build trees, raw results, stderr and absolute paths stay under this task's ignored `research/local/`.

## Step 1 — Freeze the source-only oracle

- [x] Add tracked stdlib `research/run_r2_oracle.py` and `research/publish_r2_oracle.py`; they use `ctypes` and the shared T01 comparator, not the CrispASR CLI dispatcher or product worker.
- [x] Create tracked `research/oracle-lock.md` plus ignored `research/local/oracle-input.json`. The lock binds pinned source/submodules, DLL, Q8_0 model, canonical Silero VAD, short/medium audio, comparator, CUDA device/modules/PATH and the ignored input-file hash.
- [x] Verify all locked identities, open one CUDA Reazon session, call `crispasr_vad_slices` with exactly `0.5 / 250ms / 100ms / 30ms / 12s`, then call `crispasr_session_transcribe_lang` exactly once per returned padded window.
- [x] Bind the narrow overlap relaxation: monotonic starts/ends, audio bounds, positive duration, unpadded core cap `12000ms`, padded inference cap `12060ms`, adjacent native-padding overlap `<=60ms`, no non-adjacent overlap.
- [x] Freeze exact single-pass dispatch by clearing inherited `CRISPASR_PARAKEET_*`, setting `CRISPASR_PARAKEET_STREAM_THRESHOLD=13` and `CRISPASR_SESSION_UNIFIED_DISPATCH=0`, rejecting windows above `192960` samples, and allowing no reactive streamed fallback.
- [x] Refuse clamp, ownership rewrite, dedup, stitching, `transcribe_vad`, gap-fill, caller-created overlap, decoder/beam search, punctuation splitting, alternate VAD settings or reference/Python repair.
- [x] Record VAD window boundaries/overlap, call count, maximum window duration and one top-level result per call, so the report proves the oracle matches primary shape.
- [x] Run short-v1 and medium-v1 under one frozen identity, adapt through the shared T01 comparator and publish only sanitized aggregate metrics/shape in `research/oracle-report.md`.
- [x] Classify the oracle as `promising | not-promising`; do not publish `qualified`, `stop-revise` or `better-than-r1` from the partial/non-worker probe.
- [x] Gate result: `promising`; short CER/gaps `0.266667 / 1`, medium `0.295385 / 19`, zero timeline errors. Stop here and return to user review before Step 2/product implementation.

Executable commands:

```bash
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_r2_oracle.py --config .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/oracle-input.json --case short-v1 --output .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/oracle/short-v1.json
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_r2_oracle.py --config .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/oracle-input.json --case medium-v1 --output .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/oracle/medium-v1.json
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/publish_r2_oracle.py --config .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/oracle-input.json --raw-root .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/oracle --output .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/oracle-report.md
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/test_publish_r2_oracle.py
python scripts/asr-benchmark.py validate --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark
python scripts/asr-benchmark.py self-check
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
git check-ignore .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/.ignore-sentinel
```

Rollback: delete only tracked oracle runner/lock/report and ignored oracle config/raw files; no product code exists.

## Step 2 — Freeze the formal R2 identity

Only after a promising oracle **and separate user approval to continue beyond the current stop point**:

- [x] Create `research/r2-input-lock.md` with exact source/submodule/toolchain/worker/runner/runtime/model/VAD/audio/manifest/comparator/device/module/PATH identities.
- [x] Pin candidate constants: Silero threshold `0.5`, minimum speech `250ms`, minimum silence `100ms`, speech pad `30ms`, core cap `12000ms`, padded inference cap `12060ms`, adjacent native-padding overlap `<=60ms`, no non-adjacent overlap/ownership/dedup, one top-level cue per window, Q8_0, 96/15000 caps.
- [x] Freeze short `1 cold + 3 warm`, medium `1 fresh`, long-v2 `1 fresh`, complete-matrix policy and R1 relative thresholds.
- [x] Create/verify ignored `research/local/{build,models,vad,audio,raw,stderr,oracle}` roots for active and prospective archive spellings.
- [x] Generate ignored `research/local/r2-worker-init.cmake`, bind its SHA-256 in the lock, and require it to set exactly: `CMAKE_BUILD_TYPE=Release`, `HIKARU_ASR_BUILD_CT2_WORKER=ON`, `HIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=ON`, `HIKARU_ASR_CRISPASR_RUNTIME_FILE`, `HIKARU_ASR_CRISPASR_RUNTIME_SIZE`, and `HIKARU_ASR_CRISPASR_RUNTIME_SHA256`.
- [x] Verify the pinned runtime exports `crispasr_vad_slices` and `crispasr_vad_free`; a missing export returns to planning rather than adding another VAD implementation.
- [x] Plan the smallest `native-asr/CMakeLists.txt` change that adds `T10R_LOCAL_ROOT` to the existing development runner's canonical local-root allowlist; do not replace the T09/T10 roots.

Validation:

```bash
python scripts/asr-benchmark.py validate --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark
git check-ignore .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/.ignore-sentinel
```

Rollback: delete the formal lock/local inputs; no product code yet.

## Step 3 — Add the narrow backend VAD seam

- [x] Bind only `crispasr_vad_slices` and `crispasr_vad_free` in the existing `Api` loader; retain fail-closed export/ABI checks.
- [x] Add one concrete Reazon-only VAD-window method on `CrispAsrBackend`; do not add an interface/factory/provider layer.
- [x] Validate the fixed VAD asset identity before detection.
- [x] Run VAD on backend-owned 16 kHz PCM with frozen primary parameters.
- [x] Convert spans to deterministic millisecond `AudioWindow` values once; reject empty/no-speech, non-finite, reversed, non-monotonic, out-of-audio, `>12060ms`, adjacent overlap `>60ms` or any non-adjacent overlap.
- [x] Free the upstream span buffer exactly once on success/error.
- [x] Keep existing `transcribe_window` and session lifecycle unchanged.
- [x] Extend fake ABI/backend tests for success, missing/invalid asset, ABI-declared negative return, indistinguishable empty result using one conservative stable error, later failure, bad spans, exact free/reset/result/session counts and same-session non-contiguous calls.

Validation:

```bash
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release -R "protocol|crispasr-backend-core" --output-on-failure
```

Review gate: no fallback to fixed R1 windows, no product config surface, no second VAD runtime.

Rollback: remove the two bindings/method/tests; current R1/T09 behavior remains.

## Step 4 — Generalize only Reazon policy input shape

- [x] Keep Parakeet P1's contiguous 15-second policy and tests byte-for-byte in behavior.
- [x] Let Reazon accept ordered VAD windows with silence gaps and adjacent ABI-native padding overlap `<=60ms`; require monotonic starts/ends, no non-adjacent overlap, every window within audio and `<=12060ms`.
- [x] For each Reazon window require exactly one legal non-empty top-level source segment.
- [x] Preserve source text byte-for-byte; validate UTF-8, audio bounds, positive timing, 96 code points and 15000ms.
- [x] Require non-empty final output and selected-text/final-text conservation.
- [x] Add focused tests for gapped windows, final short slice, multiple/zero source segments, invalid UTF-8/ranges, cap boundaries and Parakeet isolation.

Validation:

```bash
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release -R "parakeet-family-policy|protocol" --output-on-failure
```

Review gate: no official subword decoder, punctuation splitter, caller-created overlap, ownership rewrite, dedup, clamp or synthetic duration in primary.

Rollback: restore Reazon contiguous validation; Parakeet stays unchanged.

## Step 5 — Wire Reazon R2 into the worker atomically

- [x] Select R2 only in the Reazon development/evidence lane; Parakeet and Qwen retain current paths.
- [x] Add only the `T10R_LOCAL_ROOT` compile definition/runner containment branch needed for this task's ignored evidence; preserve T09/T10 root checks.
- [x] Resolve the fixed task-local/sibling VAD asset before `ready`; missing/invalid asset fails pre-ready.
- [x] After `ready`, detect VAD windows, transcribe sequentially on one session and collect `WindowResult` values.
- [x] Suppress all raw upstream segment previews.
- [x] Emit monotonic worker-owned progress at completed VAD-window endpoints; silence gaps do not create fake transcript cues.
- [x] Run Reazon policy, validate/serialize the complete replacement with the existing `Emitter`, emit exactly one `segmentsReplace`, then `completed`.
- [x] Any VAD/backend/policy/protocol failure before replacement emits one error and leaves zero accepted output.
- [x] Extend fake-worker contract tests; keep Qwen strict error, Parakeet P1, VAD/Vulkan/default-off and CT2 behavior unchanged.

Validation:

```bash
cmake -S native-asr -B .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/build/windows-x64-r2-worker -G Ninja -C .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/r2-worker-init.cmake
cmake --build .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/build/windows-x64-r2-worker --config Release
ctest --test-dir .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/build/windows-x64-r2-worker -C Release -R "crispasr|parakeet-family|worker" --output-on-failure
```

Review gate: event ordering, zero partial recovery, VAD asset/input identity and route isolation.

Rollback: disable R2 dispatch and restore current disabled R1 branch.

## Step 6 — Prove Rust-host lifecycle behavior

- [x] Reuse existing launch/recovery/gate/cancel helpers; add only test inputs necessary for the R2 VAD asset.
- [x] Cover Reazon R2 success: ready -> progress* -> one replacement -> completed; recovery JSON/ASS contains only final policy cues.
- [x] Cover missing VAD pre-ready failure and post-ready VAD/policy failure with zero accepted segments.
- [x] Cover cancellation during multi-slice inference, process-tree reap within the existing two-second cancellation bound, active gate release and zero partial recovery.
- [x] Keep production host structures and product commands unchanged.

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_worker::tests -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --release --manifest-path src-tauri/Cargo.toml
```

Rollback: remove R2-only test inputs/cases; production host remains unchanged.

## Step 7 — Implement R2 acquisition and publisher

- [x] Add stdlib-only task-local acquisition using the final locked worker/runtime and atomic ignored raw JSON writes.
- [x] Record VAD window boundaries/hashes, source/final shape, timing, performance, RSS, modules, PATH and structured failure provenance; raw text remains ignored.
- [x] Add sanitized raw-index generation binding every required attempt role/size/SHA-256. Step 8 generated the final tracked index from all six formal rows.
- [x] Recompute CER/timeline/semantic/excluded gaps through the shared T01 comparator.
- [x] Recompute cue count/code-point/duration/overlap distributions, text conservation, replacement bytes and partial/full RTF labels.
- [x] Recompute `qualityDisposition`, `relativeSelection` and `relativeReasons`; do not trust labels stored in raw data.
- [x] Mutation tests reject R1 threshold, identity, VAD/config/window/overlap, raw hash/path, roles/counts, status/event order/progress, metric/RTF and result-promotion drift.
- [x] Determinism tests generate JSON twice and require byte-identical output; the formal JSON/Markdown/handoff double-run remains a Step 8 post-acquisition gate.

Implemented tracked tools:

```text
research/r2-input-lock.md
research/run_reazonspeech_r2.py
research/publish_reazonspeech_r2.py
research/test_publish_reazonspeech_r2.py
```

Generated by the Step 8 matrix:

```text
research/r2-raw-index.json
research/evidence/reazonspeech-r2.json
research/reazonspeech-r2-report.md
research/reazonspeech-r2-handoff.md
```

Exact preparation/dry validation:

```bash
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py prepare
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py dry-run --case short-v1
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/test_publish_reazonspeech_r2.py
```

Step 8 acquisition roles:

```bash
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py acquire --case short-v1 --run-kind cold --repeat-index 0
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py acquire --case short-v1 --run-kind warm --repeat-index 1
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py acquire --case short-v1 --run-kind warm --repeat-index 2
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py acquire --case short-v1 --run-kind warm --repeat-index 3
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py acquire --case medium-v1 --run-kind measured --repeat-index 0
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_reazonspeech_r2.py acquire --case long-v2 --run-kind measured --repeat-index 0
```

Publication command (run twice after all roles exist and compare all outputs byte-for-byte):

```bash
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/publish_reazonspeech_r2.py --build-index --raw-index .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/r2-raw-index.json --evidence-output .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/evidence/reazonspeech-r2.json --report-output .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/reazonspeech-r2-report.md --handoff-output .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/reazonspeech-r2-handoff.md
```

Rollback: remove R2 acquisition/publication tooling and ignored `research/local/formal/`; T10 R1 evidence remains immutable.

## Step 8 — Run the complete primary matrix

- [x] Rebuild final runner/worker after all source simplifications and freeze final hashes before acquisition.
- [x] Run short-v1 as one cold + three warm fresh processes.
- [x] Run medium-v1 once in a fresh process regardless of short quality result.
- [x] Run long-v2 once in a fresh process regardless of short/medium quality results.
- [x] Repair and rerun any invalid identity/input/runtime/harness/incomplete-trace row; retain identity-valid candidate-caused structured failures.
- [x] Publish per-case CER, semantic/excluded gaps, timeline, cue distribution, RTF/RSS, completion/failure and R1 delta.
- [x] Publish absolute `qualified | stop-revise` and relative `better-than-r1 | no-material-improvement` independently.

Final result: `stop-revise + better-than-r1`. Short/medium completed with CER/gaps `0.266667 / 1` and `0.295385 / 19`; long-v2 passed the 354-window VAD plan, completed 61 calls, then its 62nd attempt (zero-based window `61`, `[763590,768570]ms`) retained the exact reviewed `zero_duration_top_level_result` fingerprint `35b1f992ca3619d7e985ee3e9bb33f01280bed48829766bafbe01ee1892dc93e`. Medium CER improves by `0.081758` absolute with no new anti-regression. Raw index SHA-256: `ac860d5a44725158505db3568588dff500d112b69fe601e8d8fe34d798e81ed6`.

Primary decision:

```text
qualified + better-than-r1
  -> accepted Reazon algorithm input; route still disabled until downstream qualification

stop-revise + better-than-r1
  -> retain as preferred development basis; no T14/T15 accepted input

stop-revise + no-material-improvement
  -> discard primary and return to planning
```

## Step 9 — Stop or return to planning

- [x] The corrected handoff and parent map record `stop-revise + better-than-r1`: preferred development basis only, no accepted T14/T15 input.
- [x] The false `961`-sample blocker was removed by canonicalizing ABI endpoints to integer milliseconds once and deriving samples as `ms * 16`; the real `522930 / 522870` boundary is legal at `60ms`, while `61ms` and `12061ms` negatives remain fail-closed.
- [x] Inspect ignored evidence only to classify the residual blocker: long-v2 completes 61 calls, then the 62nd attempt—zero-based window `61`, `[763590,768570]ms`—returns local zero-duration range `2160..2160ms`. The result-trace SHA-256 is `f3179c7ab489bfcc211b4779fa15fb481354850dd08cbf2286b64c00f13c45bb` and the independently derived fingerprint is `35b1f992ca3619d7e985ee3e9bb33f01280bed48829766bafbe01ee1892dc93e`.
- [x] The blocker is not one or more `>=1000ms` uncovered spans inside valid VAD slices, so `R2-vad12-gapfill-v1` is not proposed or implemented; any new identity requires user review.
- [x] Do not implement F16, official subword decoder, beam/MAES, caller-created overlap/LCS or pin upgrade in this task without a new planning/review cycle; the frozen adjacent ABI-padding overlap remains the only exception.

Rollback: no secondary candidate is created automatically.

## Step 10 — Full-scope validation and handoff

Implementation-agent validation is complete: the independently reconfigured protocol-only preset plus CT2 CPU, CT2 CUDA-development and task-local R2 CTest lanes passed; Rust `216/216`; frontend `105 files / 830 tests`; `pnpm build`; benchmark self-check/manifest/24 focused tests; 18 publisher tests; 5 Step 6 publisher tests; task validation; active/archive ignore checks; tracked privacy scan; deterministic publication; no staged files; and `git diff --check` all passed. The manifest retains the pre-existing `low-volume` coverage warning, and Vite retains the pre-existing large-chunk warning. Final independent `trellis-check` remains a main-session gate.

Required native lanes:

```bash
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release --output-on-failure

cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release
ctest --preset windows-x64-ct2-release --output-on-failure

cmake --preset windows-x64-ct2-cuda-development
cmake --build --preset windows-x64-ct2-cuda-development
ctest --preset windows-x64-ct2-cuda-development --output-on-failure

cmake --build .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/build/windows-x64-r2-worker --config Release
ctest --test-dir .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/local/build/windows-x64-r2-worker -C Release --output-on-failure
```

Host/product/benchmark/task gates:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --release --manifest-path src-tauri/Cargo.toml
pnpm test
pnpm build
python scripts/asr-benchmark.py self-check
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/test_publish_reazonspeech_r2.py
python ./.trellis/scripts/task.py validate .trellis/tasks/08-14-native-asr-reazonspeech-r2
git diff --check
```

Also verify:

- active/archive `research/local/` ignore coverage;
- tracked privacy scan contains no transcript text, user-absolute path, media/model/VAD bytes, stderr, credentials or binaries;
- deterministic publication double-run;
- no Parakeet/Qwen/frontend/downloader/settings/installer/portable/runtime-pack/release-route change;
- no staged files;
- final independent `trellis-check` has no blocking findings.

## Rollback points

1. Oracle: remove probe only; no code.
2. Backend VAD seam: remove two ABI bindings/method/tests.
3. Policy: restore current Reazon contiguous R1 behavior.
4. Worker: disable R2 branch; keep T09/T10 safety contracts.
5. Rust tests: remove test-only R2 inputs.
6. Evidence: invalidate/delete R2 rows/publication; preserve R1.
7. Relative improvement without qualification: retain evidence only, keep route disabled.

## Commit boundary

No commit, push, merge, rebase or reset is authorized by approval of this plan. After implementation and checks, present changes and ask separately whether the user wants commits.
