# Build provisional native ASR CPU runtime package

## Goal

建立可复现的 Windows x64 CPU runtime packaging pipeline 和 provisional smoke artifact，提前验证 worker/DLL/manifest/license/size/installed/portable 形状，同时把最终 worker/runtime identity 的 rebuild 与 attestation 明确保留给 T18。

## Authority And Dependencies

- 依赖归档 T04 protocol/fake-worker contract 和 T06 已稳定的 production worker seam。
- 可与 T06R/T08R/T11/T12 并行，但 provisional artifact 不等待或冻结最终 accepted engine identity。
- T18 是最终 immutable CPU worker/runtime rebuild、hash、license 和 release attestation owner。
- Candidate B ORT/VAD、Parakeet P1、ReazonSpeech R2 及其他 rejected/non-accepted candidate 不得因本任务进入 release package。

## Requirements

1. Pin CTranslate2、CrispASR、compiler、CMake、Ninja 和必要 CPU runtime dependencies，生成可重复执行的 packaging pipeline。
2. 产出仅用于 protocol/backend smoke 的 provisional worker/DLL/runtime-manifest/license/SHA-256 artifact；不得包含模型权重。
3. 验证 installed 与 portable layout、artifact verification hook、`pnpm release:local`/portable consumption seam，但不切换 production package input。
4. 编译仅需要的已稳定 capability；不得加入 rejected ORT/VAD candidate 或把未通过模型算法固化为 final worker identity。
5. 测量 provisional setup、portable ZIP 和 unpacked CPU runtime 体积，证明父任务预算可达或记录 blocker。
6. 定义 T18 final rebuild input contract：accepted engine source/config identities、toolchain、runtime dependencies、licenses、hashes 和 deterministic attestation。
7. End-user packaging 不得运行 CMake，也不得下载或捆绑模型。

## Acceptance Criteria

- [ ] 从干净输入重复构建得到符合已定义 reproducibility policy 的 provisional artifact 和完整 component/license manifest。
- [ ] Provisional artifact 在 installed/portable smoke 中通过 protocol/backend loading，且模型权重数量为 0。
- [ ] Artifact verification、hash mismatch、missing DLL、wrong manifest、path isolation 和 package-consumption seam 测试通过。
- [ ] 体积测量覆盖 setup/portable/unpacked 三项，并明确是否满足父任务预算；不以缺失测量声称通过。
- [ ] 文档和 metadata 明确标记所有 worker/hash 为 provisional，T18 final rebuild/attestation contract 可由 accepted engine identities 唯一驱动。
- [ ] Production/default 仍为 Python legacy，现有 release inputs 未被替换。

## Forbidden Premature Claims

- 不得声称 provisional worker、hash、runtime manifest、CPU route、installer 或 native release 为 final/qualified。
- 不得让 provisional packaging 反向授权任何 `stop-revise`、`baseline-incomplete` 或 omitted model lane。

## Out Of Scope

- 最终 T18 rebuild/attestation、T14/T15 GPU packs/device qualification。
- 模型 manifest/downloader、模型权重打包、质量 benchmark acquisition 或算法修订。
- 设置、前端、production route、安装器默认切换和 Python legacy 移除。
