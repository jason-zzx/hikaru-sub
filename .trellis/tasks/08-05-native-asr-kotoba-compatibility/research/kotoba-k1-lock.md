# T08 Kotoba K1 Input Lock

## Status And Boundary

Refrozen after the reviewed full-matrix publication rule change and before all replacement K1 quality runs. Every retained short, medium, and long row must bind this revised lock; earlier raw rows are excluded even when their worker/model/runtime identities otherwise match.

Canonical ignored root:

```text
.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/local/
```

Raw audio aliases, transcripts, token traces, absolute paths, models, binaries, build trees, loaded-module paths, and adapted private results stay below that root. The legacy model snapshot is the sole read-only external input exception: it is opened directly at the exact immutable Hugging Face revision path and is not copied, relocated, rewritten, or deleted.

## Ground Truth

Manifest:

- corpus: `hikaru-user-ja-ground-truth-v1`
- manifest SHA-256: `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277`
- authority: `.asr-benchmark/manifest.json` plus its local WAV+ASS pairs

| Case | Duration ms | WAV SHA-256 | ASS SHA-256 | Samples |
|---|---:|---|---|---|
| `short-v1` | 24,102 | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` | `60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b` | 1 cold + 3 warm |
| `medium-v1` | 498,872 | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` | `d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e` | 1 measured |
| `long-v1` | 4,144,235 | `af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e` | `7954ce24af05dca37b2930136c83ee722e80fd637ef298cc7eeb47f29cf8c6f3` | 1 measured |

Python output is diagnostic only. CER, timeline, and confirmed-gap metrics are recomputed from the authoritative ASS through `scripts/asr-benchmark.py`.

## Model And Legacy Cache

- engine: `kotoba-faster-whisper`
- backend: `ctranslate2`
- repository: `kotoba-tech/kotoba-whisper-v2.0-faster`
- revision: `f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc`
- license: MIT
- immutable path shape:

```text
<HF_HOME>/hub/models--kotoba-tech--kotoba-whisper-v2.0-faster/snapshots/f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc/
```

The exact existing copied-file Windows snapshot was verified at this shape. Normal Hugging Face symlink-backed files are also accepted because worker validation follows regular-file targets without rewriting them. Mutable `refs/main` is not consulted.

| File | Bytes | SHA-256 |
|---|---:|---|
| `config.json` | 2,394 | `a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9` |
| `model.bin` | 1,512,927,867 | `60d2bc2e33de9d43f2745be09caefe1161acab670f6796d4a750d8d848382b36` |
| `preprocessor_config.json` | 340 | `7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711` |
| `tokenizer.json` | 2,481,381 | `f70c9740a90657b489cf05b0fa0605c1d497db542f11a70a8cc80a025c94c7d8` |
| `vocabulary.json` | 1,068,114 | `c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1` |

Pinned sources:

- model card: `https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-faster/raw/f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc/README.md`
- preprocessor: the pinned `preprocessor_config.json` above (`feature_size=128`, `nb_max_frames=3000`, `chunk_length=30`)

## K1 Algorithm

| Parameter | Frozen value |
|---|---|
| source window | maximum 1,500 mel frames / 15,000 ms |
| model tensor and timestamp range | padded 3,000 frames / 30,000 ms |
| language prompt | Japanese transcription |
| beam | 5 |
| previous text | disabled |
| seek | timestamp-driven, capped to the current source window |
| VAD | disabled; `useVad=true` fails before `ready` |
| device | CUDA device 0 |
| compute | FLOAT16 |
| fallback | none |

No fuzzy overlap repair, reference-derived segmentation, synthetic timestamps, arbitrary gap filling, Python-parity patch, ORT VAD, or second worker is part of K1.

## Runtime And Build Identity

