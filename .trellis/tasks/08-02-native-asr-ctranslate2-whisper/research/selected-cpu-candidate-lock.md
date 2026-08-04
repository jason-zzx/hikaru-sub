# T06 Selected CPU Candidate Lock

## Lock Status

**Frozen before the selected candidate's authoritative short/medium reruns.** This is a new evidence identity. It does not rewrite, re-identify, or merge the historical Candidate A `algorithm-lock.md`, Candidate A short/medium rows, controlled long timeout, CPU RTF diagnostic, or bounded decode-selection diagnostic.

Independent review then found that the reusable diagnostic CLI inherited the new production defaults and that selected-evidence validation did not fully bind task-local containment and manifest/raw/runtime identities. The diagnostic cells and evidence tools were hardened, the decode-selection raw was republished without rerunning inference, and this revised lock was frozen before replacing the selected short/medium rows. The production worker and inference implementation are unchanged.

The selected CPU candidate remains development/qualification input only. Release/default routing stays on Python legacy. No long-v1, seven-model matrix, GPU, VAD, downloader, readiness, settings, or frontend work is authorized by this lock.

## Selection Basis

The same-binary authoritative short-v1 diagnostic changed only beam size under timestamp-driven seek and `conditionOnPreviousText=false`:

| Beam | CER | CPU inference RTF | Timeline errors | Gaps >=1.5s | Decision |
|---:|---:|---:|---:|---:|---|
| 1 | `0.2667` | `0.632` | 0 | 0 | selected: only quality pass and lowest cost |
| 5 | `0.3583` | `0.811` | 0 | 0 | rejected: CER |

Bound selection identities:

| Input | SHA-256 |
|---|---|
| ignored raw beam 1/5 diagnostic | `a1b02c4f5494e7723d2fed6a754116ffccd61f962d537e3d75782113a17e07d5` |
| sanitized decode-selection JSON | `0eacc197ab541327547323268ac826df6a0300553644600d3191b78cfd70a552` |
| sanitized decode-selection report | `4d8c8356b3d5e6106c0e58c97d81c4c62ff9abc2f53f87efd259c70b99badea0` |
| diagnostic measurement executable | `6339a201579fea04d128b82f5de2314444e54419cc6d7d16fe6b21612233d45f` |

No beam 3/10 probes were run because beam 1 passed and was cheaper than the beam 5 control. No second variable was activated.

## Authority And Corpus

| Input | Identity |
|---|---|
| T01 corpus manifest | `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277` |
| short-v1 WAV | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` |
| medium-v1 WAV | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` |
| short-v1 ASS | `60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b` |
| medium-v1 ASS | `d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e` |
| OpenAI Whisper authority | commit `25639fc17ddc013d56c594bfbf7644f2185fad84`; `transcribe.py` SHA-256 `0957d3308567c27fe9f3c85779fcfcd14b16abb79e18d353cbe189b29a027089` |
| faster-whisper maintained reference | v1.2.1 commit `65882eee9f5cdbeeb2d877f1131d48cf241b327d`; `transcribe.py` SHA-256 `5d5ffb00018561d3d529b2c72e1d9f5fff055bea725f3cccc7c6c67f5cc8ffe4` |

The T01 comparator remains the sole CER/timeline/gap implementation. The local ASS and private candidate output are read only below ignored roots and are not copied into tracked evidence.

## Canonical Selected Config

```json
{"algorithm":"selected-cpu-timestamp-no-history-beam1","beamSize":1,"computeType":"int8","conditionOnPreviousText":false,"device":"cpu","language":"ja","lengthPenalty":1.0,"logProbThreshold":-1.0,"maxInitialTimestampIndex":50,"maxLength":448,"modelWindowDurationMs":30000,"noRepeatNgramSize":0,"noSpeechThreshold":0.6,"patience":1.0,"promptResetOnTemperature":0.5,"repetitionPenalty":1.0,"temperature":0.0,"timestampDrivenSeek":true,"timestampResolutionMs":20,"vad":false}
```

Canonical config SHA-256: `77120c8543e780231d8c65b3868c07f44d685a22a136da56c64e6a6922d4f9e6`.

Behavior lock:

- 16 kHz mono PCM16 WAV; official 400-point Hann STFT, 160-sample hop, official 80/128 mel filters, 30-second padded model tensor;
- CPU `int8`, beam size 1, temperature 0, patience/length/repetition penalty 1.0, no-repeat n-gram disabled;
- no previous-text prompt/history; prompt remains `<|startoftranscript|><|ja|><|transcribe|>` for every window;
- decoded timestamps advance seek; source/model window distinction, consecutive timestamps, no-speech, invalid-generation, WAV-end provenance, narrow exact dedupe, monotonic source progress, and cancellation boundaries remain unchanged;
- no VAD, temperature fallback, transcript prompt, arbitrary suppress-token change, Python/private-fork behavior, corpus-specific repair, synthetic timing, or reference-derived output.

## Model And Dependency Identity

large-v3 repository `Systran/faster-whisper-large-v3`, revision `edaa852ec7e145841d8ffdb056a99866b5f0a478`, MIT:

| File | Bytes | SHA-256 |
|---|---:|---|
| `config.json` | 2,394 | `a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9` |
| `model.bin` | 3,087,284,237 | `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1` |
| `preprocessor_config.json` | 340 | `7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711` |
| `tokenizer.json` | 2,480,617 | `6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca` |
| `vocabulary.json` | 1,068,114 | `c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1` |

