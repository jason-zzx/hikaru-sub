# Native ASR Roadmap Reprioritization Authority

## Trigger

The archived `08-19-native-asr-legacy-quality-reevaluation` task reinterpreted the latest frozen native candidates against `python-legacy-cuda-v1`. The parent task still contains older forward-looking language that treats large-v3 Candidate A as passing the old absolute gate and Kotoba K2 as an accepted algorithm input. The child roadmap must now follow the legacy-relative authority instead.

## Current quality state

Authority: `.trellis/tasks/archive/2026-08/08-19-native-asr-legacy-quality-reevaluation/research/evidence/native-asr-legacy-quality-reevaluation.json`.

| Model | Current result | Consequence |
|---|---|---|
| Faster-Whisper large-v3 Candidate A | `stop-revise` under per-metric legacy-relative quality; complete evidence and independent structural gates pass | Highest-priority new candidate. Large-v2 remains an independently mandatory Whisper anchor. |
| Kotoba K2 | `stop-revise`; complete evidence and independent structural gates pass | Preserve K2 ownership/stride safety work, but create a new K3 quality identity rather than packaging K2. |
| Parakeet P1 | observed `stop-revise`, identity-aware `baseline-incomplete`, long-v2 structured failure | Keep visible but unavailable for the first native release; do not create P2 until a later explicit scope decision. |
| ReazonSpeech R2 | observed `stop-revise`, identity-aware `baseline-incomplete`, long-v2 structured failure | Keep visible but unavailable for the first native release; do not create R3 until a later explicit scope decision. |
| Qwen T03C | observed `stop-revise`, identity-aware `baseline-incomplete`; medium/long have no accepted legal timing | T11 remains required and must consume a T12-frozen Qwen + ForcedAligner mapping before final publication. |

No current native candidate is subtitle-quality qualified under the new authority. Production routes and Python legacy defaults remain unchanged.

## User-approved roadmap direction

The user asked to apply the previously recommended implementation plan. That recommendation establishes:

1. A subset-first release policy: ordinary Faster-Whisper remains mandatory; other models may remain visible but unavailable when unqualified.
2. Quality recovery before formal GPU pack, settings, frontend, or release work.
3. Immediate parallel identity work through T12.
4. Qwen T11 and Kotoba K3 as the next optional-route quality work.
5. Parakeet P2 and ReazonSpeech R3 deferred until an explicit later product decision.
6. T13 may proceed as a provisional packaging pipeline, but no provisional binary/hash is a release identity.
7. T14/T15 do not start until T12/T13 are ready and at least one selected engine has an accepted final algorithm input.

## Revised near-term child batch

The roadmap task should create, but not start, these independently verifiable children under `07-25-native-asr-migration`:

| Label | Slug | Priority | Main dependency boundary |
|---|---|---:|---|
| T06R | `native-asr-whisper-quality-revision` | first | T06/T07 plus archived legacy baseline/reassessment; new candidate identity; large-v3 and large-v2 full anchor matrices |
| T12 | `native-asr-model-manager` | parallel first | T02/T03 formats plus archived identity manifest; freezes CT2/GGUF/companion delivery identities |
| T11 | `native-asr-qwen3-aligner` | parallel after mapping seam | T09 capability; T12 mapping required before final evidence |
| T08R | `native-asr-kotoba-quality-revision` | parallel/after Whisper checkpoint | T07/T08 safety algorithm plus archived baseline/reassessment; new K3 identity |
| T13 | `native-asr-cpu-runtime-package` | provisional parallel | T04/T06 worker seam; final release artifact deferred to T18 |

T14–T18 remain mapped in the parent artifacts but are not created in this batch. This follows the parent's incremental task-creation policy and prevents packaging/integration work from outrunning quality and identity gates.

## Dependency corrections required in parent artifacts

- Replace stale “Candidate A passed / K2 accepted for downstream packaging” language with historical-old-result plus current `stop-revise` authority.
- Add T06R and T08R without rewriting archived T06/T08 evidence.
- T11 development may begin from T09, but final publication requires T12's frozen Qwen/ForcedAligner mapping.
- T14 consumes only accepted T06R/T08R/T11 inputs. Parakeet/Reazon remain omitted unless a later separately reviewed candidate qualifies.
- T15 qualifies only T14 `candidate-built` packs and selected accepted engine identities.
- T16/T17/T18 remain downstream of T12/T13/T15 and may represent unqualified models as visible/unavailable.
- Remove fixed “18 child tasks” governance language because correction, baseline, reassessment, roadmap, and quality-revision children make a fixed count inaccurate. Completion is based on all required children and T18, not a numeric total.

## Non-goals

- No production code, inference, benchmark acquisition, model download, pack build, settings migration, frontend change, or release cutover.
- No edit to archived child tasks.
- No activation of newly created children.
- No P2/R3 task creation in this batch.
