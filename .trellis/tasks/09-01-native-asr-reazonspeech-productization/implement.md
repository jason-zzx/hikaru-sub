# ReazonSpeech Native 实施计划

## 状态

最终候选 `shared-reazonspeech-final-r1` 已完成实现、包装和真实 CPU/CUDA 验证。owner-approved pure-RNNT `[t,t+1)` 只与同一次 parent/gap decode 的精确实际 PCM support 求交，zero-duration blocker 已解决；CPU/CUDA short/medium/long 功能矩阵全部通过，manifest 不再 `postMvpUnavailable`。owner-authorized exact CUDA bytes 已发布为 shared-v3 dependency，official/China downloads、default authority、普通构建和本地包装检查通过；shared-v2 保留回滚，应用 release authority 未扩大。

## P0 — 收敛规划

- [x] 读取 child/parent requirements、历史 R1/R2 证据、当前 Qwen/Parakeet 产品接线与 pinned upstream ReazonSpeech 路线。
- [x] 记录 `research/planning-evidence.md`：历史 blocker、当前完整 CLI、模型仓库 hashes、现有复用 seam 与 publication 边界。
- [x] 完成 PRD、design、implement 与 context manifests。
- [x] 运行 `task.py validate`、规划一致性审查并取得 owner 实现授权。
- [x] `task.py start` 已激活本 child；未执行任何 Git history/remote mutation。

## P1 — 冻结 acquisition、调用与首轮真实证明（AC1–AC4）

- [x] 加载 applicable specs；冻结 full-CLI `model + vad` route、exact Q8_0 acquisition/license identity 和 CPU/CUDA device/output contract。
- [x] 最小扩展 full-CLI adapter/worker/parser；保留 Qwen merge 与 Parakeet TDT 隔离。
- [x] 由现有 producer 创建三引擎 local candidate；candidate lock/archive verifier 绑定 CPU/CUDA archive 与 closure，旧 shared-v2 未覆盖、未上传。
- [x] Reazon CPU/CUDA short 与 Qwen/Parakeet CPU/CUDA short regression 通过；CT2 root/DLL 隔离通过。
- [x] exact Q8_0 保持唯一 artifact；未启动 F16/Q4_K 或 converter 研究。

P1 gate：两个设备的 short route、device proof 与 sibling runtime regression 均通过，才进入 host/product 接线。

## P2 — Worker、host、ASS 与生命周期（AC2–AC4）

- [x] Native protocol 与 Rust `validate_route` 固定 `model + vad` roles，并拒绝 aligner、多余/缺失 role、错误文件、Vulkan 与自定义/禁用 VAD。
- [x] ReazonSpeech 复用 full-CLI private workspace、canonical relative audio、allowlisted environment、bounded result、watchdog 与 suspended Job ownership。
- [x] pure-RNNT `[t,t+1)` + exact parent/gap PCM-support intersection 在 display 前完成；byte/NUL/UTF-8/JSON、单位、bounds、positive duration、顺序、文本守恒和 silence 仍严格验证。
- [x] `segmentsReplace` 前完成全部校验；error/cancel/partial output 保留已有字幕。
- [x] focused fixture/fault、CPU/CUDA host/cancel/reap/cleanup/recovery 与 ASS persistence 检查通过。

P2 gate：CPU/CUDA host→worker→CLI→atomic ASS 与 cancel/recovery 都通过，无 partial overwrite。

## P3 — Managed model 与 UI（AC5–AC7）

- [x] trusted manifest 增加最终唯一 ReazonSpeech artifact、exact source/revision/size/SHA/license 与 frozen shared Silero 引用；manifest route gate 已开放。
- [x] `asr_models.rs`、resume/atomic publish/repair/offline reuse/cleanup/shared-VAD sibling protection与测试完成。
- [x] embedded CPU+CUDA engine membership 与 exact model readiness 共同授权；published/default shared-v3 允许 ReazonSpeech，shared-v2 rollback 仍保持原字节。
- [x] 设置、ModelManager、TranscribeView 增加 exact 模型和 CPU/CUDA payload，无量化/VAD/source-language/backend 控件；前端 failure/cancel/silence 保留字幕测试通过。

P3 gate：local candidate build 下端到端可选择/下载/启动；普通旧 lock 不误报可用。

## P4 — 最终 CPU/CUDA 功能矩阵（AC2–AC8）

- [x] 最终 `shared-reazonspeech-final-r1` 由 candidate lock/archive verifier 冻结；任务 mutex/process inventory 保持串行与 clean exit。
- [x] CPU 与 CUDA 分别完成 short-v1、medium-v1、long-v2；resolved device、无回退、graph proof、exact PCM-support intersection、strict UTF-8/JSON/ASS、正时长/顺序/bounds、文本守恒全部通过。
- [x] progress、cancel/recovery/offline/cleanup、invalid input/runtime 与 prior ASS preservation 通过；未计算 CER、语义缺口、Python parity、RTF/RSS 阈值或 inherited-GPU 标签。

| Device | short-v1 | medium-v1 | long-v2 |
| --- | ---: | ---: | ---: |
| CPU rows | 12 | 207 | 1166 |
| CUDA rows | 12 | 206 | 1159 |

P4 gate：通过；zero-duration blocker 已解决，manifest route gate 已开放。

## P5 — 共享 dependency、local app 与最终检查（AC5–AC9）

- [x] local shared candidate package、NSIS/portable 内容/预算与 CPU/CUDA real WebView 选择→readiness→转录→ASS 保存/失败保留检查通过。
- [x] owner-authorized CUDA dependency publication/default-lock enablement 完成：新 immutable `hikaru-asr-crispasr-windows-x64-cuda-shared-v3.zip` 已上传，official/China rows 与默认 lock/CPU resource 切换到 exact candidate bytes；shared-v2 未覆盖或删除。
- [x] focused Native/Cargo/frontend/package/path/privacy checks完成；candidate-review 复跑 endpoint、task validation、focused availability tests 与 `git diff --check`。
- [x] 更新 applicable specs 与 parent progress；不得主动 commit/push/archive。

## 主要验证命令

实际实施时记录 exact build dirs、test filters、model-run commands、hashes 和 exit status；下面只是最低集合：

```bash
python ./.trellis/scripts/task.py validate 09-01-native-asr-reazonspeech-productization
git diff --check
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
python -B native-asr/runtime/full-cli/path_check.py
pnpm release:local
```

另需：

- fresh CPU/CUDA Native build 的完整 CTest；
- full-CLI source/argv/device/fault checks；
- task-owned serial ReazonSpeech short/medium/long harness；
- Qwen 与 Parakeet CPU/CUDA regression；
- candidate lock/archive verifier；
- 若 publication 获授权，official/China 两源 exact archive download/install verification。

## Rollback points

- P1：模型/provenance/runtime 不成立时，保留 ignored-local evidence，回退到保留的 shared-v2 authority。
- P2/P3：只禁用 ReazonSpeech，不撤销 Qwen/Parakeet/CT2，也不恢复 Python。
- P4：任一 device/case/功能门禁回归则关闭 engine availability；不得 relabel 失败或回退旧时间轴策略。
- P5：发布后回归只恢复 shared-v2 default lock/CPU resource/source rows；不得覆盖或删除 immutable shared-v3 remote asset。
