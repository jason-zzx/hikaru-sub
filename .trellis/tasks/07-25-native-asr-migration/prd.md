# 原生 ASR 迁移

## Goal

将 Hikaru Sub 发布版的五个 ASR 引擎从 Python sidecar 迁移到独立原生 worker，使全新安装在不配置 Python、pip、PyTorch 或 NeMo 的情况下即可使用已下载模型完成原生转录，同时保持现有前端任务、字幕生成和恢复流程稳定。CPU runtime 仍是通用内置基线；所有未来 native 模型资格统一由 `native-gpu-authoritative-v1` GPU 矩阵决定，匹配同模型、同算法 identity 的 CPU route 继承 GPU disposition，不再运行独立 CPU 模型资格矩阵。

本任务是迁移父任务，只负责总需求、总体设计、子任务地图、跨子任务验收和最终集成门禁。实际实现必须由可独立规划、验证和归档的子任务承担。

## Background

- 详细技术提案位于 `.trellis/tasks/07-25-native-asr-migration/research/native-asr-technical-design.md`，是本父任务的主要技术依据。
- 当前数据流为 React -> Tauri -> Python FastAPI sidecar -> Python 引擎；React 根据 `AsrJobSnapshot` 轮询并生成正式 ASS。
- 当前五个引擎 ID 为 `faster-whisper`、`kotoba-faster-whisper`、`parakeet`、`qwen3-asr` 和 `reazonspeech-nemo`。
- 现有 portable、受管 `deps/`、模型缓存、任务取消、恢复快照和应用退出清理语义必须继续成立。
- 当前 `.trellis/spec/asr/` 和部分 Tauri 规范描述的是 Python 架构。在原生路径实际落地并验证前，它们仍是当前实现基线；对应子任务完成后再更新规范，不能提前制造规范与代码漂移。

## Evidence And Implementation Authority

冲突按以下层级解决：用户 `.asr-benchmark` WAV+ASS 真值；官方文档/稳定 API/模型卡；维护良好的社区推荐实践；同一真值上的实测选择；按具体模型 identity 冻结的 Python legacy 质量基线。`.trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json` 是后续 native 字幕质量比较的唯一 Python authority：只允许同 `logicalModelIdentity × case × python-legacy-cuda-v1` 的逐项非回退比较。归档的 `.trellis/tasks/archive/2026-08/08-19-native-asr-legacy-quality-reevaluation/research/evidence/native-asr-legacy-quality-reevaluation.json` 是当前前瞻性 native disposition authority；它只重解释冻结 evidence，不改写 T06/T08/T10/T10R/T03C 历史 artifacts。Python 不得生成或修补 reference，也不构成相对性能/资源 gate。

React/Tauri command、`AsrJobSnapshot`、取消、恢复、路径和安全合同是独立的产品兼容权威，不因算法来源层级变化而降级。

## Requirements

### R1 - 平台与交付范围

