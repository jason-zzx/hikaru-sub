# Qwen3 + ForcedAligner：固定上游依据

本文件保留重建时的静态来源结论，不是模型功能验收。用户后续批准完整 CLI、必需 CPU VAD、上游 LIS/插值及最小相邻展示异常合并；当前实现与双设备应用已接受，见 child `prd.md` / `implement.md`。不恢复旧 raw-only、DP、Nagisa/Python parity 或源码裁剪方向。

基线 CrispASR `v0.8.32` / `e2a356146e36bc1cc0410edefb01990448766979`；逐文件 URL/size/SHA 在 `upstream-rebuild-sources.json`。`upstream-engineering-baseline-lock.json` 是仍被构建消费的固定 source/model metadata，保持原路径与字节；其获取时点 flags 不改标为后来的实际验证。

| 固定源码依据 | 结论与使用边界 |
|---|---|
| `docs/cli.md:304–359` | CLI/server 是完整 VAD→ASR→alignment orchestrator；session C ABI 是 caller-driven primitive。产品复用完整 CLI，不建服务或自编排 session。`--strict-pipeline`/`--require-word-timestamps`/`--require-vad` 与受控失败适配保持。 |
| `docs/cli.md:519–574,698–704` | Qwen ForcedAligner 对前导静音敏感，上游强烈推荐 VAD speech slices；短片合并、长片 ceiling、原时间 offset 映射。`--vad-stitch` 默认关闭；非 VAD 默认 30s chunking 不是旧实验自定义窗口。Qwen 所需 CPU VAD 已批准并交付，其他通用 VAD 仍最后处理。 |
| `src/crispasr_model_registry.cpp:157–161,1146–1157` | 默认 1.7B ASR Q4_K + Qwen companion Q4_K。`-m auto` 在 Qwen 路线会选 0.6B，`-am auto` 选 Canary；产品必须传 exact 受管文件，不以 `resolve/main` 作为供应链锁。 |
| `src/crispasr_aligner.cpp:75–136` | 内置 CJK 逐码点/西文空白分字，CLI 与 ABI 共用；不需要 Nagisa/DyNet 移植。 |
| `src/qwen3_asr.cpp:2268–2382` | timestamp head argmax → 最长非递减子序列（称 LIS）→ outlier 插值/末尾链值 → end>=start → 80ms 时间单位。v0.8.31 已有同类处理，不能称 v0.8.32 新算法；也不能冒称未经修正的 raw argmax。 |
| `examples/cli/crispasr_output.cpp:370–516` | word-aware display 有无 words/无用 words 的文本长度分配 fallback；产品拒绝该 fallback。LIS/display 不保证所有最终行正时长或开始有序，不能用短 smoke 推断长输入合法；已批准的相邻异常合并仅用现有端点包络、保留正文/word 时间。 |
| `src/qwen3_asr.cpp:1497–1507`；`src/crispasr_aligner.cpp:225–237` | 上游 GPU init 可回退 CPU，aligner 未显式透传设备；strict pipeline 本身不是 strict CUDA。当前适配强制 ASR/lazy audio/aligner 同设备及图/buffer 验证，VAD 独立 CPU，不做数值研究。 |
| `examples/cli/crispasr_run.cpp:5135+`；`crispasr_output.cpp:674,694–715` | JSON transcription/words 不等于最终 display；当前桥导出活动 display vector。offsets 是毫秒，words t0/t1 是厘秒，不能混用。 |

固定 exact pair/Silero 的发布仓库 revision/文件/size/SHA 与来源许可在上述锁，完整 c2pa 获取 authority 在 `native-asr/runtime/full-cli/prepare.py`。完整 runtime 文件与 linked notices、实际 CPU/CUDA bytes 和包身份以 `native-asr/runtime/crispasr-product-lock.json` 为准，不用静态推荐替代功能或发布证据。当前完整 CLI 的构建/适配/回归命令见 `native-asr/runtime/full-cli/README.md`。
