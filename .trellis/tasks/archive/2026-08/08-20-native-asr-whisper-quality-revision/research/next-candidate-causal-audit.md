# Next ordinary Whisper causal audit after fallback rejection

## Scope and stop boundary

> **Source/evidence-only planning research.** No ASR model was loaded for this audit. It does not select a new candidate, authorize implementation or model-backed acquisition, alter the frozen v3 identity, qualify either anchor, create CPU inheritance, or change the Python legacy route.

The reviewed v3 diagnostic closed `upstream-generation-fallback-parity-v1`:

- `short-b5-on-vad-fallback` made one temperature-0 generation call and zero fallback calls; insertions remained `6 > 2`.
- `medium-b5-on-vad-fallback` made 29 generation calls with 12 fallback calls, but CER/S/D/I and semantic gaps regressed.
- The all-or-nothing result is `no-candidate-selected`; a medium-only history fix cannot address the mandatory one-window short blocker.

The next question is therefore earlier than candidate selection: **which stage first diverges from the authoritative Python short path—input features, CTranslate2 runtime execution, generated tokens, or timestamp parsing?**

## Newly confirmed short-path facts

### Audio and VAD input

- `.asr-benchmark/short.wav` is mono PCM16, 16 kHz, 385,637 samples.
- faster-whisper `decode_audio` and the native PCM16 `/32768.0` conversion produce byte-identical float32 samples: SHA-256 `2cbf22e7635a41cf751401525e4358c19f2d452ae99c0ced78f65b6e9327e1c2`.
- The reviewed native exact-V6 VAD row retained one interval `[0, 385637)` and all `385637/385637` samples. Therefore the native short model input waveform is the original decoded waveform.
- The archived Python baseline records `vadFilter=true` but no interval or post-VAD sample hash. Exact Python post-VAD equality remains unobserved rather than assumed.

### Prompt, suppression and decode options

The installed large-v3 snapshot and faster-whisper 1.2.1 resolve:

- initial prompt tokens `[50258, 50266, 50360]` (`sot`, Japanese, transcribe), aggregate SHA-256 `908b1562c473b2889d6ac86c6e011ec4c681f6e78c971f0d8e73424057a42ba0`;
- 88 default suppressed token IDs; the Python-resolved set is exactly equal to converted `config.json:suppress_ids`;
- begin suppression `[220, 50257]` equals converted `suppress_ids_begin`;
- beam 5, patience/length/repetition `1`, no-repeat ngram `0`, max length `448`, max initial timestamp index `50`, score/no-speech return, temperature-0 options and fallback policy are source-aligned (`asr-service/.venv/Lib/site-packages/faster_whisper/transcribe.py:1402-1460`; `native-asr/src/ctranslate2_whisper.cpp:1828-1895`).

No remaining prompt/suppression/config mismatch is demonstrated for the first short generation call.

### Feature tensor is close but not byte-identical

The waveform is identical, but the complete padded short Mel tensors differ because the implementations use different numeric FFT paths:

| Producer | Shape | SHA-256 |
|---|---|---|
| faster-whisper 1.2.1 NumPy feature extractor | `80 × 3000` float32 | `51209b71c3450718055dfad8a3d5923283dd95d702d606b0bdf56aac53218aa9` |
| native `official_log_mel_for_test` / pocketfft | `80 × 3000` float32 | `c2fc425ae691a4b1f9acd92580061ad97df82e01165747d761653f87634b9e08` |

The maximum absolute difference is `7.510185241699219e-06`; mean absolute difference is `6.203453040143359e-08`; 89,425 values differ, none by more than `1e-5`. Existing feature goldens check sparse points with `5e-4` tolerance and therefore prove algorithmic closeness, not model-input byte identity (`native-asr/tests/ctranslate2_whisper_tests.cpp:1599-1617`). The Python path is `feature_extractor.py:198-225`; native is `ctranslate2_whisper.cpp:172-257`.

This difference is too small to declare causal, but beam search can amplify small encoder/logit differences. It must be isolated rather than dismissed or promoted directly into a feature-rewrite candidate.

### CTranslate2 version matches; binary/runtime identity does not

Both paths report CTranslate2 `4.8.0` and CUDA FP16 on device 0, but they execute different binaries and module families:

| Runtime | CTranslate2 binary | Relevant module policy |
|---|---|---|
| Python baseline environment | 59,292,672-byte `ctranslate2.dll`, SHA-256 `60e536c0801432cde4a105aeebbca35fbf228aa3e901807b2310b02676c2f140` | wheel ships `cudnn64_9.dll` SHA-256 `9edbcdff73b0af070eb160b2ce66e59feca04aa017351d8eedcc5e8e149967d2` and `libiomp5md.dll` SHA-256 `982233366b0afcda1e0f55a0b134097e35b779613f54ddb69e685e6cd06b755f` |
| native v3 development runtime | 36,974,592-byte `ctranslate2.dll`, SHA-256 `e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2` | `WITH_CUDNN=OFF`, CUDA dynamic loading, System32 `vcomp140.dll` (`native-asr/CMakeLists.txt:343-362`) |

The archived Python baseline freezes package versions but not the loaded DLL inventory or binary hashes. The presence of the wheel's cuDNN/OpenMP files does not prove which kernels caused the output, but the runtime identity mismatch is real and exists in both short and medium.

### Existing output evidence localizes the symptom but not the stage

