# T06R GPU upstream-fallback diagnostic lock v3

## Gate C3 repair status and authorization

**Frozen after independent Gate C3 review and before any fallback-candidate model load.**

Gate C3 found that v2 directly listed the complete expected module inventory, but the publisher still accepted a fallback row with missing or additional frozen modules. This distinct repaired identity closes that evidence gap with fallback-only exact name/size/SHA-256/root-role/raw-version validation and one focused mutation test. The runner, production source, candidate algorithm, config, runtime binaries, model, corpus, VAD, zlib, GPU, PATH, privacy and promotion-rejection identities are unchanged.

Both predecessor locks remain byte-for-byte frozen. This lock does not authorize acquisition. Both closed cells remain blocked until the user grants fresh explicit model-backed acquisition approval for both rows under this exact v3 identity.

| Superseded / review input | Bytes | SHA-256 | Meaning |
|---|---:|---|---|
| `gpu-fallback-diagnostic-lock.md` | 12,371 | `5fcfe845451f418a1e21fe8711ba9f367fdc2e13f8c2e02dd598683dde4e073a` | invalid-preflight identity; preserved byte-for-byte |
| `whisper-gpu-fallback-acquisition-preflight.json` | 6,739 | `29b8767342bb9f1ac57c630285c1481b58877c57b92c775e38f9dfb9d4b6a212` | authoritative invalid-evidence envelope |
| `whisper-gpu-fallback-acquisition-preflight.md` | 2,327 | `27054915dc39d7e2e58535e0a62dfb6fbaf55aac47caf5bd0f66017f539b2f6f` | sanitized invalid-preflight report |
| `gpu-fallback-diagnostic-lock-v2.md` | 16,141 | `823630f08ab15ed7dadf4f80f0e5a320c89e3e2171cd55b8ac86cc6463235b82` | Gate C3-blocked identity; preserved byte-for-byte |
| `whisper-gpu-fallback-corrected-lock-preflight.json` | 3,618 | `5fa4f06f4caea4cb38e7bbbc36b5024b2ab5400efefdb513cd579ab2df282ac4` | v2 preparation evidence; superseded by Gate C3 review |
| `whisper-gpu-fallback-corrected-lock-preflight.md` | 3,119 | `0509d242a5fb9b12988d8fb1510b4ebb53e207f1066b6bf7dd0b2b039d7dd1bb` | v2 preparation report; superseded by Gate C3 review |
| v2 publisher identity | 66,063 | `0b4164af9997c137450fdb02c0698d3424f54c1b4a4f1450b6fb6da104385c2c` | accepted expected inventory but did not require exact inventory |
| v2 publisher-test identity | 35,181 | `27213240d6495907e22382a215f679cba70351d018bb81e5c3d318c44849fead` | 14-test pre-review identity |
| superseded v1 publisher-test identity | 31,211 | `5a610a71c80c60c7967245d85721484815c6d6f8a583eea13228da373472f537` | retained only as part of the original lock identity |

The invalid preflight has `modelLoaded=false` and `acquisitionRows=[]`. No model was loaded, neither cell ran, no raw fallback row exists, and no CER/S/D/I/gap/RTF/RSS/fallback-trigger/selected-temperature metric or diagnostic publication exists. This repair freezes inputs only; it does not reinterpret either predecessor as model evidence.

Only these diagnostic-only cells are closed into this identity:

| Cell | Case | Beam | History | VAD | Generation |
|---|---|---:|---|---|---|
| `short-b5-on-vad-fallback` | short-v1 | 5 | on; no prior-window tokens exist | exact faster-whisper 1.2.1 Silero V6 | exact faster-whisper 1.2.1 fallback |
| `medium-b5-on-vad-fallback` | medium-v1 | 5 | on | exact faster-whisper 1.2.1 Silero V6 | exact faster-whisper 1.2.1 fallback |

Both rows must set `qualificationEligible=false`, use the distinct fallback-diagnostic raw/publication kinds, and can never be promoted to formal evidence. No large-v3 or other ASR model was loaded while preparing this lock.

## Candidate identity

Candidate: `upstream-generation-fallback-parity-v1`.

Canonical config JSON SHA-256: `a6f3a37c5dae1c1f627827fb8248be6a2cd9ccf56dc274e8f2ee2b92a0106237`.

The base is beam 5, previous-text conditioning on, timestamp-driven seek, exact V6 VAD, CUDA device 0/FLOAT16, and all second-diagnostic thresholds/parser behavior. The sole causal change is:

