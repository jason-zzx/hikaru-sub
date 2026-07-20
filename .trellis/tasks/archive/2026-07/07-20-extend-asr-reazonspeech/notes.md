# 实现笔记

## Windows HF 下载（WinError 1314）

- **现象**：应用内下载 ReazonSpeech 失败，日志为
  `[WinError 1314] 客户端没有所需的特权`，栈在
  `huggingface_hub` 为 `README.md` 建 `blobs → snapshots` symlink。
- **性质**：Windows 未开开发者模式时 hub 缓存默认依赖 symlink，并发 worker 更容易
  触发权限失败。**不是** ReazonSpeech 推理逻辑回归，也不是“只有新引擎才用
  snapshot_download”——旧引擎同样走 hub。
- **现场**：约 2.48 GB 的 `reazonspeech-nemo-v2.nemo` 已写入受管缓存，
  `is_model_downloaded=True`；任务因 README symlink 标失败。
- **修复**：
  1. `engines/hf_download.py`：Windows 调用 `snapshot_download_repo` 时直接设置
     `max_workers=1`；
  2. ReazonSpeech `allow_patterns=[MODEL_FILE]`，避免无关小文件；
  3. faster-whisper / Parakeet / Qwen3 全部改走 helper（相对原 design
     “不顺带改造 Parakeet/Qwen3” 的有意扩展，已回写 design/implement/prd）。
- **验证**：`test_hf_download`、`test_reazonspeech_nemo`、`test_qwen3_asr_engine`
  通过；本机对已缓存 repo 的 `snapshot_download_repo(..., allow_patterns=[.nemo])`
  成功。用户需重启 sidecar 后生效。

## 规划偏差（已文档对齐）

| 原规划 | 现状 |
|--------|------|
| HF helper 仅 faster-whisper + ReazonSpeech | 全部引擎下载入口统一 |
| ReazonSpeech 整仓 snapshot | 仅 `.nemo` |
| 不改造 Parakeet/Qwen 下载路径 | 已改造，进度语义仍为完成后 walk |

## 真实模型 CUDA 冒烟（2026-07-20）

- **环境**：Windows、Python 3.11.15、PyTorch 2.12.0+cu126、NeMo 2.7.3、
  NVIDIA GeForce RTX 3070 8 GB，`device="cuda"`。
- **模型**：`reazon-research/reazonspeech-nemo-v2`，受管 HF 缓存 revision
  `33693408be76b7cba9fd4a7546a0a8772430211b`，缓存状态检测为已下载。
- **音频**：ReazonSpeech 官方 demo，临时转换为 16 kHz、16-bit、单声道 PCM WAV；
  时长 17,000 ms，测试媒体未加入仓库。
- **结果**：精简实现后再次完成模型加载与真实推理，约 28.21 秒完成；语言 `ja`，输出
  3 个非空日语 segment，时间轴有序且全部满足
  `0 <= start_ms < end_ms <= duration_ms`。
- **内存修复复验**：同一音频使用紧凑 `array('h')` + 直接 Tensor 转换，Python
  tracemalloc 峰值约 1.07 MiB，PCM + Tensor 约 1.62 MiB；按采样数线性估算约
  0.32 GiB/小时，不再创建整段 `list[float]`。
- **未实机路径**：CPU 分支由自动化测试覆盖，本次未做真实 CPU 模型推理。
