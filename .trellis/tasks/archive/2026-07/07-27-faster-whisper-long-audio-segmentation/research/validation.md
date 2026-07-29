# Private-Corpus Validation

## Verdict

**FAIL - the 15-minute rollback gate was triggered.**

The candidate fixed the confirmed `92.51s` VAD-restoration bridge, and its
generated children passed the measured timestamp and text-preservation
invariants. However, globally enabling `word_timestamps` materially changed
ordinary upstream grouping and recognized text, and the `2.0s` aligned-gap
threshold also split three short aligned gaps that were not independently
verified as VAD chunk boundaries, producing poor word-boundary fragments.

Per `implement.md`, the full 69-minute inference was **not run** after this
gate failed. The implementation must return to planning and investigate
exposing VAD chunk boundaries without globally enabling `word_timestamps`.

## Scope And Safety

- Validation date: `2026-07-27`.
- This report was completed from the existing 15-minute result plus CPU-only
  parsing of the historical subtitles. No Whisper/faster-whisper inference was
  run while completing the report, and no GPU was used.
- All subtitle comparisons in this report are limited to records whose start
  time is below `900s`; they are not full-corpus metrics.
- Results are aggregate-only. Private subtitle text, generated subtitle bodies,
  raw logs, local paths, cache details, and temporary workspace identifiers are
  intentionally omitted.

## Existing Run Environment

| Item | Value |
|---|---|
| Python | `3.11.15` |
| faster-whisper | `1.2.1` |
| CTranslate2 | `4.8.0` |
| Existing-run accelerator | NVIDIA RTX 3070 8 GB |
| Existing-run device / compute | `cuda` / `float16` |
| Model load wall time | `4.670s` |
| Source audio | 16 kHz PCM, `4144.256s` (`69:04.256`) |
| Source PCM SHA-256 | `ba8bef9ac6433bcd66721a32c9ae0fd58a10b309c758ddf03f45f8eeaf27cf6d` |
| Diagnostic prefix | First `900.000s`; verified as an exact PCM payload prefix |
| Prefix after VAD | `731.440s` retained; `168.560s` removed |

## Exact Parameters

Both existing prefix runs used `large-v2`, `language="ja"`, `beam_size=5`,
`vad_filter=true`, `vad_parameters=None` (faster-whisper defaults), and
`condition_on_previous_text=true`. The baseline used
`word_timestamps=false`; the candidate changed only that option to
`word_timestamps=true`, then applied the current helper's `2.0s` aligned-word
hard-gap threshold. The candidate did not use sentence mode, character or
duration limits, punctuation splitting, or a second transcription pipeline.

## 15-Minute Performance And Grouping

| Metric | Baseline | Candidate raw | Candidate emitted |
|---|---:|---:|---:|
| Wall time | `78.160s` | `71.563s` | same inference |
| Real-time factor | `0.0868` | `0.0795` | same inference |
| Segment count | `142` | `114` | `118` |
| Median duration | `5.600s` | `6.240s` | `6.000s` |
| P90 duration | `9.228s` | `9.382s` | `9.242s` |
| Events over 8 seconds | `29` | `28` | `26` |
| Median normalized chars | `25.5` | `34.0` | `33.0` |
| P90 normalized chars | `51.9` | `56.4` | `55.6` |
| Events over 40 chars | `35` | `35` | `35` |

The candidate was `8.44%` faster in this one run, but performance does not
offset the compatibility failure. The baseline had `136` temperature-`0`
segments and `6` temperature-`0.6` segments, with the first fallback beginning
at `734.620s`. All `114` candidate raw segments used temperature `0`. This is
additional evidence that enabling alignment changed decoding behavior beyond
the four targeted parent segments.

## Candidate Versus Baseline Text

Normalization is Unicode NFKC followed by removal of every Unicode whitespace
code point; punctuation and case are retained. RapidFuzz Levenshtein metrics:

| Metric | Result |
|---|---:|
| Candidate normalized chars | `3773` |
| Baseline normalized chars | `3790` |
| Edit distance | `164` |
| Distance / baseline chars | `4.3272%` |
| RapidFuzz normalized similarity | `95.6728%` |
| Candidate length coverage | `99.5515%` |
| Exact text-group matches | `37` |
| Baseline groups without exact match | `105` |
| Candidate groups without exact match | `77` |
| Exact text-and-timing matches | `0` |

Exact text-group matches were calculated by applying the stated normalization
to each raw segment text and running Python `SequenceMatcher` with
auto-junk detection disabled over the two ordered text lists. Among the `37`
exact text-group matches, median absolute start/end deltas were `140ms` /
`600ms`, and P90 deltas were `576ms` / `1700ms`.

The candidate had `114` raw groups before the helper ran, versus `142` in the
baseline. The helper then split only `4` candidate parents and increased the
emitted count to `118`; it cannot explain the upstream raw-count reduction of
`28`. Together with only `37` exact group matches and `164` full-text edits,
this demonstrates global non-target behavior change. A precise per-segment
non-gap correspondence is not available because enabling alignment changed the
ordered raw segment sequence itself; the raw-count and concatenated-text
comparisons are the conservative auditable evidence for the rollback gate.

