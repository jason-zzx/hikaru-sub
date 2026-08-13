# 原生 ASR 迁移

## Goal

将 Hikaru Sub 发布版的五个 ASR 引擎从 Python sidecar 迁移到独立原生 worker，使全新安装在不配置 Python、pip、PyTorch 或 NeMo 的情况下即可使用已下载模型完成原生转录，同时保持现有前端任务、字幕生成和恢复流程稳定。CPU runtime 是通用内置基线；ordinary faster-whisper 只有在 T06 证明 CPU ceiling 且后续 CUDA 路线通过加速门槛后，才允许成为明确的 GPU-required route。

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
- 主安装包和 portable 包内置可直接使用的原生 CPU runtime；CPU 是通用硬发布基线，但不再预设每个引擎都必须在 CPU 上达标。
- 安装包不得包含任何 ASR 模型权重或 CUDA/Vulkan runtime；正式 GPU runtime 以可选受管 pack 交付。
- T07 在 T06 production-worker seam 和 CPU 根因 checkpoint 完成后立即提供 ignored-local development CTranslate2 CUDA execution；primary identity 使用 Windows CUDA 12.8、`WITH_CUDNN=OFF` 和 RTX 3070 device 0/FP16，不把 reviewed cuDNN 9.10.2 作为必装依赖。是否证明 CPU ceiling 只影响发布路线是否可标记为 GPU-required，不影响开发 CUDA 通道用于加速后续字幕质量迭代。只要 short-v1 与 locked 120s sample 的 GPU warmed median RTF 均至少比同配置 CPU 快 `20%`，后续字幕质量失败不得触发回退 CPU。
- T07 已实机发布 `development-gpu-ready`：short-v1 CPU/GPU warmed median RTF 为 `0.577901/0.062971`，locked 120s 为 `0.591635/0.077707`，GPU/CPU ratio 分别为 `0.1090/0.1313`；实际 CUDA-only modules 为 `nvcuda.dll`、`cublas64_12.dll`、`cublasLt64_12.dll`，无 cuDNN。该结果只授权 T08 开发质量迭代优先使用 GPU，不构成 T14/T15 pack 或路线资格。
- T09 在共享 CrispASR backend 稳定时同步建立 ignored-local development GPU execution，并按真实执行族分别发布 `parakeet-family` 与 `qwen3-family` 的开发设备结论；T10/T11 只消费各自执行族的结果。每个执行族只有在 GPU 不可用或 short-v1/locked 120s 任一样本没有可复现的 `20%` 加速时才允许开发回退 CPU，CER、漏段、分段和时间戳问题不参与设备选择。由于 pinned v0.8.22 无 resolved-device getter，T09 使用用户批准的外部模块/设备/配对性能/mutation 证明，仅限 ignored-local 开发；T14/T15 后续负责正式可复现 GPU pack 与资格认证。
- 普通 faster-whisper 只有在 T06 同二进制诊断证明 CPU ceiling、且正式 CUDA 路线达到质量与 accelerated RTF `<=0.5` 后，才可标记为 GPU-required。无 qualified GPU 的机器必须显示 route unavailable/原因，不得启用失败 CPU route或静默回退 Python。
- 其他未达到质量、性能、稳定回退或许可证门槛的 GPU pack 标记为 `stop-revise` 并从发布清单移除，不阻塞已通过的 CPU 原生路线。
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
- ordinary faster-whisper 的 `large-v3` 默认模型和 `large-v2` 日语长音频是路线硬门槛且路线本身必须交付。T06 在归档前完成 CPU RTF 根因矩阵：CPU branch 由 T06 完成这些硬门槛；确认 CPU ceiling 时，T06 以 `gpu-required-pending` 完成 CPU handoff，并由 T14/T15 正式打包和完成同一硬门槛；若 production worker、selected CPU baseline、Candidate B reviewed stop-revise evidence、Python non-gating comparison、deterministic publishers、host/protocol tests 与 downstream handoff 完成但没有资格分支被证明，T06 可按 `migration-handoff-stop-revise` truthful handoff。无论 T06 采用哪个闭合分支，只要 production worker seam 与 CPU checkpoint 已完成，T07 都应先建立开发 CUDA 通道再进入重复 CT2 质量迭代；该开发顺序不代表 product qualification 或 GPU-required decision，未资格化的 native route 保持 disabled，Release/default 保持 Python legacy。
- CPU branch 由 T06 实测其余模型；GPU-required branch 由 T15 实测全部七模型并标记 `qualified`、`stop-revise` 或 `unsupported-for-native-release`。非默认模型失败不阻塞已通过的原生 faster-whisper。
- T17 仍展示全部现有模型；资格状态控制原生可用性、禁用状态和说明，而不是从列表隐藏。发布版不得为未通过模型静默回退到 Python。

### R9 - 父子任务治理

