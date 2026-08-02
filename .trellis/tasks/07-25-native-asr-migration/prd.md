# 原生 ASR 迁移

## Goal

将 Hikaru Sub 发布版的五个 ASR 引擎从 Python sidecar 迁移到独立原生 worker，使全新安装在不配置 Python、pip、PyTorch 或 NeMo 的情况下即可使用已下载模型完成 CPU 转录，同时保持现有前端任务、字幕生成和恢复流程稳定。

本任务是迁移父任务，只负责总需求、总体设计、子任务地图、跨子任务验收和最终集成门禁。实际实现必须由可独立规划、验证和归档的子任务承担。

## Background

- 详细技术提案位于 `.trellis/tasks/07-25-native-asr-migration/research/native-asr-technical-design.md`，是本父任务的主要技术依据。
- 当前数据流为 React -> Tauri -> Python FastAPI sidecar -> Python 引擎；React 根据 `AsrJobSnapshot` 轮询并生成正式 ASS。
- 当前五个引擎 ID 为 `faster-whisper`、`kotoba-faster-whisper`、`parakeet`、`qwen3-asr` 和 `reazonspeech-nemo`。
- 现有 portable、受管 `deps/`、模型缓存、任务取消、恢复快照和应用退出清理语义必须继续成立。
- 当前 `.trellis/spec/asr/` 和部分 Tauri 规范描述的是 Python 架构。在原生路径实际落地并验证前，它们仍是当前实现基线；对应子任务完成后再更新规范，不能提前制造规范与代码漂移。

## Evidence And Implementation Authority

冲突按以下层级解决：用户 `.asr-benchmark` WAV+ASS 真值；官方文档/稳定 API/模型卡；维护良好的社区推荐实践；同一真值上的实测选择；当前 Python 实现诊断参考。Python 不得生成或修补 reference，也不构成相对 CER/RTF gate。

React/Tauri command、`AsrJobSnapshot`、取消、恢复、路径和安全合同是独立的产品兼容权威，不因算法来源层级变化而降级。

## Requirements

### R1 - 平台与交付范围

- 首期交付平台为 Windows x64。
- 主安装包和 portable 包内置可直接使用的原生 CPU runtime；CPU 是首个原生版本的硬发布基线。
- 安装包不得包含任何 ASR 模型权重或 CUDA/Vulkan runtime；GPU runtime 以可选受管 pack 交付。
- CUDA 和 Vulkan 加速纳入本父任务的正常编号开发任务，但按 pack 独立认证和发布：未达到质量、性能、稳定回退或许可证门槛的 pack 标记为 `stop-revise` 并从发布清单移除，不阻塞已通过的 CPU 原生版。
- 首期同一时间只允许一个活跃 ASR 推理任务。

### R2 - 固定引擎路由

- `faster-whisper` 使用 CTranslate2。
- `kotoba-faster-whisper` 使用 CTranslate2；算法与解码配置依据官方模型卡、稳定 API 和 ground-truth 实测选择，Kotoba 专属 `preprocessor_config.json` 就绪规则保持产品兼容。
- `parakeet` 使用 CrispASR Parakeet JA GGUF。
- `reazonspeech-nemo` 使用 CrispASR ReazonSpeech GGUF。
- `qwen3-asr` 使用 CrispASR Qwen3-ASR 1.7B GGUF，并强制配套 Qwen3 ForcedAligner；对齐器缺失或失败时任务失败，不生成伪造时间戳。
- 首期不根据设备或性能结果动态改变同一引擎的 backend。

### R3 - 架构与职责

- 原生推理运行在独立 `hikaru-asr-worker.exe` 进程中，不直接 FFI 链接进 Tauri 主进程。
- React 继续负责引擎/模型交互、任务轮询、`AsrSegment` 到字幕文档的转换和正式 ASS 生成。
- Tauri 负责任务状态、worker 生命周期、JSONL 事件解析、取消/崩溃收尾、恢复快照、模型下载、路径和 runtime 管理。
- Worker 只负责本地音频、模型加载、VAD、推理、时间戳和最小结果归一化，不负责远程下载、ASS 样式或业务设置。
- 文件路径通过结构化 JSON 传递，不拼接 shell 命令。

### R4 - 兼容合同

首期保留下列 Tauri command 名称：

- `list_asr_engines`
- `start_asr`
- `get_asr_progress`
- `cancel_asr`
- `check_asr_model`
- `download_asr_model`
- `get_model_download_progress`

继续保持：

- 状态流转 `pending -> running -> completed | failed | cancelled`。
- `AsrJobSnapshot` 的现有字段和 camelCase 前端合同。
- 进度查询、取消、增量/替换分段、异常恢复 JSON、完成后最小 ASS 兜底和应用退出清理。
- React 正式 ASS 生成继续使用视频分辨率、现有 Script Info 和样式逻辑。

### R5 - Worker 协议与故障隔离

