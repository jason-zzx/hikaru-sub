# T06 Candidate A Algorithm And Runtime Lock

## Lock Status

**Locked before the first T06 model-backed load.** This document binds the first large-v3 Candidate A decision run. Any source, binary, DLL, model-file, corpus, or canonical config identity change invalidates all measurements below that change and requires a clean rerun.

Candidate B is not selected. The only permitted conditional Candidate B remains the Silero V6 source/asset in `start-gate-lock.md`; no ONNX executor has been chosen or implemented.

## Authority And Corpus

| Input | Identity |
|---|---|
| T01 corpus manifest | `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277` |
| short-v1 WAV | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` |
| medium-v1 WAV | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` |
| long-v1 WAV | `af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e` |
| OpenAI Whisper authority | commit `25639fc17ddc013d56c594bfbf7644f2185fad84`; `transcribe.py` SHA-256 `0957d3308567c27fe9f3c85779fcfcd14b16abb79e18d353cbe189b29a027089` |
| faster-whisper maintained reference | v1.2.1 commit `65882eee9f5cdbeeb2d877f1131d48cf241b327d`; installed `transcribe.py` size `80,403`, SHA-256 `5d5ffb00018561d3d529b2c72e1d9f5fff055bea725f3cccc7c6c67f5cc8ffe4` |

The local ASS files are parsed only by `scripts/asr-benchmark.py`; no reference text, Python transcript, or reference-derived timing enters the worker.

## Candidate A Config

Canonical JSON (sorted compact form):

```json
{"algorithm":"candidate-a-timestamp-driven","beamSize":5,"computeType":"int8","conditionOnPreviousText":true,"device":"cpu","language":"ja","lengthPenalty":1.0,"logProbThreshold":-1.0,"maxInitialTimestampIndex":50,"maxLength":448,"modelWindowDurationMs":30000,"noRepeatNgramSize":0,"noSpeechThreshold":0.6,"patience":1.0,"promptResetOnTemperature":0.5,"repetitionPenalty":1.0,"temperature":0.0,"timestampResolutionMs":20,"vad":false}
```

Canonical config SHA-256: `a96e3737708ed85da63408d6af0e018032511f0ef10a6b5b283388871cc55cb0`.

Behavior lock:

- 16 kHz mono PCM16 WAV with rounded verified duration;
- official 400-point Hann STFT, 160-sample hop, Slaney 80/128 mel filters, 160-sample right padding, 30-second padded model tensor;
- CPU `int8`, beam size 5, patience/length/repetition penalties `1.0`, no-repeat n-gram disabled, temperature 0, CTranslate2 default symbol/blank suppression;
- previous completed timestamp-token slices are carried through `<|startofprev|>` with the official 223-token history bound;
- no-speech skip requires `noSpeechProbability > 0.6` and `averageLogProbability <= -1.0`;
- consecutive timestamp evidence advances seek to the last completed decoded timestamp; a single timestamp ending, no-speech window, or complete paired final window advances to the source-window end;
- incomplete/invalid timestamp generations fail closed; starts at/after WAV end fail; only a token-derived end inside the 30-second model range may be bounded to verified WAV end;
- exact duplicate `(startMs,endMs,text)` output is removed; no fuzzy/text/reference repair and no synthetic split is allowed;
- source progress is monotonic and never uses padded model duration as processed source duration.

A multi-temperature compression-ratio fallback is deliberately not part of this minimal first candidate. Adding it after observing the frozen corpus would be a new reviewed candidate/config identity, not an in-place adjustment.

## Local Dependency Identity

Task-local aliases below are junctions into already pinned T02 inputs or the immutable application model cache; raw/build/result output remains under the ignored T06 `research/local/` root.

