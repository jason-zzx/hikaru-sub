# T10 Parakeet / ReazonSpeech Input Lock

## Status and boundary

This lock freezes the initial T10 candidates before product code or model-backed acquisition:

- ReazonSpeech `R1`: `reazonspeech-nemo` -> explicit upstream `parakeet`;
- Parakeet `P1`: `parakeet` -> explicit upstream `parakeet`;
- sequential 15,000 ms PCM windows, no overlap, no VAD, no reference/Python repair, no proportional timing;
- maximum final cue size: 96 Unicode scalar values and 15,000 ms;
- one atomic protocol-v1 `segmentsReplace`, then `completed`; raw upstream preview is ineligible;
- each candidate completes short-v1 / medium-v1 / long-v2 under one frozen identity even after a quality-gate failure.

`qualified` means only `accepted-t10-engine-algorithm-input`. It does not authorize Release/default routing or a formal GPU pack/device route.

Canonical private root, ignored in both active and archived task locations:

```text
.trellis/tasks/**/08-13-native-asr-parakeet-reazon/research/local/
```

Private audio, models, binaries, absolute paths, raw text/events, stderr, and build output stay below that root.

## Authoritative corpus and comparator

| Input | Identity |
|---|---|
| T01 manifest | `.asr-benchmark/manifest.json`, 2,868 bytes, SHA-256 `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` |
| shared comparator | `scripts/asr-benchmark.py`, SHA-256 `b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822` |
| short-v1 WAV | 24,102 ms, SHA-256 `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` |
| medium-v1 WAV | 498,872 ms, SHA-256 `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` |
| long-v2 WAV | 4,144,235 ms, SHA-256 `af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e` |

The manifest and comparator identities above are current T03C/T08 authority. Python output is diagnostic only.

## CrispASR source/runtime/device identity

| Input | Identity |
|---|---|
| CrispASR source | v0.8.22 commit `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`, MIT |
| ggml submodule | `bfe8ea228d8134d03641c9fcf233a9931f3730de` |
| c2pa-audio submodule | `e40329b83f16f67bb5ddc7bb13ae18de0a9376fc` |
| reviewed CUDA `crispasr.dll` | 11,414,528 bytes, SHA-256 `824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e` |
| development device handoff | T09 `parakeet-family: development-gpu-ready` |
| open params | ABI 2, threads 16, CUDA `use_gpu=1/n_gpu_layers=-1/preference=cuda`; CPU claims require a separate explicit CPU matrix |

T10 may rebuild the worker after policy changes; the final evidence lock must replace any pre-implementation worker/runner hashes with the measured T10 hashes before acquisition publication.

## Model identities

| Engine | File identity | Bytes | SHA-256 | License |
|---|---|---:|---|---|
| ReazonSpeech R1 | `reazonspeech-nemo-v2-q8_0.gguf` | 667,147,072 | `20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2` | Apache-2.0 |
| Parakeet P1 | `parakeet-tdt-0.6b-ja-q8_0.gguf` | 673,554,880 | `5a61e6c7d956c3c72a76fafcd798cac0c9ea66d0e29b3910cd04865a1e42cc17` | Apache-2.0 |

No model identity may be inferred from a filename. Size/hash verification precedes worker launch. The Parakeet size/hash above was re-attested from the ignored archived T03 private model bytes before acquisition.

## Candidate algorithm identity

Common configuration:

```text
windowDurationMs=15000
overlapMs=0
vad=false
referenceRepair=false
proportionalTiming=false
maxCueCodePoints=96
maxCueDurationMs=15000
protocolVersion=1
finalEmission=one-atomic-segmentsReplace
matrix=short-v1,medium-v1,long-v2
shortSampling=1-cold+3-warm
mediumSampling=1-fresh-process
longSampling=1-fresh-process
shortColdWallRecorded=true
shortPeakRssRecorded=true
warmInferenceStatistic=median-of-3
mediumLongRowStatus=completed-or-valid-structured-failure
```

R1 uses exactly one legal top-level source segment per window. Native words are diagnostic only.

P1 requires exactly one source segment per window, byte-exact source/word text conservation, and positive-duration native words as timing anchors. Zero-duration runs attach only to a legal neighboring anchor without changing timing.

## Toolchain and local-root readiness

| Input | Identity |
|---|---|
| Platform | Windows x64 |
| MSVC | 19.44.35222, pinned x64 tool root 14.44.35207 |
| CMake | 4.1.1-msvc1 |
| Ninja | 1.12.1 |
| CUDA Toolkit | 12.8.93; architecture 8.6 |
| private roots | `research/local/{build,models,audio,raw,stderr}` created; active/archive spellings both match the canonical ignore rule |

## Evidence validity

- A quality-gate failure or identity-valid candidate-caused structured load/compute/resource failure with a complete trace is a valid failed row; continue later cases.
- Identity/input/runtime attestation drift, harness corruption, incomplete trace, or external termination without atomic output is invalid/unscored and requires repair plus rerun of the affected case.
- Any source, policy, cap, binary, DLL, model, runtime, device, manifest, comparator, or candidate-config change invalidates affected rows.
