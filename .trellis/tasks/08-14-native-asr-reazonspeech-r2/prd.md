# Optimize ReazonSpeech transcription R2

## Goal

建立并验证 ReazonSpeech R2，使其在与 R1 公平可比的 short-v1 / medium-v1 / long-v2 评估中产生可复现的实质改善。R2 即使未通过全部绝对质量门槛，只要满足明确的 R1 相对改善规则，也可作为后续开发的首选候选；但未通过全部门槛时不得启用或交付下游发布资格。

## Background

- 父任务：`.trellis/tasks/07-25-native-asr-migration`；父任务地图已插入 T10R。
- T10 的 `R1-window15s-top-level-v1` 使用 Q8_0、CUDA、连续固定 15 秒窗口、无 overlap、无 VAD：
  - short-v1：CER `0.2250`，semantic gaps `1`；
  - medium-v1：CER `0.377143`，semantic gaps `22`；
  - long-v2：在 `[345000,360000]ms` 因上游零时长 top-level range 产生合法 structured failure。
- 同一 Q8_0 模型在 R1 前的 T03C whole-file 证据中 CER 为 `0.1333 / 0.2857 / 0.2944`，且无 semantic gap/timeline error，但只有一个超长 segment。R1 改善了字幕形状，却显著损失文本/覆盖并失去 long-v2 完成能力。
- ReazonSpeech GGUF 模型卡建议长于约 15 秒的音频使用 VAD-bounded chunking；pinned CrispASR 对 Japanese Parakeet-family 的维护策略使用 utterance-bounded VAD、12 秒 slice cap 与 energy-minimum split。
- 官方 ReazonSpeech helper 使用 RNNT subword point timestamps 和模型特定分段启发式；该能力保留为后续候选依据，不默认扩大主候选范围。
- 详细证据与来源：`research/reazonspeech-r2-evidence.md`。

## Step 1 oracle gate result

- The first identity, `R2-vad12-top-level-v1`, was `not-promising` structurally: pinned `crispasr_vad_slices` applies the official/default `30ms` speech pad after post-merge/rechunking, producing native adjacent overlap up to `60ms` and padded windows up to `12060ms`.
- After user review, the primary identity changed to `R2-vad12-pad30-overlap-top-level-v1`. The `12000ms` cap now names the unpadded VAD/rechunk core; direct-ABI inference windows may be at most `12060ms`, and only adjacent ABI-native final-padding overlap up to `60ms` is legal. Clamp, ownership rewrite, dedup and stitching remain forbidden.
- The new source-only oracle completed both cases under one frozen identity: short-v1 CER `0.266667`, semantic gaps `1`; medium-v1 CER `0.295385`, semantic gaps `19`; both had zero timeline errors. It is classified `promising` from the medium improvements, without publishing formal candidate disposition or relative selection.
- Stop after the oracle gate pending user review. Product implementation, Release/default and the Reazon native route remain unchanged.

## Corrected formal matrix result

- The first formal long-v2 disposition was invalidated because the same ABI float endpoints were converted independently to milliseconds and samples, falsely rejecting the legal `[510970,522930]ms` / `[522870,533630]ms` `60ms` overlap as `961` samples.
- Under the same candidate identity, the worker/oracle/harness now canonicalize each endpoint to integer milliseconds once and derive samples as `ms * 16`. All six roles were reacquired from scratch and published deterministically.
- Final result: `qualityDisposition: stop-revise`, `relativeSelection: better-than-r1`. Short/medium remain `0.266667 / 1` and `0.295385 / 19`; long-v2 completes 61 calls, then its 62nd attempt—zero-based window `61`, `[763590,768570]ms`—retains local range `2160..2160ms`.
- R1 and R2 failures are independently derived as the reviewed `zero_duration_top_level_result` class. R2 result-trace SHA-256 is `f3179c7ab489bfcc211b4779fa15fb481354850dd08cbf2286b64c00f13c45bb`, fingerprint `35b1f992ca3619d7e985ee3e9bb33f01280bed48829766bafbe01ee1892dc93e`; code equality alone cannot exempt another subtype. R5 selects the candidate from medium CER improvement (`-0.081758` absolute) with no new anti-regression. It remains development-only, disabled, and ineligible as accepted T14/T15 algorithm input.

## Requirements

### R1 — 保持公平基线

