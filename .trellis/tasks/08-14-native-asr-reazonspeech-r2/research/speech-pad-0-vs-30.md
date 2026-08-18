# ReazonSpeech R2: `speechPadMs=0` vs `30`

## Bottom line

- **Generic Silero/whisper.cpp recommendation and default:** `30ms`.
- **Pinned CrispASR v0.8.22 maintained CLI behavior:** `30ms`, applied *inside* Silero before CrispASR post-merge and 12-second energy re-splitting.
- **Pinned `crispasr_vad_slices` direct C ABI behavior:** `30ms` is applied *after* post-merge/rechunking, so adjacent 12-second sub-slices can overlap by `60ms` and can grow beyond the requested cap. `0ms` avoids that ABI artifact, but removes the maintained edge padding.
- **Exact Japanese ReazonSpeech 12-second independent-slice evidence:** no inspected official or community source recommends `0ms`, and no source publishes a ReazonSpeech-specific `0ms` vs `30ms` A/B. The model card and issue #89 support VAD-bounded/12-second slicing, not zero padding.

Therefore, **`speechPadMs=0` is only an engineering workaround for the current direct-ABI ordering mismatch. It is not an official or community recommendation.** The user reviewed the contradiction and selected a new identity that keeps direct-ABI `30ms`, distinguishes the `12000ms` unpadded core cap from the `12060ms` padded inference cap, and accepts only adjacent native final-padding overlap up to `60ms`. Neither direct-ABI choice exactly reproduces the maintained CLI semantics.

## A. Generic/default Silero VAD guidance

### Official Silero VAD

At inspected commit `76e3dc408eb2a5c655c34e230d2d5459b4439daa`, the official helper defaults to:

```python
speech_pad_ms: int = 30
```

and documents it as:

> Final speech chunks are padded by speech_pad_ms each side

Sources:

- `src/silero_vad/utils_vad.py:217-220,257-258`: <https://github.com/snakers4/silero-vad/blob/76e3dc408eb2a5c655c34e230d2d5459b4439daa/src/silero_vad/utils_vad.py#L217-L220>
- Documentation text: <https://github.com/snakers4/silero-vad/blob/76e3dc408eb2a5c655c34e230d2d5459b4439daa/src/silero_vad/utils_vad.py#L247-L258>

Silero does not create overlap when two padded speech regions are close. It divides the available silence between them instead:

```python
if silence_duration < 2 * speech_pad_samples:
    speech['end'] += silence_duration // 2
    speeches[i+1]['start'] -= silence_duration // 2
```

Source: `utils_vad.py:428-440`: <https://github.com/snakers4/silero-vad/blob/76e3dc408eb2a5c655c34e230d2d5459b4439daa/src/silero_vad/utils_vad.py#L428-L440>.

### Official whisper.cpp VAD

At inspected commit `1fe009caeda75f69bc864d6370b10674e45a92bd`, whisper.cpp also defaults to `30ms`:

- `src/whisper.cpp:4463-4469`: <https://github.com/ggml-org/whisper.cpp/blob/1fe009caeda75f69bc864d6370b10674e45a92bd/src/whisper.cpp#L4463-L4469>
- CLI default `examples/cli/cli.cpp:108-114`: <https://github.com/ggml-org/whisper.cpp/blob/1fe009caeda75f69bc864d6370b10674e45a92bd/examples/cli/cli.cpp#L108-L114>

Its README gives the rationale:

> Adds this amount of padding before and after each detected speech segment to avoid cutting off speech edges.

Source: `README.md:851-852`: <https://github.com/ggml-org/whisper.cpp/blob/1fe009caeda75f69bc864d6370b10674e45a92bd/README.md#L851-L852>.

whisper.cpp uses the same midpoint allocation for close regions, preserving non-overlap with positive padding: `src/whisper.cpp:5421-5437`: <https://github.com/ggml-org/whisper.cpp/blob/1fe009caeda75f69bc864d6370b10674e45a92bd/src/whisper.cpp#L5421-L5437>.

### Broader community practice

A mature downstream example, faster-whisper, uses **positive**, not zero, padding—its current `VadOptions` default is `400ms`: `faster_whisper/vad.py:24-46` at commit `ed9a06cd89a93e47838f564998a6c09b655d7f43`: <https://github.com/SYSTRAN/faster-whisper/blob/ed9a06cd89a93e47838f564998a6c09b655d7f43/faster_whisper/vad.py#L24-L46>.

