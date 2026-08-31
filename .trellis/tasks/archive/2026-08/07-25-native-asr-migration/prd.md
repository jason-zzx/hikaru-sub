# 原生 ASR 迁移

## Goal

尽快发布 Hikaru Sub 的首个可用 Native ASR 版本：Windows x64、内置 CPU runtime、无需 Python，仅正式启用 `faster-whisper / large-v3`。首版复用已完成的 CTranslate2 worker、Rust job host 和 Candidate A 算法路线，把模型交付、runtime 打包、设置/UI 迁移和发布切换作为当前唯一 critical path。

字幕质量相对 Python legacy 的非回退比较降为诊断和后续优化依据，不再阻塞首版。功能合法性、数据安全、任务生命周期、模型/runtime 完整性、installed/portable、许可证和无 Python 交付仍是不可降低的发布硬门禁。

本任务是迁移父任务，只维护总需求、阶段边界、子任务地图和最终集成门禁。实际实现由可独立规划、验证和归档的子任务承担。

## Native MVP Scope

首个 Native MVP 已由用户确认固定为：

- 平台：Windows x64。
- 执行设备：内置 CPU runtime；首版不交付 CUDA/Vulkan pack。
- 唯一可用路线：`faster-whisper / large-v3 / CTranslate2 / CPU`。
- 算法输入：复用归档 T06 Candidate A `selected-cpu-beam1-no-history` 的稳定 worker/算法 seam。
- 模型：按需下载并验证 exact large-v3 CT2 artifact；安装包不捆绑模型权重。
- 其他 Whisper 模型、Kotoba、Qwen3、Parakeet 和 ReazonSpeech 继续在 UI 中可见，但明确标记为 Native 暂不可用/后续支持。
- 未纳入 MVP 的模型不得隐藏、不得启动未资格路线，也不得静默回退 Python。
- 发布包不携带 Python runtime、venv、FastAPI、PyTorch、NeMo 或 Python ASR dependencies。

## Background And Authority

- React -> Tauri -> native worker 的协议、job host、取消/恢复和 CTranslate2 worker seam 已完成并归档。
- 用户 `.asr-benchmark` WAV+ASS 仍是唯一文本、speech-region 和 timeline 真值。
- `.trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/` 和后续质量重评保留为历史质量诊断 authority，不再决定 Native MVP 是否可发布。
- Candidate A 的历史质量 disposition 仍是 `stop-revise`，不得改写。按本轮 release-first 政策，它被前瞻性标记为 `mvp-eligible-with-known-quality-limitations`。
- T06R/T06D 的 non-qualified/invalid-evidence 结论保持不变；本路线不再开启新的 ordinary Whisper parity、discovery 或 candidate-acquisition 循环。
- T18 已通过集成门禁；当前产品默认使用 Native `faster-whisper / large-v3 / CPU`，Python legacy 仅保留为未打包的开发/回退源码。

## Requirements

### R1 - Stable architecture and contracts

- 原生推理继续运行在独立 `hikaru-asr-worker.exe`，不得直接 FFI 链接进 Tauri 主进程。
- React 继续负责任务轮询、`AsrSegment` 到字幕文档的转换和正式 ASS 生成。
- Tauri 继续负责任务状态、worker 生命周期、JSONL 事件解析、取消/崩溃收尾、恢复快照、模型下载、路径和 runtime 管理。
- 首版保留下列 Tauri command：`list_asr_engines`、`start_asr`、`get_asr_progress`、`cancel_asr`、`check_asr_model`、`download_asr_model`、`get_model_download_progress`。
- 保持 `pending -> running -> completed | failed | cancelled`、`AsrJobSnapshot` 和 camelCase 前端合同。
- 同一时间只允许一个活跃 ASR 推理任务。

### R2 - Worker lifecycle and functional correctness

- Protocol v1 继续支持 `ready`、`progress`、`segment`、`segmentsReplace`、`completed` 和 `error`。
- stdout 只输出 JSONL 协议；诊断只写 stderr，且不得记录字幕正文或敏感信息。
- `cancel_asr` 在 2 秒内终止 worker 进程树；异常退出保留最后一次恢复快照并产生受控错误。
- Native MVP 输出必须非空、合法 UTF-8、按时间排序、正时长且限制在音频范围内。
- invalid/reversed/out-of-bounds/zero-duration timeline、模型无法加载、任务崩溃、结果为空或文本损坏仍阻塞发布。
- T18 至少使用已缓存 large-v3 完成一次短音频和一次超过 10 分钟音频的端到端功能 smoke；质量指标可记录，但不决定 smoke 通过。

