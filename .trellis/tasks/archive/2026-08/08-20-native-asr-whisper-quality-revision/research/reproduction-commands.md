# Native Faster-Whisper GPU fallback diagnostic reproduction

This file records the sanitized v3 command shape. Raw rows, model/audio contents, module paths and token traces remain below ignored/local inputs and are not tracked.

## Frozen identity

- Lock: `research/gpu-fallback-diagnostic-lock-v3.md`
- Lock SHA-256: `b95bdcc1e2a33ab30c2064fef70d466cd92842fedaaaed07350a1c111bcdcf29`
- Candidate: `upstream-generation-fallback-parity-v1`
- Cells: `short-b5-on-vad-fallback`, `medium-b5-on-vad-fallback`

## Acquisition command shape

```powershell
$root = (Resolve-Path .).Path
$research = Join-Path $root ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research"
$runtime = Join-Path $research "local/build/windows-x64-ct2-cuda/bin"
$cuda = $env:CUDA_PATH
$env:PATH = "$runtime;$cuda/bin;$env:SystemRoot/System32"
$runner = Join-Path $runtime "hikaru-asr-ctranslate2-tests.exe"
$worker = Join-Path $runtime "hikaru-asr-worker.exe"
$vad = Join-Path $runtime "silero_vad_v6.onnx"
$model = Join-Path $root "src-tauri/target/debug/deps/models/huggingface/hub/models--Systran--faster-whisper-large-v3/snapshots/edaa852ec7e145841d8ffdb056a99866b5f0a478"
$lock = Join-Path $research "gpu-fallback-diagnostic-lock-v3.md"
$raw = Join-Path $research "local/fallback-diagnostic-v3"

& $runner --run-whisper-quality-fallback-diagnostic `
  --cell short-b5-on-vad-fallback --model $model `
  --audio (Join-Path $root ".asr-benchmark/short.wav") `
  --output (Join-Path $raw "short-b5-on-vad-fallback.json") `
  --input-lock $lock --production-worker $worker `
  --model-id Systran/faster-whisper-large-v3 `
  --model-revision edaa852ec7e145841d8ffdb056a99866b5f0a478 `
  --model-bin-sha256 69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1 `
  --repeats 1 --vad-model $vad

& $runner --run-whisper-quality-fallback-diagnostic `
  --cell medium-b5-on-vad-fallback --model $model `
  --audio (Join-Path $root ".asr-benchmark/medium.wav") `
  --output (Join-Path $raw "medium-b5-on-vad-fallback.json") `
  --input-lock $lock --production-worker $worker `
  --model-id Systran/faster-whisper-large-v3 `
  --model-revision edaa852ec7e145841d8ffdb056a99866b5f0a478 `
  --model-bin-sha256 69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1 `
  --repeats 1 --vad-model $vad
```

Each cell runs in a separate process. The first medium attempt was externally terminated by the parent acquisition harness after `1800000ms`, before atomic output, and was discarded; only the clean-process rerun is authoritative. Separate ignored process history `local/process-history/fallback-v3-invalid-medium-first-attempt.json` records the frozen runner/worker/lock identity, external timeout, absent atomic row/metrics, and confirmed process exit without treating the attempt as model evidence.

## Publication

```powershell
python "$research/publish_whisper_gpu_quality.py" fallback-diagnostic `
  --raw-dir "$research/local/fallback-diagnostic-v3" `
  --input-lock $lock `
  --manifest "$root/.asr-benchmark/manifest.json" `
  --corpus-root "$root/.asr-benchmark" `
  --baseline "$root/.trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json" `
  --json-output "$research/whisper-gpu-fallback-diagnostic.json" `
  --report-output "$research/whisper-gpu-fallback-diagnostic.md"
```

Run publication twice to separate destinations and require byte-identical output.

| Artifact | SHA-256 |
|---|---|
| ignored invalid first-medium process history | `ed49f1cda08ce495943a60943b800c3d45582e0f0914c04eacae69a7b13e8530` |
| ignored short raw row | `e60a7c22722b5d23cb906375d6370b99c27647ce76fb968a6e4af64f204c87b1` |
| ignored medium clean-rerun raw row | `0e66c911a9f7b1da81d25c52f169f9da1e63f2c0a7040d47d974b273813d5584` |
| tracked fallback diagnostic JSON | `66dfb00ee41599f78dc3cdf2c757d0946a922988e62bcc016b5d7c674c345f7c` |
| tracked fallback diagnostic Markdown | `8766aeedd545ec5b4cb2f79144320f730c6d0692ba1d51429ba78740883a443c` |

The publication is diagnostic-only and selected `no-candidate-selected`.

## Phase 3D pre-model parity preparation

No command in this section loads large-v3 or runs ASR/VAD inference.

```powershell
Push-Location native-asr
cmake --preset windows-x64-ct2-cuda-whisper-parity-bisect
cmake --build --preset windows-x64-ct2-cuda-whisper-parity-bisect --parallel 1
ctest --preset windows-x64-ct2-cuda-whisper-parity-bisect --output-on-failure
Pop-Location

