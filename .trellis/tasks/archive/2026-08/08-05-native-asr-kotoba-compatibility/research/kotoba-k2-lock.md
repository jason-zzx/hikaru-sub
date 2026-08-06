# T08 Kotoba K2 Input Lock

## Candidate

- candidate: `kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1`
- ownership rule: `latest-start-half-open-v1`
- source window: maximum `1500` mel frames / `15000ms`
- model tensor/timestamp range: `3000` frames / `30000ms`
- maximum applied stride: `1000` mel frames / `10000ms`
- full-window overlap floor: `500` frames / `5000ms`
- parsed advance: `min(parsedAdvance, sourceWindowFrames)`
- applied advance: `min(proposedAdvance, 1000, remainingFrames)`
- no-speech proposed advance: current source window
- exact boundary ownership: start at `S[i+1]` belongs to window `i+1`
- final ownership: `[S[last], audioDurationMs)`
- dedup: exact `(startMs, endMs, text)` only, before callback
- text/timing policy: preserve token-derived values; no clipping, stretching, synthesis, fuzzy merge, reference repair, or gap filling
- VAD: disabled; ordinary faster-whisper and K1 remain unchanged

## Ground Truth

- corpus: `hikaru-user-ja-ground-truth-v1`
- current manifest: `.asr-benchmark/manifest.json`
- manifest SHA-256: `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea`
- K1/correction input lock SHA-256: `24d20963c1d5790d142694f579e2baf7baf21bf19355e126aaa66352a95a7c4e`
- long case: `long-v2`, audio SHA-256 `af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e`, ASS SHA-256 `46b4891a4f86c70c1fe54ba4dcfbd776b361f73bb774f1d14e0f2bb53659d04b`, duration `4144235ms`, Dialogue count `681`
- old `long-v1` ASS remains historical only

## Model And Runtime

- repository: `kotoba-tech/kotoba-whisper-v2.0-faster`
- revision: `f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc`
- license: MIT
- model files: inherited exact T02/K1 identities from `kotoba-k1-lock.md`
- CTranslate2: `4.8.0`, pinned source commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698`
- CUDA Toolkit: `12.8.93`, architecture `8.6`, dynamic loading ON, cuDNN OFF
- device: NVIDIA GeForce RTX 3070, device 0, compute capability `8.6`
- driver: `596.49`, `nvcuda.dll` `32.0.15.9649`, CUDA Driver API `13020`
- compute: FLOAT16
- restricted PATH roles: task-local runtime bin, CUDA Toolkit 12.8 bin, Windows System32
- PATH root identity: `307e7f236aeb7dc81b18bc42f292e1cac2ef58478f5beccb0a58ab19cff4eb22`

## Measured Build Identity

| File | Bytes | SHA-256 |
|---|---:|---|
| `hikaru-asr-ctranslate2-tests.exe` | 802816 | `314cb67dc87225787d480a6986da009f747d1e72b5cc122166fe292fb90f2b14` |
| `hikaru-asr-worker.exe` | 516096 | `93b8b6781ab419033695801f511e530467918fc0502f39494c92bf37116947bf` |
| `ctranslate2.dll` | 36974592 | `0c0f1436489b656d893c0e7c186192526edbe6106b530c09753b981294c9a337` |
| `hikaru_asr_tokenizer.dll` | 2139136 | `7a767701e05b11fa4c2667409420eac513f2cf24fcdc52cf0d769ce752db2fea` |
| `onnxruntime.dll` | 15809848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` |
| `onnxruntime_providers_shared.dll` | 21856 | `599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8` |

## Source And Tool Identity

| File | SHA-256 |
|---|---|
| `native-asr/src/ctranslate2_whisper.hpp` | `caa9755800cbf04bfe331cd051479e2035b463f170deb0f4fc4f6771f9d450e6` |
| `native-asr/src/ctranslate2_whisper.cpp` | `54d60fb121bc804a54198483fd4febf1336b18ed65519dee6d01cbb7d33af978` |
| `native-asr/src/main.cpp` | `ee9185146e553627aa5e7343507e4ec160b209bfe5264ab6999a14fba558a78f` |
| `native-asr/tests/ctranslate2_whisper_tests.cpp` | `480735996109ebcb7ca553b300262b85996a33d7772fb1ea414e6b57859fabae` |
| `research/kotoba_k2_benchmark_adapter.py` | `fcd018c9bded7b4c4ce39abdd6f761e450cc1bfcdccc161a2f21cb107c0fea98` |
| `research/publish_kotoba_k2_candidate.py` | `554823099398df2b622cbbddca74d187a289931ec42fef1d1d9432951c80c2d7` |
| `research/test_publish_kotoba_k2_candidate.py` | `f993e108305c26c8b86c055da02bdb60dc67f319b0d0ec0f088acddef9ac463a` |
| `scripts/asr-benchmark.py` | `b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822` |

The lock itself is included in the publisher's correction-lock before evidence publication. Any source, tool, model, runtime, corpus, or configuration change invalidates affected rows.

## Seven K1 Gap Coordinates

Coordinate-set SHA-256: `7aeda829b3a12c3a52e48ec2db70e1bf48af08f69cf839fcae5f26312657350f`.

| Index | Start ms | End ms |
|---:|---:|---:|
| 1 | 941630 | 945090 |
| 2 | 1276940 | 1278540 |
| 3 | 1289540 | 1291540 |
| 4 | 1456720 | 1458540 |
| 5 | 1606830 | 1608540 |
| 6 | 1845700 | 1847230 |
| 7 | 4050480 | 4053460 |

All seven remain mandatory semantic gate coordinates. The publisher reports only index, coordinates, and `covered|still-missing`; no coordinate is waived before complete K2 scoring.

## Gates And Matrix

Every case must satisfy CER `<=0.35`, accelerated inference RTF `<=0.5`, short cold wall `<=120s`, peak RSS `<=6 GiB`, zero timeline errors, and zero semantic gaps `>=1500ms`. Run short as 1 cold + 3 warm, medium once, and long-v2 once under this exact identity regardless of prior failures. Only the complete three-case matrix may publish `accepted-kotoba-algorithm-input`; any mandatory failure publishes `stop-revise`, leaves native Kotoba disabled, and returns to planning.


## Loaded Module Hashes Bound For Publication

The following required loaded-module hashes are inherited from the T07 restricted CUDA lane and are repeated here so the K2 adapter can fail closed using only this lock:

- `ctranslate2.dll`: `0c0f1436489b656d893c0e7c186192526edbe6106b530c09753b981294c9a337`
- `cublas64_12.dll`: `9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99`
- `cublasLt64_12.dll`: `b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7`
- `hikaru-asr-ctranslate2-tests.exe`: `314cb67dc87225787d480a6986da009f747d1e72b5cc122166fe292fb90f2b14`
- `hikaru_asr_tokenizer.dll`: `7a767701e05b11fa4c2667409420eac513f2cf24fcdc52cf0d769ce752db2fea`
- `nvcuda.dll`: `ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c`
- `onnxruntime.dll`: `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257`
- `vcomp140.dll`: `31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7`
