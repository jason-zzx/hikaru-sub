#!/usr/bin/env python3
"""Run the frozen ReazonSpeech R2 source-only ctypes oracle."""

from __future__ import annotations

import argparse
from array import array
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
import wave

TASK_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = TASK_ROOT.parents[2]
LOCAL_ROOT = (TASK_ROOT / "research" / "local").resolve()
ORACLE_ROOT = (LOCAL_ROOT / "oracle").resolve()
CANDIDATE_ID = "R2-vad12-pad30-overlap-top-level-v1"
INPUT_SCHEMA = "hikaru-reazonspeech-r2-oracle-input-v2"
RAW_SCHEMA = "hikaru-reazonspeech-r2-oracle-raw-v2"
EXPECTED_CONFIG_SHA256 = "57c67b622ab019ac18a82a5076799a3ee6b603920d425859ebd3b4e53dfcafef"
EXPECTED = {
    "manifest": (2868, "3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea"),
    "comparator": (101313, "b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822"),
    "protocolLimits": (262, "435c4eb649dc7e8939c38fc0eb778d2428bf2646a028abfe636c62f43302b464"),
    "library": (11414528, "824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e"),
    "model": (667147072, "20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2"),
    "vad": (885098, "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987"),
    "short-v1": (771728, "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211"),
    "medium-v1": (15963982, "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458"),
}
SOURCE_FILES = {
    "include/crispasr_session.h": (51717, "cdefd19f6f208ed3f77f31c1cc8df19224c1c81ed5e0e6064650a827000c68df"),
    "include/crispasr.h": (51699, "38e3a7c28e4dda33bf2705a0d94b0414f00cba434927360a62cb091aecca2ce4"),
    "src/crispasr_c_api.cpp": (447974, "f0d34b18a10c54d1c6d05904eedde12cc1b8c61764f6c3f6c444cd4511bf6855"),
    "src/crispasr_vad.cpp": (29182, "f8b33e943669786c46e187bff056b46198bede5937d527093b7061a7eac90c3c"),
    "src/crispasr_vad.h": (10765, "b571654992c7bf5a3ea39bc7cf8305b8bd7d3175580b3b2f20908868c1ac8ff1"),
    "src/parakeet_orchestrate.cpp": (13016, "ac1b9b7c91b03cd02d6c619dace32f6151a97d2240bc162c67334b521040335b"),
    "src/parakeet_orchestrate.h": (5972, "70a95bef4c5aec0dd794c4e135805e98bf114cd6d114782a260cdadaf6167cb6"),
    "examples/cli/crispasr_backend_parakeet.cpp": (10667, "0ada96582ca2d878ee3c894c0d0954122ee00315505df0fe0b79e95aaeb15780"),
}
RUNTIME_MODULES = {
    "crispasr.dll": (11414528, "824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e"),
    "ggml-base.dll": (628224, "728a10b11f0bc29588f718b94e32984b322b587b154ef18e6f6f31d8cd2f0368"),
    "ggml-cpu.dll": (889344, "0182b8c87b076dbdf1f7c082bebf43aaff724f4b15dd281820e5e2be939e67cd"),
    "ggml-cuda.dll": (51625472, "a75099a7e622282dae28451327c682bd17df147728c9c009b9f44eb3f1c99fa2"),
    "ggml.dll": (67072, "a1cc4c81000735eb4c167926b492e07ba49d03eb6f47a70d3fe2a0b30f648478"),
    "cublas64_12.dll": (113716224, "9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99"),
    "cublaslt64_12.dll": (674667520, "b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7"),
    "cudart64_12.dll": (573952, "c2c9a9c22a9bcba90e261825968836787b331038047a26770cffb7a583c28344"),
    "nvcuda.dll": (4466920, "ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c"),
}
VAD = {"threshold": 0.5, "minSpeechMs": 250, "minSilenceMs": 100, "speechPadMs": 30,
       "coreMaxSliceDurationMs": 12000}
