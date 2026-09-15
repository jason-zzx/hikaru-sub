# ASR Development Guidelines

> Current Native production contracts and historical Python sidecar development.

**Global rules** (Git authority, naming, security, runtime/model cache policy): see [`/AGENTS.md`](/AGENTS.md).

## Current production scope

- CTranslate2 supports the original eight routes: seven Faster-Whisper models (`tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, `large-v3-turbo`) and exact `kotoba-tech/kotoba-whisper-v2.0-faster`. Default remains `faster-whisper / large-v3`.
- Independent CrispASR full CLI supports exact `Qwen/Qwen3-ASR-1.7B` + `Qwen/Qwen3-ForcedAligner-0.6B`, recommended Q4_K pair, mandatory CPU Silero, upstream LIS/interpolation and word-aware display with the approved adjacent anomaly merge.
- Both backends use independent bundled CPU and published on-demand CUDA artifacts/roots. Explicit CUDA does not fall back; CPU does not initialize CUDA. Never load DLLs across backend trees.
- Tauri owns orchestration/lifecycle, Native workers own inference, React owns UI/ASS/translation. Exact Japanese Parakeet full-CLI/model-manager/host/ASS/UI integration is available only to builds whose embedded shared CPU **and** CUDA authority supports Parakeet; ordinary builds now embed published shared-v2 support for both engines; the retained Qwen-only v1 rollback still rejects Parakeet. A separately identified local shared candidate has file/resolution checks and real short-path portable CPU/CUDA selection/start/frontend ASS saves. Remote CUDA publication controls download only, not verified installed use. It uses card-recommended F16/default TDT, required CPU Silero and approved upstream Japanese slicing/actual-audio retranscription; no aligner or Qwen display repair. The bounded independent capability/UI review is accepted. The cwd272 startup/media/hygiene source repairs passed independent review and are included in the new default local build. The retained old app remains pre-fix; packaging does not rebind historical inference evidence. Long audio/expanded-relative paths, deep CLI roots and cross-volume deep-work remain unsupported; this is not general long-path support. Reazon/general VAD remain unimplemented. Local evidence is not a new application release or all-GPU qualification.
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
