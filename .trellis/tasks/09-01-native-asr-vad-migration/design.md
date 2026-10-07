# Native optional VAD — technical design

> 状态：用户已审阅并批准实施，任务已激活；不授权提交或发布。
> 证据性质：基于当前产品代码及 pinned CrispASR v0.8.32 源码的静态核对。尚未构建新入口或执行本任务的真实 VAD/ASR 验证；P1 的最小运行证明是实施后的第一道检查，不冒充已验证能力。

## 1. 范围与最小方案

七个普通 Faster-Whisper 模型与 exact Kotoba 增加默认关闭的可选 CPU Silero；Qwen3、Parakeet、ReazonSpeech 原有必需 CPU VAD 与算法配置不变。

采用 **CT2 worker → 已验证的 CrispASR CPU CLI 独立 VAD 导出 → 同一 CT2 worker 的原解码器**。CLI 只做 VAD，不加载 ASR/aligner。ASR 权重每个任务只加载一次，各语音区间依次解码。

不新增 ONNX Runtime、VAD 模型版本、第三套 runtime、常驻服务、通用流水线框架或分块调度系统。不从 CT2 进程加载 CrispASR DLL；两个进程各用自己的 runtime 根。无 VAD 路径不依赖 CrispASR 可用性。

### 为什么不是更少的改动

| 候选 | 结论 |
| --- | --- |
| 打开 Candidate B 编译开关 | 不采用。它是被拒绝的 ONNX Silero V6 开发路线；与共享 GGML V6.2.0 不同，并绑定旧配置及压缩时间轴逻辑。 |
| CT2 直接加载共享 CrispASR DLL | 不采用。跨 backend DLL 根加载违反现有隔离约定。 |
| 新写 VAD helper / 自研语音检测 | 不采用。完整 CLI 已有 standalone export，无须增加另一个可执行文件或算法。 |
| Tauri 先开一个独立 VAD job 再开 ASR job | 不采用。需要跨任务取消/状态交接；沿现有 worker 子进程树更直接。 |
| 每个语音段落盘 WAV 并重启 CT2 | 不采用。重复加载模型、额外 I/O 和取消边界无必要。 |

## 2. 代码与上游证据

产品锚点（行号为本轮规划读取时的位置，符号名优先）：

- `src/components/workflow/TranscribeView.tsx:431–439` 固定 `useVad:false`；`294–307` 仅 Parakeet-family 处理空成功并跳过 `mergeShortCues`。
- `src/lib/ass/postprocess.ts:39–74` 会将短于 500ms、间隔不超过 200ms 的 cue 合并；新增 VAD 路线若继续走这里会重新跨越短静音。
- `src-tauri/src/asr.rs:463–532`：已有三条 full CLI 路线强制固定 VAD；CT2 请求启用 VAD 被拒绝，角色也仅允许 `model`。
- `src-tauri/src/asr_models.rs` 的 `ReadyCacheKey`、`resolve_entry_with_roots`、`vad_model`、`run_download`：已有共享资产、exact 校验、依赖就绪、合并下载进度与单模型下载槽。
- `native-asr/src/main.cpp:275–300`：Kotoba VAD 被拒绝，ordinary VAD 仅走开发 Candidate B；`CMakeLists.txt:85–88` 明确标注 rejected。
- `native-asr/src/ctranslate2_whisper.cpp:1809–2238`：现有解码循环、callback、时间解析与 Kotoba K2 ownership；`transcribe` 的产品调用者是 `main.cpp`，其余直接调用者位于 `tests/ctranslate2_whisper_tests.cpp`。
- `native-asr/src/full_cli.cpp:158–351`：已有受管工作目录、参数引用、子进程 Job、受限环境、取消/reap、输出读取。复用其进程机制而非新增生命周期层。
- `native-asr/runtime/full-cli/patch.py:53–73`：受控 CLI 启动仍要求 ASR 模型；当前不能直接用受控模式做 VAD-only。`144–168` 已有 CPU VAD 计算失败与空语音区分修复。
- `.trellis/spec/frontend/state-management.md`：VAD 配置是临时页面/会话状态，不写 `AppSettings`、project 或 localStorage。