SAMPLE_RATE = 16000
CORE_MAX_SLICE_SAMPLES = 12 * SAMPLE_RATE
PADDED_MAX_WINDOW_MS = 12060
PADDED_MAX_WINDOW_SAMPLES = round(PADDED_MAX_WINDOW_MS * SAMPLE_RATE / 1000)
MAX_ADJACENT_OVERLAP_MS = 60
MAX_ADJACENT_OVERLAP_SAMPLES = round(MAX_ADJACENT_OVERLAP_MS * SAMPLE_RATE / 1000)
WINDOW_POLICY = {
    "coreMaxSliceDurationMs": 12000,
    "paddedMaxInferenceWindowMs": PADDED_MAX_WINDOW_MS,
    "maximumAdjacentPaddingOverlapMs": MAX_ADJACENT_OVERLAP_MS,
    "overlapPolicy": "abi-final-speech-padding-only-adjacent-v1",
    "monotonicStarts": True,
    "monotonicEnds": True,
    "nonAdjacentOverlap": False,
}
PARAKEET_STRATEGY_POLICY = {
    "clearedEnvironmentPrefix": "CRISPASR_PARAKEET_",
    "setEnvironment": {
        "CRISPASR_PARAKEET_STREAM_THRESHOLD": "13",
        "CRISPASR_SESSION_UNIFIED_DISPATCH": "0",
    },
    "legacyInlineDispatch": True,
    "singlePassThresholdSeconds": 13,
    "singlePassThresholdSamples": 13 * SAMPLE_RATE,
    "maximumPaddedInferenceWindowSamples": PADDED_MAX_WINDOW_SAMPLES,
    "sessionSelection": "pinned-session-c-api-direct-parakeet_transcribe_ex-v1",
    "reactiveStreamedFallback": False,
}
EXPECTED_DEVICE = {"index": 0, "name": "NVIDIA GeForce RTX 3070", "computeCapability": "8.6", "driverApiVersion": 13020}


class OpenParams(ctypes.Structure):
    _fields_ = [("abi_version", ctypes.c_int), ("n_threads", ctypes.c_int), ("use_gpu", ctypes.c_int),
                ("verbosity", ctypes.c_int), ("flash_attn", ctypes.c_int), ("n_gpu_layers", ctypes.c_int),
                ("reserved", ctypes.c_int * 6)]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def identity(path: Path) -> dict[str, object]:
    return {"sizeBytes": path.stat().st_size, "sha256": sha256(path)}


def require_identity(path: Path, expected: tuple[int, str], label: str) -> None:
    if not path.is_file() or (path.stat().st_size, sha256(path)) != expected:
        raise RuntimeError(f"{label} identity drifted")


def require_contained(path: Path, root: Path, label: str) -> None:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError as error:
        raise RuntimeError(f"{label} escapes its approved root") from error


def require_ignored(path: Path) -> None:
    result = subprocess.run(["git", "check-ignore", "-q", str(path)], cwd=REPO_ROOT, check=False)
    if result.returncode != 0:
        raise RuntimeError("oracle private output is not ignored")


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def load_config(path: Path) -> dict[str, object]:
    require_contained(path, LOCAL_ROOT, "config")
    require_ignored(path)
    if sha256(path) != EXPECTED_CONFIG_SHA256:
        raise RuntimeError("oracle input config identity drifted")
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema") != INPUT_SCHEMA or value.get("candidateId") != CANDIDATE_ID:
        raise RuntimeError("oracle input schema/candidate drifted")
    if value.get("vad") != VAD or value.get("windowPolicy") != WINDOW_POLICY \
            or value.get("strategyPolicy") != PARAKEET_STRATEGY_POLICY \
            or value.get("openParams") != {"abiVersion": 2, "threads": 16, "useGpu": 1, "nGpuLayers": -1, "gpuBackend": "cuda"}:
        raise RuntimeError("oracle algorithm/runtime parameters drifted")
    paths = value.get("paths")
    if not isinstance(paths, dict):
        raise RuntimeError("oracle paths are missing")
    return value


def configured_paths(config: dict[str, object]) -> dict[str, Path]:
    return {key: Path(value).resolve() for key, value in config["paths"].items() if isinstance(value, str)}


