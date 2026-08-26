# Native ASR Release-First Reprioritization Plan

> Status: implemented and independently checked. The user confirmed and authorized the `faster-whisper / large-v3 / CPU-only` MVP roadmap and the immediate post-MVP P1 Faster-Whisper model expansion. No product code, archived task artifact, child implementation or Git history was changed.

## Step 1 - Confirm the MVP product boundary

Confirmed decision:

- Windows x64;
- bundled CPU runtime;
- only `faster-whisper / large-v3` enabled for the first Native release;
- Candidate A reused with known quality limitations;
- no GPU packs, large-v2 anchor or optional engines in the release gate.

Rollback point: no parent/child artifacts changed beyond this task's planning files.

## Step 2 - Rewrite parent release governance

Update `.trellis/tasks/07-25-native-asr-migration/{prd.md,design.md,implement.md}`:

- make earliest safe Native release the primary goal;
- split Native MVP from post-MVP expansion;
- remove Python-quality non-regression, dual Whisper anchor and GPU qualification as MVP blockers;
- retain protocol, timeline legality, non-empty output, path/security, cancel/recovery, model integrity, packaging and license gates;
- reinterpret Candidate A prospectively as `mvp-eligible-with-known-quality-limitations` without changing archived evidence;
- change the critical path to `(T12 + T13) -> T16 -> T17 -> T18`, with T12 and T13 parallel;
- defer T08R/T11/Parakeet/Reazon/T14/T15 and other Whisper models;
- update acceptance criteria, rollout, task map, dependency graph and review checklist consistently.

Rollback point: restore only the three parent planning documents.

## Step 3 - Reprioritize task metadata

Update planning task metadata:

- parent `07-25-native-asr-migration`: P1, release-first description;
- T12 `08-20-native-asr-model-manager`: P1;
- T13 `08-20-native-asr-cpu-runtime-package`: P1 and final-MVP package wording;
- T08R `08-20-native-asr-kotoba-quality-revision`: P3;
- T11 `08-20-native-asr-qwen3-aligner`: P3;
- `08-26-native-asr-whisper-model-expansion`: P1, first task after T18.

Do not change archived task metadata.

Rollback point: restore the five planning `task.json` files.

## Step 4 - Update current planning child PRDs

### T12

- make exact large-v3 CT2 delivery/readiness the MVP requirement;
- preserve manifest/download architecture for future entries;
- move remaining CT2/GGUF/Qwen pair completion to post-MVP acceptance rather than first-release blocking.

### T13

- promote from provisional-only to final bundled CPU runtime artifact owner for the large-v3 MVP;
- omit optional CrispASR/GPU/rejected candidate capabilities from the first artifact;
- make T18 consume and verify the T13 artifact instead of rebuilding from optional engines.

### Faster-Whisper model expansion

- create a dedicated P1 planning child covering `tiny/base/small/medium/large-v2/large-v3-turbo`;
- place it immediately after T18 and before all other post-MVP engine/GPU work;
- reuse the released CT2 CPU route and use functional gates rather than Python parity.

### T08R and T11

- retain technical quality goals;
- label explicitly post-MVP and non-blocking;
- schedule them after the Faster-Whisper expansion;
- remove wording that makes their accepted handoff a prerequisite for T14/T18 MVP release.

Rollback point: restore only the four planning child PRDs.

## Step 5 - Update task creation order

Parent plan should create next:

1. T12 and T13 implementation planning/activation;
2. T16 runtime/settings backend after their contracts stabilize;
3. T17 frontend migration;
4. T18 release cutover;
5. P1 `08-26-native-asr-whisper-model-expansion` immediately after T18;
6. T08R/T11/Parakeet-Reazon/T14-T15 afterwards.

Do not create T14/T15 before the Native MVP and Faster-Whisper expansion. Do not create another Whisper quality/discovery task.

## Step 6 - Validate planning consistency

Run planning-only checks:

```bash
python ./.trellis/scripts/task.py validate 08-25-native-asr-release-first-reprioritization
python - <<'PY'
import json
from pathlib import Path
for path in Path('.trellis/tasks').glob('*/task.json'):
    json.loads(path.read_text(encoding='utf-8'))
print('task json ok')
PY
git diff --check
git status --short
```

Also assert:

- archived task diff is empty;
- parent docs no longer describe quality parity/GPU qualification/large-v2 as MVP blockers;
- T16 dependency is T12 + T13 rather than T15;
- the P1 Faster-Whisper expansion child exists once, is parent-linked, covers all six remaining models and is ordered immediately after T18;
- T08R/T11 are P3 and follow the Whisper expansion;
- no product code or specs changed.

## Step 7 - Independent planning review

Review the final diff for:

- one consistent MVP route;
- no accidental weakening of path/security/cancel/recovery/license/timeline legality;
- no hidden or silent Python fallback;
- no contradiction between parent PRD/design/implement and child PRDs/task metadata;
- no historical evidence rewrite or premature implementation claim.

## Git Boundary

Do not commit, push, archive, start implementation children or alter Git history without a separate explicit user instruction.
