# VAD Boundary Experiments

## Decision

Use ordinary faster-whisper decoding with `condition_on_previous_text=true` and
`word_timestamps=false`. Reproduce faster-whisper's existing VAD compression so
the adapter retains the source speech chunks and their compressed-timeline
boundaries. Treat only source gaps of at least `30s` as hard boundaries.

Do not force decode clips and do not enable global word timestamps. If one raw
segment crosses a hard compressed boundary, align only that segment's already
decoded tokens against its existing encoder window. Use the resulting word
alignment to tighten or split that parent. Every other raw segment passes
through unchanged.

## Why the Earlier Candidate Failed

The first implementation enabled `word_timestamps=true` globally and split any
aligned word gap of at least `2s`. The 15-minute validation rejected it:

- raw group count changed from `142` to `114` before the helper ran;
- normalized full-text distance was `4.3272%`;
- only `37` exact text-group matches remained;
- three short aligned gaps of `3.36-4.22s` were also split, including lexical
  boundary fragments.

The detailed failure evidence is in `validation.md`.

## Experiment A: Decode Clip Boundaries

### Method

The adapter-equivalent VAD process was reproduced outside the repository:

1. detect speech with faster-whisper's default `VadOptions`;
2. concatenate the same speech chunks;
3. derive compressed cut points for source gaps of at least `30s`;
4. decode with `word_timestamps=false`, previous-text conditioning enabled, and
   `clip_timestamps` split at those cut points;
5. restore source timestamps with upstream's timestamp map.

A manual-VAD control without clip boundaries was run in the same model process.

### 15-minute results

| Metric | Built-in baseline | Manual-VAD control | Clip candidate |
|---|---:|---:|---:|
| Raw groups | 109 | 112 | 115 |
| Normalized chars | 3,727 | 3,762 | 3,762 |
| Confirmed 92.512s gap spans | 1 | 1 | 1 |

The manual control matched the first `86` baseline groups exactly with zero
timestamp delta; later differences coincided with the known temperature
fallback and demonstrate the existing run-to-run instability.

The clip candidate matched only the first `34` control groups contiguously and
had `1.6215%` normalized text distance from the control. It also failed to
remove the spanning event. The compressed cut at `253.216s` is not exactly on
faster-whisper's 10/20ms decode timestamp grid, so restoration assigned the
rounded segment end to the next VAD chunk. More importantly, ending the decode
clip changed the subsequent token/prompt path.

**Verdict: rejected.** Timestamp clamping could hide the first symptom but
would not fix the global decode drift.

## Experiment B: Local Token Alignment

### Method

The successful prototype keeps a single ordinary decode:

1. run the same VAD and concatenate speech chunks;
2. decode the compressed audio with `word_timestamps=false` and
   `condition_on_previous_text=true`;
3. identify raw segments whose compressed start/end straddle a source VAD gap
   of at least `30s`;
4. group only the affected decode window's existing segments by `seek`;
5. call faster-whisper's alignment operation with those existing token IDs and
   the same encoder window;
6. verify aligned word text reconstructs the raw parent exactly after Unicode
   NFKC plus whitespace removal;
7. partition aligned words by the real compressed VAD boundary and map each
   child through `SpeechTimestampsMap`;
8. fall back to the untouched raw parent if alignment, text preservation, or
   timestamp invariants fail.

This alignment does not decode new text. It changes neither the token prompt nor
ordinary raw grouping.

### 15-minute gate

The prefix had one `92.512s` hard gap and one raw crossing parent.

| Metric | Result |
|---|---:|
| Raw groups | 112 |
| Crossing parents | 1 |
| Aligned windows | 1 |
| Alignment wall time | 0.246s |
| Parent tokens / aligned words | 27 / 23 |
| Normalized text preserved | yes |
| Raw-to-emitted full text preserved | yes |
| Raw / emitted gap spans | 1 / 0 |
| Invalid timestamps / overlaps | 0 / 0 |

All `23` aligned words were on the pre-gap side. The parent therefore remained
one event with the same text and grouping; only its restored interval tightened
to `285.410-292.690s` instead of spanning the removed silence.

