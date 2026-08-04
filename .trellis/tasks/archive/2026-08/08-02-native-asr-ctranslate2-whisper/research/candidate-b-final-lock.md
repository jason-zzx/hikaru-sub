# T06 Candidate B Final Short/Medium Measurement Lock

## Lock Status

**Re-frozen after the last independent Candidate B path-binding review, before replacement Candidate B large-v3 measurement.** The prior final lock SHA-256 `d56d31a87c9915731bad918893bd81132cd150320965886adc148892e3b2bf84` and its short/medium evidence are invalid because a correlated mutation could rewrite every loaded-module canonical path and preserve the previous policy shape. This lock binds the reviewed identity-instrumented runner, actual CPU/module inventory, the canonical identities of both restricted PATH roots, a fixed relative module layout, adapter/publisher, and the expanded mutation matrix. Historical Candidate A, CPU RTF diagnosis, decode selection, selected CPU short/medium, and selected CPU long evidence remains unchanged and separate.

This iteration authorizes only large-v3 `short-v1` (1 cold + 3 warm) and `medium-v1` (1 measured). `long-v1`, large-v2, the other five models, GPU, packaging, downloader/readiness, settings/frontend, Release/default routing, T07 creation, staging, commit, and archive remain forbidden.

## Parent Locks And Authority

| Input | Bytes | SHA-256 |
|---|---:|---|
| Candidate B planning lock | 21,234 | `c06f9deac18106dc9caa215a8102378966cbe238ac5e048f6fd296968e944380` |
| Selected CPU decode lock | 11,428 | `0be239a83640c65f740f169da6c37a1141d3e92140d829243787671f9f410083` |
| T01 comparator `scripts/asr-benchmark.py` | 90,768 | `0e12d7f1c833e2c18abe1175334838c3c4c49b17cec5a56131c0ec8d53ca073e` |
| T01 manifest | 2,865 | `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277` |

Authoritative cases:

| Case | WAV bytes/samples/duration | WAV SHA-256 | ASS SHA-256 | Samples |
|---|---|---|---|---|
| short-v1 | `771,318` / `385,637` / `24,102ms` | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` | `60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b` | 1 cold + 3 warm |
| medium-v1 | `15,963,948` / `7,981,952` / `498,872ms` | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` | `d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e` | 1 measured |

The local ASS is parsed only by T01. Raw transcripts, segments, tokens, VAD probabilities, paths, and private media stay below canonical ignored `research/local/`.

## Frozen Algorithm Config

Canonical sorted compact JSON:

```json
{"algorithm":"candidate-b-faster-whisper-v1.2.1-silero-v6","beamSize":1,"computeType":"int8","conditionOnPreviousText":false,"contextSamples":64,"device":"cpu","encoderBatchRows":10000,"language":"ja","lengthPenalty":1.0,"logProbThreshold":-1.0,"maxInitialTimestampIndex":50,"maxLength":448,"maxSpeechDurationSeconds":null,"minSilenceDurationMs":2000,"minSpeechDurationMs":0,"modelWindowDurationMs":30000,"negativeThreshold":0.35,"noRepeatNgramSize":0,"noSpeechThreshold":0.6,"patience":1.0,"promptResetOnTemperature":0.5,"repetitionPenalty":1.0,"sampleRate":16000,"speechPadMs":400,"temperature":0.0,"threshold":0.5,"timestampDrivenSeek":true,"timestampResolutionMs":20,"vad":true,"vadAlgorithm":"candidate-b-faster-whisper-v1.2.1-silero-v6","windowSamples":512}
```

Canonical config SHA-256: `75dedb4923d571a3bac77e0f1c3760d940ff7538c09d240cdf0ea921f5556d30`.

Behavior is exactly the planning lock:

- PCM16 `/32768.0`; full 512-sample tail frame even for divisible input; 64 samples of previous-frame context;
- zero h/c `[1,1,128]`, state carried across direct ORT calls of at most 10,000 rows;
- ORT inter/intra `1`, CPU arena disabled, sequential execution, full graph optimization, explicit CPU EP arena `0`, no custom ops;
- probability start `>=0.5`, end silence `<0.35`, min speech `0ms`, no finite max speech, min silence `2000ms`, pad `400ms`, half-gap merge below `800ms`;
- ordered silence compression, selected timestamp-driven/no-history/beam-1 CT2 decode, exact cumulative-silence restoration rounded to two decimals, verified source-end bound, monotonic original-source progress;
- no batched `160ms/30s`, Silero V4, current Hikaru VAD settings, reference/Python repair, synthetic timing, Candidate A fallback, or `segmentsReplace` without a true revision.

