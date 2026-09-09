# Qwen Native：交付状态与清理计划

## 当前结论

功能实现、双设备最终流程、模型/运行时交付与 CUDA Start UI 修复已接受，用户确认应用 CPU/CUDA 均成功。`productEnablementAllowed=true`、`externalStableAssetPublished=true`，当前选择/下载/启动保持启用。**CUDA 依赖发布复核项由用户接受关闭，超时独立代理未执行该次复核；不声称独立通过，不重新复核发布或下载/上传/推理。**

前轮冗余清理及独立复核已完成；用户现已单独批准退休旧 Qwen DEVELOPMENT timeline 整体，任务保持 `in_progress` 执行该最小增量。当前构建仍读 task 内 source/model lock，不能直接移动归档。其他模型/通用 VAD child 待后续独立实施。下列交付表与既有回归是**此前已接受证据，不是本轮重跑**；应用 release、版本、手工安装/卸载仍独立。

## 已完成交付

| 范围 | 接受依据 / 保留锚点 |
|---|---|
| 完整 CLI CPU/CUDA + 必需 CPU VAD | `ac6c0b41-22af-4077-bbc2-52f13eb156ef` 独立接受；VAD compute 源头 reset/false 及 24 个 exact-source 回归 |
| worker/host/ASS 与边界修复 | `0c789bef-4ac2-40a7-bede-438b042b2faa` 独立接受；整 span NUL/UTF-8、物理 reap 与 cleanup_pending 分离 |
| pair + shared VAD 下载/readiness | `5ee93f37-efaf-48fc-bcfc-0ddadc11dd8c` 独立接受；合并进度、续传/修复/原子 publish、角色与独立 runtime 接线 |
| 相邻展示异常合并 | `4f742b02-ad94-4fa3-aeb6-5089804df6c1` 独立接受；真实 parser replay 626/615/112、14 个两行组，CLI/words/LIS 不变 |
| 修复后最终双设备功能/生命周期/本地包审计 | `b7bb6298-8652-4cf6-aa6d-dd1f075b58c4` / child `12c34753-97ce-4847-bc15-c40d1c5e0b7c`，报告 `qwen/repaired-final-functional-review.md` 独立接受 |
| 模型入口启用 | `43151b4d-921a-4024-a6b6-80a5d5da30d9` 独立接受；真实 readiness/nonfallback 保持 |
| CUDA Start 检测/下载 UI | `ac8afb18-d283-4e98-acb3-629d2985525d` / child `a0dff2ba-c850-47d3-876b-711d8f39cc20`，`qwen/cuda-start-ui-review.md` 独立接受 |
| CUDA 依赖发布、应用 CPU/CUDA | 发布实施/回下载证据留存；复核项由用户接受关闭，双设备应用手测由用户确认 |

### 最终真实功能表（各一次 baseline）

证据 R = `research/local/integration-first/repaired-final-delivery/`，含 `independent-review/`。同一次完整 manager → qualified launch → host → recovery/ASS；elapsed 从 host.start 至 completed/reaped/ASS，不含前置 hash/probe，不是性能/质量资格。

| 设备/输入 | raw → 最终 cues | host elapsed 秒 | 结果 |
|---|---:|---:|---|
| CPU short | 8 → 8 | 11.939 | completed |
| CPU medium | 111 → 107 | 251.685 | completed |
| CPU long | 631 → 626 | 1968.877 | completed |
| CUDA short | 8 → 8 | 6.412 | completed |
| CUDA medium | 114 → 112 | 46.393 | completed |
| CUDA long | 622 → 615 | 341.085 | completed |

- 六次串行受 nonblocking task mutex/owned Job/process inventory 保护，中文 workspace、exact pair/Silero/runtime/loaded modules 绑定；原子事件、同次文本字节守恒、已有 endpoint 包络、合法时轴、逐行 ASS/recovery、cleanup/gate/reap 通过，CPU 无 CUDA/无 CT2 混载。
- 设备证明来自同一已核验二进制强制 fail-closed 检查和成功调用：ASR/lazy audio/aligner 请求设备、正 nodes/zero other nodes，必需 CPU VAD 成功。**原始 CLI stderr 未保留**，不能冒称重新读取了原 markers。
- CPU/CUDA silence 0.437/1.912s，显式空成功且旧 ASS 不变；无语音不宣称 ASR/aligner 图执行。CPU cancel 0.01789s、Job 4→0，reopen 11.886s /8 cues。
- 首次 CUDA cancel 测试因可重试私有删除错误过早 unwrap，缺 snapshot/recovery，保留为不完整失败，不改标。独立同身份 short recovery sentinel 5.811s 后，仅一次另标 lifecycle regression：cancel 0.01308s 返回受控清理错误，但 workerExited/reaped、pid=None、Job 4→0、gate 已释放、cancelled/旧 ASS 保持且 cleanup_pending=true；100ms 后一次既有 cancel retry 0.00080s 成功，reopen/sentinel 5.667s /8 cues。
- 共 **12 份 runner 记录 /14 次实际 CLI 调用**：六 baseline、两 silence、CPU cancel+reopen、原不完整 CUDA cancel、单独 sentinel、CUDA cancel regression+reopen。取消无模型指标，probes/fixtures 另计。独立复核用两套实际 application objects 重建 **11 份成功输出**，吻合 host/recovery/ASS；未重跑模型。

