# ASR Development Guidelines

> Current Native production contracts and historical Python sidecar development.

**Global rules** (Git authority, naming, security, runtime/model cache policy): see [`/AGENTS.md`](/AGENTS.md).

## Current production scope

- CTranslate2 supports the original eight routes: seven Faster-Whisper models (`tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, `large-v3-turbo`) and exact `kotoba-tech/kotoba-whisper-v2.0-faster`. Default remains `faster-whisper / large-v3`.
- Independent CrispASR full CLI supports exact `Qwen/Qwen3-ASR-1.7B` + `Qwen/Qwen3-ForcedAligner-0.6B`, recommended Q4_K pair, mandatory CPU Silero, upstream LIS/interpolation and word-aware display with the approved adjacent anomaly merge.
- Both backends use independent bundled CPU and published on-demand CUDA artifacts/roots. Explicit CUDA does not fall back; CPU does not initialize CUDA. Never load DLLs across backend trees.
- Tauri owns orchestration/lifecycle, Native workers own inference, React owns UI/ASS/translation. Parakeet/Reazon and general/other-engine VAD remain unimplemented. Source support is not a new application release or all-GPU qualification.
- Qwen uses functional/structural/device/lifecycle validation, not the retired raw-session/DP/timing/Python-relative quality pipeline. Other children retain their own absolute-quality requirements.

## Guidelines Index

| Guide | Description |
|---|---|
| [Native Qwen CLI Output](./qwen-cli-output.md) | Current full-CLI output/adjacent-merge/strict protocol/host-ASS contract |
| [Quality Guidelines](./quality-guidelines.md) | Current Qwen scope; other Native absolute qualification; historical sidecar tests |
| [Directory Structure](./directory-structure.md) | Historical sidecar `server.py`, `jobs.py`, `engines/`, schemas/tests |
| [Engine Plugins](./engine-plugins.md) | Historical Python registry, optional engines and Kotoba cache |
| [API and Jobs](./api-and-jobs.md) | Historical sidecar HTTP/snapshots/diagnostics |

The repo-root `asr-service/` remains development/rollback source only. It is not
copied into resources, bundled or invoked as a production fallback. Its optional
VAD degradation behavior must not override mandatory Native Qwen VAD failure.

## Verification by scope

For Native changes, read the applicable output, Tauri path/host and frontend
availability specs and run the affected existing tests. For intentional historical
sidecar work only:

```bash
cd asr-service
python -m unittest discover tests
```

Register sidecar engines through `AsrEngine`/registry and maintain its HTTP aliases;
these are not instructions to add Python to a Native route. Report absent optional
dependencies/models and distinguish synthetic checks from real execution.

**Language**: Specs in this tree are written in **English**.
