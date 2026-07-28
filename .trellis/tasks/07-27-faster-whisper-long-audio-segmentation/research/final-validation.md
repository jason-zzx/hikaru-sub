# Final Private-Corpus Validation

## Verdict

**PASS** for the deterministic, duration-gated Japanese `large-v2` path.

The current production `FasterWhisperEngine` completed the full 69-minute
source without the reported persistent short-cue regime. Every rolling
10-minute window retained mixed cue lengths, all scalar distribution gates
passed, the six known transition gaps had no spanning cue, and final timestamps
were valid and non-overlapping.

The first unseeded formal runs exposed material CTranslate2 fallback sampling
variation: two executions of the same production code produced different
10-20-minute distributions. Pinning the long-path CTranslate2 random seed to
`0` made repeated full-feature 20-minute outputs byte-identical. The final
production run, without validation overrides, was byte-identical to the
seed-controlled candidate and passed the full corpus.

The separate 498.872-second source selected the upstream short path, invoked no
V4 or long prompt code, and exceeded the historical verified-text baseline after
the default Japanese `large-v2` CUDA compute was narrowed to `int8_float16`.

## Environment And Method

| Item | Value |
|---|---|
| Validation date | `2026-07-28` |
| Python | `3.11.15` |
| faster-whisper | `1.2.1` |
| CTranslate2 | `4.8.0` |
| Device / compute | NVIDIA RTX 3070 8 GB / CUDA `int8_float16` |
| Model / language | `large-v2` / fixed Japanese |
| Long random seed | `0` |
| VAD | Official Silero V4, 1536-sample windows |
| Normalization | Unicode NFKC, then remove all Unicode whitespace; punctuation and case retained |

The full source identity matched the documented PCM SHA-256
`ba8bef9ac6433bcd66721a32c9ae0fd58a10b309c758ddf03f45f8eeaf27cf6d`
and duration `4144.256s`. Validation used the complete WAV and complete feature
stream; no separately truncated WAV was used as a prefix proxy.

Measurement wrappers counted VAD, raw segments, temperatures, hard-hole calls,
and timestamp invariants while delegating unchanged to production functions.
They did not change prompts, tokens, audio, VAD probabilities, decoding,
alignment, restoration, or emitted text.

Private paths, subtitle bodies, token IDs, raw logs, model cache locations, and
generated outputs are intentionally omitted.

## Determinism Gate

Before the seed contract, independent runs over the same full source diverged
materially in the first 20 minutes: one produced `73` cues in the 10-20-minute
window and another produced `99`. The latter reached a `15.15%` tiny-cue rate
and failed the rolling gate.

With `ctranslate2.set_random_seed(0)` before long model construction:

- two complete-feature-stream 20-minute runs produced byte-identical SRTs;
- both reported the same temperature distribution and first fallback point;
- the final full production run was byte-identical to the seed-controlled full
  candidate.

The accepted full run still exercised fallback rather than avoiding it:

| Temperature | Raw cues |
|---:|---:|
| `0.0` | `437` |
| `0.2` | `11` |
| `0.6` | `8` |

The first nonzero fallback began around `09:11.400`. Stable segmentation
therefore does not depend on suppressing all fallback.

## Long Runtime And VAD

| Metric | Result |
|---|---:|
| Wall time | `467.210s` |
| Source duration | `4144.256s` |
| V4 calls | `1` |
| V4 speech chunks | `17` |
| Retained speech | `3539.400s` |
| Removed silence | `604.856s` |
| Raw / final cues | `456 / 456` |
| Raw invalid bounds | `0` |
| Raw adjacent overlaps | `14` |
| Final invalid bounds / overlaps | `0 / 0` |
| Hard-hole replacements | `0` |

The official V4 helper reproduced the validated 17-chunk shape. No raw segment
needed the aligned-word 30-second replacement in this run; V4 grouping already
left all six transition holes clear. Universal neighbor bounding removed all 14
small restored-timestamp overlaps without changing text or cue count.

An earlier unseeded full run exposed one additional real restoration shape where
the next raw start was earlier than the current raw start but still later than
the previous emitted end. Production now uses that remaining positive shared
interval rather than dropping text or emitting overlap; a deterministic
regression fixture covers the case.

