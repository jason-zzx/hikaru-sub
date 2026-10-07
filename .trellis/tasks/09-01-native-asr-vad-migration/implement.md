# Native optional VAD — implementation plan

> 用户已批准实施且已执行 `task.py start`。下面除已勾选项外均须实际执行并验证，不将计划当作结果。
> 不包含 commit、push、版本号、CHANGELOG、远程上传或 release readiness 判定。

## P0 — 批准与最小改动边界

- [x] 用户审阅 `prd.md` / `design.md` / 本文件并明确批准实现，已激活现有 VAD child；未新建平行任务或启动 Kotoba K3。
- [x] 读取 jsonl、shared guides 与适用链路 specs；保留开始时六项已批准 planning 改动。本轮仅 P1 Native 源码/协议/测试。
- [x] 已定位 existing upstream archives、CPU CT2、exact small/Kotoba/Silero 与 private audio；复用 ignored-local `native-asr/build/vad-p1`，未修改默认资源或历史记录。

## P1 — 先证明最小 CPU VAD → CT2 闭环

涉及：`native-asr/runtime/full-cli/{patch.py,hikaru_qwen_device.h}`、`native-asr/src/{full_cli.*,main.cpp,ctranslate2_whisper.*}`，必要的小型 launcher/VAD 文件与现有 CMake。

- [x] 为已有 standalone `--vad-export-raw` 加仅作用于新用途的 controlled CPU-only 入口：无需 ASR/aligner，禁止下载/解码 fallback，禁用 VAD heuristic failover，复用无 post-merge 的上游 options。
- [x] 默认参数固定 0.5 / 100ms；另两个不暴露参数保持 250ms min-speech、30ms pad。输出文件复用 UTF-8 path 与原 cwd 规则，关闭写入后检查成功；中文路径 launcher fixture 通过，真实中文模型运行未扩大验证。
- [x] 加真实 VAD chunk 单调进展消息，复用 120 秒无进展 watchdog；不以日志刷屏续命。真实完成 chunk 与原 launcher watchdog fixtures 通过；VAD-only 独立实钟 stall/cancel 专项尚未执行。
- [x] 只抽取现有 full CLI launcher 第二个调用点实际要复用的过程函数。保留旧路线命令/等待/错误行为，不建泛型 executor 框架；原三路线/path/watchdog contract tests 通过。
- [x] 消费整数 PCM slice，复用既有 bounded JSON/UTF-8 与数量约束。成功空结果、缺完成标记、半写 JSON、CPU compute failure fixtures 与真实静音通过。
- [x] 为 CT2 加窄的内存音频入口并复用现有解码主体；同一 backend 按不拼接的语音区间执行，sample 起点偏移仅加一次。无 VAD 仍完整音频原路径。
- [x] 在 task-owned ignored-local scratch 做最小真实 CPU 证明：small、Kotoba、带前导/中间静音样本、纯静音均通过；未碰产品默认资源或用户字幕。

**P1 CPU 最小闭环已通过，可交接 P2；整个任务仍为 in_progress。** 按用户要求，仅删除 `main.cpp` 对 `end_bounded_to_audio` 的新增拒绝；原 `parse_slice`、padding、解码参数与无 VAD 行为不变。首次失败证据保留在 ignored-local scratch，不重跑时间戳诊断、不扩展算法研究。

重新构建 CPU CT2/CLI launcher：CT2 CTest 4/4、full-CLI CTest 13/13（含 8 个 VAD launcher 场景及原三路线/path/monotonic-watchdog）通过；`check.py` actual-source output/audio/VAD/RNNT/encoder regressions 通过，含 36 个 VAD fault/control 场景。现有 protocol suite 增加非默认 threshold/minSilence 与内部 CLI 字段保留断言，两构建的 protocol-core 重编译重跑均通过；既有 final-partial parser regression 保持通过。

本轮真实 CPU 重跑位于 ignored-local `native-asr/build/vad-p1/run-r3`：standalone Silero 不加载 ASR/aligner，默认 2 spans/256480 samples，threshold=0.9 得 6/206560，minSilence=3000 得 1/319680，静音 0。small/Kotoba speech+gap 分别成功 6/8 段，exit0 + completed；验证输出正时长、有序、位于原音频对应 speech span 内且不跨排除的 gap，进度单调。两模型纯静音均在 ASR 权重不存在时成功 0 段。所有模型运行串行，使用既有 task-owned 非阻塞互斥、进程盘点与 120 秒真实单调进展 watchdog；运行时 DLL 闭集/加载根检查通过，最终 task-owned 进程盘点为空。默认 runtime/产品 UI/Rust 未改，CUDA、host/UI 生命周期和全模型矩阵仍属后续 P2–P4，不能将 P1 通过当作产品交付。

