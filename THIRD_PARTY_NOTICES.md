# Third-Party Notices

This file describes the licensing boundary for Hikaru Sub and the major
runtime components it may use. It does not change, replace, or sublicense
any third-party license.

## Scope

The `LICENSE` file applies only to Hikaru Sub's original source code and is
Apache License 2.0. Third-party code, binaries, Python packages, and model
weights remain subject to their own licenses and notices.

Release packages contain a clean ASR service template and the manifest of
approved runtime download sources. They do **not** include FFmpeg, CPython,
Python package environments, or model weights. These components are reused
from the system or downloaded after the user confirms the operation. A future
release that bundles, mirrors, or otherwise redistributes one of them must
include every license text, notice, source-offer, attribution, and other
material required by that component's license.

This document records the persistent runtime components. A release also needs
an inventory of the exact JavaScript and Rust dependency versions included in
that release; `pnpm-lock.yaml` and `src-tauri/Cargo.lock` are the version
sources for that inventory.

## Runtime components

| Component | License / terms | Source and notes |
| --- | --- | --- |
| [FFmpeg](https://ffmpeg.org/) and ffprobe | The actual binary's license controls. FFmpeg builds enabled with GPL components such as `libx264` are GPL-2.0-or-later. | Hikaru Sub invokes FFmpeg as an independent process. For every managed archive, retain its exact version, SHA-256, license output (`ffmpeg -L`), archive distributor, corresponding source, patches, and build configuration. The configured archive URLs are in `src-tauri/resources/runtime-dependency-sources.json`. |
| [CPython](https://www.python.org/) 3.11 | Python Software Foundation License Version 2 | The managed interpreter is supplied by [python-build-standalone](https://github.com/astral-sh/python-build-standalone). Its release notices and CPython's notices apply to the exact downloaded archive. |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) and [CTranslate2](https://github.com/OpenNMT/CTranslate2) | MIT | Installed for the default and Kotoba ASR profiles. |
| [FastAPI](https://github.com/fastapi/fastapi), [Pydantic](https://github.com/pydantic/pydantic), [Hugging Face Hub](https://github.com/huggingface/huggingface_hub) | MIT, MIT, Apache-2.0 respectively | Sidecar and model-download dependencies. |
| [Uvicorn](https://github.com/Kludex/uvicorn) | BSD-3-Clause | Sidecar HTTP server. |
| [PyAV](https://github.com/PyAV-Org/PyAV) | BSD-3-Clause for PyAV; wheel-bundled native libraries retain their own licenses | A wheel can contain FFmpeg libraries. Before redistributing a Python environment, inspect the exact wheel and include the notices and source materials for its bundled native libraries. |
| [NVIDIA NeMo](https://github.com/NVIDIA-NeMo/NeMo) | Apache-2.0 | Optional Parakeet and ReazonSpeech profiles share this NeMo ASR core. |
| [PyTorch](https://github.com/pytorch/pytorch) and [torchaudio](https://github.com/pytorch/audio) | BSD-style | Optional ASR profiles. Parakeet/Qwen3 may install torchaudio; ReazonSpeech profiles declare torch only (NeMo extras may still pull transitive deps). CUDA-enabled wheels also include NVIDIA components subject to NVIDIA's separate redistribution terms and notices. |
| [ReazonSpeech](https://github.com/reazon-research/reazonspeech) NeMo ASR decode algorithm | Apache-2.0 | Local timestamp/segment adapter adapted from `pkg/nemo-asr` (`decode.py` / `transcribe.py`); not installed as the GitHub helper package. |
| [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) and [Transformers](https://github.com/huggingface/transformers) | Apache-2.0 | Optional Qwen3-ASR profile. Audit the resolved transitive dependencies for the exact package set before distributing an ASR environment. |
| [soynlp](https://github.com/lovit/soynlp) | The exact package artifact must be verified before redistribution | The Qwen3-ASR dependency graph can install this package. Its published package metadata and upstream license file have reported different GPL-family identifiers; do not bundle it until the exact artifact's license is resolved and its required materials are included. |
| [Silero VAD](https://github.com/snakers4/silero-vad) | MIT | Downloaded by `torch.hub` only when the Parakeet or Qwen3 VAD path is used. |

## Model weights

The following model repositories are selectable by the application. The
model card and license in the exact downloaded revision control their use and
redistribution.

| Model repository | License / obligation |
| --- | --- |
| [Systran/faster-whisper-tiny](https://huggingface.co/Systran/faster-whisper-tiny), `base`, `small`, `medium`, `large-v2`, and `large-v3` | MIT |
| [mobiuslabsgmbh/faster-whisper-large-v3-turbo](https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo) (short name `large-v3-turbo`) | MIT |
| [kotoba-tech/kotoba-whisper-v2.0-faster](https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-faster) | MIT |
| [nvidia/parakeet-tdt_ctc-0.6b-ja](https://huggingface.co/nvidia/parakeet-tdt_ctc-0.6b-ja) | CC-BY-4.0; preserve the attribution, license link, and change indication required by that license when redistributing the model or an adaptation. |
| [Qwen/Qwen3-ASR-1.7B](https://huggingface.co/Qwen/Qwen3-ASR-1.7B) and [Qwen/Qwen3-ForcedAligner-0.6B](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B) | Apache-2.0 |
| [reazon-research/reazonspeech-nemo-v2](https://huggingface.co/reazon-research/reazonspeech-nemo-v2) | Apache-2.0 |

## Release-maintainer checklist

Before publishing a release that changes a runtime archive, Python package
profile, or model revision:

1. Lock the exact artifact versions and hashes, including transitive Python
   packages.
2. Recheck the artifact's license and bundled native libraries.
3. Update this notice with the exact source, version, and any required
   attribution or NOTICE material.
4. If the release distributes a GPL component, provide that component's
   corresponding source and satisfy its GPL obligations for that component.

Hikaru Sub and the names of third-party projects are their respective owners'
trademarks. Their use here is descriptive only.
