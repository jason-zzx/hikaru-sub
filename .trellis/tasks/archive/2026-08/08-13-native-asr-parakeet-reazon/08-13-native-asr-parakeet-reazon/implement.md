# T10 Parakeet / ReazonSpeech 产品化实施计划

> 状态：implementation and final validation complete，等待用户决定是否提交；未经单独授权不 commit。Release/default 全程保持 Python legacy。

## Preconditions

- T09 archived handoff 与 `parakeet-family: development-gpu-ready` 是实现依赖；T03C long-v2 correction 是当前质量权威。
- 用户已批准：ReazonSpeech qualified、Parakeet stop-revise 时，T10 可完成并归档。
- 输出上限冻结为每 cue 最多 96 Unicode code points、15000ms。
- 初始候选冻结方向：Reazon R1 与 Parakeet P1 均使用连续 15000ms、无 overlap 的真实音频窗口；VAD 仍 fail closed。
- 任何模型、音频、runtime、binary、raw output 和 stderr 只能位于 task-local ignored `research/local/`。

## Step 1 — 冻结 T10 input / candidate lock

- [x] 建立 tracked T10 lock，绑定 current manifest/comparator、CrispASR pin/submodules、T09 runtime/device handoff、worker/runner/runtime/model/audio/toolchain/licenses。
- [x] 明确冻结 R1/P1 identity：15s 连续无重叠窗口、explicit `parakeet` upstream route、96 code points、15000ms、无 VAD、无 reference repair、无 proportional timing。
- [x] 记录 R1/P1 共同的 full-matrix gate：同一 identity 下按 short-v1、medium-v1、long-v2 完成矩阵，单项质量门槛失败不截断后续音频；证据身份/执行完整性错误只触发受影响 case 修复重跑。
- [x] 创建 active/archive 都 ignored 的 `research/local/{build,models,audio,raw,stderr}` roots，并验证 canonical containment。
- [x] pinned v0.8.22 repeated-session/result/timing 依据已记录在 `research/t10-window-contract.md`；实现前复核其 source anchors 与当前 lock 一致，不升级 pin。
- [x] 冻结模型证据采样：short 每候选/device `1 cold + 3 warm`，publisher 使用 3 次 warm inference RTF median 并单独记录 cold wall/RSS；medium-v1 与 long-v2 各 1 次 fresh-process completed/validated-failed row。T10 `qualified` 仅表示 accepted engine-algorithm input，不替代 T14/T15。

Validation:

```bash
python scripts/asr-benchmark.py validate --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark
python scripts/asr-benchmark.py self-check
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
git check-ignore <T10 active/archive research/local sentinels>
```

Rollback: 删除 task-local lock/local inputs，不改源码。

## Step 2 — 实现纯 Parakeet-family policy

- [x] 新增最小 `parakeet_family_policy.hpp/.cpp`，仅依赖 Hikaru-owned `NativeSegment/NativeWord/Segment` 与 protocol limits。
- [x] 实现 Unicode code-point 计数、UTF-8/文本合法性、timeline/order/audio bounds、96/15000 caps、逐字节文本守恒。
- [x] Reazon 策略只消费每个 window 的合法 top-level source timing/text；零时长 native words 不成为 cue。
- [x] Parakeet 策略使用合法正时长 words，按 caps 聚合；零时长 words 只能附着到同 source 的已存在合法 span，无法附着则失败。
- [x] 纯策略只验证 UTF-8、96/15000、timeline、完整覆盖和文本守恒，并返回显式 result/error；不调用有状态 protocol validator，不参数化 canonical wire limits。
- [x] worker 的现有 `Emitter` 验证完整 `segmentsReplace` 的 per-text、segment-count 与 event-line limit；不复制 serializer size 逻辑。
- [x] 稳定错误码至少区分 empty output、invalid input、text conservation 与 cue limit；canonical replacement errors 沿用 protocol codes。
- [x] 添加 focused deterministic vectors，覆盖 PRD 中纯策略的 UTF-8、timeline、ownership、empty output、text-conservation 与 96/15000 matrix；protocol wire-limit cases 留给 Step 4 worker/Emitter tests。

Validation:

```bash
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release -R "protocol|crispasr|parakeet-family-policy" --output-on-failure
```

Review gate: 独立审查不得存在 synthetic timing、reference/Python text repair、generic hierarchy 或 configurable product knobs。

Rollback: 删除纯策略模块；T09 backend 不受影响。

## Step 3 — 给现有 backend 增加有界 window transcribe

