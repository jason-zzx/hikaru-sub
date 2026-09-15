# Complete remaining Native ASR migrations

> **Narrow owner-authorized dependency exception:** Parakeet may now publish one new
> shared Qwen+Parakeet CUDA asset on the existing `native-asr-cuda-v1` dependency
> release, verify official/China-mirror bytes, update default build/download authority
> and enable ordinary builds, then run targeted local packaging validation. Earlier
> blanket publication exclusions below remain for application releases, not this
> exact dependency action. Preserve old assets/locks/evidence; no tag/release creation,
> app upload/version/CHANGELOG, Git staging/history, archive or next-engine work.
> Minimal scope and stop/escalation boundaries are in the child’s latest authorization.

> **Qwen 当前状态**：完整 CLI + 默认 Q4_K pair + 必需 CPU Silero + 上游 LIS/word display（含批准的有界相邻异常合并）已完成双设备功能、交付和本地包装检查，工程复核接受，用户确认应用 CPU/CUDA 成功。选择/下载/启动及独立 CrispASR CUDA 源保持启用；CUDA 发布复核项由用户接受关闭，超时独立代理没有执行该次复核。Qwen 清理/开发 timeline 退休已接受；构建锁精确迁移和稳定 scratch 解耦已落盘；用户免除进一步复核后，child 于 2026-09-09 归档至 `.trellis/tasks/archive/2026-09/08-20-native-asr-qwen3-aligner/`，迁移独立复核未执行。Parakeet 已完成独立实施、shared-v2 依赖分发、默认双设备启用和最终复核，用户确认最终应用 CPU/CUDA 均可运行，当前仅待提交/归档；Reazon/通用 VAD 尚未实施且不自动开始。Qwen 不适用旧质量矩阵、量化竞赛、CPU 质量继承、raw-only/DP 或源码裁剪要求；Parakeet 已获用户批准采用完整上游集成与双设备功能验收；ReazonSpeech 的绝对质量合同不变。证据与限制见 Qwen `implement.md`。

## Goal

在下一次 Hikaru Sub 应用发布之前，将 v0.4.1 中仍未进入生产 Native ASR 的模型路线依次迁移完成：Qwen3-ASR + ForcedAligner、Parakeet、ReazonSpeech NeMo，最后完成通用 Native VAD 产品化（Qwen 必需 CPU VAD 在 Qwen child 内前置）。发布版本、发布构建与发布动作不属于本任务。

## Confirmed Facts

- 当前生产 Native ASR 已支持七个 Faster-Whisper 模型与 exact `kotoba-tech/kotoba-whisper-v2.0-faster`，并提供随包 CPU runtime 与按需下载 CUDA runtime。
- Qwen exact `Qwen/Qwen3-ASR-1.7B` + `Qwen/Qwen3-ForcedAligner-0.6B` 已接通生产 manifest、原子下载/readiness、必需 CPU VAD 和独立 CPU/CUDA runtime。
- 仍为 `postMvpUnavailable` 的原有模型为 `parakeet / nvidia/parakeet-tdt_ctc-0.6b-ja`、`reazonspeech-nemo / reazon-research/reazonspeech-nemo-v2`；历史 development seam 不等于它们已完成生产交付。
- 用户确认固定顺序为 Qwen3（含必需 CPU VAD）→ Parakeet → ReazonSpeech → 通用 VAD。
- Kotoba K3 是已迁移模型的后续质量修订，不属于本父任务。

## Requirements

### R1 - Fixed scope and order

- 子任务必须按以下顺序规划、实现和验收：
  1. `08-20-native-asr-qwen3-aligner`；
  2. `09-01-native-asr-parakeet-productization`；
  3. `09-01-native-asr-reazonspeech-productization`；
  4. `09-01-native-asr-vad-migration`。
- 后一个子任务不得因抢跑而改变前一个子任务尚未冻结的 runtime、manifest、协议或模型交付合同。

### R2 - Production Native definition

