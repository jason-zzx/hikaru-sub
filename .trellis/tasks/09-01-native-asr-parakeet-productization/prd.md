# Productize Native Parakeet

## Latest owner authorization — dependency publication and ordinary builds

This authorization narrowly supersedes earlier no-upload/default-Qwen-only and
pending-review wording below; historical evidence and byte identities remain unchanged.
The owner explicitly authorized final artifacts containing the independently accepted
cwd272 worker, LF-only manifest and FFmpeg peer fixes; one **new shared Qwen+Parakeet
CUDA dependency asset** on the existing `native-asr-cuda-v1` release; verified download
metadata/default build authority; ordinary-build Parakeet enablement; and targeted
local distribution validation. Accepted reviews: `db07d83e-a4ff-4ea1-a1f8-fd785b090830/
parakeet/path-hygiene-media-review.md` and `17665840-044e-4e4c-b333-b24ae142a0fa/
parakeet/local-app-final-review.md` (external session artifacts).

Reuse existing producers/verifiers/downloader/release:local; rebuild only changed
worker CPU/CUDA bindings and app/backend bits, retaining verified unchanged full CLI,
DLLs and models. Preserve the pre-fix runnable app, old locks/assets and original
six host/two UI proofs. No full inference matrix or evidence relabeling. Model-free
closure, installation/readiness/probe, both-device engine gating, Qwen/CT2 isolation,
targeted tests and normal applicable builds are required. Any necessary inference
must first explain the smallest gap and be at most existing bounded short CPU/CUDA
smoke; larger runs/harness repairs/redesign require owner decision via supervisor.

Before remote mutation inspect safe remote/auth/release inventory and send the
supervisor destination/tag, unique new asset name/size/SHA and local verifier result.
Never replace/delete old assets or modify/create a tag/release. Verify official and
existing China-mirror downloads against exact bytes, recording availability failures
honestly without repeated network campaigns. Only after published-byte verification
may publication flags/default authority/source rows change; preserve rollback locks.
Upload no weights, raw evidence, tools, CPU bundles or app installers. No new app
release/version/CHANGELOG, Git staging/history operations, task archive or next engine.
FAST minimal delivery is a hard boundary: stop and ask on substantive blockers or
significant unplanned work. General long/expanded-relative audio paths, deep CLI roots
and cross-volume deep-work remain unsupported; RTX 3070 is the sole tested GPU.


## Goal

在已完成的 Qwen3 迁移之后，将 exact `nvidia/parakeet-tdt_ctc-0.6b-ja` 接入 Hikaru Sub 的生产 Native ASR 流程，完成 CPU/CUDA 功能交付，再进入 ReazonSpeech 子任务。

## Confirmed Facts

- 本轮已发布新的 shared-v2 CUDA 依赖（非应用发布），官方/中国镜像 bytes 一致；普通构建已改用两设备 Qwen+Parakeet authority，新本地 app 包含获独立审核的 path/media 修复，旧 app/锁/资产/证据不变。最终分发/默认启用的代码安全与需求证据两轴独立复核均通过，用户另行确认最终应用 CPU/CUDA 均可跑通；精确身份、验证及剩余限制见 implement.md。