- 父任务不作为日常实现目标；实现工作拆为 18 个独立子任务。
- 每个子任务必须有可测试的验收标准、明确前置条件、验证命令和回退点。
- 父子关系只表达交付物归属；依赖顺序必须写入子任务规划，不能依赖目录顺序推断。
- PoC、任务框架、引擎产品化、分发/UI 和发布切换之间设置硬门禁。
- 子任务应逐个或按允许的并行组进入 `in_progress`，完成检查后独立归档。

## Acceptance Criteria

- [x] T06 已在独立审查后选择 `migration-handoff-stop-revise`：worker、Candidate A selected CPU baseline、Candidate B reviewed stop-revise evidence、Python non-gating comparison、deterministic publishers、host/protocol tests 与 downstream handoff 已完成，但 qualification 未被证明。该选择保留原始 `cpu-qualified`/`gpu-required-pending` 要求、large-v3/large-v2 hard gates、Candidate A long 的 7 个 confirmed gaps、Candidate B medium 的 1 个 confirmed gap、其余模型 `blocked-not-run`、`low-volume` 限制、native disabled 和 Python legacy/default；下一步先执行 T07 development CUDA seam，再进入 T08 的重复 CT2 质量迭代。
- [ ] 发布版全新安装无需 Python、pip、PyTorch、NeMo 或 FastAPI 即可使用已缓存模型转录。
- [ ] React 使用的 Tauri command、任务状态和 `AsrJobSnapshot` 合同保持兼容。
- [ ] Worker protocol v1、单任务管理、进程树取消、异常退出和恢复快照均有自动化覆盖。
- [ ] Qwen3 的模型就绪状态同时要求 ASR 模型与 ForcedAligner，且对齐失败不会输出伪时间轴。
- [ ] 模型 manifest、固定来源、大小、SHA-256、断点续传和多文件原子安装通过测试。
- [ ] installed 与 portable 的 runtime/model/download 路径、probe/measure/cleanup 行为通过测试。
- [x] T07 在 T08 前完成 CTranslate2 development CUDA seam，T09 在 T10/T11 前完成 CrispASR development GPU seam。T07 已记录 `development-gpu-ready`（short-v1 GPU/CPU `0.1090`，locked 120s `0.1313`）；T09 已分别发布 `parakeet-family` 与 `qwen3-family` 的 `development-gpu-ready` 结论。每个执行族只有 validated GPU unavailable envelope 或任一样本未达到 `20%` 加速时才允许匹配的下游任务开发回退 CPU；无效/不完整 evidence 不发布设备结论，CER、漏段、分段和时间戳失败不参与该决策。T09 外部设备证明不替代 T14/T15 的固定构建身份、哈希、许可证、能力探测和适用的 CPU 回退/不可用说明；只有通过正式 `RTF <=0.5` 与质量门槛的 pack 才进入发布清单。
- [ ] 运行依赖和转录 UI 不再暴露 Python/venv，旧设置可安全加载并迁移；全部现有模型仍可见，但未通过原生资格的模型有明确状态且不能静默走 Python。
- [ ] 五引擎质量、长音频覆盖、性能与资源矩阵直接对 T01 用户真值达到用户评审后冻结的绝对门槛；Python 数值只作为可选参考。
- [ ] setup、portable 和解压 runtime 体积达到 R8 预算，安装包内模型权重为 0。
- [ ] `pnpm test`、`pnpm build`、`cargo test --manifest-path src-tauri/Cargo.toml` 和 worker CTest 全部通过。
- [ ] 第三方许可证、attribution、`THIRD_PARTY_NOTICES.md`、`AGENTS.md` 和相关 Trellis specs 与最终架构一致。
- [ ] 18 个子任务均已独立验收并归档，父任务完成最终跨子任务集成审查。

## Out of Scope

- macOS、Linux 和 ARM 支持。
- 未列入 T14/T15 资格矩阵的 GPU/驱动/操作系统组合，以及在主安装包内捆绑 CUDA/Vulkan runtime。
- 多 ASR 任务并发或任务排队。
- 任意第三方自定义模型导入 UI。
- 在同一 Whisper 模型上自动切换 CTranslate2/CrispASR。
- 将原生推理库直接链接进 Tauri 主进程。
- 要求 CrispASR 输出与现有 Python 引擎逐字节一致。
- 在主安装包中捆绑任何 ASR 模型或 CUDA/Vulkan runtime。

## Planning State