上游 authority：`native-asr/runtime/full-cli/upstream-engineering-baseline-lock.json` 指向 CrispStrobe/CrispASR `v0.8.32` / `e2a356146e36bc1cc0410edefb01990448766979`。本轮读取了 ignored-local `native-asr/build/full-cli/source-pristine/`，以及 tracked patch；这些源码副本不是新的交付权威，不增加中间文件哈希门禁。

上游相对路径：

- `examples/cli/cli.cpp:2655–2661`、`crispasr_run.cpp:2971–3030`：`--vad-export-raw FILE` 在 ASR model resolution/init 前退出，已有 strict VAD 失败返回码。
- `examples/cli/whisper_params.h:94–106`：threshold=0.5、min_silence=100ms、min_speech=250ms、pad=30ms。
- `src/crispasr_vad.cpp:328–410`：导出前仍有 post-merge 与启发式全音频 failover；`--vad-export-raw` 只是不再固定长度切片，不代表跳过这些策略。
- `src/crispasr_vad.h:88–128`：offline merge 会合并小于 1 秒的 gap 或前段不足 3 秒的区间。现成 `streaming_json` policy + `stream_close_gap_ms=0` 可跳过后合并，不需新写算法。
- `src/crispasr_vad.cpp:567–601`：JSON 包含 `version/kind/sample_rate/num_slices/slices`；每个 slice 同时有整数 PCM `start/end` 与 `t0_cs/t1_cs`。执行只使用整数 sample 边界。

## 3. UI 与参数

转录页增加 shadcn Switch 和两个数字 Input；高级参数仅在 CT2 且开启 VAD 时可编辑。复用现有 `settingsLocked`，检查/下载/转录期间锁定同一组选项；同一次启动、下载后续跑及完成处理使用发起时的选择，不重新读取变化后的控件。

| 字段 | 默认 | 接受范围 | UI 步长 |
| --- | --- | --- | --- |
| `useVad` | false | boolean | — |
| `vadConfig.threshold` | 0.5 | 有限数 `[0,1]` | 0.01 |
| `vadConfig.minSilenceDurationMs` | 100 | 整数 `[0,60000]` ms | 1ms |

默认来自 pinned Silero CLI，范围复用当前协议，不以质量/速度优化为由另选值。提示“阈值越高越严格”“连续静音达到该时长后结束语音段”。UI 不提供额外 min-speech/pad/max-duration 参数；固定保留上游 250ms min-speech、30ms pad。已知但本次不支持的配置字段在 CT2 启用 VAD 时明确拒绝；关闭时不解析/应用 `vadConfig`，沿用协议语义。已有三条 full CLI 仍拒绝自定义配置。

控件状态只保留在当前转录页实例；重新进入初始 false/0.5/100，不新增持久化。切到已有三条模型时隐藏可选控件，并发送原有 false/null 请求，由后端强制必需 VAD；切回 CT2 可恢复本页内未卸载的值。

`list_asr_engines`/既有 device capability 增量返回可选 VAD 支持及不可用原因，不另建能力服务：来自已验证 CT2 worker 能力 + 已验证 CPU CLI VAD-export 能力，而非仅按引擎名宣称可用。旧 runtime 仍可无 VAD 转录；启用 VAD 时不支持就明确提示。

## 4. 模型检查、下载与启动

### 4.1 单一共享资产

继续使用现有 exact asset：

- `ggml-org/whisper-vad`，revision `9ffd54a1e1ee413ddf265af9913beaf518d1639b`。
- `ggml-silero-v6.2.0.bin`，885098 bytes，SHA-256 `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`，MIT。
- `deps/models/shared/silero/vad/<revision>`；CPU/CUDA 与五类引擎共用，不捆绑权重、不重复下载、不新增独立清理按钮。

共享 identity 仍从已校验 manifest 的一致 `requiredVad` 读取，不把副本散布到 C++/TS。不要将八条 CT2 manifest 永久改成 `requiredVad`。