def verify_inputs(config: dict[str, object], case_id: str) -> dict[str, Path]:
    paths = configured_paths(config)
    for key in ("manifest", "comparator", "library", "model", "vad", "sourceRoot", "runtimeRoot", "cudaRoot", "systemRoot"):
        if key not in paths:
            raise RuntimeError(f"missing configured path: {key}")
    require_identity(paths["manifest"], EXPECTED["manifest"], "manifest")
    require_identity(paths["comparator"], EXPECTED["comparator"], "comparator")
    require_identity(REPO_ROOT / "native-asr" / "protocol-v1-limits.json", EXPECTED["protocolLimits"], "protocol-v1 limits")
    require_identity(paths["library"], EXPECTED["library"], "CrispASR runtime")
    require_identity(paths["model"], EXPECTED["model"], "ReazonSpeech model")
    require_identity(paths["vad"], EXPECTED["vad"], "Silero VAD")
    require_contained(paths["library"], paths["runtimeRoot"], "runtime")
    require_contained(paths["model"], Path(config["approvedRoots"]["t10Local"]), "model")
    require_contained(paths["vad"], LOCAL_ROOT, "VAD")
    require_contained(paths["sourceRoot"], Path(config["approvedRoots"]["crispasrPocLocal"]), "source")
    for relative, expected in SOURCE_FILES.items():
        require_identity(paths["sourceRoot"] / relative, expected, f"pinned source {relative}")
    audio_key = f"audio:{case_id}"
    if audio_key not in paths:
        raise RuntimeError(f"missing configured audio: {case_id}")
    require_identity(paths[audio_key], EXPECTED[case_id], f"{case_id} audio")
    require_contained(paths[audio_key], Path(config["approvedRoots"]["t10Local"]), "audio")
    for name, expected in RUNTIME_MODULES.items():
        if name == "nvcuda.dll":
            path = paths["systemRoot"] / name
        else:
            path = paths["runtimeRoot"] / name
        require_identity(path, expected, f"runtime module {name}")
    return paths


def read_pcm(path: Path) -> tuple[array, int]:
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, 16000, "NONE"):
            raise RuntimeError("audio is not 16 kHz mono PCM16")
        frames = audio.readframes(audio.getnframes())
    pcm16 = array("h")
    pcm16.frombytes(frames)
    if sys.byteorder != "little":
        pcm16.byteswap()
    pcm = array("f", (sample / 32768.0 for sample in pcm16))
    return pcm, round(len(pcm) * 1000 / 16000)


def bind_api(library: Path):
    lib = ctypes.WinDLL(str(library))
    lib.crispasr_set_gpu_backend.argtypes = [ctypes.c_char_p]
    lib.crispasr_set_gpu_backend.restype = None
    lib.crispasr_session_open_with_params.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.POINTER(OpenParams)]
    lib.crispasr_session_open_with_params.restype = ctypes.c_void_p
    lib.crispasr_session_backend.argtypes = [ctypes.c_void_p]
    lib.crispasr_session_backend.restype = ctypes.c_char_p
    lib.crispasr_session_transcribe_lang.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_float), ctypes.c_int, ctypes.c_char_p]
    lib.crispasr_session_transcribe_lang.restype = ctypes.c_void_p
    lib.crispasr_session_result_n_segments.argtypes = [ctypes.c_void_p]
    lib.crispasr_session_result_n_segments.restype = ctypes.c_int
    lib.crispasr_session_result_segment_text.argtypes = [ctypes.c_void_p, ctypes.c_int]
    lib.crispasr_session_result_segment_text.restype = ctypes.c_char_p
    lib.crispasr_session_result_segment_t0.argtypes = [ctypes.c_void_p, ctypes.c_int]
    lib.crispasr_session_result_segment_t0.restype = ctypes.c_int64
    lib.crispasr_session_result_segment_t1.argtypes = [ctypes.c_void_p, ctypes.c_int]
    lib.crispasr_session_result_segment_t1.restype = ctypes.c_int64
    lib.crispasr_session_result_free.argtypes = [ctypes.c_void_p]
    lib.crispasr_session_result_free.restype = None
    lib.crispasr_session_close.argtypes = [ctypes.c_void_p]
    lib.crispasr_session_close.restype = None
    lib.crispasr_vad_slices.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_float), ctypes.c_int, ctypes.c_int,
                                        ctypes.c_float, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_float,
                                        ctypes.c_int, ctypes.POINTER(ctypes.POINTER(ctypes.c_float))]
    lib.crispasr_vad_slices.restype = ctypes.c_int
    lib.crispasr_vad_free.argtypes = [ctypes.POINTER(ctypes.c_float)]
    lib.crispasr_vad_free.restype = None
    return lib


