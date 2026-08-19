# Native ASR Legacy Quality Re-evaluation Implementation Plan

> Status: implemented and independently checked on 2026-08-19. This task reused frozen historical evidence only and did not run native inference.

## Preconditions

- `python-legacy-cuda-v1` baseline and model identity manifest remain byte-identical to the archived authority.
- Current benchmark manifest is `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` with short-v1/medium-v1/long-v2.
- Archived ignored evidence listed in `research/evidence-inventory.md` exists locally.
- No implementation step may edit archived task files or start a native worker/model run.

## Step 1 - Freeze the native evidence input lock

Create `research/native-evidence-lock.json` with exactly five candidates:

1. large-v3 Candidate A;
2. Kotoba K2;
3. Parakeet P1;
4. ReazonSpeech R2;
5. Qwen T03C.

For every candidate/case:

- record authoritative tracked publication/handoff path and SHA-256;
- record ignored source path, SHA-256 and expected schema/status;
- bind candidate/model/companion/worker/runtime/device/input-lock identities available from the original publication;
- record current model-mapping state from the legacy identity manifest;
- reject superseded candidates and the six excluded Whisper models.

Rollback point: remove the lock; no historical files changed.

## Step 2 - Implement the task-local publisher

Add stdlib-only `research/publish_native_legacy_quality.py`.

Responsibilities:

- load and validate the evidence lock;
- validate baseline, identity manifest, benchmark manifest, T01 runner and legacy publisher authorities;
- validate archived tracked and ignored source hashes before reading result content;
- explicitly adapt the five known historical schemas without a plugin/factory abstraction;
- normalize all 15 expected slots to completed, validated-failed, unaccepted/unscored or invalid;
- recompute completed row metrics through `scripts/asr-benchmark.py`;
- compare each relative quality metric against the exact Python row;
- preserve Qwen provenance and failed-case boundaries;
- apply pending-T12 mapping rules without modifying the model identity manifest;
- output versioned deterministic JSON and render Markdown from that JSON;
- emit a concise downstream handoff.

Prefer importing and reusing helpers from `scripts/asr-legacy-baseline.py`. Modify that shared script only if a concrete contract defect prevents correct historical comparison; any such change requires focused regression tests and must not broaden this task into a generic framework.

Rollback point: remove the task-local publisher and generated outputs.

## Step 3 - Add focused tests

Add `research/test_publish_native_legacy_quality.py` using synthetic fixtures only.

Required coverage:

- all five adapter kinds;
- exactly 5 models × 3 cases, with no silent missing/duplicate slots;
- same-model/same-case/profile pairing;
- per-metric lower-or-equal comparison and no averaging;
- completed row recomputation ignoring mutable precomputed metrics;
- validated native failure produces no synthetic CER/gap/timing;
- Qwen eligible/ineligible ForcedAligner timing;
- pending T12 mapping preserves observed deltas but blocks final qualification;
- large-v3 does not unlock Whisper family without large-v2;
- independent structural failure remains `stop-revise` even if observed relative text metrics improve;
- candidate/model/companion/case/profile/raw hash/failure fingerprint mutation rejection;
- deterministic JSON/Markdown generation;
- tracked privacy/path scan.

Rollback point: remove task-local tests with the publisher.

## Step 4 - Publish the actual reassessment

Run the publisher against the archived authority and existing ignored evidence to create:

- `research/evidence/native-asr-legacy-quality-reevaluation.json`;
- `research/native-asr-legacy-quality-reevaluation.md`;
- `research/native-asr-legacy-quality-handoff.md`.

Review the output for:

- all 15 expected slots;
- Python/native/delta/direction/provenance for every completed metric;
- explicit native failure rows with no invented metrics;
- old disposition → observed legacy-relative disposition → identity-aware disposition;
- explicit `not-decided-by-this-task` release boundary;
- no subtitle text, raw segments, absolute paths or private media/model/log content.

Run generation twice into separate temporary outputs and require byte equality before replacing tracked artifacts.

Rollback point: delete generated task artifacts; source historical evidence remains intact.

## Step 5 - Update forward-looking parent state

Update only `.trellis/tasks/07-25-native-asr-migration/{prd.md,design.md,implement.md}` and/or its research handoff where necessary to:

- cite the new reassessment authority;
- record the new status for the five scoped models;
- preserve Whisper large-v2/family incompleteness;
- preserve T11 Qwen productization and T12 mapping requirements;
- keep T14/T15/T18 release gates unchanged;
- avoid rewriting archived T03C/T06/T08/T10/T10R conclusions.

If no design requirement changes beyond evidence status, prefer the smallest parent-artifact edit rather than repeating the full report.

Rollback point: restore only the parent forward-reference edits.

## Step 6 - Validation

Run focused validation:

```bash
python scripts/asr-benchmark.py self-check
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
python -m unittest discover -s asr-service/tests -p "test_asr_legacy_baseline.py"
python .trellis/tasks/08-19-native-asr-legacy-quality-reevaluation/research/test_publish_native_legacy_quality.py
python ./.trellis/scripts/task.py validate 08-19-native-asr-legacy-quality-reevaluation
git diff --check
```

Run deterministic publication twice and compare bytes. Run privacy scans over all new tracked artifacts and confirm each archived/current `research/local/` raw path remains ignored.

Because no production/frontend/Rust/native-worker implementation is changed, `pnpm build`, Cargo tests and native CTest are not required unless implementation unexpectedly touches those layers. If the shared benchmark/legacy publisher changes, additionally run the full relevant Python test set and explain why.

## Step 7 - Independent review gate

Before completion, review against:

- `prd.md` acceptance criteria;
- `.trellis/spec/asr/quality-guidelines.md`;
- the archived Python legacy baseline contract;
- no-rerun decision;
- historical artifact immutability;
- pending T12 and Qwen T11 boundaries;
- privacy and deterministic evidence requirements.

Any missing/mutated raw evidence is a blocker, not permission to rerun inference. Keep the task in progress and report the exact unavailable slot.

## Completion And Git Boundary

The task is complete only when all checks pass and the parent forward-looking state cites the deterministic handoff. Do not run `git commit`, archive the task, or alter Git history unless the user gives a separate explicit instruction.