- [x] 在 `CrispAsrBackend` 上增加窄 `transcribe_window`；whole-audio `transcribe` 变成薄包装。
- [x] 从已验证/已拥有 PCM samples 精确切片，不落临时 WAV、不重开 session。
- [x] 每 window 单独注册/reset callbacks、创建/free result；session 在 backend 析构时 exact-once close。
- [x] backend 对每个 result 只执行一次 window-relative -> audio-absolute 平移并重新验证；返回给 policy 的 source/word ranges 均为 audio-absolute，policy 不得再次加 offset。
- [x] 不把 raw segment callback 暴露给 worker policy；callback 可保留内部 copied observation/测试。
- [x] fake ABI 扩展为多次 transcribe、多 segment/word、window offset、failure on later window；保持 T09 ownership counters。

Validation:

```bash
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release -R "crispasr-backend-core|parakeet-family-policy" --output-on-failure
```

Mutation cases: invalid window、overflow offset、第二次 transcribe null、callback error、relative result 越界、missing reset/free。

Rollback: 恢复 whole-audio thin path；策略模块可保留 model-free tests。

## Step 4 — 接入 worker 原子 final replacement

- [x] `run_crispasr` 对 Parakeet/Reazon 按 15s window 顺序调用 backend；Qwen 路径保持 T09 strict seam。
- [x] 仅发送 monotonic progress；禁止发送 raw upstream `segment` preview。
- [x] 全部 window 完成后调用策略并发送恰好一个 `segmentsReplace` + `completed`。
- [x] policy failure 在 post-ready 发送结构化 `error`，此前 zero accepted output。
- [x] `useVad=true` 与 Vulkan 保持当前 fail closed；不加入 fallback。
- [x] normal/default-off CT2 worker 仍对 CrispASR 返回 `route_not_implemented`。

Validation:

```bash
# Reconfigure/build the actual opt-in T10 CrispASR worker lane using the exact runtime args frozen in t10-input-lock.md
cmake -S native-asr -B <T10 ignored build> -G Ninja <locked T10 CrispASR args>
cmake --build <T10 ignored build> --config Release
ctest --test-dir <T10 ignored build> -C Release -R "crispasr|parakeet-family|worker" --output-on-failure

# Unrelated/default-off regressions
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release --output-on-failure
cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release
ctest --preset windows-x64-ct2-release --output-on-failure
cmake --preset windows-x64-ct2-cuda-development
cmake --build --preset windows-x64-ct2-cuda-development
ctest --preset windows-x64-ct2-cuda-development --output-on-failure
```

The T10 lane must include a fake-ABI worker contract that executes `run_crispasr` and proves preview suppression, exactly one replacement, post-ready policy error, and unchanged Qwen behavior.

Review gate: protocol v1、event sequencing、preview suppression、error/recovery 原子性、Qwen/CT2 isolation。

Rollback: 关闭 T10 policy dispatch，恢复 T09 development-only behavior；Release/default 未变。

## Step 5 — 扩展真实 Rust-host 测试

- [x] 复用 `HIKARU_ASR_CRISPASR_INPUTS` 和现有 launch helper；仅增加 test-only `expectedError`。
- [x] 覆盖 Reazon success：ready -> progress* -> one replacement -> completed；Parakeet/worker success 由同一协议 contract 与模型 evidence 路径覆盖。
- [x] 覆盖 final replacement 的 recovery snapshot/ASS，确认无 giant raw preview。
- [x] 覆盖 pre-ready identity failure、post-ready policy failure zero output、active gate、hard cancellation/reap within 2s。
- [x] 取消发生在中间 window 时不得留下 accepted partial segments。
- [x] 保持 Qwen policy error、CT2 model-backed tests和 production env isolation。

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_worker::tests -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --release --manifest-path src-tauri/Cargo.toml
```

Rollback: 删除 T10-specific `#[cfg(test)]` fixtures；production host 逻辑不变。

## Step 6 — 实现 T10 acquisition / publisher

- [x] 添加 stdlib task-local runner/orchestrator，按 lock 调用 frozen worker/backend 并原子写 raw JSON。
- [x] raw 每行绑定 engine/case/candidate/device/windows/source segments/words/final segments/timings/RSS/modules/stderr identity；raw text 只在 ignored local。
- [x] 生成 reviewed sanitized raw index，绑定每个 attempt file 的 role/size/SHA-256。
- [x] publisher 先验证 raw index/identity/privacy，再通过共享 T01 comparator 重算 CER/timeline/gaps。
- [x] publisher 独立重算 cue count、code-point/duration distribution、text conservation、replacement bytes 和 result。
- [x] mutation tests 拒绝 manifest/model/runtime/worker/candidate/window/cap/device/raw hash/segment text/timing/metrics/result promotion 漂移。
- [x] 同一 publication 连续运行两次 byte-identical。

Tracked artifacts预计：

```text
research/t10-input-lock.md
research/t10-raw-index.json
research/evidence/t10-parakeet-reazon.json
research/t10-parakeet-reazon-report.md
research/t10-handoff.md
research/run_t10_evidence.py
research/publish_t10_evidence.py
research/test_publish_t10_evidence.py
```

Rollback: 删除 ignored acquisition 与 tracked T10 publication；历史 T03/T09 不变。