| Input | Identity |
|---|---|
| CTranslate2 | `4.8.0`, commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698`, `whisper.h` size `6,025`, SHA-256 `ee3ae7a77c107fa8a6756dfa32340f3d4e1cc1d6e247786580d40dd810058312` |
| oneDNN public header | `3.1.1`, size `826`, SHA-256 `23e40186069086c288f70b397485a20b59a8fedce33194ea70e107d91fddaae4` |
| oneDNN static library | `3.1.1`, size `385,595,736`, SHA-256 `9104b04662d354793e593bb1b162740e7047c9ce3aa8c2b532049504d678c005` |
| pocketfft | commit `c90e55b3d529f8efa40ed01a20de22405f45fc65`, header size `120,735`, SHA-256 `3e9a05318d8e3b1446bda1c4617e6a103cdd23599ae0a776a92a6e8800e92fdc` |
| tokenizer dependency graph | Hugging Face tokenizers `0.22.1`; `native-asr/tokenizer-ffi/Cargo.lock` size `18,696`, SHA-256 `6fbcf8227058918337c2b827243d08e13f7aafa72aa7531d25bd6462b4ce79b7` |
| Candidate B behavior reference (inactive) | `vad.py` size `12,543`, SHA-256 `37a9c774aefdd3162d936b896c8dcf5571b2ed938d65bffecfd631770049a18d` |
| Candidate B asset (inactive) | `silero_vad_v6.onnx` size `1,245,151`, SHA-256 `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2` |

## First-Gate Model Lock

`large-v3` repository `Systran/faster-whisper-large-v3`, revision `edaa852ec7e145841d8ffdb056a99866b5f0a478`, MIT:

| File | Bytes | SHA-256 |
|---|---:|---|
| `config.json` | 2,394 | `a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9` |
| `model.bin` | 3,087,284,237 | `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1` |
| `preprocessor_config.json` | 340 | `7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711` |
| `tokenizer.json` | 2,480,617 | `6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca` |
| `vocabulary.json` | 1,068,114 | `c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1` |

The remaining product-model pins are unchanged from `start-gate-lock.md`: tiny `d90ca5f...`/`dcb76c...`, base `ebe41f7...`/`d01c30...`, small `536b066...`/`3e3059...`, medium `08e178d...`/`9b45e1...`, large-v2 `f0fe815...`/`bf2a97...`, and large-v3-turbo `0a363e9...`/`e76620...`. Each must receive the same complete local-file verification before its first measured run. Tiny remains unavailable locally and is not downloaded by the worker.

## Built Runtime Identity

Built by MSVC `19.50.35722.0`, CMake `4.1.1-msvc1`, Ninja, Windows x64 Release:

| File | Bytes | SHA-256 |
|---|---:|---|
| `hikaru-asr-worker.exe` | 459,776 | `bd103e4fc1c80e8bd6e465bc1e41030be873fa192315547a76debd71cd11cf69` |
| `hikaru-asr-ctranslate2-tests.exe` | 449,024 | `3bf320a41bfbed3ab0687ccccd20f02691ada834596bdfa2a3ef40212595ce8d` |
| `ctranslate2.dll` | 22,417,408 | `e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59` |
| `hikaru_asr_tokenizer.dll` | 2,137,088 | `892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d` |

Tracked build, implementation, FFI, test, and evidence-tool identities at lock time:

| File | Bytes | SHA-256 |
|---|---:|---|
| `native-asr/CMakeLists.txt` | 11,840 | `77241ba2cfadb2ddd0d299f641540d3b919da5a427505fded8ab2edd8ff0b88d` |
| `native-asr/CMakePresets.json` | 951 | `95bd92578399dd950253287e8b81458da39613772dc33b796e353213481e023b` |
| `native-asr/src/ctranslate2_whisper.cpp` | 30,975 | `985dac43713ea944a8dfc7790bdae27dcef504cb4f905b148c80fe6d3607af84` |
| `native-asr/src/ctranslate2_whisper.hpp` | 4,162 | `b047b1c0084febd9f2e5f4b0c9c39e5dce738f965ade5662f36c8519155c5a2c` |
| `native-asr/src/main.cpp` | 5,777 | `44eb531c4945b9bdec5a9718624de86fded77e94d9c8b2871e3129f3042e06bf` |
| `native-asr/tests/ctranslate2_whisper_tests.cpp` | 19,701 | `7332f612a73cf9bedd2c493b7aa69fc700dd3db89d69bda7412cbe30a04f8961` |
| `native-asr/tokenizer-ffi/Cargo.toml` | 275 | `e955b913a02811083e1da9881b81524c415f362bdaa8627afa68efdafc999f31` |
| `native-asr/tokenizer-ffi/Cargo.lock` | 18,696 | `6fbcf8227058918337c2b827243d08e13f7aafa72aa7531d25bd6462b4ce79b7` |
| `native-asr/tokenizer-ffi/src/lib.rs` | 4,458 | `3bba3b26765cb8277c302db5e72353fc673d1133fd0d78a59c46792803aaebcc` |
| `research/benchmark_adapter.py` | 14,178 | `a677a3e1e2cf50fec192dde207a0448ee35dbcd53eec179b8885cb6122562c69` |
| `research/publish_candidate_a.py` | 24,910 | `0e125e862af27b09ccf4f99f030dc1edbb1a19e389d4a0d8e84056bba90ada06` |

CMake verifies the clean CTranslate2 commit plus the locked CT2 header, pocketfft header, oneDNN header/library identities and builds the Rust tokenizer with `cargo --locked --offline`. The production entry normalizes host-canonical `\\?\` model paths before CT2 access and passes UTF-8 path bytes to CTranslate2.

The evidence runner and production worker link the same `hikaru-asr-ctranslate2` object implementation. Candidate-decision measurements identify the runner executable and production worker separately; a final release qualification claim, if Candidate A passes, must be rerun through the single frozen final worker/runtime identity required by the PRD.

## Reproduction Commands

```powershell
# Acquire/verify the pinned CT2, oneDNN, pocketfft and immutable model inputs below
# .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/.
Push-Location native-asr
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release
Pop-Location

