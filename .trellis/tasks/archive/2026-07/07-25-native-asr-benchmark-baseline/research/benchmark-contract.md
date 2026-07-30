# Native ASR Benchmark Ground-Truth Contract

T02 (CTranslate2), T03 (CrispASR), and later productization tasks must use this contract as the single quality comparison authority.

## Authority Order

1. User-provided `.asr-benchmark` WAV+ASS pairs and their validated manifest are the only reference text, speech-region, and timeline truth.
2. Native implementation choices start from official documentation, stable public APIs, and model cards, then current well-maintained community recommendations.
3. Candidate algorithms are selected by measurements against the same ground truth.
4. Current Hikaru Sub Python output is optional diagnostic/history reference only. It is never expected output, a relative CER/RTF gate, or a substitute for missing annotations.
5. React/Tauri command names, `AsrJobSnapshot`, cancellation/recovery/path/security contracts remain mandatory product compatibility requirements.

No tool or task may generate, infer, repair, or backfill reference ASS/text/timestamps/speech regions from Python results.

## Authoritative Material

The local root is gitignored `.asr-benchmark/`. Benchmark tooling must read and parse the local ASS to derive the reference, but ASS Dialogue text must not be copied into tracked artifacts.

| Case ID | Pair | Duration | Dialogue count | WAV SHA-256 | ASS SHA-256 |
|---|---|---:|---:|---|---|
| `short-v1` | `short.wav` + `short.ass` | 24.102s | 8 | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` | `60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b` |
| `medium-v1` | `medium.wav` + `medium.ass` | 498.872s | 165 | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` | `d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e` |
| `long-v1` | `long.wav` + `long.ass` | 4144.235s | 908 | `af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e` | `7954ce24af05dca37b2930136c83ee722e80fd637ef298cc7eeb47f29cf8c6f3` |

All three WAVs validated as 16 kHz mono 16-bit PCM. After the user-confirmed `long-v1` `person-names` coverage update, local manifest SHA-256 is `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277`; the WAV/ASS hashes, source, license and authorization identity fields are unchanged. Comparison identity is `(corpusId, manifest SHA-256, caseId, WAV SHA-256, ASS SHA-256)`. Results with a different identity cannot support the same conclusion.

Coverage labels are positive and per-case; absent or unconfirmed labels are not added:

| Case ID | Confirmed positive coverage |
|---|---|
| `short-v1` | `clear-japanese` |
| `medium-v1` | `clear-japanese`, `background-noise`, `english`, `proper-nouns` |
| `long-v1` | `clear-japanese`, `long-silence`, `continuous-speech-over-30s`, `english`, `proper-nouns`, `background-noise`, `rapid-dialogue`, `numbers`, `person-names` |

The corpus-wide union covers every frozen label except `low-volume`. That remains the only explicit gap; neither the CLI nor Python output may infer it.

## Stable Artifacts

- CLI and metrics: `scripts/asr-benchmark.py`
- Corpus schema/example: `asr-service/benchmarks/corpus.schema.json` and `asr-service/benchmarks/corpus.example.json`
- Corpus/privacy policy: `asr-service/benchmarks/README.md`
- Result envelope: versioned JSON, `kind: hikaru-asr-benchmark-result`
- Local raw results: `.asr-benchmark/results/*.json` or `asr-service/benchmarks/results/*.json`, both ignored
- Optional current implementation report: `research/python-reference-report.md`, deterministically generated from valid real runs and explicitly non-authoritative

T02/T03 manifests retain `research/planning-evidence.md` and include this contract plus the current five-engine short `python-reference-report.md`. The report remains non-authoritative and explicitly blocks medium/long claims.

## Metric Semantics

1. Japanese CER applies Unicode NFKC, normalizes newlines, removes all Unicode whitespace, and preserves punctuation, Latin case, and all other characters.
2. Deterministic Levenshtein reports substitutions, deletions, insertions, reference character count, and CER.
3. P95 uses deterministic linear interpolation at `(n-1)*0.95`.
4. Timeline validation counts empty text, non-positive ranges, negative starts, ends beyond verified WAV duration, and start times that move backward. Ordered overlap/nesting is valid.
5. A missing interval is counted only after subtracting candidate coverage from an ASS-derived confirmed speech interval; uncovered duration must be at least 1500ms.
6. `TranscriptSegmentRefresh` replaces the complete preview list before scoring. This applies to any route, including current Parakeet, Qwen3 and ReazonSpeech behavior.
7. Timing matching aligns normalized reference/candidate character streams, maps each reference Dialogue start to the candidate segment containing its first aligned character, and records unmatched reference/candidate counts. Qwen3 timing is eligible only with `forced-aligner` provenance; synthetic/mixed/unknown/generic `engine-native` timestamps are excluded.