### 4.2 请求感知的最小扩展

给 `check_asr_model` / `download_asr_model` 及前端 wrapper 增加可缺省的 `useVad`（缺省 false）。为 CT2 的当次操作构造 effective entry：启用时临时带上该 shared requiredVad，关闭时仍原 entry；已有三条始终使用原 manifest 依赖。原始 manifest 校验规则不必放宽。

- `ReadyCacheKey` 已包含整个 entry，可区分开/关，复用既有 exact 校验与 cache。
- 修正 `resolve_sync` 的 legacy HF 成功分支：选中 VAD 时也应附加已验证 `vad` role，不能只在 direct install 分支附加。
- `run_download` 已会先复用/下载主模型，再处理共享 VAD；继续统一总进度、partial 续传、原子安装、共享下载锁及 storage lease。
- 保留按逻辑模型唯一 active download。若另一个调用已在下载同模型但依赖集合不同，明确返回“该模型下载进行中，请完成后重试”，不要伪称旧 job 已覆盖 VAD，也不新增队列/合并升级机制。UI 在下载中不允许切换 VAD。
- `useAsrAvailability`/`ModelManager` 的 selected request 与状态刷新包括 `useVad`；旧设置页调用省略它，行为不变。依赖缺失复用现有下载确认框和进度，文案可说明包含 VAD；不做后台偷偷下载。
- `start_asr` 按同一 `useVad` 再做实际 readiness 与 runtime 解析，不能信任 UI 缓存。失败释放现有 reservation，不启动任何 ASR。

### 4.3 worker 请求

产品 `StartAsrArgs` 不暴露 executable path。Tauri 内部 `ResolvedNativeLaunch` 仅在 CT2+VAD 时附加：

- `modelPaths` 中明确的 `vad` role；无 VAD 仍只有 `model`。
- 一个内部可选 `vadCliPath`：从已验证 CrispASR **CPU** runtime 得到的绝对 executable 路径，不由前端输入，不猜 sibling 路径。
- `useVad:true` 与两个参数；既有 `device` 仍仅表示已解析的 CT2 CPU/CUDA。

Rust/C++ 的 route validation 同步扩展这一种组合，老 runtime 的缺失能力默认 false。它是协议 v1 的受能力控制增量，不让旧 worker 因忽略未知字段而假装支持。已有 full CLI 请求不出现 `vadCliPath`。

`auto` 继续使用现有 ASR 设备选择逻辑；若实际选中的 worker 不支持 VAD，报错而不是关闭 VAD或为了绕过能力缺失偷换 CPU。只有现有 prelaunch CUDA 不可用回退语义保持不变。

## 5. CPU CLI 独立 VAD 路径

新用途使用已有完整 CLI 的 `--vad-export-raw`，不是裁剪版：

```text
crispasr.exe --vad-export-raw <private-result> --vad -vm <exact-vad>
  -f <canonical-relative-audio> --no-gpu --gpu-backend cpu
  --strict-pipeline --require-vad -vt <threshold> -vsd <minSilenceMs> -t 8
```

在现有 patch 中增加仅由新 launcher 使用的 `HIKARU_VAD_ONLY=1` 受控模式：

1. 复用 `device()` 的 CPU/离线/音频解码失败策略；仅 VAD-only 入口不要求 ASR/aligner 文件，必须在 VAD export 分支退出。不得用虚假的 `-m/-am` 指向 VAD 文件去绕过旧校验。
2. 此模式给既有 VAD options 设置无后合并策略（`streaming_json` + close gap 0），保证静音时长参数不会又被 offline merge 覆盖；不改现有三条路线的 options。
3. 子进程环境设置 `CRISPASR_VAD_FAILOVER=0`，不允许启发式退回全音频 chunks。沿用 strict load/compute failure 与成功空结果区分。
4. 原有 write/export 代码对私有结果采用 UTF-8-aware path 打开、检查完成写入。沿用现有长路径策略：必要时 CLI 根作 cwd、音频传 canonical relative path；不新增 alias/temp relocation 或放宽范围。
5. 新模式输出单调完成的 VAD chunk 进度供 watchdog；仅真实已计算 chunk 前进或阶段转换刷新 120 秒无进展计时，普通 stderr 不刷新。已有三条模型不用这个新进度合同。

