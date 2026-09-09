# Qwen3 + ForcedAligner Native 集成

## 当前状态

**功能交付已接受；任务保持 `in_progress` 执行已明确授权的旧 Qwen 开发 timeline 整体退休。** 用户确认应用内 CPU、CUDA 均成功运行，当前 Qwen 选择、模型下载、转录及独立 CrispASR CUDA 下载保持启用。CUDA 依赖发布复核项由用户接受关闭；此前超时的独立代理没有执行该次复核，不记为独立通过，不再重跑下载、上传或推理。

采用固定上游完整 CLI，替代废弃的低层 session/raw-only、DP/质量实验及 Qwen-only 源码裁剪方向。Qwen（含必需 CPU VAD）→ Parakeet → ReazonSpeech → 通用 VAD 的顺序不变；其他 child 尚未实现。本任务完成不代表新应用版本发布或所有 GPU 已实测。

## 产品需求

### R1 — 上游完整流程

- 固定 CrispASR v0.8.32 完整 `crispasr-cli`，不裁剪源清单、不恢复自建 session 编排、分词、窗口或对齐算法。
- exact `Qwen/Qwen3-ASR-1.7B` + `Qwen/Qwen3-ForcedAligner-0.6B`，使用上游推荐 Q4_K pair，显式本地角色文件；禁止 `auto` 替换模型、隐式下载或服务器入口。
- 必需 Silero v6.2.0 在 CPU 执行，再交给主 ASR/aligner；沿用上游 VAD 切片/offset、ForcedAligner LIS/插值和 word-aware display。如实称为上游后处理，不冒称 raw argmax；无有效 word timing 的文本均分 fallback 不算成功。
- 唯一批准的展示层例外：仅合并相邻零时长/开始倒序异常组，正文按原字节顺序拼接，区间取成员已有 start 最小值/end 最大值。正常行、普通重叠和 word 时间不变；全零、负时长、越界等仍失败。详细合同见 `.trellis/spec/asr/qwen-cli-output.md`。

### R2 — 模型与独立运行时

- ASR+aligner 是一个原子安装/readiness pair；一个现有下载任务的总进度包含必需 VAD，全部角色验证后才 ready。续传、修复、离线复用失败不得破坏旧完整 pair；不新增模型下载取消 API/UI。
- 模型锁定 repository/revision/file、实际 size/SHA、来源与许可证；CPU/CUDA 共用权重，按需下载，不捆绑模型。
- CrispASR CPU 随 NSIS/portable 提供，CUDA 为独立已发布的按需 pack；两者的 artifact、lock、verifier、安装根均独立于 CTranslate2，不允许跨树加载 DLL。
- CPU 不初始化 CUDA；显式 CUDA 失败不回退 CPU。`auto` 只在 worker 启动前解析；GPU 任务开始后不得回退重跑。ASR/lazy audio/aligner 必须证明实际请求设备，VAD 始终 CPU。
- 文件闭集指实际分发文件、来源、许可、哈希和加载范围受控，不要求完整 CLI 只包含 Qwen 实现。未接入后端不能因被编译就开放产品支持。
- 最终本地包预算 NSIS <=80 MiB、portable ZIP <=90 MiB；超标/许可冲突须另行决策，不静默裁剪许可、改分发方式或重启源码瘦身。

### R3 — 现有流程与安全

- 复用 worker protocol v1、Tauri host/job、模型管理、shared availability/preparation hook、取消/reap/recovery、翻译/编辑/ASS；不新建常驻服务、下载器或任务体系。
- 完整输入字节须有效 UTF-8、无 raw NUL、严格 JSON；最终 cue 有限整数毫秒、非负、正时长、开始非递减、音频范围内，满足条数/文本/事件大小限制。失败、半写、取消或静音不覆盖旧 ASS。
- 成功 CPU VAD 无语音允许显式空结果；缺文件/失败不是静音。文本守恒只针对同次上游输出，不读参考 ASS、不评分。
- 受控 argv/环境/本地路径/同根进程与 Windows Job 约束保持；CLI stdout/stderr 不污染协议或普通日志。物理 reap 与可重试私有文件清理分离，不能因删除失败永久占用 gate。
- 现有 CT2 八条模型及 CPU/CUDA 路线保持；禁止生产 Python/PyTorch/Nagisa/DyNet/NeMo fallback。

## 已完成的功能验收

以下按已接受工程复核和用户应用确认收敛，证据计数、身份与限制见 `implement.md`；不把未执行的手工安装或独立发布复核勾成通过。

- [x] AC1 / R1：exact pair + CPU VAD + 完整上游调度/后处理进入既有 worker/ASS，最小相邻展示修正已接受。
- [x] AC2 / R2：单逻辑下载、合并进度、pair 原子交付、VAD readiness、续传/修复/离线合同通过。
- [x] AC3 / R1–R2：CPU/CUDA 各短/中/长真实功能及设备、失败语义通过；无字幕质量评分/继承标签。
- [x] AC4 / R3：输出/路径/静音/取消重开/recovery/reap 回归通过；用户确认双设备应用运行及当前入口可用。
- [x] AC5 / R2–R3：独立 runtime 文件/来源/许可/路径和本地包预算检查通过，CT2 保持；CUDA 依赖已发布并接通同字节下载源，发布复核项由用户接受关闭。

## 本轮清理边界

- 前轮 267 项冗余记录/实验/未使用裁剪 target 清理已接受。本轮用户单独批准 ponytail 审查唯一建议：整体退休旧 Qwen DEVELOPMENT timeline，覆盖此前保留它的要求，不扩大其他边界。
- 仅删除 `native-asr/src/qwen_timeline_policy.cpp`、`.hpp`、`qwen_unicode_punctuation_ranges.inc` 及 `native-asr/tests/qwen_timeline_policy_tests.cpp`；同步移除专用 CMake 接线。开发 Qwen 分支回到 HEAD 原有 backend 能力调用后 structured `qwen_timeline_policy_not_implemented` / exit20 合同及对应测试，无字幕输出。
- 保留共享 backend/fake ABI、Parakeet/Reazon targets、当前 full-cli 生产适配器/回归/协议安全、全部锁原路径/字节、模型/运行时资产与 ignored-local/用户素材；不递归清理缓存或链接目录。
- `research/upstream-engineering-baseline-lock.json` 的路径和字节不变：当前 prepare/package/smoke 仍消费它，不能归档任务。保留来源清单、简短上游研究、相邻合并影响和需求纠正文档。
- 编码前仅同步当前任务/manifest 授权。外部保留本轮 dirty-start 清单与精确 before bytes；按本轮增量计数，不把迁移整体回退 HEAD。运行本地固定依赖的无模型 native configure/build/CTest、task validate、active-reference scan 与 diff 检查；不改生产行为、锁/包字节或历史 verification flags。

## 不在范围内

Qwen 质量/量化竞赛、CER/WER/S/D/I/参考 ASS timing/gap/150–500ms 门槛、Python parity、`inherited-from-gpu`、DP/logit/token/Nagisa 研究、源码裁剪、其他引擎/通用 VAD 实现、新证据平台、推理/probe/下载/上传/重建包、版本/CHANGELOG/应用发布、Git stage/clean/reset/commit/push/merge/history、任务归档。发布准备与未执行的安装/卸载交互由用户独立判断。
