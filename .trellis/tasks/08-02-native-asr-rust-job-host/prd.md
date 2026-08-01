# 在 Tauri 中托管原生 ASR 任务

## Goal

在 Rust/Tauri 中实现可独立测试的单任务 native worker host，使 T04 fake worker 能通过现有 `start_asr`、`get_asr_progress`、`cancel_asr` 产品合同完成 success/progress/replace/error/cancel/crash/recovery 生命周期，同时保留 Python legacy 默认/回退路径，不接入真实模型或模型下载。

## Background

- T04 将冻结 protocol v1、资源上限、fake worker 场景和 executable 定位合同；T05 在 T04 完成并归档前不得启动。
- 当前 `src-tauri/src/asr.rs` 同时管理 Python sidecar、HTTP job 代理、模型 API 和恢复快照；React 依赖现有 command 名称、camelCase 参数与 `AsrJobSnapshot` 字段。
- 当前 `asr-service/jobs.py` 的 append/refresh/terminal snapshot 行为是产品兼容参考；迁移后 native job 状态和恢复写入由 Rust 持有。
- CrispASR 当前 pin 无可靠 cooperative cancel；进程树终止是 native host 的必要合同。

## Requirements

### R1 - Dependency And Scope

- 只消费已评审的 T04 protocol v1 和 fake worker；自动化测试不依赖 Python、模型、网络或 GPU。
- T05 实现通用 host、event reducer、recovery、取消和退出清理，不实现 CTranslate2/CrispASR backend、模型 manifest/downloader、runtime packaging、GPU probe、settings 或 UI 迁移。
- Python inference/model commands 保持可用，production/default route 不在 T05 切换。

### R2 - Stable Product IPC

保持现有：

- `start_asr`、`get_asr_progress`、`cancel_asr` command 名称与外部参数；
- `StartAsrArgs` camelCase 合同，包括 `outputAssPath` 当前兼容行为；
- `AsrJobSnapshot` 的 `id/status/progress/durationMs/processedMs/segmentCount/detectedLanguage/error/segments?`；
- `includeSegments=false` 时省略 `segments`，不是返回空列表；
- 缺失任务错误继续包含前端识别所需的 `转录任务不存在`；
- command 注册、typed wrapper 和 `TranscribeView` 调用方式。

本任务不新增 product command 或持久化用户设置。

### R3 - Single Active Slot And Terminal Ownership

- Legacy 与 native route 共享一个“最多一个活跃转录任务”的 gate；第二个任务不排队，返回明确错误且不生成第二个进程。
- 状态保持 `pending -> running -> completed | failed | cancelled`。
- `ready` 后才进入 running；`progress/processedMs` 单调，`durationMs` 一旦为正不得漂移。
- `segment` 追加；`segmentsReplace` 在完整列表验证后原子替换，失败不破坏旧列表。
- cancel、structured error、protocol failure、process exit、completed 竞争时，统一通过一个原子 compare-and-set 尝试提交终态；谁先成功谁赢，后到来源只能清理/reap。
- `completed` 事件只暂存成功候选；stdout 处理完且进程 exit 0 后才参与同一个 compare-and-set。

### R4 - Worker Process Lifecycle

- 使用结构化 `Command`/argv 和经过验证的本地 executable/path，不经 shell 拼接用户路径。
- stdin 只写一行 T04 request，flush 后关闭；stdout 按 T04 限制持续读取 JSONL；stderr 独立排空并截断写入受管日志。
- 按 T04 状态/退出矩阵分类 pre-ready/runtime structured error、malformed、unknown、oversized、incomplete EOF、crash 和 completed-then-nonzero。
- 非零退出且无 structured error 映射为稳定 `worker_abnormal_exit`；零退出无终态映射为稳定 protocol-incomplete error。
- Worker machine code 保留在内部状态/诊断；现有单一 `AsrJobSnapshot.error` 使用稳定安全格式 `[code] message`，不新增前端字段。
- 不把 stderr、完整 request、字幕正文或敏感路径直接返回 UI。

### R5 - Recovery And Minimal ASS

- Recovery 路径保持当前 workspace 语义：`<audio workspace>/asr-jobs/{jobId}.json`。
- 在每次有效 append/replace 和所有终态后，使用现有原子写 helper 保存最新 snapshot；failed/cancelled/crashed 保留已有 segments。
- 只有 completed 且 segments 非空时写 `outputAssPath` 最小恢复 ASS；failed/cancelled 不写 completed ASS。
- Rust 恢复 ASS 仍只是兜底，React 继续负责视频分辨率、Script Info、Styles 和正式 ASS。
- 所有恢复/输出路径必须经过 canonical containment/目标验证；不得从 worker 输出派生写入路径。

