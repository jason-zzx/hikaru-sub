# ReazonSpeech R2 evidence and candidate selection

Research date: 2026-08-14

## Decision summary

Use one primary R2 candidate first:

`R2-vad12-pad30-overlap-top-level-v1`

- keep the current pinned ReazonSpeech Q8_0 model, CrispASR runtime, CUDA development lane, worker protocol and output caps;
- replace R1's contiguous fixed `15000ms` windows with CrispASR's maintained Silero-VAD speech cores, capped at `12000ms` and re-split at energy minima;
- preserve official/default `speechPadMs=30`; because the pinned direct ABI applies it after rechunking, distinguish the `12000ms` core cap from the `12060ms` padded inference cap and permit only adjacent native final-padding overlap up to `60ms`;
- transcribe each padded window through the existing loaded session as one exact single pass, with strictly increasing window starts/ends, audio bounds, no non-adjacent overlap and no reactive streamed fallback;
- emit one text-conserving cue from the legal top-level result of each window;
- do not add caller-created overlap, ownership rewrite, dedup, stitching, reference repair, synthetic/proportional timing, F16, beam search, MAES or a new ASR runtime in the primary candidate.

If the complete primary matrix is not materially better than R1 and the evidence shows missed speech *inside* otherwise valid VAD slices, one separately frozen fallback may be reviewed:

`R2-vad12-gapfill-v1`

It may copy only the pinned CrispASR bounded-window gap-fill rule: re-transcribe uncovered spans of at least `1000ms`, at most two rounds, then merge recovered native items by timing without reference text. It is not pre-authorized implementation work.

The candidate can be selected as `better-than-r1` even if its release-quality disposition remains `stop-revise`. `qualified` remains reserved for passing every frozen quality gate.

## User-reviewed speech-pad decision and new oracle result

The first oracle identity, `R2-vad12-top-level-v1`, stopped before inference because its blanket non-overlap rule contradicted the pinned direct ABI's post-rechunk `30ms` padding. The user explicitly chose to retain the maintained/default padding and review the ABI-native overlap as part of a new identity, rather than switch to unsupported `speechPadMs=0` or clamp the windows.

The narrow relaxation is frozen as follows:

- unpadded VAD/rechunk core cap: `12000ms`;
- padded direct-ABI inference cap: `12060ms` / `192960` samples;
- adjacent overlap: only the final-padding artifact, at most `60ms`;
- strictly increasing starts and ends, positive/audio-bounded ranges, no non-adjacent overlap;
- legacy inline dispatch with `CRISPASR_PARAKEET_STREAM_THRESHOLD=13` and `CRISPASR_SESSION_UNIFIED_DISPATCH=0`, so every accepted window calls direct `parakeet_transcribe_ex`; null is failure, not streamed fallback;
- no clamp, ownership rewrite, dedup, stitching, gap-fill, decoder search, punctuation post-processing or reference repair.

The rerun completed both source-only cases under one frozen identity:

| Case | CER | Δ vs R1 | Semantic gaps | Δ vs R1 | Timeline errors | Windows / calls / cues | Max padded window | Max overlap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| short-v1 | `0.266667` | `+0.041667` | `1` | `0` | `0` | `3 / 3 / 3` | `10260ms` | `60ms` |
| medium-v1 | `0.295385` | `-0.081758` | `19` | `-3` | `0` | `53 / 53 / 53` | `11870ms` | `60ms` |

Classification is `promising` because medium-v1 shows both lower CER and fewer semantic gaps while both cases remain structurally legal. This partial source-only probe does not publish `qualified`, `stop-revise`, `better-than-r1` or any release disposition. Product implementation remains stopped pending separate user review.

## Step 6 Rust-host lifecycle evidence