$runner = Resolve-Path native-asr/build/windows-x64-protocol/bin/hikaru-asr-ctranslate2-tests.exe
$worker = Resolve-Path native-asr/build/windows-x64-protocol/bin/hikaru-asr-worker.exe
$model = Resolve-Path .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/models/large-v3
$lock = Resolve-Path .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/algorithm-lock.md

& $runner --run-evidence --model $model --audio .asr-benchmark/short.wav --output .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/large-v3-short.json --algorithm-lock $lock --production-worker $worker --model-id Systran/faster-whisper-large-v3 --model-revision edaa852ec7e145841d8ffdb056a99866b5f0a478 --model-bin-sha256 69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1 --case-id short-v1 --repeats 4
& $runner --run-evidence --model $model --audio .asr-benchmark/medium.wav --output .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/large-v3-medium.json --algorithm-lock $lock --production-worker $worker --model-id Systran/faster-whisper-large-v3 --model-revision edaa852ec7e145841d8ffdb056a99866b5f0a478 --model-bin-sha256 69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1 --case-id medium-v1 --repeats 1

# A long reattempt uses the same runner arguments under a strict two-hour process limit.
# The retained historical timeout record is immutable and remains under its pre-final identity.
$longArgs = @("--run-evidence", "--model", $model, "--audio", ".asr-benchmark/long.wav", "--output", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/large-v3-long.json", "--algorithm-lock", $lock, "--production-worker", $worker, "--model-id", "Systran/faster-whisper-large-v3", "--model-revision", "edaa852ec7e145841d8ffdb056a99866b5f0a478", "--model-bin-sha256", "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1", "--case-id", "long-v1", "--repeats", "1")
$long = Start-Process -FilePath $runner -ArgumentList $longArgs -PassThru -NoNewWindow
if (-not $long.WaitForExit(7_200_000)) {
  taskkill /PID $long.Id /T /F
  throw "Candidate A long-v1 exceeded the controlled 7200s limit"
}
if ($long.ExitCode -ne 0) { throw "Candidate A long-v1 failed with exit code $($long.ExitCode)" }

python .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/benchmark_adapter.py --raw .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/large-v3-short.json --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark --case short-v1 --algorithm-lock $lock --output .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/results/large-v3-short.json
python .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/benchmark_adapter.py --raw .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/large-v3-medium.json --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark --case medium-v1 --algorithm-lock $lock --output .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/results/large-v3-medium.json

$publishArgs = @(".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/publish_candidate_a.py", "--short-raw", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/large-v3-short.json", "--short-result", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/results/large-v3-short.json", "--medium-raw", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/large-v3-medium.json", "--medium-result", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/results/large-v3-medium.json", "--long-timeout", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/raw/large-v3-long-timeout.json", "--manifest", ".asr-benchmark/manifest.json", "--corpus-root", ".asr-benchmark", "--algorithm-lock", $lock, "--evidence-output", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/evidence/candidate-a-decision.json", "--report-output", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/ctranslate2-whisper-report.md", "--disposition-output", ".trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/product-model-disposition.md")
python @publishArgs
$first = Get-FileHash -Algorithm SHA256 .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/evidence/candidate-a-decision.json,.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/ctranslate2-whisper-report.md,.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/product-model-disposition.md
python @publishArgs
$second = Get-FileHash -Algorithm SHA256 .trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/evidence/candidate-a-decision.json,.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/ctranslate2-whisper-report.md,.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/product-model-disposition.md
if (Compare-Object $first.Hash $second.Hash) { throw "Candidate A publisher output is not byte-identical" }

$env:HIKARU_ASR_FAKE_WORKER = (Resolve-Path native-asr/build/windows-x64-protocol/bin/hikaru-asr-fake-worker.exe).Path
$env:HIKARU_ASR_PRODUCTION_WORKER = $worker.Path
$env:HIKARU_ASR_CT2_MODEL_PATH = $model.Path
$env:HIKARU_ASR_CT2_AUDIO_PATH = (Resolve-Path .asr-benchmark/short.wav).Path
cargo test --manifest-path src-tauri/Cargo.toml asr_worker -- --test-threads=1
Remove-Item Env:HIKARU_ASR_FAKE_WORKER,Env:HIKARU_ASR_PRODUCTION_WORKER,Env:HIKARU_ASR_CT2_MODEL_PATH,Env:HIKARU_ASR_CT2_AUDIO_PATH
```

Scoring uses the task's `research/benchmark_adapter.py`, which imports `scripts/asr-benchmark.py`; all raw and adapted result files stay ignored.