- Tauri 通过 stdin 发送一行版本化 JSON 请求；worker 通过 stdout 输出 JSONL 协议事件，诊断信息只写 stderr。
- Protocol v1 至少支持 `ready`、`progress`、`segment`、`segmentsReplace`、`completed` 和 `error`。
- 进度必须单调，片段必须归一化到音频范围并保持合法时间区间。
- `cancel_asr` 必须终止 worker 进程树；worker 不响应优雅取消时保留强制终止兜底。
- Worker 非零退出且未发送结构化错误时，Tauri 生成受控错误并保留最后一次恢复快照。
- 诊断日志不得记录密钥、完整敏感请求头或用户字幕正文。

### R6 - 模型生命周期

- 使用内置、版本化的模型 manifest 固定 backend、variant、revision、URL、精确大小、SHA-256、许可证和 attribution。
- 模型下载由 Rust 管理，支持 `.part`、可用时断点续传、大小与 SHA-256 校验以及原子安装。
- 多文件模型只有全部 companion 文件验证完成后才标记为就绪。
- 新下载统一进入 `deps/models/{ctranslate2,crispasr,shared}`；下载临时文件进入 `deps/downloads`。
- 有效的旧 Hugging Face CTranslate2 snapshot 可直接复用，不强制复制；旧 PyTorch/NeMo/Qwen 权重不声明为 CrispASR 可用。
- 模型与 runtime 清理必须限制在受管 `deps/` 下，不能越界删除用户文件。

### R7 - Runtime、设置与 UI 迁移

- 生产依赖状态从 Python/venv 迁移为 CPU runtime、可选 GPU runtime、模型、下载和应用缓存。
- CPU runtime 显示为内置、始终就绪且不可单独清理。
- `probe_runtime_dependencies` 只探测状态、路径和版本；递归统计继续由显式的 storage measure 承担。
- 递归统计和清理保持 async + `spawn_blocking`，并遵守 installed/portable 路径规则。
- 旧设置静默忽略 `pythonPath` 和 `asrServicePath`，保留可映射的引擎、模型和设备选择；未知模型回退到对应引擎默认值。
- 生产 UI 不再显示 Python、venv、pip 或 ASR 服务目录。

### R8 - 质量、发布与回退

- 用户提供的 `.asr-benchmark` WAV+ASS 是唯一质量真值；Python 输出只作为可选诊断/历史参考，不能作为期望输出、相对 CER/RTF gate 或缺失标注替代。
- 原生算法按官方文档、稳定 API、模型卡、当前维护良好的社区推荐实践排序选择，再以同一 ground truth 实测；不以复刻 Python 参数、分块、VAD、backfill 或私有 fork 为目标。
- T01 用户评审后冻结的绝对门槛为：每个 engine/case CER `<=0.35`；纯 CPU inference RTF `<=1.0`；CUDA/Vulkan 等 GPU 加速 inference RTF `<=0.5`；short cold process wall `<=120s`；CTranslate2 RSS `<=6 GiB`；CrispASR RSS `<=12 GiB`；不定义 VRAM gate。所有 CPU/GPU 候选必须直接对 ground truth 评估，不得凭 Python parity 宣称通过。
- 不得产生 `endMs <= startMs`、负起点或越界片段；直接对 ground truth 评估时，不得存在持续 `>=1.5s`、经参考标注确认含语音的漏段。
- Qwen3 起始时间误差中位数不高于 150 ms，P95 不高于 500 ms，且时间戳必须来自 ForcedAligner。
- Python reference 缺失或失败只减少诊断覆盖，不阻塞原生实现直接对 ground truth 的质量判断。
- 发出取消后 2 秒内 worker 退出；异常退出后可读取最后保存的恢复快照。
- Windows setup 不超过 80 MB，portable ZIP 不超过 90 MB，解压后的 CPU ASR runtime 不超过 250 MB。
- 迁移期间保留 `python-legacy` 源码开发/诊断路径；发布包不携带 Python runtime 或 venv。
- 每个引擎分别通过用户真值和产品合同门槛后才能切换；单个 CrispASR 引擎失败不阻塞已达标的 CTranslate2 路径。
- ordinary faster-whisper 的 `large-v3` 默认模型和 `large-v2` 日语长音频是 T06 硬门槛；其余现有模型全部实测并标记 `qualified`、`stop-revise` 或 `unsupported-for-native-release`，非默认模型失败不阻塞已通过的原生 faster-whisper。
- T16 仍展示全部现有模型；资格状态控制原生可用性、禁用状态和说明，而不是从列表隐藏。发布版不得为未通过模型静默回退到 Python。

### R9 - 父子任务治理

- 父任务不作为日常实现目标；实现工作拆为 17 个独立子任务。
- 每个子任务必须有可测试的验收标准、明确前置条件、验证命令和回退点。
- 父子关系只表达交付物归属；依赖顺序必须写入子任务规划，不能依赖目录顺序推断。
- PoC、任务框架、引擎产品化、分发/UI 和发布切换之间设置硬门禁。
- 子任务应逐个或按允许的并行组进入 `in_progress`，完成检查后独立归档。

## Acceptance Criteria

