# ASR Development Guidelines

> Current Native production contracts and historical Python sidecar development.

**Global rules** (Git authority, naming, security, runtime/model cache policy): see [`/AGENTS.md`](/AGENTS.md).

## Current production scope

- CTranslate2 supports the original eight routes: seven Faster-Whisper models (`tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, `large-v3-turbo`) and exact `kotoba-tech/kotoba-whisper-v2.0-faster`. Default remains `faster-whisper / large-v3`.
- Independent CrispASR full CLI supports exact `Qwen/Qwen3-ASR-1.7B` + `Qwen/Qwen3-ForcedAligner-0.6B`, `nvidia/parakeet-tdt_ctc-0.6b-ja`, and `reazon-research/reazonspeech-nemo-v2` under the published shared-v3 both-device authority. All require CPU Silero VAD; Qwen retains upstream ForcedAligner LIS/interpolation and the approved adjacent display anomaly merge, while Parakeet/ReazonSpeech use upstream Japanese TDT/RNN-T segment output.
- Both backends use independent bundled CPU and published on-demand CUDA artifacts/roots. Explicit CUDA does not fall back; CPU does not initialize CUDA. Never load DLLs across backend trees.
- Tauri owns orchestration/lifecycle, Native workers own inference, React owns UI/ASS/translation. The embedded shared CrispASR authority must advertise each engine on both CPU and CUDA before that route is selectable. ReazonSpeech exact Q8_0 is productized in published shared-v3: pure-RNNT tokens use NeMo `[t,t+1)` intervals, then token/word/segment ends are intersected only with the exact PCM sample support of that parent or gap decode call, removing convolution-padding extent without next-cue/slice guessing. The CPU/CUDA short/medium/long functional matrix, local CPU/CUDA application flows, official/China dependency downloads and ordinary-build gates pass; shared-v2 remains immutable rollback. This dependency publication is not an application release.
- ReazonSpeech qualification is explicitly functional-only: strict legal output, exact device execution and lifecycle/delivery checks; no CER, semantic-gap, Python parity, RTF/cold-start/RSS, quality ranking, or inherited-GPU qualification gates.

## Guidelines Index

| Guide | Description |
|---|---|
| [Native Qwen CLI Output](./qwen-cli-output.md) | Current full-CLI output/adjacent-merge/strict protocol/host-ASS contract |
| [Quality Guidelines](./quality-guidelines.md) | Current Native functional checks, Kotoba quality boundary, historical sidecar tests |
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
