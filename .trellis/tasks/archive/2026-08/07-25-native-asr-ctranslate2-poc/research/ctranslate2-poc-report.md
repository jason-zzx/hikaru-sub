# CTranslate2 Whisper/Kotoba Gate 0 PoC Report

## Decision

**`stop-revise` for the current decoding/windowing candidate.**

The task-local Windows x64 CPU runtime proves that pinned CTranslate2 4.8.0 plus oneDNN 3.1.1 can load and run both `large-v3` and Kotoba v2.0 without Python or CUDA. All six authoritative short/medium/long model runs completed and produced legal token-derived timelines. Runtime feasibility, CPU RTF and peak RSS are within the frozen T01 budgets.

The current minimal fixed-window algorithm is not ready for T06 productization:

- `large-v3` short CER is `0.3583`, above the `0.35` gate by `0.0083`;
- both routes miss confirmed reference speech on medium and long cases;
- only Kotoba short passes every applicable frozen gate.

This is Gate 0 evidence only. It proves the native backend is technically viable, but the algorithm/configuration must be revised and remeasured before product integration.

## Scope And Authority

- Quality/timeline authority: T01 manifest `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277` and its local WAV+ASS pairs only.
- Shared metrics: `scripts/asr-benchmark.py`; `research/poc-src/benchmark_adapter.py` imports the T01 CER, timeline and confirmed-gap implementation rather than copying it.
- Python output was not used as expected output, a relative gate, or annotation input.
- Source and sanitized evidence are task-local. Dependencies, binaries, raw segments/results, models and private corpus remain under ignored directories.

## Native Ground-Truth Matrix

| Route | Case | CER | CPU inference RTF | Cold wall | Peak RSS | Timeline errors | Confirmed gaps >=1.5s | Result |
|---|---|---:|---:|---:|---:|---:|---:|---|
| large-v3 | short-v1 | `0.3583` | warm median `0.777` | `32.549s` | `3.44 GB` | 0 | 0 | **fail: CER** |
| large-v3 | medium-v1 | `0.1745` | `0.717` | informational | `3.47 GB` | 0 | 10 | **fail: gaps** |
| large-v3 | long-v1 | `0.3124` | `0.706` | informational | `3.70 GB` | 0 | 71 | **fail: gaps** |
| Kotoba v2.0 | short-v1 | `0.3417` | warm median `0.556` | `20.137s` | `1.86 GB` | 0 | 0 | **pass** |
| Kotoba v2.0 | medium-v1 | `0.2224` | `0.515` | informational | `1.89 GB` | 0 | 5 | **fail: gaps** |
| Kotoba v2.0 | long-v1 | `0.3165` | `0.459` | informational | `2.12 GB` | 0 | 36 | **fail: gaps** |

Evaluation rules:

- CER `<=0.35` independently per route/case;
- pure CPU inference RTF `<=1.0`;
- short fresh-process wall `<=120s`;
- CTranslate2 peak RSS `<=6 GiB`;
- zero invalid/out-of-bounds timeline segments;
- zero ASS-confirmed speech gaps `>=1500ms`.

Short cases use 1 cold + 3 warm runs. Medium and long cases use one measured run each. `research/evidence/matrix.json` contains the exact aggregate values, per-gate status, ignored raw/result hashes, final binary identity and input-lock identity without transcript text.

## Timestamp Boundary Finding

The initial PoC incorrectly treated the selected seek size (`15s` for Kotoba or the shorter final source chunk) as the model timestamp range even though CTranslate2 receives a padded `3000`-frame, `30s` Whisper tensor. That implementation error caused the earlier `timestamp-out-of-window` classifications.

The reviewed rule is now:

1. timestamp tokens must remain inside the actual 30-second model timestamp range;
2. a segment whose **start** is at or after verified WAV end fails;
3. an otherwise valid token-derived **end** after verified WAV end is bounded to WAV duration;
4. ignored raw evidence retains the original token-derived start/end, a bound flag, token IDs and trace hash;
5. no text, timestamp start, missing speech or reference annotation is synthesized.

This source-end bound follows the parent native design's common normalization to `[0, durationMs]`. Self-check includes positive and negative regression vectors. Across the matrix, source-end bounding affected only the final segment of each large-v3 sample (4 short samples, one medium, one long); Kotoba required none. Final scored timelines have zero invalid/out-of-bounds segments.

Controlled failed evidence is also auditable: the CLI writes a `failed` envelope containing the trace hash, token IDs, source/model window bounds and stable error, and the evidence validator accepts that envelope while the T01 adapter correctly refuses to score it.

## Build And Contract Evidence

