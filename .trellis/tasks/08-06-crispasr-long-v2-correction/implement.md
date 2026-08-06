# T03C CrispASR Long-v2 Correction Implementation Plan

## Dependencies

- Current private manifest and `long-v2.ass` under ignored `.asr-benchmark/`.
- Archived T01 historical manifest contract.
- Archived T03 tracked lock/report/evidence/tooling plus ignored raw/executable/model/runtime files.
- T08 corrected CTranslate2 reassessment and current comparator/vocalization policy.
- Parent native ASR migration current-authority documents.

## Execution Checklist

### 1. Freeze Correction Inputs

- [x] Add an active/archive-safe `.gitignore` rule for `08-06-crispasr-long-v2-correction/research/local/`.
- [x] Record old/current manifest, long ASS/audio/duration/dialogue, comparator, T03 lock/report/evidence/tool, executable/DLL/model/aligner, and all nine raw identities in `research/crispasr-long-v2-correction-lock.md`.
- [x] Preserve/copy the exact old manifest only under ignored local correction storage; validate SHA-256 `e4656b...`.
- [x] Freeze expected preview values and original T03 gates/dispositions without treating the preview as final evidence.
- [x] Hash archived T01/T03 tracked inputs before any implementation and record a post-run immutability comparison.

Rollback: remove only the new ignore rule, task-local lock, and ignored copies.

### 2. Validate Historical T03 Evidence

- [x] Add a task-local correction publisher that imports the archived `evidence_contract.py` invocation seam without depending on its old active-path root calculation.
- [x] Run the archived compiled `--validate-evidence` command for Parakeet, ReazonSpeech, and Qwen short/medium/long against the historical manifest and exact runtime/model inputs.
- [x] Require one common T03 input-lock/executable/DLL/CPU/module/PATH identity and exact per-route model/aligner roles.
- [x] Require completed Parakeet/Reazon rows, completed Qwen short, and failed Qwen medium/long with zero accepted timed output.
- [x] Prove historical long and current long-v2 share exact WAV hash/duration before reference remapping.

Rollback: delete the task-local validator/publisher; archived evidence remains unchanged.

### 3. Recompute Corrected Metrics And Dispositions

- [x] Import the current `scripts/asr-benchmark.py` implementation and validate current manifest `3c05c0eb...`.
- [x] Recompute Parakeet and Reazon short/medium/long-v2 plus Qwen short from retained segments.
- [x] Publish semantic and excluded-vocalization gaps separately while retaining excluded cues in CER.
- [x] Carry Qwen medium/long-v2 as validated unscored upstream blockers; do not create synthetic metrics or segments.
- [x] Preserve original T03 CPU RTF, cold wall, RSS, timeline/gap, Qwen timing, and segmentation-risk semantics.
- [x] Require exact preview reproduction at four decimals and unchanged dispositions: Parakeet `stop-revise`, Reazon `proceed-with-named-risks`, Qwen `stop-revise`.

Rollback: remove corrected local outputs; no inference result changes.

### 4. Add Determinism, Mutation, And Privacy Tests

- [x] Add focused tests for old/current manifest drift, WAV/ASS mapping, raw-role/hash drift, runtime/model identity drift, incomplete matrices, and metric/gate/disposition tampering.
- [x] Reject promotion or synthetic scoring of failed Qwen medium/long rows.
- [x] Run actual publication twice and require byte-identical JSON and Markdown.
- [x] Scan tracked output for absolute paths, transcript/reference text, speech intervals, token IDs, raw alignment entries, and private markers.
- [x] Verify every ignored raw SHA-256 in tracked evidence matches the selected file bytes.
- [x] Verify archived T01/T03 tracked source hashes remain unchanged.

Rollback: remove task-local tests and generated output only.

### 5. Publish Correction And Repair Current Authority

- [x] Publish `research/evidence/crispasr-long-v2-correction.json` and `research/crispasr-long-v2-correction-report.md`.
- [x] Write `research/crispasr-long-v2-handoff.md` with route dispositions, limitations, exact identities, and downstream boundaries.
- [x] Update parent current status/handoff sections with corrected T03 values while retaining explicitly historical old-manifest facts.
- [x] Repair parent T08 handoff artifact links to `.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/...`.
- [x] Update the ASR quality spec with an all-backend supersession requirement for reference-identity changes.
- [x] Audit active parent/spec/handoff files: no old manifest/`long-v1`/`long.ass` occurrence may act as current authority.

