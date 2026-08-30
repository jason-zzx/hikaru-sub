# Third-Party Notices

This file describes the licensing boundary for Hikaru Sub and the major runtime components it may use. It does not change, replace, or sublicense any third-party license.

## Scope

The `LICENSE` file applies only to Hikaru Sub's original source code and is Apache License 2.0. Third-party code, binaries, Python packages, and model weights remain subject to their own licenses and notices.

Windows release packages include the verified `hikaru-asr-windows-x64-cpu-v2` Native runtime and the manifest of approved runtime download sources. They do **not** include FFmpeg, a Python sidecar/interpreter/environment, optional Python engines, or model weights.

The Native runtime's machine-readable inventory is shipped at `native-asr/windows-x64/cpu/licenses/THIRD-PARTY-NOTICES.json` together with each required license file. `native-asr/runtime/windows-x64-cpu-lock.json` locks the exact payload, source, hash, license, attribution, and Microsoft runtime terms identity. Any future change to those bytes requires a new closed-world verification and package audit.

This document records the persistent runtime components. A release also needs an inventory of the exact JavaScript and Rust dependency versions included in the application; `pnpm-lock.yaml` and `src-tauri/Cargo.lock` are the version sources for that inventory.

## Components distributed in the Native ASR runtime

| Component | License / terms | Source and notes |
| --- | --- | --- |
| [CTranslate2](https://github.com/OpenNMT/CTranslate2) 4.8.0 | MIT | Bundled as the CPU inference runtime. Exact source revision, DLL hash, imports, and license file are locked by `windows-x64-cpu-lock.json`. |
| [oneDNN](https://github.com/oneapi-src/oneDNN) 3.1.1 | Apache-2.0 | Linked into the locked CTranslate2 CPU runtime; source identity and notice are included in the runtime inventory. |
| [pocketfft](https://github.com/mreineck/pocketfft) `c90e55b…` | BSD-3-Clause | Used by the Native Whisper feature path; exact source/header identity and license are locked. |
| [nlohmann/json](https://github.com/nlohmann/json) 3.11.3 | MIT | Used by the independent worker protocol implementation; exact header/source identity is locked. |
| Rust tokenizer dependency graph (`tokenizers`, `onig`, `onig-sys`, and transitive crates) | Per-crate licenses recorded in the runtime inventory | The exact Cargo.lock SHA-256 and complete package/license list are shipped in `licenses/THIRD-PARTY-NOTICES.json`; required license texts are included in the runtime. |
| Microsoft Visual C++ Redistributable 14.50.35717 | Microsoft Visual C++ V14 Redistributable and Runtime 2026 terms | `msvcp140.dll`, `vcomp140.dll`, `vcruntime140.dll`, and `vcruntime140_1.dll` are bundled unchanged, excluded from Hikaru Sub's Apache-2.0 license, and governed by the included official `Microsoft-Visual-Cpp-V14-Runtime-2026-License.docx`. Official terms: <https://visualstudio.microsoft.com/license-terms/vs2026-ga-visualcpp-v14-redist-runtime/>; redistribution list: <https://aka.ms/vs/18/redistribution>. By using those files, Microsoft's included acceptance terms apply. |

## Managed but not bundled components

| Component | License / terms | Source and notes |
| --- | --- | --- |
| [FFmpeg](https://ffmpeg.org/) and ffprobe | The actual binary's license controls. FFmpeg builds enabled with GPL components such as `libx264` are GPL-2.0-or-later. | Hikaru Sub invokes FFmpeg as an independent process. For every managed archive, retain its exact version, SHA-256, license output (`ffmpeg -L`), archive distributor, corresponding source, patches, and build configuration. The configured archive URLs are in `src-tauri/resources/runtime-dependency-sources.json`. |
| [Systran Faster-Whisper conversions](https://huggingface.co/Systran) for `tiny`, `base`, `small`, `medium`, `large-v2`, and `large-v3` | MIT | Each supported model is downloaded independently on demand and never included in setup or portable packages. The bundled manifest locks its exact canonical repository, immutable revision, four required file sizes/SHA-256 values, attribution, and source URL. |
| [dropbox-dash/faster-whisper-large-v3-turbo](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo), revision `0a363e91…` | MIT | Canonical supported turbo conversion; downloaded on demand and governed by the same exact manifest/readiness contract. |

## Development and historical Python components not distributed

The repo-root `asr-service/` remains for development, historical engine research, and one stable release cycle of rollback evidence. None of the following is part of the current desktop release runtime:

| Component | License / terms | Source and notes |
| --- | --- | --- |
| [CPython](https://www.python.org/) 3.11 | Python Software Foundation License Version 2 | Historical managed interpreter metadata uses [python-build-standalone](https://github.com/astral-sh/python-build-standalone). If a future release distributes it again, its exact notices must be restored and audited. |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) Python implementation | MIT | `asr-service/engines/faster_whisper_model.py` vendors and modifies the faster-whisper 1.2.1 `generate_segments` loop from commit `65882eee9f5cdbeeb2d877f1131d48cf241b327d`; the development notice remains at `asr-service/LICENSE.faster-whisper`. The removed packaged template is no longer a license delivery path. |
| [FastAPI](https://github.com/fastapi/fastapi), [Pydantic](https://github.com/pydantic/pydantic), [Hugging Face Hub](https://github.com/huggingface/huggingface_hub), and [Uvicorn](https://github.com/Kludex/uvicorn) | MIT, MIT, Apache-2.0, and BSD-3-Clause respectively | Historical sidecar/API and model-download dependencies; not shipped in the Native CPU release. |
| [PyAV](https://github.com/PyAV-Org/PyAV) | BSD-3-Clause for PyAV; wheel-bundled native libraries retain their own licenses | A Python wheel can contain FFmpeg libraries. Audit exact wheels and source obligations before any future redistribution. |
| [NVIDIA NeMo](https://github.com/NVIDIA-NeMo/NeMo) | Apache-2.0 | Development-only Parakeet and ReazonSpeech profiles. |
| [PyTorch](https://github.com/pytorch/pytorch) and [torchaudio](https://github.com/pytorch/audio) | BSD-style | Development-only optional ASR profiles. CUDA wheels also carry separate NVIDIA redistribution terms. |
| [ReazonSpeech](https://github.com/reazon-research/reazonspeech) NeMo ASR decode algorithm | Apache-2.0 | Historical local timestamp/segment adapter; not part of the Native production route. |
| [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) and [Transformers](https://github.com/huggingface/transformers) | Apache-2.0 | Development-only profile pending an independent productization task. |
| [soynlp](https://github.com/lovit/soynlp) | Exact artifact license must be verified before redistribution | The optional Qwen3 dependency graph has conflicting published GPL-family identifiers; it must not be bundled until resolved. |
| [Silero VAD](https://github.com/snakers4/silero-vad) | MIT | Historical/development VAD inputs are not bundled, and Native VAD is not enabled in the current release. |

## Model repositories

Model cards and the license in each exact downloaded revision control use and redistribution. **No model weights are bundled.** The current production manifest enables exactly seven pinned Faster-Whisper revisions: `tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, and `large-v3-turbo`. Other engine rows remain development metadata for independent follow-up work.

| Model repository | License / obligation |
| --- | --- |
| [Systran/faster-whisper-tiny](https://huggingface.co/Systran/faster-whisper-tiny), [`base`](https://huggingface.co/Systran/faster-whisper-base), [`small`](https://huggingface.co/Systran/faster-whisper-small), [`medium`](https://huggingface.co/Systran/faster-whisper-medium), [`large-v2`](https://huggingface.co/Systran/faster-whisper-large-v2), and [`large-v3`](https://huggingface.co/Systran/faster-whisper-large-v3) | MIT |
| [dropbox-dash/faster-whisper-large-v3-turbo](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo) | MIT |
| [kotoba-tech/kotoba-whisper-v2.0-faster](https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-faster) | MIT |
| [nvidia/parakeet-tdt_ctc-0.6b-ja](https://huggingface.co/nvidia/parakeet-tdt_ctc-0.6b-ja) | CC-BY-4.0; preserve attribution, license link, and change indication when redistributing the model or an adaptation. |
| [Qwen/Qwen3-ASR-1.7B](https://huggingface.co/Qwen/Qwen3-ASR-1.7B) and [Qwen/Qwen3-ForcedAligner-0.6B](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B) | Apache-2.0 |
| [reazon-research/reazonspeech-nemo-v2](https://huggingface.co/reazon-research/reazonspeech-nemo-v2) | Apache-2.0 |

## Release-maintainer checklist

Before publishing a release that changes a runtime archive, managed dependency, or model revision:

1. Lock the exact artifact versions, bytes, hashes, source identities, and transitive dependency inventory.
2. Recheck the artifact's license and every bundled native library.
3. Update this notice and the packaged machine-readable inventory with every required attribution, NOTICE, source, and license material.
4. If the release distributes a GPL component, provide that component's corresponding source and satisfy its GPL obligations for that component.
5. Confirm the final setup and portable packages contain no undeclared runtime, model, Python, GPU/VAD, debug, or cache file.

Hikaru Sub and the names of third-party projects are their respective owners' trademarks. Their use here is descriptive only.