Pinned runtime inputs remain unchanged from `algorithm-lock.md`: CTranslate2 `4.8.0` commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698`, oneDNN `3.1.1`, pocketfft commit `c90e55b3d529f8efa40ed01a20de22405f45fc65`, and tokenizer dependency graph `Cargo.lock` SHA-256 `6fbcf8227058918337c2b827243d08e13f7aafa72aa7531d25bd6462b4ce79b7`.

## Final Rebuilt Runtime Identity

Built by MSVC `19.50.35722.0`, CMake `4.1.1-msvc1`, Ninja, Windows x64 Release after changing production defaults to the selected config:

| File | Bytes | SHA-256 |
|---|---:|---|
| `hikaru-asr-worker.exe` | 459,776 | `cb77a661a9cca23895cd8c9a56fe18e1a99bdeb324f30390f7f38b77aa0764ad` |
| `hikaru-asr-ctranslate2-tests.exe` | 562,688 | `9acbf01a68bb95bac54bd2aab67a83c48ab240900d1317f55acb5861028e8254` |
| `ctranslate2.dll` | 22,417,408 | `e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59` |
| `hikaru_asr_tokenizer.dll` | 2,137,088 | `892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d` |

Tracked implementation/evidence-tool identities at lock time:

| File | Bytes | SHA-256 |
|---|---:|---|
| `native-asr/CMakeLists.txt` | 11,840 | `77241ba2cfadb2ddd0d299f641540d3b919da5a427505fded8ab2edd8ff0b88d` |
| `native-asr/CMakePresets.json` | 951 | `95bd92578399dd950253287e8b81458da39613772dc33b796e353213481e023b` |
| `native-asr/src/ctranslate2_whisper.cpp` | 32,440 | `d39aeed242236cc609fb5132fb9a74847fa976c434dcedd3a6421637f8b642b6` |
| `native-asr/src/ctranslate2_whisper.hpp` | 4,736 | `5c24f2e6f8e36b79a279325e858e315458b86d4d34284d96e0511b08a51fab3e` |
| `native-asr/src/main.cpp` | 5,777 | `44eb531c4945b9bdec5a9718624de86fded77e94d9c8b2871e3129f3042e06bf` |
| `native-asr/tests/ctranslate2_whisper_tests.cpp` | 43,330 | `3047da530b9f10f68854c0ae2d3ecb91eec2f9240bb152ad2e0c9439001693c4` |
| `native-asr/tokenizer-ffi/Cargo.toml` | 275 | `e955b913a02811083e1da9881b81524c415f362bdaa8627afa68efdafc999f31` |
| `native-asr/tokenizer-ffi/Cargo.lock` | 18,696 | `6fbcf8227058918337c2b827243d08e13f7aafa72aa7531d25bd6462b4ce79b7` |
| `native-asr/tokenizer-ffi/src/lib.rs` | 4,458 | `3bba3b26765cb8277c302db5e72353fc673d1133fd0d78a59c46792803aaebcc` |
| `research/publish_decode_selection.py` | 19,284 | `221ad160eab1a32ac4ff8284cfcba89b901db6a7c507a702e21649eb673bd8e6` |
| `research/selected_cpu_adapter.py` | 23,330 | `4c650fc4f6e07ab5c2fa0315c722966499001622868a861d223be368246835da` |
| `research/publish_selected_cpu_candidate.py` | 19,808 | `0b041931680b1de1aaf8a540ef5f4c07f6e3b9fc401f7d692e36d6854cffc300` |

## Reproduction Commands

```powershell
Push-Location native-asr
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release
Pop-Location

$runner = Resolve-Path native-asr/build/windows-x64-protocol/bin/hikaru-asr-ctranslate2-tests.exe
$worker = Resolve-Path native-asr/build/windows-x64-protocol/bin/hikaru-asr-worker.exe
$model = Resolve-Path .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/models/large-v3
$lock = Resolve-Path .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/selected-cpu-candidate-lock.md

& $runner --run-selected-evidence --model $model --audio .asr-benchmark/short.wav --output .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/selected-cpu-large-v3-short.json --candidate-lock $lock --production-worker $worker --model-id Systran/faster-whisper-large-v3 --model-revision edaa852ec7e145841d8ffdb056a99866b5f0a478 --model-bin-sha256 69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1 --case-id short-v1 --repeats 4
& $runner --run-selected-evidence --model $model --audio .asr-benchmark/medium.wav --output .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/selected-cpu-large-v3-medium.json --candidate-lock $lock --production-worker $worker --model-id Systran/faster-whisper-large-v3 --model-revision edaa852ec7e145841d8ffdb056a99866b5f0a478 --model-bin-sha256 69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1 --case-id medium-v1 --repeats 1

python .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/selected_cpu_adapter.py --raw .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/selected-cpu-large-v3-short.json --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark --case short-v1 --candidate-lock $lock --output .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/results/selected-cpu-large-v3-short.json
python .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/selected_cpu_adapter.py --raw .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/selected-cpu-large-v3-medium.json --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark --case medium-v1 --candidate-lock $lock --output .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/results/selected-cpu-large-v3-medium.json

$publish = @(".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/publish_selected_cpu_candidate.py", "--short-raw", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/selected-cpu-large-v3-short.json", "--short-result", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/results/selected-cpu-large-v3-short.json", "--medium-raw", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/selected-cpu-large-v3-medium.json", "--medium-result", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/results/selected-cpu-large-v3-medium.json", "--manifest", ".asr-benchmark/manifest.json", "--corpus-root", ".asr-benchmark", "--candidate-lock", $lock, "--evidence-output", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/evidence/selected-cpu-short-medium.json", "--report-output", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/selected-cpu-candidate-report.md", "--disposition-output", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/product-model-disposition.md")
python @publish
```

Run the publisher twice and require byte-identical outputs. Do not run long-v1 unless an independent review accepts the short/medium result and next gate.
