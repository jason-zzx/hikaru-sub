# Build Native ASR MVP model manager

## Goal

为首个 Native ASR MVP 交付唯一必需的 `faster-whisper / large-v3` CTranslate2 模型管理能力：冻结精确模型身份，实现安全下载、校验、原子安装和 readiness，使全新安装无需 Python 即可使用已缓存模型完成本地转录。

Manifest 和下载器保持可扩展，但其他 CT2/GGUF/Qwen companion entries 属于 post-MVP，不阻塞首版。

## Priority And Release Role

- Priority: P1.
- Native MVP critical-path task。
- 首版只要求 large-v3 CT2 model identity/readiness。
- 不负责字幕质量改进、runtime 打包、设置/UI 或 release cutover。

## Authority And Dependencies

- 依赖归档 T02 已证明可加载的 CT2 格式和 `faster-whisper -> ctranslate2` route。
- 依赖父任务的 installed/portable managed-root、official/China source 和下载安全合同。
- 可读取归档 logical-model mapping，但不得把 Python artifact 当作 Native 可用文件。
- Candidate A 的质量 disposition 不由本任务改变；model ready 不等于 subtitle-quality qualified。

## Requirements

1. 冻结 large-v3 CT2 的 engine/backend、variant、revision、必需文件角色、URL/source role、精确大小、SHA-256、许可证和 attribution。
2. 使用版本化 manifest；结构允许后续增加其他 CT2/GGUF/companion entries，但首版无需补齐它们。
3. 实现官方/中国大陆源解析、受管 `.part`、可用时断点续传、大小/SHA 校验和原子安装。
4. 只有 large-v3 全部必需文件验证完成后才标记 ready；同名、不完整、错 hash 或错误 framework 文件必须 fail closed。
5. 并发相同下载合并；失败不得破坏已验证文件或旧可用版本。
6. 新下载限制在 `deps/models/ctranslate2`，临时文件限制在 `deps/downloads`；cleanup 不得越出受管 `deps/`。
7. 合法旧 Hugging Face CT2 snapshot 可在精确验证后复用，不强制复制。
8. 模型状态合同必须能向 T16/T17 区分 `large-v3 available` 与其他模型 `post-mvp-unavailable`。

## Acceptance Criteria

- [ ] large-v3 CT2 条目具备完整 revision/size/SHA/license/file-role metadata，不以 floating `main` 作为唯一 release lock。
- [ ] official/China source routing、resume、hash mismatch、partial failure、atomic install 和 duplicate coalescing 测试通过。
- [ ] valid legacy CT2 snapshot 可复用；同名文件、Python framework cache、不完整目录或 identity drift 不会误报 ready。
- [ ] installed/portable 路径和 bounded cleanup 测试通过。
- [ ] 输出稳定的 large-v3 identity/readiness contract，供 T13 smoke、T16、T17 和 T18 消费。
- [ ] 其他模型未完成时明确返回 post-MVP/unavailable，不阻塞 large-v3 MVP。

## Post-MVP Expansion

- 其他 ordinary Whisper 模型和 large-v2。
- Kotoba CT2 model/preprocessor identity。
- Parakeet、ReazonSpeech GGUF。
- Qwen3 ASR + ForcedAligner companion pair。

这些 entries 可在同一 manifest/downloader architecture 上增量加入，但不属于本 task 的 MVP 完成条件。

## Forbidden Claims

- 不得声称 model ready 等于字幕质量 qualified、runtime packaged、production route enabled 或 release ready。
- 不得为了未来模型提前实现不需要的 companion/grouping/engine policy。

## Out Of Scope

- Native inference、benchmark acquisition、字幕质量修订。
- CPU/GPU runtime 构建、设置、前端和 release cutover。
- 自动迁移或复制不兼容的 Python framework 模型权重。