## Splits And Invariants

The helper found `4` aligned-gap parents and emitted `8` children, with no
aligned-gap fallback. The measured internal gaps were:

| Gap | Classification | Result |
|---:|---|---|
| `92.51s` | Confirmed VAD-removed bridge | Fixed; covering events reduced from `1` to `0` |
| `3.87s` | Short aligned gap; VAD boundary not independently verified | Split at a lexical boundary fragment |
| `4.22s` | Short aligned gap; VAD boundary not independently verified | Isolated a single-character child |
| `3.36s` | Short aligned gap; VAD boundary not independently verified | Split at a lexical boundary fragment |

The three short-gap classifications come from their measured aligned-word
timings only. Manual inspection of the generated child boundaries established
the fragment results; no private text is retained here. Because the validation
did not independently map those intervals to VAD chunks, they must not be
claimed as confirmed removed-silence boundaries. This is exactly the missing
signal in the current helper.

Candidate invariant results:

- `0` split text-preservation failures; concatenated emitted normalized text
  exactly matched candidate raw normalized text.
- `0` split-sibling overlaps.
- `0` invalid raw timestamps and `0` invalid emitted timestamps.
- `0` raw or emitted adjacent-event overlaps.
- All candidate events were non-negative, positive-duration, ordered, and
  bounded by the 900-second source prefix.

The baseline aggregate reported one invalid timestamp event and no overlap.
Inspection showed a positive-duration final event ending `1.08s` beyond the
900-second prefix boundary; there were no negative starts or non-positive
durations. No associated subtitle text was retained in this report.

## 15-Minute Reference Comparisons

Historical `video_h_31.faster-whisper-v2.ass` and reference
`video_h_31.ja.srt` records were parsed and clipped to `start < 900s` before
comparison. Normalization is exactly Unicode NFKC followed by removal of every
Unicode whitespace code point; punctuation and case are retained. Distances
use RapidFuzz Levenshtein.

| Comparison (left vs right) | Cues | Normalized chars | Edit distance | Distance / right | Normalized similarity | Length coverage |
|---|---:|---:|---:|---:|---:|---:|
| Candidate vs historical ASS | `118 / 111` | `3773 / 3776` | `139` | `3.6811%` | `96.3189%` | `99.9206%` |
| Candidate vs reference SRT | `118 / 126` | `3773 / 4154` | `841` | `20.2455%` | `79.7545%` | `90.8281%` |
| Historical ASS vs reference SRT | `111 / 126` | `3776 / 4154` | `831` | `20.0048%` | `79.9952%` | `90.9003%` |

Against the reference SRT, the candidate changed normalized similarity by
`-0.2407` percentage points and right-denominator edit rate by `+0.2407`
percentage points relative to the historical ASS. This is a small 15-minute
text-quality regression, while the grouping compatibility regression is much
larger.

The SRT was produced by Faster-Whisper-XXL `1.1.1` using `large-v2`. It is an
external text/timing reference rather than a cue-count or exact-output oracle.

## Acceptance Criteria Status

| Criterion | Status | Evidence |
|---|---|---|
| Full corpus spans none of four confirmed 30+ second gaps | **Not satisfied** | Full 69-minute inference was deliberately not run after the 15-minute rollback gate failed. |
| Synthetic hard-gap segment splits deterministically | **Not assessed here** | Private-corpus report does not replace focused unit-test evidence. |
| Synthetic no-hard-gap segment remains unchanged | **Not assessed here** | Private-corpus report does not replace focused unit-test evidence. |
| Targeted splitting preserves normalized text in order | **Satisfied for 15m candidate** | `0` failures; raw-to-emitted normalized text preservation was true. |
| Generated children have valid, ordered, bounded timestamps | **Satisfied for 15m candidate** | `0` invalid candidate events and `0` split-sibling overlaps. |
| Ordinary previous-text conditioning and Kotoba options remain compatible | **Partially assessed** | Existing ordinary runs used `condition_on_previous_text=true`; Kotoba was not exercised by this corpus validation. |
| Alignment does not generally reformat non-gap segments | **Failed** | Raw count changed `142 -> 114`, only `37` exact text-group matches remained, and full text had `164` edits. |
| Reference text quality does not materially regress | **Not fully satisfied** | 15-minute similarity declined `0.2407` points; full-corpus comparison was not run. |
| Full sidecar unit suite passes | **Not assessed here** | No tests were run while completing this existing-results-only report. |
| Development and packaged helper copies are synchronized | **Satisfied** | Byte comparisons passed for both changed engine pairs: `faster_whisper.py` and `kotoba_faster_whisper.py`. |

## Required Planning Rollback

Do not proceed to full-corpus inference with global `word_timestamps=true` and
the `2.0s` word-gap policy. Return to design and investigate obtaining or
exposing VAD chunk-boundary evidence without globally enabling word alignment.
The replacement must distinguish true VAD-removed boundaries from ordinary
pauses and preserve ordinary non-gap upstream grouping and recognized text.