**P2 字段交接**：protocolVersion=1，backend=`ctranslate2`，engine=`faster-whisper|kotoba-faster-whisper`，device 为已解析的 `cpu|cuda`（不传 auto），language=`ja`。开启时 `useVad:true`、`modelPaths` 明确 `model`+`vad`，内部绝对本地路径 `vadCliPath` 必须来自已验证 CrispASR CPU runtime；`vadConfig` 可缺省/null，或仅含 `threshold`（0–1，默认0.5）和 `minSilenceDurationMs`（整数0–60000，默认100）。关闭时只传 model、无 vadCliPath，配置忽略。CT2 runtime 使用 `capabilities.vad`，独立 CPU CLI 需新增并验证 `capabilities.vadExport`；原 mandatory `vad:true` 不代表 standalone 支持。沿用既有私有 `asr-jobs/<jobId>-cli` 和单 Windows Job 树；已有三条 mandatory 路线不接外层 VAD。

**P1 通过条件**：没有 ASR/aligner 也可完成纯 VAD；CPU 计算真实完成；两参数分别能通过受控 fixture/实际窗口证明传入且被使用；静音为空、不回退；ordinary/Kotoba 输出合法原音频坐标。证据只用运行结果、计数与已跟踪代码，不评 CER/RTF。失败时停在具体问题，返回设计；不擅自换引擎/拼接算法/时间修补。

## P2 — 接通产品请求、依赖与单 job 生命周期

涉及：`src-tauri/src/{asr.rs,asr_models.rs,asr_worker.rs,dependencies.rs,dependencies_crispasr.rs}`、`native-asr/{include/hikaru_asr/protocol.hpp,src/protocol.cpp,docs/protocol-v1.md}` 及必要的 runtime packaging 代码。

- [x] `check_asr_model` / `download_asr_model` 可选 `useVad=false`：CT2 启用时临时 effective entry 带共享 Silero，关闭时不要求 VAD。复用 existing hash/cache/下载/进度/修复/cleanup，不永久把 CT2 manifest 改为 requiredVad。
- [x] direct 与 legacy HF 路径都返回正确 `model+vad` role；reuse cache 不得把开/关请求互相认作 ready。
- [x] 保留单 logical model 下载槽；不同 VAD 依赖集合的并发请求明确告知等待旧下载完成，不能拿无 VAD job 冒充完整下载。下载后重新检查当次需求。
- [x] runtime capability 使用 CT2 既有 `capabilities.vad` 和 CrispASR CPU 新增 `vadExport`；完整闭集验证后才允许启用。不得因仅有 `crispasr vad:true` 误认支持 standalone export。
- [x] start 路径按最终请求解析主 ASR 设备与独立 CPU VAD CLI。内部 `vadCliPath` 不进入前端参数；route validator 同步要求 CT2+VAD 的角色/路径组合，已有 full CLI 合同不变。
- [x] 复用 host 的单 active gate、Windows Job 与私有 `cli_work_dir`；P4 实际 CPU-VAD、CPU/CUDA-ASR 取消均确认物理 reap、私有目录清理、原 ASS 保留及同 host 下一 job 成功。
- [x] VAD 启用后的依赖/runtime/参数/运行失败均不 fallback；无 VAD 不额外 probe/init/load CrispASR。显式 CPU/CUDA 与 auto 原语义不变。

**P2 通过条件**：真实 host 能执行同一个 VAD→ASR job；失败/取消后可启动下一 job；损坏/缺失 VAD 不阻断关闭 VAD 的转录。


**P2 backend / typed-IPC 源码与 synthetic gates 已通过，可交 P3/P4；不代表候选 runtime 或真实应用已验证。** `check_asr_model` / `download_asr_model` 接受可缺省 `useVad`（false）；TS wrappers 第三个参数同名、默认 false。`startAsr` 保留 `useVad` / `vadConfig`，CT2 开启只接受 `threshold` / `minSilenceDurationMs`；`vadCliPath` 仅由 host 从完整校验后的 CPU CLI 得到，不进入前端 API。`listAsrEngines` 的 CT2 `devices[]` 增量返回 `optionalVad: { available, reason }`；mandatory 路线不返回此项。auto 仍先选择主 ASR 设备，不因可选 VAD 能力缺失改用另一设备。

验证：focused optional-VAD tests（含明确指定 P1 fake worker 的 host success/failure/cancel、单 gate、下一 job、私有结果清理）、full Cargo 310 passed / 3 manual profiles ignored；完整前端 113 files / 898 tests；typed bridge + CT2/CrispASR verifier 定向 16 tests；`pnpm build` 与 `cargo check --release` 通过。候选权威未替换，当前旧 runtime 对可选 VAD 仍明确不可用。真实候选 CPU/CUDA host/application、VAD 阶段取消/无进展、全模型矩阵与包装留到 P4；没有将可选 real-model tests 的未配置分支计为模型运行证明。

## P3 — UI 与完成路径

涉及：`src/{types/index.ts,services/tauri.ts,hooks/useAsrAvailability.ts,components/workflow/ModelManager.tsx,components/workflow/TranscribeView.tsx}` 及对应测试。

