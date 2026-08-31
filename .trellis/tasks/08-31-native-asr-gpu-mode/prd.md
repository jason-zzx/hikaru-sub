# Integrate Native ASR GPU mode

## Goal

为 Hikaru Sub 增加可发布、可验证的 Windows x64 Native CTranslate2 CUDA 模式，让具备兼容 NVIDIA GPU 的用户通过现有独立 Native ASR worker 完成 GPU 转录，同时保留已发布的 Native CPU 路线，并且任何失败都不得回退到 Python sidecar。

## Background

- 当前生产 ASR 使用随包提供的 Windows x64 Native CTranslate2 CPU runtime，支持七个 Faster-Whisper 模型和 exact `kotoba-tech/kotoba-whisper-v2.0-faster`；生产请求目前仅接受 `auto|cpu`。
- Protocol v1、C++ worker/backend 和 Rust host 已具有 `cuda` 通道。既有 T07/T08/T20 子任务在 RTX 3070 / SM 8.6 上完成过真实 CUDA device 0 转录、取消、恢复、结构化失败和性能测量。
- T07 ordinary Faster-Whisper large-v3 GPU warmed median RTF 为 `0.062971`（short-v1）和 `0.077707`（medium-v1 前 120 秒），相对同 binary 的 CPU 路线有显著加速。
- T08 使用同一 CUDA lane 完成 Kotoba short/medium/long-v2 转录；K2 算法矩阵已被接受为后续实现输入。
- 这些证据是单机开发证据，不是可直接发布的 GPU runtime pack。旧 CUDA 运行依赖来自受限 PATH 中的已安装 CUDA Toolkit；实际 CUDA-only 模块为 `nvcuda.dll`、`cublas64_12.dll`、`cublasLt64_12.dll`，未使用 cuDNN。
- 官方资料与 pinned CTranslate2 4.8.0 源码支持用一个多架构 runtime 覆盖 GTX 10 / RTX 20 / RTX 30 / RTX 40 / RTX 50；Pascal GTX 10 需要 `INT8_FLOAT32`，RTX 路线使用 `FLOAT16`。

## Requirements

### R1 - Reuse the existing Native architecture

- 复用现有 `hikaru-asr-worker`、CTranslate2 backend、protocol v1、`NativeAsrHost`、模型 manifest/cache、转录 job、取消、恢复和 ASS 流程。
- 不创建第二套协议、推理服务、CUDA 专用字幕算法或 Python fallback。
- CPU 继续使用现有锁定 runtime；GPU 使用独立、可验证的 CUDA runtime identity，不能削弱 CPU artifact 的闭集校验。

### R2 - Truthful device resolution and execution

- Tauri 将用户请求的 `auto|cpu|cuda` 解析为具体 runtime 和 `cpu|cuda` 后再启动 worker；worker protocol 不接收 `auto`。
- `auto` 仅在 CUDA pack 已安装且 GPU 预检通过时优先 CUDA，否则使用 CPU。运行前 CUDA 失效时可回退 CPU并提示一次；任务已在 GPU 上启动后失败不自动重跑。
- 显式 `cuda` 缺少 pack 时提示下载；任何 CUDA 预检或运行失败都明确报错且不回退 CPU。
- `ready.device` 必须与请求、解析结果和实际 backend 一致。任何失败不得冒充 CPU/GPU，也不得启动 Python。

### R3 - Managed CUDA runtime pack

- CUDA runtime 作为独立受管 pack 按需下载，不进入主安装包，也不要求用户安装完整 CUDA Toolkit。
- pack 必须有独立 lock/manifest，固定 artifact、构建输入、工具链、CTranslate2/CUDA 版本、文件哈希、PE/import/动态模块闭集、来源、许可证、禁止内容和独立体积预算。
- 最终 artifact 需要两份独立干净构建的字节一致性证明、受限 DLL 搜索路径验证和缺失/篡改 mutation tests。
- pack 只包含最终闭集需要的 NVIDIA 可再分发文件；`nvcuda.dll` 由系统 NVIDIA 驱动提供，cuDNN 保持关闭，动态 CUDART 仅在最终 imports/modules 证明需要时加入。
- 模型权重继续复用现有按需下载目录，不进入 CUDA pack，也不建立第二份 GPU 模型缓存。

### R4 - Hardware and compute policy

