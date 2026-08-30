# Integrate Native Kotoba ASR

## Goal

将已经完成 Native worker/K2 算法验证的 `kotoba-faster-whisper / kotoba-tech/kotoba-whisper-v2.0-faster` 接入 Hikaru Sub 当前生产 Native ASR 路线，使用户可以在现有内置 CPU runtime 中选择、下载并运行 Kotoba，同时保持现有 Faster-Whisper 路线和默认 `large-v3` 不变。

本任务以“产品接入和功能可用”为门禁，不再要求新的 Kotoba K3 字幕质量修订。归档 K2 evidence 和后续 legacy-relative `stop-revise` 结论保持不变；质量指标只作为已知限制和诊断信息，不阻塞本次接入。

## Background And Confirmed Facts

- Native worker 源码已经识别 `kotoba-faster-whisper -> ctranslate2`，并选择 `kotoba_k2_config()`、Kotoba-only preprocessor/128-Mel 校验和 `useVad=true` 受控拒绝：`native-asr/src/main.cpp:235-297`。
- 发布 CPU worker 使用 `HIKARU_ASR_MVP_CPU_RUNTIME=ON` 构建；该编译分支只允许 ordinary `faster-whisper`，所以发布产物当前会对 Kotoba 返回 `route_not_built`：`native-asr/src/main.cpp:238-252`、`scripts/build-native-asr-runtime.ps1:350-363`。
- Tauri 当前只把 `faster-whisper` 标记为可用，并在启动前拒绝其他引擎：`src-tauri/src/asr.rs:720-738`、`src-tauri/src/asr.rs:300-320`。
- 生产模型 manifest 当前只有七个 Faster-Whisper 模型；Kotoba 被 `POST_MVP_MODELS` 映射为 `postMvpUnavailable`，因此不能下载或解析为 ready：`src-tauri/src/asr_models.rs:27-38`、`src-tauri/src/asr_models.rs:555-578`、`src-tauri/resources/native-asr-models.json`。
- React 已保留 Kotoba 引擎、模型和说明常量，但实际选项由 Tauri availability 禁用；设置页、转录页和模型下载 UI 可以复用现有 Native availability/model-manager 流程：`src/constants/asr.ts`、`src/hooks/useAsrAvailability.ts`、`src/components/workflow/SettingsTranscriptionPanel.tsx`、`src/components/workflow/TranscribeView.tsx`。
- 归档 T08 已冻结并接受 K2 算法输入 `kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1`，模型 revision 为 `f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc`，要求非空 `preprocessor_config.json`、128 Mel、无 VAD，并允许精确 legacy Hugging Face snapshot 原地复用：`.trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/kotoba-k2-handoff.md`。
- 用户已明确：Kotoba 产品接入是父任务的下一项工作；本父任务不再纳入 Kotoba 字幕质量修订任务。

## Requirements

### R1 - Preserve The Existing Product Identity

- 对外继续使用 engine ID `kotoba-faster-whisper` 和 model ID `kotoba-tech/kotoba-whisper-v2.0-faster`，避免破坏已有设置值和前端常量。
- 模型下载、受管安装目录和 readiness 校验必须为含 `/` 的产品 model ID 提供安全、稳定、不可越界的存储标识；不得直接把不可信路径片段拼入受管目录。
- 用户已确认 `faster-whisper / large-v3` 继续作为新会话默认值；Kotoba 作为可选日语优化路线。启用 Kotoba 不得自动改写用户已保存的其他合法引擎/模型设置。

### R2 - Add Exact Kotoba Model Delivery

- 在受信 Native ASR manifest 中加入唯一 Kotoba 模型的 exact repository、revision、文件角色、大小、SHA-256、MIT license 和 attribution。
- 除普通 CTranslate2 文件外，Kotoba readiness 必须要求并校验非空 `preprocessor_config.json`；加载后的模型必须保持 128-Mel 合同。
- 官方源和中国大陆镜像继续从现有 source profile 派生，不增加自定义 URL。
- 支持受管 direct install，并在 exact revision/文件身份全部通过时只读复用现有 Hugging Face snapshot；不完整、错 hash、错 preprocessor 或错 Mel 的模型不得 reported ready。
- 下载继续使用现有 `.part`、断点续传、大小/hash 校验和原子安装流程；一个 Kotoba 下载失败不得影响七个已发布 Faster-Whisper 模型。

### R3 - Enable Kotoba In The Bundled CPU Runtime

- 继续使用同一个 `hikaru-asr-worker.exe`、protocol v1、CTranslate2 CPU backend 和现有 DLL 闭集，不新增第二 worker、Python sidecar、CUDA/Vulkan pack 或额外推理服务。
- 发布 CPU runtime 必须编译并允许 ordinary Faster-Whisper 与 Kotoba 两条 CT2 route；不得继续通过 MVP-only compile gate 排除 Kotoba。
- Kotoba 运行时行为复用归档 accepted K2：15 秒最大 source window、10 秒最大 applied stride、至少 5 秒 full-window overlap、latest-start ownership、exact tuple dedup、beam 5、日语、无 previous-text、无 VAD。
- Kotoba `useVad=true` 继续在 `ready` 前受控失败，不得加载 ordinary Whisper VAD 或静默改变算法。
- 现有七个 Faster-Whisper 模型的模型派生 80/128 Mel、vocabulary、timestamp fallback、取消、崩溃和恢复行为必须无回归。

