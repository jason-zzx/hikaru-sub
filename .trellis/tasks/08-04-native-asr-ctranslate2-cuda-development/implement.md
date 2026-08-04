# T07 - CTranslate2 CUDA 开发通道实施计划

## Status

Implementation and independent check complete. Task remains `in_progress` for the main-session spec update, commit, and finish steps; do not archive or commit from this check run.

## Dependencies

- T04 protocol v1 和 fake worker 已归档。
- T05 Rust native host 已归档。
- T06 production worker、selected CPU algorithm、large-v3 model identity、benchmark harness 和 host model-backed seam 已归档。
- 本机 RTX 3070、driver 596.49、CUDA 12.8.93 可用。

## Implementation Checklist

### 1. Freeze Inputs And Privacy Boundary

- [x] 在根 `.gitignore` 增加 active/archive-safe T07 `research/local/` 规则。
- [x] 在创建任何 local output 前，用 `git check-ignore` 验证 active 与 future archive 路径。
- [x] 新建 tracked `research/cuda-input-lock.md`，记录：
  - CTranslate2 commit；
  - CUDA 12.8.93、driver、RTX 3070/8.6；
  - MSVC/CMake/Ninja/Windows identity；
  - installed toolkit consumed components 的 size/SHA-256；
  - primary `WITH_CUDNN=OFF` 决定与 upstream 9.10.2 reviewed reference；
  - large-v3/model/config/audio identities；
  - canonical ignored root 和 privacy contract；
  - CUDA child-process restricted PATH 的 ordered root roles：task-local runtime/bin、locked CUDA Toolkit bin、必要 Windows system root。
- [x] 不下载 cuDNN；只有 primary CUDA result 的 reviewed root-cause 要求时才返回规划修订。

Rollback: 删除 lock 草案和 ignore rule；不影响现有 build。

### 2. Add Opt-In CUDA Build

Files:

- `native-asr/CMakeLists.txt`
- `native-asr/CMakePresets.json`

- [x] 在现有 CT2 block 增加 default-off CUDA development option。
- [x] CPU branch 保持 `WITH_CUDA=OFF/WITH_CUDNN=OFF`。
- [x] CUDA branch 设置 `WITH_CUDA=ON`、`WITH_CUDNN=OFF`、`CUDA_DYNAMIC_LOADING=ON`、`CUDA_ARCH_LIST=8.6`，并保留 oneDNN CPU backend。
- [x] 新增 `windows-x64-ct2-cuda-development` configure/build/test presets；binary dir 位于 T07 ignored local root。
- [x] CUDA discovery 只在显式 preset 中发生；protocol-only 和 CPU configure 不读取 CUDA 环境。
- [x] Post-build 只复制现有 worker/CT2/tokenizer/ORT/VAD local dependencies；CUDA DLL 不复制到 tracked/build output，而是通过 lock 固定的 restricted PATH 从 task-local runtime role 或 locked toolkit bin 加载。不把 runtime 接入发布目录或 package scripts。

Checks:

```powershell
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release

cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release
ctest --preset windows-x64-ct2-release

cmake --preset windows-x64-ct2-cuda-development
cmake --build --preset windows-x64-ct2-cuda-development
ctest --preset windows-x64-ct2-cuda-development
```

Rollback: 关闭/删除新增 CUDA option 与 preset；CPU/protocol presets 不变。

### 3. Introduce Structured Backend Execution Config

Files:

- `native-asr/src/ctranslate2_whisper.hpp`
- `native-asr/src/ctranslate2_whisper.cpp`
- `native-asr/tests/ctranslate2_whisper_tests.cpp`

- [x] 增加最小 execution config，表达 CT2 device、compute type 和 device index。
- [x] 默认 config 保持 CPU `INT8/{0}`，现有 constructor callers 和 CPU tests 不变或最小适配。
- [x] CUDA config 固定 `Device::CUDA/FLOAT16/{0}`。
- [x] 编译期区分 CUDA-enabled binary；CPU binary 收到 CUDA config 时返回 `cuda_not_built`。
- [x] 在 model construction 前验证 CUDA device count 与 device 0 FP16 support。
- [x] 将 runtime/device/model construction exception 收敛为安全 pre-ready error family，不泄露绝对路径。
- [x] 保持 algorithm、feature extraction、timestamp parsing、progress、segment 和 cancellation 逻辑完全共享。

