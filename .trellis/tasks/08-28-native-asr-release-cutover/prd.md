# Qualify and cut over Native ASR MVP release

## Goal

完成 Hikaru Sub 首个 Native ASR MVP 的发布切换：让生产默认路线使用已冻结的 Windows x64 CTranslate2 CPU runtime 与精确 `faster-whisper / large-v3` 模型，发布包不再携带或依赖 Python sidecar，同时通过安装版、便携版、离线缓存模型和端到端转录门禁证明该路线可发布。

本任务是父任务 `.trellis/tasks/07-25-native-asr-migration` 的 T18。T12、T13、T16、T17 已完成并归档；本任务只整合、复核并正式启用这些合同，不重新设计模型管理器、worker、前端 availability 或字幕流程。

## Background (pre-cutover state)

- T12 已冻结 `Systran/faster-whisper-large-v3` revision `edaa852ec7e145841d8ffdb056a99866b5f0a478`，提供精确 size/SHA-256 readiness、下载、原子安装和受管缓存复用。
- T13 已冻结并跟踪 `hikaru-asr-windows-x64-cpu-v1` runtime archive；artifact 不含模型、Python、GPU、VAD、CrispASR 或 optional engine，并已提供可复现构建、license inventory 和 worker smoke 证据。
- T16 已让稳定 Tauri command family 同时支持 Native 分支；T18 切换前的生产默认 route policy 由 Python legacy 负责，且 Native 失败不会回退 Python。
- T17 已移除生产前端的 Python/venv/setup UX，并让 UI 只允许 `faster-whisper / large-v3 / auto|cpu`，其他路线保持可见但不可用。
- T18 启动时，release preparation 和 portable staging 仍复制 `src-tauri/resources/asr-service`；发布文档、运行时依赖文档、third-party notices 与 `AGENTS.md` 仍描述 Python sidecar 产品架构。
- Python legacy 源码需保留一个稳定发布周期作为诊断与回退证据，但不得继续作为发布包资源或生产默认路线。

## Requirements

### R1 - Enable one production Native route

- Release/default ASR route 必须切换为 T16 的 Native MVP 分支。
- 首版仅允许 `faster-whisper / large-v3 / CPU`；`auto` 解析为 CPU。
- Native runtime、模型 readiness、请求参数或 worker 失败时必须返回受控错误，禁止启动或回退 Python sidecar。
- 保持现有稳定 command 名称、任务快照、进度、取消、崩溃恢复、active-job gate、恢复快照和 ASS 生成合同。
- 不新增用户可见 route 开关、环境变量 release override、第二套 command family 或并行 job manager。

### R2 - Remove Python from release artifacts

- NSIS 和 portable 发布产物不得包含 `asr-service` 模板、Python 解释器、venv、Python packages、Python worker/sidecar 资源或 Python ASR 日志目录。
- 发布资源仍必须包含并校验冻结的 Native CPU runtime、runtime dependency source manifest 和必要许可证材料。
- 发布准备必须主动清理旧的生成型 `src-tauri/resources/asr-service`，避免旧工作区残留被 Tauri 的宽资源规则重新打包。
- portable staging 不得再要求或复制 `asr-service`，且继续只复制明确允许的应用资源，不复制 `deps/`、缓存、PDB、模型或构建目录。
- Python legacy 开发源码和必要的 Rust rollback/diagnostic source 可保留一个稳定发布周期；本任务不以删除整个 `asr-service/` 源码树或 legacy Rust 实现为完成条件。

### R3 - Preserve exact model and runtime integrity

- T18 只消费 T12/T13 已冻结的 manifest、lock、archive 和 verifier，不重建或替换首版 runtime identity。
- 发布前必须重新验证 runtime archive 的 size、SHA-256、闭集文件、capabilities 和许可证 inventory。
- `large-v3` 只能从 T12 认可的 direct install 或精确 legacy managed snapshot 解析；错误 revision、缺文件、错误 size/hash、partial 或越界路径均不得报告 ready。
- 安装包和 portable 中模型权重数量必须为 0；用户现有模型、partial、项目、设置、字幕和缓存不得因切换或回退被删除。

### R4 - Qualify installed and portable behavior

- 使用已缓存的精确 `large-v3`，分别对 installed-like 与 portable-like layout 完成一次短音频和一次超过 10 分钟日语音频的 Native CPU functional smoke。
- 输出必须非空、UTF-8 合法、按时间排序、每段正时长且位于音频范围内；质量/CER 只记录为诊断，不作为 parity 门禁。
- 必须复核 worker 正常完成、取消在 2 秒内退出、异常退出/恢复、active-job 释放和 missing-job 行为。
- portable 必须继续使用同目录 `.portable`、`data/`、`cache/`、`webview/` 与 `deps/`；installed 模式继续使用系统应用数据与工作缓存，但受管模型仍位于安装目录相邻 `deps/`。
- 已缓存模型的离线转录必须不访问 Python、pip、sidecar 或模型网络；模型缺失时仍走 T12 受管下载确认与进度流程。

### R5 - Keep release size and licensing within the frozen gate

- Windows setup 不得超过 80 MiB，portable ZIP 不得超过 90 MiB，解压 Native CPU runtime 不得超过 250 MiB，bundled model weights 必须为 0。
- 实际交付的 CTranslate2、oneDNN、pocketfft、tokenizer/Rust dependencies 与 Microsoft Visual C++ runtime 许可证、hash 和 attribution 必须与 T13 inventory 一致。
- Python/FastAPI/Uvicorn/PyTorch/optional engine 仅可作为未随本版分发的历史开发/可选来源说明，不得被文档误写为当前发布包依赖。
- 任一体积、许可证、artifact identity 或包内容门禁失败均阻塞 T18 完成。