### R6 - Cancellation And App Shutdown

- Running job 取消顺序：先提交 cancelled 意图，再终止整个 worker process tree，2 秒内 reap/确认退出，保存 recovery，最后释放 active slot。
- 对已终态 job 的 cancel 幂等；不存在 job 仍返回兼容错误。
- 将 Windows process-tree termination 提取为 `src-tauri/src/process.rs` 的共享 helper，现有 ASR setup 与 native host 复用，避免两套 `/T /F` 行为。
- App `ExitRequested` 调用封装的 `AsrState.shutdown()`，同时处理 native worker 与 legacy sidecar；`lib.rs` 不再直接操作内部进程字段。

### R7 - Development Launch And Legacy Route

- 冻结内部、非 IPC 的 `ResolvedNativeLaunch` 输入：engine、backend、role/path model entries、resolved `cpu|cuda|vulkan`、audio/output/recovery paths。Protocol request 只能由该结构构造。
- T05 fake/debug tests 注入临时绝对 model/audio paths 与 fixed `cpu`；T06 model tests 注入 task-local locked model path；T11/T14/T15 后续实现 production model/device resolver。T05 不自行解析 `auto` 或模型 readiness。
- Native worker path/route 只可由 tests 或 debug-only 显式配置启用；release/default 继续 legacy，直到 T06/T08 真实 backend 通过。
- Debug override 在 release build 中不可生效，不新增用户 UI 或持久 setting。
- Legacy/native 共享 slot 的 legacy 生命周期必须明确：HTTP start 失败立即释放；第一次 poll 观察到 terminal、成功 cancel、或 sidecar 不可达但 recovery 明确为 terminal 时释放；普通连接错误保持占用直到明确 cancel/shutdown。
- 模型 list/status/download commands 暂时继续走 legacy sidecar；T11/T15 后续迁移。

### R8 - Resource And Security Limits

- Rust parser 直接嵌入 T04 canonical `protocol-v1-limits.json`（或消费其同源生成值）并运行跨语言一致性测试；不得手写第二套上限。
- stderr 日志写入 `work_cache_dir` 下受管位置并有固定 per-job/retention 上限。
- 避免在 async runtime 上做阻塞 subprocess wait 或重文件写；使用现有线程/`spawn_blocking` 模式。
- 不新增 crate，优先使用现有 std、serde_json、Tokio 和原子写 helper。

## Acceptance Criteria

- [ ] T04 fake success/progress/append/replace/completed 通过现有 snapshot 合同并在 exit 0 后完成。
- [ ] Pre-ready/runtime structured error、malformed JSON、unknown/version/oversize、EOF without terminal、crash 和 completed-then-nonzero 全部受控失败并保留最后有效 segments；snapshot error 保持 `[code] message` 兼容格式。
- [ ] `includeSegments=false` 省略字段；缺失任务文案和 command/args/snapshot 字段保持兼容。
- [ ] Legacy/native 共享单 active slot；legacy start failure/poll terminal/cancel/recovery terminal/connection error/shutdown 的保留与释放分支均有测试，并发第二次 start 不生成进程。
- [ ] cancel 与 app shutdown 终止 fake child process tree，测试观测时间不超过 2 秒。
- [ ] cancel/error/crash 后到事件不会覆盖终态；终态只提交一次。
- [ ] Recovery JSON 原子保存，partial segments 在 failed/cancelled/crashed 后可读。
- [ ] 仅 completed 写最小 ASS；React 正式 ASS 流程和类型无需改写。
- [ ] Release/default 仍使用 Python legacy；fake/native override 不进入 release 用户配置。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`、相关 focused tests 和 `pnpm build` 通过。
- [ ] 自动化测试不要求 Python、模型、网络或 GPU；无 orphan worker/child process。

## Out Of Scope

- 真实 CT2/CrispASR inference、模型质量和 protocol v1 变更。
- 模型 manifest、下载、cache readiness 和 runtime package。
- GPU device probe/routing、settings/runtime dependency 或 frontend 文案迁移。
- 删除 Python sidecar、切换 production default、多任务队列或并发。

## Rollback

关闭 debug/test native injection，删除 native host 模块并恢复 `AsrState` 原接线；Python legacy、模型 API、用户项目和缓存不变。
