# Diagnosis Evidence

## Reproduction Environment

- Input duration: `4144.256s` (`69:04.256`)
- Audio: 16 kHz PCM extracted by Hikaru Sub
- Audio SHA-256: `ba8bef9ac6433bcd66721a32c9ae0fd58a10b309c758ddf03f45f8eeaf27cf6d`
- Engine/model: `faster-whisper` / `large-v2`
- faster-whisper: `1.2.1`
- CTranslate2: `4.8.0`
- Available validation GPU: NVIDIA RTX 3070 8 GB
- Private corpus paths are intentionally omitted; filenames are listed in `prd.md` under `<local-corpus>`.

## User-Visible Symptoms

The affected ASS contains many long early cues and several cues spanning
program-transition silence. The comparison Faster-Whisper-XXL `1.1.1` SRT uses
`large-v2`, has higher overall text accuracy, and represents those transition
silences as subtitle gaps. It is an external text/timing reference rather than
a byte-equivalent baseline.

Aggregate segmentation statistics:

| Output interval | Cues | Median duration | P90 duration | Cues > 8s | Median visible chars | Cues > 40 chars |
|---|---:|---:|---:|---:|---:|---:|
| Affected ASS, before 11:52.096 | 85 | 6.92s | 9.31s | 26 | 39 | 34 |
| Affected ASS, after 11:52.096 | 1094 | 2.36s | 4.40s | 18 | 14 | 4 |
| Reference SRT, before 11:52.096 | 99 | 4.40s | 9.30s | 15 | 31 | 26 |
| Reference SRT, after 11:52.096 | 431 | 5.48s | 10.38s | 104 | 35 | 173 |

The reference cue statistics differ because it uses a different subtitle grouping policy; it is a text/timing reference, not a cue-count oracle.

## Finding 1: VAD Message Is an Aggregate

Re-running faster-whisper's bundled Silero VAD with default `VadOptions` produced:

```text
duration = 4144.256s
speech chunks = 43
kept = 3432.160s
removed = 712.096s (11:52.096)
```

The message `VAD filter removed 11:52.096 of audio` is the sum of removed silence across the full recording, not the source-timeline position where behavior changed.

The task request logged `useVad=false`, but `FasterWhisperEngine` still sets `vad_filter=true`. In the current product contract the UI switch controls custom VAD parameters; faster-whisper's default VAD remains enabled.

## Finding 2: Previous-Text Prompt Reset Explains the Segmentation Transition

Two runs over byte-identical PCM had an identical prefix of 87 output segments. Both remained identical through the segment ending at `12:14.620`; they diverged at the next segment and finished with 1180 versus 1465 segments.

A controlled 15-minute run found the first nonzero fallback temperature at `12:14.620`:

```text
temperature = 1.0
prompt_reset_on_temperature = 0.5
```

faster-whisper resets `prompt_reset_since` when fallback temperature exceeds the threshold. This, not the aggregate 11:52.096 VAD total, is the causal boundary for the sudden segmentation change.

Single-variable 15-minute comparison:

| Configuration | Median duration before 11:52 | Median chars | First 15m temperatures |
|---|---:|---:|---|
| `condition_on_previous_text=true` | 6.92s | 39 | `0.0`, then `1.0` at 12:14.620 |
| `condition_on_previous_text=false` | 4.85s | 27 | `0.0` only |

Disabling previous-text conditioning improved typical grouping and removed this fallback in the controlled clip, but did not by itself eliminate every long segment.

## Finding 3: Timestamp Restoration Bridges Removed Silence

Default VAD identified these largest internal removed gaps:

| Source interval | Removed duration |
|---|---:|
| `04:52.944-06:25.456` | 92.512s |
| `18:08.976-20:03.248` | 114.272s |
| `32:40.656-34:22.096` | 101.440s |
| `53:37.424-55:25.744` | 108.320s |

The affected ASS contains corresponding events lasting about 100-116 seconds. faster-whisper concatenates speech chunks, transcribes the compressed audio, then maps each segment start/end back to the original timeline. If one upstream segment crosses a compressed chunk boundary, its restored interval includes the removed silence.

With `word_timestamps=true`, the transition example still produced one `292.690-394.440` segment lasting 101.75 seconds. Its first aligned word ended before the gap and its remaining words started after the gap. Word timestamps therefore provide the evidence needed to split, but faster-whisper does not split the segment automatically.

## Finding 4: Serialization Is Not the Cause

The project adapter currently converts each upstream segment directly to one `AsrSegment`. `JobManager` appends those segments, and the recovery ASS writer emits one `Dialogue` per segment. No downstream merge creates the long events.

## Ranked Root Causes

1. **Confirmed:** accumulated previous-window prompt changes long-form grouping until a high-temperature fallback resets it.
2. **Confirmed:** segment-level VAD timestamp restoration can span removed silence when an upstream segment crosses speech chunks.
3. **Confirmed integration gap:** Hikaru Sub treats raw Whisper segments as final subtitle lines and has no aligned-word re-segmentation policy.
4. **Ruled out for this reproduction:** custom UI VAD parameters and its 25-second max segment duration, because the logged request had `useVad=false` and passed no custom VAD options.
5. **Ruled out:** ASS writer/frontend cue merging.

## Existing Feedback Loop

The diagnosis used a red-capable aggregate check over the affected ASS: early cues over 8 seconds were disproportionately frequent relative to the later interval. The implementation should replace the throwaway command with deterministic unit tests plus a sanitized private-corpus validation report; no diagnostic script or media was added to the repository.
