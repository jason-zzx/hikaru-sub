# T07 - CTranslate2 CUDA 开发通道设计

## Summary

T07 在现有 `hikaru-asr-worker` 中增加一个显式、可验证的 CUDA execution config，并增加独立 opt-in CUDA build preset。CUDA-enabled worker 同时支持 CPU 与 CUDA 请求，以便在相同源码、binary family、模型和算法下做 paired 性能比较。

该通道只服务开发迭代。生产/default 仍走 Python legacy；正式 runtime pack、设备探测、下载和发布资格仍属于 T14/T15。

## Stable Boundaries

保持不变：

- protocol v1 request/event schema；
- `faster-whisper -> ctranslate2` 固定 route；
- T05 `NativeAsrHost`、active gate、recovery、cancel/process-tree 和 first-terminal-wins；
- T06 timestamp-driven、no-history、beam-1 算法；
- large-v3 pinned model、tokenizer 和 benchmark truth；
- CPU preset 的 `Device::CPU + ComputeType::INT8` 行为；
- Python legacy Release/default routing。

T07 不增加第二个 worker、第二套协议、auto device、静默 CPU fallback 或 CUDA 专用字幕算法。

## Development Runtime Identity

### Primary Identity

- Platform: Windows x64。
- GPU: NVIDIA GeForce RTX 3070, 8 GiB, compute capability `8.6`。
- Driver: `596.49`。
- CUDA Toolkit: installed `12.8.93`。
- CTranslate2: `4.8.0`, commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698`。
- CUDA architecture: exact `8.6`，不使用 `Common` 扩大开发 build。
- CUDA loading: `CUDA_DYNAMIC_LOADING=ON`。
- cuDNN: primary identity 使用 `WITH_CUDNN=OFF`；上游 9.10.2 输入只作为 reviewed reference，不下载或安装。
- CPU backend: 保留 oneDNN 3.1.1，使同一 CUDA-enabled worker 可执行 paired CPU baseline。

任务 lock 在运行前记录 `nvcc`、MSVC、CMake、Ninja、Windows、GPU、driver、CUDA headers/import libs 与实际 loaded CUDA DLL 的版本、大小和 SHA-256。Tracked lock 使用 root role 和哈希，不包含绝对用户路径。

### Conditional cuDNN Identity

只有 primary identity 无法执行，或得到 `development-gpu-no-speedup` 且 root-cause evidence 明确指向 convolution path 时，才允许单独规划第二 build identity：task-local 提取 pinned cuDNN 9.10.2、`WITH_CUDNN=ON`、独立 lock/binary/DLL/evidence。不得覆盖 primary evidence，也不得修改系统 CUDA 目录。

## Build Design

保留现有默认：

```text
HIKARU_ASR_BUILD_CT2_WORKER=OFF
```

在现有 CT2 block 内增加一个 default-off CUDA option。行为矩阵：

| Preset | CT2 worker | CUDA | cuDNN | Purpose |
|---|---:|---:|---:|---|
| `windows-x64-release` | off | no | no | protocol/fake worker |
| `windows-x64-ct2-release` | on | no | no | existing CPU worker |
| `windows-x64-ct2-cuda-development` | on | yes | no | T07 ignored-local CPU/CUDA worker |

CUDA preset 使用独立 binary directory，位于 T07 canonical ignored root 下。CUDA discovery 只在 opt-in option 打开时发生；无 CUDA 机器仍可配置和测试前两个 presets。CUDA-enabled worker/runner 使用显式、受限且有序的 child-process `PATH`：先是其 task-local runtime/bin，再是 locked CUDA Toolkit `bin`，最后是必要的 Windows system root；不复制 CUDA DLL 到 tracked/build output，也不依赖调用者的宽泛用户 PATH。该 PATH root-role identity 绑定到 raw evidence。

Primary CUDA CTranslate2 flags：

```text
WITH_DNNL=ON
WITH_CUDA=ON
WITH_CUDNN=OFF
CUDA_DYNAMIC_LOADING=ON
CUDA_ARCH_LIST=8.6
WITH_HIP=OFF
WITH_TENSOR_PARALLEL=OFF
WITH_FLASH_ATTN=OFF
```

CUDA runtime 不进入 installer、portable、release scripts 或 trusted manifests。

## Execution Configuration

现有 backend constructor 接受一个小型结构化 execution config，其语义固定为：

| Protocol device | CT2 device | index | compute type |
|---|---|---:|---|
| `cpu` | `Device::CPU` | `0` | `ComputeType::INT8` |
| `cuda` | `Device::CUDA` | `0` | `ComputeType::FLOAT16` |

`FLOAT16` 来自父设计和当前 ordinary faster-whisper CUDA baseline；RTX 3070 compute capability 8.6 原生支持 FP16。T07 不搜索 `INT8_FLOAT16`、BF16、flash attention 或多个 compute types。

请求流：

```text
WorkerRequestV1.device
  -> main.cpp fixed mapping
  -> pre-ready build/device/compute validation
  -> CTranslate2WhisperBackend(model, algorithmConfig, executionConfig)
  -> successful model construction
  -> ready.device=request.device
  -> unchanged transcription pipeline
