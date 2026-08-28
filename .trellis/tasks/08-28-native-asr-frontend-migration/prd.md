# Migrate Native MVP runtime and model UX

## Goal

把 Hikaru Sub 的生产前端从 Python sidecar / venv 配置体验迁移到 T16 已提供的 Native ASR CPU runtime、引擎可用性和模型 disposition 合同，使用户看到并只能启动首版支持的 `faster-whisper / large-v3 / CPU` 路线，同时保留现有模型下载、任务轮询、取消、字幕文档保护和 ASS 生成流程。

T17 只迁移前端。T18 仍负责 Release/default Native 路由切换、安装包移除 Python/sidecar、installed/portable/offline 模型实测和发布门禁。

## Background

- T12 Native model manager、T13 bundled CPU runtime 和 T16 runtime/settings backend 已完成并归档。
- T16 保留现有 Tauri command 名称，并向 `AsrEngineInfo` / `AsrModelStatus` 添加 Native backend/device/reason/disposition metadata。
- T16 production runtime probe 已不再返回 Python 3.11 或 ASR venv，只返回 FFmpeg、内置 Native CPU runtime 和 ASR model state。
- 当前前端仍显示 Python、venv、pip、service template、sidecar 和「配置当前引擎依赖」流程，并把所有 `available: false` 解释为缺少 Python 引擎。
- 当前引擎、模型和设备下拉仍允许选择 Native MVP 不支持的路线；VAD 控件也会生成 T16 明确拒绝的 Native 请求。

## Requirements

### R1 - Remove production Python setup UX

- 从设置页移除 `AsrEngineSetupPanel` 及所有 Python 3.11、venv、pip、ASR service directory/template、重建虚拟环境和引擎依赖安装文案与操作。
- 移除仅被该 UI 使用的前端 constants、Tauri wrappers、TypeScript setup types、tests 和 legacy `AppSettings.pythonPath` / `asrServicePath` 字段。
- 移除前端 `RuntimeDependencyKind` 中的 `python311` / `asrVenv` 以及相应 label/action；内置 `nativeAsrCpu` 只展示状态，不提供下载或清理。
- Rust 端 legacy setup commands、settings 兼容输入字段、enum variants 和 Python rollback source 不属于 T17，不得在本任务删除。

### R2 - Make selectors availability-driven

- 继续以 `ASR_ENGINE_OPTIONS` 和 `ASR_ENGINE_MODELS` 为唯一前端产品列表，不新增支持模型/引擎 registry。
- 使用现有 `listAsrEngines` 和 `checkAsrModel` metadata 生成选项状态：支持项可选，`postMvpUnavailable` / `unsupported` 项保持可见但禁用，并显示简短中文原因。
- `large-v3` 保持 Faster-Whisper 默认模型；Native engine/device metadata 为 CPU 时，`auto` 与 `cpu` 可用，CUDA 保持可见但禁用并说明后续支持。
- 旧设置中的不可用 engine/model/device 必须继续显示，不得静默改写为 large-v3/CPU；用户显式选择可用路线后才保存新值。
- 引擎/模型切换或异步返回乱序时，旧请求不得覆盖当前选择的 availability 状态。

### R3 - Render model disposition accurately

- `ModelManager` 必须区分并展示 `ready`、`supportedMissing`、`postMvpUnavailable`、`unsupported` 和检测失败。
- 只有 `supportedMissing` 可显示「下载模型」并进入现有下载进度流程；`ready` 显示已就绪，deferred/unsupported 显示 backend reason 且不提供 Python 配置动作。
- 保持同一下载任务 Promise 复用、下载进度字段、诊断路径、下载完成重新检测和 imperative transcription gate。
- T17 边界期间仍兼容没有 optional Native metadata 的 legacy payload，但不得把 Native unavailable 误报为缺少 Python。

### R4 - Migrate transcription UX without changing job semantics

- `TranscribeView` 使用通用的 Native runtime/engine/model availability 文案，不再出现 sidecar 启动、Python 安装或「前往设置配置引擎依赖」引导。
- 可用性加载中、检测失败、engine/model/device unavailable、模型下载中或转录中时，开始按钮必须保持安全禁用或给出受控错误。
- 首版 Native runtime 不支持 VAD；T17 不再向用户暴露可启动的 VAD 控件，并保证 MVP 启动请求发送 `useVad: false`，但不修改跨层 request schema。
- 保持音轨提取、模型缺失确认下载、模型下载后继续转录、进度重试、取消、active task 状态、document guard、恢复快照、PlayRes 探测、ASS 生成/保存和进入翻译行为。

