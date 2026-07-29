# Fix faster-whisper long-audio semantic segmentation

## Goal

Keep `large-v2` Japanese segmentation semantically useful across long audio:
cues may be long or short when speech warrants it, but decoder state must not
cause a persistent transition to mostly tiny fragments. Preserve the upstream
short-audio decode/V6 path because the reported defect is absent below ten
minutes, while using the separately verified short CUDA compute baseline.

Use the XXL SRT as the behavioral reference. Exact cue or text identity is not
required because it is an external rather than byte-equivalent baseline, but
the result must retain mixed, editable boundaries without sustained
fragmentation or a compensating overlong-cue bias.

## Background

- The affected ASS changes near the first high-temperature fallback at
  `12:14.620`: median duration `6.92s -> 2.36s`, normalized characters
  `38 -> 14`, and tiny cues `0% -> 22.89%`.
- The original XXL reference remains mixed across that breakpoint:
  `4.40s -> 5.48s`, `31 -> 35`, and `7.77% -> 7.26%` tiny cues.
- Full-corpus experiments rejected fixed temperature, periodic reset, no-end
  reset alone, hard-gap block restart, public prompt hooks, and fixed semantic
  post-processing. Several passed a 20-minute prefix and failed after 40 minutes.
- The accepted generation-loop fork initially still failed on the full source.
  The missing variables were the VAD/runtime baseline and carried prompt shape,
  not another completed-cue formatter.
- Official Silero V4 tag `v4.0` with a 1536-sample window reproduced the
  reference runtime's 17 speech chunks exactly: `3539.400s` retained and
  `604.856s` removed. Current faster-whisper V6 produced 43 chunks and removed
  `712.096s`.
- The validated long path uses CTranslate2 `int8_float16`, the carried generic
  Japanese blend prompt, and timestamp-token seek grouping while still returning
  aligned words. Word-end seek refinement made cues materially too long and is
  disabled.
- Formal validation found CTranslate2 runtime randomness material: independent
  unseeded runs over the same full feature stream produced `73` versus `99` cues
  in the first 20 minutes. Calling `ctranslate2.set_random_seed(0)` before long
  model load produced byte-identical repeated 20-minute outputs and a stable full
  run.
- A fresh default short CUDA `float16` run selected the correct upstream/V6 path
  but scored `88.1201%`, below the historical `88.7440%`; adding seed `0` still
  failed at `88.3077%`. Independent upstream/V6/no-prompt/no-V4 short runs using
  `int8_float16` passed at `90.3198%`, `89.5172%`, and `90.5578%`.
- The source also contains six known long transition gaps. No accepted output
  may span those gaps or emit invalid/overlapping timestamps.

## Requirements

### R1. Select long mode narrowly

- Long semantic mode activates only for ordinary `faster-whisper`, Japanese,
  model key `large-v2`, and source WAV duration at least `600_000ms`.
- Read duration from the project-standard WAV header before loading the model;
  do not decode audio merely to choose the mode.
- Short audio, Kotoba, other models, and non-Japanese requests keep their
  existing upstream V6 path, prompt behavior, and transcription options.
- Only ordinary short Japanese `large-v2` with an unset/`auto`/`default` compute
  type changes its default compute baseline: effective non-CPU loads use
  `int8_float16`, while CPU uses `int8`. Explicit compute types remain honored.
- A public `load()` may initially create the generic upstream short model before
  audio duration/language are known. Transcription reloads only when the selected
  short compute differs, releases the previous model first, and never retains two
  model instances.
- Each job loads only one Whisper model at a time; do not retain simultaneous
  short/long or alternate-compute model instances.

### R2. Use the validated long runtime

- Long CUDA/auto mode uses `int8_float16`; CPU fallback uses `int8`.
- Pin CTranslate2 to the validated `4.8.0` runtime together with
  faster-whisper `1.2.1`.
- Use official Silero V4 `v4.0` ONNX with a 1536-sample window.
- Default long VAD parameters are threshold `0.45`, minimum speech `250ms`,
  minimum silence `3000ms`, and speech padding `900ms`.
- When session VAD settings are enabled, retain their current meaning and apply
  supplied threshold/duration/padding values to the V4 state machine.
- Immediately before long model load, call `ctranslate2.set_random_seed(0)` so
  model construction and decode use the formally validated deterministic runtime.
- Apply the fixed seed only to ordinary long mode. Short mode and Kotoba must not
  call or change the CTranslate2 seed, and no user setting is exposed.
- Run one VAD pass, one compressed-audio feature calculation, one decode, and
  one source-timestamp restoration. Do not run a second transcription or
  alignment pass.

### R3. Keep semantic grouping in the decoder path

- Keep the project-owned fork of faster-whisper 1.2.1's MIT-licensed
  `generate_segments` loop for long mode.
- Carry the generic Japanese blend prompt plus the punctuation seed
  `！`, `？`, `、`, `。` in every long-mode decode prompt while reserving normal
  previous-text budget.
- Retain previous-text context and reset only accumulated history when the exact
  grouped-window text longer than five characters lacks
  `。！？!?、，,`.