- CTranslate2: `4.8.0`, commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698`, clean pinned source
- oneDNN: `3.1.1`, pinned static library
- tokenizer: Rust `tokenizers 0.22.1`, `cargo --locked --offline`
- CUDA Toolkit: `12.8.93`
- architecture: exact `8.6`
- `CUDA_DYNAMIC_LOADING=ON`
- `WITH_CUDNN=OFF`
- MSVC: `19.44.35221`, toolset root `14.44.35207`
- CMake: `4.1.1-msvc1`
- Ninja: `1.12.1`
- GPU: NVIDIA GeForce RTX 3070, device 0, compute capability `8.6`
- driver: `596.49`; `nvcuda.dll` version `32.0.15.9649`; CUDA Driver API `13020`
- restricted PATH roles: T08 runtime `bin`, CUDA Toolkit 12.8 `bin`, Windows System32
- restricted PATH root identity SHA-256: `307e7f236aeb7dc81b18bc42f292e1cac2ef58478f5beccb0a58ab19cff4eb22`

| Tracked source/tool | Bytes | SHA-256 |
|---|---:|---|
| `native-asr/src/ctranslate2_whisper.hpp` | 8,200 | `dddde760bd4033251f1646126f6f70a6c56accdf14ce9264967b2179fcf8d699` |
| `native-asr/src/ctranslate2_whisper.cpp` | 64,397 | `175b22b288eae8f4f8af607855ea051c50d6f82bcb7a109f1d9fbba66d8e3563` |
| `native-asr/src/main.cpp` | 8,012 | `5123787daea51c6b2727fbf24671189fb3e4316b46e18b00a262ba061d43d05a` |
| `native-asr/tests/ctranslate2_whisper_tests.cpp` | 95,970 | `f738031fa4624bdf3e2e3cdb5a64ad9c28a79a3fdbf91382ee164fe92b2d79b7` |
| `research/kotoba_benchmark_adapter.py` | 27,325 | `e6d0c97791102ab8363e8011bd8321c93024b8722164b812f154a9e0e3d671ad` |
| `research/publish_kotoba_candidate.py` | 11,768 | `00b295fa42667fdbcbfc293bb56a72358fd6ec807e29bb8458a8fb6e453cdff6` |
| `research/test_publish_kotoba_candidate.py` | 11,954 | `684fd2e7a415179cc881f97e37e832e73b67635fe690391f0a640f60ff08affd` |

| Ignored runtime file | Bytes | SHA-256 |
|---|---:|---|
| `hikaru-asr-worker.exe` | 500,224 | `bc8f5f9696dfe98229f4d39db0ddfdc6ba86a0078611c59f815ac2044101117b` |
| `hikaru-asr-ctranslate2-tests.exe` | 769,024 | `6951747504d6150e50d357406b5aee7449a7c4d2291a8155ac3cf953561ed114` |
| `ctranslate2.dll` | 36,974,592 | `0c0f1436489b656d893c0e7c186192526edbe6106b530c09753b981294c9a337` |
| `hikaru_asr_tokenizer.dll` | 2,139,136 | `7a767701e05b11fa4c2667409420eac513f2cf24fcdc52cf0d769ce752db2fea` |
| `onnxruntime.dll` | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` |
| `onnxruntime_providers_shared.dll` | 21,856 | `599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8` |

Loaded module identities frozen before retaining formal rows:

| Root role | Module | Bytes | SHA-256 | Version |
|---|---|---:|---|---|
| `task-local-runtime-bin` | `hikaru-asr-ctranslate2-tests.exe` | 769,024 | `6951747504d6150e50d357406b5aee7449a7c4d2291a8155ac3cf953561ed114` | none |
| `task-local-runtime-bin` | `ctranslate2.dll` | 36,974,592 | `0c0f1436489b656d893c0e7c186192526edbe6106b530c09753b981294c9a337` | none |
| `task-local-runtime-bin` | `hikaru_asr_tokenizer.dll` | 2,139,136 | `7a767701e05b11fa4c2667409420eac513f2cf24fcdc52cf0d769ce752db2fea` | none |
| `task-local-runtime-bin` | `onnxruntime.dll` | 15,809,848 | `18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257` | `1.28.0.724` |
| `cuda-toolkit-12.8-bin` | `cublas64_12.dll` | 113,716,224 | `9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99` | `6.14.11.1284` |
| `cuda-toolkit-12.8-bin` | `cublasLt64_12.dll` | 674,667,520 | `b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7` | `6.14.11.1284` |
| `windows-system32` | `nvcuda.dll` | 4,466,920 | `ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c` | `32.0.15.9649` |
| `windows-system32` | `vcomp140.dll` | 213,064 | `31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7` | `14.50.35719.0` |

