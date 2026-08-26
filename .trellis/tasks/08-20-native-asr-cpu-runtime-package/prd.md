# Build final Native ASR MVP CPU runtime package

## Goal

产出首个 Native ASR MVP 可直接发布的 Windows x64 bundled CPU runtime artifact，使安装版和 portable 在 end-user 机器上无需 CMake、Python、venv 或模型权重即可加载 `faster-whisper / large-v3` CTranslate2 worker。

本任务不再产出 provisional-only artifact；它拥有首版最终 worker/DLL/runtime-manifest/license/hash identity。T18 负责集成和复核，不因 post-MVP engine identities 再次重建该 artifact。

## Priority And Release Role

- Priority: P1。
- Native MVP critical-path task。
- 与 T12 model manager 可并行；model-backed smoke 在 T12 large-v3 identity 可用后完成。

## Authority And Dependencies

- 依赖归档 T04 protocol/fake-worker、T05 Rust host 和 T06 production CTranslate2 worker seam。
- 复用 Candidate A `selected-cpu-beam1-no-history` 的稳定 algorithm/config seam。
- 首版只交付 CTranslate2 CPU capability；CrispASR、CUDA/Vulkan、Candidate B ORT/VAD 和其他 rejected/non-MVP capability 默认省略。
- T12 冻结 large-v3 model identity；本任务不下载或捆绑模型。

## Requirements

1. Pin CTranslate2、oneDNN、compiler、CMake、Ninja、tokenizer/build inputs 和必要 Windows runtime dependencies。
2. 从干净输入可重复构建 `hikaru-asr-worker.exe`、必需 DLL、`runtime-manifest.json`、licenses 和 SHA-256 清单。
3. 只编译 protocol、large-v3 CTranslate2 CPU inference 和 host integration 所需 capability；不为 post-MVP 引擎增加交付范围。
4. Artifact 内 Python runtime、venv、FastAPI、PyTorch、NeMo、CrispASR、CUDA/Vulkan 和模型权重数量均为 0。
5. 为 `pnpm release:local`、installer 和 portable 提供 verified artifact preparation/consumption seam；end-user packaging 不运行 CMake。
6. 验证 artifact hash、missing/wrong DLL、manifest mismatch、PATH/DLL isolation 和 managed-root load。
7. 在 installed/portable layout 使用 T12-ready cached large-v3 完成短音频和 >10 分钟音频功能 smoke；只要求完成、非空合法输出和协议稳定，不要求 Python quality parity。
8. 测量 setup、portable ZIP 和 unpacked CPU runtime 体积，并对父任务预算给出明确 pass/blocker。
9. 发布可由 T18 唯一消费的 final MVP runtime identity 和第三方 license/attribution handoff。

## Acceptance Criteria

- [ ] 两次 clean build 满足冻结的 reproducibility policy，component/source/toolchain/runtime identity 完整。
- [ ] Final artifact 在 installed/portable layout 通过 protocol/backend loading、短音频和 >10 分钟 cached-model smoke。
- [ ] 输出非空、UTF-8 合法、时间有序、正时长且 audio-bounded；cancel/crash/recovery host contract 不因 packaging 改变。
- [ ] Artifact verification、hash mismatch、missing/wrong DLL、manifest mismatch、path isolation 和 package-consumption seam 测试通过。
- [ ] Artifact 不包含 Python/CrispASR/GPU/ORT/VAD/模型权重等非 MVP 内容。
- [ ] Setup/portable/unpacked 三项体积完成测量并满足预算，或发布明确 blocker 而不是声称通过。
- [ ] T18 可直接验证并消费该 final artifact，无需基于 optional engine identities 重建。
- [ ] Production/default 在 T18 通过前仍为 Python legacy，现有 release inputs 未提前切换。

## Rollback

- 删除或撤回本 task 的 artifact/manifest consumption seam，恢复前一 production package input。
- 不删除用户模型、缓存、项目、字幕或设置。

## Out Of Scope

- T12 model downloader/manifest 实现和模型权重打包。
- CrispASR、Kotoba、Qwen3、Parakeet、ReazonSpeech 或其他 Whisper 模型。
- CUDA/Vulkan packs、设备 qualification、设置、前端和 production route cutover。
- 字幕质量 parity 修订或 benchmark candidate discovery。