def cuda_device() -> dict[str, object]:
    cuda = ctypes.WinDLL("nvcuda.dll")
    cuda.cuInit.argtypes = [ctypes.c_uint]
    cuda.cuInit.restype = ctypes.c_int
    cuda.cuDeviceGet.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_int]
    cuda.cuDeviceGet.restype = ctypes.c_int
    cuda.cuDeviceGetName.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
    cuda.cuDeviceGetName.restype = ctypes.c_int
    cuda.cuDeviceComputeCapability.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.c_int]
    cuda.cuDeviceComputeCapability.restype = ctypes.c_int
    cuda.cuDriverGetVersion.argtypes = [ctypes.POINTER(ctypes.c_int)]
    cuda.cuDriverGetVersion.restype = ctypes.c_int
    device = ctypes.c_int()
    major, minor, version = ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
    name = ctypes.create_string_buffer(256)
    calls = [cuda.cuInit(0), cuda.cuDeviceGet(ctypes.byref(device), 0),
             cuda.cuDeviceGetName(name, len(name), device.value),
             cuda.cuDeviceComputeCapability(ctypes.byref(major), ctypes.byref(minor), device.value),
             cuda.cuDriverGetVersion(ctypes.byref(version))]
    if any(calls):
        raise RuntimeError("CUDA device attestation failed")
    value = {"index": device.value, "name": name.value.decode("utf-8", "strict"),
             "computeCapability": f"{major.value}.{minor.value}", "driverApiVersion": version.value}
    if value != EXPECTED_DEVICE:
        raise RuntimeError("CUDA development device identity drifted")
    return value


