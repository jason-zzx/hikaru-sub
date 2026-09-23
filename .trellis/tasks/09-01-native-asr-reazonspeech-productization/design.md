# ReazonSpeech Native 产品化设计

## 1. 决策与边界

以 pinned CrispASR v0.8.32 的完整 CLI 为唯一生产执行面，显式选择 `reazonspeech` backend，传入 exact `model + vad` 路径。ReazonSpeech 与 Parakeet 复用 FastConformer/RNNT upstream backend 和进程安全层，但保持独立 logical model、runtime engine authorization、解析断言、测试与资格证据。

不恢复 archived R2 的 direct session ABI、调用方 VAD 窗口或“一窗口一 top-level cue”实现。旧 R2 failure 是诊断输入，不是当前算法基线。

## 2. 模型与转换锁

1. 冻结 `reazon-research/reazonspeech-nemo-v2` 与 `cstr/reazonspeech-nemo-v2-GGUF` 的 exact revision、上游 registry 推荐 Q8_0 的 bytes/SHA、模型卡、许可证和 GGUF metadata。
2. 如实记录仓库公开的 converter、quantizer 与生成信息；未知细节保持 unknown，不推测、不为补齐未公开参数启动转换研究。
3. 产品直接使用这一项 exact Q8_0；不建立 F16/Q4_K 质量或体积竞赛，也不从历史 R1/R2 继承资格。
4. Q8_0 只接受 CPU/CUDA 功能、设备、结构化输出安全、许可和交付验证。若无法执行、无法合法再分发或持续违反结构合同，则保留证据并返回规划，不自动切换 artifact。
5. 生产 manifest 只记录最终唯一 artifact；raw transcript/logit 与模型运行输出保持 ignored-local。候选身份仅由现有 candidate lock/archive verifier 负责。

## 3. Runtime 与授权

- 复用共享 CrispASR CPU root 与 CUDA managed root，不创建 per-model runtime。
- 当前 CLI/DLL 与 published shared-v3 `crispasr-product-lock.json` 均授权 `reazonspeech-nemo`；shared-v3 使用 exact reviewed candidate bytes，旧 shared-v2 artifact/lock 原样保留用于回滚。
- runtime verifier、Rust build capability 与 launch path 必须同时检查所选 engine membership；缺失、损坏或 device authority 不一致继续 fail closed。
- CUDA asset upload、source-row/default-lock 切换已按独立 owner 授权完成；这只是 dependency publication/default enablement，不是应用发布。
- Qwen/Parakeet/CT2 runtime root 与 DLL closure 不得交叉查找或覆盖。

## 4. 数据流

`model status/download → runtime/device resolve → NativeAsrHost private workspace → worker → pinned crispasr CLI → bounded JSON/display result → strict adapter validation → atomic segmentsReplace → completed → existing ASS persistence`

### Worker/CLI

- 将现有 full-CLI adapter 的共享进程层扩展到 `Engine::ReazonSpeechNemo`，不建立新的 backend abstraction。
- request roles 固定为 `model` 与 `vad`；拒绝 aligner、多余/缺失 role、reparse point、非普通文件和不匹配的共享 VAD。
- argv 使用显式 backend、model、VAD、audio、result、Japanese/source settings 与 device；禁用 registry name、auto-download、隐式 model guessing、网络、FFmpeg shell fallback 和 inherited `CRISPASR_*` tuning。
- 保持 canonical same-volume relative audio、私有 output/cache/TEMP、suspended creation/Job assignment、allowlisted environment 与 bounded watchdog。
- 不覆盖 upstream 日语 VAD/12 秒 slice/gap-fill默认；不传自定义 chunk/overlap、beam、MAES 或调用方 stitch 参数。

### 输出

- 使用 upstream 完整 CLI 的实际 display rows，而不是旧 direct-ABI top-level window result。
- 解析前执行 bounded byte length、raw-NUL、strict UTF-8 与完整 JSON 消费检查。
- 验证 backend/model 完成状态、整数有限时间、单位、audio bounds、positive duration、start order、非空文本、text conservation 与最大 cue/text 数量。
- Pure-RNNT 非空 token 采用 NeMo `[t,t+1)` encoder-cell interval；随后只将 token/word/segment end 与同一次 parent/gap decode 的精确实际 PCM sample support 求交，移除卷积 padding 超出真实输入的范围。start 不变；support 不匹配、越界或非正交集 fail closed。不得使用 next cue、display row、逻辑 VAD/slice end、相邻合并、比例扩展或参考文本修复。
- pure silence 可产生 truthful empty success；VAD/decode/JSON/timeline failure 必须结构化失败且不发 partial replacement。

## 5. 设备与生命周期