- 用户同意沿用本任务补齐规划，并明确将验收调整为 Qwen 式完整上游集成与双设备功能验收；随后明确指令“开始实现”，本子任务已通过 `task.py start` 进入 in_progress；不包含 Git 提交或发布授权。
- **历史分发前状态（由本文件顶部新授权及 implement.md 的 shared-v2 结果取代）**：默认已发布 Qwen-only 构建通过 embedded runtime capability 将 Parakeet 判定为 unavailable。后续获准的独立本地 shared candidate 已接通真实 CPU/CUDA UI 选择、启动与最终 ASS；模型 manifest 已允许，但模型状态/下载/启动仍须经过两设备 build capability 与实际 runtime 校验，不是全局开关或运行时环境旁路。最新 capability/UI 独立审核已通过（不等于整任务或发布验收）。后续无推理补修已在源码修复 observed272 字符私有 cwd 启动与 Windows FFmpeg peer 大小写问题，manifest 仅 CRLF→LF；旧可运行 app 保持原字节、尚不含补修。补修的独立复核已通过；任意长音频/CLI root/跨卷深 workspace 限制仍保留，详见 implement.md。远程 CUDA 发布只控制下载，不是已验证本地 CUDA 使用的前提；历史 development seam 不等于生产支持。
- 共享运行时固定于 CrispASR v0.8.32（`e2a356146e36bc1cc0410edefb01990448766979`）。完整 CLI 已编译不等于 Parakeet 已接入：`native-asr/src/qwen_cli.cpp` 的 request/output/argv 与 `src-tauri/src/asr_worker.rs` 的 full-CLI 工作目录分支仍是 Qwen 专用，不能只解除可用性开关。
- 历史 T10 Parakeet medium CER 为 0.39252747252747255、语义缺口 17，long 为 validated-failed；这些是旧路线结果，不是当前完整 CLI 的验证结论，也不是本轮验收门槛。依据：`.trellis/tasks/archive/2026-08/08-13-native-asr-parakeet-reazon/08-13-native-asr-parakeet-reazon/research/t10-parakeet-reazon-report.md`。

## Requirements

### R1 — Exact identity and upstream integration

- 用户可见逻辑模型固定为 `nvidia/parakeet-tdt_ctc-0.6b-ja`，不得替换为其他 Parakeet 模型；只提供一个最终 Native artifact，不新增量化选择 UI。
- 优先直接集成固定完整上游工具链及上游/社区推荐的兼容模型产物，不裁剪源码，不开展量化竞赛或开放式 converter/对齐算法研究。历史 cstr Q8_0 不能凭旧 smoke 自动成为产品权威。
- 锁定实际模型文件、来源/revision、格式/量化、size/SHA、许可证与 CC-BY-4.0 attribution/再分发依据；记录可验证的转换出处，不编造缺失的 converter 信息。许可或来源不明时不得交付。
- 文件体积不是模型选择优先级；若现成产物不兼容或必须自建转换，先报告具体阻塞并返回规划，不自行扩大研究范围。

### R2 — Functional acceptance, not quality qualification

- CPU 与 CUDA 使用同一逻辑模型与算法，分别完成 short-v1、medium-v1、long-v2 的真实运行和最终 ASS 流程验证；不把旧失败改标签为通过。
- 验证非静音用例有合法非空输出、严格 UTF-8/结构、正时长、开始时间有序、音频范围内时间轴与同次运行输出的文本守恒；纯静音允许明确空结果。非法输出必须结构化失败且不得覆盖已有字幕。
- 不计算或承诺 CER、语义缺口、Python parity、RTF 质量/性能阈值；不使用 `qualificationSource=inherited-from-gpu`。记录真实耗时、完成状态与必要诊断用于排障，不据此宣称质量量化达标。主观转录与字幕质量由用户实际试听评估。
- 保留进度、超时、设备与资源异常排查；移除质量评分不等于允许挂起、虚假进度或静默设备回退。
- 用户明确要求恢复并直接推进迁移：不交付的外围进程/DLL 监视器退出必需验证路径，不再修复或以其采样失败阻塞集成。功能结果、生命周期结果和可选诊断完整性分别记录；已有成功转录/ASS 写出不因监视器错误失效。原始失败记录保留，不改标签冒充完整通过；P1 不变 runtime/model 的证据复用，按实际产品变更补测，不因观测脚本变化强制全量重跑。
- 用户已确认保留完整上游日语流程：上游 VAD/12 秒切片及对未覆盖实际音频的再次转录，包括上游对返回词时间与片段边界的重组；依据见 `research/planning-evidence.md`。这不是质量达标保证，也不授权应用侧自研对齐、synthetic timing、gap fill、clip/stretch 或 reference repair；Qwen 已批准的异常合并不自动授权 Parakeet 同类修改。
- 模型/runtime/算法 bytes 改变后重新验证受影响的真实功能与生命周期，不继承不匹配 identity 的结果。

