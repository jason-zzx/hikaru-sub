# Remaining Native ASR migrations design

## Boundary

Qwen 已完成固定完整 CLI、默认 Q4_K pair、必需 CPU VAD、LIS/word display 与批准的相邻展示异常合并；双设备功能/交付工程复核和用户 CPU/CUDA 应用确认已接受。独立 CUDA 包已发布，发布复核项由用户接受关闭（非超时独立代理通过）。Qwen child 仅保留 in_progress 清理，build-consumed task lock 暂不移动/归档。非 Qwen CLI 实现被编译不等于对应模型产品化；Parakeet/Reazon/通用 VAD 待后续独立实施。下文质量/转换竞赛/CPU 继承条款只适用其他 child，不恢复 Qwen raw-only/DP/源码裁剪要求。

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

- 各 child 拥有 exact 模型 identity、算法和双设备 runtime 合同；Qwen 按已接受功能范围验证，Parakeet/Reazon 仍须各自取得绝对质量资格。
- Qwen 必需 CPU VAD 在 Qwen child 冻结；其他引擎与通用 VAD 最后处理，复用该依赖，不反向改写 Qwen 流程。
- 父任务只在所有 child 完成后执行跨路线一致性检查，不包含应用发布。

## Shared contracts

### Execution

- Tauri 在启动前解析 engine/model/device/runtime，并把具体设备交给 worker；worker 不接受无法证明的隐式回退。
- 任务开始后失败不得自动换模型、换 backend 或回退 Python 重跑。
- ready、progress、segments、completed、failed、cancelled 与 recovery 继续使用现有 job/worker 合同。

### Model identity and delivery

- 产品逻辑 identity 保持原有上游名称与语义；Native GGUF/其他 backend 格式、量化和转换发布者属于内部 artifact identity，不新增或替换用户可见模型。
- 对应 child 可以评估历史 cstr 转换、自建转换或其他可合法再分发的候选，但 discovery/acquisition/qualification 必须分离。历史 Q4_K/Q8_0 bytes 仅是 candidate baseline，不能因已有 smoke evidence 自动进入 manifest。
- 候选锁同时绑定上游 repository/revision/files/hashes、converter repository/commit/toolchain/arguments、量化、输出 files/sizes/hashes、metadata、license/attribution 和 redistribution authority。
- 任一上游、converter、参数、量化或输出 byte 变化都创建新 candidate；不得把旧 GPU/CPU evidence 改标签后复用。
- 候选选择不是“最小文件获胜”。所有候选先独立通过 WAV+ASS ground truth 与 `native-ground-truth-absolute-v1` 门禁；若多个候选均通过，优先选择字幕质量/时间轴证据最强的候选，再综合上游或社区推荐、converter/runtime 成熟度、维护与复现能力、CPU/CUDA 稳定性和许可分发风险。legacy Python 与 S/D/I 分项仅作诊断，不形成非回归门禁。体积仅作为记录项；只有实际下载、存储或设备约束使候选无法通过既定门禁时才影响资格。
- 最终选择必须生成审阅过的 candidate-selection record，列出合格候选、逐项证据、社区/上游依据、tradeoff 和选择理由；不得使用未记录的主观“最合理”。
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
- VAD 不提供独立 CUDA runtime pack、不声明 CUDA 加速，模型权重不随 runtime 捆绑或因设备复制。Qwen 完整 CUDA CLI 可包含实际在 CPU 执行的 Silero 实现及 CPU 支撑代码，这不是 VAD GPU 路线。Qwen 必需依赖由 child 先冻结，通用 VAD 后续复用；不得重开质量实验或改变既有 Qwen 输入合同。

## Compatibility

- 保持现有 engine ID、model ID、设置字段、ASS 输出和 Tauri command 名称。
- 只做向后兼容的 capability/model-status 扩展。
- 历史 Python sidecar 保留为开发/研究源码，不进入生产探测、运行或打包路线。

## Rollback

- 每个 child 必须能通过关闭自己的 manifest/source/product gate 独立回滚。
- 回滚不得删除其他模型权重、修改 CTranslate2 artifact 或恢复 Python fallback。
- VAD 必须可独立关闭，使模型仍可按其已验收的非 VAD 路线运行，除非对应模型合同明确要求 VAD 为强制依赖；关闭或回滚 VAD 不改变主 ASR 的 CPU/CUDA 资格。

## Device qualification boundary

Qwen 例外：CPU 与 CUDA 各自通过短/中/长真实功能、设备、取消/恢复/离线/清理验证；不计算字幕质量，不用 `inherited-from-gpu`。下面质量矩阵条款仅适用于其他未重建 child。

- 用户已确认所有剩余 ASR 模型都必须同时支持 CPU 和 CUDA。
- 每个 child 必须分别锁定 CPU/CUDA runtime、设备解析、预检、真实执行、错误和生命周期证据；任一设备缺失时不得把该模型标记为迁移完成。
- CUDA 是质量与性能资格的权威设备：最终冻结 identity 必须完成 short-v1、medium-v1、long-v2 的完整 CER/timeline/gap/performance/resource 矩阵，并仅按 WAV+ASS 与 `native-ground-truth-absolute-v1` 判定。每 case CER `<=0.35`、语义 confirmed-speech gap `>=1500ms` 为 0、非法 timeline 为 0、CUDA inference RTF `<=0.5`、short cold wall `<=120s`；应用 backend RSS 上限和模型专属绝对 timing 门禁。Python 历史输出不参与 pass/fail。
- CPU 必须在最终 CPU runtime 上真实完成 short-v1、medium-v1、long-v2 功能矩阵，并验证合法输出、取消、恢复、离线和清理；CPU 不重复发布 CER、RTF 或独立质量排名。
- CPU 只有在 exact CUDA candidate 通过且自身功能矩阵通过后，才能记录 `qualificationSource=inherited-from-gpu`。不得把 GPU 指标复制到 CPU 字段，也不得用编译成功或 sibling device 推断 CPU 可用。