### R3 - MVP model lifecycle

- T12 首先冻结 large-v3 CT2 模型的 backend、variant、revision、文件角色、URL/source、精确大小、SHA-256、许可证和 attribution。
- 下载由 Rust 管理，支持受管 `.part`、可用时断点续传、大小/hash 校验和原子安装。
- 只有全部必需文件验证成功才标记模型 ready。
- 新下载限制在 `deps/models/ctranslate2` 与 `deps/downloads`；cleanup 必须限制在受管 `deps/`。
- 合法旧 CT2 snapshot 可复用；同名文件、Python framework cache 或不完整模型不得误报 ready。
- 其他 CT2/GGUF/Qwen companion entries 属于 post-MVP 扩展，不阻塞首版。

### R4 - Final CPU runtime package

- T13 产出首版最终 bundled CPU runtime artifact，不再只是 provisional artifact。
- 首版 artifact 只需包含 protocol、large-v3 CTranslate2 CPU inference 和 host integration 所需能力；默认不包含 CrispASR、CUDA/Vulkan 或已拒绝的 ORT/VAD candidate。
- 固定 CTranslate2、oneDNN、compiler、CMake、Ninja 和必要 runtime dependencies，生成 worker/DLL/runtime-manifest/license/SHA-256 交付物。
- End-user packaging 不运行 CMake，不下载模型。
- installed 与 portable layout 都必须验证 artifact identity、缺失/错误 DLL、path isolation 和离线已缓存模型 smoke。
- Windows setup、portable ZIP 和 unpacked CPU runtime 继续使用现有体积预算；若无法满足，T13 必须明确报告 blocker。
- T18 只消费并复核 T13 attested artifact，不因 post-MVP engine identities 再次重建首版 runtime。

### R5 - Release-first quality policy

- `python-legacy-cuda-v1` CER、S/D/I、semantic-gap、Qwen timing 和 GPU qualification 不再是 Native MVP 发布门禁。
- Candidate A 已有 short-v1、medium-v1、long-v2 指标继续作为已知质量限制和回归观察，不要求逐项不劣于 Python。
- 字幕分段细腻度、相对文本准确率和非致命 semantic gaps 可在 release notes 中说明并由 post-MVP 任务持续优化。
- 质量指标不能掩盖功能故障：空结果、非法时间轴、文本损坏、不可完成长音频或协议错误仍按 R2 阻塞发布。
- 历史 artifacts 和 disposition 不改写；新政策只改变后续 release gate。

### R6 - Runtime/settings/frontend migration

- T16 依赖 T12 + T13，不再依赖 T14/T15。
- 生产依赖状态从 Python/venv 迁移为内置 CPU runtime、MVP 模型、下载和应用缓存。
- CPU runtime 显示为内置、始终就绪且不可单独清理。
- `probe_runtime_dependencies` 只探测状态、路径和版本；递归统计继续由显式 storage measure 承担并保持 async + `spawn_blocking`。
- 旧设置静默忽略 `pythonPath` 和 `asrServicePath`；未知/非 MVP 模型映射为可见但不可运行状态，不得自动切换 Python。
- T17 移除生产 Python/venv/pip/ASR service setup UI，保持现有任务轮询、模型下载进度和 ASS 生成流程。

### R7 - Release cutover and rollback

- T18 只集成 T12、T13、T16、T17 和已归档 worker/host foundation。
- 只有 large-v3 CPU 路线在首版切换为 Native available/default；其他模型保持 visible/unavailable。
- T18 通过后发布包停止携带 Python sidecar/runtime/venv；Python legacy 源码保留一个稳定发布周期作为诊断和回退证据。
- 回退不得删除用户模型、项目、字幕或设置；可通过 per-route availability/default 恢复前一稳定包行为。
- post-MVP 模型或 GPU pack 失败不能撤销已发布的 large-v3 CPU 路线。

### R8 - Parent/child governance

- Native MVP critical path `(T12 + T13) -> T16 -> T17 -> T18` 已完成。
- `08-26-native-asr-whisper-model-expansion` 已完成并归档，七个 manifest 锁定的 Faster-Whisper CPU 模型均已进入生产路线。
- `08-30-native-asr-kotoba-integration` 已完成并归档，exact Kotoba Whisper v2.0 已接入 bundled CPU runtime、Tauri 路由和 React UX。
- Kotoba 字幕质量修订不属于本父任务；归档 K2 与 legacy-relative quality evidence 保持不变。
- Qwen3 + ForcedAligner、Parakeet/Reazon revisions、Kotoba K3 和 GPU packs 是独立、non-blocking 的后续任务，不再阻塞本父任务关闭。
- 不再创建 ordinary Whisper quality-revision、execution-parity 或 discovery task；后续接入均以功能、安全、模型/runtime 完整性和产品流程为硬门禁。
- 每个后续任务必须有明确依赖、验收、验证命令和 rollback point。
- 本父任务的交付和最终集成门禁已经完成。