- [x] 转录页添加默认关闭开关、threshold 与 minSilenceDurationMs 两个高级数字输入；用现有 shadcn 组件，页面状态不持久化。仅 CT2 路线显示，运行/确认/下载期间复用现有锁定。
- [x] 现有 availability、check、download、确认后启动完整带上当次 `useVad`；缺失 VAD 走现有确认与统一进度。selected request 的异步结果失效判断包含 VAD 选择，不能展示上一个需求的 ready。
- [x] 确认后的 worker job、poll 和保存使用发起时的 engine/useVad 快照；Qwen/Parakeet/ReazonSpeech 仍发送原有固定语义，不串入用户高级参数。
- [x] 新 CT2+VAD 空成功在修改文档之前提示无语音，保留干净/脏文档、recovery 与 ASS；失败也不清空。
- [x] 新 CT2+VAD 非空完成跳过跨 gap 的 `mergeShortCues`，保留 Native segment 顺序/时间；无 VAD 原路径与已交付三条路线不改。

**P3 frontend 源码与 mocked-IPC 自动化 gates 已通过，可交 P4；不代表真实候选应用/设备已验证。** 控件仅本页保留默认 false/0.5/100，验证有限阈值与整数静音范围；availability 按请求隔离，使用 P2 `devices[].optionalVad`，auto 不因 VAD 不可用偷换 ASR 设备，缺 CUDA 在安装后重查。确认、下载、原生 discard 对话框、pending start 和运行沿用同一选择快照并锁定控件；过期下载结果不继续启动，不新增下载取消。完成处理在最终 snapshot/document guard 后执行：CT2+VAD 空成功、失败、取消与部分结果保持整个文档/recovery/ASS；非空保存保留 Native 物理顺序、文本及时间，不跨 gap 合并。mandatory 三路线仍 false/null 交后端固定处理，CT2-off 保留原分组策略。

验证：6 个定向文件 **108 tests passed**（包含 typed bridge 与原 Native frontend contract）；完整 `pnpm test` **113 files / 934 tests passed**；`pnpm build` 通过，仅原有 bundle-size warning。保留既有 runtime test 的 CRLF；scoped `git -c core.whitespace=cr-at-eol diff --check` 通过。覆盖八模型 UI 请求、默认/边界/非法输入、重新挂载复位、VAD 缺依赖下载与重查、CUDA 准备后保留参数、陈旧检查/完成结果拒绝、干净/脏文档静音/失败/取消/部分结果保护及 ASS 行顺序。修正的中间测试问题仅为旧静态 false/null 断言和 Radix/jsdom API/模态可访问性测试写法，未改业务组件库或新增测试平台。未运行模型、改 Native/Rust 算法或采用 runtime artifact；真实 host/application、双设备矩阵和包装仍在 P4，task 保持 `in_progress`。

## P4 — 验证（复用测试，不新建测试平台）

### 4.1 定向与完整自动化

先在以下现有测试中补直接场景，新增纯逻辑测试文件仅在没有合适归属时使用：

- C++ protocol/CT2 tests：默认/非法参数、开启缺 role/CLI、关闭忽略配置、sample 区间有序边界、两段之间大 gap、末段非整毫秒、偏移一次、每区间 K2 ownership、无 VAD 相同 decoder 行为。
- CLI fixture tests：VAD-only CPU 成功/静音/compute failure/半写输出/无 ASR 权重、静音参数不被 post-merge 抵消、真实 chunk 进展 vs 重复 stderr、取消与子树 reap；抽取 launcher 后原 Qwen/Parakeet/ReazonSpeech、paths/watchdog contracts 全跑。
- Rust existing suites：effective entry 开关、legacy reuse、shared VAD 缺失/修复/续传/官方镜像 URL、不同需求下载不误复用、未匹配 runtime 能力、单 gate/recovery/取消、旧 mandatory VAD 配置拒绝。
- Frontend：开关默认与两个输入范围；只在开启时传参数；下载缺失依赖后启动；切换选择拒绝旧检查结果；mandatory 路线隔离；空成功与失败保留干净/脏文档；跨 gap 不二次合并。

```bash
pnpm test -- src/components/workflow/TranscribeView.test.tsx src/components/workflow/ModelManager.test.tsx src/hooks/useAsrAvailability.test.tsx src/services/tauriAsr.test.ts
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm exec vitest run --exclude ".trellis/**" --exclude "native-asr/build/**" scripts/verify-native-asr-runtime.test.mjs scripts/verify-crispasr-runtime.test.mjs
```

Native 在 x64 VS Developer 环境下，先走现有 Release preset（不用 rejected Candidate B preset）：

```bash
cd native-asr
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release
cmake --preset windows-x64-cpu-runtime
cmake --build --preset windows-x64-cpu-runtime
ctest --preset windows-x64-cpu-runtime
cmake --preset windows-x64-ct2-cuda-release
cmake --build --preset windows-x64-ct2-cuda-release
ctest --preset windows-x64-ct2-cuda-release
```

