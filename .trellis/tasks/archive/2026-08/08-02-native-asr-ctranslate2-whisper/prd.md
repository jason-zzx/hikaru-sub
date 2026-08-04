# 产品化原生 CTranslate2 Faster-Whisper

## Goal

在 T04 protocol v1 和 T05 native host 上实现 ordinary `faster-whisper` 的 Windows x64 production backend，用 authoritative timestamp-driven long-form algorithm 替换 T02 的 fixed non-overlap window PoC。T06 先证明并优化 CPU 路线；若同二进制根因实验仍证明 CTranslate2 CPU 超过冻结 RTF 门槛，则把同一 worker/backend/algorithm 的开发 CUDA 执行移交提前后的 T07，并保留 ordinary faster-whisper 必须交付的硬要求。

## Background

- T04 已由 `9607710 feat(asr): Add native worker protocol v1` 实现并归档；final contract 是 `native-asr/docs/protocol-v1.md`、`native-asr/protocol-v1-limits.json` 和 `windows-x64-release` preset。
- T05 已由 `74d1a4e feat(asr): Host native ASR jobs in Tauri` 实现并由 `a18509a chore(task): archive 08-02-native-asr-rust-job-host` 归档；它提供 generic `NativeAsrHost::new(executable, workerArgs, activeGate)`、`ResolvedNativeLaunch::resolve(...)`、canonical reducer/recovery/cancel，并保持 Release/default Python legacy。
- T02 已证明 CTranslate2 4.8.0 + oneDNN 3.1.1 Windows x64 CPU backend、tokenizer、official mel、timestamp parsing、WAV-end provenance、RTF 和 RSS 可行。
- T02 当前算法是 `stop-revise`：large-v3 short CER `0.3583 > 0.35`；large-v3/Kotoba medium/long 存在 confirmed gaps。根因候选是 fixed non-overlap windows、no previous text 和最小 decode policy，不是 CT2 runtime 不可执行。
- T01 `.asr-benchmark` WAV+ASS 是唯一质量真值。Python large-v2 V4/seed/session/private fork 仅是 regression material，不是 native template。
- 当前 ordinary faster-whisper 模型：`tiny`、`base`、`small`、`medium`、`large-v2`、`large-v3`、`large-v3-turbo`；`large-v3` 是默认。
- 用户决定：ordinary faster-whisper 必须交付，`large-v3` 与 `large-v2` 长音频是硬门槛；其余模型失败不阻塞已通过的 native route，但必须实测并保留资格状态。T17 仍显示所有模型，不通过的模型不静默回退 Python。
- Candidate A 已完成首轮测量：large-v3 short CER `0.3583 > 0.35`，medium CPU RTF `1.100 > 1.0`，long 在 7,200s 受控上限后终止。该 `stop-revise` 结论为 provisional，T06 不得在 CPU RTF 根因诊断前归档。
- 同二进制 warmed 120s 根因矩阵已完成：fixed/no-history/beam5 RTF `0.842`，timestamp/no-history/beam5 `0.916`，timestamp/full-history/beam5 `1.321`，timestamp/full-history/beam1 `0.988`。A/B 证明 CT2 large-v3 CPU 本身尚未达到固有 ceiling；B→C 的 `+44.2%` 确认 full-history prefill 是主回归因子，C→D 的 `-25.2%` 证明 beam 5 在 full-history 配置中显著增加总成本，但四格矩阵不单独证明 beam/history 交互效应。D 生成更多 token/overlap，不因 RTF 低于 `1.0` 获得候选或资格状态。
- 后续同二进制 short-v1 单变量 decode selection 仅比较 timestamp-driven/no-history beam 1 与 beam 5：beam 1 CER/RTF `0.2667/0.632`，beam 5 `0.3583/0.811`，两者 timeline/gap 均为 0，因此选择最低成本且唯一质量通过的 beam 1；未扩展 beam 3/10。
- 新 `selected-cpu-candidate-lock.md` 保持 Candidate A/CPU-RTF/selection 历史身份分离，并冻结 timestamp-driven、`conditionOnPreviousText=false`、beam 1。独立审查修正 diagnostic-default drift 并强化 evidence identity 后，以修订 lock 重跑的 authoritative large-v3 short 为 CER `0.2667`、warm RTF median `0.623`、cold wall `28.342s`、RSS `3.43 GB`、0 timeline/gap；medium 为 CER `0.1134`、RTF `0.559`、RSS `3.43 GB`、0 timeline/gap。随后同一 lock/runtime 的 long-v1 为 CER `0.2653`、RTF `0.550`、RSS `3.43 GB`、0 timeline error，但有 7 个 confirmed gap `>=1500ms`，因此 selected CPU candidate 为 `stop-revise`。large-v2、其余模型和七模型矩阵均未启动；路线保持未 qualified/未启用。
- 必需的 Candidate B 已按 `candidate-b-lock.md` 实现为现有 CT2 backend 内的 direct official ONNX Runtime `1.28.0` CPU session 与 exact faster-whisper 1.2.1 Silero V6；focused CTest、protocol-only build、final identity 与 T01 adapter/publisher 均已建立。最后独立审查 blocker 修复后的 final lock `e687ead6...` / config `75dedb49...` 绑定实际 CPU、canonical loaded-module paths、两项 restricted PATH root identity `77f4714a...` 与 module layout `a650e185...`，并通过包含 correlated all-root rewrite 的 21 项 mutation matrix；large-v3 short replacement 为 CER `0.2667`、warm RTF median `0.654`、cold wall `29.544s`、RSS `3.44 GB`、0 timeline/gap，全部通过；medium replacement 为 CER `0.1055`、RTF `0.599`、RSS `3.44 GB`、0 timeline error，但仍有 1 个 confirmed gap `>=1500ms`，因此 Candidate B 为 `stop-revise` 并在 medium gate 立即停止。long-v1、large-v2、其余模型、T07 与 GPU 均未运行；route 保持未 qualified/未启用，ORT/VAD 不进入 T13 package input。
- `research/start-gate-lock.md` 已锁定 Candidate A official/community source、一个 conditional Silero V6 Candidate B asset、七模型 immutable revision/model-weight hash/license 和 task-local privacy boundary，并由 Candidate B lock 补齐 executor、attribution 与 conditional T13 packaging impact。Tiny 当前未缓存但 public/ungated/pinned，不阻塞启动。