## Acceptance Criteria

- [x] 全新安装在无 Python、pip、PyTorch、NeMo、FastAPI 和 venv 的环境中，可使用已缓存 large-v3 模型完成 Native CPU 转录。
- [x] large-v3 模型 identity/download/readiness/hash/atomic-install/legacy-cache/portable-path 测试通过。
- [x] 最终 CPU runtime artifact 可复现、可验证、零模型权重，并在 installed/portable layout 通过短音频和 >10 分钟音频功能 smoke。
- [x] React command、任务状态、`AsrJobSnapshot`、取消、异常退出和恢复快照合同保持兼容并有自动化覆盖。
- [x] Native MVP 输出非空、UTF-8 合法、时间有序、正时长且 audio-bounded；不存在协议或 text-conservation failure。
- [x] runtime/settings/backend 不再探测或要求 Python 3.11/venv，probe/measure/cleanup 和 managed-root 边界通过测试。
- [x] 前端已启用七个 Faster-Whisper 模型与 exact Kotoba Whisper v2.0，且无 silent Python fallback。
- [x] Candidate A 的已知 CER/S/D/I/gap 限制被记录但不作为 parity gate；历史 `stop-revise` evidence 未修改。
- [x] setup、portable 和 unpacked runtime 满足现有体积预算，安装包内模型权重为 0，许可证与 attribution 完整。
- [x] `pnpm test`、`pnpm build`、`cargo test --manifest-path src-tauri/Cargo.toml` 和 MVP worker CTest 全部通过。
- [x] T18 通过，T12/T13/T16/T17/T18 均独立验收归档，Native MVP 正式发布。
- [x] Post-MVP P1 Whisper expansion 使 `tiny/base/small/medium/large-v2/large-v3-turbo` 通过独立功能门禁并可用，且 large-v3 无回归。
- [x] Kotoba K2 已进入同一 bundled Native CPU runtime，exact 模型可下载/校验，Tauri 与前端可选择并完成短音频及 >10 分钟功能 smoke，且无 Python fallback。
- [x] Kotoba 质量修订与其余 engine/GPU lanes 已明确为独立、non-blocking 的后续工作。

## Post-MVP Expansion

本父任务内的 post-MVP P1 扩展已经完成：

1. **Faster-Whisper model expansion（已完成）**：`tiny`、`base`、`small`、`medium`、`large-v2`、`large-v3-turbo` 已进入生产 Native CPU 路线。
2. **Kotoba 产品接入（已完成）**：exact Kotoba Whisper v2.0 已进入 bundled CPU runtime、Tauri 路由和前端下载/选择/转录流程。

以下路线保留为独立、non-blocking 的后续任务：Qwen3 + ForcedAligner、Kotoba K3 质量修订、Parakeet/ReazonSpeech 新候选，以及 CUDA/Vulkan runtime packs。它们不再属于本父任务的完成条件，任何失败不得影响已发布的 Native CPU 路线。

## Out of Scope

- 首版 macOS、Linux、ARM 或多任务并发。
- 首版 GPU runtime、GPU 自动选择或主安装包捆绑 CUDA/Vulkan。
- 首版支持 large-v3 之外的 Native 模型。
- 任意第三方自定义模型导入 UI。
- 将原生推理库直接链接进 Tauri 主进程。
- 修改归档 benchmark/evidence 或要求 Native 输出与 Python 逐字节一致。

## Completion State

- Gate 0/1 foundation、Native MVP、模型管理、CPU runtime、Tauri/设置、前端迁移和 release cutover 均已完成并归档。
- 七个 Faster-Whisper 模型与 exact Kotoba Whisper v2.0 均已进入生产 Native CPU 路线。
- 发布包不依赖 Python sidecar，生产默认仍为 `faster-whisper / large-v3 / CPU`。
- Qwen3 + ForcedAligner、Kotoba K3、Parakeet/Reazon 和 GPU packs 已解除父任务关系或明确为独立 non-blocking 工作。
- 本父任务完成条件已满足，可以归档。