| Obligation | Status | Evidence |
|---|---|---|
| Windows x64 CPU Release build | pass | MSVC 19.50, Ninja, `evidence/build-runtime.json` |
| CPU int8 backend | pass | CTranslate2 4.8.0 with pinned static oneDNN 3.1.1 |
| Public CTranslate2 Whisper API | pass | `ctranslate2::models::Whisper` only |
| Immutable model identity | pass | model size and SHA-256 checked before CTest/model run |
| Ordinary Whisper without preprocessor | pass | positive self-check fixture |
| Kotoba missing preprocessor | pass | controlled negative self-check fixture |
| Tokenizer/prompt | pass | native `tokenizers 0.22.1`; special-token and text goldens |
| WAV/log-mel | pass | PCM16/16k/mono validation; pinned official OpenAI Whisper golden |
| Timestamp/segment contracts | pass | paired/consecutive/leading-silence/source-bound and fail-closed invalid vectors |
| Clean-PATH launch | pass | self-check and immutable Kotoba contract with only Release directory in PATH |
| No Python/CUDA dependency | pass | PE dependency inventory |

Final Release CTest result: **3/3 passed** (`poc-self-check`, lock-aware `large-v3-contract`, lock-aware `kotoba-contract`).

All six model runs used the same final reviewed binary: 443,904 bytes, SHA-256 `f8ee5060a384438da4a5fac2e7951ff6004cd15935b65dfd90ee79d208d5d1e2`. Each ignored raw envelope records this identity, the same input-lock SHA-256, native environment metadata and distinct source/model window bounds.

## Immutable Inputs And Licenses

| Input | Pin | License/evidence |
|---|---|---|
| CTranslate2 | `v4.8.0` / `54a546c`; archive SHA-256 `cd142054...` | MIT |
| oneDNN | `v3.1.1`; archive SHA-256 `d1cd58...` | Apache-2.0 |
| task-local tokenizer FFI | project source | Apache-2.0 |
| Rust tokenizer dependency graph | Cargo.lock SHA-256 `4e9f34...` | exact 81-package inventory in `evidence/tokenizer-licenses.json` |
| pocketfft | `c90e55b` | BSD-3-Clause |
| nlohmann/json | pinned CTranslate2 header | MIT |
| Systran large-v3 snapshot | `edaa852...` | MIT |
| Kotoba converted snapshot | `f44edd3...` | MIT, pinned model-card front matter |
| MSVC/OpenMP runtime | Visual Studio 18 toolchain | Microsoft Visual C++ Redistributable terms; final notice review belongs to T12 |

All six final model runs consumed the same current `research/inputs.lock.json`, SHA-256 `e0036e0f4f63180239f05524cac62b895017e49bd0eed3e72420432bf2a9b9f7`. Each raw envelope and adapted T01 result records this hash. The lock identifies the pinned Kotoba converted repository as MIT from its immutable model-card front matter and includes the full tokenizer/OpenMP/golden-source license metadata.

The log-mel golden is independently reproduced from pinned OpenAI Whisper commit `25639fc17ddc013d56c594bfbf7644f2185fad84`, with retained `audio.py` and `mel_filters.npz` hashes in `evidence/log-mel-golden.json`. Python/Torch was only the executor for the pinned official algorithm and assets, not a transcript or quality oracle.

## Runtime Inventory

Final reviewed runtime files:

- `hikaru-ct2-poc.exe`: identity in `evidence/build-runtime.json`;
- `ctranslate2.dll`: 22,417,408 bytes;
- `poc_tokenizer.dll`: 3,931,136 bytes.

PE dependencies are task-local DLLs plus Windows, MSVC and OpenMP runtime DLLs. No Python or CUDA library is loaded. This is test-machine evidence, not a final package-size or cross-Windows compatibility claim.

## Reproduction

```text
research/poc-src/build.cmd all
hikaru-ct2-poc.exe --run --engine <route> --model <immutable-model> --audio <authoritative-wav> --lock research/inputs.lock.json --output research/local/runs/<ignored>.json --repeats <count>
hikaru-ct2-poc.exe --validate-evidence research/local/runs/<ignored>.json
python research/poc-src/benchmark_adapter.py --raw research/local/runs/<ignored>.json --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark --case <case-id> --lock research/inputs.lock.json --output .asr-benchmark/results/<ignored>.json
```

Raw output outside task-local `research/local/` is rejected before writing.

## Gate 0 Recommendation

- **Proceed with CTranslate2 as the native backend/runtime candidate.** Model loading, public API use, CPU int8 performance, memory, token-derived timestamp legality and binary isolation are feasible.
- **Do not proceed with the current minimal decoding/windowing algorithm unchanged.** T06 must evaluate official/community long-form seek advancement, VAD/segmentation and decoding candidates against the same ground truth until every route/case meets the confirmed-gap and CER gates.
- Python parity remains non-gating; the failures above are absolute ground-truth failures.