This value is not transferable to ReazonSpeech R2, but it shows the community convention: retain boundary context and tune the positive amount for the pipeline. The inspected mainstream sources do not establish `0ms` as a general recommendation.

## B. Pinned CrispASR CLI maintained behavior

Pinned source: CrispASR v0.8.22, commit `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`.

Local retained root:

```text
.trellis/tasks/archive/2026-08/07-25-native-asr-crispasr-poc/research/local/src/CrispASR-cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/
```

### Default is `30ms`

- CLI parameter default: `examples/cli/cli.cpp:128-134`.
- CLI flag: `examples/cli/cli.cpp:803-804`, `--vad-speech-pad-ms`.
- Shared VAD option default: `src/crispasr_vad.h:55-62`.
- Rust binding default: `crispasr/src/lib.rs:1551-1577`.

Immutable URLs:

- <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/examples/cli/cli.cpp#L128-L134>
- <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/src/crispasr_vad.h#L55-L62>
- <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/crispasr/src/lib.rs#L1551-L1577>

### CLI padding order preserves the intended shape

The CLI copies `params.vad_speech_pad_ms` into `opts.speech_pad_ms` before calling the shared VAD dispatcher: `examples/cli/crispasr_vad_cli.cpp:85-93`:

<https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/examples/cli/crispasr_vad_cli.cpp#L85-L93>.

For Silero, CrispASR passes that value into `whisper_vad_segments_from_samples`, whose inherited Silero/whisper implementation allocates close padding without overlap. CrispASR then post-merges and only afterward energy-splits overlong regions:

- `src/crispasr_vad.cpp:335-368`: <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/src/crispasr_vad.cpp#L335-L368>
- midpoint/non-overlap padding: `src/crispasr.cpp:5883-5911`: <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/src/crispasr.cpp#L5883-L5911>
- energy-minimum re-split: `src/crispasr_vad.cpp:373-408`: <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/src/crispasr_vad.cpp#L373-L408>

Thus the maintained CLI sequence is effectively:

```text
Silero detect + safe 30ms edge padding
  -> CrispASR post-merge
  -> 12s energy-minimum re-split
  -> adjacent, non-overlapping final slices
```

The CLI defaults to per-slice subtitle processing rather than stitching unless explicitly requested: `examples/cli/crispasr_run.cpp:1039-1048`: <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/examples/cli/crispasr_run.cpp#L1039-L1048>.

### Maintainer guidance supports VAD + 12s, but does not alter padding

The Japanese Parakeet-family backend declares that Japanese models prefer VAD and caps slices at 12 seconds:

- `examples/cli/crispasr_backend_parakeet.cpp:197-215`: <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/examples/cli/crispasr_backend_parakeet.cpp#L197-L215>
- CLI documentation: `docs/cli.md:338-347`: <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/docs/cli.md#L338-L347>

The ReazonSpeech GGUF model card says clips longer than about 15 seconds should prefer VAD-bounded chunking, and its example uses `--vad` without a padding override—therefore inheriting CLI `30ms`:

- `hf_readmes/reazonspeech-nemo-v2-GGUF.md:75-83`: <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/hf_readmes/reazonspeech-nemo-v2-GGUF.md#L75-L83>
- Published card: <https://huggingface.co/cstr/reazonspeech-nemo-v2-GGUF>

## C. Direct `crispasr_vad_slices` ABI behavior

The public declaration exposes `speech_pad_ms`, but does not document a special recommendation for `0`: `include/crispasr.h:809-817`: <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/include/crispasr.h#L809-L817>.

The implementation deliberately disables padding during the shared VAD computation:

```cpp
const int pad_ms = speech_pad_ms > 0 ? speech_pad_ms : 0;
opts.speech_pad_ms = 0;
```

It then performs VAD, post-merge and `max_chunk_duration_s` rechunking, and finally expands every returned span independently by `pad_s`:

```cpp
start_s = max(0, start_s - pad_s);
end_s = min(duration_s, end_s + pad_s);
```

Source: `src/crispasr_c_api.cpp:750-793`: <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/src/crispasr_c_api.cpp#L750-L793>.

Consequences for exact 12-second independent slices:

1. Two adjacent energy-split slices share a cut point before final padding.
2. `30ms` expands the left slice's end and the right slice's start toward each other, producing up to `60ms` overlap.
3. A final slice already near 12 seconds can become up to about `12.06s`, so padding is outside the requested cap.
4. `0ms` suppresses that final expansion and therefore restores structural non-overlap/cap compliance, but it also removes the CLI/Silero edge context and is not equivalent to the CLI's pad-before-rechunk behavior.

