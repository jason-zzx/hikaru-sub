# CTranslate2 PoC 技术设计

## Summary

T02 使用一个 task-local、单次运行的 C++ CLI 来验证 CTranslate2 Whisper 的完整最小上层链路：读取本地 WAV 和模型、原生 log-mel、tokenizer/prompt、CTranslate2 encode/generate、timestamp token decode 与 JSON evidence。它不是 daemon、worker 或生产 runtime。

只有 inputs lock、模型 contract、golden vectors、结构化证据和结论是后续任务可复用资产。PoC 源码/构建树可在 Gate 0 后丢弃。

## Architecture

```text
T01 fixture + Python baseline + locked inputs
  -> task-local CMake Release x64 CPU CLI
  -> WAV validation -> native log-mel -> tokenizer/prompt
  -> CTranslate2 Whisper encode/generate
  -> timestamp-token parser -> legal segments
  -> JSON evidence + report comparison
```

建议目录：

```text
.trellis/tasks/07-25-native-asr-ctranslate2-poc/
  research/
    poc-src/                 # tracked disposable CMake source
    inputs.lock.json
    evidence/                # tracked small golden/report metadata
    local/                   # ignored models/build/raw results
```

不创建 `native-asr/`，不引用 Tauri，也不建立 protocol v1。

## CLI Boundary

CLI 只接受显式本地路径和锁定 config：

```text
--model <locked-model-dir>
--audio <16k-mono-pcm-wav>
--engine faster-whisper|kotoba-faster-whisper
--evidence <local-or-task-evidence-dir>
--self-check | --validate-evidence
```

它只写 task-local evidence，不接受 URL、下载源、用户设置或远程 header。路径传给 C++ API，不经过 shell 拼接。stdout 使用一个稳定 JSON result；诊断写 stderr，限制长度且不回显完整私有字幕。

## Proof Layers

### 1. Locked Inputs And Model Contract

运行前读取 `inputs.lock.json`，检查 toolchain/SDK/model revision 和每个必需文件 hash/size。模型 metadata 从实际 snapshot 提取，不在源码中手写 token IDs 或 mel 参数。Kotoba-specific validation 独立于 ordinary Whisper validation。

### 2. Tokenizer And Prompt

测试 tokenizer 对小 golden strings 的 encode/decode，以及 start-of-transcript、`ja`、transcribe 和 timestamp controls。prompt evidence 保存 token IDs/hashes，不保存私有语料文本。

### 3. Feature Extraction

通过确定性合成 WAV 和 T01 short fixture 比对特征。evidence 记录 PCM hash、shape、mel bins、padding/window/hop/filter 约定、canonical float hash、max/mean abs difference。形状必须严格相同；数值 tolerance 在 model-backed run 前固定。

### 4. Timestamp Parser

对 captured tokens 解析 span。parser 返回 typed result 或 controlled error；不能在 timestamp 缺失时生成平均时间。真实生成时保留 raw token trace 的 hash/本地引用，以证明输出时间来源。

### 5. Model Run

`large-v3` 和 Kotoba 运行独立报告。Kotoba 按 15 秒窗口记录 window offsets 和每次 prompt hash，验证后续 prompt 不包含先前文本。该层只观察边界问题，不实现 overlap/backfill 修复。

## Data Contracts

### Evidence Envelope

所有 evidence 至少有：`schemaVersion`、toolchain/model/corpus hash、engine、status、error code、duration、segments、measurements、diagnostic summary 和 privacy classification。

segments 使用：

```json
{"startMs": 0, "endMs": 1000, "text": "...", "timestampSource": "whisper-token"}
```

私有 case 的 tracked report 只保存 segment hash/metric，不保存正文。T01 result schema 是比较层的权威；PoC 需提供无损映射或由 T01 comparator 转换。

### Runtime Inventory

build evidence 记录 CMake configure/build command、compiler、CTranslate2 commit、exe/DLL hash/size、`dumpbin` machine/dependent output摘要、clean-PATH launch、CPU feature declarations。它只说明测试机运行事实，不构成发行承诺。

## Failure Semantics

- 输入/模型 hash 不符：失败，不加载。
- missing Kotoba preprocessor：仅 Kotoba 失败。
- tokenizer、feature 或 timestamp parser mismatch：失败或 `blocked`，不得静默继续判断 transcript。
- CTranslate2/load/generate error：受控 nonzero result，附 stable code。
- empty/invalid/out-of-range segment：失败，不输出替代时间轴。
- 可用 but 质量不佳：保持 measured result，交由 report 给 Gate 0 `proceed-with-risk` 或 `stop/revise`。

## Compatibility And Non-Goals

CTranslate2 是唯一 Whisper backend。PoC 不创建 fallback 到 CrispASR/ Python，不改变 Python oracle，也不承诺 Python output bit-for-bit identical。后续 T06 可以参考证明的 tokenizer/feature/timestamp contracts，但必须重新实现完整 30-second/VAD/no-speech/product lifecycle。

## Rollback

删除 `research/poc-src` 和 ignored `research/local`；不影响 application build、installer、user models 或 Python source。已验证的 inputs/report 留作 Gate 0 evidence。