A protocol request selects this identity only with `useVad=true` and no supplied override, or supplied fields exactly equal to the frozen finite defaults. Any supplied `maxSegmentDurationMs` or differing finite value is `vad_config_identity_mismatch`. `useVad=false` preserves the unqualified no-VAD development path.

## Runtime And Dependency Identity

Official Candidate B inputs are unchanged from the planning lock:

| File | Bytes | SHA-256 |
|---|---:|---|
| official `onnxruntime-win-x64-1.28.0.zip` | 78,796,801 | `abef733dacbe2f571547a7150b479b5cb9cc0df22f96c24983a42cadb1b4f8bc` |
| `onnxruntime.lib` (sole ORT import library linked) | 2,124 | `b9fc3cd678257d88a111b0773ede4bfceaf0fe95daab4379f2b2b37348a68781` |
| `onnxruntime.dll` | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` |
| `onnxruntime_providers_shared.dll` | 21,856 | `599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8` |
| exact faster-whisper `silero_vad_v6.onnx` | 1,245,151 | `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2` |

CTranslate2 `4.8.0` commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698`, oneDNN `3.1.1`, pocketfft `c90e55b3d529f8efa40ed01a20de22405f45fc65`, and tokenizer lock SHA-256 `6fbcf8227058918337c2b827243d08e13f7aafa72aa7531d25bd6462b4ce79b7` remain unchanged.

Final Windows x64 Release binaries after Candidate B implementation:

| File | Bytes | SHA-256 |
|---|---:|---|
| `hikaru-asr-worker.exe` | 496,128 | `fb55512246b2a28b4b0c62d23618f6da84e8e3cd792be1e1bcf55c865bc52bdb` |
| `hikaru-asr-ctranslate2-tests.exe` | 671,232 | `4218523d53d09eba8a09023630fe612b1590310d101e7d5d37d9f4d127f5ea22` |
| `ctranslate2.dll` | 22,417,408 | `e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59` |
| `hikaru_asr_tokenizer.dll` | 2,137,088 | `892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d` |
| copied `onnxruntime.dll` | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` |
| copied `onnxruntime_providers_shared.dll` | 21,856 | `599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8` |
| copied `silero_vad_v6.onnx` | 1,245,151 | `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2` |

## Measured CPU, PATH, And Loaded-Module Identity

The identity-instrumented Release runner was probed after the model-backed ORT self-check under the same restricted PATH required for authoritative measurement.

CPU identity:

```json
{"architecture":"x86_64","availableIsa":{"avx":true,"avx2":true,"avx512f":false,"fma":true,"sse2":true},"logicalCores":16,"model":"AMD Ryzen 7 5800X 8-Core Processor"}
```

Restricted PATH policy and locked root identity:

```json
{"entryCount":2,"identitySha256":"439a4172b0cb5d50232784da10208261f69eea476773a2e737b3fe2293a53043","name":"windows-restricted-path-v1","orderedEntryRoles":["measurement-executable-directory","windows-system32"],"restricted":true,"rootIdentitySha256":"77f4714aeb184e043f881d7d7a8ba3028e0d67944e7b727cc2f08009ec8c871e"}
```

Locked relative module layout:

```json
{"identitySha256":"a650e185dc2983b7e5af7e56f17211cf1c7bf2ab9fadb1ccebf07d04e8323994","localModuleNames":["ctranslate2.dll","hikaru_asr_tokenizer.dll","onnxruntime.dll","onnxruntime_providers_shared.dll"],"name":"candidate-b-module-layout-v2","openmpRootRole":"windows-system32","runnerRootRole":"measurement-executable-directory"}
```

The runner rejects Candidate B evidence mode unless PATH resolves in that exact order to its own executable directory and Windows System32. Raw evidence retains the two actual canonical PATH roots and actual canonical module paths below ignored `research/local/`; the root hash and fixed layout bind those paths without tracking them. The adapter requires the runner, CTranslate2, tokenizer, ORT, and providers-shared when loaded to resolve directly beside the measured runner, and VCOMP to resolve directly below the locked System32 root. Adapted/tracked evidence retains only the sanitized roles and identities.

| Actually loaded module | Location role | Bytes | SHA-256 |
|---|---|---:|---|
| `hikaru-asr-ctranslate2-tests.exe` | measurement executable directory | 671,232 | `4218523d53d09eba8a09023630fe612b1590310d101e7d5d37d9f4d127f5ea22` |
| `ctranslate2.dll` | measurement executable directory | 22,417,408 | `e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59` |
| `hikaru_asr_tokenizer.dll` | measurement executable directory | 2,137,088 | `892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d` |
| `onnxruntime.dll` | measurement executable directory | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` |
| `vcomp140.dll` | Windows System32 | 213,064 | `31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7` |

