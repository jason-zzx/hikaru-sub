# T09 CrispASR Development Input Lock

## Status

`evidence-frozen`; the upstream/runtime identity review and Hikaru worker identity review were performed separately, then the final prepared identities and raw index were independently copied below before publication.

Canonical ignored root (active and archive-safe):

```text
.trellis/tasks/**/08-07-native-asr-crispasr-backend/research/local/
```

## Source and ABI

| Input | Identity |
|---|---|
| CrispASR | v0.8.22, commit `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`, MIT |
| Source archive | 22,221,230 bytes, SHA-256 `40fe6158044d760e10832ad924ec40c7b6c1148cfb1922bdde52e8511f3dd633` |
| Public session header | 51,717 bytes, SHA-256 `cdefd19f6f208ed3f77f31c1cc8df19224c1c81ed5e0e6064650a827000c68df` |
| Open-layout source | `src/crispasr_c_api.cpp`, exact task-local pinned source; v2 layout `{abi_version,n_threads,use_gpu,verbosity,flash_attn,n_gpu_layers,reserved[6]}` |
| Historical ABI reference only | CPU `crispasr.dll`, 11,758,080 bytes, SHA-256 `aa5d08f8cfe459727764bbe724b0780a75bd4167043c9cf63fd0fb43c2a559de` |

## Toolchain

| Input | Identity |
|---|---|
| Platform | Windows x64 |
| MSVC | 19.44.35222, pinned x64 tool root 14.44.35207; `cl.exe` 677,968 bytes SHA-256 `6cadddca8c19e76991bbb44dff2eab5cab6807f9145e8bce9a800235a5975e51` |
| CMake | 4.1.1-msvc1 |
| Ninja | 1.12.1 |
| CUDA Toolkit | 12.8.93; architecture 8.6 |

## Model identities

| Family / role | File | Bytes | SHA-256 | License |
|---|---|---:|---|---|
| parakeet-family representative model | `reazonspeech-nemo-v2-q8_0.gguf` | 667,147,072 | `20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2` | Apache-2.0 |
| qwen3-family model | `qwen3-asr-1.7b-q4_k.gguf` | 1,490,915,200 | `ec197cef7ccc589fdcae1becc3f4a3de119d0a41e790b898b519b1a048dad8d4` | Apache-2.0 |
| qwen3-family aligner | `qwen3-forced-aligner-0.6b-q4_k.gguf` | 529,001,216 | `a7bb4cbeacc6414f11a5d23dc7661a51a941a71e6d559dc7b408b52473f2ae84` | Apache-2.0 |

Parakeet JA remains a supported core route with model SHA-256 `5a61e6c7d956c3c72a76fafcd798cac0c9ea66d0e29b3910cd04865a1e42cc17`, but ReazonSpeech is the frozen performance representative for its execution family.

## Benchmark inputs

| Sample | Duration | SHA-256 |
|---|---:|---|
| T01 manifest | 2,868 bytes | `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` |
| short-v1 | 24,102 ms | `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211` |
| medium-v1 source | 498,872 ms | `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` |
| medium-v1 first-120s PCM prefix | 120,000 ms | `d7b8c62d1358eee4f7ca40596ec424e91cde6992654add5c0219cdeed3907b42` |

## Frozen execution vectors

```text
CPU:  abi=2 threads=16 use_gpu=0 verbosity=0 flash_attn=0 n_gpu_layers=0 preference=none
CUDA: abi=2 threads=16 use_gpu=1 verbosity=0 flash_attn=0 n_gpu_layers=-1 preference=cuda
```

Each formal row is one fresh process, one session, generation order `0/cold,1/warm,2/warm,3/warm`. Qwen time includes transcription plus raw ForcedAligner work and ends in `qwen_timeline_policy_not_implemented` with zero accepted timed output.

## Structured prepare commands

`prepare-runtime` executes one exact argv role below the canonical local root:

```text
cmake -S <source-root> -B <runtime-build-root> -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DCRISPASR_BUILD_TESTS=OFF -DCRISPASR_BUILD_EXAMPLES=OFF -DCRISPASR_BUILD_SERVER=OFF -DCRISPASR_CURL=OFF -DGGML_CUDA=ON -DGGML_CUDA_FA_ALL_QUANTS=OFF -DGGML_CUDA_FORCE_CUBLAS=ON -DCMAKE_CUDA_ARCHITECTURES=86
cmake --build <runtime-build-root> --target crispasr-lib
```

Timeout: 7,200 seconds. Missing source/toolchain/executable is input absence. A non-timeout nonzero configure/build exit with privacy-clean bound logs is a validated shared pre-runner failure.

`prepare-worker` executes:

```text
cmake -S native-asr -B <worker-build-root> -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON -DHIKARU_ASR_BUILD_CT2_WORKER=ON -DHIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=ON -DHIKARU_ASR_CRISPASR_RUNTIME_FILE=<reviewed-runtime> -DHIKARU_ASR_CRISPASR_RUNTIME_SIZE=<reviewed-size> -DHIKARU_ASR_CRISPASR_RUNTIME_SHA256=<reviewed-sha256>
cmake --build <worker-build-root>
```

Timeout: 7,200 seconds. It cannot run until the reviewed runtime fields below are filled.

## Review freeze fields

```text
preparedRuntime: build/crispasr-cuda/bin/crispasr.dll 11414528 824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e
preparedWorker: build/windows-x64-crispasr/bin/hikaru-asr-worker.exe 561152 e1f55919b46ad545ccd7d839e00d6e2533a766505cc9d814b7b0ad64cddd02f0
preparedRunner: build/windows-x64-crispasr/bin/hikaru-asr-crispasr-development-runner.exe 251904 5f0a54781c09436bf4139db1efc113388767fbf125c11f36e06822185ce86538
formalPairedRuntime: runtime 11414528/824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e worker 561152/e1f55919b46ad545ccd7d839e00d6e2533a766505cc9d814b7b0ad64cddd02f0 runner 251904/5f0a54781c09436bf4139db1efc113388767fbf125c11f36e06822185ce86538
checkpointEnvelope.parakeet-family: frozen by raw index SHA-256 1a3058ae5dff92c9157961e809e75126335f5f76cd20a655ee8cf9b9cdc3c625
checkpointEnvelope.qwen3-family: frozen by raw index SHA-256 1a3058ae5dff92c9157961e809e75126335f5f76cd20a655ee8cf9b9cdc3c625
```

No acquisition or publication may infer or fill these values. They require explicit reviewed size/SHA-256 identities from the ignored prepared outputs.

restrictedPathSha256: 7e0ff99390eaa1999d4a288cd67d0525461a3ac180c6a8c70043c14c0f6f9582
rawIndexSha256: 1a3058ae5dff92c9157961e809e75126335f5f76cd20a655ee8cf9b9cdc3c625