full CLI fixture 单独 build dir 配置 `HIKARU_ASR_BUILD_QWEN_CLI_WORKER=ON` 与实际已构建 CLI 的 `HIKARU_QWEN_CLI_FILE`，`cmake --build <dir>` 后 `ctest --test-dir <dir> --output-on-failure`。复用 `native-asr/runtime/full-cli/check.py --source <prepared-source> --output <ignored-check-dir>` 做原 patch/output 检查。本地 compiler/source/toolkit 路径按已有环境解析，不把机器私有路径写入文档或要求临时 runner hash。

### 4.2 最小真实功能矩阵

按 shared code 与模型差异分层，不把每个异常样本与所有模型做笛卡尔积：

| 范围 | 样本/设备 | 验证 |
| --- | --- | --- |
| 全部七个 ordinary + Kotoba | 每模型 short，CPU 和 CUDA；VAD 开/关各一次 | 模型可选、真设备、关时原行为、开时合法非空输出与 ASS |
| ordinary 80 Mel（small）、128 Mel（large-v3）、Kotoba | medium/long × CPU/CUDA，VAD 开 | 原音频时间轴、滑窗/K2、单调进度、完整成功 |
| shared CPU VAD + ordinary/Kotoba | 纯静音、前后静音、碎片语音；CPU/CUDA 链路代表用例 | VAD 固定 CPU、空成功、参数实际影响、无重复偏移 |
| 生命周期/输入失败 | CPU-VAD 阶段取消、CPU/CUDA-ASR 阶段取消、缺/坏 VAD、无进展、损坏结果、中文路径及既有支持的长路径 | fail-safe、reap、下一 job、旧字幕不变；fake tests 覆盖稳定负向，实机确认代表取消 |
| Qwen3 / Parakeet / ReazonSpeech | 每条 short × CPU/CUDA，加 existing contract tests | 新 CPU CLI / launcher 共用部分无回归，不重做质量矩阵 |

使用已有固定 private 音频，必要的静音 fixture 在 ignored-local 生成；原文/路径不进入 tracked 输出。同一设备的 model-backed case 串行，复用 task-owned 非阻塞互斥及进程盘点；120秒无进展而非总耗时限制。只记录功能结论/数量/耗时诊断，CPU/CUDA 必须真实运行；缺 GPU/模型就明确未验证，不以编译/PTX/速度代替执行证明。

### 4.3 本地交付检查

- [x] 生成匹配代码的 CT2 CPU/CUDA worker 候选包及 CrispASR CPU CLI 候选包；更新必要的 exact 分发 identity/能力和 verifier，不启用任意目录/运行时 env bypass。
- [x] CrispASR CUDA bytes/authority 保持原样；现有 packager 增加窄的 CPU-only 分支，复用已验证分发闭集/许可，只替换 CPU executables 与必要 manifest 能力。
- [x] 新 CT2 CUDA archive 保持未发布；已验证本地安装可用与远程下载资格分开，旧远程 source rows 不可用于候选下载。未改旧远程资产、未新增旧包白名单。
- [x] `pnpm release:local` 本地包装通过；installed-like / portable-like 提取根完成 JS 闭集/许可及实际 Rust CPU/CUDA resolution/probe、坏 DLL 拒绝检查。NSIS 16,318,748 bytes，portable 23,376,500 bytes，低于 80/90 MiB；无捆绑模型、CUDA、Python 或 FFmpeg。未执行安装器/WebView 交互。
- [ ] 实际应用选择 ordinary/Kotoba、开关 VAD、调参数、缺依赖下载确认、CPU/CUDA 开始/取消/ASS 保存；验证 VAD 关闭时 CPU VAD runtime 缺失不阻断原 CT2。已有三条 UI 不新增开关也不受参数影响。

### P4 实测结果（本阶段 partial，任务仍为 in_progress）