- attempts `0.0, 0.2, 0.4, 0.6, 0.8, 1.0`;
- temperature 0: beam 5, patience 1, one hypothesis, and untouched CTranslate2 defaults `sampling_topk=1` / `sampling_temperature=1` because upstream omits both sampling options; the sanitized attempt schema reports those omissions as `samplingTopK=null` / `samplingTemperature=null`;
- positive temperatures: beam 1, best-of/num-hypotheses 5, top-k 0, and `sampling_temperature` equal to the attempt temperature;
- UTF-8 text stripped with Python Unicode whitespace semantics and compressed by exact zlib 1.3.1 default compression;
- retry on compression ratio `>2.4` or average log probability `<-1.0`;
- no-speech `>0.6` plus low log probability overrides retry as silence;
- first non-retry result wins;
- after six failed attempts, select highest average log probability from results below the compression threshold, or from all results when none is below it; ties select the first result; reported temperature remains final ladder temperature `1.0`;
- the selected/reported temperature alone controls prompt reset `>0.5`.

History eligibility, parser, suppression, prompt seed, word timestamps, overlap, arbitrary tuning and output repair are unchanged.

## Upstream oracle authority

| Input | Identity |
|---|---|
| faster-whisper version | `1.2.1` |
| faster-whisper commit | `65882eee9f5cdbeeb2d877f1131d48cf241b327d` |
| installed `transcribe.py` bytes / SHA-256 | 80,403 / `5d5ffb00018561d3d529b2c72e1d9f5fff055bea725f3cccc7c6c67f5cc8ffe4` |
| Python zlib compile/runtime version | `1.3.1` / `1.3.1` |
| source-only parity audit | `353d93e2a2951a1168b42aa55e178ef13be9a4d875f6fc7da623890e3de63abd` |
| native/Python oracle test | `318b919dfa695fc80109fbb10c0574716aa2b9983b5404d1c77b33fb3146a894` |

The 16-vector fake oracle covers no retry, complete Python Unicode strip behavior, compression retry, log-probability retry, a CT2-float/double log-probability boundary, silence override including compression, CT2-float and below-threshold no-speech boundaries, the strict log-probability boundary, first passing result, selected-temperature prompt reset, deterministic first-maximum all-failed selection, below-compression-threshold preference, and all-six compression failures. It also proves that temperature 0 omits `sampling_topk`/`sampling_temperature`, while positive temperatures set exact sampling options. It constructs no model and writes all vectors below the ignored task-local root.

## Exact zlib build input

Official source archive: `https://zlib.net/fossils/zlib-1.3.1.tar.gz`.

| Input | Bytes | SHA-256 |
|---|---:|---|
| zlib-1.3.1.tar.gz | 1,512,791 | `9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23` |
| LICENSE | 1,002 | `845efc77857d485d91fb3e0b884aaa929368c717ae8186b66fe1ed2495753243` |
| zlib.h | 96,829 | `8a5579af72ea4f427ff00a4150f0ccb3fc5c1e4379f726e101133b1ab9fc600c` |
| zconf.h | 16,500 | `f5134250a67d57459234b63858f0d9d3ef8dcc48e9e1028d3f4fdcf6eae677ae` |
| adler32.c | 4,964 | `9cd1443a24ff2a3053961695bd432035c58347386a420d3388232376ebabe211` |
| compress.c | 2,613 | `86f802c16a965e7a28737e3730b4e576c5ba40981753967e3e30916f4dc1b4b1` |
| crc32.c | 31,605 | `8fd16f0a7714d51c89c2eb37eb98ec15e8a4dc57ba343e7b7398b19144039fda` |
| deflate.c | 81,731 | `3b956337350f94c34987750f785587ef33d9c89ceaebb7c2afb189c956360cbe` |
| trees.c | 40,937 | `f63c68c16c05fcd196050529d1a0e7657960e4136b9987d90a6ac3e58a964b0f` |
| zutil.c | 7,179 | `8ced40d8c88588811edd2bdb35b7439983d5e1f8e9e32b8a3b244731f3c317b7` |
| zutil.h | 6,677 | `dddb2dc7a1dc339ecf2c8e089b366f08bb731c0839c7110240d17ce731bb4fea` |
| deflate.h | 14,041 | `48baf016326d8d5e3e32ac8153cc7e22f854b8e6834830b167b998a7fb1e7989` |
| trees.h | 8,472 | `bb0a9d3ca88ee00c81adb7c636e73b97085f6ef1b52d6d58edbe2b6dc3adeb4d` |
| crc32.h | 591,749 | `9a2223575183ac2ee8a247f20bf3ac066e8bd0140369556bdbdffc777435749e` |

Only the minimal compression-side sources are built into a task-local static library. Ordinary protocol and CPU CT2 presets keep the fallback option off and do not require or link zlib.

## Corpus and comparison authority