每条模型迁移须满足以下适用条件。**Qwen 范围例外**：采用上游默认 Q4_K pair，不做量化质量竞赛或字幕质量矩阵；CPU/CUDA 分别验证功能、设备和生命周期，不使用质量继承标签。锁定实际发布文件 identity/来源/许可证，变更 bytes 后重跑受影响的功能验证，不强制重建转换或恢复旧研究。接受上游 LIS/插值及 child 已批准的最小相邻展示异常组合并（现有端点包络、原文守恒），不接受其他自研修补或无 word timing 的文本均分 fallback。**Parakeet 范围例外（用户已确认）**：同样采用完整上游集成与 CPU/CUDA 短/中/长真实功能、设备、输出合法性、生命周期和产品交付验收，不做量化竞赛、CER/语义缺口/RTF 阈值资格、Python parity、自研对齐或 CPU 质量继承。优先兼容的上游/社区推荐产物，锁定实际来源/revision/文件/size/SHA/格式/量化/许可证，转换信息如实记录；不强制新 converter 研究。主观质量由用户试听评估，不承诺量化达标；用户另行确认 Parakeet 完整上游日语流程，包含复用必需 CPU Silero、上游 12 秒切片及对未覆盖实际音频的再次转录/片段边界重组；不授权应用侧自研填补。Qwen aligner/异常合并不扩展到 Parakeet。详见 Parakeet PRD。以下旧质量/完整 converter 研究要求仅保留给 ReazonSpeech，不能用于重新阻塞 Parakeet；共同安全、交付与本地包装合同保持。

共同的交付、安全与产品边界保持：

