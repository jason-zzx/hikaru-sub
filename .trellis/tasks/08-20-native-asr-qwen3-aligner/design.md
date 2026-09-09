# Qwen Native：完整 CLI 架构

## 状态与决策

当前功能已接受，用户确认应用 CPU/CUDA 成功；模型选择/下载/启动与独立 CUDA 下载源保持启用。CUDA 发布复核项是用户接受关闭，非超时独立代理复核通过。当前用户已明确授权将旧 Qwen DEVELOPMENT timeline 连同专用测试/接线整体退休；不变更生产实现或 release 状态。

使用 CrispASR v0.8.32 / `e2a356146e36bc1cc0410edefb01990448766979` 的完整 `crispasr-cli` target（输出 `crispasr.exe`）。允许包含未启用 backend/embedded server 源码，但受控应用调用只请求 Qwen 文件转录。文件/依赖/许可证闭集不等于源码裁剪；不恢复低层 session 编排、raw-only/DP 或质量研究。

## 数据流与所有者

```text
现有 UI / shared availability / runtime preparation hook
  → NativeAsrModelManager：exact model + aligner + required vad
  → 按 backend/artifact/device 验证独立 runtime（CUDA 启动前 compute probe）
  → 既有 NativeAsrHost / protocol v1 / owned Windows Job
  → Qwen CLI worker adapter → 同根完整 CLI
      CPU Silero → 上游 slices/offset → Qwen ASR → ForcedAligner
      → 上游 LIS/插值 → word-aware display
  → 私有结果 → 完整边界校验 → 有界相邻异常组合并 → 最终协议校验
  → segmentsReplace → completed candidate → EOF/exit0 → recovery/ASS → completed
```

Rust 持有模型/readiness、任务 gate、进程所有权、终态与恢复；worker/CLI 推理；React 复用模型确认、依赖检测/下载、进度、取消及 ASS/翻译/编辑。没有第二 job、下载器、常驻 HTTP 服务或 UI 支持白名单。shared preparation hook 在异步检测时立即显示不可确认 dialog，获取真实 kind/size/path 后才可同意；失败受控，取消/卸载/切 kind 废弃 continuation，安装后重验再继续一次。关闭 dialog 不等于取消后端下载。

## 固定输入与构建

| 角色 | 发布仓库 / revision | 文件 |
|---|---|---|
| ASR / `Qwen/Qwen3-ASR-1.7B` | `cstr/qwen3-asr-1.7b-GGUF` / `674df5d44b50a63e7102a18895ed20e3f91de301` | `qwen3-asr-1.7b-q4_k.gguf` |
| Aligner / `Qwen/Qwen3-ForcedAligner-0.6B` | `cstr/qwen3-forced-aligner-0.6b-GGUF` / `1ec5110602ccab18c878ddebedab0891e290a95c` | `qwen3-forced-aligner-0.6b-q4_k.gguf` |
| 必需 CPU VAD | `ggml-org/whisper-vad` / `9ffd54a1e1ee413ddf265af9913beaf518d1639b` | `ggml-silero-v6.2.0.bin` |

- `research/upstream-engineering-baseline-lock.json` 仍是 prepare/package/smoke 的固定输入，保持原路径/字节；其中获取时点未验证 flags 不是当前功能状态，不能改标。完整 c2pa archive authority 在 `full-cli/prepare.py`，源码伙伴清单为 `research/upstream-rebuild-sources.json`。
- 完整 CPU/CUDA target 使用独立 build 根、现有工具链和上游配置，不加 Qwen-only guards/stubs。只做必要设备/输出/进程安全适配；不改 tokenizer、LIS、窗口或精度。
- 实际生产文件/archives authority 是 `native-asr/runtime/crispasr-product-lock.json`；当前 enablement/publication 均 true。其历史 pending 状态字符串不替代用户验收，也不因文案清理改 lock 或 package.py。
- 构建、exact-source 回归及 smoke 命令保留于 `native-asr/runtime/full-cli/README.md`；本轮不执行这些模型/上游构建命令，仅以现有固定本地依赖构建应用 worker 和无模型回归。

## 设备、安全与结果合同