# Copy the identical rebuilt runner/tokenizer/ORT files into ignored
# research/local/parity/runtime-native/bin and runtime-python/bin.
# Native gets the frozen native CT2 DLL; Python gets the wheel CT2,
# cudnn64_9 and libiomp5md files. PATH is runtime bin, CUDA 12.8 bin,
# then Windows System32.

cmd /d /c research/local/parity/run-runtime-smoke-evidence.cmd native
cmd /d /c research/local/parity/run-runtime-smoke-evidence.cmd python
cmd /d /c research/local/parity/export-native-mel.cmd

asr-service/.venv/Scripts/python.exe `
  "$research/generate_whisper_short_parity_inputs.py" `
  --audio .asr-benchmark/short.wav `
  --python-mel "$research/local/parity/inputs/python-mel.f32" `
  --native-mel "$research/local/parity/inputs/native-mel.f32" `
  --metadata-output "$research/local/parity/inputs/metadata.json"

asr-service/.venv/Scripts/python.exe "$research/test_publish_whisper_short_parity_bisect.py"
asr-service/.venv/Scripts/python.exe "$research/test_whisper_short_parity_oracles.py"
python "$research/test_publish_whisper_gpu_quality.py"
```

Frozen pre-model identities:

| Artifact | SHA-256 |
|---|---|
| `gpu-short-parity-bisect-lock.md` | `470f9e0fba8cb0bc837660eae4173635bcc86212bea83324a02c0953d9c36793` |
| parity runner in both roots | `307379a2085ee422f5814fdbb82f334a7f90d7600086dd5285e61f183230ec6c` |
| ignored native runtime smoke | `e4dd18cf324a1614de5ce253a51af927ddda68067c196a8b506d0e8eca101472` |
| ignored Python-wheel runtime smoke | `050a41530eb0ec74fb31b055350cb8c33420ee348d77f9b55dfeaf269d06c76e` |
| ignored native Mel | `c2fc425ae691a4b1f9acd92580061ad97df82e01165747d761653f87634b9e08` |
| ignored Python Mel | `51209b71c3450718055dfad8a3d5923283dd95d702d606b0bdf56aac53218aa9` |
| ignored sanitized input metadata | `e40e00b562b8196c40be271b6d8555bc425a50da415571299193ae8cecc993c4` |

Future model-backed command shape is frozen but intentionally not executed. The original lock is superseded for acquisition because it did not directly bind the Python VAD preflight artifact.

## Phase 3D V2 corrected acquisition boundary

The user granted fresh authorization for exact v2 lock `481c17cc...`. The VAD command below executed and stopped at frozen loaded-module attestation; the cell, parser and publisher commands remained unexecuted. This authorization is consumed and cannot carry to a corrected lock.

