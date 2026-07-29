# Semantic Segmentation Diagnosis

## User-Visible Failure

The affected 69-minute `large-v2` output changes segmentation style after the
first high-temperature fallback near `12:14.620`. This is the primary defect;
VAD-restored 30-114 second spans are a separate timestamp defect.

A sub-second feedback script parsed the existing ASS and XXL SRT with
a fixed breakpoint. Text length uses Unicode NFKC followed by removal of Unicode
whitespace.

| Output | Median duration before/after | Median chars before/after | Tiny cue rate before/after |
|---|---:|---:|---:|
| Affected ASS | `6.92s / 2.36s` | `38 / 14` | `0.00% / 22.89%` |
| XXL reference SRT | `4.40s / 5.48s` | `31 / 35` | `7.77% / 7.26%` |

A tiny cue is at most 2 seconds and at most 10 normalized characters. The
reference demonstrates the product target: mixed speech-dependent lengths with
no persistent style collapse.

## XXL Mechanism Investigation

The local XXL `1.1.1` executable was run on an exact 20-minute PCM prefix
extracted with Hikaru Sub's current FFmpeg arguments. Its PyInstaller payload
was inspected read-only in a temporary directory to confirm defaults and prompt
control flow.

Relevant XXL defaults:

- `condition_on_previous_text=true`;
- `word_timestamps=true`;
- language-specific `initial_prompt=auto`, carried into every window;
- `prompt_reset_on_no_end=2`;
- `ignore_dupe_prompt=2`;
- non-batched inference;
- Silero v4 VAD with 3-second minimum silence and 900ms pad.

For Japanese `blend`, the auto prompt is a generic punctuation/style example,
not source-specific text. The fork reserves context space for the carried prompt
and resets accumulated history when a window longer than five characters has no
period/question/exclamation/comma character.

Controlled XXL runs:

| Variant | Cue count | Median duration | Pre/post duration ratio | Pre/post char ratio | Tiny-rate delta |
|---|---:|---:|---:|---:|---:|
| Defaults | 123 | `6.04s` | `1.012` | `0.738` | `+5.55pp` |
| Word timestamps off | 111 | `7.00s` | `1.143` | `0.878` | `-1.28pp` |
| Prompt extensions off | 190 | `3.51s` | `0.406` | `0.378` | `+25.06pp` |
| No no-end reset | 164 | `4.71s` | `0.527` | `0.481` | `+6.49pp` |
| No prompt dedupe | 121 | `6.24s` | `1.083` | `1.075` | `+10.63pp` |
| No initial prompt | 188 | `3.69s` | `0.362` | `0.378` | `+26.57pp` |

Conclusion: XXL's carried language prompt plus no-end reset is its principal
long-audio stabilizer. Word timestamps are not required inside that fork, and
prompt dedupe is secondary.

## Upstream-Supported Experiments

Copying XXL's modified generation loop is not acceptable: upstream
faster-whisper does not expose no-end reset or carried-prompt options. Partial
`get_prompt` hooks were tested and rejected:

- always-on no-end reset without word timestamps was stable but suppressed
  nearly every naturally short cue;
- carried language prompts were highly sensitive to exact sample wording and
  shifted the output between 55 and 205 cues;
- one-shot reseed and post-reset recovery failed under a real fallback stress
  run;
- punctuation/pause post-merge output changed from 143 to 88 cues as the pause
  threshold moved from 0.5 to 1.2 seconds, so it had no stable operating range.

Global word timestamps alone was also probabilistic. One direct 20-minute run
passed (`0.781 / 0.676`, tiny `+8.84pp`), while a later production run failed
(`0.307 / 0.324`, tiny `+34.16pp`). It changed the fallback probability but did
not remove the causal high-temperature state.

A controlled fallback stress used `compression_ratio_threshold=1.5` outside
production. It produced temperatures `0.6`, `0.8`, and `1.0` and reproduced the
segmentation degradation. Prompt reseed/recovery hooks did not repair it.

## Fixed Temperature: 20-Minute False Positive

The supported combination below looked viable on the exact 20-minute prefix:

```text
condition_on_previous_text = true
word_timestamps = true
temperature = 0.0
```

Two prefix runs produced byte-identical 148-cue SRT files with `5.830s / 31`
medians, pre/post ratios `0.781 / 0.662`, and tiny-cue delta `+10.13pp`.
This proved deterministic behavior only for the prefix; it did not prove
long-audio stability.

The production engine then processed the full 69-minute source. It produced 902
cues and entered a new persistent fragment regime after 40 minutes:

| Window | Cues | Median duration | Median chars | Tiny cues |
|---|---:|---:|---:|---:|
| 0-10m | 66 | `7.04s` | 38 | `1.52%` |
| 10-20m | 70 | `5.47s` | 29 | `2.86%` |
| 20-30m | 76 | `7.37s` | 45 | `0.00%` |
| 30-40m | 73 | `6.48s` | 40 | `2.74%` |
| 40-50m | 211 | `2.14s` | 13 | `31.28%` |
| 50-60m | 230 | `1.46s` | 9 | `57.39%` |
| 60m-end | 176 | `1.92s` | 11 | `39.20%` |

Fixed temperature removed stochastic fallback but not the long-lived short-cue
state. The implementation option and its test assertion were removed after this
gate failed.

## Decoder-State Follow-ups

Several narrower mechanisms were tested and rejected:

- no-end reset alone alternated between long and fragmented regimes across the
  full source (`888` cues, full median `2.36s`);
- clearing previous text every 20 decode windows fragmented 10-40 minutes
  (`926` cues, window medians `1.82-1.94s`);
- splitting at the six real `>=30s` VAD gaps removed late collapse and yielded
  `574` cues, but 20-30 minutes remained too short (`2.58s` versus XXL
  `6.67s`), so hard-gap resets are insufficient;