- 生产转录完全通过独立 Native worker 与现有 Tauri job/取消/恢复/ASS 流程执行；
- 不启动、不回退、不要求 Python sidecar、Python runtime、venv、PyTorch 或 NeMo；
- 用户可见逻辑模型 identity 固定为原有上游模型：Qwen3-ASR + exact ForcedAligner、Parakeet 日语模型、ReazonSpeech NeMo v2；不得用相邻模型或新模型替代迁移目标；
- Native 转换格式与量化不是用户可见模型 identity，可由对应 child 选择或重新构建，以取得真实质量、性能和设备资格；历史 cstr Q4_K/Q8_0 转换只作为 candidate baseline，不是发布权威；
- 每个逻辑模型最终只产品化一个资格化 Native artifact（Qwen 为一个 ASR+aligner pair），不向用户暴露量化选择。
- 候选必须先分别通过全部强制质量、timeline、性能、资源、CPU/CUDA、生命周期、许可证与分发门禁；多个候选均通过时，以字幕质量和时间轴保真为首要选择依据，其次参考上游/社区推荐、实现成熟度、维护状态、可复现性和运行稳定性。模型文件体积只记录并向用户展示，不作为优先选择条件或默认 tie-break。
- 最终 exact Native 模型及 companion conversion identity、上游 revision、converter source/commit/args、量化、文件、大小、SHA-256、许可证、归属和来源被冻结；
- 任一转换、量化、converter 或 source revision 变化都产生新 candidate identity，并使该模型既有 CUDA 资格与 CPU 功能矩阵失效，必须按完整门禁重跑；
- 模型下载、校验、原子发布、离线复用、损坏修复和受管清理接入现有模型管理体系；Qwen3-ASR 与 ForcedAligner 作为一个逻辑模型下载任务和 readiness 单元，合并总进度，两个 role 全部通过 exact 校验后才原子发布为可用；
- runtime artifact、backend、设备能力和失败原因真实可验证，不借用 CTranslate2 CPU/CUDA 资格扩大其他 backend 的声明；
- Qwen3、Parakeet 与 ReazonSpeech 共享的生产 CrispASR CPU runtime 使用闭集校验后随 NSIS 与 portable 提供；闭集指实际分发文件/依赖/许可/加载根受控，不强制源码裁剪。Qwen 先完成完整 CLI 集成再做最终包装验收，包含其他 backend 代码不提前宣称产品支持；模型权重不得进入安装包；
- CrispASR CPU 必须拥有独立 artifact identity、lock、verifier 和资源根，不合并或改写现有 CTranslate2 CPU artifact；两套 CPU runtime 只是在安装包中共同分发；
- 共享 CrispASR CUDA runtime 使用独立受管 pack 按需下载，不进入 NSIS 或 portable；其 artifact/root 也必须与现有 CTranslate2 CUDA pack 隔离；
- 随包 CPU runtime 加入后，最终 NSIS 必须 `<= 80 MiB`、portable ZIP 必须 `<= 90 MiB`；若最终闭集无法满足预算，必须返回规划重新决策，不得静默改成按需下载或删减许可证/验证文件；
- Qwen3、Parakeet 与 ReazonSpeech 每条模型路线都必须同时取得生产 CPU 和 CUDA 支持；缺少任一设备资格时，该模型迁移不算完成；
- CPU 与 CUDA 使用同一逻辑模型和算法合同，可共享权重，但必须分别证明 runtime、设备解析、真实执行、失败语义和生命周期正确；
- CUDA 使用最终冻结 identity 完成 short-v1、medium-v1、long-v2 的完整质量与性能资格矩阵，资格只依据用户提供 WAV+ASS 与 `native-ground-truth-absolute-v1` 绝对门禁：每 case CER `<=0.35`、语义 confirmed-speech gap `>=1500ms` 为 0、非法 timeline 为 0、CUDA inference RTF `<=0.5`、short cold wall `<=120s`，并应用 backend 对应 RSS 上限与模型专属合法 timing 门禁；legacy Python、S/D/I 分项和 Python delta 仅作诊断，不参与 pass/fail；
- CPU 使用同一逻辑模型和算法完成 short-v1、medium-v1、long-v2 的真实功能矩阵，并验证输出合法性、取消、恢复、离线和清理，但不重复发布 CER、RTF 或独立质量排名；只有 CUDA 质量资格通过且 CPU 功能矩阵通过时，CPU 才可记录 `qualificationSource=inherited-from-gpu`；
- 用户设置、可用性、下载、转录、取消、错误和恢复流程完整接通；
- short-v1、medium-v1、long-v2 及模型特有负向门禁完成，非法时间轴或结构化失败不得被提升为成功结果；Python 输出不得创建/修复 reference、定义 expected output、放宽绝对门禁或形成 Native 非回归要求。

### R3 - Preserve released routes

- 不破坏或撤销已发布的七个 Faster-Whisper、exact Kotoba、Native CPU 与按需 CUDA 路线。
- 任一新模型失败、缺失、损坏或不兼容时，不得影响已发布模型独立启动。
- 不为新模型恢复 Python fallback，也不把开发用本地模型或 runtime 直接作为发布 artifact。

### R4 - Qwen prerequisite first; general VAD last; always CPU

- Qwen 必需的最小 CPU VAD 由 Qwen child 前置接入并冻结，为固定前处理，不开放全局 UI；Qwen 下载总进度和启动 readiness 必须覆盖该依赖。
- Parakeet 必需 CPU VAD 由该 child 复用已冻结 Silero，覆盖逻辑下载/readiness、失败不降级与共享资产清理保护；这是已批准的固定上游前处理，不开放通用设置。其余引擎/通用 Native VAD 仍在三条模型路线完成后实现，不重新设计 Qwen 行为。
- VAD 模型与推理固定使用 CPU，即使主 ASR 模型选择 CUDA；不提供 VAD CUDA runtime、设备选择或 GPU 资格声明。
- 请求中的 `cpu|cuda|auto` 只决定主 ASR 模型设备。CUDA ASR 路线启用 VAD 时，先在 CPU 完成 VAD window 计算，再将窗口交给 CUDA ASR。
- VAD 子任务负责明确适用引擎、协议参数、模型资产、CPU runtime 依赖、时间轴影响和失败策略。
- VAD 已显式启用时，CPU VAD 失败必须结构化失败，不得静默关闭 VAD 后重跑主模型。
- 不因迁移 VAD 改写已经验收的模型输出或自行 gap fill、clip/stretch、伪造时间戳；Qwen 已确认采用的上游 LIS/插值，以及 Parakeet 已确认的上游实际音频再次转录/片段边界重组不受旧 raw-only 禁令约束；两者均不授权应用侧任意修补。