| Input | SHA-256 |
|---|---|
| `.asr-benchmark/manifest.json` | `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` |
| `scripts/asr-benchmark.py` | `2e0dbee811f28e18dd1d5d29bb9ed50ab5ed028004adf1820665a128a813c45c` |
| Python legacy baseline | `c6142c40daf9c45c1d39d3612833c386fc71080866148d9b9719e428787979ef` |
| model identity manifest | `7b46e0a983b7cc71e302e898d3f90d77b3c9159be2fe538585cd038e31c0a8f0` |
| second diagnostic lock | `ee8a7e6bfd062f84359eaa3d86eb54ed843bb4d036613043ed2bc2f8f282b8c3` |
| second diagnostic publication | `890453f440418d4c418e7916fcbe52b8ea9db2c85f48ef79b7d1b30bc372ecbc` |

| Case | Duration ms | WAV SHA-256 | ASS SHA-256 |
|---|---:|---|---|
| short-v1 | 24,102 | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` | `60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b` |
| medium-v1 | 498,872 | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` | `d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e` |

The local ASS remains the only reference truth. Python output cannot generate or repair candidate text or timing.

## Model and VAD identity

Only `Systran/faster-whisper-large-v3@edaa852ec7e145841d8ffdb056a99866b5f0a478` is allowed:

| File | Bytes | SHA-256 |
|---|---:|---|
| config.json | 2,394 | `a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9` |
| model.bin | 3,087,284,237 | `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1` |
| preprocessor_config.json | 340 | `7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711` |
| tokenizer.json | 2,480,617 | `6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca` |
| vocabulary.json | 1,068,114 | `c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1` |
| silero_vad_v6.onnx | 1,245,151 | `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2` |

## Source, build and tool identity

Build: Windows x64 Release, MSVC `19.50.35722.0`, CMake `4.1.1-msvc1`, Ninja, CTranslate2 `4.8.0` commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698`, CUDA toolkit `12.8.93`, architecture `8.6`, dynamic CUDA loading, no cuDNN, ONNX Runtime `1.28.0` CPU VAD.

| Tracked source/tool | SHA-256 |
|---|---|
| native-asr/CMakeLists.txt | `6e12c13af84e7a34f8b65094dc52d00933243e4495a533abd248834e0696f1db` |
| native-asr/CMakePresets.json | `0a8fb41103b89dd1ca985d47061b7b2f224e0537234034fb215aa38bb0d838b6` |
| native-asr/src/ctranslate2_whisper.hpp | `ba163402b1ac6efa43be58d10382e507012c662a6d3221e77f30f38bb3773dec` |
| native-asr/src/ctranslate2_whisper.cpp | `1bb123dc28e1499ec89ec9ccc92e7306e14051585c88a2ed0d0378caf78bc617` |
| native-asr/src/main.cpp | `c0440ec5ae31dc6be836b2d40b8941a5f17dab6206bfea8100b734e674832e42` |
| native-asr/tests/ctranslate2_whisper_tests.cpp | `d8c171c345d0196cc01d4bd4b36140bf58f63ed94656f1ee346e1554a4bfe679` |
| native-asr/tokenizer-ffi/Cargo.lock | `6fbcf8227058918337c2b827243d08e13f7aafa72aa7531d25bd6462b4ce79b7` |
| native-asr/tokenizer-ffi/src/lib.rs | `3bba3b26765cb8277c302db5e72353fc673d1133fd0d78a59c46792803aaebcc` |
| research/publish_whisper_gpu_quality.py | `ece07ee742992e4315fed0635c7c56feaa1fb6e5142e912173739f647901f30c` |
| research/test_publish_whisper_gpu_quality.py | `ef9e72fcdb45b8fc2f015c65906762142ece4802465bfa56820aa3708f721d8c` |
| research/test_whisper_fallback_oracle.py | `318b919dfa695fc80109fbb10c0574716aa2b9983b5404d1c77b33fb3146a894` |

## Rebuilt task-local runtime identity

| Runtime file | Bytes | SHA-256 |
|---|---:|---|
| hikaru-asr-worker.exe | 548,352 | `b73301c475b65b729732479a6a3750f50a5082249e5f6605ae1ecac18e1635c1` |
| hikaru-asr-ctranslate2-tests.exe | 978,944 | `1f72c282f342abc84d69f2e663d021d06b6957a44cdef83d25c44f53e5ec0e39` |
| ctranslate2.dll | 36,974,592 | `e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2` |
| hikaru_asr_tokenizer.dll | 2,137,088 | `d0ac979b132073ba76220f47e5b77538bf03ec1dcaea01fb5d9d928762939cad` |
| onnxruntime.dll | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` |
| onnxruntime_providers_shared.dll | 21,856 | `599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8` |
| silero_vad_v6.onnx | 1,245,151 | `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2` |