**Verdict: passed.**

### Full 69-minute gate

The full VAD result contains `43` speech chunks and `3432.160s` retained audio.
The approved `30s` threshold found six hard gaps, not only the four largest gaps
listed in the original diagnosis:

| Source gap | Duration | Raw spans | Emitted spans |
|---|---:|---:|---:|
| `04:52.944-06:25.456` | 92.512s | 1 | 0 |
| `18:08.976-20:03.248` | 114.272s | 1 | 0 |
| `32:40.656-34:22.096` | 101.440s | 1 | 0 |
| `53:37.424-55:25.744` | 108.320s | 1 | 0 |
| `56:06.160-56:36.464` | 30.304s | 1 | 0 |
| `63:25.424-64:07.536` | 42.112s | 1 | 0 |

Aggregate results:

| Metric | Result |
|---|---:|
| Decode wall time | 347.658s |
| Raw / emitted groups | 472 / 474 |
| Target parents / aligned windows | 6 / 6 |
| Total local alignment wall time | 1.442s |
| Child counts per parent | 1, 2, 1, 1, 2, 1 |
| All target alignments preserved text | yes |
| Raw-to-emitted full text preserved | yes |
| Raw invalid timestamps / overlaps | 0 / 0 |
| Emitted invalid timestamps / overlaps | 0 / 0 |

Four parents only needed their interval tightened to the aligned words on one
side of the gap. Two parents contained aligned words on both sides and were
split into two children. Every generated child had non-empty aligned text,
positive duration, source bounds, and ordered siblings.

The fresh decode had `95.0516%` normalized similarity to the historical affected
ASS and `83.9235%` to the original XXL SRT. The historical affected ASS had
`85.4639%` similarity to that SRT, so the fresh run was `1.5404` points lower.
This is not a transformation regression: the prototype's raw and emitted text
were exactly identical. The difference is between two independent
faster-whisper decodes and is consistent with the already documented fallback
instability. The XXL SRT is an external reference rather than a byte-equivalent
oracle.

**Verdict: passed for the transformation and all six hard boundaries.**

## Verified 8-minute Corpus

A separate `498.872s` source was checked against its human-corrected
`video_h_32_1.verified.ass` reference.

- default VAD produced `10` speech chunks;
- the largest internal source gap was `7.008s`;
- no gap met the `30s` threshold;
- local alignment invocation count was `0`;
- the fresh candidate had `245` raw events with zero invalid timestamps or
  overlaps;
- candidate/reference normalized similarity was `88.3516%`;
- historical faster-whisper/reference similarity was `88.7440%`;
- the fresh run was `0.3924` points lower and `96.5667%` similar to the
  historical faster-whisper output.

Because the hard-gap path was never invoked, the small difference from the
historical file is another independent-decode delta, not a transformation
change. This corpus establishes that the approved threshold leaves ordinary
short-audio segmentation untouched.

## Streaming and Memory Experiment

A local 30-second audio slice was tested as a replacement for the original
full feature matrix. It was not feature-equivalent because faster-whisper
normalizes log-Mel values against the full input maximum:

- mean absolute feature delta ranged from `0.0061` to `0.0355`;
- exact-value coverage ranged from `75.63%` to `92.56%` across the six windows.

Do not use unverified local feature extraction in the first implementation.
When at least one hard VAD gap exists, compute one temporary full compressed
feature matrix and reuse it for all affected windows. For this corpus the
80-channel float32 matrix is about 105 MiB. Inputs with no `>=30s` hard gap do
not need this matrix or any alignment work. The raw segment iterator still only
needs to buffer one shared-`seek` decode window at a time.

## Implementation Consequences

- Remove global `word_timestamps=true` and the `2s` word-gap helper.
- Do not force `clip_timestamps` boundaries.
- Keep Kotoba's current specialized decode options and path unchanged.
- Reuse faster-whisper's VAD, token alignment, and timestamp-map primitives;
  add no dependency and no second transcription pass.
- Treat internal faster-whisper API availability as an explicit compatibility
  check covered by focused tests.
- Preserve existing public sidecar, Tauri, job, and frontend contracts.