## Requirements

### R1 - Dependencies And Authority

- Hard dependency：archived T01 benchmark contract、archived T02 lock/source/evidence、final T04 protocol/limits 和 archived T05 host/spec handoff；T06 不重定义其 JSONL/reducer/recovery contracts。
- 实现来源顺序：official OpenAI Whisper/CTranslate2 APIs 与模型 metadata；当前维护良好的社区 long-form 实现；T01 ground-truth 实测选择；Python 仅诊断。
- Candidate A source/model revision 保持在 start-gate lock；Candidate B source/model/executor/algorithm/packaging boundary 固定在 `candidate-b-lock.md`。任何 Candidate B model-backed measurement 前必须以实现后的新 executable/DLL/VAD/config/tool identity 写入新的 final candidate lock；不得改写历史 `algorithm-lock.md` 或边看同一 corpus 结果边加入未记录的 case-specific heuristic。
- 复用 T01 comparator；不得复制 CER/gap/timeline/report 逻辑或用 Python parity gate。

### R2 - Engine And Product-Model Scope

- 只拥有 ordinary `faster-whisper` CTranslate2 algorithm/CPU diagnosis；提前后的 T07 只拥有同一路线的开发 CUDA 执行 seam，Kotoba 推理、Kotoba-only cache 和 legacy CT2 cache compatibility 属于 T08。
- 枚举全部七个现有模型 ID。CPU branch 在 T06 完成全矩阵；若 T06 证明 CPU ceiling，则 T06 保留 provisional dispositions，完整 CUDA 七模型矩阵明确移交 T15；若资格矩阵尚未完成但迁移交接材料已齐，T06 可按 `migration-handoff-stop-revise` 交接而不宣称任何资格分支。
- `large-v3` short/medium/long 全部门槛通过，是切换默认 route 的硬条件；CPU branch 由 T06 证明，GPU-required branch 由 T15 证明。
- `large-v2` 必须覆盖 short/medium/long，并显式通过 Japanese `>10min`/long regression；CPU branch 由 T06 拥有，GPU-required branch 由 T15 拥有。
- 其余模型按完整测量标记：
  - `qualified`：所有要求 case 通过；
  - `stop-revise`：可运行但质量/性能/时间轴未通过；
  - `unsupported-for-native-release`：模型格式、许可证或稳定 API 无法支持。
