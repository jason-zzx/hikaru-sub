# 构建原生 ASR Worker 协议

## Goal

在不接入真实模型、不修改现有 Tauri ASR command 和生产默认路由的前提下，建立版本化 worker protocol v1、共享 C++ 协议校验层和确定性 fake worker，使 T05 能在无 Python、无模型、无网络、无 GPU 的测试环境中证明完整进程生命周期。

## Background

- T01 已冻结 ground-truth 与产品质量门槛；T02/T03 已证明 CTranslate2 和 CrispASR 可在 Windows x64 独立原生进程中运行。
- T02 的 production handoff 需要保留 source/model timestamp window、合法 segment 和结构化失败语义；T03 证明 CrispASR v0.8.22 没有可依赖的 cooperative cancellation，T05 必须能终止进程树。
- 当前 React/Tauri 继续使用 `AsrJobSnapshot`；T04 只定义 Tauri 与 worker 之间的 wire contract，不把 snapshot 状态管理或真实推理带入本任务。
- GPU 加速已纳入父任务。Protocol v1 必须从一开始接受由 host 解析后的 `cpu`、`cuda`、`vulkan`，不得传递含糊的 `auto`。

## Requirements

### R1 - Scope And Boundary

- 新建单一 `native-asr/` CMake 工程中的协议库、fake worker 和 CTest；不创建平行 worker 工程。
- T04 不修改 `src-tauri/src/asr.rs`、Tauri command 注册、前端类型/组件、Python sidecar、模型下载、runtime packaging 或生产路由。
- 测试和构建不得要求模型、Python、Hugging Face cache、网络、CUDA 或 Vulkan。
- 使用固定 C++17，并 vendor pinned `nlohmann/json` 3.11.3 single header、LICENSE 与 SHA-256；普通 configure/build/test 不联网，也不引入测试框架，优先使用小型 self-check executable + CTest。

### R2 - Versioned Request Contract

Protocol v1 request 是 stdin 上唯一一行无 BOM UTF-8 JSON，至少包含：

- `protocolVersion: 1`；
- 非空且有长度上限的 `jobId`；
- 固定合法组合的 `engine` 与 `backend`；
- `modelPaths: [{ role, path }]`，role 明确区分 `model`、Qwen `aligner` 和未来确有需要的 companion；
- 绝对本地 `audioPath`；
- host 已解析的 `device: cpu | cuda | vulkan`；
- 固定产品源语言 `language: ja`；
- `useVad` 与仅在启用时生效的可选 `vadConfig`。

约束：

- engine/backend/model role 组合必须按产品固定路由校验；Qwen 必须同时有 model 与 aligner。
- 拒绝 URI、NUL、相对路径、重复 role、未知 role、非有限数值、非法 VAD 范围和缺失必需字段。
- Worker 只验证协议形状与本地路径语法；受管根、模型 hash、下载就绪和 runtime 选择属于 T05/T11～T15。
- v1 忽略未知 additive 字段，但不接受未知 engine/backend/device/event。

### R3 - Event Envelope And State Machine

stdout 每行是带 `protocolVersion: 1` 和 `event` 的无 BOM UTF-8 JSON；stderr 只承载有界诊断。

支持：

- `ready`：成功 request 的第一条且 exact once，声明实际 backend/device 和已验证的正整数 `durationMs`；
- `progress`：单调 `processedMs`，其 `durationMs` 必须与 ready 完全一致；
- `segment`：追加一个合法 segment；
- `segmentsReplace`：完整、原子替换候选列表；
- `completed`：唯一成功终态；
- `error`：稳定 machine code + 安全 message 的唯一失败终态。

状态合同：

```text
request -> error -> EOF
        |-> ready(durationMs) -> (progress | segment | segmentsReplace)* -> completed | error -> EOF
```

- Request/version/route/path validation 可在 ready 前发送唯一 structured `error`；不得为无法成立的 backend/device/duration 伪造 ready。
- ready 后允许在首个 progress 前发送 segment/replace，因为部分 backend progress callback 可能沉默；ready 的 duration 使这些 segment 仍可立即做上界校验。
- `completed.durationMs` 和所有 `progress.durationMs` 必须与 ready 完全一致；duration 漂移是协议错误。
- `completed` 与 `error` 互斥且 exact once；终态后任何 stdout 事件均为协议错误。
- EOF 前没有终态是协议错误，即使 exit code 为 0。
- `completed` 后进程非零退出不能被 host 视为成功。
- 有有效 structured `error` 时保留其 code/message；非零退出且无 error 由 T05 映射为 host error。
- Protocol v1 不增加未被 pinned backend 支持的 stdin cancel message；取消通过 T05 终止进程树。