The final Step 6 refresh separates the pre-existing generic `HIKARU_ASR_CRISPASR_INPUTS` decoder from the R2-only required manifest/lane decoder. Generic T09/T10 Parakeet/Qwen/Reazon configuration remains decodable and optional-absent runs still skip; R2 required mode uses only `HIKARU_ASR_R2_STEP6_{MANIFEST,REQUIRED,LANE}`, fails closed when incomplete, and cannot replace or cross-authorize the generic decoder. The ignored `research/local/r2-step6-manifest.json` is 15,483 bytes with SHA-256 `aa28e40c65c029c2c7c651121606f9334daddf21ee839c59954455d3bb5bb33c`; it binds production worker `623,616 / e86c199e8a01cfead31d36f34d576fe89be52e0fd6f3d29163383ee94023c274` and contract worker `621,568 / 02dfb3e5d33d2abee4a222307521eebc4f35918cc8b601c796d175b9747664f9`. Its exact bytes are hard-bound in the test-only Rust source and the acquisition-bound `r2-input-lock.md`.

Six required-mode invocations ran independently:

| Lane | Result |
|---|---|
| success | strict `ready -> progress* -> segmentsReplace -> completed`, exact progress `10260 / 14080 / 24102`, one replacement, no previews; recovery and ordered ASS dialogue vector exactly matched the final replacement, including duplicate/order semantics |
| pre-ready negative | missing staged VAD produced `crispasr_vad_model_invalid` before `ready`, zero output |
| post-ready VAD | positive `ready.durationMs=2000`, then `crispasr_vad_no_result`, zero output |
| post-ready protocol | positive `ready.durationMs=20000`, exact progress `12060 / 20000`, then `invalid_segment`, zero output |
| post-ready policy | positive `ready.durationMs=20000`, exact progress `12060 / 20000`, then `parakeet_family_invalid_input`, zero output |
| cancellation | positive `ready.durationMs=498872` and progress prefix beginning `11150`, then cancellation/reap within two seconds, gate release and zero partial recovery/ASS |

The refreshed explicit lane logs, targeted/full Rust tests, release check, task validation, ignore/privacy checks and `git diff --check` are hash-bound in ignored validation index `81a0987bbbb1adac7fef7975aecbee324a559e1b24e4dd9271b2530d35e4d2f7`; sanitized details are in byte-deterministic `r2-step6-report.md` (`8a6d1ffa07457e5b7ecdff4ae2bf3ced3509684d676a89bdfcf78904823de72f`). Every lane log begins with a recomputed digest-bound header covering the exact lane, Cargo command/test filter, required environment/scenario, manifest hash and expected contract, followed by one Rust-emitted observed outcome record. All six log/header identities are distinct, report rows derive from those observed records, and mutation tests reject lane swaps, command/environment drift, duplicated protocol-as-policy evidence and header/log mismatch. Missing optional inputs still skip ordinary developer tests, while required mode fails on a missing manifest/lane/hash/artifact; a focused Rust test also proves a required invocation with no manifest cannot silently skip. Production routing, Release/default and product commands remain unchanged.

This is lifecycle/contract evidence only. It publishes no short/medium/long-v2 metrics, `qualityDisposition` or `relativeSelection`. The six lanes now exercise the current final Step-7-hardened worker identity, so the former pre-Step-7 lifecycle evidence staleness is closed before formal acquisition.

## Step 7 pre-acquisition evidence hardening

Before formal acquisition, the runner/publisher gate was tightened without running the real short/medium/long-v2 model matrix:

- one machine-readable lock object now freezes the oracle, formal runner, publisher, protocol header/source, protocol limits and shared comparator; acquisition and publication verify every size/SHA-256 before private staged inputs or ignored raw rows are read;
- the development-only worker evidence seam writes sanitized per-window source timing/byte-count/SHA-256 rows to ignored stderr, never protocol preview state; publication re-parses those bytes and matches exactly one source result to each VAD window and final cue;
- failure rows use an explicit candidate-caused taxonomy and actual attempt/source-result counters, so VAD-stage failures prove zero transcribe calls while request, identity, harness, abnormal-exit and protocol-incomplete rows remain invalid;
- all relative reasons, including `long_completed`, require the complete evidence/timeline/cue/protocol/text safety gate set; 97-code-point and 15001ms anti-promotion cases are covered;
- local/raw/stderr paths are exact role paths with canonical containment and reparse rejection; the final hardening pass now inspects the original lexical root and every existing lexical component before resolution, requires post-resolution containment plus ignored status for private staging/raw/stderr/indexed rows, and passes a real Windows junction escape test plus nested-component mutations;
- relative selection now uses one frozen safety-code set for malformed VAD/windows/results, policy text/cue failures and protocol/replacement failures; `crispasr_result_invalid` code equality alone never exempts a failure. The R1 ignored raw authority independently derives `zero_duration_top_level_result` at zero-based window `23` (24th), `[345000,360000]ms`, local `14800..14800`, fingerprint `6c76aa3a15660de07b377754a75c9938add1a71edb58d3b1a988ab5c75935716`; only the exact reviewed R2 same-class fingerprint `35b1f992ca3619d7e985ee3e9bb33f01280bed48829766bafbe01ee1892dc93e` may avoid a new safety anti-regression. Mutated subtype/range/timing/result-trace hash/fingerprint and forged subtype promotion all fail;
- child device-selection environment, exact PATH roots, child CUDA identity and unique complete module inventory are bound; the publisher performs two full render passes from indexed raw bytes and requires byte-identical JSON/Markdown/handoff output.

Focused fake-worker/native contracts, task-local synthetic acquisition/publication mutations and the source-only VAD dry-run passed. No formal model row, disposition or route change was produced.

## Corrected Step 8 complete primary matrix

The original long-v2 VAD failure was a validator bug, not a candidate result. The ABI pair at the real boundary was `[510970,522930]ms` followed by `[522870,533630]ms`; converting the same float endpoints independently to samples produced a false `961`-sample rejection even though the candidate contract is defined on canonical integer milliseconds. The worker, source-only oracle, formal planner and publisher now round each ABI endpoint to integer milliseconds exactly once, derive samples as `ms * 16`, and validate the resulting windows against `12060ms` / `192960` samples and adjacent overlap `<=60ms`. Fake-ABI/backend and publisher tests retain the real boundary and reject direct-float sample drift, `61ms`, `12061ms`, non-adjacent and out-of-audio cases.

The pre-final-check publication is superseded and is not authoritative: raw index `ec1442516b7a1fd25bd35f850049046adfa6c4669947900cb3e0806e6b12b488`, evidence JSON `9e6efdfc1db2b595019afa723d9242d97abd5309425fe673621e57a66ca96085`, report `46f0b61265b654a5def4d8211b9ca08c82e56360b34997862dbe3c61d7d8ba03`. It used the R2 manifest through the generic CrispASR decoder and exempted `crispasr_result_invalid` by broad code equality. The final authority restores the generic decoder, uses a separate R2-only required decoder, and requires the exact reviewed subtype/fingerprint.

Because the worker, Rust-host manifest and formal-tool/input-lock identities changed, the stale publication was deleted, Step 6 was rerun against the rebuilt production/contract workers, and all six formal roles were reacquired from empty ignored raw/stderr roots under one final acquisition-bound lock identity (`24,189 / 42039347f43d8b6faa2b9ab2f9acb3a2e021fb0e350eefa67e1bd38dde5bfd3f`).

Corrected formal result:

| Case | Status | CER | Δ vs R1 | Semantic / excluded gaps | Timeline | CUDA inference RTF | Peak RSS | Cues | Max cue cp / duration | Max VAD window / overlap |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| short-v1 | completed, `1 cold + 3 warm` | `0.266667` | `+0.041667` | `1 / 0` | `0` | warm median `0.031613` | `941,690,880` bytes | `3` | `42 / 8320ms` | `10260ms / 60ms` |
| medium-v1 | completed, `1 fresh` | `0.295385` | `-0.081758` | `19 / 1` | `0` | `0.021828` | `972,058,624` bytes | `53` | `75 / 11600ms` | `11870ms / 60ms` |
| long-v2 | identity-valid structured failure | — | remains incomplete | — | — | `partial-attempt` RTF `0.045657` through `attemptedThroughMs=768570`; no full-case RTF | `1,205,370,880` bytes | `0` | — | `354` planned windows, max `11970ms / 60ms` |