- 非默认模型失败不阻塞 qualified native faster-whisper；T06 输出 CPU/设备决定与 qualification metadata，T16/T17 控制可用性但继续显示所有模型。

### R3 - Minimal Authoritative Long-Form Algorithm

按最小候选梯子实施：

1. 保留 T02 已验证的 WAV、official mel、tokenizer、30s model timestamp window 与 source-window distinction；
2. 用 decoded timestamp evidence 推进 seek，而不是无条件 fixed window 跳步；
3. 实现 pinned official prompt/history reset、consecutive timestamp、no-speech 和 invalid-generation 行为；
4. 只做可证明的 overlap duplicate removal，不生成文本/时间；
5. 先对 large-v3 short/medium/long 评估；如果所有门槛通过即停止，不增加 VAD；
6. 若仍有 confirmed gaps，只评估 `candidate-b-lock.md` 中的 faster-whisper 1.2.1 Silero V6 candidate；规划 gate 已锁定 official ORT 1.28.0 Windows x64 CPU ZIP、direct session、exact VAD behavior/asset 和 conditional T13 packaging impact。实现仍须经过独立 review，并且只保留有 ground-truth 改善且全部合同通过的最小方案。

不得默认复制 Silero V4 compression、Python hard-hole/backfill、private generation fork 或 corpus-specific transcript repair。

### R4 - Native Worker Integration

- 在 T04 单一 `native-asr/` 工程中创建 production `hikaru-asr-worker` executable/CMake target 和 entry point；T04 `hikaru-asr-fake-worker` 保持独立 test-only target。
- Production entry 读取一行 protocol v1 request、按 engine/backend dispatch，并在本任务只启用 ordinary faster-whisper；未实现 route 返回稳定 pre-ready error，不创建第二个 worker/protocol。
- Model-backed development runs通过 T05 internal `ResolvedNativeLaunch::resolve(...)` 注入 task-local locked absolute model path 和 resolved CPU，并用 `NativeAsrHost::new(productionWorker, [], activeGate)` 启动无 scenario 参数的真实 worker；T12/T16 后续提供 production resolver。T06 不下载、不决定镜像、不写 readiness marker。
- 在 `src-tauri/src/asr_worker.rs` 的 test module 增加真实 worker/CT2 focused integration；test-only env 固定为 `HIKARU_ASR_PRODUCTION_WORKER`、`HIKARU_ASR_CT2_MODEL_PATH`、`HIKARU_ASR_CT2_AUDIO_PATH`。测试将音频复制到临时受管 workspace 后构造 launch；Release/product route 不读取这些变量。
- T06 只实现和诊断 CPU path；开发 CTranslate2 CUDA seam 属于提前后的 T07，正式可复现 GPU packs 与 qualification 分别属于 T14/T15。
- 输出稳定 structured errors；stdout 仅 JSONL，stderr 有界诊断。
- Progress 以已确认处理的 source audio 单调推进；不以 30s padded model duration 冒充 source progress。
- 在窗口/生成边界检查 cancellation；单次 backend call 无法 cooperative interrupt 时由 T05 process-tree kill 保证取消。
- 只有 selected final pipeline 真正修正已发 segments 时使用 `segmentsReplace`。

### R5 - Timeline And Segmentation Integrity

- 每个 segment 非空、排序，`0 <= startMs < endMs <= verified durationMs`。
- 保留 source slice、30s model timestamp range、raw token-derived end、最终 end 和 WAV-end bound flag 的 ignored evidence。
- start at/after WAV end 直接失败；end 仅在 raw end 合法处于 model range 时可显式 bound 到 WAV end。
- 不从 reference、Python 或平均分配生成时间戳/文本。
- Segmentation 必须适合 subtitle 输出，不接受用一个全片巨段规避 gap gate；报告 subtitle-length distribution。

### R6 - Qualification Matrix

