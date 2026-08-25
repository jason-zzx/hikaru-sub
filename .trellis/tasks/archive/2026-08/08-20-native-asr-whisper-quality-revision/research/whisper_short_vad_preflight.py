from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

IDENTITY_START = "<!-- SHORT-PARITY-IDENTITY:BEGIN -->"
IDENTITY_END = "<!-- SHORT-PARITY-IDENTITY:END -->"
TASK_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TASK_ROOT.parents[3]
V5_LOCK = TASK_ROOT / "gpu-short-parity-bisect-lock-v5.md"
SHORT_AUDIO = REPO_ROOT / ".asr-benchmark" / "short.wav"
LOCAL_ROOT = (TASK_ROOT / "local").resolve()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def file_identity(path: Path, name: str) -> dict[str, Any]:
    return {
        "name": name,
        "sizeBytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def load_identity(lock_path: Path) -> tuple[dict[str, Any], str]:
    text = lock_path.read_text(encoding="utf-8")
    match = re.search(
        re.escape(IDENTITY_START) + r"\s*(\{.*?\})\s*" + re.escape(IDENTITY_END),
        text,
        re.DOTALL,
    )
    if match is None:
        raise ValueError("short parity lock identity is missing")
    return json.loads(match.group(1)), sha256_file(lock_path)


def load_selected_identity(
    lock_path: Path, audio_path: Path
) -> tuple[dict[str, Any], str]:
    if lock_path != V5_LOCK or audio_path != SHORT_AUDIO:
        raise ValueError("VAD preflight input path identity drifted")
    return load_identity(lock_path)


def require_identity(path: Path, expected: dict[str, Any], label: str) -> None:
    if (
        not path.is_file()
        or path.stat().st_size != expected.get("sizeBytes")
        or sha256_file(path) != expected.get("sha256")
    ):
        raise ValueError(f"{label} identity drifted")


def require_local_output(path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(LOCAL_ROOT):
        raise ValueError("VAD preflight output must stay below research/local")
    return resolved


def resolved_module_path(length: int, value: str) -> Path:
    if not length:
        raise ValueError("loaded module path is unavailable")
    return Path(value).resolve()


def loaded_process_module_paths() -> list[Path]:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    process = kernel32.GetCurrentProcess()
    psapi.EnumProcessModules.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_uint32,
        ctypes.POINTER(ctypes.c_uint32),
    ]
    psapi.EnumProcessModules.restype = ctypes.c_int
    modules = (ctypes.c_void_p * 4096)()
    needed = ctypes.c_uint32()
    if not psapi.EnumProcessModules(
        process, modules, ctypes.sizeof(modules), ctypes.byref(needed)
    ):
        raise ValueError("loaded module inventory is unavailable")
    if needed.value > ctypes.sizeof(modules):
        raise ValueError("loaded module inventory exceeded the closed buffer")
    psapi.GetModuleFileNameExW.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint32
    ]
    psapi.GetModuleFileNameExW.restype = ctypes.c_uint32
    found: set[Path] = set()
    for handle in modules[: needed.value // ctypes.sizeof(ctypes.c_void_p)]:
        buffer = ctypes.create_unicode_buffer(32768)
        length = psapi.GetModuleFileNameExW(process, handle, buffer, len(buffer))
        found.add(resolved_module_path(length, buffer.value))
    return sorted(found, key=lambda path: (path.name.lower(), path.as_posix().lower()))


def exact_ort_module_paths(module_paths: list[Path], capi_root: Path) -> list[Path]:
    relevant = [
        path for path in module_paths
        if path.name.lower().startswith("onnxruntime")
    ]
    if any(path.parent != capi_root for path in relevant):
        raise ValueError("loaded ONNX Runtime module root drifted")
    return sorted(relevant, key=lambda path: path.name.lower())


def frozen_module(path: Path, root_role: str) -> dict[str, Any]:
    return {**file_identity(path, path.name), "rootRole": root_role}


def build_result(
    identity: dict[str, Any],
    lock_sha256: str,
    runtime_files: list[dict[str, Any]],
    loaded_modules: list[dict[str, Any]],
    not_loaded_modules: list[dict[str, Any]],
    providers: list[str],
    intervals: list[dict[str, int]],
    waveform_sha256: str,
    post_vad_waveform_sha256: str,
    sample_count: int,
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "kind": "hikaru-whisper-short-vad-preflight",
        "status": "completed",
        "qualificationEligible": False,
        "promotionEligible": False,
        "candidateId": "short-input-runtime-parity-bisect-v1",
        "inputLockSha256": lock_sha256,
        "audio": {
            "wavSha256": identity["audio"]["wavSha256"],
            "sampleCount": sample_count,
            "waveformSha256": waveform_sha256,
            "postVadWaveformSha256": post_vad_waveform_sha256,
            "intervals": intervals,
        },
        "vad": {
            "algorithm": "faster-whisper-1.2.1-silero-v6-exact",
            "options": identity["vadPreflight"]["options"],
            "files": runtime_files,
        },
        "runtime": {
            "pythonVersion": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "onnxRuntimeVersion": identity["vadPreflight"]["onnxRuntimeVersion"],
            "providers": providers,
            "loadedModules": loaded_modules,
            "notLoadedModules": not_loaded_modules,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--input-lock", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    audio_path = Path(args.audio).resolve()
    lock_path = Path(args.input_lock).resolve()
    output_path = require_local_output(Path(args.output))
    identity, lock_sha = load_selected_identity(lock_path, audio_path)
    vad_identity = identity.get("vadPreflight")
    if not isinstance(vad_identity, dict):
        raise ValueError("VAD preflight identity is not frozen")

    site_packages = Path(sys.executable).resolve().parent.parent / "Lib" / "site-packages"
    paths = {
        "python.exe": Path(sys.executable).resolve(),
        "faster_whisper/audio.py": site_packages / "faster_whisper" / "audio.py",
        "faster_whisper/vad.py": site_packages / "faster_whisper" / "vad.py",
        "faster_whisper/assets/silero_vad_v6.onnx": site_packages / "faster_whisper" / "assets" / "silero_vad_v6.onnx",
        "onnxruntime/__init__.py": site_packages / "onnxruntime" / "__init__.py",
        "onnxruntime/capi/onnxruntime_pybind11_state.pyd": site_packages / "onnxruntime" / "capi" / "onnxruntime_pybind11_state.pyd",
        "onnxruntime/capi/onnxruntime.dll": site_packages / "onnxruntime" / "capi" / "onnxruntime.dll",
        "onnxruntime/capi/onnxruntime_providers_shared.dll": site_packages / "onnxruntime" / "capi" / "onnxruntime_providers_shared.dll",
    }
    expected_files = vad_identity.get("files")
    if not isinstance(expected_files, list):
        raise ValueError("VAD preflight file set is missing")
    expected_by_name = {item.get("name"): item for item in expected_files}
    if set(paths) != set(expected_by_name):
        raise ValueError("VAD preflight file set drifted")
    for name, path in paths.items():
        require_identity(path, expected_by_name[name], name)

    from faster_whisper.audio import decode_audio
    import faster_whisper.audio as audio_module
    from faster_whisper.utils import get_assets_path
    from faster_whisper.vad import collect_chunks, get_speech_timestamps, get_vad_model
    import faster_whisper.vad as vad_module
    import onnxruntime
    import onnxruntime.capi.onnxruntime_pybind11_state as ort_extension
    import numpy as np

    imported_paths = {
        "faster_whisper/audio.py": Path(audio_module.__file__).resolve(),
        "faster_whisper/vad.py": Path(vad_module.__file__).resolve(),
        "faster_whisper/assets/silero_vad_v6.onnx": Path(get_assets_path()).resolve() / "silero_vad_v6.onnx",
        "onnxruntime/__init__.py": Path(onnxruntime.__file__).resolve(),
        "onnxruntime/capi/onnxruntime_pybind11_state.pyd": Path(ort_extension.__file__).resolve(),
    }
    if any(imported_paths[name] != paths[name].resolve() for name in imported_paths):
        raise ValueError("imported VAD module root drifted")

    if sha256_file(audio_path) != identity["audio"]["wavSha256"]:
        raise ValueError("short WAV identity drifted")
    if onnxruntime.__version__ != vad_identity.get("onnxRuntimeVersion"):
        raise ValueError("ONNX Runtime version drifted")

    audio = decode_audio(str(audio_path), sampling_rate=16000)
    waveform_sha = hashlib.sha256(audio.tobytes()).hexdigest()
    intervals = get_speech_timestamps(audio)
    chunks, _ = collect_chunks(audio, intervals)
    retained = chunks[0] if len(chunks) == 1 else np.concatenate(chunks)
    post_vad_sha = hashlib.sha256(retained.tobytes()).hexdigest()
    providers = get_vad_model().session.get_providers()

    capi_root = (site_packages / "onnxruntime" / "capi").resolve()
    loaded_paths = exact_ort_module_paths(loaded_process_module_paths(), capi_root)
    loaded_modules = [
        frozen_module(path, "python-site-packages-onnxruntime-capi")
        for path in loaded_paths
    ]
    loaded_names = {module["name"].lower() for module in loaded_modules}
    not_loaded_paths = [
        paths["onnxruntime/capi/onnxruntime.dll"].resolve(),
    ]
    not_loaded_modules = [
        frozen_module(path, "python-site-packages-onnxruntime-capi")
        for path in not_loaded_paths
    ]
    if any(path.name.lower() in loaded_names for path in not_loaded_paths):
        raise ValueError("forbidden sibling ONNX Runtime module is loaded")
    result = build_result(
        identity,
        lock_sha,
        [file_identity(paths[name], name) for name in sorted(paths)],
        loaded_modules,
        not_loaded_modules,
        providers,
        intervals,
        waveform_sha,
        post_vad_sha,
        int(audio.shape[0]),
    )

    expected_interval = identity["audio"]["vadExpectedInterval"]
    if (
        intervals != [{"start": expected_interval[0], "end": expected_interval[1]}]
        or waveform_sha != identity["audio"]["waveformSha256"]
        or post_vad_sha != identity["audio"]["waveformSha256"]
        or int(audio.shape[0]) != identity["audio"]["sampleCount"]
        or providers != ["CPUExecutionProvider"]
        or loaded_modules != vad_identity["loadedModules"]
        or not_loaded_modules != vad_identity["notLoadedModules"]
    ):
        raise ValueError("Python VAD preflight result drifted")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(output_path)
    print(json.dumps({"status": "completed", "modelLoaded": False}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