def loaded_required_modules(paths: dict[str, Path]) -> list[dict[str, object]]:
    psapi = ctypes.WinDLL("psapi.dll")
    kernel32 = ctypes.WinDLL("kernel32.dll")
    psapi.EnumProcessModules.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.c_uint32, ctypes.POINTER(ctypes.c_uint32)]
    psapi.EnumProcessModules.restype = ctypes.c_int
    psapi.GetModuleFileNameExW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint32]
    psapi.GetModuleFileNameExW.restype = ctypes.c_uint32
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    process = kernel32.GetCurrentProcess()
    capacity = 256
    while True:
        modules = (ctypes.c_void_p * capacity)()
        needed = ctypes.c_uint32()
        if not psapi.EnumProcessModules(process, modules, ctypes.sizeof(modules), ctypes.byref(needed)):
            raise RuntimeError("loaded module enumeration failed")
        if needed.value <= ctypes.sizeof(modules):
            break
        capacity = needed.value // ctypes.sizeof(ctypes.c_void_p) + 16
    found: dict[str, Path] = {}
    for module in modules[:needed.value // ctypes.sizeof(ctypes.c_void_p)]:
        buffer = ctypes.create_unicode_buffer(32768)
        length = psapi.GetModuleFileNameExW(process, module, buffer, len(buffer))
        if length:
            path = Path(buffer.value).resolve()
            key = path.name.lower()
            if key in RUNTIME_MODULES:
                found[key] = path
    if set(found) != set(RUNTIME_MODULES):
        raise RuntimeError("required loaded module set is incomplete")
    rows = []
    for name in sorted(found):
        path = found[name]
        expected = RUNTIME_MODULES[name]
        require_identity(path, expected, f"loaded module {name}")
        role = "runtime-bin" if name != "nvcuda.dll" else "system32"
        root = paths["runtimeRoot"] if role == "runtime-bin" else paths["systemRoot"]
        require_contained(path, root, f"loaded module {name}")
        rows.append({"name": path.name, "rootRole": role, "identity": identity(path)})
    return rows


def configure_dll_search(paths: dict[str, Path]) -> list[object]:
    ordered = [paths["runtimeRoot"], paths["cudaRoot"], paths["systemRoot"]]
    if not all(path.is_dir() for path in ordered):
        raise RuntimeError("restricted PATH root is unavailable")
    os.environ["PATH"] = os.pathsep.join(map(str, ordered))
    return [os.add_dll_directory(str(path)) for path in ordered]


def configure_parakeet_strategy_environment() -> dict[str, object]:
    prefix = PARAKEET_STRATEGY_POLICY["clearedEnvironmentPrefix"]
    for name in list(os.environ):
        if name.upper().startswith(prefix):
            del os.environ[name]
    os.environ.update(PARAKEET_STRATEGY_POLICY["setEnvironment"])
    require_parakeet_single_pass_environment(PADDED_MAX_WINDOW_SAMPLES)
    return PARAKEET_STRATEGY_POLICY


def require_parakeet_single_pass_environment(sample_count: int) -> None:
    actual = {name.upper(): value for name, value in os.environ.items()
              if name.upper().startswith("CRISPASR_PARAKEET_") or name.upper() == "CRISPASR_SESSION_UNIFIED_DISPATCH"}
    if actual != PARAKEET_STRATEGY_POLICY["setEnvironment"]:
        raise RuntimeError("CrispASR Parakeet strategy environment drifted")
    if not isinstance(sample_count, int) or isinstance(sample_count, bool) or sample_count <= 0 \
            or sample_count > PADDED_MAX_WINDOW_SAMPLES \
            or sample_count > PARAKEET_STRATEGY_POLICY["singlePassThresholdSamples"]:
        raise RuntimeError("slice cannot be guaranteed to use the pinned exact single-pass path")


def run(config_path: Path, case_id: str, output: Path) -> dict[str, object]:
    if case_id not in ("short-v1", "medium-v1"):
        raise RuntimeError("oracle supports only short-v1 and medium-v1")
    require_contained(output, ORACLE_ROOT, "output")
    require_ignored(output)
    config = load_config(config_path)
    paths = verify_inputs(config, case_id)
    pcm, duration_ms = read_pcm(paths[f"audio:{case_id}"])
    pcm_buffer = (ctypes.c_float * len(pcm)).from_buffer(pcm)
    dll_handles = configure_dll_search(paths)
    strategy_policy = configure_parakeet_strategy_environment()
    lib = bind_api(paths["library"])
    lib.crispasr_set_gpu_backend(b"cuda")
    params = OpenParams(2, 16, 1, 0, 0, -1, (ctypes.c_int * 6)(0, 0, 0, 0, 0, 0))
    session = lib.crispasr_session_open_with_params(os.fsencode(paths["model"]), b"parakeet", ctypes.byref(params))
    if not session:
        raise RuntimeError("CrispASR session open failed")
    try:
        if lib.crispasr_session_backend(session) != b"parakeet":
            raise RuntimeError("CrispASR opened backend drifted")
        device = cuda_device()
        modules = loaded_required_modules(paths)
        spans = ctypes.POINTER(ctypes.c_float)()
        started = time.perf_counter()
        count = lib.crispasr_vad_slices(os.fsencode(paths["vad"]), pcm_buffer, len(pcm), 16000, ctypes.c_float(0.5),
                                        250, 100, 30, ctypes.c_float(12.0), 16, ctypes.byref(spans))
        vad_ms = (time.perf_counter() - started) * 1000
        if count <= 0 or not spans:
            raise RuntimeError(f"CrispASR VAD returned no usable slices: {count}")
        try:
            raw_spans = [(float(spans[2 * index]), float(spans[2 * index + 1])) for index in range(count)]
        finally:
            lib.crispasr_vad_free(spans)
        windows = []
        previous_start_ms = -1
        previous_end_ms = -1
        two_back_end_ms = -1
        samples_per_ms = SAMPLE_RATE // 1000
        if SAMPLE_RATE % 1000:
            raise RuntimeError("sample rate cannot represent integer milliseconds")
        for index, (start_s, end_s) in enumerate(raw_spans):
            if not math.isfinite(start_s) or not math.isfinite(end_s):
                raise RuntimeError("VAD returned non-finite timing")
            start_ms = round(start_s * 1000)
            end_ms = round(end_s * 1000)
            start_sample = start_ms * samples_per_ms
            end_sample = end_ms * samples_per_ms
            duration = end_ms - start_ms
            overlap_ms = max(0, previous_end_ms - start_ms) if index else 0
            if start_sample < 0 or end_sample <= start_sample or end_sample > len(pcm):
                raise RuntimeError(f"VAD window {index} is outside the verified audio")
            if index and (start_ms <= previous_start_ms or end_ms <= previous_end_ms):
                raise RuntimeError(f"VAD window {index} starts/ends are not monotonic")
            if overlap_ms > MAX_ADJACENT_OVERLAP_MS:
                raise RuntimeError(f"VAD window {index} exceeds the native padding-overlap bound")
            if index > 1 and start_ms < two_back_end_ms:
                raise RuntimeError(f"VAD window {index} overlaps a non-adjacent window")
            if duration > PADDED_MAX_WINDOW_MS or end_sample - start_sample > PADDED_MAX_WINDOW_SAMPLES:
                raise RuntimeError(f"VAD window {index} exceeds the padded inference cap")
            windows.append({"index": index, "startSample": start_sample, "endSample": end_sample,
                            "startMs": start_ms, "endMs": end_ms, "durationMs": duration,
                            "overlapWithPreviousMs": overlap_ms})
            two_back_end_ms, previous_start_ms, previous_end_ms = previous_end_ms, start_ms, end_ms
        common = {
            "schema": RAW_SCHEMA, "candidateId": config["candidateId"],
            "caseId": case_id, "configSha256": EXPECTED_CONFIG_SHA256, "audio": identity(paths[f"audio:{case_id}"]),
            "runtime": {"library": identity(paths["library"]), "model": identity(paths["model"]), "vad": identity(paths["vad"]),
                        "openParams": config["openParams"], "resolvedBackend": "parakeet", "device": device,
                        "pathPolicy": {"policy": "runtime-cuda12.8-system32-v1", "orderedRootRoles": ["runtime-bin", "cuda-bin", "system32"]},
                        "loadedModules": modules},
            "algorithm": {"apiOrder": ["crispasr_vad_slices", "crispasr_session_transcribe_lang-per-slice"], "vad": VAD,
                          "windowPolicy": WINDOW_POLICY, "strategyPolicy": strategy_policy,
                          "stitching": False, "gapFill": False, "ownershipRewrite": False, "dedup": False,
                          "decoderSearch": False, "punctuationPostProcessing": False, "referenceRepair": False},
            "durationMs": duration_ms, "vadWindowCount": len(windows),
            "maximumWindowDurationMs": max(window["durationMs"] for window in windows),
            "maximumAdjacentOverlapMs": max(window["overlapWithPreviousMs"] for window in windows), "windows": windows,
        }
        calls = []
        inference_ms = 0.0
        for window in windows:
            sample_count = window["endSample"] - window["startSample"]
            require_parakeet_single_pass_environment(sample_count)
            pointer = ctypes.cast(ctypes.byref(pcm_buffer, window["startSample"] * ctypes.sizeof(ctypes.c_float)), ctypes.POINTER(ctypes.c_float))
            started = time.perf_counter()
            result = lib.crispasr_session_transcribe_lang(session, pointer, sample_count, b"ja")
            inference_ms += (time.perf_counter() - started) * 1000
            if not result:
                raise RuntimeError(f"transcribe_lang returned null for slice {window['index']}")
            try:
                segment_count = lib.crispasr_session_result_n_segments(result)
                if segment_count != 1:
                    raise RuntimeError(f"slice {window['index']} returned {segment_count} top-level segments")
                text_ptr = lib.crispasr_session_result_segment_text(result, 0)
                if not text_ptr:
                    raise RuntimeError(f"slice {window['index']} returned null text")
                text = text_ptr.decode("utf-8", "strict")
                start_cs = int(lib.crispasr_session_result_segment_t0(result, 0))
                end_cs = int(lib.crispasr_session_result_segment_t1(result, 0))
                local_duration_ms = window["endMs"] - window["startMs"]
                if not text or start_cs < 0 or end_cs <= start_cs or end_cs * 10 > local_duration_ms:
                    raise RuntimeError(f"slice {window['index']} returned an illegal top-level result")
                calls.append({"index": window["index"], "windowStartMs": window["startMs"], "windowEndMs": window["endMs"],
                              "sourceSegmentCount": 1, "result": {"text": text,
                              "startMs": window["startMs"] + start_cs * 10,
                              "endMs": window["startMs"] + end_cs * 10}})
            finally:
                lib.crispasr_session_result_free(result)
        if len(calls) != len(windows):
            raise RuntimeError("transcribe call count differs from VAD window count")
        final_segments = [call["result"] for call in calls]
        raw = dict(common, status="completed", transcribeCallCount=len(calls), calls=calls,
                   finalSegments=final_segments, timings={"vadMs": vad_ms, "inferenceMs": inference_ms})
        atomic_json(output, raw)
        return raw
    finally:
        lib.crispasr_session_close(session)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--case", choices=("short-v1", "medium-v1"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = run(args.config.resolve(), args.case, args.output.resolve())
        print(json.dumps({"caseId": args.case, "status": result["status"], "vadWindowCount": result["vadWindowCount"],
                          "maximumWindowDurationMs": result["maximumWindowDurationMs"]}, sort_keys=True))
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"R2 oracle rejected: {error}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