- 首期交付平台为 Windows x64。
- 主安装包和 portable 包内置可直接使用的原生 CPU runtime；CPU 是通用交付基线，但其模型资格由完全匹配的 GPU candidate 继承，记录 `qualificationSource=inherited-from-gpu`，不采集或伪造 CPU CER/S/D/I/RTF/RSS。
- `native-gpu-authoritative-v1` 是后续所有 native ASR 模型资格测试的唯一执行 profile。开发阶段可使用 T07/T09 的 pinned CUDA identity；最终发布资格仍须由 T14/T15 的精确 GPU pack identity 重跑并冻结。
- 安装包不得包含任何 ASR 模型权重或 CUDA/Vulkan runtime；正式 GPU runtime 以可选受管 pack 交付。
- T07 在 T06 production-worker seam 和 CPU 根因 checkpoint 完成后立即提供 ignored-local development CTranslate2 CUDA execution；primary identity 使用 Windows CUDA 12.8、`WITH_CUDNN=OFF` 和 RTX 3070 device 0/FP16，不把 reviewed cuDNN 9.10.2 作为必装依赖。T07 的 CPU/GPU paired speed evidence 保留为历史开发通道证明；它不再决定未来模型资格设备。所有后续 model-backed qualification 固定使用 GPU，GPU unavailable/no-result 时不回退 CPU 获取资格。
- T07 已实机发布 `development-gpu-ready`：short-v1 CPU/GPU warmed median RTF 为 `0.577901/0.062971`，locked 120s 为 `0.591635/0.077707`，GPU/CPU ratio 分别为 `0.1090/0.1313`；实际 CUDA-only modules 为 `nvcuda.dll`、`cublas64_12.dll`、`cublasLt64_12.dll`，无 cuDNN。该结果只授权 T08 开发质量迭代优先使用 GPU，不构成 T14/T15 pack 或路线资格。
- T09 在共享 CrispASR backend 稳定时同步建立 ignored-local development GPU execution，并按真实执行族分别发布 `parakeet-family` 与 `qwen3-family` 的开发设备结论；T10/T11 只消费各自执行族的结果。T09 已完成的 paired device 结果保留为历史开发证明；后续 T10/T11 或新 revision 的 model-backed qualification 固定使用 GPU，GPU unavailable/no-result 时不回退 CPU 获取资格。由于 pinned v0.8.22 无 resolved-device getter，T09 使用用户批准的外部模块/设备/配对性能/mutation 证明，仅限 ignored-local 开发；T14/T15 后续负责正式可复现 GPU pack 与资格认证。
- 普通 faster-whisper 与其他 native engine 一样，只以完整、identity-valid 的 GPU 质量和 accelerated RTF `<=0.5` 矩阵取得模型资格。完全匹配同模型、同算法的 CPU route 自动继承该 disposition；GPU 不合格、缺失或 identity drift 时，CPU 也不得获得资格。CPU inheritance 不是 CPU 实测，报告不得填充 CPU 性能或质量数值。
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

