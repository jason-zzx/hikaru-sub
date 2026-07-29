# Technical Design

## 1. Decision

Use two mutually exclusive ordinary faster-whisper paths selected before model
load from the source WAV header.

```text
ordinary faster-whisper request
  -> source duration / language / model selection
  -> short or unsupported scope
       upstream WhisperModel + current V6 VAD + current options
       ordinary Japanese large-v2 < 10 minutes + default non-CPU compute
         -> int8_float16
       otherwise -> existing compute resolver
  -> Japanese large-v2 >= 10 minutes
       CTranslate2 random seed 0 before model load
       forked model + int8 runtime
       official Silero V4 compression
       carried Japanese blend/punctuation prompt
       timestamp-token seek + aligned words
       source timestamp restoration
       hard-hole repair + universal timestamp bounding
```

This is not a postprocessor for semantic grouping. Long cue boundaries still
come from Whisper timestamp tokens. The adapter only repairs proven 30-second
word holes and clamps invalid neighboring time bounds.

## 2. Why The Path Is Conditional

The full 69-minute corpus requires the combined long runtime. The separate
498.872-second corpus does not:

- global V4 plus punctuation seed fragmented the short corpus to 229 cues and
  reduced verified-text similarity to 83.95%;
- global carried blend prompt reduced similarity further to 81.31%;
- a fresh upstream V6/no-extension CUDA `float16` run scored `88.1201%`, below
  the historical `88.7440%`, while adding the long seed scored only `88.3077%`;
- independent upstream V6/no-extension/no-word-timestamp CUDA
  `int8_float16` runs passed at `90.3198%` (203 cues), `89.5172%` (197 cues),
  and `90.5578%` (202 cues).

The source issue was reported absent below ten minutes. A `600_000ms` source
threshold therefore isolates the proven failure class and preserves the upstream
short decode/V6 path. The only short change is the repeatedly verified default
compute baseline for ordinary Japanese `large-v2` on non-CPU devices. The
long/short decision is made before transcription model selection so one job
still owns only one model instance at a time.

Long mode is initially limited to the exact validated scope: ordinary
`faster-whisper`, Japanese, and model key `large-v2`. Kotoba overrides model and
options as before.

## 3. Long Runtime Contract

### Compute baseline

The accepted full run used faster-whisper 1.2.1, CTranslate2 4.8.0, CUDA
`int8_float16`, and `large-v2`. Pin both packages. Long CUDA/auto jobs resolve to
`int8_float16`; an auto-device load failure retains the existing CPU fallback,
which uses `int8`.

For the ordinary upstream short path, override the generic resolver only when
all of these are true: model key `large-v2`, request language `ja`, source below
`600_000ms`, compute type unset/`auto`/`default`, and effective device non-CPU.
That narrow case uses `int8_float16`; CPU uses `int8`. Explicit compute types,
non-Japanese requests, other models, and Kotoba retain their existing resolver.
If public `load()` created a generic short model before duration/language were
known, compare the loaded compute and effective device at transcription time,
release it before loading the target compute, and avoid further reloads once the
selection matches. If an auto-device short model is constructed but warmup
fails, clear the failed model and traceback-held references before constructing
the CPU fallback so only one model is retained.

Immediately before constructing the long model, call
`ctranslate2.set_random_seed(0)`. This placement matches formal validation and
covers both model construction and decode. The seed is a fixed module contract,
not a user option. Short mode and Kotoba never request fixed seed `0`.

Because CTranslate2 seed state is process-global, the product `JobManager`
serializes only `faster-whisper` and `kotoba-faster-whisper` inference under one
process-wide lock. The critical section begins before `engine.transcribe(...)`
creates its handle and ends only after the lazy segment iterator exhausts or is
explicitly closed during cancellation/error cleanup. Other engines remain
concurrent. Direct Python callers of either Whisper-family engine must wrap
handle creation and complete iteration in `whisper_inference_session`; a long
call without an active session fails before seed `0` is set.

Every seeded long session replaces seed `0` with a fresh system-random nonzero
seed before releasing the lock. This cleanup restores normal nondeterministic
short/Kotoba fallback; it does not make those paths deterministic or seed them
with `0`. If the reset fails and runtime state is unknown, the process-wide
Whisper runtime is poisoned before unlock and rejects later faster-whisper and
Kotoba sessions until the sidecar process restarts. Non-Whisper engines remain
available.

### Silero V4

Use the official `snakers4/silero-vad` `v4.0` ONNX artifact from commit
`915dd3d639b8333a52e001af095f87c5b7f1e0ac`. Expected SHA-256:

```text
a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28
```

The model receives 1536-sample windows at 16 kHz and carries its documented
hidden/cell state between windows. A project-owned V4 helper implements the
ordinary threshold state machine from independently specified VAD behavior and
returns source sample ranges. It does not reuse XXL code.

Default long parameters:

```text
threshold = 0.45
min_speech_duration_ms = 250
min_silence_duration_ms = 3000
speech_pad_ms = 900
```

Custom session VAD values replace the corresponding defaults. Keep the existing
maximum-speech option when provided.

Use faster-whisper's public audio decode, chunk collection, and source timestamp
restoration helpers around one `model.transcribe(..., vad_filter=false)` call.
This produces one VAD pass, one compressed feature matrix, one decode, and one
word alignment pass.

## 4. V4 Asset Lifecycle

Do not put the ONNX in source or Tauri resources.

`FasterWhisperEngine.is_model_downloaded("large-v2")` requires both the normal
Whisper snapshot and the verified V4 asset. `download_model` downloads the small
asset through the existing model confirmation path into:

```text
$HF_HOME/hikaru-sub/silero-vad-v4/silero_vad.onnx
```

When `HF_HOME` is absent in source development, use the normal Hugging Face cache
root. Download to a sibling temporary file, stream SHA-256 while downloading,
verify size/hash, then replace atomically. Delete failed partial files.

The official source is the raw file at the pinned Silero GitHub tag. When the
existing `HF_ENDPOINT` is `https://hf-mirror.com`, use the project's configured
GitHub proxy form for the same pinned URL. This keeps source selection aligned
without changing Tauri contracts.

At transcription time, missing/corrupt V4 raises a clear `AsrError`; there is no
silent V6 fallback for long mode. The application already prompts model download
when readiness is false.

## 5. Prompt-State Fork

Retain the mechanically comparable faster-whisper 1.2.1
`WhisperModel.generate_segments` fork and its compatibility guard.

Long Japanese mode reserves an immutable prompt seed consisting of:

1. independently tokenized `！`, `？`, `、`, `。`;
2. the generic Japanese blend prompt used in the controlled experiment:
   `こんにちは、最初の文です。そしてこれが2つ目です。少し休憩してください...そして戻ってきます。`

The seed is present in every decode window and consumes the existing half-context
previous-text budget. Newest recognized history fills only the remaining budget.

After grouping current timestamp-token segments, concatenate
`tokenizer.decode(segment["tokens"])` for every current segment before skip
checks. If stripped text is longer than five characters and contains none of
`。！？!?、，,`, move the same `prompt_reset_since` boundary used by upstream
temperature reset. The immutable seed and already recognized output remain.

Long mode returns word timestamps but keeps
`word_timestamp_seek_refinement_enabled=false`. Timestamp tokens, not aligned
word ends, advance decoder seek. Short mode constructs upstream `WhisperModel`
and does not activate this fork.

## 6. Hard-Hole And Bounds

After source timestamp restoration, use the existing aligned-word hard-hole
repair:

1. validate finite, monotonic words and normalized text equality;
2. split only consecutive words separated by at least 30 seconds;
3. tighten a segment edge only when its nearest word proves a 30-second edge
   hole;
4. preserve raw text atomically on failure.

One-segment lookahead then bounds every output parent/child, including ordinary
no-hole parents:

- lower bound: zero and previous emitted end;
- upper bound: source duration and next raw start when that remains after the
  lower bound;
- preserve `end > start` and raise a clear error if valid bounds cannot preserve
  the event.

The accepted prototype had 21 restored-word overlaps of 20-1100ms. Clamping the
current start/end at shared neighbor boundaries left every cue positive; no
semantic merge or split was required.

## 7. Compatibility

- `AsrSegment`, `Transcription`, HTTP/job/Tauri/frontend shapes do not change.
- Model download readiness gains the V4 requirement only for ordinary
  `large-v2`.
- Short audio retains upstream options, V6 VAD, prompt behavior, and no global
  word timestamps; only default ordinary Japanese `large-v2` non-CPU compute is
  narrowed to `int8_float16`.
- Explicit compute selections and non-target model/language requests retain the
  existing resolver.
- Kotoba continues using upstream `WhisperModel`, `chunk_length=15`,
  `condition_on_previous_text=false`, and its existing compute selection.
- The fork guard validates exact faster-whisper 1.2.1 internal signatures.
- CTranslate2 is pinned to 4.8.0 because compute-version drift changes decode
  tokens and therefore prompt state.