- [ ] 五个现有引擎均具备通过质量门槛的 Windows x64 原生 CPU 路径，并按 R2 固定路由。
- [ ] 发布版全新安装无需 Python、pip、PyTorch、NeMo 或 FastAPI 即可使用已缓存模型转录。
- [ ] React 使用的 Tauri command、任务状态和 `AsrJobSnapshot` 合同保持兼容。
- [ ] Worker protocol v1、单任务管理、进程树取消、异常退出和恢复快照均有自动化覆盖。
- [ ] Qwen3 的模型就绪状态同时要求 ASR 模型与 ForcedAligner，且对齐失败不会输出伪时间轴。
- [ ] 模型 manifest、固定来源、大小、SHA-256、断点续传和多文件原子安装通过测试。
- [ ] installed 与 portable 的 runtime/model/download 路径、probe/measure/cleanup 行为通过测试。
- [ ] CUDA/Vulkan pack 具备固定构建身份、哈希、许可证、能力探测和 CPU 回退；只有通过自身 `RTF <=0.5` 与质量门槛的 pack 才进入发布清单，未通过 pack 不阻塞 CPU 发布。
- [ ] 运行依赖和转录 UI 不再暴露 Python/venv，旧设置可安全加载并迁移；全部现有模型仍可见，但未通过原生资格的模型有明确状态且不能静默走 Python。
- [ ] 五引擎质量、长音频覆盖、性能与资源矩阵直接对 T01 用户真值达到用户评审后冻结的绝对门槛；Python 数值只作为可选参考。
- [ ] setup、portable 和解压 runtime 体积达到 R8 预算，安装包内模型权重为 0。
- [ ] `pnpm test`、`pnpm build`、`cargo test --manifest-path src-tauri/Cargo.toml` 和 worker CTest 全部通过。
- [ ] 第三方许可证、attribution、`THIRD_PARTY_NOTICES.md`、`AGENTS.md` 和相关 Trellis specs 与最终架构一致。
- [ ] 17 个子任务均已独立验收并归档，父任务完成最终跨子任务集成审查。

## Out of Scope

- macOS、Linux 和 ARM 支持。
- 未列入 T13/T14 资格矩阵的 GPU/驱动/操作系统组合，以及在主安装包内捆绑 CUDA/Vulkan runtime。
- 多 ASR 任务并发或任务排队。
- 任意第三方自定义模型导入 UI。
- 在同一 Whisper 模型上自动切换 CTranslate2/CrispASR。
- 将原生推理库直接链接进 Tauri 主进程。
- 要求 CrispASR 输出与现有 Python 引擎逐字节一致。
- 在主安装包中捆绑任何 ASR 模型或 CUDA/Vulkan runtime。

## Planning State

- 总体 PRD、设计与实施任务地图已获评审；本轮同步新的 ground-truth 权威和 v0.4.1 实现事实。
- T01 `native-asr-benchmark-baseline`、T02 `native-asr-ctranslate2-poc` 与 T03 `native-asr-crispasr-poc` 均已完成、独立检查、提交并归档；Gate 0 的 runtime/ABI 可行性阶段关闭，算法质量风险移交 T06/T07/T09/T10。
- T01 ground-truth contract、per-case coverage 与绝对预算已获用户评审并冻结；T02/T03 模型实测直接复用该 manifest identity 和共享指标实现，不依赖 Python reference 成功。
- T02 已证明 CTranslate2 + oneDNN native CPU backend/runtime 可行，但当前最小 fixed-window 算法为 `stop-revise`：large-v3 short CER 略超门槛，large-v3/Kotoba 中长音频均有 confirmed speech gaps。T06 必须修订算法并重测，不能把 runtime 可执行等同于产品质量通过。
- T03 final immutable evidence 修正了两个 harness interpretation：Reazon GGUF 应通过 public `parakeet` session backend，三 case CER/RTF/RSS/timeline/gap 冻结门槛均通过，但单巨段与大量 zero-duration native words 仅支持 `proceed-with-named-risks`；Qwen 使用 pinned upstream grouping 后 short/leading/boundary timeline legal，但 short timing 严重失败且 medium/long grouped source segments 仍 fail closed。Parakeet 与 Qwen 为 `stop-revise`；没有 T03 route 可据此直接切换 production default。
- GPU 加速不再另建后续父任务：T13 负责可复现 CUDA/Vulkan runtime packs，T14 负责设备路由、CPU 回退和 pack 独立资格矩阵；失败 pack 不阻塞 CPU cutover。
- T04 `native-asr-worker-protocol` 与 T05 `native-asr-rust-job-host` 均已实现、检查、提交并归档；final protocol/limits、generic Rust host、active gate、recovery 和 process-tree cancellation 已成为 T06 handoff。
- T06 保持 `planning`；其 manifests 已切换到最终 T04 protocol/limits、T05 durable Tauri spec 和 archived host evidence，并加入真实 worker 的 Rust host focused-test 边界。完成本次规划刷新和输入 lockability 复核后，T06 应作为下一任务启动。