- 用户提供的 `.asr-benchmark` WAV+ASS 始终是唯一文本、speech-region 和 timeline 真值；Python 输出不能成为期望输出或缺失标注替代。只有本任务冻结、完整且 identity-bound 的 `python-legacy-cuda-v1` rows 可作为同模型同 case 的字幕质量非回退基线。
- 原生算法按官方文档、稳定 API、模型卡、当前维护良好的社区推荐实践排序选择，再以同一 ground truth 实测；不以复刻 Python 参数、分块、VAD、backfill 或私有 fork 为目标。
- 字幕质量按每个 `logicalModelIdentity × case` 在 `native-gpu-authoritative-v1` 下逐项比较：GPU native 的 CER、S/D/I、空文本、confirmed semantic speech-gap 数量/时长，以及双方 provenance eligible 时的 Qwen3 ForcedAligner 起始误差 median/P95，均不得劣于对应 Python row。不得用平均值、家族 row、不同模型、缺失 row 或不同 profile 掩盖回退。
- GPU accelerated inference RTF `<=0.5`、short cold process wall `<=120s`、CTranslate2 peak process RSS `<=6 GiB`、CrispASR peak process RSS `<=12 GiB` 及样本数/设备证据继续使用绝对门槛；不定义 VRAM gate，Python 性能/RSS 不能提供豁免。CPU 不运行模型资格样本，这些 CPU 数值保持未测。
- GPU candidate 通过后，完全匹配其 logical model、algorithm/config 和模型 identity 的 CPU route 记录 `qualificationSource=inherited-from-gpu` 并继承 disposition；不得复制 GPU 数值到 CPU 字段。CPU 编译、协议、打包、路径和非模型 smoke 仍由各自任务验证。
- 不得产生 `endMs <= startMs`、负起点、越界/逆序片段、非法 UTF-8 或 text-conservation/subtitle/protocol violation；完整矩阵、identity/hash、路径、安全、取消/恢复、隐私和许可证合同全部保持独立硬门禁。
- Qwen3 时间质量只有在 native 与 Python 两侧均为合法 ForcedAligner provenance 时参与相对比较；synthetic、mixed、unknown 或 generic engine-native 时间戳不能授权发布。
- Python baseline 缺失、失败但不可审计、identity drift 或必要 provenance 缺失时，native row 只能是 `baseline-incomplete`/`unscored`。合法且 identity-bound 的 Python structured failure 仅允许在 native 合法完成时记录相对改善，不能降低结构或非质量门槛。
- Whisper family gate 要求 `large-v2` 与 `large-v3` 各自完成 short-v1/medium-v1/long-v2、逐项不劣于自己的 Python rows，并通过全部独立硬门禁；两者同时通过后才解锁 `tiny`、`base`、`small`、`medium`、`large-v3-turbo` 的发布资格流程。非 anchor 模型无需独立 Python parity row，但仍须通过所有非质量、identity、模型就绪、协议、路径、取消/恢复、隐私和许可证证据。
- 发出取消后 2 秒内 worker 退出；异常退出后可读取最后保存的恢复快照。
- Windows setup 不超过 80 MB，portable ZIP 不超过 90 MB，解压后的 CPU ASR runtime 不超过 250 MB。
- 迁移期间保留 `python-legacy` 源码开发/诊断路径；发布包不携带 Python runtime 或 venv。
- 首个 native release 采用 quality-first qualified-subset 治理，但 ordinary faster-whisper 是 mandatory route：`large-v3` 与 `large-v2` 必须分别完成 short-v1 / medium-v1 / long-v2、逐项不劣于各自 Python rows，并通过独立硬门禁。T18 可以发布非空 subset，但不得省略该 mandatory route。
- 当前 archived legacy-relative authority 下没有 subtitle-quality qualified native candidate：large-v3 Candidate A 与 Kotoba K2 为 `stop-revise`；Parakeet P1、ReazonSpeech R2、Qwen T03C 的 observed disposition 也为 `stop-revise`，且后三者在 T12 mapping 冻结前 identity-aware 为 `baseline-incomplete`。Production/default 继续使用 Python legacy。
- T06R 已以 truthful `stop-revise / non-qualified` handoff 收口：beam/history、exact Silero V6 与 exact upstream fallback 三个 model-backed scope 均为 `no-candidate-selected`，后续 80-mel parity probe 又因 large-v3 实际为 128 Mel 而在 encode 前判为 invalid evidence；未形成正式 candidate、六行矩阵或 CPU inheritance。T06D `native-asr-whisper-execution-parity-discovery` 随后确认 exact large-v3 `128 × 3000` contract，但两次 harness failure 使 A/D rows 全部失效且 B/C 未启动，最终以 `invalid-evidence` 关闭；它没有 causal attribution，也不授权后续质量候选。
- T08R 必须建立 Kotoba K3 identity，继承 K2 已审查的 bounded-stride/ownership/exact-dedup 安全合同并完成三 case legacy-relative 矩阵；不得修改 K2 历史结论、reference-match、backfill 或以 reference-based repair 获得通过。
- Kotoba 与 Qwen 只有新候选通过后才进入 pack/route qualification。Parakeet P1 与 ReazonSpeech R2 在首版保持 `visible-unavailable / omitted-current-candidate`；P2/R3 推迟到单独的用户评审决定，pending T12 mapping 不是其唯一 blocker。
- 从 T10 起及后续未归档模型任务，每个冻结模型候选都必须完成 short-v1 / medium-v1 / long-v2 全矩阵，单项质量门槛失败不截断后续音频；最终按完整矩阵标记 `qualified`、`stop-revise` 或 `unsupported-for-native-release`。不同模型 identity 独立判定，非 mandatory 模型失败不阻塞已通过的 ordinary faster-whisper。
- T17 仍展示全部现有模型；资格状态控制原生可用性、禁用状态和说明，而不是从列表隐藏。发布版不得隐藏未通过模型或为其静默回退到 Python。

### R9 - 父子任务治理

