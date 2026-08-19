# Build native ASR model manager

## Goal

建立 native ASR 模型交付和下载的唯一 identity authority，冻结 CT2、GGUF、许可证、文件角色与 Qwen ASR/ForcedAligner companion mapping，为后续 pack、设置、前端和 release evidence 提供精确可验证的模型身份。

## Authority And Dependencies

- 依赖归档 T02/T03 已证明可加载的 CT2/GGUF 格式和 backend route。
- 依赖 `.trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/model-identity-manifest.json` 的 logical-model mapping；不得把 Python artifact 当 native 可用文件。
- 依赖父任务的固定 engine-to-backend route、portable/installed managed-root 和下载安全合同。
- 可与质量修订并行；mapping 冻结不会将任何 observed `stop-revise` candidate 提升为 qualified。

## Requirements

1. 为每个 native model file 冻结 engine/backend、variant、revision、URL/source role、精确大小、SHA-256、许可证、attribution 和安装 file role。
2. 明确冻结 Qwen3 ASR GGUF 与 ForcedAligner GGUF 的 companion pair；T11 final evidence 必须绑定该精确 pair。
3. 实现官方/中国大陆源解析、受管 `.part`、可用时断点续传、大小/SHA 校验、原子安装和多文件 readiness marker。
4. 并发相同下载应合并；部分失败不得破坏已验证 companion，且不把不完整 pair 标记 ready。
5. 新下载限制在 `deps/models/{ctranslate2,crispasr,shared}` 与 `deps/downloads`；cleanup 不得越出受管 `deps/`。
6. 兼容读取合法旧 CT2 snapshot；旧 PyTorch/NeMo/Qwen framework weights 不得误报为 native ready。
7. 只负责 identity、下载、readiness 和 storage 合同，不实现推理或质量修复。

## Acceptance Criteria

- [ ] 所有支持的 CT2/GGUF/companion 条目均无 floating `main` 单独作为 release lock，且具备完整 revision/size/SHA/license/file-role metadata。
- [ ] Qwen ASR + ForcedAligner pair 可由 T11 evidence 唯一解析并验证，缺失、错配或部分安装均 fail closed。
- [ ] 下载 resume、hash mismatch、partial failure、atomic install、duplicate coalescing、legacy CT2 cache、portable/installed path 和 bounded cleanup 测试通过。
- [ ] 模型状态不会因存在同名文件、旧 framework cache 或 pending mapping 而误报 ready/qualified。
- [ ] 输出稳定的 model identity/readiness contract，供 T11、T14/T15、T16、T17 和 T18 消费。

## Forbidden Premature Claims

- 不得声称任何模型 subtitle-quality qualified、runtime pack qualified、production route enabled 或 release ready。
- 不得将 mapping 完成描述为 Parakeet P1、ReazonSpeech R2 或 Qwen T03C 的唯一 blocker 已解除。

## Out Of Scope

- Native inference、benchmark acquisition、字幕质量算法修订和 Qwen grouping。
- CPU/GPU runtime 构建、设备 qualification、设置/前端迁移和 release cutover。
- 自动迁移或复制不兼容的 Python framework 模型权重。