### R5 - Parent boundary

- 父任务负责顺序、共享合同、跨子任务兼容性和最终完整性检查。
- 模型专属算法、质量门禁、runtime 与产品接线由对应子任务拥有。
- 版本号、CHANGELOG、安装包发布、GitHub Release、合并、提交和推送不属于本任务。

## Acceptance Criteria

- [x] AC1: Qwen3-ASR 与 exact ForcedAligner companion 功能迁移及清理已接受，构建锁迁移已落盘；用户明确免除进一步复核后，子任务于 2026-09-09 归档。迁移独立复核未执行，未新增提交或发布。
- [ ] AC2: Parakeet exact 日语模型完成生产 Native ASR 迁移并归档对应子任务。
- [ ] AC3: ReazonSpeech NeMo v2 exact 模型完成生产 Native ASR 迁移并归档对应子任务。
- [ ] AC4: Qwen 必需 CPU VAD 随 AC1 完成，Parakeet 在 AC2 内复用同一必需 CPU Silero；通用 Native VAD 在前三项之后完成迁移，固定 CPU 执行；CPU 与 CUDA ASR 路线均验证 CPU-VAD → ASR 数据流，且不提供 VAD CUDA 路线。
- [ ] AC5: 三条用户可见逻辑模型仍对应原有上游模型且各只暴露一个最终 Native artifact；按 R2 的各模型范围锁定实际产物 identity 与来源/许可，选择理由不得以体积优先，历史开发转换未被未经本轮适用验证地提升为交付权威；Qwen ASR+aligner 通过一个原子下载/readiness 单元交付。
- [ ] AC6: Qwen3、Parakeet 与 ReazonSpeech 均同时支持生产 CPU 和 CUDA；Qwen 与 Parakeet 两种设备各自通过短/中/长功能与生命周期验证，不做质量评分/继承；ReazonSpeech 的 CUDA 按 WAV+ASS 与 `native-ground-truth-absolute-v1` 完成完整质量/性能矩阵且不以 Python parity 判定，CPU 完成真实 short/medium/long 功能矩阵及生命周期门禁且不伪造重复质量指标。
- [ ] AC7: 共享 CrispASR CPU runtime 作为独立闭集 artifact/root 随安装包/portable 提供，共享 CrispASR CUDA pack 使用独立受管 root 按需下载；两者均不覆盖 CTranslate2 runtime，模型权重仍按需下载，最终包满足 80/90 MiB 预算。
- [ ] AC8: 所有新路线均无 Python fallback，并通过模型交付、协议、时间轴、取消、恢复、离线、隐私、许可证和路径边界门禁。
- [ ] AC9: 已发布 Faster-Whisper、Kotoba、CPU/CUDA 与安装版/portable 行为无回归。
- [ ] AC10: 父任务完成跨子任务最终检查；发布工作仍保持独立，未被加入本任务。

## Out Of Scope

- Hikaru Sub 版本发布、版本号、CHANGELOG、安装包上传或 GitHub Release。
- Kotoba K3、普通 Faster-Whisper 新模型、Vulkan、多 GPU 或非 Windows 平台。
- 恢复生产 Python sidecar/runtime 或静默 Python fallback。
- 用 reference repair、自研 synthetic timing、gap fill、clip/stretch 掩盖模型或对齐失败；Qwen 上游 LIS/插值与 Parakeet 上游实际音频再次转录/片段边界重组的批准均不等于授权应用侧任意修补。