```

CPU-only binary 收到 CUDA request 时返回稳定的 pre-ready `cuda_not_built`。CUDA-enabled binary 在无 device 0、FP16 unsupported 或 runtime/model construction failure 时分别返回窄化、安全的 structured error。任何路径都不得自动构造 CPU model。

## CUDA Attestation

### Worker-side

在 `ready` 前确认：

- binary 包含 CUDA backend；
- CTranslate2 可见至少一个 CUDA device；
- selected index 为 `0`；
- device 0 支持 `FLOAT16`；
- Whisper model 以 `Device::CUDA/FLOAT16/{0}` 成功构造。

`ready.device="cuda"` 只在上述步骤完成后发出。

### Evidence-side

复用现有 `hikaru-asr-ctranslate2-tests` evidence mode，扩展而不是新建 runner。每个 CUDA completed run 记录：

- requested/resolved device、compute type、device index；
- GPU name、compute capability、driver；
- worker/runner/CT2/tokenizer/model/config/audio identity；
- completed generation 后实际 loaded relevant modules 的 canonical root role、size、SHA-256 和 version；
- load、feature、generate、inference、sample wall 和 process wall timing。

正式 measurement 前，在同一 CUDA-enabled binary identity 下分别从干净进程运行一条不计入结果的 CPU module-discovery completed run 和一条 CUDA module-discovery completed run。比较两者后推导并冻结 shared、CPU-only 和 CUDA-only required module sets；随后再从干净新进程重新执行全部 short/120s `1 cold + 3 warm`。Primary no-cuDNN identity 要求至少证明 CTranslate2、NVIDIA driver 和实际使用的 CUDA math/runtime modules，并拒绝 `cudnn*.dll`。CPU/GPU rows 只要求 worker/runner/CT2/tokenizer 等 shared identity 相同，各自 required module set 可以不同；CPU rows 不要求 CUDA-only modules。Validator 拒绝：

- requested CUDA / resolved CPU；
- 缺少 device 0 或 FP16 attestation；
- 未完成 generate；
- shared 或 device-specific required module 缺失、hash/root 漂移或 correlated all-root rewrite；
- CPU rows 意外加载未声明 CUDA modules，或 CUDA rows 缺少 frozen CUDA-only modules；
- worker/model/config/audio 身份漂移；
- raw path 不在 canonical ignored root。

## Paired Performance Design

### Samples

- authoritative `short-v1`，24.102 秒；
- T06 已验证的 medium-v1 前 120 秒 PCM slice，SHA-256 `d7b8c62d1358eee4f7ca40596ec424e91cde6992654add5c0219cdeed3907b42`。

120 秒 slice 保持 private，并验证其 PCM 精确等于 locked medium WAV 的前 120 秒。

### Runs

每个 sample/device 独立启动 runner，单次构造 backend/model，并执行：

```text
1 cold + 3 warm
```

CPU 与 GPU 分开进程运行，避免同时持有两个 large-v3 replica。所有 4 次 timing 留在 ignored raw evidence，publisher 使用 3 次 warm inference RTF median。

### Decision

对 short 和 120 秒 slice 分别计算：

```text
gpuWarmMedianRtf <= cpuWarmMedianRtf * 0.80
```

两个 sample 都满足才发布 `development-gpu-ready`。GPU 已 attested 且 completed generation，但任一 sample 不满足时发布 `development-gpu-no-speedup`。`development-gpu-unavailable` 只接受两类独立输入：sanitized configure/build failure envelope，或 worker structured pre-ready CUDA runtime/device/model failure envelope。普通 raw 缺失、identity drift、module validation failure、publisher error 或未完成 measurement 发布 no-result failure，不得伪装为 unavailable。

`RTF <=0.5` 单独报告为 T15 diagnostic，不覆盖 20% 开发速度规则。Publisher 不计算 CER、gap、segmentation 或 timestamp quality；这些失败继续在 ready GPU lane 上迭代。

## Rust Host Compatibility

生产 host 已允许 CUDA route 并检查 ready route equality。T07 只修改 `asr_worker.rs` 的 `#[cfg(test)]` model-backed helper，使其可显式选择 `cpu` 或 `cuda`；Release/product code 不读取新增 test key。

