# Productize Native ReazonSpeech NeMo

## Goal

在 Qwen3-ASR 与 Parakeet 已完成的共享 CrispASR Native 基础上，将 exact `reazon-research/reazonspeech-nemo-v2` 接入 Hikaru Sub 的生产 CPU/CUDA 转录流程，替代历史 Python/NeMo 路线，并通过真实音频功能、输出安全、生命周期、下载和 UI 验证。

## Background

- 历史 Python 路线依赖 NeMo/PyTorch，不得进入新的生产包或回退路径。
- archived Native R1/R2 的最终 disposition 为 `stop-revise`。R2 使用旧 direct session ABI 与调用方窗口策略；long-v2 第 62 次调用出现 `zero_duration_top_level_result`，没有完整有效结果。
- pinned CrispASR v0.8.32 的完整 FastConformer-RNNT CLI 按实际日语 vocabulary 进入 VAD/12 秒 bounded-slice orchestration；worker、模型 manifest、UI 与三引擎 runtime 已完成接线，owner-authorized shared-v3 dependency/default authority 已发布并授权该 engine。
- 根因调查确认 pinned CrispASR 将 pure-RNNT 非空 token 序列化为 `[t,t]`；NeMo 权威语义为 `[t,t+1)`。owner 批准仅再与同一次 parent/gap decode 实际输入 PCM support 精确求交，以移除卷积 padding 超出真实输入的部分；这不是 next-cue、VAD/slice-end 猜测或通用时间轴修补。
- 最终候选 `shared-reazonspeech-final-r1` 已通过 CPU/CUDA short-v1、medium-v1、long-v2 功能矩阵，zero-duration blocker 已解决。manifest 不再使用 `postMvpUnavailable`；其 exact CUDA bytes 已发布为 immutable shared-v3 asset，official/China 下载与默认 authority 切换验证通过，shared-v2 保留回滚。

## Requirements

1. 用户可见 logical identity 固定为 `reazon-research/reazonspeech-nemo-v2`。Native GGUF、量化和 runtime identity 保持内部实现细节；不得替换为其他 ReazonSpeech 模型或增加量化选择 UI。
2. 生产执行必须复用 pinned CrispASR 完整 CLI 路线，不恢复历史 direct C ABI、R1/R2 调用方窗口 policy、Python sidecar、venv、PyTorch、NeMo 或静默 fallback。
3. ReazonSpeech 完整 CLI 使用显式 `model + vad` roles，复用 Qwen/Parakeet 已冻结的必需 CPU Silero。该 VAD 只属于此模型完整 pipeline，不提前开放通用 Native VAD 设置、设备选择或独立产品能力。
4. 最终 artifact 固定为 upstream registry 推荐的 exact Q8_0，锁定 logical upstream revision、Native repository revision、文件 size/SHA-256、GGUF metadata、量化、Apache-2.0 attribution、redistribution authority 与已公开的转换信息；未知 converter 细节必须如实记录，不得推测，也不因缺少未公开参数启动转换研究。
5. Q8_0 必须重新通过当前完整 CLI 的 CPU/CUDA 功能、设备与输出安全验证，不能继承 R1/R2 结论；不计算字幕质量，不与 F16/Q4_K 比较，也不按 CER、语义缺口、主观质量或文件体积切换 artifact。
6. 产品只交付这一项 Native artifact。若 exact Q8_0 无法执行、无法合法再分发或持续违反结构化输出合同，则保留失败证据并返回规划；不得自动改用 F16、Q4_K 或其他模型。
7. Pure-RNNT 非空 token 使用 NeMo `[t,t+1)` encoder-cell interval，并仅与同一次 parent/gap decode 的精确实际 PCM sample support 求交；超出、无法形成正区间或 support 身份不一致时 fail closed。禁止 next-cue、display row、逻辑 VAD/slice end、比例/平均分配、参考文本、相邻合并或其他 synthetic timing。
8. 接受的 cue 必须可追溯到 upstream RNNT token/range/timestamp、上述 owner-approved exact PCM-support intersection 与完整 CLI display segmentation；除此之外的项目侧时间修复仍需新的明确批准。
9. 接入现有受管模型 manifest、resume、校验、atomic publish、离线复用、损坏修复和清理；CPU/CUDA 共用权重，权重不得进入 runtime pack、NSIS 或 portable。
10. 复用现有 Native worker、Tauri ASR job、进度、取消、恢复、ASS 原子替换、设置、ModelManager 与转录页流程。错误、取消或 partial result 不得覆盖已有字幕。
11. ReazonSpeech 必须同时取得生产 CPU 与 CUDA 支持。两种设备共享 exact 模型和算法合同，但分别验证 runtime、设备解析、真实执行、错误、取消、恢复、离线和进程清理；显式 `cpu` 不初始化 CUDA，显式 `cuda` 不回退 CPU。
12. CPU 与 CUDA 分别使用最终冻结 identity 串行完成 short-v1、medium-v1、long-v2 真实功能矩阵，单例失败也继续执行其余例。非静音用例必须完成并产生合法非空输出；纯静音允许明确空结果。输出仅验证严格 UTF-8/JSON/ASS 结构、有限且位于音频范围内的时间值、正时长、协议要求的顺序以及同次运行文本守恒。
13. 不计算或承诺 CER、语义缺口、Python parity、字幕质量排名、RTF/冷启动/RSS 性能阈值，也不使用 `qualificationSource=inherited-from-gpu`。实际耗时、资源状态和必要诊断可记录用于排障，但不据此宣称质量或性能达标；主观转录与字幕质量由用户实际试听评估。
14. CUDA 执行证明必须绑定 ReazonSpeech encoder、RNNT predictor 与 joint graph 的实际目标设备；允许 upstream 固有 host orchestration/token loop，但不得出现 graph silent fallback、partial layer offload、CPU weight/KV buffer 或 unknown compute node。DLL/module inventory 或速度提升本身不足以证明设备执行。
15. 共享 CrispASR CPU/CUDA runtime 继续保持独立 artifact identity、lock、verifier 和 root，不创建 ReazonSpeech 专属 runtime pack。新增 local candidate 必须回归 Qwen3-ASR、Parakeet 与 CT2/Kotoba 隔离。
16. CPU/CUDA、模型管理、UI、生命周期和本地打包通过后，manifest 可允许 ReazonSpeech；实际 status/download/start 仍由 embedded CPU+CUDA engine authority fail closed。共享 CUDA dependency 的远程发布/default lock 切换只在独立 owner checkpoint 授权后执行；本轮已按授权发布 exact shared-v3 并保留 shared-v2 回滚。
17. 本任务完成并归档后才进入 general Native VAD child。

