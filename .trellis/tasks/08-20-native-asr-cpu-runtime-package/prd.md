# Build final Native ASR MVP CPU runtime package

## Goal

产出首个可直接发布的 Windows x64 Native ASR bundled CPU runtime，使安装版和 portable 在终端用户机器上无需 CMake、Python、venv 或捆绑模型权重，即可加载 `faster-whisper / large-v3` CTranslate2 worker。

本任务拥有首版最终 worker、DLL、runtime manifest、license、hash 和 packaging identity。T18 只集成并复核该 artifact，不因 post-MVP engine identities 再次重建。

## Release Role

- Priority: P1。
- Native MVP critical path: `(T12 model manager + T13 CPU runtime package) -> T16 -> T17 -> T18`。
- T12 与本任务可并行；model-backed smoke 在 T12 large-v3 identity 可用后完成。
- Production/default 在 T18 通过前仍保持 Python legacy。

## Confirmed Facts

- 归档 T04/T05/T06 已提供 protocol v1、Rust native job host、取消/崩溃/恢复合同和 production CTranslate2 worker seam。
- MVP 算法输入固定为归档 T06 `selected-cpu-timestamp-no-history-beam1`：Windows x64、CPU `int8`、beam 1、无 previous-text history、无 VAD。
- 冻结模型为 `Systran/faster-whisper-large-v3` revision `edaa852ec7e145841d8ffdb056a99866b5f0a478`；模型文件与下载/readiness 由 T12 拥有，本 artifact 不包含模型权重。
- 当前 `native-asr/CMakeLists.txt` 仍从归档 task 的 ignored `research/local` 读取 CT2/oneDNN/pocketfft，并且普通 CT2 worker 构建无条件编译、链接和复制 Candidate B ONNX Runtime/Silero VAD 依赖；它不能直接作为最终 MVP package 输入。
- 当前 app release 只准备 Python `asr-service` resource；portable staging 只复制 executable、runtime source manifest 和 `asr-service`，尚无 native runtime preparation/verification seam。
- 冻结体积预算来自父任务技术设计：Windows setup `<= 80 MB`、portable ZIP `<= 90 MB`、解压 CPU ASR runtime `<= 250 MB`、安装包内模型权重 `0`。
- Windows-only 构建允许使用 MSVC、CMake、Ninja、Cargo 和 PowerShell；终端用户机器不得执行这些构建工具。

## Requirements

### R1 - Freeze clean build inputs

- 用 tracked lock 固定 CTranslate2、oneDNN、pocketfft、Rust/tokenizer dependency graph、MSVC、Windows SDK、Rust、CMake、Ninja 和必要 Microsoft runtime dependency identities。
- 构建不得依赖任何 active/archived task 的 ignored `research/local`、用户模型目录或机器私有绝对路径。
- 从空 build/cache root 获取并校验 source archives 与 Git 跟踪的紧凑 CTranslate2 DLL/import-library 构建输入，使用结构化参数构建；hash、版本或 toolchain 不匹配时 fail closed。

### R2 - Build only the MVP capability

- Final preset 只启用 protocol v1、WAV decode、ordinary faster-whisper CTranslate2 CPU inference、tokenizer 和 worker entry point。
- MVP artifact 不包含 Python、FastAPI、PyTorch、NeMo、CrispASR、CUDA/Vulkan、Candidate B ONNX Runtime/Silero VAD 或模型权重。
- `useVad=true`、GPU device 或非 MVP backend 请求必须返回稳定受控错误，不能通过缺失 DLL 偶然失败，也不能静默回退。
- 历史 development-only backends/tests 可保留，但 final runtime preset 和 artifact staging 不得消费它们。

### R3 - Produce a deterministic attested artifact

- 两次独立 clean build 使用同一 lock/toolchain 后，runtime payload 和 archive 必须 byte-identical。
- 构建应固定 archive entry 顺序/时间戳，并使用 MSVC/Rust path remapping 与 reproducible-build flags，manifest 中不得写入 wall-clock time、用户名或绝对路径。
- Artifact 至少包含：`hikaru-asr-worker.exe`、必要非系统 DLL、`runtime-manifest.json`、`SHA256SUMS` 和 `licenses/`。
- Manifest 必须绑定 artifact schema/id、platform/arch、protocol/config identity、source/toolchain identities、capabilities、每个 payload file 的 role/size/SHA-256、允许的系统 DLL 和 license/attribution inventory。

### R4 - Verify package integrity and isolation

- 一个共享 verifier 同时服务构建收尾、resource preparation、CI/release 和测试。
- Verifier 必须拒绝 archive/hash mismatch、missing/extra/wrong DLL、manifest/file mismatch、路径穿越、非 MVP 文件/能力和模型权重。
- 在只包含 artifact directory 与 Windows System32 的受限 DLL/PATH 环境中验证 worker 可启动、加载 backend，并且已加载的非系统模块都来自 artifact root。
- 覆盖 installed 与 portable resource layout；错误 artifact 必须在 Tauri 打包前失败。

