# Japanese ASR Ground-Truth Benchmark

`scripts/asr-benchmark.py` is the shared, standard-library-first corpus validator, metric implementation, optional current-Python runner, and deterministic report renderer. The user-provided `.asr-benchmark/` WAV+ASS pairs are the only quality truth. Python engine output is diagnostic evidence only and can never create, repair, or replace a reference.

## Privacy, License, And Repository Policy

- Private/large WAV, ASS, manifests, derived references, raw results, models, and temporary reports stay under repository-root `.asr-benchmark/` (or outside the repository). `asr-service/benchmarks/results/`, `local/`, and `models/` are also ignored.
- A tracked manifest may contain stable relative WAV/ASS keys, both hashes, non-sensitive format/duration/count metadata, coverage labels, source/license/authorization status, and the derivation contract. It must not contain ASS Dialogue text, derived reference text/segments, an absolute path, or a cache path.
- `validate` resolves both relative keys under `--corpus-root`, verifies hashes and 16 kHz mono 16-bit PCM WAV shape, parses the local ASS, and derives reference text, timeline segments, and confirmed speech intervals in memory.
- Ignored result JSON may contain the private derived reference and final candidate segments. Markdown is generated from JSON but omits all transcript text and redacts machine/model/cache paths and secrets.
- The runner never downloads models or converts media. Engine children force Hugging Face/Transformers offline mode.

## Corpus Schema Version 1

The machine-readable shape is `corpus.schema.json`; the CLI remains the authoritative semantic validator.

Top level:

```json
{
  "schemaVersion": 1,
  "corpusId": "stable-versioned-id",
  "description": "non-sensitive purpose and annotation notes",
  "cases": []
}
```

Each case requires:

| Field | Contract |
|---|---|
| `id` | Stable unique ID containing letters, digits, dot, underscore, or hyphen. |
| `audio` / `ass` | Canonical POSIX relative keys under `--corpus-root`. Absolute paths, `..`, dot segments, backslashes, URI/drive colons, reserved Windows characters, and redundant separators are rejected. |
| `audioSha256` / `assSha256` | Lowercase SHA-256 of the exact local WAV/ASS bytes. |
| `durationMs` | Rounded WAV frame duration. |
| `sampleRate` / `channels` / `sampleWidthBits` | Exactly `16000` / `1` / `16`. |
| `durationClass` | `short` for `<30s`; `medium` for `5-15m` inclusive; `long` for `>60m`. Durations between classes are rejected. |
| `dialogueCount` | Exact parsed ASS `Dialogue` event count. |
| `tags` | Non-empty subset of the frozen coverage labels below. Missing labels are warnings, never inferred from Python output. |
| `source` / `license` | Explicit non-empty statements; `unknown` and `unspecified` are rejected. |
| `authorizationStatus` | `redistributable` or `private-use-authorized`. |
| `referenceDerivation` | Exactly `{ "type": "ass-dialogue-v1", "speechConfirmation": "confirmed" }`. Inline `referenceText`, `referenceSegments`, or `speechIntervals` are rejected. |

Frozen coverage labels:

- `clear-japanese`
- `long-silence`
- `background-noise`
- `rapid-dialogue`
- `continuous-speech-over-30s`
- `low-volume`
- `numbers`
- `english`
- `person-names`
- `proper-nouns`

### ASS derivation `ass-dialogue-v1`

- ASS must be UTF-8 (optional BOM) or BOM-marked UTF-16.
- Each `[Events]` section must declare a non-duplicated `Format` with `Start`, `End`, and final `Text` before `Dialogue` rows; final `Text` preserves commas in subtitle content.
- Dialogue timestamps are parsed as ASS centiseconds. Invalid/empty events fail validation.
- Override blocks such as `{\\an2}` are removed; `\\N`/`\\n` become newlines and `\\h` becomes a space.
- Events are stably ordered by `(startMs, endMs, source line)` for reference text/timeline derivation.
- Every confirmed Dialogue interval is authoritative speech; overlapping/adjacent intervals are merged for the confirmed-speech-gap metric.