- **已通过**：八模型 short × CPU/CUDA × VAD on/off 共 32 组合；small、large-v3、Kotoba 的六个 medium VAD 用例；small/Kotoba 的八个 CPU/CUDA 静音/前后与中间 gap 代表用例。非空输出合法、进度单调，gap 输出逐条位于对应原始 sample 区间内；静音零片段。设备执行与分发 DLL 闭集/加载根按实际运行确认，CUDA 仅 RTX 3070 真机范围。
- **未通过，不得勾选 AC3/全矩阵完成**：六个 long VAD 用例均实际执行并安全失败。small 与 large-v3 在 CPU/CUDA 均返回 `timestamp_after_audio`；Kotoba 在两设备均返回 `invalid_generation`。错误码本身不证明旧行为；后续限定的匹配输入对照见下节。没有恢复 `end_bounded_to_audio` 拒绝，没有修改 `parse_slice`、padding、解码参数或增加时间修补/降级，也没有开展时间戳研究或质量评分。
- **真实 host**：small/Kotoba short CPU/CUDA on/off 八次通过；CPU-VAD、CPU-ASR、CUDA-ASR 三个取消代表用例通过，均保留原 ASS、清理任务树/私有目录并在同 host 成功启动下一 job；CPU/CUDA 坏 VAD 两个代表失败用例保留原 ASS。另在实际 CPU Silero 首次单调 chunk 后仅挂起 task-owned exact CLI 进程，生产 watchdog 于 120 秒返回 `qwen_cli_no_progress_timeout`，120.016 秒内终止/回收完成；ASR 权重故意不存在、未启动 ASR，最终进程盘点为空。Qwen3、Parakeet、ReazonSpeech 的六个 CPU/CUDA short manager→host→ASS 回归通过。
- **自动化**：Native protocol 6/6、CT2 CPU 4/4、CUDA 5/5、full-CLI 13/13 通过。standalone launcher 扩至 10 场景，实钟验证重复 chunk/stderr 在 120 秒被终止，而真正推进的 125 秒流程成功。actual-source `check.py` 通过。最终 Cargo 311 passed / 3 manual profiles ignored；最终 `pnpm test` 113 files / 934 tests；`pnpm build`、Rust formatting、scoped diff check 与未改应用版本的 `version:check` 通过。
- **本地 authority**：CT2 CPU v5、CUDA v3（`vad:true`），CrispASR CPU `shared-vad-local`（`vadExport:true`）。原 CrispASR shared-v4 CUDA archive/完整 authority/已发布状态逐项保持不变；新 CT2 CUDA 的 publication flags 为 false，旧远程 rows 保持原样且不提供候选下载。CPU 候选资源与默认 build authority 一致；这不是上传、应用发布或 release readiness 结论。
- **保留的未计分/中间结果**：初次小模型 CUDA module sampler 与进程退出竞态；初次取消测试误读只在 EOF 落盘的 stderr；Cargo wrapper 的退出后 Job accounting 断言；前端默认并发的中间 timeout。只修正本地 sampler/测试观察点/包装相关旧断言，保留原失败日志；随后对应实际检查和最终完整套件通过。没有将这些中间结果改标为成功，没有归因于用户进程。
- 所有模型运行串行，使用 task-owned 非阻塞排他锁、进程盘点与 120 秒单调进展 watchdog；未使用总耗时/重复日志续命。最终 ASR 进程盘点为空。原始音频、文本与私有证据留在 ignored-local `native-asr/build/vad-p4`。
- **仍待 parent 浏览器交互**：工具无 GUI/browser 能力，未宣称 WebView、真实下载确认或前端 ASS 保存通过。已准备但未启动 ignored-local `.local/vad-p4-app` portable 根，含十一条 exact ASR 缓存、两个匹配 CUDA 根和本任务视频 fixture；Silero 刻意未预置以验证共享 VAD 按需下载。需验证默认关闭/重挂载复位、两个参数、ordinary/Kotoba CPU/CUDA 开关/开始/取消/保存重开、缺 VAD 下载确认、关闭 VAD 时缺 CPU CLI 不阻断，以及干净/脏字幕的静音/失败/取消保护与 mandatory 路线控件隔离。只用该任务根，不能打开或修改用户 live app/字幕。

### P4 long 失败的限定功能核对（不改产品代码）

复用原六次失败日志、现有 `TranscriptionResult` / `WindowTrace` 与 task-owned 进程控制，只对失败附近的原始 PCM 切片执行对照，没有重跑完整 long 或全矩阵。首次仅以末次 progress 推断 span 时误把 ordinary 的后继段作为失败段：局部 progress 可先达到四舍五入的末端，随后 decoder 仍失败。该中间结果保留；最终以最后原子提交的 span、现有 trace 及精确切片复现交叉确认。

| 原 long 用例 | 首个失败 span（0-based） | 输入 samples / 实际时长 | 结果 |
| --- | --- | --- | --- |
| Kotoba CPU/CUDA | 319 | 70,721 / 4,420.0625 ms | `invalid_generation` |
| large-v3 CPU/CUDA | 319 | 70,721 / 4,420.0625 ms | `timestamp_after_audio` |
| small CUDA | 319 | 70,721 / 4,420.0625 ms | `timestamp_after_audio` |
| small CPU | 505 | 247,204 / 15,450.25 ms | `timestamp_after_audio` |