### R5 - Integrate release consumption without production cutover

- `pnpm release:local`、GitHub release workflow、NSIS resource 和 portable staging 必须消费同一个 verified artifact identity；end-user packaging 不运行 CMake。
- T13 可以增加并打包 native runtime resource，但不得切换 production/default ASR route、删除 Python resource 或修改用户设置；这些属于 T16～T18。
- T18 必须能直接读取 tracked lock/manifest 并验证 T13 artifact，无需重建。

### R6 - Run functional smoke with T12 model identity

- 在 installed-like 与 portable-like layout，使用 T12-ready cached large-v3 分别完成短音频和 `>10` 分钟音频 CPU smoke。
- Final output 必须非空、合法 UTF-8、按时间非递减、每段正时长且 `0 <= startMs < endMs <= audioDurationMs`。
- 验证 protocol/backend load、正常完成、cancel `<=2s`、异常退出/recovery 和 active-job release 未因 packaging 改变。
- CER、S/D/I 和 Python parity 只记录为诊断，不决定本任务通过。

### R7 - Measure release size and licensing

- 测量并记录最终 Windows setup、portable ZIP 和解压 CPU runtime 大小。
- 任一预算超限必须明确发布 blocker，不得声称通过。
- Third-party notices 必须覆盖 CT2、oneDNN、pocketfft、nlohmann/json、tokenizer/Rust transitive dependencies 和实际 bundled Microsoft runtime files；Microsoft VC145 DLL 必须绑定 VS18 redistribution authority，并随包提供 hash-locked、未修改的 Visual C++ V14 Redistributable and Runtime 2026 官方条款，明确排除于项目 Apache-2.0 之外；禁止遗漏实际交付文件、使用 VS2022 条款替代或列入未交付 optional engines。

## Acceptance Criteria

- [x] 两次 clean build 在冻结 toolchain/input lock 下产生 byte-identical payload/archive，且无 task-local/private-path dependency。
- [x] Final artifact 仅包含 MVP CPU capability；Python/CrispASR/GPU/ORT/VAD/model-weight 数量均为 0。
- [x] Manifest、SHA-256、license inventory 和实际文件闭集一致，mutation tests 能拒绝 missing/extra/wrong/tampered/path-traversal 输入。
- [x] Worker 在 restricted PATH/DLL 环境从 artifact root 加载，非系统模块无外部污染。
- [x] `pnpm release:local`、NSIS 和 portable 消费同一 verified identity，错误 artifact 在打包前 fail closed，且打包阶段不运行 CMake。
- [x] Installed/portable layout 通过 short 与 `>10` 分钟 cached large-v3 smoke；输出合法，cancel/crash/recovery/active-gate 合同保持通过。
- [x] Windows setup `<=80 MB`、portable ZIP `<=90 MB`、unpacked CPU runtime `<=250 MB`、bundled model weights `0`。
- [x] T18 可直接复核并消费 final artifact；production/default 仍为 Python legacy，未提前 cut over。
- [x] `pnpm test`、`pnpm build`、`cargo test --manifest-path src-tauri/Cargo.toml` 和 final worker CMake/CTest/package checks 通过。

## Out of Scope

- T12 model downloader/manifest/readiness 实现或模型权重打包。
- Faster-Whisper 其他模型、Kotoba、Qwen3、Parakeet、ReazonSpeech、CrispASR。
- CUDA/Vulkan packs、设备 qualification、设置页、前端 availability 和 production route cutover。
- 字幕质量 parity 修订或新的 benchmark candidate discovery。
- Git commit/push、GitHub Release 上传或其他远程状态变更，除非用户另行明确授权。

## Rollback

- 删除本任务新增的 final preset/build-verifier/resource preparation seam，并恢复原 release resource preparation。
- 撤回或删除本任务 artifact/lock 后，production package 继续使用 Python legacy。
- 不删除用户模型、缓存、项目、字幕或设置。

## Decision

- 用户确认采用 **Git 内置 ZIP**：最终 Windows x64 CPU runtime archive 与其 lock 直接纳入仓库，app release 在打包前校验并解压。
- 该方案接受单次约数十 MB 的仓库增长，以换取离线发布、无额外 runtime asset/tag/凭证依赖，以及 T13/T18/CI/本地发布对同一二进制 identity 的直接消费。
- ZIP 是构建与 app packaging 之间的内部 artifact；终端用户获得的是安装包/portable 中已解压的 runtime，不需要手动处理该 ZIP。
- 为消除 task-local/private binary path，Git 另跟踪一个仅供重建 worker 链接使用的紧凑 CTranslate2 DLL/import-library 输入 ZIP；它不会进入最终 runtime 或用户安装包。
