# T01 Planning Evidence: Benchmark Ground Truth

## Authoritative Local Material Facts

The following user-confirmed facts may be recorded after local benchmark parsing, without copying subtitle text into tracked artifacts:

| Stable role | WAV + ASS | Duration | ASS Dialogue count | WAV format |
|---|---|---:|---:|---|
| short | `short.wav` + `short.ass` | 24.102s | 8 | 16 kHz mono 16-bit PCM |
| medium | `medium.wav` + `medium.ass` | 498.872s | 165 | 16 kHz mono 16-bit PCM |
| long | `long.wav` + `long.ass` | 4144.235s | 908 | 16 kHz mono 16-bit PCM |

- All material is under gitignored `.asr-benchmark/`.
- The WAV+ASS pairs are the only quality ground truth. Their hashes and stable case IDs must be established by local manifest validation.
- Task documents and tracked reports must not contain ASS Dialogue text, local absolute paths, or media bytes.

## Confirmed Repository Facts

- `asr-service/engines/base.py` defines `AsrSegment`, `Transcription`, and `TranscriptSegmentRefresh`; `engines.registry.create_engine` exposes all five current Python routes.
- Parakeet, Qwen3 and ReazonSpeech may emit `TranscriptSegmentRefresh`, so final refresh replacement is a general runner contract rather than a Parakeet-only case.
- Current dependencies are `faster-whisper==1.2.1` and `ctranslate2==4.8.0`.
- Current faster-whisper `large-v2` + Japanese + duration `>=600000ms` uses the V4/seed/session/semantic segmentation special path. This is diagnostic and regression evidence, not a native implementation template.
- Current ReazonSpeech uses whole audio below 60s and 45s chunks with 2s overlap at `>=60s`.
- Qwen3 may fall back to synthetic text timing when alignment is absent; synthetic timestamps are never eligible native timing evidence.
- Existing tests are mocked/synthetic behavior checks, not a model-backed authoritative Japanese quality corpus.

## Evidence And Implementation Authority

1. User-provided WAV+ASS and their validated manifest define reference text, speech regions and timing.
2. Native algorithms follow official docs, stable APIs and model cards, then maintained community recommendations.
3. Ground-truth measurements select among candidates and apply the user-reviewed frozen absolute budgets.
4. Python outputs are optional current-implementation references for diagnostics, known-issue discovery and history only.
5. React/Tauri command, snapshot, cancellation, recovery, path and security contracts remain mandatory product compatibility requirements.

Python output must never generate, infer, patch or backfill reference ASS/text/timestamps/speech regions. Missing Python dependencies or model runs reduce diagnostic coverage only.

## Planning Decisions

- Use one stdlib-first CLI and one focused unittest module.
- JSON is the source of truth; Markdown is deterministic and sanitized.
- Keep punctuation in CER; apply NFKC and remove Unicode whitespace.
- Measure confirmed speech gaps only from ASS-derived reference speech intervals.
- Run optional Python references in fresh processes with explicit interpreter/dependency/cache metadata.
- The correct Hikaru Sub development interpreter and `HF_HOME`/cache parameters are required for valid Python reference evidence; cache paths are metadata, not truth.
- Coverage is positive and per-case. User-confirmed tags are: short=`clear-japanese`; medium=`clear-japanese, background-noise, english, proper-nouns`; long=`clear-japanese, long-silence, continuous-speech-over-30s, english, proper-nouns, background-noise, rapid-dialogue, numbers, person-names`. The corpus-wide union now lacks only `low-volume`; absent/unconfirmed labels are not inferred.
- User review froze the T01 gates: CER `<=0.35` independently per engine/case; inference RTF `<=1.0` on pure CPU or `<=0.5` on accelerated GPU paths; short cold process wall `<=120s`; peak RSS `<=6 GiB` for CTranslate2 or `<=12 GiB` for CrispASR; zero invalid/out-of-bounds timeline; zero confirmed speech gaps `>=1500ms`; Qwen3 start median `<=150ms` and P95 `<=500ms` with ForcedAligner provenance only. No VRAM gate is defined.

## Evidence Consumers

- T02 consumes the frozen ground-truth contract/material identity and reviewed absolute budgets for large-v3/Kotoba feasibility. Python reference may be absent and is not a quality gate.
- T03 consumes the same frozen ground truth and budgets for Parakeet/Reazon/Qwen3 CER, confirmed speech gaps and aligner timing. Python reference may be absent.
- T06 must validate product models including large-v2 long-audio behavior against ground truth, but may use official/community algorithms instead of the Python special path.
- Parent Gate 0 consumes absolute ground-truth measurements, resources, licenses and route feasibility, not Python parity.