- 所有七个模型使用同一冻结 algorithm/config family，除 model metadata 要求外不得每模型私下调参隐藏失败。
- CPU branch 每模型 short 至少 1 cold + 3 warm，medium/long 记录明确样本数；每个 retained/qualified model/case 独立满足 CER `<=0.35`、CPU inference RTF `<=1.0`、short cold wall `<=120s`、CT2 RSS `<=6 GiB`、0 timeline error、0 confirmed gap `>=1500ms`。
- GPU-required branch 不在 T06 伪装完成：T06 发布 `gpu-required-pending` 和 provisional dispositions，T15 使用 T14 pack 对全部七模型执行同等 short/medium/long 矩阵并要求 accelerated RTF `<=0.5`。
- `large-v2` long 必须覆盖 authoritative `long-v1`（>10min）；当前 Python special path 仅显示为 supplemental regression comparison。
- 记录 corpus/manifest/case/audio、model revision/file hash、input lock、executable/DLL、algorithm-config、environment 和 raw-result identity。
- Corpus 缺少 `low-volume`，报告该限制，不宣称完整 acoustic coverage。

### R7 - Evidence, Privacy And Supply Chain Boundary

- Task-local `research/local/` 保存 build/models/raw/token traces 并由 active/archive 通用规则精确 ignore；tracked evidence 只含 identity、aggregate metrics、distribution、failure trace hash、source citations 和 route dispositions。
- 一个发布结论只能使用单一 final binary/DLL/lock/config identity；failed evidence 必须完整且不评分。
- deterministic publisher 重跑字节一致；无 transcript text、absolute path、model/runtime binary 或 private media 进入 Git。
- T13 负责可复现 CPU packaging pipeline、provisional artifact 和 dependency/license inventory；只有 Candidate B 通过 large-v3 short/medium/long 并被 retained 时，T13 才加入 locked ORT/VAD runtime、license 和 notices。T18 使用 accepted engine identities 重建并认证最终 CPU release artifact。T06 development binary 只是算法/qualification evidence。

### R8 - CPU RTF Root-Cause Gate

- 在新的 long/full-corpus run 前，使用同一诊断二进制和不超过 120s 的相同音频切片依次运行：fixed/no-history/beam5、timestamp/no-history/beam5、timestamp/full-history/beam5、timestamp/full-history/beam1。
- 每窗口保留 prompt/history/prefix/generated token 数、feature/generate 时间、seek/overlap、generation/fallback 次数、resolved threads，以及 CPU/oneDNN/OpenMP/loaded-module/ISA evidence。
- 只有 no-history control 仍慢时才增加 `return_scores` 开关和 thread sweep；每个 probe 一次只改一个变量。
- 诊断切片只用于因果判断，不是资格证据。任何被选中的 CPU 候选必须以新冻结 identity 重跑 authoritative short/medium/long。
- 如果验证后的 CPU 候选达到 RTF `<=1.0`，T06 保留 CPU route并完成 CPU 全矩阵；如果确认 CPU ceiling，T06 可在独立审查后以 `gpu-required-pending` 完成 CPU 调查/worker handoff，并把同一 seam 交给 T07；如果 production worker、selected CPU baseline、Candidate B reviewed stop-revise evidence、Python non-gating comparison、deterministic publishers、host/protocol tests 与 downstream handoff 均完成但资格分支未被证明，T06 可在独立审查后以 `migration-handoff-stop-revise` 完成 truthful handoff。后两种状态均不启用 ordinary faster-whisper；完整七模型 CUDA 资格属于 T14 pack + T15 qualification，未通过的 CPU route不得静默启用或回退 Python。

### R9 - Closure Branches And Handoff

T06 必须在独立审查后明确选择且只选择一个闭合分支：

1. `cpu-qualified`：CPU branch 完成 `large-v3`/`large-v2` hard gates 与七模型 dispositions；
2. `gpu-required-pending`：同二进制证据证明 CPU ceiling，发布 T07/T14/T15 handoff 和 provisional dispositions；该分支不声称 GPU qualification，也不启用 route；
3. `migration-handoff-stop-revise`：production worker、Candidate A selected CPU baseline、Candidate B reviewed `stop-revise` evidence、Python non-gating comparison、deterministic publishers、T05 host/protocol tests 和 downstream handoff 完成，但没有 qualification branch 被证明。该分支保留 Candidate A long-v1 的 7 个 confirmed gaps、Candidate B medium 的 1 个 confirmed gap、全部其余模型 `blocked-not-run`、`low-volume` corpus limitation、native route disabled、Release/default Python legacy，以及 T07 仅为可选 development CUDA seam；它不是 product qualification 或 GPU-required decision。T08 仍可独立开始 Kotoba/native CT2 工作；Candidate B 失败也意味着 ORT/VAD 不进入 T13 packaging。

