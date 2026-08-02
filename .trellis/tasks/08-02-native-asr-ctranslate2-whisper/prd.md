# 产品化原生 CTranslate2 Faster-Whisper

## Goal

在 T04 protocol v1 和 T05 native host 上实现 ordinary `faster-whisper` 的 Windows x64 CPU production backend，用 authoritative timestamp-driven long-form algorithm 替换 T02 的 fixed non-overlap window PoC，使 `large-v3` 默认模型和 `large-v2` 日语长音频通过 T01 冻结门槛，并对所有现有 ordinary faster-whisper 模型给出可审计的原生资格结论。

## Background

- T04 已由 `9607710 feat(asr): Add native worker protocol v1` 实现并归档；final contract 是 `native-asr/docs/protocol-v1.md`、`native-asr/protocol-v1-limits.json` 和 `windows-x64-release` preset。
- T05 已由 `74d1a4e feat(asr): Host native ASR jobs in Tauri` 实现并由 `a18509a chore(task): archive 08-02-native-asr-rust-job-host` 归档；它提供 generic `NativeAsrHost::new(executable, workerArgs, activeGate)`、`ResolvedNativeLaunch::resolve(...)`、canonical reducer/recovery/cancel，并保持 Release/default Python legacy。
- T02 已证明 CTranslate2 4.8.0 + oneDNN 3.1.1 Windows x64 CPU backend、tokenizer、official mel、timestamp parsing、WAV-end provenance、RTF 和 RSS 可行。
- T02 当前算法是 `stop-revise`：large-v3 short CER `0.3583 > 0.35`；large-v3/Kotoba medium/long 存在 confirmed gaps。根因候选是 fixed non-overlap windows、no previous text 和最小 decode policy，不是 CT2 runtime 不可执行。
- T01 `.asr-benchmark` WAV+ASS 是唯一质量真值。Python large-v2 V4/seed/session/private fork 仅是 regression material，不是 native template。
- 当前 ordinary faster-whisper 模型：`tiny`、`base`、`small`、`medium`、`large-v2`、`large-v3`、`large-v3-turbo`；`large-v3` 是默认。
- 用户决定：`large-v3` 与 `large-v2` 长音频是硬门槛；其余模型失败不阻塞已通过的 native route，但必须实测并保留资格状态。T16 仍显示所有模型，不通过的模型不静默回退 Python。

## Requirements

### R1 - Dependencies And Authority

- Hard dependency：archived T01 benchmark contract、archived T02 lock/source/evidence、final T04 protocol/limits 和 archived T05 host/spec handoff；T06 不重定义其 JSONL/reducer/recovery contracts。
- 实现来源顺序：official OpenAI Whisper/CTranslate2 APIs 与模型 metadata；当前维护良好的社区 long-form 实现；T01 ground-truth 实测选择；Python 仅诊断。
- 固定每个算法候选的 source revision/config，禁止边看同一 corpus 结果边不断加入未记录的 case-specific heuristic。
- 复用 T01 comparator；不得复制 CER/gap/timeline/report 逻辑或用 Python parity gate。

### R2 - Engine And Product-Model Scope

- 只拥有 ordinary `faster-whisper` CTranslate2 route；Kotoba 推理、Kotoba-only cache 和 legacy CT2 cache compatibility 属于 T07。
- 枚举并尝试全部七个现有模型 ID。
- `large-v3` short/medium/long 全部门槛通过，是切换默认 route 的硬条件。
- `large-v2` 必须覆盖 short/medium/long，并显式通过 Japanese `>10min`/long regression；这是 hard condition。
- 其余模型按完整测量标记：
  - `qualified`：所有要求 case 通过；
  - `stop-revise`：可运行但质量/性能/时间轴未通过；
  - `unsupported-for-native-release`：模型格式、许可证或稳定 API 无法支持。
- 非默认模型失败不阻塞 qualified native faster-whisper；T06 输出 qualification metadata，T15/T16 控制可用性但继续显示所有模型。

### R3 - Minimal Authoritative Long-Form Algorithm

按最小候选梯子实施：

1. 保留 T02 已验证的 WAV、official mel、tokenizer、30s model timestamp window 与 source-window distinction；
2. 用 decoded timestamp evidence 推进 seek，而不是无条件 fixed window 跳步；
3. 实现 pinned official prompt/history reset、consecutive timestamp、no-speech 和 invalid-generation 行为；
4. 只做可证明的 overlap duplicate removal，不生成文本/时间；
5. 先对 large-v3 short/medium/long 评估；如果所有门槛通过即停止，不增加 VAD；
6. 若仍有 confirmed gaps，只评估一个 pinned maintained VAD/chunk candidate；只保留有 ground-truth 改善且全部合同通过的最小方案。

不得默认复制 Silero V4 compression、Python hard-hole/backfill、private generation fork 或 corpus-specific transcript repair。

### R4 - Native Worker Integration