- 总体 PRD、设计与实施任务地图已获评审；本轮同步新的 ground-truth 权威和 v0.4.1 实现事实。
- T01 `native-asr-benchmark-baseline`、T02 `native-asr-ctranslate2-poc` 与 T03 `native-asr-crispasr-poc` 均已完成、独立检查、提交并归档；Gate 0 的 runtime/ABI 可行性阶段关闭，算法质量风险移交 T06/T08/T10/T11。
- T01 ground-truth contract、per-case coverage 与绝对预算已获用户评审并冻结；T02/T03 模型实测直接复用该 manifest identity 和共享指标实现，不依赖 Python reference 成功。
- T02 已证明 CTranslate2 + oneDNN native CPU backend/runtime 可行，但当前最小 fixed-window 算法为 `stop-revise`：large-v3 short CER 略超门槛，large-v3/Kotoba 中长音频均有 confirmed speech gaps。T06 必须修订算法并重测，不能把 runtime 可执行等同于产品质量通过。
- T03 archived evidence（historical manifest `e4656b82...`）修正了两个 harness interpretation：Reazon GGUF 应通过 public `parakeet` session backend；Qwen 使用 pinned upstream grouping 后 short/leading/boundary timeline legal，但 medium/long grouped source segments fail closed。当前质量权威改为 T03C long-v2 supersession：Parakeet corrected CER `0.4917/0.6123/0.5962`，仍为 `stop-revise`；ReazonSpeech `0.1333/0.2857/0.2944` 且原 T03 gates 全通过，但单巨段与大量 zero-duration native words 仅支持 `proceed-with-named-risks`；Qwen short CER `0.2083` 但 ForcedAligner timing 失败，medium/long-v2 保持 validated unscored blocker，因此仍为 `stop-revise`。没有 CrispASR route 可据此直接切换 production default；当前 handoff 为 `research/t03c-crispasr-long-v2-handoff.md`。
- GPU 加速不再另建后续父任务：正常编号 T07 在 T06 production-worker/CPU diagnosis checkpoint 后立即提供 development CTranslate2 CUDA execution，优先于 T08 的重复质量迭代且不以 CPU ceiling 为激活条件；T09 同步建立 CrispASR development GPU seam，供 T10/T11 GPU-first 迭代。T14 负责可复现 CUDA/Vulkan runtime packs，T15 负责设备路由、不可用说明/CPU fallback 和 pack 独立资格矩阵。
- T04 `native-asr-worker-protocol` 与 T05 `native-asr-rust-job-host` 均已实现、检查、提交并归档；final protocol/limits、generic Rust host、active gate、recovery 和 process-tree cancellation 已成为 T06 handoff。
- T06 已完成同二进制 warmed 120s CPU 根因矩阵：no-history A/B RTF `0.842/0.916` 通过，full-history beam5 C 为 `1.321`，beam1 D 为 `0.988`。因此当前证据排除固有 CT2 CPU ceiling，确认 full-history prefill 为主回归因子，并证明 beam 5 在 full-history 配置中显著增加总成本；四格矩阵不单独证明 beam/history 交互效应。
- T06 后续 bounded short decode selection 只改变 beam size：timestamp/no-history beam 1 以 CER/RTF `0.2667/0.632` 通过，beam 5 以 `0.3583/0.811` 失败，均为 0 timeline/gap；因此未扩展 beam 3/10。独立审查修正 diagnostic-default drift 并强化 evidence identity 后，修订 lock 下的 beam-1/no-history CPU candidate 已通过 authoritative large-v3 short（CER `0.2667`、warm RTF `0.623`、cold `28.342s`、RSS `3.43 GB`、0 timeline/gap）和 medium（CER `0.1134`、RTF `0.559`、RSS `3.43 GB`、0 timeline/gap），其 historical long-v1（现已 superseded）虽通过 CER `0.2653`、RTF `0.550`、RSS `3.43 GB` 与 timeline 0，曾报告 7 个 confirmed gap `>=1500ms`；当前 T08 corrected authority 对同一 retained output 的 long-v2 重评分为 CER `0.1509`、0 semantic gaps、0 timeline errors，解除该参考错误造成的 blocker。随后唯一 Candidate B 已以 direct official ORT 1.28.0 CPU + ordinary faster-whisper 1.2.1 Silero V6 实现；最后独立审查 blocker 修复后的 final lock `e687ead6...` 绑定实际 CPU/module paths、restricted PATH roots `77f4714a...` 和 module layout `a650e185...`，并通过包含 correlated all-root rewrite 的 21 项 mutation matrix。它的 historical T06 publication 中 large-v3 short 全通过（CER `0.2667`、warm RTF `0.654`、cold `29.544s`、RSS `3.44 GB`、0 timeline/gap），medium 的 1 个旧 confirmed gap 在当前 vocalization policy 下为 excluded diagnostic；因此 Candidate B 现为 diagnostic-only，long 不再需要。ordinary seven-model qualification 仍未完成，route 保持未 qualified/未启用，ORT/VAD 不进入 T13 package input。
- T06 已完成 Candidate B reviewed `stop-revise` checkpoint 与迁移交接所需的 worker、publisher、host/protocol、Python non-gating 和 downstream handoff 材料，并已在独立复核后选择 `migration-handoff-stop-revise`；该选择不改变 ordinary faster-whisper mandatory、`low-volume` limitation 或 T13 排除 ORT/VAD 的边界。T07 development CUDA 已完成并记录 `development-gpu-ready`；T08 Kotoba K2 已成为 `accepted-kotoba-algorithm-input`。T08 corrected CT2 handoff 与 T03C corrected CrispASR handoff 共同构成当前 long-v2 backend authority；Release/default 仍为 Python legacy。