- **输入/接线**：六次原 WAV 的 PCM 与固定原音频逐样本相同，均 mono PCM16 / 16kHz / 66,307,755 samples；六份 VAD 数组相同，共 974 段，全部有序、不重叠且在源样本内。切片保留原 PCM，无拼接/重采样；内存入口与另存的 exact-sample WAV 入口浮点样本及 rounded duration 完全相等（对应 4,420ms / 15,450ms）。没有 sample 裁切或额外 offset 造成的失败证据。
- **配置/状态**：实际所选模型文件按现有 product manifest 校验；ordinary 使用原默认配置，Kotoba 原 K2，80/128 Mel 与现有 CPU 16 intra / 1 inter 相符。四个目标 CPU 对照（Kotoba319、large-v3 319、small505、small319）的内存/path、同一 backend 先解前一段再重放三者结果/现有 token trace 相同；每次首 trace 的 seek/history/window index 为零、last-emitted 为 -1。解码主体从新增 wrapper 后到文件尾与 HEAD 完全相同，未添加 instrumentation 或改算法。
- **已实证的旧行为**：使用验证过的原 CPU v4 分发执行相同 exact-sample WAV、`useVad:false`。Kotoba319、large-v3 319、small505 分别复现相同失败；old-v4 与 current-v5 完整协议事件相同。故这三个 CPU 失败并非新增 memory/VAD adapter 独有。small319 在 old/current CPU 均成功两段，保留为设备差异对照，而非强迫它失败。
- **CUDA 区分**：当前 CUDA worker 对同一 span319 的 `useVad:false` 分别复现三个模型原 VAD 错误，说明这些失败不需要 standalone VAD 子进程或外层区间循环才能发生。未调用历史 CUDA 二进制，因此不把此项宣称为“历史 CUDA 已实测相同”。small319 的 CPU 成功/CUDA 失败仍是具体的设备差异；未推测数值/算法原因。
- **结论与下一步**：未证明本次 VAD 接线 bug，因此未改任何 Native/Rust/UI/包/authority。新增逐段输入会触发原 CPU decoder 对这些短输入已有的失败；这不能推出原完整 long、VAD-off 一定失败，也不能宣称 VAD-on long 已通过。AC3 保持未完成。当前 VAD-only 授权下的下一步是交回上述具体输入/对照供 parent 最终 source review 与已有 GUI 验证；如果仍要求六个 long 全成功，需要 owner 明确另定这些既有 decoder 失败的处理范围，不能在本任务偷偷修时间戳、pad、阈值或加 fallback。
- 原始失败、初次后继段成功对照和最终定位均保留于 ignored-local `native-asr/build/vad-p4/long-triage`；仅此本地调用程序与执行计划有变动，未接触 parent GUI 根。全部实际运行串行、非阻塞任务锁、120秒真实阶段/局部窗口进展 watchdog，最终进程盘点为空。

### Parent UI 验证尝试

已启动任务专用 `.local/vad-p4-app` portable 副本并尝试通过 CDP 连接。`agent_browser` 在连接前拒绝执行：本机 agent-browser 0.27.0 不受当前工具支持，最低要求 0.35.0，工具推荐 0.38.1。未执行界面操作，不能将真实 UI 验证记为通过；已向本次启动的 exact PID/路径发送窗口关闭请求并获成功返回。未升级全局工具或改用其他浏览器控制方式，未触碰用户应用数据。后续需兼容版本的浏览器工具，或由用户手动完成上列界面检查。

### 已授权的零毫秒尾窗修复（源码验证，AC3 仍未通过）

仅在共享 CT2 循环新增 `seek > 0 && source_duration_ms <= 0` 的后续窗口终止，并同步正常/无语音两处 `final_window`；未改 ceil 帧数、PCM/Mel、实际 seek/stride、K2 ownership/dedup、解析/末端归一化、padding、参数或外层偏移。现有 CT2 测试文件增加可选实模型尾窗回归；原始 diff、失败与本轮增量保留于 ignored-local `native-asr/build/vad-p4/whole-file-ab/tail-fix`。

- 原 small505 crop（247,204 samples）由 `timestamp_after_audio` 变为 completed、1 窗/3 段；首窗 Mel bytes、tokens 与原有效字幕逐项相同。16 个实模型定向用例覆盖 1–7 样本尾部、0.5/1/2/9/10ms 正时长、初始 sub-ms 不跳过及 K2 正常/无语音 final。无语音分支使用明确标注的固定测试专用阈值控制，不代表默认 Kotoba 会将零 PCM 判为静音；产品参数未变。CPU CTest 4/4、CUDA CTest 5/5、scoped diff check 通过。
- 同一原始完整 long、exact small：CPU-off completed **904** 段，除 jobId 外全部协议事件与修复前基线一致；CUDA-off completed **915** 段；CUDA-on completed **1,281** 段，使用与原失败相同的 **974** 个默认 VAD spans，合法输出与单调进度通过。
- CPU-on 越过原失败处后仍返回 `timestamp_after_audio`，已提交 **805** 段、未 completed。最后进度 2,653,210ms；span609 已原子提交，随后 span610（0-based，76,320 samples / 4,770ms、整帧输入）失败。仅定位，不调查或修复此后续条件，也未扩展到 large-v3/Kotoba long。
- 全部实际运行串行、非阻塞任务锁、120 秒真实进展 watchdog。保留两次 completed 后本地 wrapper 即时 Job 计数断言；修正本地无控制台启动/短 reap 确认后，crop 与 CPU-off 重验通过，最终进程盘点为空。
- 本轮只更新上述 cpp、现有测试文件与本记录；新 CPU/CUDA worker 仅为 ignored-local 源码验证产物。**分发 archive、runtime lock、应用资源及包均未更新，现有打包应用不含本修复。** 未提交、发布或标记任务/AC3 完成。

### 已授权的 span610 EOF 后缀修复（限定源码验证通过，AC3 仍未完成）

