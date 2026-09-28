# Simplify Native ASR migration safeguards

## Goal

删除 Native ASR 迁移遗留、不能改善产品正确性或安全性的哈希身份锁和极端防御代码。让正常修改、构建、测试不再需要重建层层证据身份，同时保留真实的产品完整性、设备和数据安全合同。

## Background / confirmed decisions

- 用户暂停原定通用 Native VAD 工作，优先本轮清理；创建任务和确认边界不等于批准实施。
- 上次 ReazonSpeech 讨论（Pi `01a0a465-dbf9-7611-922e-868efe0bd763`，turn 90–92）确认临时源码、exe、构建中间件、脚本、日志和报告层叠 SHA 已造成误判及负收益；模型、runtime 分发完整性仍有实际价值。
- 用户确认：清理现行代码、脚本和指导后续开发的规格；不改写、不删除已归档任务的研究脚本及历史证据，亦不保证旧 publisher 可继续消费新代码产生的结果。
- 用户确认：取消专门防御同权限本地进程在推理期间替换输入/祖先路径的长期锁定。接受用户可写输入不再保证整个推理期间不可替换；不是取消路径越界、下载完整性、安全写入/清理或任务并发保护。
- 实施前的代码调查和消费者定位见 `research.md`；其行号与描述保留规划时快照，不代表当前源码。实施及最终验证结果见 `implement.md`，不作性能提升声明。

## Requirements

### R1 — Remove development evidence identity gates

不再要求临时源码、构建缓存、内部锁文件、runner、日志、结果、摘要等冻结 SHA 才能构建或执行功能测试。移除对应的固定行数/换行格式校验、永久身份恢复阻塞、重复哈希和只检验这些机制的测试；保留实际功能测试及其失败断言。

证据：`native-asr/runtime/full-cli/{prepare,package,smoke,parakeet_smoke,path_check,recovery_check}.py`；`src-tauri/src/asr_worker.rs:1965,2079-2179,2261`、`dependencies_crispasr_probe.rs:156-180`、`asr_worker_qwen_tests.rs:18-94`、`asr_worker_parakeet_real_tests.rs:20-127`。

### R2 — Simplify runtime defenses without changing inference

移除已被 host 分发完整性校验覆盖的 worker-local CLI SHA 绑定及长期祖先/输入防替换锁。清理 CTranslate2/Kotoba 等推理路径中仅供证据序列化使用的 token/tuple/attempt 哈希及专属字段，不改变模型、量化、解码、VAD、对齐、分段、去重或时间轴算法。

证据：`native-asr/src/full_cli.cpp:66-99,122-151,241`；`native-asr/CMakeLists.txt:994-1016`；host 在缓存命中前仍校验 runtime（`src-tauri/src/asr.rs:285-345` → `dependencies_crispasr.rs:118-219,249-259`）；`ctranslate2_whisper.cpp:1253-1277,1569-1607,2067-2069,2132`。

### R3 — Make current builds and instructions usable without historical proof chains

覆盖 CrispASR 与 CTranslate2 两条迁移路线，不只清理最近 ReazonSpeech 的脚本。移除无功能依据的本地精确工具版本、提取后源码字节和内部文件格式锁；保留实际 API/ABI、编译器兼容性、上游版本及外部来源完整性。同步修正现行文档、受影响的活动任务约束和当前构建入口，不恢复旧身份门禁。

证据：`native-asr/CMakeLists.txt:361-485`、`CMakePresets.json`、`scripts/build-native-asr-runtime.ps1:111-158`、`native-asr/runtime/full-cli/README.md`、`.trellis/spec/asr/quality-guidelines.md`、`.trellis/spec/tauri/{media-ffmpeg-asr,paths-and-runtime-deps}.md`、活动 Kotoba PRD 第 31 行。活动 VAD PRD 的真实模型完整性不属于冗余锁。

### R4 — Preserve necessary contracts

- 模型、外部源包、runtime 下载与最终随包文件完整性、许可证、可信来源和安全解包；保留现有产品 manifest/发行产物的实际 SHA。
- 独立 backend DLL 根、明确 CPU/CUDA 语义、必需 CPU VAD、无 Python/CPU 静默回退。
- 子进程所有权、真实取消/reap、必要互斥、无进展超时；失败不覆盖旧字幕、不把部分输出当成功。
- 路径规范化及写入/清理范围、结构化参数调用、隐私、UTF-8/JSON 与可用字幕结构校验。
- 标准 Cargo/pnpm 依赖锁保留；有真实用途的 CUDA deterministic seed/pathmap 保留，不因使用 SHA 就删除。

### R5 — Keep implementation and release authority separate

分批小改动、分批测试。只用 Git diff 与直接测试/运行结果说明改动，不创建新 evidence schema、publisher、哈希总账或通用审计框架。更改后的 worker 在隔离本地构建中验证；默认随包二进制/已发布 CUDA 包不能悄悄替换或继续冒用旧发布身份。

## Acceptance Criteria

- [x] AC1 (R1/R3)：当前开发命令可在内部 JSON 改排版、脚本/本地构建变化后执行，不需要冻结新来源/日志/结果锁；失败后清理进程即可重试，不被永久哈希哨兵卡住。
- [x] AC2 (R2/R4)：worker 无重复 CLI SHA 和长期祖先/输入防替换锁；host 仍拒绝损坏分发文件，安全路径、生命周期、输出保护测试通过。
- [x] AC3 (R2)：证据专属 hash 字段与消费者一并清理；直接去重/分段/时间轴断言及受影响模型 CPU/CUDA 功能检查通过，无推理算法变更。
- [x] AC4 (R3/R4)：CrispASR/CT2 受影响构建入口可用；依赖兼容性、分发完整性、隐私和 CUDA seed/pathmap 行为未被删除。
- [x] AC5 (R1/R3)：现行规格/README/活动任务不再要求上述开发证据链；归档记录未修改，无为了归档 publisher 添加的新兼容层。
- [x] AC6 (R4/R5)：运行相关 Native/Python/Cargo/前端检查及必要的本地真实模型验证，明确报告运行、跳过与阻塞；无条件跳过的模型测试不冒充通过。只汇报实际验证范围，不声称默认安装产物已采用源码清理。

## Out of scope

- 新模型迁移、通用 VAD 或 Kotoba K3 实施、字幕质量算法研究、后端整体替换/删除。
- 版本号、CHANGELOG、提交/推送/合并、发布就绪裁决、上传/发布、改写已发布 runtime 包或其锁。
- 新的符号链接/长路径支持、全仓安全策略重构、CUDA toolchain/确定性构建设计重写。

## Approval and completion

用户已逐批批准四批实施，并批准本地模型补测及诊断后最小测试入口修正。工程实施和约定的本地验证已完成；Qwen CPU/CUDA 转录、专用取消后重开，以及 Kotoba CPU/CUDA 转录和多窗口新旧输出对比均通过。具体范围、历史失败和现有清理重试结果见 `implement.md` 的最终验证记录。

本次勾选表示源码与本地验证验收，不是发布就绪裁决。默认 CPU/CUDA 分发产物与锁未更新；提交、归档、打包采用和发布未执行。任务管理状态仍为 `in_progress`，等待另行收尾。