## Full Semantic Distribution

### Aggregate And Breakpoint

| Metric | Result | Gate |
|---|---:|---:|
| Cues | `456` | informational |
| Median duration | `6.30s` | mixed lengths |
| P10 / P90 duration | `2.56s / 11.48s` | mixed lengths |
| Median normalized characters | `41` | informational |
| Before / after median duration | `6.88s / 6.16s` | ratio `0.895 >= 0.70` |
| Before / after median characters | `44 / 41` | ratio `0.932 >= 0.65` |
| Before / after tiny rate | `1.30% / 2.90%` | delta `+1.60pp <= 11pp` |
| Cues over 15 seconds | `2.85%` | `<= 4.26%` |
| Cues over 20 seconds | `1.10%` | informational |
| Cues over 30 seconds | `0%` | required |
| Maximum duration | `25.00s` | `<= 30s` |

A tiny cue is at most two seconds and at most ten normalized characters.

### Rolling Ten-Minute Windows

| Window | Cues | Median duration | Median chars | Tiny cues |
|---|---:|---:|---:|---:|
| `0-10m` | `55` | `8.48s` | `53` | `1.82%` |
| `10-20m` | `82` | `4.37s` | `32` | `6.10%` |
| `20-30m` | `69` | `7.54s` | `47` | `0.00%` |
| `30-40m` | `73` | `5.22s` | `36` | `2.74%` |
| `40-50m` | `81` | `6.68s` | `44` | `2.47%` |
| `50-60m` | `48` | `7.38s` | `38.5` | `2.08%` |
| `60m-end` | `48` | `7.15s` | `45.5` | `2.08%` |

Every window stays above a four-second median and below the 11% tiny-cue gate.
There is no sustained mostly-1-to-3-second regime and no compensating universal
long-cue bias.

## Gap And Timestamp Safety

All six source gaps meeting the task's transition-gap set had zero spanning
final cues:

| Gap duration | Final spans |
|---:|---:|
| `92.512s` | `0` |
| `114.272s` | `0` |
| `101.440s` | `0` |
| `108.320s` | `0` |
| `30.304s` | `0` |
| `42.112s` | `0` |

Final output had zero negative starts, non-positive durations, source overflows,
or adjacent overlaps. Bounding preserves all raw text; this accepted run had no
hard-hole split or text transformation.

## Text And Boundary Comparisons

### Normalized Text

| Comparison | Similarity | Length coverage |
|---|---:|---:|
| Final production vs original XXL reference | `90.1018%` | `103.5616%` |
| Historical affected ASS vs original XXL reference | `85.4639%` | `95.6888%` |
| Final production vs same-PCM XXL control | `91.4096%` | `101.4945%` |
| Original reference vs same-PCM XXL control | `92.5376%` | `98.0040%` |
| Final production vs historical affected ASS | `86.9721%` | `108.2275%` |

The final run improves similarity to the original external reference by
`4.6379` points over the affected historical output. Exact identity is not
expected from an external baseline.

### Boundary Coverage

Within `1.5s`:

| Reference | Candidate -> reference | Reference -> candidate |
|---|---:|---:|
| Original XXL | `41.89%` | `38.11%` |
| Same-PCM XXL | `68.42%` | `70.92%` |

The same-PCM control is the more meaningful boundary comparison because it
uses the same source PCM.

Six sanitized samples distributed from the former collapse region through the
end of the source had candidate durations from `1.90s` to `25.00s`; all ended
at Japanese punctuation. Their nearest same-PCM XXL cue-end deltas were
`0-180ms`. Some candidate cues intentionally grouped two to four control cues,
while short standalone utterances remained short. This confirms mixed semantic
grouping rather than a fixed formatter.

## Verified 498.872-Second Short Corpus

The final short run selected upstream mode and did not enter any long-only path:

| Metric | Result |
|---|---:|
| Long mode | `false` |
| Actual compute | CUDA `int8_float16` |
| V4 / hard-hole calls | `0 / 0` |
| Final cues | `199` |
| Invalid bounds / overlaps | `0 / 0` |
| Final vs human-verified text | `89.4505%` |
| Historical vs human-verified text | `88.7440%` |
| Final vs historical text | `95.8279%` |
| Candidate boundaries within 1.5s of verified | `87.44%` |
| Verified boundaries within 1.5s of candidate | `93.33%` |
| Historical boundaries within 1.5s of verified | `81.89%` |
| Verified boundaries within 1.5s of historical | `95.76%` |