This explains the task oracle's observed `[0,10260]ms` then `[10200,14080]ms` windows. The ABI routes through the same dispatcher, but its padding **ordering** is not the CLI ordering when rechunking is enabled.

## D. Evidence specific to Japanese ReazonSpeech 12s independent slices

### What is supported

- ReazonSpeech GGUF model card: use VAD-bounded chunking for clips longer than about 15 seconds.
- CrispASR Japanese backend/issue #89: arbitrary/long Japanese FastConformer windows degrade; cap VAD slices at 12 seconds and decode each slice independently.
- Issue #89 final maintainer summary: <https://github.com/CrispStrobe/CrispASR/issues/89#issuecomment-4882006913>.

### What is not supported

- Issue #89 contains no `speech_pad_ms`, `--vad-speech-pad-ms`, `0ms`, or `30ms` recommendation. It concerns `parakeet-tdt-0.6b-ja`, not a ReazonSpeech pad A/B.
- The ReazonSpeech GGUF model card does not name a pad value; its command inherits CrispASR's `30ms` default.
- The official ReazonSpeech repository does not expose Silero VAD padding. Its helper instead pads the entire normalized waveform with `0.5s` silence on both sides before model inference; that is a different model-front-end operation, not VAD slice padding:
  - `pkg/nemo-asr/src/transcribe.py:30-55`: <https://github.com/reazon-research/ReazonSpeech/blob/2d4d4762e7ee294ac8e47a177ac2e9b0e8d0d43f/pkg/nemo-asr/src/transcribe.py#L30-L55>
  - `pkg/nemo-asr/src/decode.py:3-7`: <https://github.com/reazon-research/ReazonSpeech/blob/2d4d4762e7ee294ac8e47a177ac2e9b0e8d0d43f/pkg/nemo-asr/src/decode.py#L3-L7>
  - `pkg/nemo-asr/src/audio.py:70-82`: <https://github.com/reazon-research/ReazonSpeech/blob/2d4d4762e7ee294ac8e47a177ac2e9b0e8d0d43f/pkg/nemo-asr/src/audio.py#L70-L82>
- No inspected source publishes quality metrics comparing ReazonSpeech Q8_0 with otherwise identical independent 12-second VAD slices at pad `0` vs `30`.

One issue #89 maintainer comment notes that VAD-bounded slicing can lose some coverage because VAD trims leading/trailing frames, which is directionally consistent with retaining edge context, but it still does not prescribe a pad value and was measured on the Parakeet JA model: <https://github.com/CrispStrobe/CrispASR/issues/89#issuecomment-4529535997>.

## Decision table

| Question | Answer |
|---|---|
| Which value is the official/default Silero value? | `30ms` |
| Which value is the pinned CrispASR CLI maintained default? | `30ms` |
| Which value does the ReazonSpeech model-card command inherit? | `30ms` |
| Which value makes the current direct C ABI return non-overlapping rechunked windows without repair? | `0ms` |
| Is `0ms` officially recommended for ReazonSpeech 12s slices? | **No evidence found** |
| Is `30ms` usable under the superseded blanket non-overlap contract? | **No**; the ABI's post-rechunk expansion can overlap and exceed the core cap |
| What did the user approve next? | A new explicit identity with `12000ms` core / `12060ms` padded cap and adjacent native overlap `<=60ms`, without clamp/ownership/dedup |
| Is there a Reazon-specific pad A/B establishing quality? | **No** |

## Research conclusion for R2 planning

The user explicitly selected `R2-vad12-pad30-overlap-top-level-v1`:

> keep the official/default `30ms` pad; bind `12000ms` as the unpadded VAD/rechunk core cap, allow direct-ABI padded inference windows up to `12060ms`, and permit only adjacent final-padding overlap up to `60ms`.

This is a reviewed direct-ABI identity, not a claim that the ABI is byte-equivalent to the maintained CLI ordering. It must retain monotonic starts/ends, positive audio bounds, no non-adjacent overlap, direct legacy-inline single-pass dispatch with a `13s` threshold, and no clamp, ownership rewrite, dedup or stitching.

The source-only rerun was structurally valid on short-v1 and medium-v1 and classified `promising`: short CER/gaps `0.266667 / 1`; medium `0.295385 / 19`; zero timeline errors. This is diagnostic direction only, not formal R2 disposition or release authorization.
