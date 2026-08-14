# T10 Parakeet / ReazonSpeech 产品化技术设计

## 1. 设计目标

T10 在 T09 已建立的 `CrispAsrBackend` 之上增加最小的 Parakeet-family 推理窗口与字幕输出策略，使 ReazonSpeech 和 Parakeet 能独立产生可验证的协议片段与质量结论。

设计不新增通用 backend hierarchy、不修改 protocol v1、不复制 Rust host 生命周期，也不把开发 CUDA 通道包装成正式产品 runtime。核心改动只有两处：

1. `CrispAsrBackend` 支持在同一已加载 session 上转录有界 PCM 窗口，并返回带窗口绝对偏移的 Hikaru-owned copied result；
2. 一个纯策略模块把这些 copied result 转为满足 `96 code points / 15000ms`、文本守恒和 protocol limits 的最终 `Segment[]`。

## 2. 复用边界

保持不变：

- `native-asr/include/hikaru_asr/protocol.hpp` 与 `protocol-v1-limits.json`；
- `NativeAsrHost`、active gate、recovery、hard process-tree cancel；
- T09 DLL/export/route/device attestation、callbacks、RAII cleanup；
- `parakeet|reazonspeech-nemo -> parakeet` 显式 route；
- Qwen strict policy seam；
- CTranslate2 全部路径；
- Release/default Python legacy。

T10 不读取或调用 Python 分段代码。Python 的 `40/5000` 和 `45s/2s` 仅保留为历史诊断。

## 3. 最小源码形状

预计新增一个小而纯的策略模块：

```text
native-asr/src/parakeet_family_policy.hpp
native-asr/src/parakeet_family_policy.cpp
```

按需要最小修改：

```text
native-asr/src/crispasr_backend.hpp/.cpp
native-asr/src/main.cpp
native-asr/tests/crispasr_backend_tests.cpp
native-asr/tests/fake_crispasr_abi.cpp
native-asr/CMakeLists.txt
src-tauri/src/asr_worker.rs              # 仅测试输入/模型实测，如现有 seam 不足
```

证据工具和产物位于当前 task 的 `research/`；模型、音频、runtime、build、raw JSON、stderr 位于 ignored `research/local/`。

## 4. Backend 窗口接口

不创建第二个 backend 类。给现有 concrete backend 增加单一有界调用：

```cpp
struct AudioWindow {
  std::int64_t start_ms;
  std::int64_t end_ms;
};

Result CrispAsrBackend::transcribe_window(
    AudioWindow window,
    const ProgressCallback& on_progress = {});
```

合同：

- window 必须满足 `0 <= start < end <= duration_ms`；
- 从 backend 已拥有的 16 kHz mono samples 取精确样本范围，不创建临时 WAV；
- 复用同一个 pinned session，调用同一个 `crispasr_session_transcribe_lang(..., "ja")`；
- 每次调用独立注册并 reset callbacks，result handle 独立 exact-once free；
- copied source/word timing从窗口相对时间平移为音频绝对时间，再按完整音频范围验证；
- progress 平移/限制到窗口 `[start,end]`，不得回退；
- T10 不开放 cooperative cancel；仍由 Rust 终止 worker process tree。

现有 whole-audio `transcribe()` 可作为 `transcribe_window({0,duration})` 的薄包装，避免复制 ABI/lifecycle 代码。

## 5. 纯输出策略

策略只接收 Hikaru-owned 数据，不调用 ABI、文件系统或 benchmark：

```cpp
struct WindowResult {
  std::int64_t window_start_ms;
  std::int64_t window_end_ms;
  std::vector<crisp::NativeSegment> source_segments;
};

struct PolicyResult {
  std::vector<Segment> segments;
  std::string error_code;  // empty on success
};

PolicyResult assemble_parakeet_family_segments(
    Engine engine,
    const std::vector<WindowResult>& windows,
    std::int64_t audio_duration_ms);
```

### 5.1 共同不变量

- 输入窗口非空，按开始时间严格递增、连续且不重叠；首个候选覆盖完整音频。零 source segment 或零 final segment 均 fail closed。
- 每个 source/word text 必须是合法非空 UTF-8；策略用一个小型严格 UTF-8 scanner 同时验证编码并统计 Unicode scalar values（不引入依赖），canonical protocol byte/count/line limits 仍由 worker 的现有 `Emitter` 检查。
- 输出按 start 非递减，位于音频范围内，且 `end > start`；
- 每 cue 不超过 96 Unicode code points 和 15000ms；
- 拼接输出文本必须逐字节等于拼接选定 inference source text；不删除空格/标点来宣称守恒；
- 纯策略不调用有状态 protocol validator，也不参数化 canonical wire limits；worker 构造 `segmentsReplace` 后通过现有 `Emitter` 的 `validate_event`/`serialize_event` 验证 segment-count、text bytes 和 event-line size；
- 任一策略合同失败即返回稳定 error code 和零 final segments。