- carrying prior block text was discontinuous: 50 prompt characters produced
  333 cues in the test block while 75 produced 97; one complete prior cue
  produced 330 and two produced 97;
- an exact `default_ja` punctuation-token reprompt plus no-end reset through the
  public `get_prompt` seam still failed the 20-minute gate (`208` cues; post
  median `1.26s`; tiny delta `+43.17pp`).

The last result reflects an API boundary: XXL mutates `all_tokens`,
`prompt_reset_since`, and `chunk_text` inside its complete generation loop.
Upstream faster-whisper 1.2.1 exposes no public semantic-grouping or prompt-reset
callback. `hotwords` is a repeated vocabulary prompt, not a grouping contract.

## Full-Feature Runtime Baseline Experiments

A methodological error in earlier 20-minute runs was corrected: a separately
truncated WAV does not produce a feature-equivalent prefix because faster-
whisper normalizes log-Mel features against the complete input maximum. All
candidate prefix gates below computed features from the full 69-minute source
and stopped iteration only after the source timeline passed 20 minutes.

The same full PCM was also processed by the local XXL runtime. Its log exposed
17 Silero V4 speech chunks, `3539.400s` retained speech, and `604.856s` removed.
Official Silero VAD tag `v4.0` at commit `915dd3d6` with a 1536-sample window
reproduced all 17 boundaries exactly. Current faster-whisper V6 produced 43
chunks and `3432.160s` retained speech. The two VAD shapes materially changed
prompt context.

The runtime also differed by compute precision. XXL selected
`int8_float16`; Hikaru Sub resolved CUDA to `float16`. With official V4, full-
feature input, the carried Japanese blend prompt, aligned words, and word-end
seek refinement enabled, changing only `float16 -> int8_float16` changed the
20-minute gate from a failed `145`-cue run to a stable `119`-cue run. The latter
then passed the full source, but over-15-second cues reached 11.57%, so seek
refinement was rejected as an overlong bias.

The accepted long candidate disables word-end seek refinement and fixes the
CTranslate2 runtime seed before model construction:

```text
Silero V4 / 1536 samples
threshold 0.45 / min speech 250ms / min silence 3000ms / pad 900ms
CTranslate2 4.8.0 / CUDA int8_float16 / random seed 0 before model load
carried generic Japanese blend prompt + punctuation seed
previous-text conditioning + grouped-window no-end reset
word timestamps returned, timestamp tokens advance decoder seek
```

## Deterministic Runtime Validation

Formal validation found that the otherwise identical long configuration was not
reproducible without an explicit CTranslate2 seed. Two independent unseeded
production runs over the same full feature stream produced `73` versus `99` cues
in the first 20 minutes. After calling `ctranslate2.set_random_seed(0)` before
long model load, repeated 20-minute SRT outputs were byte-identical.

The seeded full 69-minute run produced:

| Metric | Seeded candidate |
|---|---:|
| Cues | `456` |
| Post/pre duration ratio | `0.895` |
| Post/pre normalized-character ratio | `0.932` |
| Tiny-cue delta | `+1.60pp` |
| Cues over 15s | `2.85%` |
| Cues over 20s | `1.10%` |
| Cues over 30s | `0` |
| Original XXL normalized-text similarity | `90.1018%` |

Every ten-minute median duration remained within `4.37-8.48s`, and every tiny-
cue rate was at most `6.10%`. There was no sustained 1-3-second regime and no
compensating overlong bias. Final production bounding left zero invalid events,
zero adjacent overlaps, and zero events spanning the six known source gaps.
The same-PCM behavioral control's post/pre duration ratio remains `0.603`, so
rolling-window stability is still the decisive gate and the scalar `0.70`
threshold remains a coarse regression alarm.

## Short-Corpus Isolation

Applying V4 or the carried blend prompt globally regressed the verified
498.872-second source:

- V4 + blend: `81.3127%` verified-text similarity;
- V4 + punctuation-only: `83.9542%`;
- historical faster-whisper: `88.7440%`.

A fresh default upstream V6/no-extension/no-word-timestamp CUDA `float16` run
selected the intended short route but scored `88.1201%`, below historical
`88.7440%`. Applying seed `0` to the same short runtime still failed at
`88.3077%`, so long-mode determinism must not be extended to short recordings.

Independent ordinary upstream/V6/no-prompt/no-V4 CUDA `int8_float16` runs
produced `90.3198%` (203 cues), `89.5172%` (197 cues), and `90.5578%` (202 cues).
The earlier `90.5578%` run also had 93.33% verified boundary coverage within 1.5
seconds versus historical 95.76%. This supports two independent narrow gates:
recordings below 10 minutes retain upstream decode/V6 behavior, and only ordinary
Japanese `large-v2` with default non-CPU compute selects `int8_float16`. V4,
the fork prompt, word timestamps, and the fixed seed remain long-only.

## Final Decision

Keep scope A, but select the generation-loop fork and V4 runtime only for
Japanese ordinary `large-v2` sources of at least 600 seconds. Preserve the
upstream short decode/V6 and Kotoba paths. For ordinary short Japanese
`large-v2` only, unset/`auto`/`default` compute uses `int8_float16` on effective
non-CPU devices and `int8` on CPU; explicit compute remains honored. Resolve
long CUDA to `int8_float16`, pin CTranslate2 4.8.0, and call
`ctranslate2.set_random_seed(0)` immediately before long model load. Short mode
and Kotoba do not call or change this seed. Manage the official 1.8 MiB V4 ONNX
through the existing model download/cache flow rather than bundling model
weights.

No completed-cue semantic formatter is added. The only post-decode changes are
aligned-word repair for actual 30-second holes and timestamp-bound clamping.
