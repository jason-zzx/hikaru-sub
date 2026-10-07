# Add Native ASR VAD support

## Goal

为 Hikaru Sub 的七个普通 Faster-Whisper 模型与 exact Kotoba 提供可选 CPU VAD，跳过未检测到语音的音频区间，并将结果保持在原视频时间轴上。复用已交付 Silero，不改变 Qwen3、Parakeet、ReazonSpeech 的必需 VAD 行为。

## Background

- 前置 Qwen3、Parakeet、ReazonSpeech child 均已完成归档，已交付共享必需 CPU Silero。本任务不重做其模型迁移或字幕质量研究。
- 用户已确认：新增 VAD 同时覆盖七个普通 Faster-Whisper 模型与 Kotoba；默认关闭；开放语音阈值、最短静音时长两个高级参数。
- 用户要求只做相关最小改动，不顺手重构、不增加通用框架或过度防御性编程。提交/发布保持独立授权。
- 用户已批准按本目录方案实施，任务已激活为 `in_progress`；先执行 P1 最小闭环，再按验证结果推进后续接线。本任务模型实测仍须实际执行后记录。

## Confirmed Current Behavior

- 转录 UI 固定发送 false/null，无通用 VAD 控件（`src/components/workflow/TranscribeView.tsx:431–439`）。
- Tauri 对已有三条 full CLI 路线强制固定 CPU VAD、拒绝自定义配置；CT2 请求启用 VAD 被拒绝（`src-tauri/src/asr.rs:463–475, 509–532`）。
- CT2 生产 worker 不支持 VAD；旧 ONNX Candidate B 为已拒绝的开发路线，不能仅启用编译开关（`native-asr/src/main.cpp:275–300`；`native-asr/CMakeLists.txt:85–88`）。
- 共享 GGML Silero 已有受管下载、校验与 `vad` role，但 `requiredVad` 会影响模型 readiness（`src-tauri/src/asr_models.rs:907–955`）；CT2 当前协议仅接受 `model`（`native-asr/docs/protocol-v1.md:53–76`）。新可选能力需接通实际推理与依赖，而不只补 UI。
- pinned 完整 CLI 已有 standalone VAD export，但受控入口与导出后处理不能直接满足本任务；依据与最小适配见 `design.md` §2/§5。该判断来自源码核对，不是本轮实机验证结论。

## Requirements

### R1 — 适用范围与原行为

- 覆盖 ordinary `tiny / base / small / medium / large-v2 / large-v3 / large-v3-turbo` 与 exact `kotoba-tech/kotoba-whisper-v2.0-faster`。
- 默认关闭；用户开启后才要求可选 VAD 依赖。关闭时保留原完整音频转录，不因 VAD 资产或 CPU VAD runtime 缺失而阻断。
- 不修改 Kotoba 解码参数、K2 ownership/dedup 或混入独立 K3 质量修订。

### R2 — 用户配置

- 仅开放阈值 `threshold` 与最短静音时长 `minSilenceDurationMs`，后者表示判定语音段结束所需的连续静音长度，不是自动删除所有超过该时长的静音。
- 复用 `useVad` / `vadConfig`；两个参数必须实际影响 CPU VAD，不被后续短段合并策略抵消。关闭时不应用配置；不支持的已知参数明确拒绝/解释，不假装生效。
- 使用现有页面临时状态，不写 project、全局设置或 localStorage；UI 可操作、范围与单位清楚，准备/运行期间不能改变已发起任务的配置。

### R3 — 已交付模型隔离

- Qwen3、Parakeet、ReazonSpeech 的必需 CPU VAD 不受可选开关与高级参数影响，不在外层重复执行 VAD。
- 保留 Qwen LIS/插值及已批准的展示合并、Parakeet 上游切片与实际音频重转录、ReazonSpeech RNNT endpoint/PCM-support 合同。
- 共用资源/启动代码必要变动做定向回归，不重做三条模型质量验收或流水线。

### R4 — 执行与时间轴

- VAD 始终 CPU；主请求的 `cpu|cuda|auto` 只控制 ASR 设备，不新增 VAD 设备字段/UI/CUDA runtime。
- 同时支持 CPU VAD → CPU ASR 和 CPU VAD → CUDA ASR，沿用原有显式设备不回退和 auto 启动前选择语义。
- 语音区间非负、有序、不逆序且在真实音频样本内；最终 cue 可追溯到区间与模型输出，偏移只应用一次。
- 沿用现有 CT2 解码器对输入音频末尾的边界处理，不因其 `end_bounded_to_audio` 标记新增拒绝。不新增插值、next-cue/slice-end 猜测、剪裁/拉伸或 synthetic gap fill 修补算法；不跨被排除的静音进行前端二次短句合并。

