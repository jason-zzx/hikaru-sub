# 实施计划

## 0. 前置与边界

- 当前任务只在用户审阅并明确批准后执行 `task.py start`。
- 不改变默认引擎/模型、HTTP/IPC schema、缓存根目录或运行时下载源 manifest。
- 不安装 `reazonspeech-nemo-asr` GitHub 源包，不新增模型权重或依赖到发布包。
- 不执行 git commit；提交仍需用户另行明确授权。

## 1. 建立失败测试

1. 扩展 `src/constants/asr.test.ts`：
   - faster-whisper 包含 `large-v3-turbo`；
   - `large-v3` 默认不变；
   - `reazonspeech-nemo` 仅映射官方模型。
2. 扩展 `src/constants/asrSetup.test.ts`：CPU/CUDA/auto 映射到 ReazonSpeech profile，
   profile label 正确。
3. 新增 `asr-service/tests/test_reazonspeech_nemo.py`，用 fake torch/NeMo/tokenizer/
   hypothesis 覆盖模型校验、可用性、缓存、下载、设备、时间戳分段、原生整段推理、
   VAD 忽略和延迟取消。
4. 扩展 `src-tauri/src/asr_setup.rs` 单测预期，先确认新 profile 尚未实现时失败。

验证：

```bash
pnpm test -- src/constants/asr.test.ts src/constants/asrSetup.test.ts
cd asr-service && python -m unittest tests.test_reazonspeech_nemo
cargo test --manifest-path src-tauri/Cargo.toml asr_setup
```

## 2. 增加模型选项与 ReazonSpeech 引擎

1. 在 `src/constants/asr.ts` 增加 faster-whisper 模型与 ReazonSpeech engine/model。
2. 把通用 Hugging Face 下载逻辑收到 `asr-service/engines/hf_download.py`：
   - `make_progress_tqdm`（字节进度）；
   - `snapshot_download_repo`（封装 `snapshot_download`，Windows 首次调用即使用
     `max_workers=1`）；
   - faster-whisper / ReazonSpeech / Parakeet / Qwen3 全部改走该 helper，
     不再在引擎内直接 `huggingface_hub.snapshot_download`。
3. 实现 `asr-service/engines/reazonspeech_nemo.py`：
   - 唯一模型 ID 校验；
   - NeMo/Torch 惰性探测；
   - HF marker 检查；`allow_patterns=[MODEL_FILE]` + 共享 helper 下载；
   - CPU/CUDA/auto 模型加载；
   - 16 kHz PCM WAV -> tensor -> 0.5 秒 padding；
   - 官方 RNN-T timestamp 解码与 segment 校验；
   - 原生整段推理、推理前后取消检查、忽略 VAD。
4. 在 `asr-service/engines/registry.py` 注册新引擎。
5. 运行 Python focused tests；若 fake 需要模拟过多 NeMo 内部实现，收紧到适配器实际
   读取的最小 public shape，不建立第二套 NeMo 对象模型。

回退点：若官方模型真实 hypothesis 不符合研究中的 `y_sequence`/`timestamp` 契约，
暂停实现并返回规划修订，不用均分时间轴掩盖问题。

## 3. 接入依赖准备

1. 在 `src/types/index.ts` 增加 `reazonspeech-cpu` / `reazonspeech-cuda`。
2. 在 `src/constants/asrSetup.ts` 增加显式设备与 GPU 自动探测映射及中文 label。
3. 重组可选 requirements，保持版本单一来源且避免多装直接依赖：
   - 新增 `requirements-nemo.txt`，从 `requirements-parakeet.txt` 移入 NeMo、
     fsspec 与 Hugging Face Hub 约束；
   - `requirements-parakeet.txt` 保留为兼容入口并引用共享 NeMo 文件；
   - 新增 `requirements-reazonspeech.txt`，只声明 PyTorch 并引用共享 NeMo 文件，
     不声明 `torchaudio`；CPU/CUDA profile 共用文件但选择不同 PyTorch wheel source；
   - 不改变现有 Parakeet CPU/CUDA requirements 的行为。
4. 在 `src-tauri/src/asr_setup.rs`：
   - 增加两个 serde profile；
   - 映射到 ReazonSpeech 自己的 CPU/CUDA requirements；
   - 更新 engine/profile 匹配、CUDA profile、PyTorch source 文件名判断和测试。
5. 在 `scripts/setup-asr.sh` 增加 `reazonspeech`、CPU、CUDA 参数、自动 GPU 选择和
   正确日志，安装对应的最小 ReazonSpeech requirements。
6. 用 `pip install --dry-run -r requirements-reazonspeech.txt` 检查直接声明中没有
   `torchaudio`，并确认 requirements 不触发任何模型下载。