Shared hard gates:

- 0 invalid or out-of-bounds timeline segments;
- 0 confirmed speech gaps `>=1500ms`;
- Qwen3 start-time median `<=150ms` and P95 `<=500ms`.

## User-Reviewed Frozen Absolute Budgets

The user reviewed and froze these product-utility gates. They apply to native candidates measured against the validated ground truth; they do not claim that the current Python implementation passes and are never relative Python gates.

| Metric | Frozen absolute budget | Evaluation rule |
|---|---:|---|
| CER | `<=0.35` | Every engine/case independently; no averaging hides a failing case |
| Pure CPU inference RTF | `<=1.0` | Short warm median; medium/long measured run; backend-independent |
| Accelerated GPU inference RTF | `<=0.5` | CUDA, Vulkan, or another actual GPU-accelerated path; backend-independent |
| Short cold process wall | `<=120s` | Fresh process including import, load, inference, metrics |
| CTranslate2 peak process RSS | `<=6 GiB` | Peak working set/RSS on the reference machine |
| CrispASR peak process RSS | `<=12 GiB` | Includes Qwen3 ASR + ForcedAligner |

No VRAM gate is defined. The frozen timeline/gap/Qwen alignment gates above remain mandatory. Medium/long native measurements must still validate each engine/case; T02/T03 may now evaluate native measurements against these gates, while Python-relative CER/RTF deltas and Python pass/fail labels remain forbidden.

T02/T03 must invoke/import this implementation. They must not copy CER, percentile, speech-gap, refresh, or report logic.

## Commands

```bash
python scripts/asr-benchmark.py validate --manifest <manifest.json> --corpus-root <corpus-root>
<development-python> scripts/asr-benchmark.py run --manifest <manifest.json> --corpus-root <corpus-root> --expected-interpreter <development-python> --hf-home <app-hf-cache> --case <case-id> --engine <engine-id> --model <model-id> --device cpu --output <ignored-result.json>
python scripts/asr-benchmark.py report --results <ignored-results-dir> --output <ignored-report.md>
```

Any report is generated from JSON only and contains case IDs, hashes, aggregate metrics, limitations, per-result case tags, and the manifest-wide coverage snapshot. It contains no transcript text, cache path or machine path. The tracked `python-reference-report.md` was regenerated from valid short CPU runs for all five engines plus a `faster-whisper/base` runner smoke after the coverage metadata changed the manifest identity; medium/long diagnostics remain absent and explicitly block only those diagnostic claims.

## Python Reference Environment

A valid Python reference run must use the Hikaru Sub development interpreter and its pinned dependencies. Current relevant pins are `faster-whisper==1.2.1` and `ctranslate2==4.8.0`.

`HF_HOME` and other cache roots must be passed explicitly and recorded as sanitized parameters/metadata. They affect reproducibility and model availability, but do not define quality truth. Evidence produced by an unrelated system Python or wrong cache environment must be discarded and regenerated.

Python `failed`/`skipped` results reduce diagnostic/current-implementation coverage only. They do not block native ground-truth quality, timing, performance or resource conclusions.

## Required Evidence For Native Claims

- Same corpus/case/WAV/ASS identity and Windows x64 CPU attempt; GPU is supplemental.
- Short: at least 1 cold + 3 warm; medium/long: explicitly counted samples.
- Model/cache ready before timing; downloads/cache fill excluded and revision recorded.
- Official/model-card/API source plus any maintained community recommendation used to choose algorithm/config.
- Load/inference/total wall, inference/total RTF, peak RSS/working set, optional VRAM and measurement methods.
- Final raw candidate segments and all invalid/out-of-bounds/gap counts.
- Qwen3 ForcedAligner provenance and time-error metrics; no synthetic fallback.
- Product-contract compatibility evidence where the task owns command/snapshot/cancel/recovery/path/security behavior.

## Current Implementation Reference Facts

- `faster-whisper==1.2.1`, `ctranslate2==4.8.0`.
- Current `large-v2` + `ja` + duration `>=600000ms` V4/seed/session/semantic path is a diagnostic regression case, not a native algorithm template.
- Current ReazonSpeech uses 45s chunks with 2s overlap at `>=60s`.
- Current Parakeet, Qwen3 and ReazonSpeech may use final `TranscriptSegmentRefresh` replacement.