- 父任务不作为日常实现目标；required、optional、correction、baseline、reassessment 和 governance work 均由可独立验收的 child 承担，不以固定 child 数量作为完成合同。
- 每个子任务必须有可测试的验收标准、明确前置条件、验证命令和回退点。
- 父子关系只表达交付物归属；依赖顺序必须写入子任务规划，不能依赖目录顺序推断。
- PoC、任务框架、质量恢复、模型 identity、pack、分发/UI 和发布切换之间设置硬门禁。
- 子任务应逐个或按允许的并行组进入 `in_progress`，完成检查后独立归档；父任务仅在 T18 通过、所有 required children 独立归档，且每个 optional/deferred lane 都有 `qualified`、`omitted-current-candidate` 或 `unsupported-for-native-release` disposition 后完成。

## Acceptance Criteria

- [x] T06 已按历史门禁完成 `migration-handoff-stop-revise`，T07/T08 也保留各自已审查的开发证据；归档 legacy-relative 重评现前瞻性 supersede 其下游质量解释，Candidate A/K2 不再是 accepted final input，native routes 仍 disabled，production/default 仍为 Python legacy。
- [ ] 发布版全新安装无需 Python、pip、PyTorch、NeMo 或 FastAPI 即可使用已缓存模型转录。
- [ ] React 使用的 Tauri command、任务状态和 `AsrJobSnapshot` 合同保持兼容。
- [ ] Worker protocol v1、单任务管理、进程树取消、异常退出和恢复快照均有自动化覆盖。
- [ ] Qwen3 的模型就绪状态同时要求 ASR 模型与 ForcedAligner，且对齐失败不会输出伪时间轴。
- [ ] 模型 manifest、固定来源、大小、SHA-256、断点续传和多文件原子安装通过测试。
- [ ] installed 与 portable 的 runtime/model/download 路径、probe/measure/cleanup 行为通过测试。
- [x] T07 在 T08 前完成 CTranslate2 development CUDA seam，T09 在 T10/T11 前完成 CrispASR development GPU seam。T07 已记录 `development-gpu-ready`（short-v1 GPU/CPU `0.1090`，locked 120s `0.1313`）；T09 已分别发布 `parakeet-family` 与 `qwen3-family` 的 `development-gpu-ready` 结论。每个执行族只有 validated GPU unavailable envelope 或任一样本未达到 `20%` 加速时才允许匹配的下游任务开发回退 CPU；无效/不完整 evidence 不发布设备结论，CER、漏段、分段和时间戳失败不参与该决策。T09 外部设备证明不替代 T14/T15 的固定构建身份、哈希、许可证、能力探测和适用的 CPU 回退/不可用说明；只有通过正式 `RTF <=0.5` 与质量门槛的 pack 才进入发布清单。
- [x] T06R 已发布 truthful non-qualified handoff并保持 ordinary Faster-Whisper disabled、Python legacy default；[x] T06D 已以 `invalid-evidence` 关闭且没有 causal attribution 或 candidate authorization。任何未来 ordinary Faster-Whisper 质量任务都需要新的 roadmap 决策。T08R/T11 仅在各自新候选通过后进入 pack qualification；Parakeet/Reazon 当前候选保持 visible/unavailable，P2/R3 deferred。
- [ ] 运行依赖和转录 UI 不再暴露 Python/venv，旧设置可安全加载并迁移；全部现有模型仍可见，但未通过原生资格的模型有明确状态且不能静默走 Python。
- [ ] 五引擎及 Whisper 双 anchor 的 short-v1/medium-v1/long-v2 矩阵只使用 `native-gpu-authoritative-v1` GPU candidate，并按同模型同 case `python-legacy-cuda-v1` 字幕质量非回退 gate；GPU 结构/证据安全和性能资源矩阵满足冻结的绝对门槛。匹配 CPU route 只记录 `inherited-from-gpu`，无独立 CPU 模型结果，缺失或跨模型 baseline 不得授权发布。
- [ ] setup、portable 和解压 runtime 体积达到 R8 预算，安装包内模型权重为 0。
- [ ] `pnpm test`、`pnpm build`、`cargo test --manifest-path src-tauri/Cargo.toml` 和 worker CTest 全部通过。
- [ ] 第三方许可证、attribution、`THIRD_PARTY_NOTICES.md`、`AGENTS.md` 和相关 Trellis specs 与最终架构一致。
- [ ] T18 通过，所有 required children 均已独立验收归档，所有 optional/deferred lanes 均有明确 qualified/omitted/unsupported disposition，父任务完成最终跨子任务集成审查。

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
- T01 ground-truth contract、per-case coverage 与共享指标实现保持权威；历史 T02/T03 disposition 不改写。本任务新增的 model-level `python-legacy-cuda-v1` handoff supersedes 旧 short-only/non-gating Python 报告，仅前瞻性改变后续 native 字幕质量资格判定，非质量绝对门槛与安全合同不变。
- T02 已证明 CTranslate2 + oneDNN native CPU backend/runtime 可行，但当前最小 fixed-window 算法为 `stop-revise`：large-v3 short CER 略超门槛，large-v3/Kotoba 中长音频均有 confirmed speech gaps。T06 必须修订算法并重测，不能把 runtime 可执行等同于产品质量通过。
- T03/T03C archived evidence（historical manifest `e4656b82...`）保留其 runtime、ABI、grouping 与 long-v2 provenance；其旧 absolute/proceed interpretation 不再是当前下游质量 authority。归档 legacy-relative 重评将 Parakeet P1、ReazonSpeech R2、Qwen T03C 的 observed disposition 均定为 `stop-revise`，其中 T12 mapping pending 使 identity-aware status 为 `baseline-incomplete`，但不消除已观察到的质量或结构失败。
- GPU 加速不再另建后续父任务：T07/T09 已完成的 paired CPU/GPU evidence 保留为历史开发证明；所有未来 model-backed qualification 按 `native-gpu-authoritative-v1` 固定使用 GPU，GPU unavailable/no-result 时不回退 CPU 获取资格。T14 负责可复现 CUDA/Vulkan runtime packs，T15 负责最终 GPU pack 独立资格矩阵和 CPU `inherited-from-gpu` metadata。
- T04 `native-asr-worker-protocol` 与 T05 `native-asr-rust-job-host` 均已实现、检查、提交并归档；final protocol/limits、generic Rust host、active gate、recovery 和 process-tree cancellation 已成为 T06 handoff。
- T06 已完成同二进制 warmed 120s CPU 根因矩阵：no-history A/B RTF `0.842/0.916` 通过，full-history beam5 C 为 `1.321`，beam1 D 为 `0.988`。因此当前证据排除固有 CT2 CPU ceiling，确认 full-history prefill 为主回归因子，并证明 beam 5 在 full-history 配置中显著增加总成本；四格矩阵不单独证明 beam/history 交互效应。
- T06/T08 的 Candidate A、Candidate B 与 Kotoba K2 结果保留为不可变历史 provenance：Candidate A/K2 的结构、窗口、ownership、dedup、worker 和开发 GPU 证据可供新候选复用，但 archived legacy-relative 重评已将 Candidate A 与 K2 的当前 subtitle-quality disposition 都定为 `stop-revise`；Candidate B 仍为 diagnostic-only，ORT/VAD 不进入 T13。
- 当前没有 subtitle-quality qualified native candidate。T06R 已以 non-qualified handoff 关闭，T06D 也以 `invalid-evidence` 关闭；两者都没有提供 ordinary Faster-Whisper accepted input，且 T06D 不授权后续候选。任何未来 ordinary Faster-Whisper 投资都需要新的 roadmap 决策。T08R Kotoba K3、T12 CT2/GGUF/Qwen companion identity 与 T11 final publication 保持各自边界。Parakeet P1/ReazonSpeech R2 首版保持 visible/unavailable，P2/R3 deferred；Release/default 仍为 Python legacy。