## Step 7 — 获取并判定 Reazon R1

- [x] 在 T09 parakeet-family CUDA development lane 上运行 R1 short-v1：fresh processes，`1 cold + 3 warm`，warm inference RTF median；记录 cold wall、peak RSS 与 shape evidence。
- [x] R1 identity 不变地运行 medium-v1 与 long-v2；三个 cases 都具有 completed 或有效 failed evidence。
- [x] Identity/input/runtime attestation 漂移后重跑了完整最终矩阵；long-v2 的 candidate-caused structured failure 保留完整 trace。
- [x] 直接对 T01 truth 评分；检查 CER、semantic gaps、timeline、96/15000、text conservation 与 protocol replacement limits。medium-v1/long-v2 各保留 1 个 fresh-process row。
- [x] R1 因 short/medium gap/CER 与 long-v2 native zero-duration range 发布 `stop-revise`；未在同 identity 增加 overlap。
- [x] R1 未满足全部 gate，未发布 Reazon `qualified`。
- [x] 后续若需要 R2，必须回到 planning/review 冻结新 identity 并重跑全矩阵。

Gate:

```text
all three cases pass all frozen gates -> reazonspeech qualified
otherwise                          -> R1 stop-revise / reviewed R2 required
```

## Step 8 — 获取并判定 Parakeet P1

- [x] 使用同一冻结 runtime/device 和 P1 15s-window/native-word policy，按 short-v1、medium-v1、long-v2 顺序完成全矩阵。
- [x] short 使用 fresh-process `1 cold + 3 warm`；medium-v1 与 long-v2 各保留 1 个 fresh-process completed 或可验证 failed row。
- [x] medium CER/gap 失败后仍继续 long-v2，未使用 `blocked-not-run-by-short-gate`。
- [x] Identity/input/runtime attestation 漂移后修复并重跑最终矩阵；long-v2 text-conservation failure 是完整 identity-valid row。
- [x] 未因质量失败切回 CPU，未添加 VAD/backfill/reference correction。
- [x] handoff 已记录完整 short/medium/long-v2 分布；后续 P2 必须先评审新 candidate identity。

Gate:

```text
all three cases pass all frozen gates -> parakeet qualified
otherwise                          -> P1 stop-revise / reviewed P2 required
```

## Step 9 — 独立结论、下游 handoff 与 spec

- [x] publication 分别记录 Reazon 与 Parakeet `stop-revise`，未聚合结论，也未授权 Release/default 或正式 GPU route。
- [x] 两个冻结完整矩阵均为 `stop-revise`；handoff 明确没有 accepted T10 engine-algorithm input 可供下游资格工作消费。
- [x] 更新父任务 T10 Gate 2 handoff，但不勾选最终 release acceptance。
- [x] `.trellis/spec/asr/quality-guidelines.md` 已加入经实现证明的 window/text-conservation/preview suppression/独立 disposition/partial-RTF durable contract。
- [x] 保持 T14/T15、T12/T13、T16/T17/T18 ownership 不变。

## Step 10 — 最终全量验证

Required:

```bash
# Native protocol/backend lanes
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release --output-on-failure

cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release
ctest --preset windows-x64-ct2-release --output-on-failure

cmake --preset windows-x64-ct2-cuda-development
cmake --build --preset windows-x64-ct2-cuda-development
ctest --preset windows-x64-ct2-cuda-development --output-on-failure

# Exact T10 CrispASR build command will be frozen in t10-input-lock.md
cmake -S native-asr -B <T10 ignored build> -G Ninja <locked T10 args>
cmake --build <T10 ignored build> --config Release
ctest --test-dir <T10 ignored build> -C Release --output-on-failure

# Host and product regressions
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --release --manifest-path src-tauri/Cargo.toml
pnpm test
pnpm build

# Evidence/task checks
python scripts/asr-benchmark.py self-check
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
python .trellis/tasks/08-13-native-asr-parakeet-reazon/research/test_publish_t10_evidence.py
python ./.trellis/scripts/task.py validate .trellis/tasks/08-13-native-asr-parakeet-reazon
git diff --check
```

Also verify:

- active/archive ignored local roots；
- tracked/ignored privacy scans与无绝对路径/字幕正文；
- final publisher double-run byte equality；
- no Release/default route、protocol、frontend、downloader、settings、packaging changes；
- final independent `trellis-check` 无 blocking findings；
- no staged files；未经用户单独授权不 commit。

## Rollback points

1. Step 2 后：删除纯 policy 模块/tests。
2. Step 3 后：恢复 whole-audio backend thin wrapper。
3. Step 4 后：禁用 T10 dispatch，保留 T09 core。
4. Step 5 后：删除 test-only Rust cases。
5. Steps 6–8 后：删除/作废受影响 evidence；不改历史 artifacts。
6. 单引擎失败：只标记该引擎 `stop-revise`，保留另一引擎有效结论。