- R2 primary 必须保留 R1 的 ReazonSpeech Q8_0 模型、pinned CrispASR source/runtime、CUDA development device、T01 manifest/comparator、协议版本、输出上限与采样矩阵。
- 算法或运行时身份变化必须形成新 candidate identity；禁止混合 R1/R2 或不同 R2 identity 的测量行。

### R2 — 主候选采用维护方推荐的边界策略

- Primary candidate 冻结为 `R2-vad12-pad30-overlap-top-level-v1`。
- 使用 pinned CrispASR 的 Silero VAD speech slices；未 padding 的 VAD/rechunk core 最长 12 秒，超长 speech region 按 upstream energy-minimum policy 再切分；保留官方/default `speechPadMs=30`。
- Direct C ABI 在 rechunk 后施加 final padding：实际 inference window 最长 `12060ms`，相邻 window 只允许该机制产生的最多 `60ms` overlap；starts/ends 单调、范围合法、禁止非相邻或更大 overlap。
- 每个 padded window 复用同一已加载 session 进行一次 exact single-pass inference；不得重新引入固定 15 秒边界、任意 overlap、ownership rewrite、dedup 或 stitching。
- 每个 slice 只接受一个合法、非空、audio-bounded top-level result，作为 text-conserving cue；不使用 reference/Python output、比例时间轴、clamp 或任意 duration expansion 修复结果。

### R3 — 证据先于产品实现

- 在修改 worker 产品路径前，先用 task-local tracked stdlib/`ctypes` oracle 直接调用同一 pinned CrispASR C ABI，严格复现 primary 的 `vad_slices -> 每 slice 一次 transcribe_lang -> top-level cue` 形状，至少覆盖 short-v1 与 medium-v1。
- Oracle 必须锁定并证明 Silero 参数、`12000ms` core cap、`12060ms` padded inference cap、最多 `60ms` adjacent native-padding overlap、实际 VAD windows、逐 window 调用次数与最长时长；禁止任意 overlap、ownership rewrite、dedup、stitching、gap-fill、decoder search 或 punctuation/post-processing 混入该诊断身份。
- Oracle 必须显式冻结 legacy inline dispatch、`CRISPASR_PARAKEET_STREAM_THRESHOLD=13` 与 `CRISPASR_SESSION_UNIFIED_DISPATCH=0`，逐 window 拒绝超过 `192960` samples，并禁止 reactive streamed fallback。
- 诊断结果只用于确认方向和冻结实现细节，不可从部分矩阵发布 R2 disposition 或 relative selection。
- 若 oracle 没有显示任何相对 R1 的改善信号，停止主候选实现并回到规划，不为完成任务而增加代码。

### R4 — 次级候选必须由 primary 失败证据激活

- `R2-vad12-gapfill-v1` 只有在 primary 完整矩阵未达到 material improvement，且证据定位为 VAD slice 内部漏识别时才可另行评审。
- Gap-fill 只能复制 pinned CrispASR 的有界规则：遗漏 span `>=1000ms`、最多两轮、使用原生 timing 合并，不读取 reference text。
- F16、官方 subword decoder、beam/MAES/best-of、人工 overlap/LCS 或 CrispASR pin 升级均不属于 primary；primary 唯一允许的 overlap 是 pinned direct ABI final `30ms` padding 导致的 adjacent `<=60ms` overlap，且不触发 ownership/dedup。只有 primary/approved gap-fill 的证据证明对应 causal blocker 后才能新建 identity。

### R5 — 绝对资格与相对选择分离

每个完整 R2 candidate 发布两个独立结论：

1. `qualityDisposition: qualified | stop-revise`，继续使用既有绝对质量门槛；
2. `relativeSelection: better-than-r1 | no-material-improvement`，用于判断是否保留为后续开发基础。

`better-than-r1` 必须满足 evidence safety，并至少改善一个 R1 blocker：

- long-v2 从 structured failure 变为 completed legal result；或
- 任一 completed case 的 CER 至少降低 `0.02` absolute；或
- medium semantic gaps 同时降低至少 `20%` 且至少 `2` 个，即从 `22` 降至不超过 `17`；或
- short semantic gaps 从 `1` 降为 `0`。

同时不得用明显回退交换单项改善：

- 不得新增 timeline/protocol/cue failure；
- short 或 medium 不得同时出现 CER 比 R1 高超过 `0.02` absolute 且 semantic gaps 多于 R1。

### R6 — 完整、合法、可复现的证据