- Only ordinary long mode initializes CTranslate2 with fixed seed `0` before
  model load. Product Whisper-family jobs share one process-wide inference lock
  through lazy iteration; direct callers must use the same session wrapper.
  Long-session cleanup restores a fresh nonzero random seed before unlock, or
  poisons later Whisper-family inference until sidecar restart if reset fails.
  Short mode and Kotoba never request fixed seed `0` themselves.
- Auto-device warmup failure releases the failed GPU model before constructing
  CPU fallback, preserving the one-model-per-job invariant.

## 8. Test Strategy

### Deterministic unit tests

- duration/model/language routing at 599999/600000ms;
- seed `0` before long model load, random nonzero reset on exhaustion, close,
  handle error, and lazy error, with no fixed-seed request from short or Kotoba;
- reset failure poisons waiting/future Whisper-family sessions before handle
  creation without blocking non-Whisper jobs, including body-plus-reset errors;
- direct long calls without an inference session fail before seed `0` is set;
- shared faster-whisper/Kotoba lock coverage across handle creation and lazy
  iteration, cancellation/error release, and unaffected concurrency for other
  engines;
- short upstream model/options and long fork/compute selection;
- default short Japanese `large-v2` compute for unset/`auto`/`default`, explicit
  override, CPU, non-Japanese, other-model, Kotoba, and preload/reload lifecycle;
- V4 state initialization, 1536 padding, threshold transitions, padding, custom
  options, and cancellation/errors;
- asset URL selection, hash validation, atomic replacement, missing/corrupt
  readiness, and no model file in git;
- carried blend/punctuation seed order and prompt budget;
- grouped-window no-end and temperature resets;
- extension-disabled upstream parity;
- production aligned words with seek refinement disabled;
- hard-hole text preservation and ordinary overlap clamping;
- Kotoba isolation.

### Private corpus

Formal validation first showed that unseeded independent production runs over
one full feature stream were not reproducible: their first 20 minutes contained
`73` versus `99` cues. With CTranslate2 seed `0`, repeated 20-minute outputs were
byte-identical and the full candidate produced:

- 456 cues;
- post/pre ratios `0.895` duration and `0.932` normalized characters;
- tiny-cue delta `+1.60` percentage points;
- ten-minute median durations within `4.37-8.48s` and tiny rates at most `6.10%`;
- `2.85%` cues over 15 seconds, `1.10%` over 20 seconds, none over 30 seconds;
- `90.1018%` normalized text similarity to the original XXL reference;
- zero final events spanning the six known source gaps, zero invalid bounds, and
  zero adjacent overlaps.

The same-PCM XXL control itself has a post/pre duration ratio of 0.603 because
its first ten minutes are unusually long. Therefore rolling-window stability is
the decisive gate; the scalar threshold is a coarse regression alarm, not a
standalone oracle.

The accepted short compute baseline produced `90.3198%` (203 cues), `89.5172%`
(197 cues), and `90.5578%` (202 cues) verified-text similarity versus historical
`88.7440%`, with no V4, fork prompt, word timestamps, or fixed seed. Fresh
`float16` (`88.1201%`) and `float16` plus seed `0` (`88.3077%`) runs failed the
same gate, so the seed remains long-only.

## 9. Residual Risks

- Long behavior is validated only for Japanese `large-v2` and the pinned runtime.
- The 10-minute boundary is product evidence, not an upstream guarantee; expand
  scope only with another full corpus.
- CPU long-mode semantics are not private-corpus validated; the existing CPU
  fallback remains functional but should be reported as residual risk.
- Product `JobManager` Whisper-family inference is intentionally serialized
  within one sidecar process to isolate process-global CTranslate2 seed state.
  Direct Python callers must use `whisper_inference_session`; parallel Whisper
  throughput requires separate sidecar processes. A failed post-long seed reset
  disables Whisper-family inference until that sidecar process restarts, while
  non-Whisper engines remain available.
- The V4 artifact depends on a pinned external URL. Hash validation prevents
  substitution, while availability still depends on the selected download path.
- The existing progress callback does not present one combined Whisper-plus-V4
  total; the final V4 fetch can have imperfect aggregate progress UX. Readiness
  and integrity behavior are unaffected, so no progress redesign is included.
- CTranslate2 short outputs remain runtime-variable across independent runs;
  three `int8_float16` runs passed the verified threshold, but future runtime or
  model changes still require renewed corpus comparison.
- Prompted long decode may alter recognized text. Full and short reference
  comparisons remain mandatory for future runtime upgrades.
