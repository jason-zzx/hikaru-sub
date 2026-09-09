# Productize Native ReazonSpeech NeMo

## Goal

在 Parakeet child 完成后，将 v0.4.1 的 exact `reazon-research/reazonspeech-nemo-v2` 路线迁移为生产 Native ASR，并保留模型原生时间戳来源、长音频进度和取消能力。

## Background

- 历史 Python 路线使用 NeMo/PyTorch，短音频整段解码，长音频按固定窗口处理。
- archived Native R1/R2 evidence 的最终 disposition 为 `stop-revise`；R2 虽优于 R1，但 long-v2 在第 62 个窗口出现 `zero_duration_top_level_result`，未形成完整有效结果。
- 当前产品将该模型标记为 `postMvpUnavailable`；development seam 不等于生产资格。

## Requirements

1. 用户可见逻辑 identity 固定为 `reazon-research/reazonspeech-nemo-v2`；Native GGUF/其他转换格式与量化可重新选择或构建，但不得替换为其他 ReazonSpeech 模型。
2. 历史 cstr Q8_0 转换只作为 candidate baseline。最终 artifact 必须锁定上游 revision/hashes、converter source/commit/args、量化、输出 size/SHA、metadata、Apache-2.0 attribution 和 redistribution authority。
3. 多个候选均通过时，选择字幕质量/时间轴证据最强、并符合上游/社区推荐、成熟度、维护、复现和 CPU/CUDA 稳定性的一个 artifact；文件体积不优先。产品只暴露一个 ReazonSpeech 模型，不提供量化 UI。
4. 根治或稳定 fail closed 长音频 zero-duration blocker；不得 synthetic expand、clip/stretch、平均分配或填造时间轴。
5. 保留 accepted cue 对模型原生 token/range/timestamp provenance 的可追溯性。
6. 接入受管模型 manifest、下载、校验、离线复用、修复和清理。
7. 复用现有 Native worker/Tauri job、取消、恢复、ASS、设置和前端可用性流程。
8. ReazonSpeech 必须同时取得生产 CPU 与 CUDA 支持；两种设备共享 exact 模型与算法合同，但分别验证 runtime、设备解析、真实执行、错误、取消、恢复和进程清理。
9. CUDA 使用最终冻结 identity 完成 short-v1、medium-v1、long-v2 的完整质量与性能资格矩阵；CPU 使用同一逻辑模型和算法完成三个 case 的真实功能矩阵及生命周期验证，不重复发布 CER、RTF 或独立质量排名。
10. CPU 只有在 exact CUDA candidate 通过且自身功能矩阵通过后才可记录 `qualificationSource=inherited-from-gpu`。
11. 复用 Qwen child 冻结的共享随包 CrispASR CPU runtime 与按需 CrispASR CUDA pack；不得创建 ReazonSpeech 专属 runtime pack，模型权重继续独立按需下载。
12. 失败、缺模型或缺 runtime 不得影响已完成的 CTranslate2/Qwen/Parakeet 路线，也不得回退 Python。
13. 本任务完成并归档后才进入 VAD child。

## Acceptance Criteria

- [ ] exact upstream ReazonSpeech logical identity 与唯一最终 Native conversion/runtime/device identity 已冻结，具备完整 converter、量化、来源、哈希、Apache-2.0 attribution 和再分发合同；选择记录证明质量/合理性优先，历史 Q8_0 未被自动提升。
- [ ] long-v2 不再产生可被接受的 zero-duration cue；失败时返回稳定结构化错误且零伪造 partial output。
- [ ] CUDA 三个 benchmark case 均有最终 identity-valid completed 或 structured-failure row，并完成质量与性能资格。
- [ ] CPU 使用最终 runtime/model identity 完成 short/medium/long 真实功能矩阵，并通过设备解析、进度、取消、恢复、离线和清理门禁，不复制 GPU 指标。
- [ ] 模型下载、离线和前端流程通过；ReazonSpeech 权重未进入共享 CPU/CUDA runtime pack。
- [ ] 共享随包 CPU runtime 与按需 CUDA pack 的 exact identity 被 ReazonSpeech evidence 绑定，且未引入模型专属 runtime 副本。
- [ ] 发布包与运行路径不要求 Python、venv、PyTorch 或 NeMo。
- [ ] 已发布模型路线无回归，ReazonSpeech 可独立关闭或回滚。
- [ ] CPU 或 CUDA 任一资格缺失时保持 `postMvpUnavailable`；两种设备全部通过后才切换为可用。

## Out Of Scope

- Qwen3、Parakeet、VAD、Kotoba K3 或应用版本发布。
- 用 synthetic timing 修复 historical long-v2 evidence。