### 5.2 ReazonSpeech R1

Reazon 原生 RNNT words 大量零时长，R1 不从 words 构造 cue。每个有界 inference window 使用该窗口的合法 top-level native segment；时间必须同时受 native range 和真实 window 边界约束。

R1 窗口上限冻结为与字幕时长硬上限相同的 `15000ms`：

- 连续窗口 `[0,15s)`, `[15s,30s)` ...，最后一个窗口到音频末尾；无 overlap、无 dedup、无 VAD、无参考匹配。
- 每个窗口必须返回恰好一个非空 top-level source segment。backend 已将 range 精确平移为 audio-absolute；策略只验证它完全位于 `[windowStart, windowEnd]`，任何越窗都拒绝，不再次平移、不 clamp/求交。
- 该 segment 直接成为该 window 的一个 cue。若 text 超过 96 code points，R1 fail closed；不能按字符比例或零时长 words 再拆 timing。
- 若矩阵证据出现边界漏字/重复，R1 保留为 `stop-revise`；后续 overlap 候选必须另行冻结 window/overlap/ownership/exact-dedup identity，不能原地修改 R1。

R1 的目的不是复刻 Python 45s/2s，而是用最少机制验证：Reazon 已有文本质量能否在真实 15s 音频窗口上保持，同时自然得到粗粒度合法时间轴。

### 5.3 Parakeet P1

P1 同样使用连续 `15000ms` 无重叠真实窗口，从而改变 inference input 并可能改变当前 CER。

每个窗口内：

- 每个 window 必须返回恰好一个 source segment；其 words 保持原顺序，拼接 word text 必须逐字节等于 source text。
- 正时长 word (`end > start`) 是唯一可创建/扩展 cue timing 的 anchor；backend 已返回 audio-absolute ranges，策略验证它们完全位于 `[windowStart, windowEnd]`，越窗即拒绝，不再次平移、不 clamp。
- leading zero-duration run 附着到该 source 中第一个后续正时长 anchor；两个正时长 anchors 之间的 zero-duration run 附着到前一个 anchor；trailing run 也附着到前一个 anchor。若整个 source 没有正时长 anchor，则失败。
- 附着只追加原始文本，不改变 anchor timing。按原顺序累积 anchors；加入下一 anchor/其所属 zero run 会超过 96 code points 或从 cue 首 anchor start 到新 anchor end 超过 15000ms 时，在该 anchor 前 flush 当前 cue。若单个 anchor 连同其 owned zero run 已超过 96 code points，则失败。
- 不使用 whole-window timing 替代缺失 word timing，不做 tokenizer 猜测、Unicode 改写或参考纠正。

R1 与 P1 都按 short-v1、medium-v1、long-v2 顺序运行，任一质量门槛失败不停止矩阵。每个 case 必须在同一冻结 identity 下获得 completed 或有效 failed evidence。Identity/input/runtime attestation 漂移、harness 损坏或 trace 不完整属于无效证据，修复后重跑受影响 case；identity 合法且具有完整 trace 的 candidate-caused structured load/compute/resource failure 是有效失败行，但仍继续后续 case。完整矩阵后，任一 case 的适用质量门槛或有效 structured failure 都使对应候选发布 `stop-revise`。

## 6. Worker 事件流

当前 upstream whole-file preview 不能进入 recovery。T10 的 `run_crispasr` 流程改为：

1. 验证 route、VAD/Vulkan、model roles，构造 backend；
2. emit `ready`；
3. 按冻结窗口顺序调用 `transcribe_window`，只发送 monotonic `progress`；不把 raw segment callback 发送到 protocol；
4. 收集全部 `WindowResult`；
5. 调用纯策略；
6. 先用现有 `validate_event` + `serialize_event` 验证完整 `segmentsReplace`；
7. emit 单个 `segmentsReplace`，然后 emit `completed`。

如果 policy 失败，emit 一个结构化 `error`，且此前没有 `segment`/`segmentsReplace`，因此 recovery 不会保存 giant preview 或半成品字幕。

T10 不要求增量字幕；相较保存已知无效 preview，结束时原子 replacement 更安全、更简单。

在 fake-ABI 或首次真实 short acquisition 中若 repeated-call/session reset/window-local timing 与 `research/t10-window-contract.md` 冲突，R1/P1 立即失败并回到规划，不改用猜测性 offset 或重开 backend workaround。

## 7. Candidate identity 与 evidence