仅在 VAD-only 分支做上述适配。源码可共用 patch 文件，但原 Qwen/Parakeet/ReazonSpeech 命令、算法、输出和 CUDA runtime bytes 不因本功能而主动改变。

新 launcher 复用 `full_cli.cpp` 的 Windows quoting、process Job、受限 PATH、pipe、work/result 和 reap 机制；仅为第二个实际调用点抽取所需的过程函数，不建 executor 接口/继承树或可配置框架。需抽取的原 full CLI 行为以原 contract tests 锁住，不趁机改其等待/校验策略。

输出只接受 bounded JSON、version=1、kind=vad_segments、sample_rate=16000、数量匹配且有序不重叠的 `0 <= start < end <= PCM samples`。复用已有 JSON/UTF-8 与协议数量上限；不重复实现 parser/哈希。确认 exit0 和 CPU VAD 完成后，空数组才表示无语音。文件缺失/半写/损坏、CPU 计算错误都失败，不当作静音。

## 6. CT2 窗口与时间轴

**按原 PCM 区间逐段执行，不把不相邻音频拼成压缩音轨。** 这样不需要 Candidate B 的压缩映射，也不需要新的插值/对齐算法。

- 从原 WAV 读取样本；导出的 `[startSample,endSample)` 是裁取依据，`t0_cs/t1_cs` 仅作上游附带信息，不反推 sample。
- 给 `CTranslate2WhisperBackend` 增加窄的内存音频入口；原 path `transcribe` 读取 WAV 后调用同一解码主体。保留原有默认调用及历史测试入口，不重写整个 decoder。
- VAD 导出成功且非空后建立一次 CT2 backend；每个区间将真实样本送入现有主体。权重复用，history/seek/K2 ownership 每区间从零开始；区间内仍保留 ordinary 现有窗口与 Kotoba 15 秒窗口、10 秒最大步进、ownership/dedup。不修改 beam/history 配置或添加 gap retranscription。
- 长语音段交给原解码循环自行滑窗，不引入另一套固定长度切片。不要恢复完整音频被 VAD 排除的部分。现有 `parse_slice` 对输入音频末尾的边界处理保持不变，不以 `end_bounded_to_audio` 标记额外拒绝结果。
- callback 输出只在外层加一次区间 sample 起点对应的偏移；毫秒换算沿用 `wav_audio.cpp` 整数四舍五入，先用整数 sample 起点组合再换算，不累计前一段时长。局部 decoder 输出必须适用于该真实切片的 duration；最终仍满足原协议正时长、起点有序与整段音频边界。不新增 next-cue/slice-end 猜测、延长或剪裁算法；沿用原解码器已有的输入音频末尾归一化，不改 padding 或解码参数。
- VAD 关闭时只调用一次原完整音频路径，不走新导出或逐段逻辑。
- 复用已有 source `progress`：VAD 阶段保持转录 processedMs=0（可显示“语音检测中”而不伪造百分比）；ASR 局部进度映射原音频坐标并单调推进。不得先报告扫描全音频100%再回到转录0%。
- 空 VAD 成功不构造/运行 CT2 ASR，直接 completed 零片段。前端仅将新增 CT2+VAD 路线加入已有“无语音保留原字幕/恢复快照/保存目标”分支。
- 新增 CT2+VAD 非空完成沿用物理原始 segment 顺序保存，跳过 `mergeShortCues`，避免跨 VAD gap 二次合并。CT2 无 VAD 与已有三条模型的完成行为不变；使用当次 job 的 `useVad`，不是后来 UI 状态。

## 7. 生命周期、失败与安全