`onnxruntime_providers_shared.dll` remains a verified required sibling/package input (`21,856` bytes, SHA-256 `599629fa...`) but was not loaded by the direct CPU session and is not represented as loaded-module evidence.

## Model Identity

large-v3 is `Systran/faster-whisper-large-v3` revision `edaa852ec7e145841d8ffdb056a99866b5f0a478`, MIT:

| File | Bytes | SHA-256 |
|---|---:|---|
| `config.json` | 2,394 | `a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9` |
| `model.bin` | 3,087,284,237 | `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1` |
| `preprocessor_config.json` | 340 | `7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711` |
| `tokenizer.json` | 2,480,617 | `6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca` |
| `vocabulary.json` | 1,068,114 | `c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1` |

## Source And Evidence Tool Identity

| File | Bytes | SHA-256 |
|---|---:|---|
| `native-asr/CMakeLists.txt` | 15,837 | `d138d60ae90392b6e455e8d7ce12a7837802461adb12e06f2ba117dc2e9cdf4d` |
| `native-asr/CMakePresets.json` | 951 | `95bd92578399dd950253287e8b81458da39613772dc33b796e353213481e023b` |
| `native-asr/src/ctranslate2_whisper.cpp` | 57,739 | `c1a658b3f9cf9899f17fc8a3ec45d4394193121fb81180dbccf1b6a1bb05f880` |
| `native-asr/src/ctranslate2_whisper.hpp` | 7,207 | `95bdd2260b9e46c6584630d533bce97820e8e5c3c8681c1c000f2c0faacb404a` |
| `native-asr/src/main.cpp` | 7,323 | `1b5c91acc983fd1b04374f59cd4142f8518de14ffe6ef262ae908a3a882ba336` |
| `native-asr/tests/ctranslate2_whisper_tests.cpp` | 63,972 | `c417304eb9bf786dfe6bd14e83660e5c11a457abb115388d5753c174ba689e6f` |
| tokenizer `Cargo.toml` | 275 | `e955b913a02811083e1da9881b81524c415f362bdaa8627afa68efdafc999f31` |
| tokenizer `Cargo.lock` | 18,696 | `6fbcf8227058918337c2b827243d08e13f7aafa72aa7531d25bd6462b4ce79b7` |
| tokenizer `src/lib.rs` | 4,458 | `3bba3b26765cb8277c302db5e72353fc673d1133fd0d78a59c46792803aaebcc` |
| `research/candidate_b_adapter.py` | 34,084 | `b5a47e4e8a97583ea270be6deb9e7f69fb58a3a2bbd510415072abcf8a665d88` |
| `research/publish_candidate_b.py` | 18,973 | `be00dc22544ed4c61f39f7b93196fe346dcfe39ef6320349d89499e08a974cc7` |
| `research/candidate_b_evidence_mutation_test.py` | 7,045 | `66c324b663c5f8e63f9c28708d3fa2a37fe8088641e7cbcfe1e34e45f961e9ed` |

## Toolchain Identity

| Tool | Version | Bytes | SHA-256 |
|---|---|---:|---|
| MSVC `cl.exe` | `19.50.35722.0` | 682,568 | `f3b4b9300225963f98c580f253b231a312bf4b516d3a497d652a72bce9a7a21c` |
| MSVC `link.exe` | `14.50.35722.0` | 3,422,280 | `195625614a2c4e64bab5b6273ea40caed080147627517c1bb5fff6d7571d359d` |
| CMake | `4.1.1-msvc1` | 13,395,024 | `537f551032fec66f9a1ad629257ff8348577376cf044ea436c9413f69d6fea20` |
| Ninja | `1.12.1` | 3,466,696 | `5020138b3757035df9dca9a2243624d5810ffa6ae24444bd95f752cbd1b89123` |
| Cargo | `1.96.0` | 31,347,200 | `122f18d28a63fa358f3db266abee1ff1d8aabf0ab7f2dd9ac38a38da99977ae5` |
| rustc | `1.96.0` | 111,104 | `acb138286bbe20c6cf3ec39a7e0a68c3fab0cd949baa2912cf466514d0d531ab` |