```powershell
$root = (Resolve-Path .).Path
$research = Join-Path $root ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research"
$lock = Join-Path $research "gpu-short-parity-bisect-lock-v2.md"
$model = Join-Path $root ".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local/models/large-v3"
$audio = Join-Path $root ".asr-benchmark/short.wav"
$raw = Join-Path $research "local/parity/v2"
$python = Join-Path $root "asr-service/.venv/Scripts/python.exe"

# First gate: exact Python V6 VAD identity and one full retained interval.
& $python (Join-Path $research "whisper_short_vad_preflight.py") `
  --audio $audio --input-lock $lock `
  --output (Join-Path $raw "vad-preflight.json")

$cells = @(
  @{ Id="python-runtime-python-mel"; Runtime="python"; Mel="python" },
  @{ Id="python-runtime-native-mel"; Runtime="python"; Mel="native" },
  @{ Id="native-runtime-python-mel"; Runtime="native"; Mel="python" },
  @{ Id="native-runtime-native-mel"; Runtime="native"; Mel="native" }
)
foreach ($cell in $cells) {
  $bin = Join-Path $research "local/parity/runtime-$($cell.Runtime)/bin"
  $env:PATH = "$bin;$env:CUDA_PATH/bin;$env:SystemRoot/System32"
  & (Join-Path $bin "hikaru-asr-ctranslate2-tests.exe") `
    --run-whisper-short-parity --cell $cell.Id --model $model `
    --mel (Join-Path $research "local/parity/inputs/$($cell.Mel)-mel.f32") `
    --output (Join-Path $raw "$($cell.Id).json") `
    --input-lock $lock --production-worker (Join-Path $bin "hikaru-asr-worker.exe") `
    --model-id Systran/faster-whisper-large-v3 `
    --model-revision edaa852ec7e145841d8ffdb056a99866b5f0a478 `
    --model-bin-sha256 69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1 `
    --repeats 2
  & $python (Join-Path $research "whisper_short_parser_oracle.py") `
    --raw (Join-Path $raw "$($cell.Id).json") `
    --tokenizer (Join-Path $model "tokenizer.json") `
    --output (Join-Path $raw "$($cell.Id)-parser.json")
}

& $python (Join-Path $research "publish_whisper_short_parity_bisect.py") `
  --python-runtime-python-mel-raw (Join-Path $raw "python-runtime-python-mel.json") `
  --python-runtime-python-mel-parser (Join-Path $raw "python-runtime-python-mel-parser.json") `
  --python-runtime-native-mel-raw (Join-Path $raw "python-runtime-native-mel.json") `
  --python-runtime-native-mel-parser (Join-Path $raw "python-runtime-native-mel-parser.json") `
  --native-runtime-python-mel-raw (Join-Path $raw "native-runtime-python-mel.json") `
  --native-runtime-python-mel-parser (Join-Path $raw "native-runtime-python-mel-parser.json") `
  --native-runtime-native-mel-raw (Join-Path $raw "native-runtime-native-mel.json") `
  --native-runtime-native-mel-parser (Join-Path $raw "native-runtime-native-mel-parser.json") `
  --input-lock $lock --model $model `
  --python-mel (Join-Path $research "local/parity/inputs/python-mel.f32") `
  --native-mel (Join-Path $research "local/parity/inputs/native-mel.f32") `
  --vad-preflight (Join-Path $raw "vad-preflight.json") `
  --json-output (Join-Path $research "whisper-short-parity-bisect.json") `
  --markdown-output (Join-Path $research "whisper-short-parity-bisect.md")