Focused tests:

- CPU default mapping unchanged；
- CUDA mapping is device 0/FLOAT16；
- CPU-only build rejects CUDA；
- unavailable device / unsupported compute type fail closed；
- no automatic CPU fallback；
- existing self-check remains green。

Rollback: constructor 恢复 CPU default；无数据迁移。

### 4. Wire Protocol Device Into The Worker

File:

- `native-asr/src/main.cpp`

- [x] 删除“非 CPU 一律未实现”的 blanket rejection，保留 Vulkan rejection。
- [x] 将 protocol `cpu/cuda` 映射到固定 execution config。
- [x] 只在 backend 成功构造和 pre-ready attestation 完成后 emit `ready`。
- [x] `ready.device` 使用 resolved request device，不再硬编码 CPU。
- [x] CUDA error 在 ready 前输出 stable structured error + EOF；stdout 继续 protocol-only。

Focused worker checks:

- CPU request emits CPU ready；
- CUDA-enabled worker emits CUDA ready；
- CPU-only worker receives CUDA request -> `cuda_not_built`；
- no ready on CUDA startup failure；
- protocol route mismatch remains rejected。

Rollback: 恢复 CPU-only mapping；protocol schema 不变。

### 5. Extend The Existing Evidence Runner

Files:

- `native-asr/tests/ctranslate2_whisper_tests.cpp`
- T07 `research/` publisher/validator files

- [x] 扩展现有 evidence mode 接受显式 device，但不修改 protocol v1。
- [x] 同一 CUDA-enabled runner 对 CPU 使用 INT8、对 CUDA 使用 FLOAT16。
- [x] 每个 sample/device 在一个 backend instance 中运行 `1 cold + 3 warm`，保留全部 timing rows。
- [x] 记录 requested/resolved device、compute type、index、GPU/driver、worker/runner/CT2/tokenizer/model/config/audio identity。
- [x] 在同一 CUDA-enabled binary identity 下，分别从干净进程执行一条不计入结果的 CPU module-discovery completed run 和一条 CUDA module-discovery completed run，记录各自实际 loaded relevant modules。
- [x] 比较两条 discovery rows 后推导并冻结 shared、CPU-only 和 CUDA-only required module sets；随后从干净新进程重新执行所有正式 CPU/GPU `1 cold + 3 warm`，两条 discovery rows 均不得混入 median。
- [x] Primary identity 拒绝 cudnn module、requested CUDA/resolved CPU、missing device-specific modules、root/hash drift 和 correlated all-root rewrite；CPU rows 不要求 CUDA-only modules，但意外 CUDA module 必须解释或拒绝。
- [x] raw output 只能写入 canonical T07 ignored root。

Private sample setup:

- [x] 验证 short-v1 identity。
- [x] 复用 medium-v1 first-120s PCM slice；验证 SHA-256 `d7b8c62d1358eee4f7ca40596ec424e91cde6992654add5c0219cdeed3907b42` 和 source prefix 关系。

Rollback: evidence mode 保持 CPU-only；删除 ignored raw。

### 6. Add Deterministic Development Result Publisher

Files:

- `research/publish_cuda_development_result.py`
- `research/test_publish_cuda_development_result.py`
- final sanitized JSON/report paths fixed in lock

- [x] 使用 Python stdlib；不添加依赖。
- [x] Success/no-speedup path 输入四组 ignored raw：short CPU/GPU、120s CPU/GPU；验证共同 source/binary/model/config/audio/shared-module identity、各自 device-specific module set 和 `1 cold + 3 warm`。
- [x] Unavailable path 输入独立 sanitized failure envelope：只接受 configure/build failure，或 structured pre-ready CUDA runtime/device/model failure；记录 command/tool/runtime identity、failure stage 和 safe error code，不要求四组 measurement raw。
- [x] Evidence/raw 缺失、identity drift、module mutation、publisher validation error 或未完成 measurement -> no-result failure，禁止发布三种 development result。
- [x] 对每个 completed measurement group 计算 3 warm inference RTF median。
- [x] 两个 sample 均满足 `gpu <= cpu * 0.80` -> `development-gpu-ready`。
- [x] CUDA attested/completed 且任一 sample 不满足 -> `development-gpu-no-speedup`。
- [x] 合法 unavailable envelope -> `development-gpu-unavailable`。
- [x] 单独报告 `gpu median RTF <=0.5`，但不用于开发 result。
- [x] 不读取 ASS、不计算 CER/gap/segmentation/timeline quality。
- [x] mutation tests 覆盖 device、compute、GPU、shared/device-specific modules、restricted PATH roots、worker、model/config/audio、repeats/timing、raw path、failure envelope 和 correlated root rewrite。
- [x] 连续运行 publisher 两次，要求 tracked output 字节一致。