- The native v3 short raw row generated 106 tokens; decoding all non-timestamp text tokens exactly equals the concatenated native segment text, SHA-256 `d5eb90a205337e242dbcfd2752f2173adbff50a5178219365b9c10894b82479c`. Native parsing did not discard its generated text.
- The authoritative Python short hypothesis is deterministic across cold plus three warm samples and has raw SHA-256 `4ae70515a50f3e7368655a021c94e5db7edaa05372a02d14c93bf77dc1837de0`.
- The archived Python raw row has no generated token IDs, first-attempt hash, fallback-attempt telemetry, Mel hash, post-VAD waveform hash, loaded-module inventory, or cross-parser result. Therefore existing evidence cannot distinguish feature, runtime, generation, or parser causality.

## Ranked remaining explanations

1. **Feature/runtime numeric divergence or their interaction — verified inputs differ, causality unmeasured.** Both the Mel tensor bytes and CTranslate2 binary/module identity differ before the first generated token. These are the only verified differences that exist in the one-window short blocker and can also affect medium.
2. **Timestamp-token parsing difference — possible but not demonstrated.** Native retains all of its own generated text. Python token evidence is absent, so identical tokens processed differently cannot yet be excluded. Parser parity can be tested without using reference text.
3. **Python VAD output identity — low-cost missing attestation.** Native retained the full waveform; Python likely does as well, but the archived baseline does not prove it. A future trace must bind the post-VAD sample hash.
4. **Previous-text history eligibility — verified medium-only mismatch.** It remains relevant after the short root cause is understood, but cannot be a complete next candidate.
5. **Arbitrary beam/VAD/prompt/suppression/post-processing changes — rejected.** Existing diagnostics or source evidence do not support them, and reference-derived repair remains forbidden.

## Recommendation: one diagnostic scope, not a new candidate

### `short-input-runtime-parity-bisect-v1`

Do not freeze another quality candidate yet. First implement a task-local, promotion-ineligible short-only parity probe with a closed `2 × 2` matrix:

| Cell | Feature tensor | CTranslate2 runtime |
|---|---|---|
| `python-runtime-python-mel` | frozen faster-whisper/NumPy short Mel | frozen Python-wheel CT2 4.8.0 |
| `python-runtime-native-mel` | frozen native/pocketfft short Mel | frozen Python-wheel CT2 4.8.0 |
| `native-runtime-python-mel` | frozen faster-whisper/NumPy short Mel | frozen native no-cuDNN CT2 4.8.0 |
| `native-runtime-native-mel` | frozen native/pocketfft short Mel | frozen native no-cuDNN CT2 4.8.0 |

All cells use the same frozen decoded/post-VAD waveform identity, model snapshot, prompt token IDs, suppression IDs, first-attempt options and exact fallback decision logic. They are execution-parity probes, not subtitle-quality rows. Raw token IDs/text remain ignored-local; tracked output contains only identities, counts, scores, trigger categories and hashes.

Before model load, the probe implementation must provide:

1. exact waveform, post-VAD waveform, Mel, prompt, suppression, option, model and runtime/module hashes;
2. first temperature-0 token/count/score/no-speech/decoded-text aggregate hashes before fallback selection;
3. per-attempt fallback telemetry and selected-output aggregate hash;
4. both Python and native timestamp parsers run offline over each acquired token sequence, with only aggregate segment/text hashes tracked;
5. fake/no-model mutation tests for swapped Mel/runtime labels, module drift, prompt/suppression drift, token/score aggregate drift, parser drift, privacy and promotion rejection;
6. two independent runs per cell, or a mandatory repeat for any cell that selects a sampling temperature, to prove deterministic interpretation;
7. independent pre-model review, then another explicit acquisition decision.

### Frozen decision rule

1. `python-runtime-python-mel` must reproduce the authoritative Python short raw hypothesis hash `4ae70515...`; otherwise current runtime cannot reproduce the authority and the result is `baseline-runtime-unresolved`, not a candidate decision.
2. `native-runtime-native-mel` must reproduce the reviewed v3 native short aggregate/text hash `d5eb90a2...`; otherwise the probe identity is invalid.
3. If `A == B`, `C == D`, and Python-runtime outputs differ from native-runtime outputs, isolate the next scope to runtime/build parity.
4. If `A == C`, `B == D`, and Python-Mel outputs differ from native-Mel outputs, isolate the next scope to exact feature parity.
5. If neither factor separates independently, publish `feature-runtime-interaction`; do not combine both changes into production without a separately reviewed candidate.
6. If raw token hashes match but Python/native parser hashes differ, isolate the next scope to parser parity, retaining the absolute zero-timeline-error gate.
7. Any identity drift, non-reproduction of either anchor output, nondeterminism, missing raw token trace or external termination is invalid/unscored evidence.

Only a successful bisect may justify one new causal candidate. This report does not authorize implementing the probe or loading a model.

## Rejected shortcuts

- Enabling cuDNN immediately: the runtime mismatch is real but causality is unmeasured, and the wheel/native builds differ by more than one flag.
- Replacing native features immediately: the tensors are not byte-identical, but the observed maximum error is below `1e-5` and has not been linked to token changes.
- Fixing history eligibility now: cannot affect short-v1.
- Reacquiring the formal six-row matrix: no candidate exists.
- Treating fresh Python output as a new quality reference: the archived `python-legacy-cuda-v1` authority remains fixed; the probe only tests reproducibility and stage parity.

## Residual risk

Even if the short bisect isolates one stage, medium history eligibility and the large-v2 long-path asymmetry remain separate future concerns. A selected short parity fix must still pass a new short/medium diagnostic before any formal large-v3/large-v2 six-row candidate can be frozen.