沿用一个 ASR job、一个 active slot、现有 Windows Job 树。VAD CLI 是 CT2 worker 子进程；取消、关闭、失败终止/reap 全树，VAD 与 ASR 之间也不释放任务槽。不新增取消 command、重试控制器或后台恢复服务。

私有 VAD 结果放在同一 workspace 的 `asr-jobs/<job>-cli`，让现有 `cli_work_dir` 清理在进程树物理退出后负责；扩大该目录使用条件到 CT2+VAD，不重写 host cleanup/recovery 状态机。标准输出仍只有原协议；CLI stdout 不污染 worker stdout。

主 ASR 参数在 VAD 阶段也保持用户请求设备；VAD 失败不得启动 ASR。ASR 失败或部分输出不得覆盖既有 ASS/文档；真实静音为空成功而非清空字幕。输入路径、外部下载与 subprocess 结果保持既有边界校验；不对中间文件/日志/临时 runner 新建身份锁。

## 8. runtime 与交付边界

- CT2 CPU 和 CUDA 都要重新构建 worker；CT2 推理 DLL 可保持现有 bytes。复用两个 manifest 已有的 `capabilities.vad`（旧包 false、新包 true），不再另设 CT2 功能注册表。`dependencies.rs` 当前硬编码 `!capabilities.vad` 的检查须按新 exact artifact authority 调整；`crispasr` 字段仍为 false（没有在 CT2 进程内加载 CrispASR）。
- CrispASR CPU 的既有 `vad:true` 只证明 mandatory ASR VAD，不证明 standalone export。为其新增单一 `vadExport` 能力，缺省 false；host 只把经过该能力及完整资源校验的 CPU CLI 传给 CT2。
- CrispASR 仅需要更新随包 CPU CLI 的 VAD-only 能力与对应 exact CPU artifact。复用现有 root、完整上游编译与许可闭集；**不需要重建/重新发布 CrispASR CUDA pack**。原 CrispASR CUDA artifact/manifest/archive authority 保留。
- 现有 packager 若只支持同时打 CPU/CUDA，做最小 CPU-only packaging 分支并原样携带已验证 CUDA authority；不拷旧 hash 给新 bytes，也不因为 CPU 变化把未变的 CUDA 发布状态抹掉。
- 由现有 runtime verifier 校验完整分发闭集；增加实际用途所需的能力字段即可，不重复 worker 自哈希、进程模块轮询或编译产物哈希。
- 本任务产出本地候选包、双设备应用验证和必要的源码接线。CT2 CUDA 新 worker 会导致新 archive：生成本地包并保持“未发布”；不改现有远程 URL 冒充新包，不借用已完成 child 的上传授权。旧已发布资产原样保留供旧 authority/回退使用；不承诺新 authority 构建接受旧 CUDA bytes，也不为此增加多版本 runtime 兼容层。新构建未安装匹配候选 CUDA 包时明确不可用，不能让旧下载链接安装出一个被新 authority 拒绝的包；缺失 CUDA 不妨碍 CPU 路线。
- 产品默认 authority 的切换必须与本地资源一致；用于局部验证的候选配置与可下载发布状态分别报告。用户单独决定何时采用/上传 runtime 或发布应用。最终不得把“本地 CPU/CUDA 功能已验证”写成“普通用户已能下载新 CUDA pack”。
- 保持 NSIS/portable 现有包装与许可证要求。禁止为了体积裁剪完整 CLI 或改变分发模式。

## 9. 验证与回退

详细步骤见 `implement.md`。重点证明：参数真实生效、窗口 sample 与偏移一次性正确、八模型 CPU/CUDA 可执行、静音与失败不破坏文档、进程树取消、开关关闭原行为、三条既有模型不被影响。

先做最小运行闭环再扩大测试，不建基准/证据发布系统。若 VAD-only 或逐段 CT2 无法满足合同，保留失败信息、返回具体设计点讨论，不转为 ONNX、Python、时间戳修补或模型替代。

回退是撤销本任务接线或不采用候选资源；保留旧包/原 shared Silero 与所有字幕，不删除用户缓存、不改 Git 历史。任务完成不代表 release readiness。