Rollback: 不发布 development result；不影响 worker。

### 7. Generalize Test-Only Rust Host Coverage

File:

- `src-tauri/src/asr_worker.rs`

- [x] 只在 `#[cfg(test)]` model-backed helper 增加显式 device 输入。
- [x] 产品/Release code 不读取新的 device/test env key。
- [x] CUDA success：completed、legal segments、recovery/fallback、reaped、active slot released。
- [x] CUDA pre-ready failure：用 CPU-only worker 接收 CUDA request，确定性触发 `cuda_not_built`；safe code preserved，无 completed，不临时破坏系统 CUDA。
- [x] CUDA cancel：使用 120s sample，等待 `durationMs > 0` 后 cancel，2 秒内 cancelled/reaped/released，无 completed snapshot。
- [x] 保留 fake-worker cancellation/process-tree tests 不变。

Focused command:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml asr_worker -- --test-threads=1
```

Rollback: test helper 恢复 CPU；production host 无变化。

### 8. Run Paired Measurements And Freeze Result

- [x] 先在同一 CUDA-enabled build 上分别从干净进程完成不计分 CPU 与 CUDA module-discovery completed runs，独立审查差异并冻结 shared/CPU-only/CUDA-only module sets。
- [x] 冻结后分别从干净新进程运行 short CPU/GPU 与 120s CPU/GPU。
- [x] 验证每组 exactly `1 cold + 3 warm`，且 CPU/GPU 分开进程；discovery row 不进入 median。
- [x] 检查 module/GPU attestation、raw containment 和隐私。
- [x] 运行 deterministic publisher/mutation tests。
- [x] 发布唯一结果：`development-gpu-ready`、`development-gpu-unavailable` 或 `development-gpu-no-speedup`。
- [x] 若 `development-gpu-ready`，在 report 中明确 T08 使用 GPU 继续字幕质量迭代，即使 CER/gap/timeline 未通过。
- [x] 若 unavailable/no-speedup，记录技术/性能原因，不以字幕质量解释 CPU fallback。

Rollback: 删除/重建 ignored measurements；tracked report 只接受同一 frozen identity。

### 9. Full Regression And Review Gate

Run:

```powershell
# Native protocol/CPU/CUDA presets
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release
cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release
ctest --preset windows-x64-ct2-release
cmake --preset windows-x64-ct2-cuda-development
cmake --build --preset windows-x64-ct2-cuda-development
ctest --preset windows-x64-ct2-cuda-development

# Rust host
cargo test --manifest-path src-tauri/Cargo.toml asr_worker -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml

# Existing frontend/type integration
pnpm build

# Benchmark harness and privacy
python scripts/asr-benchmark.py self-check
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
git diff --check
git status --short
```

Review checklist:

- [x] no production/default/installer/downloader/UI changes；
- [x] CPU/protocol presets work without CUDA env；
- [x] no silent CUDA -> CPU fallback；
- [x] ready device and actual execution match；
- [x] quality metrics do not affect development result；
- [x] no private text/model/runtime/path artifacts tracked；
- [x] parent T07/T08 handoff and relevant ASR/Tauri specs updated only after implementation evidence is final。

## Expected Changed Files

Tracked implementation should remain close to:

- `.gitignore`
- `native-asr/CMakeLists.txt`
- `native-asr/CMakePresets.json`
- `native-asr/src/ctranslate2_whisper.hpp`
- `native-asr/src/ctranslate2_whisper.cpp`
- `native-asr/src/main.cpp`
- `native-asr/tests/ctranslate2_whisper_tests.cpp`
- `src-tauri/src/asr_worker.rs`
- T07 `research/*.md|*.py|*.json`
- final owning ASR/Tauri spec and parent handoff updates

No new production subsystem or third-party source dependency is planned.