### R4 - Complete Tauri Production Routing

- `list_asr_engines` 应将 Kotoba 报告为 Native CTranslate2 CPU 可用引擎，同时继续将未接入的 Qwen3、Parakeet 和 ReazonSpeech 报告为不可用。
- Native 请求校验应接受 `faster-whisper` 和 `kotoba-faster-whisper`，但仍只接受 `auto|cpu`、日语和无 VAD。
- `check_asr_model`、`download_asr_model`、下载进度、ready resolution 和 `start_asr` 必须对 Kotoba 走与 Faster-Whisper 相同的受管模型生命周期。
- 启动 Kotoba 时必须把 engine、resolved model path、CPU device 和现有 ASS output/recovery contract 传给 worker；不得 silent Python fallback。
- 取消、异常退出、单活跃任务 gate、恢复快照和应用退出清理必须覆盖 Kotoba route。

### R5 - Synchronize The React Frontend

- 设置页和转录页中 `kotoba-faster-whisper` 应从“后续版本支持”变为可选择的 Native CPU 引擎。
- Kotoba 唯一模型应显示 exact readiness：未下载时可触发下载，下载中显示进度，ready 后可以启动转录，校验失败时显示受控错误。
- 设备仍只允许 `自动`/`CPU`；CUDA 继续禁用并标记后续支持。
- 保留当前 engine/model availability 单一数据源和 `ModelManager` 流程，不增加前端硬编码的第二套可用性状态。
- 用户选择 Kotoba 后刷新、离开页面或重启应用，合法设置应保持；不可用旧值不得被无提示改写为其他引擎。
- 用户可见文案使用简体中文，并明确 Kotoba 是日语优化模型；不得宣称完成新的质量修订或优于 Faster-Whisper/Python legacy。

### R6 - Functional And Packaging Gates

- 本次验收以功能、时间轴合法性、路径/模型/runtime 完整性和产品流程为门禁，不新增 CER parity 或 K3 quality gate。
- 使用 exact Kotoba 模型完成至少一条短日语音频和一条超过 10 分钟日语音频的 bundled CPU runtime 端到端 smoke。
- 输出必须非空、UTF-8 合法、时间有序、正时长、audio-bounded，并成功写入现有转录 ASS 目标。
- installed 和 portable 产物均需验证 Kotoba 下载/readiness、离线已缓存模型、worker 启动、取消和错误收尾。
- runtime manifest、哈希、版本和第三方 notices/license 必须随新的 worker artifact 同步；安装包仍不得捆绑模型权重或 Python 依赖。

## Acceptance Criteria

- [ ] 发布 CPU worker 接受 `kotoba-faster-whisper / ctranslate2 / auto|cpu`，且不再返回 `route_not_built`。
- [ ] exact Kotoba manifest/readiness/download/legacy snapshot reuse 通过测试，缺少或损坏 `preprocessor_config.json`、错误 hash、错误 revision 和错误模型目录均 fail closed。
- [ ] Tauri 将 Kotoba 引擎和模型报告为可用或待下载，并可通过现有 command 链启动、轮询、取消和恢复 Kotoba 任务。
- [ ] 设置页和转录页允许选择 Kotoba、下载模型并开始转录；Qwen3、Parakeet、ReazonSpeech 和 CUDA 仍保持不可用。
- [ ] Kotoba 短音频和 >10 分钟 CPU smoke 均完成，输出非空、合法 UTF-8、按时间排序、正时长且 audio-bounded，并生成有效 ASS。
- [ ] Faster-Whisper 七个已发布模型、large-v3 默认值、模型下载、取消/崩溃/恢复和 installed/portable 行为无回归。
- [ ] 发布产物包含更新后的 worker/runtime identity 与 Kotoba license/attribution，模型权重和 Python runtime 捆绑量仍为 0。
- [ ] `pnpm test`、`pnpm build`、`cargo test --manifest-path src-tauri/Cargo.toml`、Native worker CTest 和相关 model-backed smoke 全部通过；无法在本机执行的模型 smoke 必须明确记录环境原因。
- [ ] 归档 K2 与 legacy-relative quality evidence 不被改写；本任务没有 K3、CER parity 或字幕质量修订验收项。

## Out Of Scope

- Kotoba K3 或其他字幕质量修订候选。
- 以 Python legacy 为基准的 CER/S/D/I parity gate。
- Kotoba VAD、CUDA/Vulkan runtime pack 或 GPU 自动选择。
- 将 Kotoba 改为默认 ASR 引擎。
- Qwen3、Parakeet、ReazonSpeech 或自定义模型导入。
- 修改归档 T08/K2 evidence 或历史 `stop-revise` disposition。