Short warm RTF samples were `0.031613`, `0.031797` and `0.030346`; the median is `0.031613`. Short cold wall was `3936.042ms` and cold inference RTF was `0.029737`. Medium process wall was `14141.416ms`. Long completed 61 calls, then its 62nd attempt—zero-based window index `61`, absolute `[763590,768570]ms`—returned local top-level range `2160..2160ms`. The independently derived subtype is `zero_duration_top_level_result`, result-trace SHA-256 `f3179c7ab489bfcc211b4779fa15fb481354850dd08cbf2286b64c00f13c45bb`, fingerprint `35b1f992ca3619d7e985ee3e9bb33f01280bed48829766bafbe01ee1892dc93e`. It published `attemptedWindowCount=62`, `completedWindowCount=61`, `attemptedThroughMs=768570`, `rtfScope=partial-attempt`, no accepted cues and no full-case RTF.

The publisher applies PRD R5 literally. It independently derives and identity-binds both R1 and R2 as the reviewed `zero_duration_top_level_result` class; broad `crispasr_result_invalid` equality is insufficient. The exact R2 subtype/range/timing/result-trace fingerprint matches the reviewed same-class exception, so this failure is not a new timeline/protocol/cue regression. Medium CER improves by `0.081758` absolute, short semantic gaps do not increase, and short's CER regression is not paired with more semantic gaps. It therefore publishes:

- `qualityDisposition: stop-revise` because short/medium retain semantic gaps and long-v2 still does not complete;
- `relativeSelection: better-than-r1` with reason `medium-v1_cer_reduction`;
- no relative anti-regression findings;
- `acceptedAlgorithmHandoff: false`, `releaseRouteEnabled: false`.

Publication identities:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| raw index | 1,719 | `ac860d5a44725158505db3568588dff500d112b69fe601e8d8fe34d798e81ed6` |
| evidence JSON | 9,588 | `7b88496567285e5ee224300432b054fc7635da23ac817a1e888c66f9c215fbd9` |
| Markdown report | 1,134 | `547d9cab2175a16c12e2fa5001fb4f1b7866a97c09945dcd76b9a577b1d2d482` |
| handoff | 394 | `dafc03494eff48cce1e7b339b6a0514fc9c6b0b65fce055cebde20d31eefc37b` |

The complete publication command was run twice and all four identities remained byte-identical. The candidate is retained only as the preferred development basis. The residual blocker is another upstream zero-duration top-level result on long-v2, not a VAD overlap error and not evidence of one or more `>=1000ms` uncovered spans inside valid VAD slices. `R2-vad12-gapfill-v1` therefore remains unauthorized and unimplemented; F16, official subword decoding, beam/MAES, caller-created overlap/ownership, dedup, stitching and pin changes still require a new user-reviewed plan.

## Corrected full-scope validation

- Native protocol-only, CT2 CPU, CT2 CUDA-development and task-local R2 worker CTest lanes all passed; CUDA compilation emitted only pinned upstream conversion/alignment warnings.
- Rust passed `216/216` tests and release check; the refreshed six-lane Step 6 matrix also passed, including generic Parakeet/Qwen decoder preservation and R2 cross-authorization rejection.
- Frontend passed `105` test files / `830` tests and `pnpm build`; Vite retains the existing large-chunk warning.
- Benchmark manifest validation, self-check and `24` focused comparator tests passed; manifest validation retains the existing missing `low-volume` coverage warning.
- The `18` R2 publisher tests, task validation, active/archive ignore checks, tracked privacy scan, deterministic publication, no-staged-files check and `git diff --check` passed.
- Release/default, native route, Parakeet/Qwen, frontend behavior, downloader/settings/installer/portable/package/runtime pack remain unchanged.

## R1 baseline and observed failure distribution

Current authority:

- `.trellis/tasks/archive/2026-08/08-13-native-asr-parakeet-reazon/08-13-native-asr-parakeet-reazon/research/evidence/t10-parakeet-reazon.json`
- `.trellis/tasks/archive/2026-08/08-13-native-asr-parakeet-reazon/08-13-native-asr-parakeet-reazon/research/t10-handoff.md`

