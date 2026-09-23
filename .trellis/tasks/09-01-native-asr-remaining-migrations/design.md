# Remaining Native ASR migrations design

## Boundary

Qwen 已完成固定完整 CLI、默认 Q4_K pair、必需 CPU VAD、LIS/word display 与批准的相邻展示异常合并；双设备功能/交付工程复核和用户 CPU/CUDA 应用确认已接受。独立 CUDA 包已发布，发布复核项由用户接受关闭（非超时独立代理通过）。Qwen 清理已接受；child 保持 in_progress 完成新授权的 build lock 原字节迁至 `native-asr/runtime/full-cli/upstream-engineering-baseline-lock.json` 和 `native-asr/build/full-cli` scratch 解耦，离线独立复核后才由父会话归档。非 Qwen CLI 实现被编译不等于对应模型产品化；Parakeet 已完成独立实施、默认双设备启用、依赖分发和最终复核，用户确认最终应用 CPU/CUDA 均可运行，并于 2026-09-15 完成 owner-authorized commit/archive。ReazonSpeech 已完成三引擎产品接线、CPU/CUDA 短中长功能矩阵、本地应用验证及 owner-authorized shared-v3 dependency/default authority 切换；shared-v2 保留回滚，child 待最终 review/归档，通用 VAD 尚未实施。Parakeet 采用完整上游集成；ReazonSpeech 采用 owner-approved NeMo pure-RNNT `[t,t+1)` 并只与同一次 parent/gap decode 的精确实际 PCM support 求交。两者均执行功能/设备/输出安全/生命周期/交付验收，不做质量评分、性能阈值资格、量化竞赛、自研对齐或 CPU 质量继承。

父任务不实现统一的新 backend，也不把不同模型强行塞进 CTranslate2。它只固定顺序和共享生产合同；每个子任务复用现有 Native worker protocol、Rust host、job lifecycle、模型管理和前端可用性流程，并为实际 backend 提供最小必要扩展。

## Task topology

```text
Qwen3-ASR + ForcedAligner + 必需 CPU VAD
          ↓
Parakeet
          ↓
ReazonSpeech NeMo
          ↓
通用 Native VAD
          ↓
parent integration check
```

- 各 child 拥有 exact 模型 identity、算法和双设备 runtime 合同；Qwen、Parakeet 与 ReazonSpeech 均按各自 upstream pipeline 完成 functional-only 验证。
- Qwen 必需 CPU VAD 在 Qwen child 冻结；Parakeet 已按批准的完整上游日语流程复用该依赖。ReazonSpeech child 仅可把同一 exact Silero 作为 pinned 完整 CLI 的必需 `model + vad` 依赖并覆盖下载/readiness/失败与共享资产保护；这不提前开放通用 VAD。其余引擎与通用 VAD 最后处理，不反向改写 Qwen 流程。
- 父任务只在所有 child 完成后执行跨路线一致性检查，不包含应用发布。

## Shared contracts

### Execution

- Tauri 在启动前解析 engine/model/device/runtime，并把具体设备交给 worker；worker 不接受无法证明的隐式回退。
- 任务开始后失败不得自动换模型、换 backend 或回退 Python 重跑。
- ready、progress、segments、completed、failed、cancelled 与 recovery 继续使用现有 job/worker 合同。

### Model identity and delivery