- CPU 路线必须在 CLI 启动前禁止 CUDA 初始化/加载。
- CUDA 路线必须验证完整 own-root 6-DLL closure，并通过 ReazonSpeech-specific trace/guard 证明 encoder、predictor、joint graph 在 CUDA 执行。区分 upstream 固有 host token loop/VAD 与 silent graph fallback。
- `auto` 只在 worker 启动前选择已验证 runtime；已启动 GPU task 不重跑 CPU。
- 复用现有任务级串行 mutex、owned process inventory、120 秒 monotonic-progress watchdog、取消/Job-tree termination/reap/gate release 与 CUDA recovery sentinel。
- 任一模型调用被外部终止后，后续 authoritative CUDA 数据必须等待相同 frozen identity 的 short sentinel 在 120 秒内成功。

## 6. 模型管理与 UI

- 在 `native-asr-models.json` 增加一个 ReazonSpeech logical model，引用唯一 ASR file 与现有 exact shared Silero source；下载 job 对两者统一 readiness，但 verified shared VAD 可只读复用。
- 复用现有 staging、resume、hash verify、atomic publish、repair、offline reuse 和 cleanup，不新增取消 command/UI。
- `asr_models.rs`、runtime status 与 `build.rs` capability 只在 runtime engine membership 和 exact model readiness 同时满足时声明可用。
- 设置页、ModelManager、TranscribeView 复用现有 engine/model/device payload；只新增用户可见模型选项与必要中文说明，不增加源语言、量化、VAD 或 backend 控件。

## 7. 验证与资格

### P1：模型/CLI 真实 smoke

- source/argv/device trace 先于第一次模型运行。
- 串行 short CPU→CUDA smoke，以 candidate lock/archive verifier 绑定 exact runtime，并验证 model/audio、display rows、own-root module closure 与 device proof。
- 同一 fresh shared candidate 回归 Qwen CPU/CUDA 与 Parakeet CPU/CUDA 的最小真实 smoke；CT2 用现有隔离测试。

### P2：worker/host/ASS

- model-free contract/fault tests 覆盖 role、argv、backend、device、Unicode/path、offline、严格 JSON、zero-duration、silence、cancel/reap/cleanup、已有 ASS 保留。
- 真实 CPU/CUDA cancel→recovery→short host flow；所有 accepted output 只发生一次 atomic replacement。

### P3：模型管理/UI

- manifest schema、URL derivation、resume、corrupt repair、offline reuse、shared VAD、cleanup 与 capability gating 测试。
- 前端 exact model + cpu/cuda payload、下载后启动、未就绪禁用和错误保留字幕测试。

### P4：最终功能矩阵

- CPU/CUDA 每台设备内串行执行 short-v1、medium-v1、long-v2；即使一例失败仍执行其余例。
- 两种设备都验证真实完成、resolved device、无静默回退、exact decode-PCM-support intersection、结构化输出安全、进度与生命周期；非静音要求合法非空输出，纯静音允许明确空结果。
- 不计算 CER、语义缺口、Python parity、RTF/冷启动/RSS 阈值或质量排名；耗时与资源状态只作为诊断记录，CPU 不继承 GPU 质量标签。
- 最终 `shared-reazonspeech-final-r1` 矩阵已通过：CPU 12/207/1166 rows，CUDA 12/206/1159 rows（short/medium/long）。运行输出保持 ignored-local，身份只通过 candidate lock/archive verifier 绑定。

### P5：产品/包

- owner 已明确授权 dependency publication/default enablement；exact CUDA archive 已作为新 immutable shared-v3 asset 上传，source rows/default lock 已更新，official/China hash/install/closure/engine/probe 验证通过，shared-v2 未覆盖或删除。
- `pnpm release:local` 只作本地 NSIS/portable 验证：无模型权重、无 Python/NeMo、CPU runtime 包体预算不回归。
- 真实 local app 完成 CPU/CUDA 模型选择→转录→ASS 保存确认；这不构成应用 release readiness。

## 8. 回滚

- 任何发布后回归：默认 authority/CPU resource/source rows 回退到保留的 shared-v2，保持 Qwen/Parakeet 可用；不得删除或覆盖已发布的 immutable shared-v3 asset。
- 若 exact Q8_0 无法执行、无法合法再分发或违反结构化输出合同，保留 ignored-local 诊断并回到规划；不自动验证 F16/Q4_K，也不得用未批准的时间轴修复掩盖。
- 已批准的 pure-RNNT `[t,t+1)` + exact parent/gap decode PCM-support intersection 是唯一 Reazon endpoint correction；其失败必须结构化返回，不恢复 R2 或 Python。
- ReazonSpeech 可通过移除自身 model availability/engine membership 独立回滚，不清理其他模型权重或 runtime。