The committed example uses a task-authored, standard-library-generated 440 Hz PCM file plus a trivial task-authored ASS, dedicated under CC0-1.0. It is only a parser/hash/privacy self-check and deliberately does not resemble speech or replace the authoritative Japanese corpus.

## Metrics

- CER normalization: Unicode NFKC, CRLF/CR to LF, remove every Unicode whitespace character; preserve punctuation, Latin case, and all remaining characters.
- Levenshtein reports substitutions, deletions, insertions, reference character count, and `(S+D+I)/N`; ties prefer substitution, deletion, insertion.
- P95 uses linear interpolation at `(n-1)*0.95`.
- Timeline checks count empty text, `endMs <= startMs`, negative starts, ends after the verified WAV duration, and start times that move backward. Overlap and nested ASS intervals remain valid when starts are ordered.
- Missing speech subtracts valid non-empty candidate coverage only from merged ASS-derived confirmed speech intervals; uncovered spans shorter than 1500 ms are ignored. A gap is diagnostic-only when every overlapping reference cue matches the frozen standalone-vocalization policy; excluded gaps stay in CER and publish separately from semantic gaps.
- Timing matching aligns the normalized reference and candidate character streams, then maps each reference Dialogue start to the candidate segment containing its first aligned character; segmentation differences therefore do not require exact whole-segment text equality.
- Qwen3 timing is eligible only for `forced-aligner` provenance. `synthetic`, `mixed`, `unknown`, and a generic `engine-native` label are excluded.
- Any `TranscriptSegmentRefresh` atomically replaces all preview segments before metrics are computed, including Parakeet, Qwen3, and ReazonSpeech routes.

The user-reviewed frozen gates are:

- every engine/case independently has CER `<=0.35`;
- inference RTF is `<=1.0` on pure CPU and `<=0.5` on accelerated GPU paths such as CUDA/Vulkan;
- short cold process wall is `<=120s`;
- peak process RSS is `<=6 GiB` for CTranslate2 and `<=12 GiB` for CrispASR;
- zero invalid/out-of-bounds timeline entries and zero semantic confirmed-speech gaps `>=1500ms`;
- Qwen3 start median `<=150ms` and P95 `<=500ms`, using ForcedAligner provenance only.

No VRAM gate is defined. Python-reference results remain current-implementation diagnostics and are not declared pass/fail against these native-candidate gates.

## Result Envelope Version 1

Every result has `kind: hikaru-asr-benchmark-result` and `candidateKind: native-candidate | python-reference`. The registry-backed `run` command always writes `python-reference`. Later native harnesses must write the same identity and metric fields rather than copying metric algorithms.

The envelope records corpus/manifest/case/WAV/ASS identity, the manifest-wide duration-class and coverage-tag snapshot, status, engine/model/runtime metadata, exact interpreter and explicit cache metadata, environment/package versions, cold/warm timing and RTF, RSS/VRAM methods, final segments, CER/timeline/gap/timing metrics, and sanitized reproduction information. Unavailable measurements are `null` plus a reason, never zero.

## Commands

Dependency-free checks:

```bash
python scripts/asr-benchmark.py self-check
python scripts/asr-benchmark.py validate --manifest asr-service/benchmarks/corpus.example.json
python scripts/asr-benchmark.py validate --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark
```

Valid current-Python evidence must be invoked by the Hikaru Sub development interpreter with the application cache supplied explicitly. On Windows/Git Bash:

```bash
asr-service/.venv/Scripts/python.exe scripts/asr-benchmark.py run \
  --manifest .asr-benchmark/manifest.json \
  --corpus-root .asr-benchmark \
  --expected-interpreter asr-service/.venv/Scripts/python.exe \
  --hf-home src-tauri/target/debug/deps/models/huggingface \
  --case short-v1 \
  --engine faster-whisper \
  --model large-v3 \
  --device cpu \
  --output .asr-benchmark/results/faster-whisper-short.json

python scripts/asr-benchmark.py report \
  --results .asr-benchmark/results \
  --output .asr-benchmark/python-reference-report.md
```

Short cases default to one cold child plus three warm inferences in a second process. Medium/long default to one cold run and no warm repeats. `--warm-runs N` overrides this. A failed/skipped Python route is a reproducible diagnostic limitation, not a native quality blocker.