- 在 T04 单一 `native-asr/` 工程中创建 production `hikaru-asr-worker` executable/CMake target 和 entry point；T04 `hikaru-asr-fake-worker` 保持独立 test-only target。
- Production entry 读取一行 protocol v1 request、按 engine/backend dispatch，并在本任务只启用 ordinary faster-whisper；未实现 route 返回稳定 pre-ready error，不创建第二个 worker/protocol。
- Model-backed development runs通过 T05 internal `ResolvedNativeLaunch::resolve(...)` 注入 task-local locked absolute model path 和 resolved CPU，并用 `NativeAsrHost::new(productionWorker, [], activeGate)` 启动无 scenario 参数的真实 worker；T11/T15 后续提供 production resolver。T06 不下载、不决定镜像、不写 readiness marker。
- 在 `src-tauri/src/asr_worker.rs` 的 test module 增加真实 worker/CT2 focused integration；test-only env 固定为 `HIKARU_ASR_PRODUCTION_WORKER`、`HIKARU_ASR_CT2_MODEL_PATH`、`HIKARU_ASR_CT2_AUDIO_PATH`。测试将音频复制到临时受管 workspace 后构造 launch；Release/product route 不读取这些变量。
- 只实现 CPU path；CUDA/Vulkan 代码和 qualification 属于 T13/T14。
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
- 每模型 short 至少 1 cold + 3 warm；medium/long 记录明确样本数。
- 每个 retained/qualified model/case 独立满足：CER `<=0.35`、CPU inference RTF `<=1.0`、short cold wall `<=120s`、CT2 RSS `<=6 GiB`、0 timeline error、0 confirmed gap `>=1500ms`。
- `large-v2` long 必须覆盖 authoritative `long-v1`（>10min）；当前 Python special path 仅显示为 supplemental regression comparison。
- 记录 corpus/manifest/case/audio、model revision/file hash、input lock、executable/DLL、algorithm-config、environment 和 raw-result identity。
- Corpus 缺少 `low-volume`，报告该限制，不宣称完整 acoustic coverage。

### R7 - Evidence, Privacy And Supply Chain Boundary

- Task-local `research/local/` 保存 build/models/raw/token traces 并被精确 ignore；tracked evidence 只含 identity、aggregate metrics、distribution、failure trace hash、source citations 和 route dispositions。
- 一个发布结论只能使用单一 final binary/DLL/lock/config identity；failed evidence 必须完整且不评分。
- deterministic publisher 重跑字节一致；无 transcript text、absolute path、model/runtime binary 或 private media 进入 Git。
- T12 负责可复现 CPU packaging pipeline、provisional artifact 和 dependency/license inventory；T17 使用 T06～T10 final identities 重建并认证最终 CPU release artifact。T06 development binary 只是算法/qualification evidence。

## Acceptance Criteria

- [ ] T02 WAV/mel/tokenizer/timestamp/source-vs-model-window/WAV-end provenance contracts保留并有 CTest。
- [ ] Selected algorithm 由 decoded timestamps 推进 seek，不再使用 unconditional fixed non-overlap windows。
- [ ] `large-v3` short/medium/long 分别通过全部冻结 CPU 质量、性能、资源、timeline 和 gap 门槛。
- [ ] `large-v2` short/medium/long 分别通过，且 authoritative long-v1 明确覆盖 Japanese >10min regression。
- [ ] 其余五个模型均有完整 measured disposition；失败不阻塞 default route，也不从 T16 模型列表隐藏。
- [ ] Qualified models 输出 subtitle-usable segments，无单巨段规避、synthetic timing、reference repair 或 Python parity gate。
- [ ] Production `hikaru-asr-worker` target/main 存在且与 fake worker 分离；通过 T05 `NativeAsrHost`/`ResolvedNativeLaunch` 的真实 worker focused test，protocol progress 单调，cancel 不产生 completed，structured failure/recovery 保持兼容。
- [ ] Full matrix 复用 T01 comparator，并绑定单一 final binary/DLL/lock/config identity。
- [ ] Evidence publisher 确定性，tracked artifacts 无私有文本/路径/大型 binary/model。
- [ ] 不实现 Kotoba、downloader/readiness、release packaging、GPU、settings 或 frontend。

## Out Of Scope

- Kotoba 与 legacy Hugging Face CT2 cache（T07）。
- CrispASR engines（T08～T10）。
- Model manifest/download/readiness（T11）。
- CPU packaging pipeline/provisional artifact（T12）、final CPU rebuild/attestation（T17）与 GPU packs/qualification（T13/T14）。
- Settings/runtime dependency/UI changes（T15/T16）。
- 隐藏未通过模型、静默 Python fallback 或复刻 Python private fork。

## Rollback

禁用 ordinary faster-whisper native route 并保留 T05 host/legacy path；删除 task-local ignored build/raw evidence，不修改用户模型/cache/project。