### R6 - Update authoritative product and agent documentation

- 更新 README、release guide、runtime dependency guide、third-party notices、`AGENTS.md` 以及实际发生架构变化的 `.trellis/spec/{asr,tauri,frontend}` 文档。
- 文档必须把生产架构描述为 Tauri 管理独立 Native worker，首版只支持 Faster-Whisper large-v3 CPU；Python sidecar 标记为开发/历史回退源码，而非发布运行时依赖。
- 文档不得提前宣称其他 Faster-Whisper 模型、Kotoba、Qwen3、Parakeet、ReazonSpeech、VAD 或 GPU 已可用。
- 后续 P1 `08-26-native-asr-whisper-model-expansion` 仍独立负责六个 Faster-Whisper 模型，不吸收到 T18。

### R7 - Preserve rollback and repository safety

- 回退只恢复前一稳定 route/package input；不得删除用户模型、下载 partial、项目、设置、字幕或缓存。
- 不执行 GitHub Release、tag、push、merge、rebase 或任何远程/历史修改。
- 未经用户后续单独明确授权，不执行 `git commit`。
- 私有 WAV、ASS 正文、模型 bytes、绝对用户路径、API secrets 或转录正文不得写入 tracked evidence；只记录必要 hash、duration、count、状态和相对 artifact identity。

### R8 - Fix release-smoke model detection, progress, and cancellation UX

- 精确 large-v3 readiness 首次仍必须完成 size/SHA-256 校验；同一应用进程内对已验证 immutable model 的重复状态检查与 `start_asr` 预检必须复用验证结果，不得每次重新哈希 3GB 权重。
- 只缓存已精确验证的 ready 结果；受管下载成功后可直接登记其已验证发布路径。缺失/损坏结果不得长期缓存，worker 加载失败仍必须受控失败。
- Native worker 启动、模型加载和首个推理窗口尚无可计算百分比时，转录页必须显示 indeterminate 进度；收到真实 `processedMs/durationMs` 后切换为实际百分比。
- 用户点击「取消转录」后，UI 不得回退显示「检测模型」或错误归因为字幕/工作视频变化；提示只显示「已取消转录」。
- 在后端尚未返回 jobId 时取消，前端必须阻止重复启动，并在 jobId 可用后立即取消该任务、释放 active slot；真实 document-guard 变化仍保留原有独立提示。

## Acceptance Criteria

- [x] AC1: Release/default 通过稳定 ASR command family 启动 Native `faster-whisper / large-v3 / CPU`，且任何 Native 失败都不会启动或回退 Python sidecar。
- [x] AC2: 生产前端仍只允许 large-v3 CPU/auto，其他模型、引擎和 CUDA 保持可见但不可用；下载、进度、取消、恢复和 ASS 流程无回归。
- [x] AC3: NSIS 与 portable 均包含已验证的 Native CPU runtime，但不包含 `asr-service`、Python、venv、Python packages、GPU/VAD/optional-engine runtime 或模型权重。
- [x] AC4: 发布准备可清除旧 `src-tauri/resources/asr-service` 残留；portable staging 不要求或复制该目录，且不复制 `deps/`、缓存、PDB 或构建产物。
- [x] AC5: T12 large-v3 exact readiness、official/China source、原子安装、offline cached-model 和按模型隔离行为保持通过。
- [x] AC6: installed-like 和 portable-like layout 的短音频与超过 10 分钟音频 functional smoke 均通过，输出满足非空、UTF-8、顺序、正时长和 audio-bounded 门禁。
- [x] AC7: cancel `<= 2s`、crash/recovery、active-job release、missing-job 和 shutdown 行为通过；失败证据不含字幕正文或敏感信息。
- [x] AC8: setup `<= 80 MiB`、portable ZIP `<= 90 MiB`、unpacked runtime `<= 250 MiB`、bundled model weights `= 0`，实际许可证 inventory 完整一致。
- [x] AC9: README、release/runtime docs、third-party notices、`AGENTS.md` 和受影响 Trellis specs 准确描述 Native MVP 与 Python legacy source 边界。
- [x] AC10: `pnpm asr:runtime:verify`、Native worker CMake/CTest/package checks、`pnpm test`、`pnpm build`、`cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm release:local`、Trellis validation、`git diff --check` 全部通过；任何因环境无法执行的发布门禁必须保持为 blocker，而不是静默豁免。
- [x] AC11: 同一进程内重复 large-v3 检测/启动不再重复哈希模型；启动与首窗口期间显示 indeterminate 进度；取消竞态显示「取消中…」后恢复，并且最终只提示「已取消转录」，不出现错误的模型检测或 document-change 文案。

## Out of Scope

- 启用 `tiny`、`base`、`small`、`medium`、`large-v2` 或 `large-v3-turbo`。
- Kotoba K3、Qwen3 + ForcedAligner、Parakeet、ReazonSpeech、CUDA、Vulkan 或 Native VAD。
- 修改 worker inference、tokenizer、timestamp、beam/history、字幕质量算法或 protocol v1。
- 删除整个 Python legacy 开发源码、历史 benchmark 或一个稳定发布周期所需的 rollback evidence。
- 下载或打包模型权重。
- 更新应用版本号或新增特定版本的 `CHANGELOG.md` 发布条目；T18 只交付可发布的 Native cutover，具体版本与 tag 留给后续发布操作。
- 发布到 GitHub、创建 tag、推送远程或未经单独授权提交代码。