ONNX Runtime files remain build/runtime siblings inherited from the unchanged T06 worker link, but K1 does not create a VAD session or use ORT inference.

## Mandatory Gates And Stop Rule

Each authoritative case must satisfy:

- CER `<=0.35`;
- accelerated inference RTF `<=0.5`;
- short cold process wall `<=120s`;
- peak process RSS `<=6 GiB`;
- zero invalid/out-of-bounds timeline segments;
- zero confirmed speech gaps `>=1.5s`.

Run order is short, then medium, then long. All three cases are retained under one frozen identity even when an earlier gate fails. Any failure publishes sanitized `stop-revise`, preserves ignored raw evidence, leaves native Kotoba disabled, and stops before any unreviewed candidate.

## Reproduction Commands

All path variables below are repository-relative or local placeholders; do not copy resolved private paths into tracked output.

```powershell
$task = ".trellis/tasks/08-05-native-asr-kotoba-compatibility"
$bin = "$task/research/local/build/windows-x64-ct2-cuda/bin"
$model = "src-tauri/target/debug/deps/models/huggingface/hub/models--kotoba-tech--kotoba-whisper-v2.0-faster/snapshots/f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc"
$runner = "$bin/hikaru-asr-ctranslate2-tests.exe"
$worker = "$bin/hikaru-asr-worker.exe"
$lock = "$task/research/kotoba-k1-lock.md"
$cudaRoot = "<locked-cuda-toolkit-12.8-root>"

# Configure/build from an x64 MSVC 14.44 environment with CUDA_PATH=$cudaRoot.
cmake -S native-asr -B "$task/research/local/build/windows-x64-ct2-cuda" -G Ninja `
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DBUILD_TESTING=ON `
  -DHIKARU_ASR_BUILD_CT2_WORKER=ON -DHIKARU_ASR_ENABLE_CT2_CUDA_DEVELOPMENT=ON
cmake --build "$task/research/local/build/windows-x64-ct2-cuda"
ctest --test-dir "$task/research/local/build/windows-x64-ct2-cuda" --output-on-failure

function Invoke-T08Runner([string[]]$Arguments) {
  $savedPath = $env:PATH
  try {
    $env:PATH = @((Resolve-Path $bin).Path, (Join-Path $cudaRoot "bin"), [Environment]::SystemDirectory) -join ";"
    $env:CUDA_PATH = $cudaRoot
    & $runner @Arguments
    if ($LASTEXITCODE -ne 0) { throw "T08 runner failed: $LASTEXITCODE" }
  } finally {
    $env:PATH = $savedPath
  }
}

$common = @(
  "--run-kotoba-evidence",
  "--model", $model,
  "--input-lock", $lock,
  "--production-worker", $worker
)
Invoke-T08Runner ($common + @("--audio", ".asr-benchmark/short.wav", "--case-id", "short-v1", "--repeats", "4", "--output", "$task/research/local/raw/short.json"))
python "$task/research/kotoba_benchmark_adapter.py" --raw "$task/research/local/raw/short.json" --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark --case short-v1 --input-lock $lock --output "$task/research/local/adapted/short.json"
python "$task/research/publish_kotoba_candidate.py" --raw "$task/research/local/raw/short.json" --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark --input-lock $lock --evidence-output "$task/research/evidence/kotoba-candidate.json" --report-output "$task/research/kotoba-candidate-report.md"
```

Repeat with `medium-v1` and `long-v1` regardless of earlier case outcomes, passing all retained raw files to the publisher in short/medium/long order. A failed gate blocks candidate acceptance and any K2 implementation, not completion of the K1 diagnostic matrix.