7. 运行 `bash -n scripts/setup-asr.sh`、前端 setup tests 和 Rust focused tests。

## 4. 接入前端交互

1. `SettingsTranscriptionPanel.tsx` 增加 ReazonSpeech 的 NeMo 可选依赖与设备提示。
2. `TranscribeView.tsx`：
   - 增加原生整段推理、非即时取消说明；
   - 选择 ReazonSpeech 时不渲染 VAD 卡片；
   - 不改变其他引擎的 VAD 会话状态和控件。
3. 复用现有 `ModelManager`、`AsrEngineSetupPanel`、开始前模型检查/下载和 job polling；
   不新增组件、store 或 Tauri wrapper。
4. 运行相关前端测试与 `pnpm build`。

## 5. 发布资源与文档

1. 同步到 `src-tauri/resources/asr-service/`：
   - ReazonSpeech engine；
   - 共享 HF 下载模块及更新后的 faster-whisper / Parakeet / Qwen3；
   - registry；
   - 共享 NeMo 与 ReazonSpeech requirements；
   - README。
2. 更新根 `README.md` 的支持引擎说明。
3. 更新 `asr-service/README.md`：安装 profile、模型、原生推理、时间戳、取消限制。
4. 更新 `THIRD_PARTY_NOTICES.md`：
   - ReazonSpeech helper/算法来源与模型 Apache-2.0；
   - large-v3-turbo 转换模型 MIT；
   - NeMo 行说明同时服务 Parakeet/ReazonSpeech。
5. 用定向 diff/哈希检查开发树与发布资源关键文件一致，不把 tests 或 `.venv` 同步进
   resources。

## 6. 自动化验证

依次运行：

```bash
pnpm test -- src/constants/asr.test.ts src/constants/asrSetup.test.ts
cd asr-service && .venv/Scripts/python.exe -m unittest discover -s tests -p "test_hf_download.py"
cd asr-service && .venv/Scripts/python.exe -m unittest discover -s tests -p "test_reazonspeech_nemo.py"
cd asr-service && .venv/Scripts/python.exe -m unittest discover -s tests -p "test_qwen3_asr_engine.py"
cd asr-service && .venv/Scripts/python.exe -m unittest discover tests
bash -n scripts/setup-asr.sh
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test
pnpm build
```

检查：

```bash
rg -n "large-v3-turbo|reazonspeech-nemo|reazonspeech-(cpu|cuda)" \
  src asr-service src-tauri scripts README.md THIRD_PARTY_NOTICES.md

git diff --no-index asr-service/engines/reazonspeech_nemo.py \
  src-tauri/resources/asr-service/engines/reazonspeech_nemo.py
```

对共享/修改后的发布资源文件逐个做同类差异检查。

## 7. 真实模型冒烟测试

用户已允许安装依赖和下载约 2.48 GB 模型。当前环境：Python 3.11.15、NeMo
2.7.3、PyTorch 2.12.0+cu126、RTX 3070 8 GB、约 320 GB 可用空间。

1. 从 ReazonSpeech 官方 demo 下载短日语音频到临时目录，不提交测试媒体。
2. 用 FFmpeg 转为 16 kHz、单声道、16-bit PCM WAV。
3. 将 `HF_HOME` 指向 Tauri debug 安装目录的受管模型缓存位置。
4. 调用新引擎的 `download_model`（经 `snapshot_download_repo`，仅 `.nemo`），
   确认进度与 `is_model_downloaded=True`。若此前失败但 `.nemo` 已在缓存中，
   状态检测应直接为已下载，重试下载应秒完成而非再次整仓失败。
5. 首先用 `device="cuda"` 加载并转录，断言：
   - 至少一个非空日语 segment；
   - 每段 `0 <= start_ms < end_ms <= duration_ms`；
   - 时间顺序非递减；
   - engine 返回语言 `ja`。
6. 若 8 GB CUDA OOM，清理本次模型对象后改用 CPU 完成同一测试，并将 CUDA 路径记为
   未通过实机验证，而不是降低验收断言。
7. 额外通过 sidecar model status/job API 做一次短流程检查，确认 registry、下载状态和
   job snapshot 接线，不要求启动完整 Tauri UI。

## 8. 最终检查与审阅

- 检查 git diff 仅含本任务文件和 Trellis artifacts。
- 对照 `prd.md`、`design.md` 逐条核验 acceptance criteria。
- 运行全范围 `trellis-check`；发现跨层 string/profile 漏接时修复后重跑相关完整测试。
- 记录真实冒烟测试耗时、设备、模型 revision、输出 segment 数与任何未验证路径；不把
  模型、音频、缓存或日志加入 git。
- 完成后进入 spec 更新判断；未经用户单独授权不提交代码。
