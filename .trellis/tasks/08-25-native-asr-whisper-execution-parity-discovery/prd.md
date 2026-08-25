# Discover native Whisper execution parity

## Goal

Run one bounded, promotion-ineligible execution-parity discovery for ordinary Faster-Whisper so a later task can decide whether one causal native quality candidate is justified. The discovery must use the exact loaded model feature contract and must not repeat the lock-repair chain from the archived quality-revision task.

## Authority

- Ground truth and Python comparison authority remain the existing `.asr-benchmark` corpus and `python-legacy-cuda-v1` rows.
- Historical ordinary Whisper quality evidence comes from archived T06 plus the archived `08-20-native-asr-whisper-quality-revision` non-qualified handoff.
- The exact large-v3 model exposes `128` Mel bins. The prior `80 × 3000` parity tensors are invalid for model-backed large-v3 attribution and may be retained only as historical source-only evidence.
- `.trellis/spec/asr/quality-guidelines.md` owns discovery/acquisition/qualification separation and exact model-derived feature-shape rules.

## Requirements

1. Planning must define separate unscored discovery, candidate acquisition and qualification stages. Discovery artifacts are always `qualificationEligible=false` and cannot be promoted.
2. Before freezing any candidate/acquisition lock, one ignored-local model-backed discovery must construct the exact large-v3 model and record the actual feature shape and lazy-loaded runtime/module contract needed by the intended probe.
3. Feature producers must derive `n_mels` from the exact loaded model identity. Large-v3 probes must use exact `128 × 3000` tensors; resizing, padding channels, substituting the prior 80-mel tensor or inferring shape from a model-independent default is forbidden.
4. Reproduce the two anchor lanes first: Python-wheel runtime with its matching Python feature producer, and native runtime with its matching native feature producer. If either anchor cannot reproduce its frozen aggregate under a valid harness, stop as `baseline-runtime-unresolved` or `native-harness-unresolved` before crossover cells.
5. Only after both anchors reproduce may the task run the optional cross-feature/runtime cells needed to distinguish feature divergence, runtime divergence, parser divergence or feature-runtime interaction.
6. Python/native parser replay may compare exact acquired token sequences, but fresh Python output is reproducibility evidence only and never replaces the archived quality authority or user ASS truth.
7. The discovery may perform at most one reviewed harness correction after the first model-backed discovery failure. A second harness/identity failure ends the task truthfully rather than creating another lock version.
8. A successful attribution may propose at most one later short/medium quality candidate. This task does not implement or acquire that candidate, run the formal large-v3/large-v2 six-row matrix, change production/default routing or create CPU inheritance metadata.
9. Raw audio, Mel tensors, tokens, text, module paths, models and binaries remain under the exact ignored task-local root. Tracked output contains only identities, aggregate hashes, bounded findings and limitations.
10. Production worker/protocol/default routes remain unchanged. Python legacy stays the production/default route.

## Acceptance Criteria

- [ ] `design.md` defines the minimal model-backed discovery command, actual loaded-contract capture, A/D-first stop gates, optional crossover rule, privacy boundary and single-correction budget.
- [ ] `implement.md` defines exact validation commands and explicit stops before any quality candidate or qualification lock.
- [ ] Planning binds the archived non-qualified handoff and the current ASR quality spec without modifying historical locks or artifacts.
- [ ] No model-backed discovery runs before this task is separately reviewed and activated.
- [ ] The eventual task result is one of: bounded causal attribution, `baseline-runtime-unresolved`, `native-harness-unresolved`, `feature-runtime-interaction`, `no-divergence` or `invalid-evidence`; it never claims qualification.
- [ ] Any proposed follow-up is one causal short/medium quality candidate at most, requiring its own planning, review and explicit acquisition authorization.

## Out Of Scope

- Formal subtitle-quality qualification or pack/device attestation.
- large-v2/large-v3 six-row acquisition.
- Production/default route, protocol, frontend, downloader, model manager, installer or packaging changes.
- Reference-derived repair, arbitrary beam/VAD/temperature searches or combining multiple speculative fixes.