- 产品逻辑 identity 保持原有上游名称与语义；Native GGUF/其他 backend 格式、量化和转换发布者属于内部 artifact identity，不新增或替换用户可见模型。
- 对应 child 固定一项兼容的上游/社区推荐 artifact，锁定 repository/revision/file/size/SHA/format/quantization/metadata/license/redistribution authority 与已公开转换信息；未知 converter 细节如实记录，不推测或强制复现。
- 任一 artifact bytes、量化或 source revision 变化都创建新 identity；不得把旧 GPU/CPU evidence 改标签后复用。
- artifact 选择不做字幕质量、时间轴保真、CER、RTF 或文件体积竞赛。固定 artifact 必须通过 CPU/CUDA 功能、结构化输出安全、设备、生命周期、许可与分发门禁；若无法满足则 child 返回规划。
- 选择记录只说明上游/社区推荐、兼容性、来源、许可、复现范围和已知限制，不宣称未经验证的质量优势。
- 每个最终逻辑模型由受信 manifest 锁定其产品 identity 与唯一最终转换 artifact closure；量化和转换细节不进入用户选择 UI。
- Qwen3 将 ASR 和 ForcedAligner 作为一个逻辑产品路线的两个明确 role 管理；两个 role 的候选组合整体取得资格，不允许独立拼接两个未共同验证的 artifact。
- Qwen 下载管理暴露一个 logical job：`totalBytes`、`downloadedBytes`、状态和错误覆盖两个 role 与必需 CPU VAD 资产；pair 保持原子发布，启动 readiness 还必须检查共享 VAD。每个 role 可独立续传并复用已通过 exact 校验的 bytes，但 staging 中的单个完成 role 不构成产品 readiness。
- Qwen 发布使用 pair-level atomic install：先在同一 candidate staging root 完成两个 role 的 size/SHA/identity closure，再一次性切换 pair active metadata。网络失败、应用/进程中断或单 role 校验失败保留安全可续传 partial，不改变当前 ready pair，也不发布半套模型。
- 延续现有模型管理器边界，本任务不新增模型下载取消 command 或取消 UI；若以后用户明确需要，再单独增加可恢复的下载取消合同。
- Qwen repair 只重新获取缺失/损坏 role，但完成后仍重新验证完整 pair；用户清理按一个逻辑模型移除两个 role 及其 staging，不能留下可被误判为 ready 的孤立 companion。
- 模型缓存沿用受管 `deps/models` 与下载 staging，不为 CPU/CUDA 复制第二份权重。

### Runtime isolation and distribution

- CTranslate2 CPU/CUDA artifact 身份不自动授权 CrispASR 或其他 backend。
- 新 runtime 必须独立锁定、校验、准备、测量、清理和回滚；只捆绑或下载最终闭集需要的文件。
- 一个共享 CrispASR CPU runtime 闭集随 NSIS 与 portable 提供，先接入 Qwen3，后续由 Parakeet/ReazonSpeech 各自验证复用。闭集是实际分发文件及依赖的身份/许可/加载范围受控，不是 Qwen-only 源码。允许完整 CLI 中未启用的 backend 实现及其必要合法依赖；不分发模型权重、CUDA DLL、开发文件或无关示例程序。
- 现有 CTranslate2 CPU artifact/root 保持原样；CrispASR CPU 使用独立 artifact ID、lock、archive、verifier 和资源子树。资源准备与打包可以在同一命令中处理两棵树，但不得生成一个混合 runtime manifest 或允许跨树 DLL 解析。
- 一个共享 CrispASR CUDA runtime pack 按需下载，服务同三条模型路线；它有独立 source row、外层/内层哈希、原子安装、修复、回滚、测量和清理合同，不进入应用安装包。
- 现有 CTranslate2 CUDA pack/root 保持原样；CrispASR CUDA 使用独立 artifact ID、安装根和 active metadata。probe、repair、cleanup 与启动解析都按 backend 定位，禁止同名 `current` 或环境 PATH 让两个 backend 互相借 DLL。
- CPU 与 CUDA runtime 版本可以分别演进，但每条模型的资格 evidence 必须绑定实际使用的两个 exact artifact identity；任一 artifact 的更新不得覆盖或破坏另一个 backend/device artifact。
- 随包 CPU 闭集必须通过安装版与 portable 的 import/module/文件闭集检查，最终 NSIS `<= 80 MiB`、portable ZIP `<= 90 MiB`。超过预算时停止资格流程并返回规划，不自动切换分发策略。
- Qwen3、Parakeet 与 ReazonSpeech 必须分别具备生产 CPU 与 CUDA execution identity；两种设备可共享模型权重，但不得共享或继承未经验证的 runtime/device 资格。
- `auto` 只能在启动前按已安装且通过预检的 CUDA 优先，否则使用已通过资格的随包 CPU；显式 `cuda` 不得回退 CPU，显式 `cpu` 不得启动 CUDA。
- CrispASR 资源缺失、损坏、回滚或清理不能改变 CTranslate2 artifact bytes、active metadata 或 worker 启动；反向亦然。

