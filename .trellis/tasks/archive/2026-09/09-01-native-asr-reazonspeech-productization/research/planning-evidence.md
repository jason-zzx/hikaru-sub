# ReazonSpeech Native 迁移规划证据

## 范围与证据边界

本文件仅记录规划阶段的只读调查；未下载模型、未编译、未运行推理、未替换 runtime、未启用产品路线。

当前 Native 主线固定 CrispASR `e2a356146e36bc1cc0410edefb01990448766979`（v0.8.32）。模型仓库信息通过 Hugging Face API 获取；正式获取前仍须冻结并复核同一 revision、文件长度、SHA-256、许可证和 GGUF metadata。

## 历史失败不是当前实现基线

Archived R2 `R2-vad12-pad30-overlap-top-level-v1` 使用 CrispASR v0.8.22 direct session ABI、Q8_0、调用方 VAD 窗口和“一窗口一 top-level cue”策略。最终结果：

- short-v1：CER `0.266667`，1 个语义缺口；
- medium-v1：CER `0.295385`，19 个语义缺口；
- long-v2：第 62 次窗口调用返回本地 `2160..2160ms`，形成 `zero_duration_top_level_result`，整例无可接受输出；
- disposition：`stop-revise`，仅 `better-than-r1`。

该证据只说明旧调用/分段策略未完成合法 long-audio 输出，不证明模型、Q8_0 或当前完整 CLI 本身不可用。不得恢复旧 direct-ABI R2 policy；历史 CER、语义缺口和 partial RTF 仅保留为 archived context，不进入当前 functional-only 验收。

权威记录：

- `.trellis/tasks/archive/2026-08/08-14-native-asr-reazonspeech-r2/research/reazonspeech-r2-report.md`
- `.trellis/tasks/archive/2026-08/08-14-native-asr-reazonspeech-r2/research/reazonspeech-r2-evidence.md`

## 当前 pinned upstream 发现

1. `examples/cli/crispasr_backend.cpp` 将 `reazonspeech` 显式映射到完整 Parakeet/FastConformer-RNNT backend；GGUF auto-detect 也将 ReazonSpeech 识别为该 backend。
2. `examples/cli/crispasr_backend_parakeet.cpp` 根据实际日语 vocabulary 判定 `is_ja_model_`，而不是依赖 Parakeet 文件名。日语路线偏好 VAD，VAD speech slice cap 为 12 秒，并调用 `parakeet_transcribe_segments(...)` 的完整 upstream orchestration。
3. 同一 upstream 路线包含日语 bounded slicing、native RNNT decode、display segmentation 和 actual-audio gap retranscription；这正是旧 R2 direct ABI 绕开的完整 CLI 路径。规划因此优先复用完整 CLI，而不是继续自研窗口策略或时间轴修复。
4. `src/crispasr_model_registry.cpp` 将 `reazonspeech` 指向 `cstr/reazonspeech-nemo-v2-GGUF/reazonspeech-nemo-v2-q8_0.gguf`；该 upstream registry 推荐的 Q8_0 是本任务固定 artifact，其他量化不进入规划。
5. 当前共享 CrispASR CLI/DLL 源码已编入 ReazonSpeech backend，但产品 lock 的 `engines` 仅授权 Qwen3-ASR 与 Parakeet；当前 worker/full-CLI adapter、Rust route、manifest 和 UI 也仍拒绝 ReazonSpeech。因此“binary 含代码”不等于产品可用。

Pinned source anchors：

- `native-asr/build/full-cli/source-pristine/examples/cli/crispasr_backend.cpp`
- `native-asr/build/full-cli/source-pristine/examples/cli/crispasr_backend_parakeet.cpp`
- `native-asr/build/full-cli/source-pristine/src/crispasr_model_registry.cpp`
- `native-asr/build/full-cli/source-pristine/hf_readmes/reazonspeech-nemo-v2-GGUF.md`
- `native-asr/build/full-cli/source-pristine/models/convert-parakeet-to-gguf.py`

## 模型仓库快照

2026-09-08 查询结果：

- logical model：`reazon-research/reazonspeech-nemo-v2`
  - revision：`33693408be76b7cba9fd4a7546a0a8772430211b`
- Native repository：`cstr/reazonspeech-nemo-v2-GGUF`
  - revision：`22799a5919ea26e3c5293fe0e68846fe7918a234`
  - Q8_0：`reazonspeech-nemo-v2-q8_0.gguf`
    - bytes：`667147072`
    - SHA-256：`20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2`

模型卡声明 Apache-2.0，Q8_0 为推荐通用量化。当前规划固定使用 upstream registry 推荐的 exact Q8_0，并锁定 repository revision、文件 bytes/SHA、GGUF metadata、许可证与再分发依据；仓库未公开的 exact converter commit/args 如实记录为 unknown，不推测，也不为此启动转换复现或其他量化比较。

## 当前产品接线

可复用而不应重写：

- `native-asr/src/full_cli.cpp`：受控 CLI 子进程、私有工作目录、allowlisted environment、bounded result、严格 UTF-8/NUL、watchdog/Job 安全；当前只接受 Qwen/Parakeet。
- `native-asr/src/parakeet_cli.cpp`：Parakeet JSON/display 解析与严格时间轴校验；ReazonSpeech 可共享进程层，但必须有自己的 backend/model identity 和测试，不能伪装成已验证 Parakeet。
- `src-tauri/src/asr_worker.rs`：完整 CLI 私有目录和 route/role 校验。
- `src-tauri/src/asr_models.rs` + `native-asr-models.json`：compound model + shared Silero 的下载、resume、atomic publish、repair、offline reuse、cleanup。
- `native-asr/runtime/crispasr-product-lock.json`：CPU/CUDA exact artifact 和 engine allowlist；未列出的 engine 必须 fail closed。
- 现有设置、ModelManager、TranscribeView、ASR job/ASS 原子替换流程。

## 规划结论

- 主实现路线：pinned CrispASR 完整 CLI，显式 `reazonspeech` backend，exact `model + vad` roles，复用已冻结 CPU Silero；这只是 ReazonSpeech 必需 pipeline，不开放通用 VAD 产品功能。
- 最终 artifact 固定为 upstream registry 推荐的 exact Q8_0；它必须重新通过当前完整 CLI 的 CPU/CUDA 功能、设备、输出安全、许可与交付验证，但不进行 CER/语义缺口/RTF 资格、主观质量排名或 F16/Q4_K 比较。
- 后续根因/上游/影响调查确认 pure-RNNT 权威 endpoint 为 NeMo `[t,t+1)`；owner 明确批准再与同一次 parent/gap decode 的精确实际 PCM support 求交，仅移除卷积 padding 超出真实输入的 extent。禁止项仍包括 next-cue、display/VAD/slice-end 猜测、相邻合并、比例时间、参考文本修复和 Python fallback。
- 最终候选 `shared-reazonspeech-final-r1` 已通过 CPU/CUDA short/medium/long 功能矩阵，zero-duration blocker 已解决，manifest route gate 已开放。后续 owner-authorized dependency action 将 exact CUDA bytes 发布为 shared-v3，并通过 official/China download/install/probe 与默认 authority 检查；shared-v2 保留回滚且应用 release authority 未改变。