## Pre-Measurement Validation Completed

- Windows x64 Release build succeeded.
- CTest passed `5/5`, including Candidate B actual runner/CT2/tokenizer/ORT loaded-module presence after ORT inference; the providers-shared sibling is not claimed loaded.
- Candidate B adapter/publisher self-checks passed; strict raw validation now binds exact CPU, actual module paths, both canonical PATH-root identities, and the fixed module layout, while adapted/tracked output removes absolute paths.
- The focused 21-case mutation matrix is locked and must reject manifest/case/audio/model, final lock/config, runner/worker/DLL/VAD, actual module/CPU/PATH, the correlated all-module/all-root rewrite, metrics, timeout, and failure drift after replacement data is generated.
- CMake verified the official ORT archive, version/commit/API, required headers, sole import library, runtime DLLs, license/notices, and exact VAD asset. CT2-disabled configure remains outside all Candidate B input checks.

## Reproduction Commands

```powershell
$runner = Resolve-Path native-asr/build/windows-x64-protocol/bin/hikaru-asr-ctranslate2-tests.exe
$worker = Resolve-Path native-asr/build/windows-x64-protocol/bin/hikaru-asr-worker.exe
$model = Resolve-Path .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/models/large-v3
$lock = Resolve-Path .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/candidate-b-final-lock.md
$originalPath = $env:PATH
$env:PATH = "$(Split-Path -Parent $runner.Path);$env:SystemRoot\System32"
try {
  & $runner --candidate-b-identity-check > .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/identity/final.json
  if ($LASTEXITCODE -ne 0) { throw "Candidate B identity check failed" }
  & $runner --run-candidate-b-evidence --model $model --audio .asr-benchmark/short.wav --output .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/raw/large-v3-short.json --candidate-b-lock $lock --production-worker $worker --model-id Systran/faster-whisper-large-v3 --model-revision edaa852ec7e145841d8ffdb056a99866b5f0a478 --model-bin-sha256 69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1 --case-id short-v1 --repeats 4
  if ($LASTEXITCODE -ne 0) { throw "Candidate B short replacement run failed" }
  & $runner --run-candidate-b-evidence --model $model --audio .asr-benchmark/medium.wav --output .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/raw/large-v3-medium.json --candidate-b-lock $lock --production-worker $worker --model-id Systran/faster-whisper-large-v3 --model-revision edaa852ec7e145841d8ffdb056a99866b5f0a478 --model-bin-sha256 69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1 --case-id medium-v1 --repeats 1
  if ($LASTEXITCODE -ne 0) { throw "Candidate B medium replacement run failed" }
} finally {
  $env:PATH = $originalPath
}

python .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/candidate_b_adapter.py --raw .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/raw/large-v3-short.json --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark --case short-v1 --candidate-b-lock $lock --output .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/results/large-v3-short.json
python .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/candidate_b_adapter.py --raw .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/raw/large-v3-medium.json --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark --case medium-v1 --candidate-b-lock $lock --output .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/results/large-v3-medium.json
python .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/candidate_b_evidence_mutation_test.py --short-raw .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/raw/large-v3-short.json --short-result .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/results/large-v3-short.json --medium-raw .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/raw/large-v3-medium.json --medium-result .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/results/large-v3-medium.json --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark --candidate-b-lock $lock

$publish = @(
'.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/publish_candidate_b.py', '--short-raw', '.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/raw/large-v3-short.json', '--short-result', '.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/results/large-v3-short.json', '--medium-raw', '.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/raw/large-v3-medium.json', '--medium-result', '.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/results/large-v3-medium.json', '--manifest', '.asr-benchmark/manifest.json', '--corpus-root', '.asr-benchmark', '--candidate-b-lock', $lock, '--evidence-output', '.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/evidence/candidate-b-short-medium.json', '--report-output', '.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/candidate-b-short-medium-report.md', '--disposition-output', '.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/candidate-b-product-model-disposition.md')
python @publish
```

Run the publisher twice and require byte-identical tracked outputs. Stop immediately after a failing short or medium gate. Even if both pass, do not run long-v1 before independent review.
