# Existing Native Evidence Inventory

## Purpose

Inventory the latest frozen native candidate for every model that previously received an old absolute quality-gate disposition, and determine whether its existing evidence can be compared against `python-legacy-cuda-v1` without changing the candidate or rerunning inference.

## Candidate scope derivable from repository history

| Logical model | Latest candidate to reassess | Old disposition | Authoritative evidence | Existing ignored raw/adapted evidence |
|---|---|---|---|---|
| `faster-whisper/large-v3` | T06 `selected-cpu-beam1-no-history` Candidate A | corrected short/medium/long-v2 passed old gates; route still unqualified because the Whisper family matrix was incomplete | T06 selected CPU evidence plus T08 corrected CT2 handoff | T06 native benchmark envelopes and retained output exist under the archived T06 ignored `research/local/`; T08 supplies the current long-v2 correction authority |
| `kotoba-faster-whisper/kotoba-whisper-v2.0-faster` | T08 `kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1` | `accepted-kotoba-algorithm-input` under old gates | T08 K2 publication | complete per-case adapted benchmark envelopes and raw K2 evidence exist under archived T08 ignored `research/local/k2/` |
| `parakeet/parakeet-tdt_ctc-0.6b-ja` | T10 `P1-window15s-native-word-v1` | `stop-revise` | T10 publication | complete short/medium output and identity-valid long structured failure exist under archived T10 ignored `research/local/raw/parakeet/` |
| `reazonspeech-nemo/reazonspeech-nemo-v2` | T10R `R2-vad12-pad30-overlap-top-level-v1` | `better-than-r1 + stop-revise` | T10R publication | complete short/medium output and identity-valid long structured failure exist under archived T10R ignored `research/local/formal/raw/` |
| `qwen3-asr/qwen3-asr-1.7b` + required ForcedAligner | T03C corrected PoC candidate | `stop-revise` | T03C corrected CrispASR handoff/publication | archived T03 ignored Qwen runs exist; short has accepted ForcedAligner timing, medium/long have zero accepted timed output and validated `segment-legality-failed` blockers |

## Explicit exclusions

- `faster-whisper/large-v2`, `tiny`, `base`, `small`, `medium`, and `large-v3-turbo`: no previous complete old-gate candidate disposition to reassess.
- Superseded candidates such as T02 fixed-window, T06 Candidate B, Kotoba K1, and Reazon R1: retain historical provenance but do not compete with the latest candidate for the model.
- T09 development GPU speed rows: device-selection evidence only, not subtitle-quality candidates.

## New comparison authority

- Baseline: `.trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json`.
- Identity map: `.trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/model-identity-manifest.json`.
- Comparator implementation: `scripts/asr-legacy-baseline.py`.
- Durable contract: `.trellis/spec/asr/quality-guidelines.md`.

The comparison is per `logicalModelIdentity × case × python-legacy-cuda-v1`. CER, S/D/I, empty text, semantic-gap count/duration, and eligible Qwen ForcedAligner median/P95 must each be lower than or equal to the matching Python row. Structural, performance/resource, protocol, identity, path, privacy, license, cancellation, and recovery gates remain independent absolute gates.

## Evidence constraints discovered

1. Existing ignored native outputs are present locally, so completed rows can be recomputed through the shared T01 comparator without rerunning inference.
2. Historical tracked publications do not always contain every relative metric, especially complete S/D/I and final segments. Reassessment therefore needs the ignored raw/adapted evidence and must bind its hashes; copying aggregate values alone is insufficient.
3. T10 Parakeet P1, T10R Reazon R2, and T03C Qwen have identity-valid failed/unaccepted rows. They must remain visible as failed/unscored rows and keep the overall candidate non-qualified; no synthetic metrics or timing may be invented.
4. The identity manifest still marks Parakeet, ReazonSpeech, and Qwen native GGUF mapping as `pending-t12-native-model-manifest`. Their per-metric observations may be published, but a final subtitle-quality qualification must remain `baseline-incomplete` until the mapping authority is frozen. The task must not silently absorb T12 model-manager scope.
5. Qwen long-v2 Python timing provenance is mixed and therefore timing-ineligible. Text/gap fields remain comparable where a native completed row exists; no timing comparison may be fabricated.
6. Archived task artifacts remain immutable. New results belong to this task and may update only forward-looking parent handoffs/planning.

## Recorded scope decision

The user confirmed on 2026-08-19 that this task is strictly a historical-evidence reassessment. It preserves each frozen candidate, reports `unscored`/`baseline-incomplete` where existing evidence cannot support qualification, and never reruns native inference to repair missing or failed rows. New inference would create a new candidate identity and belongs to T11/T12 or later model-revision work.