R1 identity: `R1-window15s-top-level-v1`, Q8_0, CUDA, contiguous fixed 15-second windows, no overlap, no VAD.

| Case | R1 result |
|---|---|
| short-v1 | completed; CER `0.2250`; semantic gaps `1`; timeline errors `0` |
| medium-v1 | completed; CER `0.377143`; semantic gaps `22`; timeline errors `0` |
| long-v2 | valid structured failure at `[345000,360000]ms`; upstream top-level result was zero-duration `14800..14800ms` |

Before R1, the same Q8_0 model's corrected whole-file T03C text was substantially better: CER `0.1333 / 0.2857 / 0.2944`, zero semantic gaps and zero timeline errors, but the result was one oversized segment with mostly zero-duration native words. R1 improved subtitle shape while regressing text/coverage and losing long-v2 completion. This identifies the fixed inference boundary—not the model/runtime or protocol—as the first R2 target.

R1's implementation also sends every 15-second buffer through pinned CrispASR's Japanese path. In the pinned source, Japanese input above the maintained `12s` threshold uses streamed decoding rather than one exact single pass. Therefore every full R1 window exceeded the upstream Japanese single-pass bound.

## Official ReazonSpeech behavior

Official repository: <https://github.com/reazon-research/ReazonSpeech>

Inspected revision: `2d4d4762e7ee294ac8e47a177ac2e9b0e8d0d43f`.

Relevant files:

- `pkg/nemo-asr/src/transcribe.py`
- `pkg/nemo-asr/src/decode.py`
- `pkg/nemo-asr/src/interface.py`

Confirmed behavior:

- the helper normalizes and pads one waveform, then calls `model.transcribe(..., return_hypotheses=True)`;
- it derives model-specific subword point timestamps at `0.08s` per step with `0.5s` input padding compensation;
- it creates segments at sentence-ending punctuation or, after ten subwords, at comma/pause boundaries with a `0.5s` pause threshold;
- its public `Subword` type explicitly describes timestamps as points rather than reliable ranges.

This supports treating Reazon's zero-duration native items as model point timestamps in a later model-specific segmentation candidate. It does **not** require that extra decoder in the primary R2 candidate: VAD slices already provide legal coarse bounds, and reusing one top-level result per slice is the smaller experiment.

## CrispASR maintained guidance

Pinned source: CrispASR v0.8.22 commit `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`.

### Model card

Local retained copy:

`.trellis/tasks/archive/2026-08/07-25-native-asr-crispasr-poc/research/local/src/CrispASR-cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/hf_readmes/reazonspeech-nemo-v2-GGUF.md`

Published card: <https://huggingface.co/cstr/reazonspeech-nemo-v2-GGUF>

The card states:

- Q8_0 is the recommended general-purpose quant and near-F16 quality;
- F16 is for closest parity with the official NeMo pipeline;
- for clips longer than about 15 seconds, prefer VAD-bounded chunking because a single long Japanese FastConformer pass can drift.

### Japanese bounded-window policy

Pinned anchors:

- `examples/cli/crispasr_backend_parakeet.cpp`: Japanese models prefer VAD; VAD slices are capped at `12s` because longer arbitrary context degraded output.
- `examples/cli/crispasr_run.cpp`: clips beyond the backend window auto-enable VAD; overlong VAD speech regions are re-split at energy minima; VAD slices are decoded independently for subtitle output.
- `src/crispasr_vad.cpp`: Silero VAD uses maintained defaults and `crispasr_rechunk_slices(...)` cuts overlong speech regions at the lowest-RMS 100ms frame near each target instead of fixed mid-word boundaries.
- `docs/cli.md`: maintained defaults are Silero `ggml-silero-v6.2.0.bin`, threshold `0.5`, minimum speech `250ms`, minimum silence `100ms`; Japanese slice cap `12s`.
- `examples/cli/crispasr_gap_fill.h`: the optional/default bounded-window second pass targets uncovered spans `>=1s`, at most two rounds.

Community issue and maintainer discussion: <https://github.com/CrispStrobe/CrispASR/issues/89>.