### Product availability

- backend 是权威能力来源；前端只展示后端报告为可用的设备。
- 保留用户已保存但当前不可用的模型/设备值，并显示明确中文原因和恢复动作。
- 缺模型或 runtime 时复用现有下载任务和进度 UI，不创建第二套下载器。

### VAD execution

- VAD 固定为 CPU preprocessing stage，不参与主 ASR 的 `cpu|cuda|auto` 设备选择，也不新增 VAD device 字段或 UI。
- CPU ASR 数据流为 `CPU VAD -> CPU ASR`；CUDA ASR 数据流为 `CPU VAD -> CUDA ASR`。
- VAD window 必须携带原始音频偏移并在主 ASR 输出后只加一次，避免 CPU/GPU 数据流产生不同时间轴。
- 显式启用 VAD 后，VAD model/runtime 缺失、损坏或执行失败都结构化失败；不得自动改为 no-VAD 重跑。
- VAD 不提供独立 CUDA runtime pack、不声明 CUDA 加速，模型权重不随 runtime 捆绑或因设备复制。Qwen 完整 CUDA CLI 可包含实际在 CPU 执行的 Silero 实现及 CPU 支撑代码，这不是 VAD GPU 路线。Qwen 必需依赖先冻结，Parakeet 已复用；ReazonSpeech 仅在自己的 functional-only child 中复用同一 exact Silero 与 pinned CLI orchestration，通用 VAD 后续再扩展适用范围。不得重开已完成模型的质量实验或改变既有 Qwen/Parakeet 输入合同。

## Compatibility

- 保持现有 engine ID、model ID、设置字段、ASS 输出和 Tauri command 名称。
- 只做向后兼容的 capability/model-status 扩展。
- 历史 Python sidecar 保留为开发/研究源码，不进入生产探测、运行或打包路线。

## Rollback

- 每个 child 必须能通过关闭自己的 manifest/source/product gate 独立回滚。
- 回滚不得删除其他模型权重、修改 CTranslate2 artifact 或恢复 Python fallback。
- VAD 必须可独立关闭，使模型仍可按其已验收的非 VAD 路线运行，除非对应模型合同明确要求 VAD 为强制依赖；关闭或回滚 VAD 不改变主 ASR 的 CPU/CUDA 资格。

## Device functional boundary

Qwen、Parakeet 与 ReazonSpeech 均采用 CPU/CUDA functional-only 验收：各设备通过短/中/长真实功能、resolved device、输出合法性、取消/恢复/离线/清理验证；不计算字幕质量，不使用 `inherited-from-gpu`。

- 用户已确认所有剩余 ASR 模型都必须同时支持 CPU 和 CUDA。
- 每个 child 必须分别锁定 CPU/CUDA runtime、设备解析、预检、真实执行、错误和生命周期证据；任一设备缺失时不得把该模型标记为迁移完成。
- 两种设备都必须完成 short-v1、medium-v1、long-v2；单例失败也继续执行其余例。非静音输出须合法非空，纯静音允许明确空结果；结构检查覆盖严格 UTF-8/JSON/ASS、有限且位于音频范围内的时间值、正时长、协议顺序和同次运行文本守恒。
- 不计算或承诺 CER、语义缺口、Python parity、字幕质量排名、RTF/冷启动/RSS 性能阈值。实际耗时与资源状态只作为诊断记录，不形成 pass/fail 或设备间继承。
- CPU 与 CUDA 各自证明 runtime/device/lifecycle 正确；不得用编译成功、sibling device 或模块清单推断真实执行。