### 文件与包身份

实际权威为 `native-asr/runtime/crispasr-product-lock.json`，保留原字节，不能因其历史 pending 字符串重写。以下也是此前验收的确切身份：

| 产物 | bytes | SHA-256 |
|---|---:|---|
| CPU worker | 349696 | `b0d516ef67ed658136dff00f8cb583c729c4593a0f9fdc321c5990e1e7a1db13` |
| CUDA worker | 349696 | `0213926109a5b5acfd70b381c1aad4f782c39c6d071988157fb16d1da2e986b7` |
| CPU ZIP | 7654862 | `694c4fcbd7676a5dffef040f4421c15fd62be9b1f40793b36dd027bb96fc2df4` |
| CUDA ZIP | 719774409 | `5a8e0272d41341e1759a32765fc4a218135df6626bfec83c80eed2b08379370d` |
| 当时本地 NSIS | 16278639 (15.525 MiB) | `c6d5f29e408f8bb173ab165f2307eeb1d4193af074411a29589dd142de3dccc6` |
| 当时 portable ZIP | 23337755 (22.257 MiB) | `da488ee7432f2888de6ab70e870f2455c22c73a17158ddfb04ee9823267f195e` |

CPU/CUDA payload 22/27 项，另有 manifest/checksums；完整来源/linked notices（含 Microsoft 2026 原文、NVIDIA、uroman acknowledgement）及零 weights 已验。两份本地应用包提取验证独立 CPU resources、模型身份和 80/90 MiB 预算通过；这是入口启用/UI 增量前的历史包，不声称新改动已进入旧包或应用已发布。CT2 原八模型、CPU/CUDA artifacts 保持。

CUDA 资产 `hikaru-asr-crispasr-windows-x64-cuda-v1.zip` 位于既有 `native-asr-cuda-v1` Release，API asset `551148007`。官方 URL `https://github.com/jason-zzx/hikaru-sub/releases/download/native-asr-cuda-v1/hikaru-asr-crispasr-windows-x64-cuda-v1.zip` 及 ghfast.top 前缀源经现有 Rust downloader 回下载、隔离安装、文件/ZIP 闭集与 model-free probe，均为上表 719774409 bytes/SHA，29 entries、零权重。原 CT2 asset/Release 其他元数据未变；不是新应用 release。

### 既有回归与限制

- 最终功能批：CPU/CUDA CTest 各 **8/8**（各 65 Qwen synthetic cases），fixture-enabled Cargo **290/290** + main/doc、额外 CUDA-build host **46/46**；pnpm **837/837**、build、本地 `pnpm release:local`；package/HTTP repair/path/cleanup fixtures、CT2 verifier 通过。
- 入口/发布增量：fixture-enabled Cargo **291/291** + main/doc、Release lib 恶意 test keys check、rustfmt；发布时 pnpm **841/841**、build。
- 最新 UI 增量：实际组件红测与 shared hook 红测证明检测期间无 UI/拒绝未捕获、模型失败提示被遮挡；最终 focused **55/55**、pnpm **880/880 /113 files**、build，独立旧源码回放 4 红/2 正常控制通过。未使用真实下载/模型来证明 UI mocks。
- Vite >500kB chunk warning 为既有警告。入口阶段曾因运行中 exe 的 os error5 未完成 debug build；该次不改标为成功，用户后续重启构建并确认应用运行。未替用户执行 installer/卸载/提权/WebView 全矩阵。
- 只实测 RTX3070。工具链 CUDA12.8.93 + MSVC19.50.35722.0 使用 `-allow-unsupported-compiler`；PTX50/61/70/75/80/90、SASS86/89/120a 是构建覆盖，不等于所有 GPU/驱动/显存或 vendor-supported host 已验证。

## 必要证据锚点与隐私

- 固定构建输入：`research/upstream-engineering-baseline-lock.json`、`research/upstream-rebuild-sources.json`；推荐入口/量化/单位依据：`research/upstream-rebuild-research.md`。获取时点 flags 不改标。
- 离线 14 组合并影响与原输入 hashes：`research/adjacent-display-merge-offline.md`，保留为历史离线证据而非新模型执行；Python-relative 要求纠正：`research/native-quality-requirement-supersession.md`。
- ignored-local：`integration-first/{vad-compute-fix,worker-ass/boundary-fix,worker-ass/boundary-recheck,model-delivery,final-delivery,adjacent-display-implementation,repaired-final-delivery}/` 与 `cuda-publication/`、`enable-selection/`、`cuda-start-ui/`。原 medium raw 缺失、修正前 medium/long 失败、首次 CUDA cancel 不完整证据均不抹去/重标。
- 当前命令/回归在 `native-asr/runtime/full-cli/README.md`、`native-asr/docs/protocol-v1.md`、`.trellis/spec/asr/qwen-cli-output.md` 和现有测试中；不再重复保存各阶段长篇执行日志。
- raw transcript/token/logit、用户 WAV/ASS、模型、私有路径/日志仅 ignored-local，tracked 只记无正文计数/哈希/必要限制。清理不下探或删除 local/caches/junctions/用户媒体/runtime 资产。