每个候选 identity 至少绑定：

- 当前 long-v2 manifest、shared comparator；
- CrispASR v0.8.22 source/submodule identity；
- worker、runner、`crispasr.dll` 及依赖 hashes；
- Parakeet/Reazon Q8_0 model hashes/licenses；
- engine、device、open params、window length、overlap、ownership/dedup policy；
- policy source/config identity、96/15000 caps、protocol limits；
- audio case hash/duration；
- raw output file hash、stderr privacy status。

Tracked publisher 从冻结 raw bytes 读取 final segments，调用 T01 shared comparator 重算 CER/timeline/gaps。它额外发布：

- window count；
- native top-level/word count与 zero-duration distribution；
- final cue count、code-point/duration P50/P95/max；
- text-conservation结果；
- replacement JSON bytes；
- cold/warm/inference RTF、RSS；
- 每引擎独立 `qualified | stop-revise`。

任何 source/config/binary/runtime/candidate identity 改变，只重跑受影响引擎/候选，禁止混合 rows。

## 8. Device 与资格边界

- 迭代默认使用 T09 `parakeet-family: development-gpu-ready` 的 CUDA identity；CER/gap/timeline 失败不切回 CPU。
- T10 的 `qualified` 明确定义为 `accepted T10 engine-algorithm input`：可供 T14/T15/T18 继续资格工作消费，但不能发布正式 managed GPU pack、Release/default route 或产品设备资格。
- 若要声称 CPU-qualified，最终同一候选必须补 CPU short/medium/long-v2 的适用性能/资源矩阵；历史 T03 CPU rows 不能替代新算法 binary。
- 正式 CUDA/Vulkan pack、fallback、hardware matrix 仍由 T14/T15 完成。

## 9. 测试设计

### 9.1 纯策略 CTest

最小 deterministic vector 覆盖：

- 合法多窗口/多 cue；
- Reazon 大量零时长 words 仍只使用合法 top-level window timing；
- Parakeet 正时长与零时长 word 混合、可附着/不可附着；
- 空 windows、零 source/final segments、空 text、invalid UTF-8、逆序、越界、零/负时长；
- 97 code points、15001ms；
- source/word/output 文本守恒失败；
- short final window 与精确 15s boundary。

### 9.2 Fake ABI / worker

- 同一 session 多次 window transcribe，callbacks 每次 reset、results 每次 free、session 最终一次 close；
- window offsets 正确；
- raw preview suppressed；
- one final replacement + completed；
- policy failure post-ready 且 zero accepted output；
- canonical protocol segment-count、per-text byte 与 replacement event-line 超限由 worker/Emitter fail closed；
- Reazon explicit upstream `parakeet` mapping；
- VAD/Vulkan 保持 fail closed；
- Qwen strict seam 不变。

### 9.3 Rust host

复用现有真实 host，验证：

- Reazon/Parakeet final replacement 被原子保存；
- cancellation/reap 在 final replacement 前不会留下 giant preview；
- pre-ready model/runtime failure、post-ready policy failure、recovery、active gate；
- default-off worker 仍拒绝 CrispASR；
- CT2/Qwen regressions 不变。

## 10. 独立结论与归档

T10 输出两个独立结论：

- `reazonspeech-nemo`: `qualified | stop-revise`；
- `parakeet`: `qualified | stop-revise`。

用户已批准：若 ReazonSpeech qualified 而 Parakeet P1 完整矩阵仍为 stop-revise，T10 可以完成并归档。归档不启用任何 Release/default route；下游只可消费对应引擎的有效 handoff。

## 11. Rollback

- 策略或窗口实现失败：禁用/移除 T10 policy 调用，恢复 T09 default-off backend seam；
- 单引擎证据失败：只保留该引擎 `stop-revise`，不撤销另一引擎结论；
- evidence identity 漂移：删除/作废受影响 publication 并重跑，不修改历史 T03/T09 artifacts；
- 任一阶段都不触碰用户设置、模型缓存、项目字幕或 production package。

## 12. 关键取舍

- **D1:** 15s 无重叠窗口先行；overlap 只有实测边界问题才增加。
- **D2:** 96 code points / 15000ms 是产品输出硬上限，不是可配置用户设置。
- **D3:** Reazon R1 使用真实 window/top-level timing，拒绝零时长 word 修补。
- **D4:** Parakeet P1 必须改变 inference input，并与 Reazon R1 一样完成 short/medium/long-v2 全矩阵；单项质量门槛失败不截断后续音频。
- **D5:** 原子 final replacement，取消 raw preview；不新增流式拼装复杂度。
- **D6:** concrete backend + pure policy function；不引入抽象 hierarchy 或第三方分段库。
