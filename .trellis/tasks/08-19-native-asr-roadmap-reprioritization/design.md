# Native ASR Child Roadmap Reprioritization Design

## Summary

本任务把父任务从“按旧候选结果顺序进入 T11～T18”调整为“质量恢复 + 模型身份并行，之后再包装和集成”。它是一次 Trellis planning topology migration：更新父任务的权威状态、task map、gate 和完成条件，并建立下一批五个 planning children；不改变任何运行时代码或历史证据。

## Current Problem

```text
old parent interpretation
  Candidate A/K2 old absolute gates looked acceptable
  -> T11/T12/T13
  -> T14/T15 packs
  -> T16/T17/T18 integration

current authority
  all five latest native candidates observed stop-revise
  + three Crisp mappings pending T12
  -> no accepted final engine input exists
```

若不重排，T14/T15 和 UI/backend integration 会在没有 accepted quality input 时提前开始，形成 pack identity、qualification metadata 和 UI 合同反复返工。

## Target Roadmap

```text
                    ┌─ T06R Whisper quality revision ───────────────┐
archived authority ─┼─ T08R Kotoba K3 quality revision ─────────────┤
                    ├─ T12 native model manifest/downloader ──┐     ├─ accepted selected lanes
                    ├─ T11 Qwen productization ────────────────┘     │
                    └─ T13 provisional CPU package ──────────────────┘
                                                                      |
                                                                      v
                                                        T14 optional GPU packs
                                                                      |
                                                        T15 pack/device qualification
                                                                      |
                                                        T16 backend/settings
                                                                      |
                                                        T17 frontend UX
                                                                      |
                                                        T18 final rebuild/cutover
```

Parakeet P1 和 ReazonSpeech R2 在此图中是明确的 `visible-unavailable / omitted-current-candidate`。P2/R3 不是隐含依赖，也不在本批创建。

## Parent Artifact Changes

### Parent PRD

- 将 archived legacy baseline/reassessment 设为当前前瞻性字幕质量 authority。
- 在发布治理中明确 ordinary Faster-Whisper mandatory，其他模型可按 qualified subset 发布或保持 visible/unavailable。
- 新增 T06R/T08R requirement ownership。
- 删除固定 18 children 数量合同，使用 required-child completion 与 optional lane disposition。
- 更新 Planning State，区分历史旧门禁与当前 legacy-relative 结论。

### Parent Design

- 在 authority、engine design、rollout、build/package 和 test strategy 中加入 quality-recovery boundary。
- Candidate A、K2 仍保留历史价值：结构/算法证据可复用，但不是 accepted final quality input。
- T12 是 native artifact/companion identity authority；T11 final Qwen evidence 必须消费该 mapping。
- T14/T15 只处理 accepted lanes；未通过模型不进入 pack manifest。

### Parent Implement Map

- 在 T06/T08 后分别插入 T06R/T08R，而不重编号 T11～T18。
- 修改 T11、T14、T15、T18 dependencies。
- 在 parallel groups 和 gate overview 中加入 T06R/T08R/T12/T13。
- 将 T13 标记为 provisional-only；T18 保留 final immutable rebuild。
- Parent Review Gate 记录本次 user-approved reprioritization 与 next batch。

## Immediate Child Batch

### T06R - `native-asr-whisper-quality-revision`

Purpose: quickest path to the mandatory release route.

Contract seed:

- depends on archived T06/T07 and the archived Python baseline/native reassessment;
- creates a new candidate identity rather than editing Candidate A/B;
- explains every large-v3 per-field regression and completes large-v3 + large-v2 anchor matrices;
- development GPU evidence accelerates iteration but is not T15 qualification;
- no other Whisper model is unlocked until both anchors pass.

### T12 - `native-asr-model-manager`

Purpose: freeze the delivery identity needed by every later runtime/settings/UI task.

Contract seed:

