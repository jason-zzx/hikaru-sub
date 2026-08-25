# Discover native Whisper execution parity

## Goal

Run one bounded, promotion-ineligible execution-parity discovery for ordinary Faster-Whisper. The result should determine whether one later causal short/medium quality candidate is justified, without repeating the archived lock-repair chain or beginning qualification.

## Background

- User-provided `.asr-benchmark` WAV+ASS data remains the only subtitle truth.
- The identity-bound `python-legacy-cuda-v1` rows remain the Python quality authority; fresh Python output is reproducibility evidence only.
- Archived T06R closed `stop-revise / non-qualified` after beam/history, exact Silero V6 and exact upstream-fallback diagnostics selected no candidate.
- T06R's later parity probe was invalid: it froze `80 × 3000` Mel tensors before constructing the exact large-v3 model, which exposes `128` Mel bins.
- `.trellis/spec/asr/quality-guidelines.md` requires discovery, candidate acquisition and qualification to remain separate.

## Requirements

1. Discovery artifacts must set `qualificationEligible=false` and `promotionEligible=false`; no discovery row may be promoted or adapted into candidate or qualification evidence.
2. The discovery must construct the exact large-v3 model before accepting a feature tensor and record the model-reported Mel shape plus the runtime/module contract needed by the intended probe.
3. Every feature producer must consume the exact model-derived `n_mels`. Large-v3 must use exact `128 × 3000` float32 tensors; resizing, channel padding, the historical 80-mel tensors and model-independent defaults are forbidden.
4. Run the two anchor lanes first:
   - Python-wheel CTranslate2 runtime with the matching faster-whisper/NumPy feature producer.
   - Native no-cuDNN CTranslate2 runtime with the matching native/pocketfft feature producer.
5. The Python-runtime anchor must reproduce the archived Python short aggregate; otherwise stop as `baseline-runtime-unresolved`. The native anchor must reproduce the reviewed native short aggregate; otherwise stop as `native-harness-unresolved`.
6. Only after both anchors reproduce may the task run the two crossover lanes needed to distinguish feature divergence, runtime divergence, parser divergence, feature/runtime interaction or no divergence.
7. Exact acquired token sequences may be replayed through both parsers. Fresh Python parsing/output never replaces the archived quality authority or user ASS truth.
8. After the first model-backed harness or identity failure, at most one reviewed harness correction is allowed. A second such failure closes the task as `invalid-evidence`; no lock-version chain is allowed.
9. A successful attribution may propose at most one separately planned short/medium quality candidate. This task does not implement or acquire that candidate.
10. Audio, model paths, Mel tensors, tokens, text, module paths, runtimes, binaries and raw traces stay below the exact ignored task-local root. Tracked output contains only identities, aggregate hashes/counts, bounded findings and limitations.
11. Production worker protocol, Tauri/React contracts, model manager, packaging and default routing remain unchanged. Python legacy stays production/default.

## Acceptance Criteria

- [x] `design.md` defines the minimal model-backed discovery command, exact loaded-contract capture, anchor-first stop gates, optional crossover rule, privacy boundary and one-correction budget.
- [x] `implement.md` defines ordered implementation and validation commands with explicit stops before candidate acquisition or qualification.
- [x] Context manifests bind the ASR quality specification, archived T06R handoff and invalid 80-mel acquisition outcome.
- [x] No model-backed discovery ran before this task was reviewed and activated.
- [ ] Both anchors use exact model-derived `128 × 3000` inputs and clean isolated processes. The model contracts did report exact `128 × 3000`, but the reviewed correction overlapped the first timed-out child process, so all four A/D raw rows were invalidated.
- [x] The task publishes exactly one bounded result: `invalid-evidence`.
- [x] The result never claims qualification, changes production/default routing or creates CPU inheritance metadata.
- [x] No follow-up quality candidate was created; the failed discovery provides no causal basis for one.

## Final Result

- Disposition: `invalid-evidence`.
- Harness failures: `2`; the single reviewed correction budget is permanently exhausted.
- Invalidated evidence: `A × 2` and `D × 2`; B/C never started.
- Exact loaded model contract: large-v3 `128 × 3000` float32 Mel in both runtime roots.
- Eligibility: `qualificationEligible=false`, `promotionEligible=false`, `scoringEligible=false`.
- Product impact: none; ordinary native Faster-Whisper remains disabled and Python legacy remains production/default.
- Authority: `research/whisper-execution-parity-discovery.json` and matching Markdown publication.

## Out of Scope

- Formal large-v3/large-v2 six-row acquisition or qualification.
- Production worker/protocol/frontend/downloader/model-manager/installer/package changes.
- Reference-derived repair, arbitrary beam/VAD/temperature searches or combining speculative fixes.
- Rewriting archived T06/T06R locks, evidence or handoffs.