仅在共享 `parse_timestamp_tokens` 的 consecutive-slice 循环实施已批准规则：实际 PCM 末窗、合法非空前缀已覆盖 EOF、single-timestamp ending，且剩余完整后缀的全部时间戳在 EOF 外并从前一 raw end 单调，才保留前缀而不输出后缀；其余沿原解析/错误路径。不改 PCM/Mel、参数、时标归一化、seek/K2 或外层偏移，不宣称被排除文字必为幻觉或语义无损。

- 匿名 parser 回归先在旧源码报 `Generated segment starts after WAV end`，修复后 CPU CTest **4/4**、CUDA **5/5** 通过；包括边界、未闭合/非末窗、畸形/回入/重叠后缀及既有归一化。中间一次失败来自“空文本前缀”测试误用总返回非空文本的旧 helper，已修正测试调用并保留日志。
- 原 span610：CPU completed **5** 段、CUDA completed **4** 段。CPU 首窗 PCM/Mel bytes、生成 tokens 和前五段文本与旧证据相同，保留既有 `4000–4770ms` 归一化。原 small505 仍 completed **3** 段、tokens/有效字幕不变；既有 **16** 个尾窗/K2/no-speech 实模型回归通过。
- 同一完整原音频、exact small，CPU off/on 分别 completed **904 / 1263** 段，CUDA off/on 分别 completed **915 / 1281** 段。两次 on 均为原 **974** 个默认 VAD spans，输出合法、有序、在对应 sample-derived 边界内，进度单调。CPU-off 与旧 904 段基线、CUDA off/on 与各自旧结果的全部协议事件（除 jobId）一致。
- 实际推理串行，复用任务锁、Job、120 秒真实单调进展 watchdog 与 DLL 根检查，最终进程盘点为空。原失败及本次增量/结果保留于 ignored-local `native-asr/build/vad-p4/whole-file-ab/span610-fix`。只改 parser、现有测试及本记录/对应 quality paragraph；**分发包、authority 和应用资源未更新，不含本修复**。large-v3/Kotoba long 与真实 UI 未重验/未验收，任务保持 `in_progress`。

### 剩余长样本重验（仅验证，真实 UI 仍待用户手动验收）

复用包含两项已批准修复的源码构建 worker；CPU/CUDA 目标均 `ninja: no work to do`，运行字节与现有构建输出一致。未改代码、测试、参数或包。相同原音频 **66,307,755 samples / mono PCM16 / 16kHz**，默认 VAD **0.5 / 100ms**，exact large-v3 与 exact Kotoba K2 四例均完整结束：

| 模型 | 设备 | completed | 段数 | 耗时秒（仅诊断） |
| --- | --- | --- | ---: | ---: |
| large-v3 | CPU | 是 | 1222 | 7985.484 |
| large-v3 | CUDA | 是 | 1227 | 453.250 |
| Kotoba | CPU | 是 | 1382 | 7237.015 |
| Kotoba | CUDA | 是 | 1374 | 263.937 |

四例均保持原 **974** 个 sample spans，输出非空、正时长、起点有序且位于对应 sample-derived 毫秒边界内，进度单调；实际设备/DLL 根检查通过，CUDA 仅 RTX 3070 实测。串行任务锁、120 秒单调进展 watchdog、Job 回收均正常；runner 保留证据后清理其工作副本，最终进程盘点为空（不代表 UI/Tauri 清理验收）。证据位于 ignored-local `native-asr/build/vad-p4/long-retest`。

保留前次 small 完整 CPU off/on **904/1263**、CUDA off/on **915/1281** 段通过记录，本次未重跑。**真实 UI 由用户手动验收，当前仍 pending；尚无包含这两项修复的手测应用包**，已安装/portable 与分发包仍为 pre-fix 字节，authority/应用资源未更新。任务保持 `in_progress`，不宣告全部 AC 或发布就绪。

### 修复后的本地打包与手动验收交接

两项已验证 CT2 修复现已进入本地 **CPU v6 / CUDA v4** archive、默认嵌入 authority 和应用 CPU 资源；worker 与此前通过长样本的源码构建字节一致。旧 CPU v5 / CUDA v3 archive 保留。CrispASR CPU/shared-v4 CUDA authority、原 archive 与远程 source rows 未变；新 CT2 CUDA publication flags 仍为 false，无上传。应用版本保持 **0.4.1**，未提交或发布。