- depends on proven T02/T03 formats and archived identity manifest;
- freezes URL/revision/size/SHA/license/file roles and Qwen companion pair;
- implements no inference/quality repair;
- pending mapping resolution cannot turn an observed stop-revise candidate into qualified.

### T11 - `native-asr-qwen3-aligner`

Purpose: produce legal product Qwen timing and a complete matrix.

Contract seed:

- starts from T09 capability and archived T03C/reassessment blockers;
- may develop grouping before T12 completes, but cannot publish final evidence until the exact Qwen + ForcedAligner pair is frozen;
- no synthetic timestamps or failed-row promotion;
- remains optional for the first subset release unless it qualifies.

### T08R - `native-asr-kotoba-quality-revision`

Purpose: preserve K2's safe long-audio mechanics while fixing legacy-relative text regressions.

Contract seed:

- new K3 identity;
- K2 bounded stride/ownership/dedup remains the inherited safety baseline;
- no reference-based dedup/backfill;
- complete short/medium/long-v2 matrix before disposition.

### T13 - `native-asr-cpu-runtime-package`

Purpose: derisk reproducible CPU packaging without claiming a final worker.

Contract seed:

- depends on T04/T06 stable worker seam;
- may build a provisional smoke artifact in parallel;
- includes no models and no rejected ORT/VAD candidate;
- T18 rebuilds/attests the final runtime from accepted engine sources.

## Deferred And Future Children

- Parakeet P2 and ReazonSpeech R3: create only after a separate user-reviewed quality investment decision.
- T14–T18: keep as parent map entries; create incrementally only after their explicit gates are satisfied.
- A deferred lane must end as `omitted-current-candidate`, `unsupported-for-native-release`, or a later qualified child; it is not silently dropped.

## Dependency Rules

Parent-child metadata expresses ownership only. Each child PRD records these ordering rules:

- T06R: T06 + T07 + baseline/reassessment.
- T08R: T07 + T08 + baseline/reassessment.
- T12: T02 + T03 + identity manifest.
- T11: T09 for development; T12 for final model/companion authority.
- T13: T04 + T06; final input identity deferred to T18.
- T14: T12 + T13 + at least one accepted T06R/T08R/T11 lane.
- T15: T14 candidate-built packs + exact accepted lane identities.
- T16: T12 + T13 + T15.
- T17: T12 + T16 + stable qualification metadata.
- T18: all required infrastructure children plus dispositions for every visible model/device lane.

## Task Creation Mechanics

Use `task.py create ... --parent 07-25-native-asr-migration --no-start` for each next-batch child. The roadmap task remains current during creation. Each generated `task.json` must have:

- `status: planning`;
- parent `07-25-native-asr-migration`;
- branch/base branch aligned with `dev-crisp-asr`;
- unique slug and no duplicate parent child entry.

Replace each generated placeholder PRD immediately with a scoped seed. Do not create design/implement manifests for those future children until their own planning session; the seeded PRD is not implementation approval.

## Compatibility And Migration

- Archived task paths/hashes remain unchanged.
- No Git history rewrite or parent task archive.
- Existing T11–T18 labels remain stable for references.
- T06R/T08R additions avoid renumbering the release phases.
- Fixed child-count language is removed because actual correction/evidence/governance children are legitimate project history.

## Validation

- Parse every changed/new `task.json` as JSON.
- Assert five expected slugs, all parent-linked once, all `planning`, none current/started.
- Assert no P2/R3 or T14–T18 directory was created.
- Search parent artifacts for stale current-state claims (`accepted-kotoba-algorithm-input` used as downstream authority, fixed `18` completion contract, Candidate A current pass without supersession).
- Verify archived task diff is empty.
- Run `task.py validate` for the roadmap task and `git diff --check`.

## Rollback

Remove the five newly created planning child directories and their parent child-list entries, then restore the three parent planning artifacts. No production code, model cache, runtime artifact, settings, user data or historical evidence requires rollback.