The maintainer's reported failure mode matches R1: Japanese FastConformer decoding degrades on arbitrary/overlong chunks; VAD-bounded utterances and the 12-second cap are the maintained remedy. The same discussion warns that overlap-based fixed chunks can lose or duplicate boundary words, so caller-created overlap and ownership/dedup remain excluded. The primary's only overlap is the pinned direct ABI's own final `30ms` padding artifact, bounded to adjacent `60ms` and left unmodified so any boundary regression remains visible in the metrics.

## Current repository seams

Current reusable implementation:

- `native-asr/src/crispasr_backend.hpp/.cpp`: owns exact 16kHz PCM, one loaded session, bounded `transcribe_window`, copied top-level/word results, timing translation and lifecycle cleanup.
- `native-asr/src/parakeet_family_policy.hpp/.cpp`: owns UTF-8, text/cue caps and final text-conserving policy.
- `native-asr/src/main.cpp`: owns atomic `ready -> progress* -> segmentsReplace -> completed|error` and currently rejects CrispASR VAD.
- pinned C ABI already exports `crispasr_vad_slices(...)` and `crispasr_vad_free(...)`; no second VAD library is required.

Minimal product-code shape if the source-only probe is promising:

1. bind only those two existing VAD ABI functions;
2. let the existing backend derive and validate ordered speech windows with strictly increasing starts/ends, `<=12060ms` padded duration and only adjacent ABI-native overlap `<=60ms`;
3. relax the Reazon policy from contiguous whole-audio windows to the same bounded-overlap VAD window shape; keep Parakeet P1 behavior unchanged;
4. keep one top-level cue per VAD slice and existing atomic replacement;
5. use a task-local ignored canonical Silero model during R2 evidence; downloader/package/UI work remains downstream and conditional on selection.

## Why other options are not primary

- **F16:** the model card says Q8_0 is the recommended general-purpose near-F16 choice. R1 regressed sharply relative to earlier Q8_0 evidence after changing windowing, so quantization is not the first causal lever.
- **Beam/MAES/best-of:** no Reazon-specific evidence in the inspected official/model-card path shows that these fix R1's boundary gaps or zero-duration silence-window failure.
- **15s/caller-created overlap + LCS merge:** adds ownership/dedup complexity and is explicitly less preferred than VAD boundaries in the maintained CrispASR discussion. This remains distinct from the accepted direct-ABI final-padding overlap, which is at most `60ms` and receives no merge policy.
- **Official Reazon subword decoder port:** evidence-backed and potentially useful, but unnecessary unless VAD top-level cues violate readability/cap requirements. It is a later candidate, not primary scope.
- **Reference/Python repair, proportional timing, clamp/expansion:** forbidden because they can improve apparent metrics without improving native inference.
- **CrispASR pin upgrade:** not needed to test the maintained VAD ABI already present in the frozen runtime; upgrading source/runtime would confound the R2 algorithm comparison.

## Better-than-R1 selection rule

Evidence safety remains non-negotiable: one frozen identity, complete short-v1 / medium-v1 / long-v2 matrix, legal audio-bounded timeline, text conservation, cue/protocol limits, privacy and deterministic publication.

After those checks, publish two independent labels:

1. **Quality disposition:** `qualified | stop-revise`, using the existing absolute gates.
2. **Relative selection:** `better-than-r1 | no-material-improvement`.

`better-than-r1` requires at least one material blocker improvement:

- long-v2 changes from structured failure to a completed legal result; or
- a completed case improves CER by at least `0.02` absolute; or
- medium semantic gaps decrease by at least `20%` and at least `2` gaps (R1 `22` -> at most `17`); or
- short semantic gaps decrease from `1` to `0`.

And it rejects a trade that materially worsens another completed R1 case:

- no new timeline/protocol/cue failure;
- neither short nor medium may have both CER worse by more than `0.02` absolute and more semantic gaps than R1.

A `better-than-r1 + stop-revise` result may be retained as the preferred development basis for another revision, but it does not enable Release/default routing or hand accepted algorithm input to T14/T15.
