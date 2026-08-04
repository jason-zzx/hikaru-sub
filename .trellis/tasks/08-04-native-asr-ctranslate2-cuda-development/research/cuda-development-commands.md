# T07 CUDA Development Reproduction Commands

All build trees, model/audio paths, requests/events/transcripts, and raw evidence remain below ignored roots. Replace the root-role variables with the locally attested paths from `cuda-input-lock.md`; do not copy private paths into tracked output.

```powershell
$task = ".trellis/tasks/08-04-native-asr-ctranslate2-cuda-development"
$t06 = ".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local"
$bin = "$task/research/local/build/windows-x64-ct2-cuda/bin"
$model = "$t06/models/large-v3"
$short = ".asr-benchmark/short.wav"
$source120 = ".asr-benchmark/medium.wav"
$slice120 = "$t06/diagnostics/medium-first-120s.wav"
$lock = "$task/research/cuda-input-lock.md"
$runner = "$bin/hikaru-asr-ctranslate2-tests.exe"
$worker = "$bin/hikaru-asr-worker.exe"
$cudaRoot = "<locked-cuda-toolkit-12.8-root>"
$env:CUDA_PATH = $cudaRoot

# Configure/build/test from an x64 MSVC 19.44 developer environment.
Push-Location native-asr
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release
cmake --preset windows-x64-ct2-release
cmake --build --preset windows-x64-ct2-release
ctest --preset windows-x64-ct2-release
cmake --preset windows-x64-ct2-cuda-development
cmake --build --preset windows-x64-ct2-cuda-development
ctest --preset windows-x64-ct2-cuda-development
Pop-Location

# For each runner invocation, PATH is exactly:
#   1. $bin
#   2. $cudaRoot/bin
#   3. Windows System32
# CUDA_PATH is $cudaRoot.
function Invoke-T07Runner([string[]]$Arguments) {
  $savedPath = $env:PATH
  try {
    $env:PATH = @((Resolve-Path $bin).Path, (Join-Path $cudaRoot "bin"), [Environment]::SystemDirectory) -join ";"
    & $runner @Arguments
    if ($LASTEXITCODE -ne 0) { throw "T07 runner failed: $LASTEXITCODE" }
  } finally {
    $env:PATH = $savedPath
  }
}
$common = @(
  "--run-cuda-development-evidence",
  "--model", $model,
  "--input-lock", $lock,
  "--production-worker", $worker,
  "--model-id", "Systran/faster-whisper-large-v3",
  "--model-revision", "edaa852ec7e145841d8ffdb056a99866b5f0a478",
  "--model-bin-sha256", "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1"
)
# Separate clean discovery processes; excluded from medians. GPU name,
# compute capability, and CUDA Driver API version are queried from device 0;
# the caller does not supply GPU identity labels.
Invoke-T07Runner (@common + @("--module-discovery", "--device", "cpu", "--audio", $short, "--case-id", "short-v1", "--repeats", "1", "--output", "$task/research/local/raw/discovery-cpu.json"))
Invoke-T07Runner (@common + @("--module-discovery", "--device", "cuda", "--audio", $short, "--case-id", "short-v1", "--repeats", "1", "--output", "$task/research/local/raw/discovery-cuda.json"))
python "$task/research/publish_cuda_development_result.py" --freeze-modules `
  --cpu-discovery "$task/research/local/raw/discovery-cpu.json" `
  --cuda-discovery "$task/research/local/raw/discovery-cuda.json" `
  --module-lock "$task/research/cuda-module-lock.json"

# Formal measurements use four new processes, each with one backend and exactly 1 cold + 3 warm.
Invoke-T07Runner (@common + @("--device", "cpu", "--audio", $short, "--case-id", "short-v1", "--repeats", "4", "--output", "$task/research/local/raw/short-cpu.json"))
Invoke-T07Runner (@common + @("--device", "cuda", "--audio", $short, "--case-id", "short-v1", "--repeats", "4", "--output", "$task/research/local/raw/short-cuda.json"))
Invoke-T07Runner (@common + @("--device", "cpu", "--audio", $slice120, "--source-audio", $source120, "--case-id", "medium-v1-first-120s", "--repeats", "4", "--output", "$task/research/local/raw/diagnostic-cpu.json"))
Invoke-T07Runner (@common + @("--device", "cuda", "--audio", $slice120, "--source-audio", $source120, "--case-id", "medium-v1-first-120s", "--repeats", "4", "--output", "$task/research/local/raw/diagnostic-cuda.json"))

python "$task/research/publish_cuda_development_result.py" --publish-measurements `
  --short-cpu "$task/research/local/raw/short-cpu.json" `
  --short-cuda "$task/research/local/raw/short-cuda.json" `
  --diagnostic-cpu "$task/research/local/raw/diagnostic-cpu.json" `
  --diagnostic-cuda "$task/research/local/raw/diagnostic-cuda.json" `
  --module-lock "$task/research/cuda-module-lock.json" `
  --evidence-output "$task/research/evidence/cuda-development-result.json" `
  --report-output "$task/research/cuda-development-report.md"

python "$task/research/test_publish_cuda_development_result.py"

# Test-only NativeAsrHost CUDA success, CPU-only cuda_not_built, and cancel/reap.
$env:HIKARU_ASR_PRODUCTION_WORKER = (Resolve-Path $worker).Path
$env:HIKARU_ASR_CT2_CPU_WORKER = (Resolve-Path "native-asr/build/windows-x64-protocol/bin/hikaru-asr-worker.exe").Path
$env:HIKARU_ASR_CT2_MODEL_PATH = (Resolve-Path $model).Path
$env:HIKARU_ASR_CT2_AUDIO_PATH = (Resolve-Path $short).Path
$env:HIKARU_ASR_CT2_CANCEL_AUDIO_PATH = (Resolve-Path $slice120).Path
$env:HIKARU_ASR_CT2_DEVICE = "cuda"
cargo test --manifest-path src-tauri/Cargo.toml asr_worker -- --test-threads=1
Remove-Item Env:HIKARU_ASR_PRODUCTION_WORKER,Env:HIKARU_ASR_CT2_CPU_WORKER,Env:HIKARU_ASR_CT2_MODEL_PATH,Env:HIKARU_ASR_CT2_AUDIO_PATH,Env:HIKARU_ASR_CT2_CANCEL_AUDIO_PATH,Env:HIKARU_ASR_CT2_DEVICE,Env:CUDA_PATH

# Full affected-package regression.
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
pnpm build
python scripts/asr-benchmark.py self-check
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
git diff --check
```

## Frozen Output Identity

| Output | SHA-256 |
|---|---|
| revised CUDA input lock | `42d2de13627de0d83d6ecaa118897e370899734dfb3d26b5840802612c353bc9` |
| final module lock | `8c8dba3bec12d6b87c08c4df3ee886f0d87aff36a5dff5eb33aa96ae19004a45` |
| deterministic publisher | `74bcf3eb8f8deac9e2ec3003e3daed703696efce489444560a0f5c15fd1b5f3d` |
| final CUDA worker | `73aa6f0d993f5d2ee74f3451ae3657bca219ec2ef07e400d966802df8851312a` |
| final measurement runner | `143926ca86d9d149516489f10e2fdd63de4a776e249ff28731eea9328385e245` |
| sanitized development result JSON | `515da44bedab80c23458413d73a9633867899284c7d32b771c1596699f690aab` |
| sanitized development report | `0483de654c16b558226e1310f1f77f258b1a918c41a4a7cb32f46be5f4d88801` |

The publisher was run twice from the same four formal raw files and produced byte-identical outputs. The final result also binds each ignored formal raw file by SHA-256.