### R5 - Present runtime dependencies coherently

- 设置 → 运行依赖展示 FFmpeg、内置 Native ASR CPU runtime、ASR 模型、下载缓存和应用缓存等 T16 payload；不出现 Python/venv 条目或操作。
- `nativeAsrCpu` 可用时显示内置/就绪；缺失时显示应用运行时异常或需重新安装应用，不提供下载、配置或清理按钮。
- `asrModels` 缺失/需配置时继续跳转到转录设置，由现有 `ModelManager` 承担精确模型下载。
- 保持 probe 不计算磁盘占用、measure 仅由用户触发、managed storage 清理和当前视频缓存保护行为。

### R6 - Keep one availability owner and typed bridge

- Settings 与 Transcribe 共享同一套 availability 派生逻辑，避免重复的状态解释和对 large-v3 exact readiness 的不必要重复扫描。
- 所有 command 调用继续经过 `src/services/tauri.ts`，payload 使用 `src/types/index.ts` 的共享类型；不得在组件中 raw invoke 或本地 cast disposition。
- Option-level disabled support 应最小扩展现有 shadcn/Radix `select-adapter`，不新建另一套下拉组件。

### R7 - Preserve T18 boundary and rollback

- 不修改 T16 route policy，不把 Release/default 切到 Native，不删除打包 Python/sidecar 资源，不改变 Tauri command names 或 Rust job contracts。
- 不新增模型、引擎、GPU runtime、VAD backend、worker capability、模型 manifest 或下载器。
- 回退 T17 只恢复旧前端；不得删除用户模型、下载 partial、设置、项目、字幕或缓存。

## Acceptance Criteria

- [x] AC1: 设置页不再渲染 Python、venv、pip、service template/directory、重建虚拟环境或「配置当前引擎依赖」UI；对应 frontend-only files/types/wrappers/tests 无孤儿引用。
- [x] AC2: Runtime dependency UI 不包含 `python311` / `asrVenv`，`nativeAsrCpu` 只展示状态且不可下载/配置/清理，ASR model action 仍能跳转转录设置。
- [x] AC3: 所有现有 engine/model option 仍可见；Native MVP 仅允许 Faster-Whisper large-v3 与 auto/CPU，其他路线禁用并显示 T16 reason；large-v3 默认不变。
- [x] AC4: 旧设置中的 unavailable engine/model/device 保持原值和可见状态，不会在加载、检测或保存前被自动替换。
- [x] AC5: `ModelManager` 对四种 Native disposition 和检测失败显示正确状态，只有 `supportedMissing` 可下载，下载完成后变为 ready。
- [x] AC6: Transcribe 页面不再出现 sidecar/Python setup 文案；unavailable/loading/error 状态不会启动任务，Native MVP 不会发送 `useVad: true`。
- [x] AC7: 模型下载确认与进度、下载后继续转录、job polling/retry/cancel、document guard/recovery、ASS PlayRes/serialize/save 和进入翻译流程无回归。
- [x] AC8: 异步 engine/model availability 返回乱序时不会覆盖当前选择；Settings 与 Transcribe 不维护分叉的 support registry 或 payload casts。
- [x] AC9: 相关 component/service/constants tests、完整 `pnpm test` 和 `pnpm build` 通过，`git diff --check` 与 Trellis task validation 通过。
- [x] AC10: T18 route flip、package removal 和 real-model installed/portable qualification 未被吸收进本任务。

## Out of Scope

- T18 Release/default Native enablement、安装包移除 Python/sidecar、notices/release docs 和 installed/portable/offline real-model smoke。
- Rust setup command/enum/source 删除；Python legacy source 仍保留一个稳定发布周期作为 rollback/diagnostic evidence。
- Faster-Whisper `tiny/base/small/medium/large-v2/large-v3-turbo` 启用，Kotoba/Qwen3/Parakeet/ReazonSpeech 产品化或 GPU runtime。
- Native VAD 实现、worker/inference/protocol/quality/timestamp 修改。
- ASR 页面整体重设计、新设置类别、新状态 store 或新 Tauri command。