Rollback: revert parent/spec edits and delete the new correction handoff; historical archives remain untouched.

### 6. Full Validation And Handoff

- [x] Run benchmark self-check, current manifest validation, and benchmark unit tests.
- [x] Run the correction publisher test/mutation suite and byte-identical double publication.
- [x] Run task validation, `git diff --check`, active/archive `git check-ignore`, status/size/privacy scans, and no-staged-files check.
- [x] Confirm no frontend, Tauri, native worker, runtime/package, downloader, installer, settings, or model files changed.
- [x] Confirm no inference/build command ran and archived T01/T03 inputs remain byte-identical.
- [x] Run an independent `trellis-check` against identities, recomputation, dispositions, privacy, archive immutability, and parent authority. (Final read-only follow-up found no remaining blocker; reviewer command runner was unavailable, while parent executable evidence passed.)
- [x] Stop before commit unless the user separately and explicitly authorizes committing.

## Planned Files

```text
.gitignore
.trellis/spec/asr/quality-guidelines.md
.trellis/tasks/07-25-native-asr-migration/prd.md
.trellis/tasks/07-25-native-asr-migration/design.md
.trellis/tasks/07-25-native-asr-migration/implement.md
.trellis/tasks/07-25-native-asr-migration/research/t08-corrected-ct2-handoff.md
.trellis/tasks/07-25-native-asr-migration/research/t03c-crispasr-long-v2-handoff.md
.trellis/tasks/08-06-crispasr-long-v2-correction/research/crispasr-long-v2-correction-lock.md
.trellis/tasks/08-06-crispasr-long-v2-correction/research/publish_crispasr_long_v2_correction.py
.trellis/tasks/08-06-crispasr-long-v2-correction/research/test_publish_crispasr_long_v2_correction.py
.trellis/tasks/08-06-crispasr-long-v2-correction/research/evidence/crispasr-long-v2-correction.json
.trellis/tasks/08-06-crispasr-long-v2-correction/research/crispasr-long-v2-correction-report.md
.trellis/tasks/08-06-crispasr-long-v2-correction/research/crispasr-long-v2-handoff.md
.trellis/tasks/08-06-crispasr-long-v2-correction/research/local/*  # ignored
```

No product/runtime/native/frontend/Tauri files are planned.

## Validation Commands

```powershell
python scripts/asr-benchmark.py self-check
python scripts/asr-benchmark.py validate --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
python .trellis/tasks/08-06-crispasr-long-v2-correction/research/test_publish_crispasr_long_v2_correction.py
python ./.trellis/scripts/task.py validate .trellis/tasks/08-06-crispasr-long-v2-correction

git check-ignore -v .trellis/tasks/08-06-crispasr-long-v2-correction/research/local/probe.json
git diff --check
git status --short
```

The correction lock will contain exact original-validator commands for all nine T03 rows and deterministic publication commands after source hashes stabilize.

## Start Gate

Before `task.py start`:

- [x] User reviews/approves `prd.md`, `design.md`, and `implement.md`.
- [x] Preview metrics, no-inference boundary, archive immutability, Qwen unscored handling, and parent/spec repair are frozen consistently.
- [x] `implement.jsonl` and `check.jsonl` contain real relevant spec/research entries.
- [x] `task.py validate` and `git diff --check` pass.
- [x] No correction publisher, tracked evidence, parent/spec edit, or `.gitignore` change exists before activation.

## Stop Conditions

- Historical T03 raw/runtime/model identity cannot be validated exactly.
- Historical long WAV hash/duration differs from current long-v2 audio identity.
- Final current-comparator metrics do not reproduce the reviewed preview.
- Qwen correction would require synthetic segments/timing or invented quality metrics.
- The task would require inference rerun, native/product code changes, or archived report mutation.
- Tracked output cannot be sanitized or deterministic.

## Completion Gate

T03C completes when one identity-validated, deterministic long-v2 CrispASR supersession matrix covers every T03 authoritative row; route dispositions and risks are truthful; archived history is unchanged; parent current authority and T08 archive links are corrected; and independent review finds no remaining active reliance on the incorrect long reference.
