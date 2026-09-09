# Productize Native Parakeet

## Goal

在 Qwen3 child 完成后，将 v0.4.1 的 exact `nvidia/parakeet-tdt_ctc-0.6b-ja` 路线迁移为生产 Native ASR，并在完成后为 ReazonSpeech child 提供已冻结的共享 CrispASR/runtime/model-delivery 合同。

## Background

- 历史 Python 路线使用 NeMo/PyTorch，并支持分块、时间戳、进度和取消。
- archived Native/CrispASR evidence 已证明短音频可运行，但历史 disposition 为 `stop-revise`：medium 存在明显语义缺口，long 未形成有效完成结果。
- 当前产品将该模型标记为 `postMvpUnavailable`；development seam 不等于生产资格。

## Requirements

1. 用户可见逻辑 identity 固定为 `nvidia/parakeet-tdt_ctc-0.6b-ja`；Native GGUF/其他转换格式与量化可重新选择或构建，但不得替换为其他 Parakeet 模型。
2. 历史 cstr Q8_0 转换只作为 candidate baseline。最终 artifact 必须锁定上游 revision/hashes、converter source/commit/args、量化、输出 size/SHA、metadata、CC-BY-4.0 attribution 和 redistribution authority。
3. 多个候选均通过时，选择字幕质量/时间轴证据最强、并符合上游/社区推荐、成熟度、维护、复现和 CPU/CUDA 稳定性的一个 artifact；文件体积不优先。产品只暴露一个 Parakeet 模型，不提供量化 UI。
4. 解决或明确 fail closed 历史 medium/long 阻塞；不得通过 reference repair、synthetic timing、gap fill、clip/stretch 伪造通过。
5. 接入受管模型 manifest、下载、校验、离线复用、修复和清理。
6. 复用现有 Native worker/Tauri job、取消、恢复、ASS、设置和前端可用性流程。
7. Parakeet 必须同时取得生产 CPU 与 CUDA 支持；两种设备共享 exact 模型与算法合同，但分别验证 runtime、设备解析、真实执行、错误、取消、恢复和进程清理。
8. CUDA 使用最终冻结 identity 完成 short-v1、medium-v1、long-v2 的完整质量与性能资格矩阵；CPU 使用同一逻辑模型和算法完成三个 case 的真实功能矩阵及生命周期验证，不重复发布 CER、RTF 或独立质量排名。
9. CPU 只有在 exact CUDA candidate 通过且自身功能矩阵通过后才可记录 `qualificationSource=inherited-from-gpu`。
10. 复用 Qwen child 冻结的共享随包 CrispASR CPU runtime 与按需 CrispASR CUDA pack；不得创建 Parakeet 专属 runtime pack，模型权重继续独立按需下载。
11. 失败、缺模型或缺 runtime 不得影响已发布 CTranslate2/Qwen 路线，也不得回退 Python。
12. 本任务完成并归档后才进入 ReazonSpeech child。

## Acceptance Criteria

- [ ] exact upstream Parakeet logical identity 与唯一最终 Native conversion/runtime/device identity 已冻结，具备完整 converter、量化、来源、哈希、CC-BY-4.0 attribution 和再分发合同；选择记录证明质量/合理性优先，历史 Q8_0 未被自动提升。
- [ ] CUDA 三个 benchmark case 均有最终 identity-valid completed 或 structured-failure row，并完成质量与性能资格；产品启用只接受合法、非空、audio-bounded、time-ordered 输出。
- [ ] CPU 使用最终 runtime/model identity 完成 short/medium/long 真实功能矩阵，并通过设备解析、进度、取消、恢复、离线和清理门禁，不复制 GPU 指标。
- [ ] 模型下载、离线和前端流程通过；Parakeet 权重未进入共享 CPU/CUDA runtime pack。
- [ ] 共享随包 CPU runtime 与按需 CUDA pack 的 exact identity 被 Parakeet evidence 绑定，且未引入模型专属 runtime 副本。
- [ ] 发布包与运行路径不要求 Python、venv、PyTorch 或 NeMo。
- [ ] 已发布模型路线无回归，Parakeet 可独立关闭或回滚。
- [ ] CPU 或 CUDA 任一资格缺失时保持 `postMvpUnavailable`；两种设备全部通过后才切换为可用。

## Out Of Scope

- Qwen3、ReazonSpeech、VAD、Kotoba K3 或应用版本发布。
- 恢复 Python sidecar 或复用 Python model cache 作为生产权威。