### R5 — 依赖、失败与生命周期

- 复用既有 exact Silero identity/许可证、共享缓存、官方/中国大陆源、按需下载、校验、离线复用、续传修复和清理；权重不捆绑、不按设备复制。冻结实际 runtime 能力与分发文件身份，不信任仅有引擎名称的支持声明。
- 启用后缺依赖、配置不支持、CPU VAD 计算失败或输出损坏必须明确失败，不静默关闭、换算法、回退 Python 或启动无 VAD ASR。
- 复用现有 job、进度、取消、进程树 reap 和恢复；无重复任务槽/后台重试机制。用户能从缺依赖确认下载走到转录和 ASS 保存。
- 真正无语音是空成功，保留现有字幕、恢复快照与保存目标；错误、取消或部分输出也不得覆盖/清空既有字幕。
- 安装版/portable 与存储清理行为不退化；probe 不增加递归扫盘。

### R6 — 最小工程与授权边界

- 只改直接接线、必要边界处理和对应验证；复用模型管理、worker、CLI 与生命周期，不新增框架、重复校验、额外重试/回退或中间产物身份系统。
- 保留真实信任边界输入验证、进程隔离和防数据丢失处理，不用“从简”删除必要安全措施。
- 本地构建/包装/双设备功能验证与应用/依赖发布分开。新本地 CUDA 包不得冒用旧远程包的已发布状态；不自动提交、推送、上传、改版本或决定 release readiness。

## Acceptance Criteria

- [ ] **AC1 / R1–R3**：八条新增可选路线可在 UI 操作，默认关闭、只开放两个高级参数；开关/参数从 UI 到实际 VAD 生效，已有三条必需 VAD 不受影响。
- [ ] **AC2 / R1,R5**：开/关感知的检查、下载、离线复用、修复与共享清理通过；无 VAD 请求不依赖可选资产，direct/legacy 模型均正确就绪。
- [ ] **AC3 / R4,R5**：CPU VAD → CPU/CUDA ASR 完成功能矩阵，包括全八模型 short、80/128 Mel ordinary 与 Kotoba 的 medium/long，以及静音、前后静音、碎片语音和取消代表用例；具体分层见 `implement.md` P4，不做全异常组合笛卡尔积。
- [ ] **AC4 / R4**：sample 边界、跨静音原时间轴、局部窗口与一次偏移的自动化验证通过，Native 结果不被后处理伪造或重新跨 gap 合并。
- [ ] **AC5 / R5**：无语音、错误、取消、坏输出不破坏干净/脏文档与 ASS；任务树被正确终止回收，随后可启动新 job；无 Python/venv/PyTorch fallback。
- [ ] **AC6 / R3,R5**：CT2 关闭 VAD 基线、已有三条 CPU/CUDA 路线、受管路径、安装版/portable 本地包装及许可/模型不捆绑要求通过受影响回归。
- [ ] **AC7 / R6**：只包含相关最小改动；测试与未验证项如实报告，本地候选资源和远程已发布资源区别明确，未执行未经授权的 Git/发布操作。

## Out Of Scope

- Kotoba K3、CER/语义质量评分、Python parity、RTF 阈值、字幕质量竞赛或全模型参数优化。
- 新 ASR 模型、Vulkan、多 GPU、非 Windows 平台、VAD GPU 加速或第三套 runtime。
- 已拒绝 Candidate B 产品化、完整 CLI 源码裁剪、无关代码清理、通用任务框架、多版本 runtime 兼容系统。
- 新下载取消 API、自定义模型 URL、持久化 VAD 设置、更多高级参数。
- 提交、合并、推送、版本号、CHANGELOG、远程 runtime 上传、GitHub Release、应用发布及 release readiness 判定。

## Planning Deliverables

- `design.md`：静态依据、推荐默认值、CLI/CT2 接入、下载/readiness、时间轴、生命周期及交付边界。
- `implement.md`：最小运行证明优先的执行顺序、定向/完整测试、本地 CPU/CUDA 与包装验证、回退点。
- `implement.jsonl` / `check.jsonl`：实现/检查上下文。用户已明确批准开始；实现授权不包含 Git 提交或发布。