The final text score is `+0.7065` points above the historical baseline. Candidate
boundary coverage improves, while reverse coverage decreases by `2.43` points;
the overall distribution remains comparable and no long prompt, V4, word
timestamps, or long seed is applied.

Two additional unseeded upstream short runs with `int8_float16` scored
`90.3198%` and `89.5172%` against the verified text. A float16 run and a
float16-plus-seed run both fell below the historical baseline, which is why the
narrow default compute change is retained while the long seed remains isolated.

## Post-Validation Concurrency Hardening

Independent review found that CTranslate2 seed state is process-global while
`JobManager` starts one thread per task. The product `JobManager` now serializes
only `faster-whisper` and `kotoba-faster-whisper` from transcription-handle
creation through complete lazy iteration or explicit close. Cancellation and
errors close the iterator before unlock. Other engines remain concurrent.
Direct Python callers of either Whisper-family engine must wrap handle creation
and complete iteration in `whisper_inference_session`; a direct long call without
that owner fails before seed `0` is set.

A seeded long job restores a fresh system-random nonzero CTranslate2 seed before
the shared lock is released on exhaustion, cancellation/close, handle failure,
or lazy failure. If that reset fails, the Whisper runtime is poisoned before
unlock and later faster-whisper/Kotoba sessions fail until the sidecar process
restarts; non-Whisper engines remain available. Short mode and Kotoba do not
request fixed seed `0`; a successful reset preserves their normal
nondeterministic fallback rather than making them seed-0 deterministic.
Auto-device warmup failure also releases the failed GPU model before CPU fallback
construction.

No private inference was rerun for this concurrency/lifecycle hardening because
it does not change routing, V4, compute selection, prompts, decode options,
aligned-word handling, or timestamp output. All measured corpus metrics above
remain the accepted evidence.

## Local Quality Gates

After the final implementation changes:

- focused faster-whisper tests: `58 / 58` passed;
- JobManager/concurrency tests: `13 / 13` passed;
- Kotoba tests: `11 / 11` passed;
- full sidecar tests: `215 / 215` passed;
- Python compilation passed for `jobs.py` and the four relevant engine modules;
- development and packaged behavioral/README copies were byte-synchronized;
- `git diff --check` passed;
- the official and China-proxy pinned V4 URLs both returned the expected
  `1,807,522`-byte asset;
- the production downloader stored the asset in the managed cache and verified
  SHA-256
  `a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28`;
- no ONNX/model weights or private corpus artifacts are tracked.

## Acceptance Summary

- Long semantic distribution: **pass**.
- Deterministic fallback behavior: **pass**.
- Overlong-cue limits: **pass**.
- Six transition gaps and timestamp invariants: **pass**.
- Original/same-PCM XXL comparison: **pass**.
- Verified short-corpus isolation and quality: **pass**.
- Kotoba isolation: **pass**.
- Managed V4 download/hash/provenance: **pass**.
- Unit/sync/privacy gates: **pass**.

## Residual Risks

- Long behavior is validated only for Japanese `large-v2`, the pinned
  faster-whisper/CTranslate2 versions, and the available CUDA runtime.
- CPU long-mode execution remains functionally covered but has not been run on
  the private full corpus.
- Product `JobManager` Whisper-family inference is intentionally serialized
  inside one sidecar process to isolate process-global CTranslate2 seed state.
  Direct Python callers must use `whisper_inference_session`; parallel Whisper
  jobs require separate sidecar processes. A failed post-long seed reset leaves
  that sidecar's Whisper runtime disabled until process restart; non-Whisper
  engines remain available.
- The existing model-download progress callback covers the Whisper snapshot but
  not a combined Whisper-plus-V4 total, so the final V4 fetch may not have ideal
  aggregate progress UX. This remains a low-priority presentation issue; model
  readiness and hash verification are unaffected.
- The V4 asset remains dependent on the pinned external URL or configured China
  proxy. Hash verification prevents substitution but cannot guarantee source
  availability.