- 首版目标覆盖常见桌面 GPU：GTX 10、RTX 20、RTX 30、RTX 40、RTX 50。
- 最终 CTranslate2 DLL 必须包含明确锁定的 native SASS：`sm_61`、`sm_75`、`sm_86`、`sm_89`、`sm_120`；可额外包含锁定的 `compute_120` PTX，但 PTX 不扩大产品支持声明。
- device 0 capability 映射固定为：CC 6.1 → `INT8_FLOAT32`；CC 7.5 / 8.6 / 8.9 / 12.0 → `FLOAT16`；其他 capability 在首版 fail closed。
- 本机 RTX 3070 / SM 8.6 必须在最终 artifact SHA 上完成真实模型矩阵。GTX 10、RTX 20、RTX 40、RTX 50 允许以官方能力、编译成功、fatbin 检查和纯策略测试形成“理论兼容”，不要求本任务取得对应实机通过证据。
- UI、文档和发布证据必须区分“RTX 3070 实测”与“其他系列理论兼容”，不得将未实测架构表述为已验证。
- 架构兼容不等于所有模型都能装入显存；显存不足或 CUDA model load failure 必须作为独立、可诊断的任务错误。

### R5 - Capability and UX

- 后端返回权威设备能力；前端沿用现有设备选择控件，只启用当前机器实际可用的 CUDA，并保留已保存但当前不可用的选择值及明确原因。
- 用户必须能区分至少以下状态：CUDA pack 未安装/损坏、无 NVIDIA GPU、驱动不兼容、compute capability 不支持、显存/模型加载失败，以及 CPU 路线仍可用。
- 设置页提供 CUDA pack 下载、修复、占用计算和清理。
- 转录页显式选择 CUDA 且缺包时，先确认并显示下载进度，完成后自动继续本次转录；`auto` 不主动下载 CUDA pack，未安装时直接走 CPU。
- probe 不递归扫盘；measure/cleanup 继续使用异步 `spawn_blocking` 并限制在受管目标内。

### R6 - Model and lifecycle compatibility

- CUDA 覆盖当前全部七个 Faster-Whisper 模型与 exact Kotoba，共用现有模型 manifest/cache，不增加 per-model CUDA 支持字段。
- VAD、CrispASR、Qwen3、Parakeet、ReazonSpeech 和 Vulkan 不因本任务启用。
- 所有八个模型必须在最终 CUDA artifact identity 上通过功能、协议、时间线、取消、恢复、离线和无 Python/网络 fallback 验证；`large-v2` 与 Kotoba 保留各自超过 10 分钟的 long gate。
- 既有 GPU 转录证据只作为实现与回归参考；新 worker/runtime 字节必须重新获取与最终 SHA-256 绑定的正式证据。

### R7 - CPU safety and rollback

- GPU 功能不能破坏、替换或撤销已发布的 CPU runtime、CPU 模型支持和默认可恢复路径。
- GPU pack 缺失、损坏、不兼容或更新失败时，CPU 路线必须仍可独立启动、校验和打包；失败更新保留上一份已验证 CUDA pack。
- 发布或回滚 GPU 增量不修改模型权重，也不恢复 Python sidecar。

## Key Product Decisions

- CUDA runtime 使用独立受管 pack 按需下载，不进入主安装包。
- `auto` 仅做运行前 CUDA 优先与 CPU 回退；显式 `cuda` 从不回退 CPU；GPU 已启动后的失败不自动重跑。
- CUDA 覆盖全部八个现有 Native CTranslate2 模型。
- 设置页与转录页都提供 CUDA pack 获取入口；`auto` 不触发自动下载。
- 首版覆盖 GTX 10 与 RTX 20/30/40/50；仅 RTX 3070 要求真实实机矩阵，其他系列明确标记为理论兼容。
- device 0-only 和固定 capability→compute mapping 为首版约束；不增加多 GPU 选择或用户可选 compute type。

## Acceptance Criteria