- host 在启动前确定 `cpu|cuda`；显式 CUDA 不回退，`auto` 只在启动前可因验证/probe 失败改选同 backend 的已验证 CPU，已启动 GPU 任务不重跑。CPU 不初始化 CUDA；ASR/lazy audio/aligner graph 必须有正节点且零 CPU/unknown 节点（CUDA 请求），权重/KV buffers 同样验证。VAD 固定 CPU。
- `--hikaru-probe-cuda` 是独立 bounded GGML F32-add/readback 检查，15s、16KiB、strict JSON/UTF-8/退出/Job reap；`modelExecutionProof=false`，不替代三角色真实执行证明。
- worker 只传受管本地音频/角色、固定 Qwen/ja/default pipeline/输出参数，不允许 `auto` 模型、网络、server、shell。controlled mode 在角色预检和 acquisition 入口阻断缺失路径下载；音频使用由 canonical path 与 owned cwd 推导并复核的相对 argv，解码失败在进入 alternate/FFmpeg fallback 前返回。
- Rust suspended worker 与 worker suspended CLI 均在 resume 前加入 kill-on-close Job；固定 UTF-16 argv、allowlisted handles/environment、同根/System32 PATH、reparse 拒绝与 held handles，私有有界结果和 stderr 不进入普通日志/协议。
- 必需 VAD compute 失败在源头 reset scheduler 并返回 false，经 nullptr/load-failed 到 exit30；不能吞错为静音或部分成功。
- CLI 导出同次实际 `displaySegments`（毫秒）/fallback/silence；words t0/t1 是厘秒，offsets 毫秒。缺/无用 words、文本均分 fallback、raw NUL、任意 span 坏 UTF-8、重复字段、半写/尾随 JSON、非法类型/范围/大小均失败。合法 JSON escape `\u0000` 的未使用字段不是 raw NUL，不能 blanket-reject。
- 唯一展示修正见 `.trellis/spec/asr/qwen-cli-output.md`：先完整验证原始成员，再合并连续零时长/开始倒序组。零时长优先向前，开头向后等正时长成员；倒序向前级联。组取现有 min-start/max-end，正文含空白按字节原序连接；全零失败，正常重叠/相同开始不变。不制造时间、不修改 word/LIS、不掩盖负时长或限额失败。
- 最终非空输出满足 protocol v1 正时长、开始顺序、音频/条数/文本/序列化大小；一次原子 replacement/completed，host EOF+exit0 后在终态锁内先持久化 recovery/ASS 再公开 completed。显式成功 VAD silence 可空，失败/取消/静音不覆盖旧 ASS。
- 物理 worker/Job 退出与私有文件删除分离：确认退出后清 PID，释放对应 gate 再 publish reaped/notify。删除错误保留 `cleanup_pending`，pid=None 也可经现有 cancel/shutdown 有界重试；未确认退出保留 PID/gate，空 Job 不能证明未加入的 worker 已退出。

## 交付与兼容

- pair：`deps/models/crispasr/qwen3-asr/Qwen/Qwen3-ASR-1.7B/<pair-revision>`；共享 Silero：`deps/models/shared/silero/vad/<vad-revision>`。一任务总计 2,020,801,514 bytes；沿用 parts/Range/staging/hash/原子 publish，完整 pair+VAD 才 ready。VAD 缺/坏使 cache readiness 失效；失败保留旧完整 pair 和安全 partial，无新增下载取消 API。
- CPU：`resource_dir()/native-asr/windows-x64/crispasr/cpu`；CUDA：`<exe>/deps/asr-runtime/crispasr/cuda/current`。各自锁/manifest/闭集、现有 prepare/repair/cleanup，不跨 CT2 树加载或替换 sibling 子树。
- CUDA 独立资产 `hikaru-asr-crispasr-windows-x64-cuda-v1.zip` 位于既有 `native-asr-cuda-v1` dependency release；官方及 ghfast.top 同字节源已接通。现存合法 CUDA 的 readiness 独立于 source publication；缺失时仅真实 matching published sources 可显示下载。
- 两套 CPU resources 随本地 NSIS/portable，CUDA 按需，权重不入 runtime/安装包；完整 linked notices 保留。预算 80/90 MiB，不以删许可证或改 CPU 按需方式规避。
- 只实测 RTX 3070；CUDA12.8/MSVC unsupported-host override 与架构覆盖不等于 NVIDIA 支持或所有 GPU 实测。历史本地包审计不代表后来 UI/enablement 已装入该旧包，更不代表应用已发布。
- 其他引擎保留既有行为。仅退休旧 Qwen timeline library/标点表/专用测试和 CMake 接线；DEVELOPMENT Qwen 仍调用 `backend->transcribe(emit_progress)` 验证原有 ABI 能力，随后发出 HEAD 原有 `qwen_timeline_policy_not_implemented` 并 exit20，不输出字幕。共享 backend/fake ABI、Parakeet/Reazon 与独立 full-CLI targets/dispatch 不变；后续 child 复用冻结合同。

## 停止与回滚边界

本轮仅处理明确授权的开发 timeline 调用与专用测试；若需变更生产/共享 ABI、下载依赖或修改范围外源码则停止报告，不重写生产来凑删除数。任务 lock 仍被构建消费，暂不归档。功能回滚须另有范围授权，只作用新路线，不伤 CT2、用户 ASS/模型或恢复 Python；任何更换模型/算法、许可/预算/设备保证的变更须重新决策，不属于文档清理。