### R3 — Product delivery and lifecycle

- 复用现有受管 manifest、模型下载进度、校验、断点续传、原子 readiness、离线复用、损坏修复与清理；不新增下载取消 command/UI。
- 接入 Native worker、Tauri job、取消、恢复、ASS、设置和前端可用性流程；不新增并行任务体系，不恢复生产 Python/venv/PyTorch/NeMo。
- CPU 不初始化 CUDA，显式 CUDA 缺包或失败不得回退 CPU；auto 仅在 worker 启动前选择已验证设备，已开始的 GPU 任务不得自动重跑。
- 两种设备分别验证真实执行、错误、取消、恢复与进程树清理；CUDA DLL 装载或加速表象不能替代主模型执行证据。
- 缺模型、缺 runtime、损坏、无效输出、取消或清理失败不得覆盖/清空现有字幕，不影响 CT2/Kotoba/Qwen 独立启动。错误消息不得泄露私有路径、原始转录或原始 stderr。

### R4 — Shared runtime and scope boundaries

- 复用 Qwen 已冻结的共享随包 CrispASR CPU runtime 与按需 CUDA pack，以及各自 lock/verifier/root；不得创建 Parakeet 专属 runtime pack 或跨 CT2/CrispASR 树加载 DLL。
- 模型权重独立按需下载，不进入 runtime 或安装包；保留父任务既有本地包装检查与预算合同，不为体积提前裁剪上游源码。
- 用户已确认复用现有冻结 CPU Silero 作为 Parakeet 必需依赖，纳入同一逻辑下载与 readiness；无论主模型 CPU/CUDA，VAD 始终 CPU 执行，失败须结构化失败，不静默关闭。不得新增通用 VAD 设置或改写 Qwen VAD 行为，清理 Parakeet 不得删除 Qwen 所需的共享资产。通用 VAD 仍最后实施。
- 共享 runtime bytes 变更须遵循设计中的新本地 candidate、独立 identity 与 Qwen 回归合同，不覆盖已发布锁或自动上传；引入其他 companion 或改变上游算法须返回规划。
- 本任务完成并归档后才进入 ReazonSpeech；本轮范围调整不自动改变 ReazonSpeech 的验收合同。

## Acceptance Criteria

- [x] AC1/R1: exact 日语模型与唯一实际产物有受信来源、revision、size/SHA、格式/量化及完整许可/归属记录；未以旧开发结果代替新功能证据。
- [x] AC2/R2: 最终 identity 对应的 CPU/CUDA short/medium/long 六条真实流程均成功完成，输出到 ASS 且满足协议/文本/时间轴安全；未发布质量评分或 GPU 质量继承标签。
- [x] AC3/R2/R3: 纯静音、无效输入/输出、缺失/损坏模型或 runtime、设备失败均有准确结果，不伪报成功；失败与取消不破坏已有字幕。
- [x] AC4/R3: 两种设备的执行证明、进度、取消、重新转录/恢复、离线与进程清理通过；未发生 Python 或显式 CUDA→CPU 回退。
- [x] AC5/R3/R4: 模型下载、续传、校验、原子 readiness、修复、清理与前端选择/启动完整接通；覆盖 ASR 与必需 CPU Silero，半套不就绪、VAD 失败不降级、共享资产不被误删。
- [x] AC6/R4: 复用独立共享 CPU/CUDA runtime 合同，权重未捆绑；CT2/Kotoba/Qwen 与本地安装版/portable 相关回归检查通过。
- [x] AC7/R2/R4: 任一设备功能或交付缺失时保持 `postMvpUnavailable`；全部通过后方可启用，并可独立回滚。

## Out Of Scope

- CER/语义缺口/性能阈值资格矩阵、CPU 质量继承、量化竞赛、Python parity 与自研对齐算法。
- ReazonSpeech、通用 VAD、Kotoba K3 的实现或验收范围调整。
- 版本号、CHANGELOG、发布就绪判断、安装包上传、GitHub Release、提交、合并与推送；用户独立决定发布。