CUDA-focused host checks：

1. success：completed、合法 timeline、recovery/fallback output、reaped、active gate released；
2. pre-ready structured failure：使用 CPU-only worker 接收 CUDA request，确定性触发 `cuda_not_built`；保留 safe code 和 recovery，不接受 ready/completed，不破坏系统 CUDA 环境；
3. cancellation：使用 120 秒 slice，等待 ready-derived `durationMs > 0` 后 cancel，2 秒内 cancelled/reaped/released，且没有 completed snapshot。

Fake-worker process-tree tests 保持不变；真实 CUDA cancellation 只证明 GPU-loaded worker 与既有取消机制兼容。

## Evidence And Privacy

Canonical local root：

```text
.trellis/tasks/08-04-native-asr-ctranslate2-cuda-development/research/local/
```

`.gitignore` 使用 `/**/08-04-.../research/local/` 同时覆盖 active/archive。下列内容只存在于 local root：

- CUDA build、dependency archives/extraction；
- model aliases、private audio/slices；
- raw request/events/transcripts/timings；
- absolute paths 和 module inventories。

Tracked outputs限于 input lock、stdlib validator/publisher、sanitized aggregate JSON/report、commands、hashes、root roles、limitations 和唯一 development result。

## Failure And Rollback

- CUDA code/build failure：记录 `development-gpu-unavailable`，保留 CPU presets 和 T08 CPU fallback。
- CUDA valid but no 20% speedup：记录 `development-gpu-no-speedup`，不继续 CUDA quality iteration。
- Subtitle quality failure：不 rollback GPU；交给 T08 算法工作。
- Regression：revert T07 CUDA option/config/device plumbing；CPU worker、protocol、host 和 Python legacy 无迁移需求。
- 所有 CUDA build/runtime/model/raw artifacts 可通过删除 ignored local root 清理。

## Design Decisions

- **D1:** 一个 CUDA-enabled worker 同时跑 paired CPU/GPU，避免二进制和源码差异污染性能结论。
- **D2:** CUDA 固定 `FLOAT16/device 0`，CPU 保持 `INT8/device 0`；T07 不做 compute-type search。
- **D3:** Primary identity 采用上游实际 Windows build 形状 `WITH_CUDNN=OFF`；避免无必要的 652 MB 下载和系统级安装。
- **D4:** `20%` paired warmed median speedup 是开发设备门槛；`RTF <=0.5` 留给 T15。
- **D5:** 字幕质量与开发设备选择正交；GPU ready 后质量失败继续使用 GPU。
- **D6:** GPU attestation 依赖 explicit model construction + completed generate + loaded modules，不信任 device string。