- `pnpm release:local` 成功；NSIS **16,314,403 bytes**、portable **23,376,731 bytes**，低于 80/90 MiB。实际提取根通过闭集/许可证校验，无模型、CUDA、Python 或 FFmpeg 捆绑；应用内含 exact 当前 locks。NSIS exe 仅与 portable exe 相差 Tauri 预期的三字节 bundle-type 标记，不是 runtime 差异。
- 本轮完整前端 **934/934**、Cargo **311 passed / 3 ignored** 已通过；恢复 provider 中断后未重跑这些套件或长样本。installed/portable/manual 三个根均通过生产 CT2 resolution/实际 CUDA probe；manual 独立 CrispASR 根通过既有 frozen-archive 双设备验证与坏文件拒绝。
- 从已验证 portable 资源及其独立安装的 CUDA 根，现有真实 Rust host 执行 exact small、24,102ms 短音频、默认 VAD-on：CPU/CUDA 均 completed，合法非空片段并生成 ASS，任务 gate/进程树回收。复用任务锁与 host 的 120 秒单调进展 watchdog。helper 会删除其 TempDir，故不虚报保留 ASS 或未采集段数；这不是 GUI 保存验收。保留本地 sampler 误要求 CT2 不含的 cudart、大小写比较错误等中间记录；CUDA 三次实际 host 均通过，最后完整采样按原闭集规则复核通过，无产品修改。最终模型进程盘点为空。
- 新建、未启动的 `.local/vad-manual-fixed` 可供用户手动验收，内有简短中文说明及任务视频。只复制 exact small/Kotoba 两份模型，不共享可写链接；Silero 刻意缺失。两套匹配 CUDA 分别预安装于各自 deps 根，仅为本地测试准备，不属于 portable ZIP 内容。`.portable` 与空 data/cache/webview 使用正常隔离机制，未复制用户设置、密钥或字幕。
- 证据留在 ignored-local `native-asr/build/vad-p4/package-fixed`。decoder/tests 字节保持本轮开始时原样，HEAD/index 未改。**真实 UI、首次 Silero 下载确认、前端取消/保存重开等仍待用户手动验收**；任务保持 `in_progress`，不勾选全部 AC，不作 release readiness 结论。

### 用户手动验收反馈与单独授权的 CT2 CUDA v4 依赖发布

用户手动验收后反馈“可以了”，随后明确授权上传并更新 CUDA 下载配置；这是用户报告的验收结果，不补写代理未观察到的逐项 UI 操作。本次授权仅覆盖现有 CT2 CUDA v4 dependency asset，不授权应用发布、版本变更或 Git 操作；已手测目录未被修改或启动。

- 既有 `native-asr-cuda-v1` dependency release 仅新增 `hikaru-asr-windows-x64-cuda-v4.zip`（asset **618300750**）。官方 GitHub 与 `ghfast.top` 两次完整下载均为 **571,097,001 bytes** / SHA-256 `9057dabf8da5e868c58de1eb3624729befe20e25c183046584ef122f1281c786`。两条 CT2 source row 与 lock 匹配，两项 publication flags 设为 true；六个旧远程资产、release 正文、CT2 CPU v6 与 CrispASR CPU/shared-v4 CUDA 字节及 authority 保持不变。
- 两个全新隔离根分别用现有 Rust 生产 downloader 实际联网下载，经过 size/SHA、解压后 exact 验证、安装及 RTX 3070 model-free probe，均 available。既有 opt-in package test 直接调用后端 helpers；并非手工解压冒充下载，也未运行 GUI/AppHandle prepare 命令或新增 ASR 推理。下载临时文件清理与最终进程盘点通过。
- 已有发布资格/源清单测试随当前 authority 更新；Cargo **311 passed / 3 ignored**、前端 **934/934**、`version:check` 与 scoped formatting/diff 检查通过。`pnpm release:local` 成功，版本仍 **0.4.1**；新本地 NSIS **16,309,487 bytes**、portable **23,376,610 bytes**，未上传应用资产。提取文件包含精确新下载源和 lock、原固定 worker/完整许可闭集，无模型/CUDA/Python/FFmpeg 捆绑。
- 证据留在 ignored-local `native-asr/build/vad-p4/cuda-publication`；此前上传、两次远程校验及成功测试未因 provider 中断而重新上传或冒充重做。两项 decoder 修复与其测试字节不变。原手测副本保留旧下载配置和本地预装 CUDA，新下载配置位于本次本地重建应用；本轮不宣称新 GUI 下载交互另经手测，不归档任务或判定应用 release readiness。

## P5 — 检查、文档与交接

- [ ] 对照 PRD AC1–AC7 检查代码、测试和实机结果，定向修正必要问题，不做顺手清理。
- [ ] 仅更新真正改变的 living specs/协议说明：CT2 可选 VAD、内部 CLI 路径、非持久 UI 参数、空输出与时间轴；历史 no-VAD artifact 描述保留历史语义，不改归档研究记录。
- [ ] `git diff --check`、完整测试状态及未运行项汇总；明确本地验证与尚未发布的 CT2 CUDA 新资产边界。
- [ ] 将工程结果交用户评估；不自动提交、归档完成或进行发布动作。

## 停止与回退点

- P1 运行证明失败：停在具体 CLI/区间/解码问题，保留 task-owned 日志，回到 design；不将旧 Candidate B 升为产品。
- P2/P3 回归：只回退本任务相关调用/候选资源，不改历史、删除用户缓存或触碰字幕。
- 某设备功能失败：不把功能标为双设备完成，也不通过静默关闭 VAD 放行。
- 发布是独立决策，不把用户未授权上传等同于代码/本地 runtime 无法执行；报告能工作的部分与待用户决定的分发动作。
