# T07 - 开发用 CTranslate2 CUDA 执行

## Goal

在 T06 已完成的 `hikaru-asr-worker`、CTranslate2 Whisper backend、protocol v1 和 Tauri native host 基础上，建立 Windows x64 ignored-local CUDA 开发通道，使 T08 及后续 CTranslate2 字幕质量迭代优先使用 GPU，避免反复运行 CPU 长音频推理。

本任务只证明开发机上的真实 GPU 执行和相对 CPU 的可复现加速，不承担正式 GPU pack、下载器、设备资格矩阵或发布切换。

## Background

- 父任务：`.trellis/tasks/07-25-native-asr-migration/`。
- T06 已实现普通 faster-whisper 的生产形态 worker，并固定 CTranslate2 `4.8.0` commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698`、protocol v1、timestamp/no-history/beam-1 baseline、模型和 benchmark evidence 边界。
- Protocol v1 已允许 CTranslate2 route 使用 `device: "cpu" | "cuda"`，但当前 worker 在 `native-asr/src/main.cpp` 中拒绝非 CPU 请求，backend 在 `native-asr/src/ctranslate2_whisper.cpp` 中固定使用 `Device::CPU` 与 `ComputeType::INT8`。
- 当前 CMake 强制 `WITH_CUDA=OFF` / `WITH_CUDNN=OFF`。上游 CTranslate2 4.8.0 Windows 构建脚本安装 CUDA 12.8 与 cuDNN 9.10.2，但实际以 `WITH_CUDA=ON`、`WITH_CUDNN=OFF`、dynamic loading 构建；cuDNN 不是最小 CUDA backend 的前置条件。
- 当前开发机为 NVIDIA GeForce RTX 3070（8 GiB、compute capability 8.6），驱动 `596.49`，已安装 CUDA Toolkit `12.8.93`；T07 首选复用该 toolkit，并明确记录 cuDNN 9.10.2 已审查但不下载、不安装、不链接。
- `.asr-benchmark`、large-v3 pinned model 和 T06 CPU evidence 均在本机可用，但原始音频、模型、转录和运行证据不得进入 Git。

## Implementation Result

- Final development result: `development-gpu-ready` on NVIDIA GeForce RTX 3070, device 0, compute capability `8.6`, driver `596.49`, CUDA Toolkit `12.8.93`, CTranslate2 `4.8.0`, `WITH_CUDNN=OFF`.
- short-v1 warmed median inference RTF: CPU `0.577901`, GPU `0.062971`, ratio `0.1090`.
- medium-v1 first-120s warmed median inference RTF: CPU `0.591635`, GPU `0.077707`, ratio `0.1313`.
- Both samples exceed the required `20%` speedup and independently satisfy the future diagnostic `GPU RTF <=0.5`; neither fact is a product qualification.
- Actual CUDA-only modules were `nvcuda.dll`, `cublas64_12.dll`, and `cublasLt64_12.dll`; no `cudnn*.dll` loaded. T08 therefore uses this GPU lane for repeated quality iteration even when CER/gap/segmentation/timeline gates fail.

## Requirements

### R1 - Scope And Runtime Identity

- 首期只支持当前 Windows x64 开发机的 NVIDIA CUDA 路径。
- 复用 T06 的 CTranslate2 `4.8.0` 源码、Whisper backend、tokenizer、模型、算法配置和 protocol v1；不得创建第二套 worker、协议或 CUDA 专用算法。
- CUDA/toolchain 输入必须在实现前固定版本、来源、大小或哈希，并记录 GPU、驱动、compute capability、编译器和实际加载模块。首选 build identity 固定 `WITH_CUDNN=OFF`，且 measured module set 不得加载 `cudnn*.dll`；只有 CUDA 无法执行或无性能收益且根因明确指向卷积实现时，才允许另开 cuDNN build identity。
- 所有下载、解压、构建、模型和 raw evidence 只允许位于任务本地或既有 ignored root；任务必须先补齐 active/archive 两种任务路径的 ignore 规则。

### R2 - Device Resolution

- Worker 必须接受 protocol v1 的 resolved `device="cuda"`，并将同一 resolved device 写入 `ready` event。
- CTranslate2 backend 的设备和 compute type 必须由结构化配置决定，不得继续硬编码 CPU，也不得通过环境变量或可执行文件名猜测设备。
- CUDA 路径必须使用实际 GPU device 0，并选择 CTranslate2 在 RTX 3070 上支持的 GPU compute type；CPU 路径行为和现有默认保持不变。
- 请求 CUDA 但 runtime、设备或所需模块不可用时必须在 `ready` 前结构化失败，不得静默回退 CPU。

### R3 - Development-Only Boundary

- 不修改生产默认、模型列表、设置 UI、runtime downloader、installer、portable ZIP、trusted runtime manifest 或 Release 路由。
- 不把开发 CUDA runtime 声明为可发布 artifact，也不实现 T14/T15 的 capability routing、pack rollback 或完整七模型资格矩阵。
- Tauri 只通过既有 model-backed test seam 验证 worker/host 兼容；不得让 Release/product code 读取新的本机 CUDA 路径或测试环境变量。

### R4 - Correctness And Lifecycle

- CUDA worker 必须保持 stdout JSONL-only、stderr 诊断边界、单任务 host、取消/进程树清理、异常退出和 recovery 合同。
- `ready.device` 必须与请求和实际执行一致；CPU 执行冒充 CUDA必须 fail closed。
- 同一模型、算法、音频下允许浮点导致的文本差异，但 protocol timeline 必须合法，任务必须成功到达 terminal event。
- CER、confirmed gaps、字幕分段和时间戳质量只作为后续算法诊断；它们不得决定开发设备回退。

### R5 - Performance Comparison

- 使用同一 worker source、同一 large-v3 model、同一算法配置和同一音频做 paired CPU/GPU warmed comparison。
- 至少运行 authoritative short-v1，以及一个时长不超过 120 秒、足以代表重复迭代成本的诊断样本；样本身份和生成方式必须固定且保持私有。
- 记录每次 inference、feature/generate 时间、wall time、RTF、GPU/CPU identity、loaded modules 和 requested/resolved device。
- short-v1 与不超过 120 秒诊断样本分别使用 `1 cold + 3 warm` CPU 和 `1 cold + 3 warm` GPU；以各自 3 次 warmed inference RTF median 比较，避免用单次冷启动或测量噪声决定设备。
- 两个样本的 GPU warmed median RTF 都必须不高于对应 CPU median 的 `80%`（至少快 `20%`），才可判定为可复现性能收益。
- `RTF <=0.5` 只作为未来 T15 发布门槛的诊断字段；即使未达到 `0.5`，只要两个样本均达到至少 `20%` 加速，开发质量迭代继续使用 GPU。

### R6 - Development Result

任务必须只发布下列一个开发结论：

- `development-gpu-ready`：实际 CUDA 执行已证明，且 short-v1 与不超过 120 秒诊断样本的 GPU warmed median RTF 均不高于 paired CPU median 的 `80%`；T08 后续质量迭代使用 GPU。
- `development-gpu-unavailable`：validated failure envelope 证明当前声明机器在 pinned identity 下无法 configure/build，或 CUDA worker 无法加载 runtime/device/model 并在 ready 前结构化失败；T08 可回退 CPU。
- `development-gpu-no-speedup`：CUDA 已完成 attested generation，但任一 paired sample 没有达到至少 `20%` 的可复现性能收益；T08 可回退 CPU。

字幕质量失败不得产生后两种结论。普通 evidence 缺失、identity drift、publisher validation failure 或不完整运行既不等同于 GPU unavailable，也不得发布任何 development result。

### R7 - Evidence And Privacy

- Tracked evidence 只记录版本、哈希、聚合性能、设备/模块身份、命令和限制，不记录字幕正文、绝对用户路径、模型权重或私有 WAV/ASS 内容。
- Raw request/event/transcript、benchmark result、构建产物和本机 runtime 均保留在 canonical ignored root。
- Evidence validator 必须拒绝 CPU 冒充 CUDA、模块路径漂移、模型/config/worker 身份漂移和 raw output 越界。CPU/GPU paired rows 共享 worker/runner/CT2/tokenizer identity，但各自绑定独立 required module set；CUDA-only modules 不得被错误要求出现在 CPU rows。

### R8 - Regression Safety

- 现有 CPU CT2 build、protocol-only build、CTests 和 Rust host tests 必须继续通过。
- CUDA 变更不得要求普通 CI 或无 GPU 开发机安装 CUDA/cuDNN；CPU/protocol presets 必须保持可独立配置和测试。
- 不修改 Python legacy/default route。

## Acceptance Criteria

- [x] active/archive task-local `research/local/` 与 CUDA build/raw outputs 均被 Git ignore 覆盖。
- [x] 固定并记录 CUDA、cuDNN、CTranslate2、MSVC/CMake/Ninja、GPU/driver 和模型输入身份。
- [x] 新增独立 CUDA CMake preset；CPU 与 protocol-only presets 保持不依赖 CUDA。
- [x] `device="cuda"` 通过同一 worker/backend/protocol 运行，`ready.device="cuda"`，实际 loaded modules 和 GPU identity 可验证。
- [x] CUDA 缺失、设备不可用或 CPU 冒充 CUDA时在 ready 前结构化失败，不静默 CPU fallback；`development-gpu-unavailable` 只接受可复核的 configure/build failure envelope 或 structured pre-ready runtime/device/model failure。
- [x] 先在同一 CUDA-enabled binary identity 下分别完成不计入结果的 CPU 与 CUDA module-discovery completed run，从各自干净进程推导并冻结 shared、CPU-only、CUDA-only required module sets；随后再以新进程执行 paired CPU/GPU short 与不超过 120 秒诊断的完整 `1 cold + 3 warm`。两个样本的 GPU warmed median RTF 均至少比 CPU 快 `20%` 才发布 `development-gpu-ready`。
- [x] CER、gap、segmentation、timeline 质量不参与 development result；GPU ready 后即使字幕质量未过门槛仍作为 T08 开发设备。
- [x] Tauri model-backed host success、structured failure、cancel/reap 合同在 CUDA worker 上保持成立。
- [x] CUDA CTest、CPU CTest、protocol-only CTest、相关 Rust tests 和 `pnpm build` 通过。
- [x] invalid/incomplete evidence 不发布三种 development result；tracked evidence 不含私有字幕正文、模型、runtime binary、绝对用户路径或凭据。

## Out Of Scope

- 正式 CUDA/Vulkan runtime pack、下载/安装/更新/回退和许可证发布清单（T14）。
- 完整 GPU 资格矩阵、硬件/驱动支持表、CPU fallback 产品行为和 `RTF <=0.5` 发布决定（T15）。
- Kotoba 算法、旧 CT2 cache 兼容和质量修订（T08）。
- CrispASR GPU execution（T09）。
- 前端设备选择、设置迁移或生产 native route 切换。
- 全七模型、large-v2 或 long-v1 发布资格测试。