## Acceptance Criteria

- [x] exact logical model、唯一最终 Q8_0 artifact、runtime 与 device identity 已冻结，并具备 source/revision/file/size/SHA、metadata、Apache-2.0 attribution、再分发依据和如实记录的已知转换信息。
- [x] pure-RNNT `[t,t+1)` + exact parent/gap PCM-support intersection 已解决 zero-duration blocker；最终输出仍严格拒绝非正、倒序或越界 cue，且不产生 partial ASS。
- [x] CUDA short/medium/long 全部以最终 identity 完成，并通过真实设备执行、结构化输出安全、进度与清理门禁；不应用 CER、语义缺口或性能阈值。
- [x] CPU 使用相同最终 model/algorithm identity 完成 short/medium/long 功能矩阵，并通过 CPU-only 设备解析、结构化输出安全、进度与清理门禁；不继承 GPU 质量标签。
- [x] 模型下载/readiness、共享 Silero 引用、离线复用、损坏/失败保护和清理合同通过；模型权重未进入共享 runtime 或应用包。
- [x] worker → host → ASS 与设置/ModelManager/TranscribeView 的 CPU/CUDA 本地候选流程通过；错误与取消保留已有字幕。
- [x] 共享 CPU/CUDA candidate lock/archive verifier 绑定 exact runtime identity；Qwen3-ASR、Parakeet、CT2/Kotoba 隔离回归通过，无跨 runtime 树 DLL 加载。
- [x] 本地 NSIS/portable 验证不要求 Python、venv、PyTorch 或 NeMo，并继续满足已有 CPU runtime 包体预算。
- [x] manifest 与 published/default shared-v3 both-device authority 共同允许 ReazonSpeech；official/China exact download readiness 已实证，shared-v2 lock/CPU archive/remote asset 保持不变作为回滚。

## Out Of Scope

- Qwen3、Parakeet、general Native VAD、Kotoba K3 的新算法或新模型工作。
- 应用版本号、CHANGELOG、installer/GitHub Release 发布、应用 artifact 上传、merge、push 或 release readiness 决策。
- 用 next-cue/slice guessing、比例/平均分配、参考文本或 Python 输出修复/评价 Native 结果；owner-approved `[t,t+1)` 与 exact decode-PCM-support intersection 除外。
- CER、语义缺口、Python parity、RTF/冷启动/RSS 阈值、字幕质量排名或用户试听结论的自动资格化。
- F16/Q4_K 量化竞赛、为减小模型或安装包体积开展源码裁剪或新 runtime 拆包。