Restricted PATH roles remain task-local runtime bin, CUDA 12.8 bin and Windows System32. Root identity SHA-256 is `8866553cc6616ec76f152177b69c5161e0aa5dec0c13519eb65b654afa3c66f6`.

### Exact loaded-module inventory

This identity directly freezes every module expected from the reviewed fallback runner/VAD/CUDA process. The publisher validates this table as an exact fallback-only set; every name, size, SHA-256, root role and raw version string must match. The four system/CUDA identities are the exact current values recorded by `whisper-gpu-fallback-acquisition-preflight.json`; their root roles were independently re-attested from the restricted PATH roots. The task-local entries bind the unchanged rebuilt runtime already frozen above.

| Module | Bytes | SHA-256 | Root role | Raw version |
|---|---:|---|---|---|
| `hikaru-asr-ctranslate2-tests.exe` | 978,944 | `1f72c282f342abc84d69f2e663d021d06b6957a44cdef83d25c44f53e5ec0e39` | `task-local-runtime-bin` | `""` |
| `ctranslate2.dll` | 36,974,592 | `e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2` | `task-local-runtime-bin` | `""` |
| `hikaru_asr_tokenizer.dll` | 2,137,088 | `d0ac979b132073ba76220f47e5b77538bf03ec1dcaea01fb5d9d928762939cad` | `task-local-runtime-bin` | `""` |
| `onnxruntime.dll` | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` | `task-local-runtime-bin` | `1.28.0.724` |
| `vcomp140.dll` | 213,064 | `31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7` | `windows-system32` | `14.50.35719.0` |
| `nvcuda.dll` | 4,466,920 | `ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c` | `windows-system32` | `32.0.15.9649` |
| `cublas64_12.dll` | 113,716,224 | `9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99` | `cuda-toolkit-12.8-bin` | `6.14.11.1284` |
| `cublasLt64_12.dll` | 674,667,520 | `b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7` | `cuda-toolkit-12.8-bin` | `6.14.11.1284` |

Any missing, additional, renamed, size-drifted, hash-drifted, version-drifted or root-role-drifted loaded module invalidates the row. `onnxruntime_providers_shared.dll` remains a required task-local runtime file but is not part of the exact loaded-module set; if it loads, the publisher rejects the row and a new reviewed lock is required.

GPU identity remains NVIDIA GeForce RTX 3070, device 0, compute capability 8.6, driver 596.49, driver API 13020. These development-machine values must be re-attested by any later authorized acquisition; this lock does not claim that model execution occurred.

## Selection and stop rule

Both rows must independently pass matching large-v3 Python CER/S/D/I/empty/gap fields and all GPU/structural gates. If both pass, the diagnostic publisher may select exactly `upstream-generation-fallback-parity-v1`; otherwise it publishes `no-candidate-selected` and returns to planning. Either outcome remains diagnostic-only.

Gate C3 verified oracle parity, closed config/CLI, zlib/source/runtime identities, exact loaded-module validation, sanitized per-attempt trace validation, promotion rejection and byte determinism. This clean review permits asking for fresh acquisition approval only; it does not authorize inference.

## Privacy and command boundary

Raw text, per-attempt and selected token IDs, per-window traces, media, models, binaries, module paths and zlib sources stay below the ignored task-local `research/local/` root. Each ignored raw attempt binds its options, score-derived average log probability, no-speech probability, decoded text, token IDs, compression ratio and trigger flags into a recomputable aggregate SHA-256. Tracked publication may contain only hashes, quality aggregates, attempt/fallback counts, selected-temperature counts, trigger counts and aggregate attempt hashes.

Approved pre-model checks:

```powershell
python research/test_publish_whisper_gpu_quality.py
<asr-service-venv-python> research/test_whisper_fallback_oracle.py --runner <task-local-runner> --local-root research/local/oracle
cmake --preset windows-x64-release && cmake --build --preset windows-x64-release && ctest --preset windows-x64-release
cmake --preset windows-x64-ct2-release && cmake --build --preset windows-x64-ct2-release && ctest --preset windows-x64-ct2-release
cmake --preset windows-x64-ct2-cuda-whisper-quality && cmake --build --preset windows-x64-ct2-cuda-whisper-quality && ctest --preset windows-x64-ct2-cuda-whisper-quality
```

The future CLI is fixed to `--run-whisper-quality-fallback-diagnostic` plus exactly the existing cell/model/audio/output/input-lock/worker/model-identity/repeat/VAD arguments. Running either cell is currently unauthorized and requires fresh explicit model-backed acquisition approval for both closed cells under this exact v3 lock. No raw fallback diagnostic or result publication exists under this lock.
