# Native ASR Child Roadmap Reprioritization Implementation Plan

> Status: implemented and independently checked. Execution was limited to planning artifacts and future planning-child creation; no future child was started and no production code was modified.

## Step 1 - Verify the frozen roadmap authority

- Re-read the archived native legacy reassessment JSON/handoff and current parent PRD/design/implement.
- Record the five model dispositions, pending T12 mappings, ordinary Faster-Whisper mandatory boundary and unchanged production routes.
- Confirm archived task paths are clean before editing.

Rollback point: no files changed.

## Step 2 - Reconcile the parent PRD

Update `.trellis/tasks/07-25-native-asr-migration/prd.md` with the smallest lossless edits:

- use archived Python baseline/reassessment paths as current forward authority;
- state that no latest native candidate is currently quality-qualified;
- adopt mandatory ordinary Faster-Whisper plus qualified-subset/visible-unavailable governance;
- add T06R/T08R requirement ownership;
- defer Parakeet P2/ReazonSpeech R3;
- replace fixed 18-child governance and acceptance language;
- revise stale Planning State claims without rewriting historical results.

Rollback point: restore only parent PRD edits.

## Step 3 - Reconcile parent design and task map

Update parent `design.md` and `implement.md`:

- add the quality-recovery topology and current authority;
- insert T06R after T06/T07 authority and T08R after T08;
- revise T11 final dependency to require T12 mapping;
- preserve T13 as provisional-only and T18 final rebuild owner;
- gate T14/T15 on T12/T13 plus accepted selected lanes;
- preserve T16 -> T17 -> T18 order;
- mark Parakeet/Reazon current candidates omitted/visible-unavailable;
- update rollout, parallel groups, Gate 2/3/4, completion checklist and parent review state;
- remove numeric child-count assumptions.

Do not modify archived child artifacts.

Rollback point: restore parent design/implement edits.

## Step 4 - Create the next planning batch

Run `task.py create` with `--parent 07-25-native-asr-migration --no-start` for exactly:

1. `native-asr-whisper-quality-revision` — T06R;
2. `native-asr-model-manager` — T12;
3. `native-asr-qwen3-aligner` — T11;
4. `native-asr-kotoba-quality-revision` — T08R;
5. `native-asr-cpu-runtime-package` — T13.

Use P2, assignee `zzx`, branch/base branch `dev-crisp-asr`. Do not create P2/R3 or T14–T18.

Immediately replace each child placeholder `prd.md` with a concise seed containing:

- goal and user/release value;
- authoritative predecessors and explicit dependency ordering;
- candidate/identity boundary;
- primary requirements;
- testable acceptance criteria;
- release claims forbidden before later gates;
- out-of-scope items.

Do not add `design.md`/`implement.md`, curate context, or start those children in this task; each child must undergo its own planning review.

Rollback point: remove the five directories with `task.py remove-subtask` plus filesystem cleanup only if no child was started or independently edited.

## Step 5 - Validate task topology

Assert with a stdlib Python check:

- parent `children` contains all prior entries plus the roadmap task and exactly one entry for each five new slugs;
- five new task JSON files parse, use `status=planning`, point to the correct parent and share the expected branch/base branch;
- each new PRD has no `TBD`/placeholder acceptance criteria;
- no directories exist for Parakeet P2, ReazonSpeech R3 or T14–T18;
- the current task remains `08-19-native-asr-roadmap-reprioritization` in `in_progress`, while all five new children remain `planning` and unstarted.

Run:

```bash
python ./.trellis/scripts/task.py validate 08-19-native-asr-roadmap-reprioritization
git diff --check
git status --short
```

Verify `git diff --name-only -- .trellis/tasks/archive` is empty.

## Step 6 - Independent planning review

Review parent and child artifacts against:

- archived `python-legacy-cuda-v1` reassessment;
- `.trellis/spec/asr/quality-guidelines.md`;
- no-rerun/no-history-rewrite contracts;
- ordinary Faster-Whisper mandatory route;
- subset-first visible/unavailable behavior;
- incremental task creation and explicit dependencies;
- no premature pack, settings, frontend or release claims.

Any inconsistency is fixed in planning artifacts before reporting completion.

## Validation Scope

No pnpm, Cargo, CTest, model download or native inference is required because no production implementation changes. JSON parsing, Trellis topology validation, stale-claim searches, archive immutability and diff checks are the applicable gates.

## Git Boundary

Do not commit, push, archive, start a child, or alter Git history unless the user gives a separate explicit instruction after reviewing the final roadmap changes.