```

Run publication twice to separate outputs and require byte-identical JSON/Markdown. Any VAD, lock, disk identity, cell, module, repeat, parser or anchor mismatch stops without a disposition.

### V2 authorized-attempt outcome

- Tool/VAD/model/Mel disk identity checks passed before VAD execution.
- Exact Silero V6 inference executed, but post-VAD attestation failed with `required loaded module is missing: onnxruntime.dll`.
- The frozen Python extension does not directly import sibling `onnxruntime.dll` according to an ignored-local `dumpbin /DEPENDENTS` audit.
- No atomic VAD artifact, ASR model load, cell row, parser artifact or parity publication exists.

| Artifact | SHA-256 |
|---|---|
| immutable v2 lock | `481c17cc99d84071bfaf6aaad10222d2848e09416f0b29552e97fa7d42819543` |
| immutable superseded lock | `470f9e0fba8cb0bc837660eae4173635bcc86212bea83324a02c0953d9c36793` |
| ignored sanitized invalid-preflight JSON | `5c287a6b7b252284466379873bb4e2a237fda1dc0a1babc551583757ff3fc118` |
| tracked invalid-preflight report | `86b7cfcde55d46848ec4003feadfff9b61c7e72e5cbca8eb0bd6658fe137b78d` |

## Phase 3D V3 actual Python ORT boundary

No VAD/ASR model or parity cell has run under v3. Import-only smoke constructed no `InferenceSession` and observed the exact frozen `onnxruntime/capi` module split:

- loaded: `onnxruntime_providers_shared.dll`;
- loaded: `onnxruntime_pybind11_state.pyd`;
- not loaded: `onnxruntime.dll`.

| Artifact | SHA-256 |
|---|---|
| `gpu-short-parity-bisect-lock-v3.md` | `62ef486a9f54d62d3f78504fc293a1917e59746d85cf09a73422edc2c384e42f` |
| ignored sanitized import-only smoke | `3e3bbbff2aa438a662fb2a2380d6efe688072aebf7dc43a4f07a7d8ca25623e4` |
| immutable v2 lock | `481c17cc99d84071bfaf6aaad10222d2848e09416f0b29552e97fa7d42819543` |
| immutable v2 invalid JSON | `5c287a6b7b252284466379873bb4e2a237fda1dc0a1babc551583757ff3fc118` |

Fresh explicit v3 authorization was granted. The immutable identity re-attestation and exact VAD command completed, but the first cell stopped before CTranslate2 Whisper model construction with the frozen fallback/VAD config invariant. Do not execute the remaining cell/parser/publisher commands under v3.

### V3 authorized-attempt outcome

| Artifact | SHA-256 |
|---|---|
| ignored pre-model re-attestation | `ad48d75a8a85d4cdf6090cde10b4280653362d91b9876d4b754fb6e9478b38e8` |
| ignored completed VAD preflight | `f7201eef4c0e912eb181291038f66942d218ef7fb5e14ff86a0783f62a447246` |
| ignored invalid first-cell record | `808dd23c1f69e395bd759aad183e04e6b32e8c354a54f151b64c001e22882132` |
| tracked minimal report | `1571773487cfe39fbf33daa149e030b29c257b3dca2760c0056604a46f79509d` |

The VAD artifact proves one `[0,385637)` interval, identical pre/post waveform, exact loaded `{onnxruntime_providers_shared.dll, onnxruntime_pybind11_state.pyd}` and not-loaded `onnxruntime.dll`. The first cell produced no atomic row because the frozen runner passed `std::nullopt` as the VAD model path to `upstream_generation_fallback_config()`, and the backend rejected that identity before constructing CTranslate2 Whisper. No ASR model, encode, generate, parser or publication exists; the remaining three cells did not run. V3 authorization is consumed and any repair requires a new rebuilt/reviewed lock plus fresh approval.

## Phase 3D V4 pre-model runner repair

No command in this section runs Python Silero VAD inference, constructs CTranslate2 Whisper/large-v3, encodes, generates, executes a parity acquisition cell, runs a parser over acquired output, or publishes a parity attribution.

```powershell
$root = (Resolve-Path .).Path
$research = Join-Path $root ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research"
$lock = Join-Path $research "gpu-short-parity-bisect-lock-v4.md"
$model = Join-Path $root ".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local/models/large-v3"

Push-Location native-asr
cmake --preset windows-x64-ct2-cuda-whisper-parity-bisect
cmake --build --preset windows-x64-ct2-cuda-whisper-parity-bisect --parallel 1
ctest --preset windows-x64-ct2-cuda-whisper-parity-bisect --output-on-failure
Pop-Location

# Recreate both ignored isolated roots from the rebuilt task-local runner/worker,
# tokenizer, ORT files and exact Silero V6 asset. Keep wheel CT2/cuDNN/OpenMP
# only in runtime-python; keep native CT2 only in runtime-native.
cmd /d /c "$research/local/parity/run-no-model-smoke.cmd native"
cmd /d /c "$research/local/parity/run-no-model-smoke.cmd python"
```

The closed preflight command for each of the four `Mel × runtime` cells now includes the required runtime-local VAD path:

```powershell
$runtime = Join-Path $research "local/parity/runtime-native/bin"
& (Join-Path $runtime "hikaru-asr-ctranslate2-tests.exe") `
  --short-parity-preflight `
  --cell native-runtime-native-mel `
  --model $model `
  --mel (Join-Path $research "local/parity/inputs/native-mel.f32") `
  --vad-model (Join-Path $runtime "silero_vad_v6.onnx") `
  --input-lock $lock `
  --production-worker (Join-Path $runtime "hikaru-asr-worker.exe") `
  --model-id Systran/faster-whisper-large-v3 `
  --model-revision edaa852ec7e145841d8ffdb056a99866b5f0a478 `
  --model-bin-sha256 69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1