- Keep aligned `Segment.words`, but disable word-end seek refinement so timestamp
  tokens control grouping.
- Do not merge or split completed subtitles by duration, characters, or ordinary
  punctuation rules.
- Derive fork code only from the pinned MIT upstream source and independently
  stated requirements; do not copy XXL implementation code.

### R4. Manage the V4 asset safely

- Do not bundle VAD weights in the application resources or git.
- Treat the V4 ONNX as part of `large-v2` model readiness and download it through
  the existing model confirmation flow into the managed `HF_HOME` model cache.
- Download from the official Silero VAD `v4.0` source, use the configured China
  mirror path when `HF_ENDPOINT` selects the China profile, and verify the fixed
  SHA-256 before atomic replacement.
- A missing, corrupt, or unsupported V4 asset must fail clearly; do not silently
  restore the confirmed-fragmenting long path.
- Add the Silero VAD MIT notice and provenance without storing private or
  generated artifacts.

### R5. Preserve hard-silence and timestamp safety

- Consume source-timeline words returned by the same long decode.
- A hard word hole is at least `30.0s`; tighten one-sided parents or split
  two-sided parents only from aligned word evidence.
- Preserve normalized text atomically on every hard-hole replacement.
- Clamp every emitted event against source duration, its previously emitted end,
  and the next raw start. Do not emit negative, zero-duration, out-of-bounds, or
  overlapping events; fail clearly if valid bounds cannot preserve the event.
- Keep one-segment lookahead and streaming output.

### R6. Preserve contracts and scope

- Keep `AsrSegment`, `Transcription`, job snapshots, HTTP, Tauri commands, and
  frontend contracts unchanged.
- Keep VAD settings session-only.
- Keep Kotoba on upstream `WhisperModel`, its current options, and no ordinary
  hard-hole transformation.
- Synchronize behavioral Python and manifest files to
  `src-tauri/resources/asr-service/`.
- Add no frontend control and no general subtitle formatter.

### R7. Validate private corpora

- Keep the sub-second pre/post and rolling-window feedback command outside git.
- Validate from the full source feature stream; do not use a separately truncated
  WAV as a proxy for the first 20 minutes.
- Run the full 69-minute source, compare every ten-minute window with the original
  reference and same-PCM XXL control, inspect representative boundaries, and
  separate decode changes from hard-hole transformation effects.
- Run the separate `498.872s` human-verified source through short mode.
- Keep all private audio, subtitles, text, paths, and generated logs outside git.

## Acceptance Criteria

- [x] Full long-mode output has no sustained mostly-1-to-3-second window; every
      ten-minute window retains mixed cue lengths and tiny-cue rate at most 11%.
- [x] Post-breakpoint median duration is at least `0.70x` pre-breakpoint,
      normalized-character median is at least `0.65x`, and tiny-cue rate grows by
      no more than 11 percentage points. The rolling-window gate is decisive.
- [x] Full output has no cue over 30 seconds and its over-15-second rate is no
      worse than the original XXL reference by more than two percentage points.
- [x] Representative boundaries are semantically comparable to the XXL reference
      and no fixed readability formatter is applied.
- [x] With extensions disabled, the fork matches pinned upstream output, prompts,
      decode calls, and seek progression on deterministic fixtures.
- [x] Long mode sets CTranslate2 random seed `0` before model load, carries the
      reserved blend/punctuation prompt every window, resets only accumulated
      history, returns aligned words, and leaves word-end seek refinement disabled.
- [x] Short mode and Kotoba never call the long-runtime seed API; short mode uses
      the upstream model/V6 path with no carried long prompt and no global word
      timestamps. Default ordinary short Japanese `large-v2` uses
      `int8_float16` only on effective non-CPU devices, CPU uses `int8`, and
      explicit compute selections plus all non-target engines/models/languages
      remain unchanged.
- [x] No event spans any of the six known source gaps; hard-hole replacements
      preserve normalized text.
- [x] All output timestamps are valid, bounded, ordered, and non-overlapping.
- [x] On the verified short corpus, normalized text similarity is not below the
      historical faster-whisper result and boundary distribution does not
      materially regress.
- [x] Kotoba behavior remains unchanged and covered.
- [x] V4 download hash/provenance, missing/corrupt failure, model-readiness check,
      and official/China URL selection are covered.
- [x] Full sidecar tests pass; packaged behavioral files are byte-synchronized;
      private artifacts are absent from git.

## Planning Status

Scope A remains approved: maintain a project-owned fork of the pinned upstream
generation loop. Controlled full-corpus evidence selects a duration-gated long
path. Separate verified-short evidence narrows only the default CUDA compute for
ordinary Japanese `large-v2`; it does not extend the long fork, V4, prompt,
alignment, or RNG seed to short recordings.

## Out of Scope

- Adopting Faster-Whisper-XXL as a runtime dependency.
- General sentence, duration, character, or line-width formatting.
- Applying the long-mode pipeline to Kotoba, other Whisper models, non-Japanese
  requests, or short recordings without separate evidence.
- Changing translation, editor, Tauri command, or frontend behavior.
- Committing private corpora, model weights, generated transcripts, absolute
  local paths, token dumps, or diagnostic logs.