## 前轮冗余清理执行与验证

- [x] 外部清单确认 A=122 旧记录、B=136 退休实验脚本/补丁、C=8 未使用裁剪 target、E=1 根 `.obj`；全部 untracked/nonignored，无当前代码/测试依赖。
- [x] 外部工具 artifact 保存精确清单、recoverable before bytes 与起点 dirty diff/index；只逐文件删除 267 项，不递归删目录。该轮保留 D timeline library、实际开发测试/共享 backend；仅 timeline 整体保留要求现被用户本轮授权覆盖。
- [x] 收敛当前 PRD/design/implement/task/JSONL、支持说明与适用 spec；保留当前 full-cli/build/product locks/tests/resources，不创建任务 research 报告或仓库快照。
- [x] 精确清单/外部 before ZIP 完整匹配 267 删除；783 个 active nonignored 文本无退休路径引用。21 份文档增量外其余小文件哈希保持，资源按小文件哈希/大文件 stat 有界核对；JSON/JSONL 和当前 Qwen/父 task validate、`git diff --check` 通过。未读大权重/ZIP 重验，无 inference/probe/download/upload/build/package/app 操作。
- [x] 父会话接受清理独立复核（workflow `e39409f2-a76e-41f1-972c-8d39a6dd7862` / child `14356f1c-dcdb-41e4-b354-9dcc7d1ae40a`，外部报告 `qwen/cleanup-review.md`），无阻塞项；另已修正 reviewer 指出的单处 README 文字路径。不 archive/stage/commit，不自称应用 release ready。

前轮命令：`python .trellis/scripts/task.py validate .trellis/tasks/08-20-native-asr-qwen3-aligner`、父/VAD task validate、`git diff --check`，以及外部 bounded manifest/hash/reference 检查。Qwen/父验证通过，长 ASR/media spec 有既有 injection-size 警告，已直接阅读全文；规划中 VAD 因原本空白 implement/check JSONL 验证失败，未改其 manifest/扩大 sibling 规划。首次 diff 检查发现本轮 Python 写入的 CRLF，已仅修正受影响文档并复验通过。Cargo/pnpm/Native/双设备运行沿用上述已接受结果，文档清理不重跑产品。

## 当前授权：旧 Qwen 开发 timeline 整体退休

- [x] 编码前同步本任务与 JSONL；外部保存本轮 dirty-start 及 16 个精确影响文件 before bytes，确认四个待删文件均为 untracked 普通文件（共 2,488 行），无 staged files。
- [x] 删除四文件及专用 CMake target/link/CTest；DEVELOPMENT 分支和 contract assertion 恢复 HEAD 原有 structured failure，仅移除退休 policy-negative 输入。本轮源码/构建/测试净减 **2,541 行**（四文件 2,488 + main 21 + CMake 13 + contract 19）。
- [x] 现有 VS 环境/固定本地依赖、两个全新 ignored build 根离线 configure/build 通过；开发 CTest **8/8**，独立 full-CLI CTest **7/7**（含 **65** 个 Qwen synthetic cases）。只编译 worker/无模型回归与 `cargo --locked --offline` tokenizer，不构建上游或发布包，无下载、推理/probe。
- [x] Qwen/父 task validate、779 个 active nonignored 文本引用扫描、`git diff --check`、before→after 范围/哈希检查通过；生产 main 分支/独立 CMake targets、共享 ABI/sibling 及锁原路径/字节保持，1,355 个其他 nonignored 小文件 SHA 不变、20 个既有资源/ZIP stat 不变，无 staged files。长 spec injection-size 与 MSVC 既有 getenv/pocketfft 警告保留；首次日志打印编码错误不影响已成功 build，随后实际 CTest 通过。
- [x] 本轮独立复核通过，无阻塞项：workflow `e78aced5-3ace-42fa-a4d2-c9ec9b248428` / child `b30e6a6d-a0df-4c1d-8aab-8a73367b0488`，外部报告 `qwen/timeline-retirement-review.md`。复核者重新离线构建并运行开发 **8/8**、full-CLI **7/7**（含 65 synthetic cases），确认净减 2,541 行及产品路径/锁不变。完整 before/diff、命令与日志在外部同目录，不在仓库另建证据记录。Rust/frontend 未改，不重跑全套；任务仍 `in_progress` 待用户提交/结项指令，无发布/归档/Git authority。