- 每个正式 candidate 必须在同一冻结 identity 下完成 short-v1 / medium-v1 / long-v2；早期质量失败不截断矩阵。
- Identity/input/runtime/harness/trace 无效时修复并重跑；candidate-caused structured failure 只有在 identity 合法且 trace 完整时才计作有效失败行。
- 最终输出必须 text-conserving、UTF-8 合法、cue starts 非递减且位于音频范围内；cue timing 可继承合法的 bounded native overlap，每 cue 不超过 96 Unicode code points / 15000ms，并通过 protocol replacement limits。
- Tracked publisher 必须从 ignored raw bytes 与 T01 truth 重算 CER/timeline/gaps，拒绝身份/结果提升篡改，并连续生成 byte-identical publication。

### R7 — 复用现有架构与安全合同

- 复用现有 `CrispAsrBackend`、`transcribe_window`、protocol v1、atomic `segmentsReplace`、Rust host、recovery、active gate 与 process-tree cancellation。
- Product worker 不保存 raw upstream previews；backend/VAD/policy failure 在 final replacement 前保持 zero accepted output。
- Raw text、音频、模型、VAD asset、绝对路径、stderr、binary/build output 只位于 task-local ignored `research/local/`。

### R8 — 保持发布边界

- R2 只处理 ReazonSpeech；不修改 Parakeet、Qwen、CTranslate2、Python engine、frontend、settings、downloader、installer、portable package 或 release route。
- `better-than-r1 + stop-revise` 只表示首选开发候选：Reazon native route 仍禁用，Release/default 仍为 Python legacy，不向 T14/T15 提供 accepted algorithm input。
- 只有 `qualified` 才可形成 accepted ReazonSpeech algorithm handoff；正式 runtime pack、VAD asset delivery 与设备资格仍由后续任务负责。

## Acceptance Criteria

- [x] AC1: `research/reazonspeech-r2-evidence.md` 记录 R1 完整失败分布、官方/社区来源、primary/secondary 选择及淘汰理由。（R1-R4）
- [x] AC2: source-only oracle 使用冻结的 pinned source/model/runtime 运行 short-v1 与 medium-v1，并明确记录是否允许进入产品实现；部分结果不发布 candidate disposition。（R1-R3）
- [x] AC3: 若 primary 被激活，VAD window planning 与 Reazon policy tests 覆盖 VAD empty/failure、ordered bounded native overlap、12000ms core / 12060ms padded boundary、energy-split result、invalid/non-adjacent ranges、empty/multiple source segments、UTF-8、text conservation、96/15000 caps。（R2、R6-R7）
- [x] AC4: Worker/fake ABI tests 证明同一 session 多次 slice transcribe、callback reset/result free、preview suppression、monotonic progress、one atomic replacement、post-ready zero-output failure，且 Parakeet/Qwen/default-off 行为不变。（R2、R7-R8）
- [x] AC5: 正式 R2 identity 完成 short-v1 / medium-v1 / long-v2，并发布逐 case CER、semantic/excluded gaps、timeline、cue distribution、RTF/RSS 与完成/失败原因。（R1、R5-R6）
- [x] AC6: Publication 同时给出 `qualityDisposition` 与 `relativeSelection`，并由 mutation tests 验证 R1 threshold、identity、metrics、status 与 result promotion 不可篡改。（R5-R6）
- [x] AC7: 若 primary 已满足 `better-than-r1`，任务停止扩张；若未满足，只有符合 R4 的 blocker 证据和用户评审后才能实现 gap-fill 或其他新 identity。（R4-R5）
- [x] AC8: 全量 native/Rust/product/benchmark validation 通过；tracked privacy scan、ignored local roots、deterministic publication、`git diff --check` 与 task validation 通过。（R6-R8）
- [x] AC9: 无论结果如何，Release/default、native route、Parakeet/Qwen、frontend/downloader/settings/package 均保持不变；未获用户单独授权不提交代码。（R8）

## Out of Scope

- Parakeet P2/R2 规划或实现。
- 以“通过全部门槛”为目标的无上限参数搜索。
- 在没有 primary failure evidence 时预先实现 gap-fill、F16、beam/MAES、official subword decoder 或人工 overlap/LCS；pinned ABI final padding 的 bounded native overlap 不属于该扩张。
- CrispASR source pin 升级、正式 VAD 模型下载/打包、runtime pack、设备 fallback 或 release cutover。
- Python parity、reference-derived repair、synthetic/proportional timing。