- [ ] AC1: 最终 CUDA worker/runtime 在本机 RTX 3070 上完成真实 `device="cuda"` 转录，`ready.device="cuda"`，并通过完成、取消、恢复、进程清理和 active-slot 回归。
- [ ] AC2: 最终 CTranslate2 DLL 的 fatbin/构建锁证明包含 `sm_61/sm_75/sm_86/sm_89/sm_120`，策略测试证明 CC 6.1 使用 `INT8_FLOAT32`，CC 7.5/8.6/8.9/12.0 使用 `FLOAT16`，其他 capability fail closed。
- [ ] AC3: 最终 CUDA artifact 具有独立闭集 lock/manifest、许可证清单、两次干净可复现构建、哈希/导入/动态模块/路径/禁止内容 mutation 验证。
- [ ] AC4: Tauri 按已确定策略解析 `auto|cpu|cuda`，选择正确 CPU/CUDA runtime；显式 CUDA 不回退，auto 仅在启动前回退，任何路径都永不启动 Python。
- [ ] AC5: 前端仅在后端报告当前机器 CUDA 可用时启用 CUDA，保留不可用已保存值，并显示可执行的中文原因/恢复动作；缺 pack 时可确认下载并在完成后续跑。
- [ ] AC6: 全部七个 Faster-Whisper + exact Kotoba 在最终 artifact SHA 上通过短音频矩阵；`large-v2` 与 Kotoba 通过各自超过 10 分钟门禁，输出非空、UTF-8、时间有序、正时长且不越界。
- [ ] AC7: CPU artifact 的闭集、八模型支持、安装版/portable 路径、模型缓存和离线行为无回归；CUDA pack 损坏或更新失败不影响 CPU 或上一份有效 pack。
- [ ] AC8: runtime dependency probe/prepare/measure/cleanup、source profile、NSIS/portable staging、CI/release 校验和第三方 notices 与受管 CUDA pack 一致。
- [ ] AC9: 用户文档明确：RTX 3070 为本任务实测；GTX 10、RTX 20、RTX 40、RTX 50 为基于官方架构、最终编译/fatbin和策略验证的理论兼容；显存是否足够取决于模型与具体 GPU。
- [ ] AC10: `pnpm test`、`pnpm build`、`cargo test --manifest-path src-tauri/Cargo.toml`、Native CTest/runtime verifier、最终 RTX 3070 model-backed gates 和 `git diff --check` 通过；无 GPU CI 不伪造真实 GPU gate。

## Current local artifact freeze

- CUDA 输入权威已迁移到 CUDA 12.9 Update 1：nvcc 12.9.86、静态 CUDART 12.9.79、cuBLAS 12.9.1.4、cuobjdump 12.9.82，以及仅构建使用的 cuRAND 10.3.10.19。
- 两个独立 final build root 的 156 个 CTranslate2 object 与全部 runtime binary 字节一致；两个独立完整 ZIP 也字节一致。
- 最终本地产物固定为 `571,034,856` bytes / SHA-256 `9ca8511365009794a32f14e6fcaeb5aada9e088e9186125e9f3b54db74e300b4`，unpacked `843,553,473` bytes。
- 最终本地 artifact 已通过 verifier、fatbin、受限 RTX 3070 probe、large-v3 short smoke 与 module closure。产品仍保持 `productEnablementAllowed=false`。
- 上述 artifact 已完成全部八模型短矩阵、`large-v2`/Kotoba 长门禁与禁用 PTX JIT 的 `sm_86` 实测；稳定远程 asset/source row 仍是唯一待完成的 artifact-distribution 门禁。
- 当前 tracked handoff 仍缺少绑定该最终 worker SHA 的 Rust-host 取消/恢复/reap/active-slot 实测记录；在补齐或经明确评审豁免前，不得把“仅剩远程发布”扩大为完整产品启用结论。本任务不提交或发布远程 asset，也不提前增加 source row。

## Out of Scope

- Python sidecar/runtime 恢复或 CUDA Python 路线。
- Native VAD、CrispASR、Qwen3、Parakeet、ReazonSpeech 或 Vulkan 产品化。
- 多 GPU/设备索引选择、用户可选 compute type 或非 Windows 平台 GPU 支持。
- 修改现有模型来源、模型权重格式或创建 GPU 专用模型副本。
- 将历史 ignored-local CUDA worker 直接复制为发布 artifact。
- 声称未取得实机的 GTX 10、RTX 20、RTX 40、RTX 50 已完成真实运行资格。

## Technical Notes

- 最终基线为 CUDA 12.9 Update 1 / nvcc 12.9.86 / CTranslate2 4.8.0 / `WITH_CUDA=ON` / `CUDA_DYNAMIC_LOADING=ON` / `WITH_CUDNN=OFF`；每个 CTranslate2 `.cu` translation unit 使用基于规范化相对路径的唯一锁定 `--frandom-seed`，解决 CUDA 12.8 已证明的匿名命名空间非确定性。
- NVIDIA 组件以官方固定 redistributable metadata/archive 作为构建输入；应用下载项目发布的不可变组合 pack，而不是在用户机器上拼装 Toolkit。
- Windows CUDA 12.x 绝对驱动技术下限为 `528.33`；CUDA 12.9 Update 1 artifact 的首版产品资格下限固定为 `576.57`，仅在相同最终 artifact SHA 于更低驱动分支取得模型实测证据后才可下调。
- 现有 CMake 4.1.1 `FindCUDA` 不能通过 `CUDA_ARCH_LIST` 解析 `12.0`；设计应保留 `6.1;7.5;8.6;8.9` 并通过锁定的 `CUDA_NVCC_FLAGS` 增加 `sm_120`/可选 `compute_120`，不为此引入不必要的上游源码补丁。