任何分支都不得删除 ordinary faster-whisper hard requirement、large-v3/large-v2 hard gates 或通过 Python parity、synthetic timing、reference repair 取得资格。


- [x] Candidate B rollback-to-planning gate 已完成：`candidate-b-lock.md` 固定唯一 ORT 1.28.0 official Windows x64 CPU executor、archive/extracted/license/notices/VC-runtime/package identities、Silero v6.0 attribution、ordinary faster-whisper 1.2.1 V6 algorithm；exact model CPU/no-custom-op zero-input smoke 通过且所有输出保留在 canonical ignored root。
- [x] `start-gate-lock.md` 中 Candidate A/B source、七模型 revision/weight hash/license 与 ignored local boundary 在 Candidate B implementation/final locks 中保持一致；Tiny 因 medium stop condition 未获取、未运行。
- [x] T02 WAV/mel/tokenizer/timestamp/source-vs-model-window/WAV-end provenance contracts保留并有 CTest。
- [x] Selected algorithm 由 decoded timestamps 推进 seek，不再使用 unconditional fixed non-overlap windows。
- [x] CPU RTF 同二进制四单元诊断矩阵完成并保留逐窗口 token/timing/seek/thread/runtime evidence；现有 history/beam 假设未在实验前写成根因结论。
- [x] T06 在独立审查后选择且只选择一个闭合分支：当前选择为 `migration-handoff-stop-revise`；该分支在 worker、Candidate A selected CPU baseline、Candidate B reviewed stop-revise evidence、Python non-gating comparison、deterministic publishers、host/protocol tests 与 downstream handoff 完成但资格未被证明时 truthful handoff，不声称 qualification 或 GPU-required，也不启用 route。原始 `cpu-qualified` 与 `gpu-required-pending` 分支要求仍保留。
- [ ] CPU branch 中 `large-v2` authoritative long-v1 明确覆盖 Japanese >10min regression；GPU-required branch 将该硬门槛和完整七模型 CUDA dispositions 明确交给 T15。
- [x] 全部模型 ID 保留并交给 T17 展示；Candidate B medium stop 后的失败或 blocked 状态不从列表隐藏。
- [ ] Qualified models 输出 subtitle-usable segments，无单巨段规避、synthetic timing、reference repair 或 Python parity gate。
- [x] Production `hikaru-asr-worker` target/main 存在且与 fake worker 分离；通过 T05 `NativeAsrHost`/`ResolvedNativeLaunch` 的真实 worker focused test，protocol progress 单调，cancel 不产生 completed，structured failure/recovery 保持兼容。
- [x] 资格分支的质量结果复用 T01 comparator 并绑定单一 final binary/DLL/lock/config identity：`cpu-qualified` 要求完成 T06 CPU 全矩阵；`gpu-required-pending` 将完整 CUDA 矩阵交给 T15；当前 `migration-handoff-stop-revise` 已对所有已运行/失败/派生记录完成 comparator 与 identity 校验，并明确保留未运行模型为 `blocked-not-run`，不把缺失矩阵当作资格证据。
- [x] Candidate A/selected/Candidate B evidence publishers 均确定性，tracked artifacts 无私有文本/路径/大型 binary/model。
- [x] 未实现 Kotoba、downloader/readiness、release packaging、GPU、settings 或 frontend；T06 只输出 CPU diagnosis、worker seam 与未启用的 `stop-revise` evidence。

## Out Of Scope

- 开发 CTranslate2 CUDA 执行（T07）；Kotoba 与 legacy Hugging Face CT2 cache（T08）。
- CrispASR engines（T09～T11）。
- Model manifest/download/readiness（T12）。
- CPU packaging pipeline/provisional artifact（T13）、formal GPU packs/qualification（T14/T15）与 final rebuild/attestation（T18）。
- Settings/runtime dependency/UI changes（T16/T17）。
- 隐藏未通过模型、静默 Python fallback 或复刻 Python private fork。

## Rollback

禁用 ordinary faster-whisper native route并保留 T05 host/legacy path；删除 task-local ignored Candidate B ORT/preflight/build/raw evidence。若 Candidate B 未 retained，T13 不包含 ORT/VAD。保留全部 Candidate A/diagnosis/selection/selected short-medium-long evidence，不修改用户模型/cache/project。