### R4 - Validation And Resource Bounds

- Segment 必须满足非空文本、`0 <= startMs < endMs`、排序且在已知 `durationMs` 内；generic protocol 层拒绝非法值，不暗中 clamp、扩张或合成。
- `segmentsReplace` 必须先完整验证再输出/接收，单条失败不得形成部分替换。
- `native-asr/protocol-v1-limits.json` 是 request/event line、job ID、path、text、model entry、replacement segment count 和 stderr diagnostic 上限的唯一机器可读来源；CMake 从它生成/校验 C++ header，T05 通过 `include_str!` 或同源生成值消费，并以跨语言一致性测试防止漂移。
- Oversized、malformed JSON、未知事件、重复 ready、进度倒退、duration 漂移、终态后事件均 fail closed。
- 上限应覆盖 authoritative long case 和合理的长视频输出，同时阻止单行或 segment 数量耗尽 host 内存。

### R5 - Deterministic Fake Worker

Fake worker 使用测试专用 scenario 参数，不把 fake flags 放入生产 request。至少提供：

- success：ready/progress/segment/replace/completed，并含合法 segment-before-first-progress；
- structured error with partial segments；
- malformed JSON、unknown event、version mismatch、invalid transition、invalid segment、duration drift、oversized line；
- crash before ready、crash after progress、zero exit without terminal、completed then nonzero exit；
- hang after ready；
- child-process hang，用于 T05 验证 Windows 进程树终止；
- stderr diagnostics，证明 stdout 始终是纯 JSONL。

所有场景输出固定，不依赖时间、随机 ID、模型、网络或硬件。

### R6 - Handoff And Reproducibility

- 写 `native-asr/docs/protocol-v1.md`，列出 schema、状态机、限制、错误/退出矩阵和 fake scenario 名称。
- CMake 提供稳定的 Windows x64 Release configure/build/CTest 入口和 fake worker 可执行文件定位合同，供 T05 测试使用。
- Tracked source vendors pinned nlohmann/json single header + LICENSE/hash so ordinary build/test is offline；T12 负责可复现打包管线、provisional artifact 和依赖/许可证清单，T17 再基于 T06～T10 final identities 重建并认证最终 CPU release artifact。
- T04 完成后，T05 的 context manifest 必须刷新为最终协议文档/归档路径后才能启动。

## Acceptance Criteria

- [ ] Protocol v1 request、event envelope、状态机、资源上限和错误/退出矩阵均有文档与 C++ 校验测试。
- [ ] `device` 只接受 host-resolved `cpu`、`cuda`、`vulkan`，不接受 `auto`。
- [ ] Qwen request 缺失 aligner、重复/未知 model role 或非法路径时在推理前受控失败。
- [ ] Fake worker 覆盖 success、replace、structured error、malformed/version/transition/segment/oversize、crash、incomplete EOF、hang、child-process 和 stderr 场景。
- [ ] Segment 与 replacement 校验 fail closed，不生成 synthetic timing、文本或参考修补。
- [ ] 终止型 fake 场景的完整 stdout/stderr/exit code 可重复；hang/child-hang 只比较 deterministic prefix，并由 CTest 固定 timeout 后终止且确认无额外 stdout/orphan process。
- [ ] Release CMake build 与 CTest 全部通过，且不要求 Python、模型、网络或 GPU。
- [ ] 没有生产 Tauri command、React 类型、Python ASR、模型下载或 release packaging 改动。
- [ ] 没有模型、binary、build directory、private corpus、绝对用户路径或 raw transcript 进入 Git。

## Out Of Scope

- Rust worker host、`AsrJobSnapshot` reducer、recovery、process-tree cancellation 实现（T05）。
- CTranslate2/CrispASR 真实 backend 和模型质量（T06～T10）。
- 模型 manifest/downloader、CPU/GPU runtime packaging、settings/UI（T11～T16）。
- cooperative cancellation protocol、多任务队列、远程 URL 或下载。

## Rollback

删除 `native-asr/` 中的 T04 协议/fake-worker 增量即可；现有 Python production path、用户设置、模型和缓存保持不变。
