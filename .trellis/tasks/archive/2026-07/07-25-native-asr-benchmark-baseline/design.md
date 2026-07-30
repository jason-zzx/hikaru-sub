# ASR 基准真值技术设计

## Summary

本任务使用标准库优先的 Python CLI 建立用户权威 WAV+ASS 的语料验证、参考提取、指标计算、可选 Python 引擎运行和确定性报告。`.asr-benchmark` 中用户提供的 WAV+ASS 是唯一质量真值；Python 输出只作为诊断/历史参考。

JSON 是唯一事实来源。大型/私有语料和原始结果保持本地，仓库只保存 schema、可再分发小 fixture、确定性测试和去敏合同。

## Authority Boundary

```text
.asr-benchmark WAV+ASS + validated hashes
  -> authoritative reference text/speech/timeline
  -> shared metrics and absolute gates
  -> native candidate comparison

Official docs/stable APIs/model cards
  -> maintained community recommendations
  -> candidate algorithm choices
  -> ground-truth measurements select implementation

Current Python engines
  -> product-contract discovery + known-problem diagnostics
  -> optional reference measurements only
```

Python output must never create, infer, repair, or replace ASS-derived reference text/timestamps/speech regions. React/Tauri commands, `AsrJobSnapshot`, cancellation/recovery/path/security remain product contracts outside the algorithm ranking.

## Boundaries

- `scripts/asr-benchmark.py` remains the single CLI and shared metric implementation.
- `engines.registry.create_engine` is the only Python reference engine creation entry.
- `AsrEngine.load()` and `transcribe()` are diagnostic measurement boundaries.
- Runner consumes the iterator fully; a `TranscriptSegmentRefresh` from Parakeet, Qwen3, ReazonSpeech, or any other route atomically replaces accumulated preview segments.
- Existing engines/jobs/schemas/server remain read-only current implementation reference.
- Ordinary CI does not import optional model dependencies.

## Data Flow

```text
authoritative manifest + --corpus-root
  -> validate relative WAV/ASS keys, hashes, WAV format, duration, Dialogue count
  -> derive reference text/segments/speech regions from ASS without persisting private text
  -> validate metric/gate inputs
  -> optional fresh-process Python reference run through registry
  -> reduce final segments including refresh replacement
  -> score any candidate against authoritative reference
  -> write schema-versioned JSON
  -> generate deterministic sanitized Markdown
```

## Corpus Contract

Each authoritative case contains stable ID, relative WAV/ASS keys, both SHA-256 values, duration/sample format/class/tags, source/license, and reference segments or a deterministic local derivation contract. Absolute paths are forbidden.

Confirmed local material metadata:

| Case | Duration | Dialogue count | WAV format | Confirmed positive coverage |
|---|---:|---:|---|---|
| short | 24.102s | 8 | 16 kHz mono 16-bit PCM | `clear-japanese` |
| medium | 498.872s | 165 | 16 kHz mono 16-bit PCM | `clear-japanese`, `background-noise`, `english`, `proper-nouns` |
| long | 4144.235s | 908 | 16 kHz mono 16-bit PCM | `clear-japanese`, `long-silence`, `continuous-speech-over-30s`, `english`, `proper-nouns`, `background-noise`, `rapid-dialogue`, `numbers`, `person-names` |

The committed contract records only these non-sensitive facts plus stable IDs/hashes after local validation. It does not copy ASS Dialogue text. Coverage is positive and per-case; absent/unconfirmed labels are not added. The corpus-wide union lacks only `low-volume`. A small redistributable fixture validates parser/hash behavior but does not replace the three authoritative cases.

## Result Contract

All candidate and Python-reference results share one versioned envelope:

- corpus/manifest/case/WAV/ASS identity hashes plus manifest-wide duration-class and coverage-tag snapshots;
- candidate kind (`native-candidate` or `python-reference`), engine/model/runtime revision;
- environment, explicit interpreter/cache parameters, device/compute/VAD/config;
- cold/warm sample counts and load/inference/total timing;
- inference/total RTF, peak RSS/working set, optional VRAM and methods;
- final segments, privacy-safe text hashes, CER counts, timeline errors, confirmed speech gaps and eligible time errors;
- `completed`/`failed`/`skipped`, stable error category and sanitized reproduction command.

Unavailable metrics are `null` plus `unavailableReason`. Machine absolute paths and private text are never included in tracked reports.

## Metrics

- CER: Unicode NFKC, newline normalization, remove all Unicode whitespace, preserve punctuation/Latin case/other characters; deterministic S/D/I/N Levenshtein.
- P95: deterministic linear interpolation.
- Timeline: count empty text, non-positive ranges, negative starts, end beyond verified duration, and non-monotonic ordering.
- Speech gaps: subtract candidate coverage only from ASS-derived confirmed speech intervals; report uncovered spans `>=1500ms`.
- Timing: align normalized reference/candidate character streams and map each reference Dialogue start to the candidate segment containing its first aligned character, so segmentation differences do not require exact whole-segment equality; Qwen3 timing is eligible only for ForcedAligner provenance.
- Frozen hard gates are 0 invalid/out-of-range segments, 0 confirmed speech gaps `>=1500ms`, and Qwen3 start median `<=150ms`/P95 `<=500ms` with ForcedAligner provenance only.
- User-reviewed absolute gates are CER `<=0.35` per engine/case; inference RTF `<=1.0` on pure CPU or `<=0.5` on accelerated GPU paths; short cold process wall `<=120s`; peak RSS `<=6 GiB` for CTranslate2 or `<=12 GiB` for CrispASR. No VRAM gate is defined. Python-relative deltas and Python pass/fail labels are never gates.

## Python Reference Runner

The optional runner uses the Hikaru Sub development interpreter and dependency set. It records `faster-whisper==1.2.1`, `ctranslate2==4.8.0` where applicable, exact interpreter, model revision, and explicit `HF_HOME`/cache root parameters.

Cache path/configuration is reproducibility metadata, not truth. A run from the wrong system Python or wrong cache context is invalid evidence and must be regenerated, not manually edited.

Current implementation observations retained only for diagnostics:

- faster-whisper `large-v2` + `ja` + duration `>=600000ms` uses V4/seed/session/semantic segmentation behavior;
- ReazonSpeech uses 45s chunks with 2s overlap for audio `>=60s`;
- Parakeet, Qwen3 and ReazonSpeech may replace previews with final `TranscriptSegmentRefresh`.

These behaviors are regression cases, not required native algorithms.

## Determinism And Privacy

- JSON keys/order/numeric formatting and report sorting are fixed.
- Private reference text remains in ignored local artifacts; tracked output uses IDs, hashes, aggregate metrics and limitations.
- `.gitignore` covers `.asr-benchmark`, benchmark results, models and temp reports before any run.
- Writes use temporary files followed by atomic replace.
- Report names use `reference`, not `baseline`, for current Python implementation data.

## Compatibility And Handoff

T02/T03 consume:

- authoritative corpus manifest/schema and case/WAV/ASS hashes;
- ASS-derived reference semantics and shared normalization/metric definitions;
- versioned result schema and comparison/report commands;
- frozen hard gates plus user-reviewed absolute CER/RTF/resource budgets when available;
- optional `python-reference-report.md` only as diagnostics.

Later native harnesses produce the same result envelope or a thin adapter. They must not duplicate CER/P95/gap/report logic and must not wait for Python reference availability to compare against ground truth.

## Rollback

Remove benchmark CLI/tests/schema/README/task reports only. No engine, user setting, cache layout or production path is changed; ignored user corpus/results remain user-owned.