```

Repeat only this no-model preflight for the other three exact cells with the matching Mel/runtime root. Each successful envelope must report `vadModelLoaded=false`, `asrModelLoaded=false`, and `modelLoaded=false`. Missing `--vad-model`, unknown CLI fields, a VAD path from the other runtime root, or a wrong-size/hash asset must fail before backend/model construction.

V4 lock SHA-256: `e38e23f5fc28405ffb2554324b2967c077d6eeda46b010ec51aac5bece378ff8`. This lock and a clean pre-model review permitted only requesting fresh acquisition authorization; they did not authorize inference by themselves.

## Phase 3D V4 authorized-attempt outcome

Fresh exact-v4 authorization was granted. A stdlib-only ignored-local re-attestation walked the complete v4 machine-readable identity and predecessor inventory before any VAD/model load. It bound exact source/tools, both runtime roots, expected loaded-module disk identities, model/Mel/corpus/VAD files, restricted PATH roots, RTX 3070 driver `596.49`, and CUDA `12.8.93` into `local/parity/v4-acquisition/pre-model-reattestation.json`.

The four closed no-model preflights were freshly rerun in clean processes:

```powershell
cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v4\run-preflight-v4.cmd python python
cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v4\run-preflight-v4.cmd python native
cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v4\run-preflight-v4.cmd native python
cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v4\run-preflight-v4.cmd native native
```

All four reproduced their reviewed byte hashes and reported no model loaded. The exact-v4 VAD command was then attempted:

```powershell
asr-service/.venv/Scripts/python.exe `
  .trellis/tasks/08-20-native-asr-whisper-quality-revision/research/whisper_short_vad_preflight.py `
  --audio .asr-benchmark/short.wav `
  --input-lock .trellis/tasks/08-20-native-asr-whisper-quality-revision/research/gpu-short-parity-bisect-lock-v4.md `
  --output .trellis/tasks/08-20-native-asr-whisper-quality-revision/research/local/parity/v4-acquisition/vad-preflight.json
```

It failed before faster-whisper/ONNX Runtime import with `VAD preflight input path identity drifted`. The frozen tool still accepts only `gpu-short-parity-bisect-lock-v3.md`; no source or lock was repaired. No VAD artifact, ASR model load, parity row, parser artifact or publication exists, so the four model-backed commands were intentionally not run.

| Artifact | SHA-256 |
|---|---|
| v4 pre-model re-attestation | `385353870ebba5d20c894daf595e80f735ff95d0e629992a7dc52c2fde46b5ef` |
| `python-runtime-python-mel` no-model preflight | `e8b888fbaad6e3350867110a5b0d06f6844279cce11d05d0225952513c4a15a2` |
| `python-runtime-native-mel` no-model preflight | `9363ba44922fcefce3a537f4121a3831da14bab80f0fb3f8606da79bdc281cda` |
| `native-runtime-python-mel` no-model preflight | `c9eb1e3656ee6b662e82f71ed2da7c36118fecb167e82823d11290e8f9e74fc7` |
| `native-runtime-native-mel` no-model preflight | `03942aad9960e4945979a1c77128d07d8a43b295c3b17e02ec38573bcf44b7c7` |
| sanitized invalid v4 preflight | `47299ae4a7d52b818dae72afa4e69f429e8ddd4e8a8a561ff5a96d0d894013c0` |
| tracked minimal report | `01d1279f18d8794bf814bffa8620ac1ec3efc0b975b8a4b44a7086a24d0a3de4` |

Disposition: `invalid-evidence`; parity attribution: none. V4 authorization is consumed and v4 cannot be retried or repaired in place.

## Phase 3D V5 pre-model VAD lock-selection repair

No command in this section imports faster-whisper/ONNX Runtime for VAD execution, constructs an `InferenceSession`, loads a VAD/ASR model, encodes, generates, runs a parity acquisition cell, invokes the parser over acquired output, or publishes parity attribution.

```powershell
$root = (Resolve-Path .).Path
$research = Join-Path $root ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research"
$lock = Join-Path $research "gpu-short-parity-bisect-lock-v5.md"

# Stdlib-only exact-lock selection coverage. Exact v5 reaches only the
# post-lock identity boundary; v1-v4/unknown/cross-root/malformed paths stop first.
python (Join-Path $research "test_whisper_short_vad_preflight_lock.py")

# Existing task-local publisher/oracle coverage. The ORT test is import-only;
# it does not construct InferenceSession or load Silero/ASR.
asr-service/.venv/Scripts/python.exe `
  (Join-Path $research "test_publish_whisper_short_parity_bisect.py")
asr-service/.venv/Scripts/python.exe `
  (Join-Path $research "test_whisper_short_parity_oracles.py")

# Same executable/runtime roots as v4; outputs remain ignored-local.
cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v5\run-runtime-smoke-v5.cmd native
cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v5\run-runtime-smoke-v5.cmd python

cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v5\run-preflight-v5.cmd python python
cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v5\run-preflight-v5.cmd python native
cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v5\run-preflight-v5.cmd native python
cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v5\run-preflight-v5.cmd native native

# Existing C++ VAD-path negatives, still before backend/model construction.
cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v5\run-negative-preflight-v5.cmd missing
cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v5\run-negative-preflight-v5.cmd wrong-path
cmd.exe /d /c call .trellis\tasks\08-20-native-asr-whisper-quality-revision\research\local\v5\run-negative-preflight-v5.cmd wrong-identity
```

V5 no-model outputs:

| Artifact | SHA-256 | Model state |
|---|---|---|
| native runtime smoke | `4537074dee333f44e1383f1a44187e6ada0baffc6a1f584cfa31f175cd80f9c3` | `modelLoaded=false` |
| Python-wheel runtime smoke | `0df1d87751e8d27f23f2a7962f98456349f33b359fda1e6eeb7432be16407a97` | `modelLoaded=false` |
| `python-runtime-python-mel` preflight | `e8b888fbaad6e3350867110a5b0d06f6844279cce11d05d0225952513c4a15a2` | all model-loaded flags `false` |
| `python-runtime-native-mel` preflight | `9363ba44922fcefce3a537f4121a3831da14bab80f0fb3f8606da79bdc281cda` | all model-loaded flags `false` |
| `native-runtime-python-mel` preflight | `c9eb1e3656ee6b662e82f71ed2da7c36118fecb167e82823d11290e8f9e74fc7` | all model-loaded flags `false` |
| `native-runtime-native-mel` preflight | `03942aad9960e4945979a1c77128d07d8a43b295c3b17e02ec38573bcf44b7c7` | all model-loaded flags `false` |
| v5 lock | `6a2ee4ee58cde783be473e907a4fe56aa72c7afcdba7b567644d2dfce74ac8fb` | pre-model identity only |

Stop here for independent review. Do not run `whisper_short_vad_preflight.py` with exact v5 beyond the tested post-lock boundary, any `--run-whisper-short-parity` cell, parser publication, or parity publisher until a fresh explicit exact-v5 acquisition authorization exists.

## Phase 3D V5 authorized-attempt outcome

Fresh exact-v5 authorization was granted. The complete pre-model re-attestation and all reviewed runtime/preflight checks passed before model load. The exact Python VAD command completed:

```powershell
asr-service/.venv/Scripts/python.exe `
  .trellis/tasks/08-20-native-asr-whisper-quality-revision/research/whisper_short_vad_preflight.py `
  --audio .asr-benchmark/short.wav `
  --input-lock .trellis/tasks/08-20-native-asr-whisper-quality-revision/research/gpu-short-parity-bisect-lock-v5.md `
  --output .trellis/tasks/08-20-native-asr-whisper-quality-revision/research/local/v5-acquisition/vad-preflight.json
```

It reproduced the frozen full interval/waveform and ORT loaded/not-loaded contract. The first and only attempted cell used the exact frozen command shape with `--cell python-runtime-python-mel`, Python-wheel runtime, Python Mel, runtime-local Silero V6 and `--repeats 2`.

The process successfully constructed large-v3, then failed before encode/generate with `config_identity_mismatch: Short parity bisect requires the exact ordinary fallback identity`. The frozen input is `80×3000`, while the frozen model exposes `128` Mel bins. No atomic row or temporary row exists. The other three cells, parser oracle and publisher were not run.

| Artifact | SHA-256 |
|---|---|
| exact v5 lock | `6a2ee4ee58cde783be473e907a4fe56aa72c7afcdba7b567644d2dfce74ac8fb` |
| ignored v5 pre-model re-attestation | `d9414b5ce92f772b011c5509b40b513b07f897d360b4a82e4f60adaf81eb00bb` |
| ignored completed v5 VAD preflight | `90e58fed46551047a55d89a537a8d91a692a844d73b6041c5d87ca4393b12002` |
| ignored sanitized invalid first-cell record | `3c8ebeddabe4b3e68b8c426a256293fd4cc0cc9d00d18d84e6cbaf1fff185d2c` |
| tracked minimal report | `725e6da1e3a0d7929d167d9455dcec3489847dadd9311217fed23b9897858676` |

Disposition: `invalid-evidence`; parity attribution: none. V5 authorization is consumed. Do not repair/retry v5, continue later cells, create v6, run parser/publication, or enter the formal matrix.
