#!/usr/bin/env python3
"""Prepare and acquire one frozen ReazonSpeech R2 worker attempt."""

from __future__ import annotations

import argparse
from array import array
import ctypes
from ctypes import wintypes
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import wave
from typing import Any

from run_r2_oracle import (
    EXPECTED_DEVICE,
    MAX_ADJACENT_OVERLAP_MS,
    MAX_ADJACENT_OVERLAP_SAMPLES,
    PADDED_MAX_WINDOW_MS,
    PADDED_MAX_WINDOW_SAMPLES,
    SAMPLE_RATE,
    bind_api,
    cuda_device,
)

TASK_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = TASK_ROOT.parents[2]
RESEARCH_ROOT = TASK_ROOT / "research"
LOCAL_ROOT = RESEARCH_ROOT / "local"
FORMAL_ROOT = LOCAL_ROOT / "formal"
RUNTIME_ROOT = FORMAL_ROOT / "runtime"
MODEL_ROOT = FORMAL_ROOT / "models"
AUDIO_ROOT = FORMAL_ROOT / "audio"
RAW_ROOT = FORMAL_ROOT / "raw"
STDERR_ROOT = FORMAL_ROOT / "stderr"
BUILD_BIN = LOCAL_ROOT / "build" / "windows-x64-r2-worker" / "bin"
T10_LOCAL = REPO_ROOT / ".trellis" / "tasks" / "archive" / "2026-08" / "08-13-native-asr-parakeet-reazon" / "08-13-native-asr-parakeet-reazon" / "research" / "local"
T10_RUNTIME = T10_LOCAL / "runtime"
INPUT_LOCK = RESEARCH_ROOT / "r2-input-lock.md"
MANIFEST = REPO_ROOT / ".asr-benchmark" / "manifest.json"
COMPARATOR = REPO_ROOT / "scripts" / "asr-benchmark.py"
PROTOCOL_LIMITS = REPO_ROOT / "native-asr" / "protocol-v1-limits.json"
PUBLISHER = RESEARCH_ROOT / "publish_reazonspeech_r2.py"
ORACLE = RESEARCH_ROOT / "run_r2_oracle.py"
PROTOCOL_HEADER = REPO_ROOT / "native-asr" / "include" / "hikaru_asr" / "protocol.hpp"
PROTOCOL_SOURCE = REPO_ROOT / "native-asr" / "src" / "protocol.cpp"
CANDIDATE_ID = "R2-vad12-pad30-overlap-top-level-v1"
RAW_SCHEMA = "hikaru-reazonspeech-r2-worker-attempt-v1"
INDEX_SCHEMA = "hikaru-reazonspeech-r2-raw-index-v1"
PATH_POLICY = "task-runtime-cuda12.8-system32-v1"
TRACE_SCHEMA = "hikaru-reazonspeech-r2-worker-trace-v1"
TRACE_PREFIX = b"hikaru_r2_evidence:"
TOOL_LOCK_BEGIN = "<!-- R2_FORMAL_TOOL_IDENTITIES_BEGIN -->"
TOOL_LOCK_END = "<!-- R2_FORMAL_TOOL_IDENTITIES_END -->"
TOOL_PATHS = {
    "research/run_r2_oracle.py": ORACLE,
    "research/run_reazonspeech_r2.py": Path(__file__).resolve(),
    "research/publish_reazonspeech_r2.py": PUBLISHER,
    "native-asr/include/hikaru_asr/protocol.hpp": PROTOCOL_HEADER,
    "native-asr/src/protocol.cpp": PROTOCOL_SOURCE,
    "native-asr/protocol-v1-limits.json": PROTOCOL_LIMITS,
    "scripts/asr-benchmark.py": COMPARATOR,
}
DEVICE_SELECTION_ENVIRONMENT = {
    "CUDA_DEVICE_ORDER": "PCI_BUS_ID",
    "CUDA_VISIBLE_DEVICES": "0",
    "GPU_DEVICE_ORDINAL": "",
    "HIP_VISIBLE_DEVICES": "",
    "NVIDIA_VISIBLE_DEVICES": "",
}
VALID_CANDIDATE_FAILURES = {
    "crispasr_model_load_failed": {"pre-ready"},
    "crispasr_vad_failed": {"vad"},
    "crispasr_vad_no_result": {"vad"},
    "crispasr_vad_result_invalid": {"vad"},
    "crispasr_transcribe_failed": {"transcribe"},
    "crispasr_result_invalid": {"transcribe"},
    "crispasr_window_invalid": {"transcribe"},
    "parakeet_family_invalid_input": {"policy"},
    "parakeet_family_empty_output": {"policy"},
    "parakeet_family_text_conservation": {"policy"},
    "parakeet_family_cue_limit": {"policy"},
    "invalid_segment": {"protocol"},
    "invalid_segment_order": {"protocol"},
    "replacement_too_large": {"protocol"},
    "event_line_too_large": {"protocol"},
}
CUDA_ROOT = Path(r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin")
SYSTEM32 = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32"

CASES = {
    "short-v1": ("short.wav", 771_728, "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211", 24_102),
    "medium-v1": ("medium.wav", 15_963_982, "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458", 498_872),
    "long-v2": ("long.wav", 132_615_588, "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e", 4_144_235),
}
EXPECTED_ROLES = {
    "short-v1": {("cold", 0), ("warm", 1), ("warm", 2), ("warm", 3)},
    "medium-v1": {("measured", 0)},
    "long-v2": {("measured", 0)},
}
STATIC_IDENTITIES = {
    "manifest": (2_868, "3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea"),
    "comparator": (101_313, "b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822"),
    "protocolLimits": (262, "435c4eb649dc7e8939c38fc0eb778d2428bf2646a028abfe636c62f43302b464"),
    "worker": (623_616, "e86c199e8a01cfead31d36f34d576fe89be52e0fd6f3d29163383ee94023c274"),
    "model": (667_147_072, "20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2"),
    "vad": (885_098, "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987"),
}
SOURCE_IDENTITIES = {
    "native-asr/CMakeLists.txt": (28_548, "f17609595baee3a02fd40a2a5cd2b0d574cf3fbb03586e779f187b27db7340c5"),
    "native-asr/src/crispasr_backend.hpp": (3_259, "fc190fa5879894edc150cad1dd4a70fccf0fba923fc79dbabe36758979286264"),
    "native-asr/src/crispasr_backend.cpp": (38_019, "c16f60e102481b112e2c8800178319ae4eec678babc5a3b91e71e88009a15860"),
    "native-asr/src/parakeet_family_policy.hpp": (768, "6cb11b8d5147b74bdbd435816667b1d75df6683fe6512f81b57fd5a86b3f7f8f"),
    "native-asr/src/parakeet_family_policy.cpp": (9_397, "2821024d48361a0362531c2d8764e72c2092d06067a62af5e4a7a17e8dfda35f"),
    "native-asr/src/main.cpp": (22_141, "c0440ec5ae31dc6be836b2d40b8941a5f17dab6206bfea8100b734e674832e42"),
}
RUNTIME_IDENTITIES = {
    "crispasr.dll": (11_414_528, "824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e"),
    "ctranslate2.dll": (22_387_712, "d64a00675e180fea28b3561ab749325df1586b618589842d481a5f0c4d71e82e"),
    "cublas64_12.dll": (113_716_224, "9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99"),
    "cublaslt64_12.dll": (674_667_520, "b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7"),
    "cudart64_12.dll": (573_952, "c2c9a9c22a9bcba90e261825968836787b331038047a26770cffb7a583c28344"),
    "ggml-base.dll": (628_224, "728a10b11f0bc29588f718b94e32984b322b587b154ef18e6f6f31d8cd2f0368"),
    "ggml-cpu.dll": (889_344, "0182b8c87b076dbdf1f7c082bebf43aaff724f4b15dd281820e5e2be939e67cd"),
    "ggml-cuda.dll": (51_625_472, "a75099a7e622282dae28451327c682bd17df147728c9c009b9f44eb3f1c99fa2"),
    "ggml.dll": (67_072, "a1cc4c81000735eb4c167926b492e07ba49d03eb6f47a70d3fe2a0b30f648478"),
    "hikaru_asr_tokenizer.dll": (2_139_136, "6a4c575ab8c3d94840d9a71005053ea40bee5632662f66214f9985fff6dc57e3"),
    "onnxruntime.dll": (15_809_848, "18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257"),
    "onnxruntime_providers_shared.dll": (21_856, "599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8"),
}
REQUIRED_LOADED_RUNTIME_IDENTITIES = {
    name: expected for name, expected in RUNTIME_IDENTITIES.items()
    if name != "onnxruntime_providers_shared.dll"
}
SYSTEM_MODULE_IDENTITIES = {
    "nvcuda.dll": (4_466_920, "ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c"),
}
ALGORITHM = {
    "candidateId": CANDIDATE_ID,
    "vad": {"threshold": 0.5, "minSpeechMs": 250, "minSilenceMs": 100, "speechPadMs": 30},
    "windowPolicy": {
        "coreMaxSliceDurationMs": 12_000,
        "paddedMaxInferenceWindowMs": 12_060,
        "maximumPaddedInferenceWindowSamples": 192_960,
        "maximumAdjacentNativePaddingOverlapMs": 60,
        "nonAdjacentOverlap": False,
        "strictlyIncreasingStartsAndEnds": True,
    },
    "strategy": {
        "sessionReuse": True,
        "sourceSegmentsPerWindow": 1,
        "cueMapping": "one-legal-top-level-result-to-one-cue",
        "legacyInlineDispatch": True,
        "environment": {
            "CRISPASR_PARAKEET_STREAM_THRESHOLD": "13",
            "CRISPASR_SESSION_UNIFIED_DISPATCH": "0",
        },
        "reactiveStreamedFallback": False,
        "callerCreatedOverlap": False,
        "ownershipRewrite": False,
        "dedup": False,
        "stitching": False,
        "gapFill": False,
        "decoderSearch": False,
        "punctuationPostProcessing": False,
        "referenceRepair": False,
    },
    "cueLimits": {"maxCodePoints": 96, "maxDurationMs": 15_000},
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def result_trace_sha256(
    segment_index: int,
    local_start_ms: int,
    local_end_ms: int,
    window_duration_ms: int,
) -> str:
    trace = (
        f"segmentIndex={segment_index}\n"
        f"localStartMs={local_start_ms}\n"
        f"localEndMs={local_end_ms}\n"
        f"windowDurationMs={window_duration_ms}"
    )
    return hashlib.sha256(trace.encode("utf-8")).hexdigest()


def result_failure_fingerprint(detail: dict[str, Any]) -> str:
    return canonical_hash(detail)


def identity(path: Path) -> dict[str, Any]:
    return {"sizeBytes": path.stat().st_size, "sha256": sha256(path)}


def require_identity(path: Path, expected: tuple[int, str], label: str) -> None:
    if not path.is_file() or (path.stat().st_size, sha256(path)) != expected:
        raise RuntimeError(f"{label} identity drifted")


def locked_tool_identities() -> dict[str, tuple[int, str]]:
    text = INPUT_LOCK.read_text(encoding="utf-8")
    try:
        payload = text.split(TOOL_LOCK_BEGIN, 1)[1].split(TOOL_LOCK_END, 1)[0].strip()
        value = json.loads(payload)
    except (IndexError, json.JSONDecodeError, TypeError) as error:
        raise RuntimeError("formal tool identity lock is missing or invalid") from error
    if not isinstance(value, dict) or set(value) != set(TOOL_PATHS):
        raise RuntimeError("formal tool identity role set drifted")
    result: dict[str, tuple[int, str]] = {}
    for role, row in value.items():
        if not isinstance(row, dict) or set(row) != {"sizeBytes", "sha256"}:
            raise RuntimeError("formal tool identity row is invalid")
        size, digest = row["sizeBytes"], row["sha256"]
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0 or not isinstance(digest, str) or len(digest) != 64:
            raise RuntimeError("formal tool identity value is invalid")
        result[role] = (size, digest)
    return result


def verify_tool_identities() -> dict[str, dict[str, Any]]:
    locked = locked_tool_identities()
    for role, path in TOOL_PATHS.items():
        require_identity(path, locked[role], f"formal tool {role}")
    return {role: {"sizeBytes": size, "sha256": digest} for role, (size, digest) in sorted(locked.items())}


def _lexical_absolute(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def _is_reparse(path: Path) -> bool:
    try:
        status = path.lstat()
    except FileNotFoundError:
        return False
    stat_module = __import__("stat")
    return bool(
        stat_module.S_ISLNK(status.st_mode)
        or getattr(status, "st_file_attributes", 0)
        & getattr(stat_module, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    )


def require_contained(path: Path, root: Path, label: str) -> None:
    root_lexical = _lexical_absolute(root)
    candidate_lexical = _lexical_absolute(path)
    try:
        relative = candidate_lexical.relative_to(root_lexical)
    except ValueError as error:
        raise RuntimeError(f"{label} escapes its approved root") from error
    current = Path(root_lexical.anchor)
    for part in root_lexical.parts[1:]:
        current /= part
        try:
            current.lstat()
        except FileNotFoundError:
            break
        if _is_reparse(current):
            raise RuntimeError(f"{label} root crosses a reparse point")
    current = root_lexical
    for part in relative.parts:
        current /= part
        if _is_reparse(current):
            raise RuntimeError(f"{label} crosses a reparse point")
    root_resolved = root_lexical.resolve(strict=False)
    candidate_resolved = candidate_lexical.resolve(strict=False)
    try:
        candidate_resolved.relative_to(root_resolved)
    except ValueError as error:
        raise RuntimeError(f"{label} escapes its approved root") from error


def require_exact_role_path(path: Path, root: Path, relative: str, label: str) -> Path:
    role = Path(relative.replace("\\", "/"))
    if role.is_absolute() or not role.parts or any(part in {"", ".", ".."} for part in role.parts):
        raise RuntimeError(f"{label} relative path is invalid")
    expected = root.joinpath(*role.parts)
    if _lexical_absolute(path) != _lexical_absolute(expected):
        raise RuntimeError(f"{label} path role drifted")
    require_contained(expected, root, label)
    return expected


def require_ignored(path: Path) -> None:
    result = subprocess.run(["git", "check-ignore", "-q", str(path)], cwd=REPO_ROOT, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"private path is not ignored: {path.name}")


def require_private_path(path: Path, root: Path, label: str) -> None:
    require_contained(path, root, label)
    require_ignored(path)


def atomic_json(path: Path, value: Any) -> None:
    require_private_path(path, RAW_ROOT, "raw output")
    path.parent.mkdir(parents=True, exist_ok=True)
    require_private_path(path, RAW_ROOT, "raw output")
    temporary = path.with_suffix(path.suffix + ".tmp")
    require_private_path(temporary, RAW_ROOT, "raw temporary output")
    temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def hardlink_or_copy(source: Path, target: Path) -> None:
    require_private_path(target, FORMAL_ROOT, "staged private input")
    target.parent.mkdir(parents=True, exist_ok=True)
    require_private_path(target, FORMAL_ROOT, "staged private input")
    if target.exists():
        if target.is_file() and identity(target) == identity(source):
            return
        target.unlink()
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def verify_static_inputs() -> None:
    verify_tool_identities()
    require_identity(MANIFEST, STATIC_IDENTITIES["manifest"], "manifest")
    require_identity(COMPARATOR, STATIC_IDENTITIES["comparator"], "comparator")
    require_identity(PROTOCOL_LIMITS, STATIC_IDENTITIES["protocolLimits"], "protocol limits")
    for relative, expected in SOURCE_IDENTITIES.items():
        require_identity(REPO_ROOT / relative, expected, relative)


def prepare() -> dict[str, Any]:
    verify_static_inputs()
    worker_source = BUILD_BIN / "hikaru-asr-worker.exe"
    model_source = T10_LOCAL / "models" / "reazonspeech-nemo-v2-q8_0.gguf"
    vad_source = LOCAL_ROOT / "vad" / "ggml-silero-v6.2.0.bin"
    require_identity(worker_source, STATIC_IDENTITIES["worker"], "worker")
    require_identity(model_source, STATIC_IDENTITIES["model"], "model")
    require_identity(vad_source, STATIC_IDENTITIES["vad"], "VAD")
    hardlink_or_copy(worker_source, RUNTIME_ROOT / worker_source.name)
    hardlink_or_copy(vad_source, RUNTIME_ROOT / vad_source.name)
    hardlink_or_copy(model_source, MODEL_ROOT / model_source.name)
    for name, expected in RUNTIME_IDENTITIES.items():
        source = T10_RUNTIME / name
        require_identity(source, expected, f"runtime {name}")
        hardlink_or_copy(source, RUNTIME_ROOT / name)
    for case_id, (name, size, digest, _) in CASES.items():
        source = REPO_ROOT / ".asr-benchmark" / name
        require_identity(source, (size, digest), f"{case_id} audio")
        hardlink_or_copy(source, AUDIO_ROOT / name)
    for name, expected in {"hikaru-asr-worker.exe": STATIC_IDENTITIES["worker"], "ggml-silero-v6.2.0.bin": STATIC_IDENTITIES["vad"], **RUNTIME_IDENTITIES}.items():
        require_identity(RUNTIME_ROOT / name, expected, f"staged {name}")
    require_identity(MODEL_ROOT / model_source.name, STATIC_IDENTITIES["model"], "staged model")
    require_ignored(FORMAL_ROOT / ".ignore-sentinel")
    return {"status": "prepared", "runtimeFiles": len(RUNTIME_IDENTITIES) + 2, "caseCount": len(CASES)}


def read_pcm(path: Path) -> tuple[array, int]:
    require_private_path(path, AUDIO_ROOT, "staged audio")
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, SAMPLE_RATE, "NONE"):
            raise RuntimeError("audio is not 16 kHz mono PCM16")
        frame_count = audio.getnframes()
        data = audio.readframes(frame_count)
    pcm16 = array("h")
    pcm16.frombytes(data)
    if sys.byteorder != "little":
        pcm16.byteswap()
    return array("f", (sample / 32768.0 for sample in pcm16)), frame_count


def plan_vad_windows(audio_path: Path) -> list[dict[str, int]]:
    pcm, sample_count = read_pcm(audio_path)
    buffer = (ctypes.c_float * len(pcm)).from_buffer(pcm)
    handles = [os.add_dll_directory(str(root)) for root in (RUNTIME_ROOT, CUDA_ROOT, SYSTEM32)]
    try:
        library = bind_api(RUNTIME_ROOT / "crispasr.dll")
        spans = ctypes.POINTER(ctypes.c_float)()
        count = library.crispasr_vad_slices(
            os.fsencode(RUNTIME_ROOT / "ggml-silero-v6.2.0.bin"), buffer, len(pcm), SAMPLE_RATE,
            ctypes.c_float(0.5), 250, 100, 30, ctypes.c_float(12.0), 16, ctypes.byref(spans))
        if count <= 0 or not spans:
            raise RuntimeError(f"VAD returned no usable windows: {count}")
        try:
            raw = [(float(spans[index * 2]), float(spans[index * 2 + 1])) for index in range(count)]
        finally:
            library.crispasr_vad_free(spans)
    finally:
        for handle in reversed(handles):
            handle.close()
    windows: list[dict[str, int]] = []
    previous_start_ms = previous_end_ms = two_back_end_ms = -1
    samples_per_ms = SAMPLE_RATE // 1000
    if SAMPLE_RATE % 1000:
        raise RuntimeError("sample rate cannot represent integer milliseconds")
    for index, (start_seconds, end_seconds) in enumerate(raw):
        if not math.isfinite(start_seconds) or not math.isfinite(end_seconds):
            raise RuntimeError("VAD returned non-finite timing")
        start_ms, end_ms = round(start_seconds * 1000), round(end_seconds * 1000)
        start_sample, end_sample = start_ms * samples_per_ms, end_ms * samples_per_ms
        overlap_ms = max(0, previous_end_ms - start_ms) if index else 0
        if start_sample < 0 or end_sample <= start_sample or end_sample > sample_count:
            raise RuntimeError("VAD window is outside audio")
        if index and (start_ms <= previous_start_ms or end_ms <= previous_end_ms):
            raise RuntimeError("VAD starts/ends are not strictly increasing")
        if overlap_ms > MAX_ADJACENT_OVERLAP_MS or (index > 1 and start_ms < two_back_end_ms):
            raise RuntimeError("VAD overlap exceeds the frozen native-padding policy")
        if end_ms - start_ms > PADDED_MAX_WINDOW_MS or end_sample - start_sample > PADDED_MAX_WINDOW_SAMPLES:
            raise RuntimeError("VAD window exceeds the padded inference cap")
        windows.append({
            "index": index,
            "startSample": start_sample,
            "endSample": end_sample,
            "startMs": start_ms,
            "endMs": end_ms,
            "durationMs": end_ms - start_ms,
            "overlapWithPreviousMs": overlap_ms,
        })
        two_back_end_ms, previous_start_ms, previous_end_ms = previous_end_ms, start_ms, end_ms
    return windows


class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]


def _module_paths(process: int) -> list[Path]:
    psapi = ctypes.WinDLL("psapi.dll", use_last_error=True)
    psapi.EnumProcessModules.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.HMODULE), wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    psapi.EnumProcessModules.restype = wintypes.BOOL
    psapi.GetModuleFileNameExW.argtypes = [wintypes.HANDLE, wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD]
    psapi.GetModuleFileNameExW.restype = wintypes.DWORD
    capacity = 256
    while True:
        modules = (wintypes.HMODULE * capacity)()
        needed = wintypes.DWORD()
        if not psapi.EnumProcessModules(process, modules, ctypes.sizeof(modules), ctypes.byref(needed)):
            return []
        if needed.value <= ctypes.sizeof(modules):
            break
        capacity = needed.value // ctypes.sizeof(wintypes.HMODULE) + 16
    paths = []
    for module in modules[:needed.value // ctypes.sizeof(wintypes.HMODULE)]:
        buffer = ctypes.create_unicode_buffer(32768)
        if psapi.GetModuleFileNameExW(process, module, buffer, len(buffer)):
            paths.append(Path(buffer.value).resolve())
    return paths


def _root_role(path: Path) -> str | None:
    for role, root in (("runtime-bin", RUNTIME_ROOT), ("cuda-bin", CUDA_ROOT), ("system32", SYSTEM32)):
        try:
            path.resolve().relative_to(root.resolve())
            return role
        except ValueError:
            pass
    return None


def sample_process(pid: int, stop: threading.Event, result: dict[str, Any], started: float) -> None:
    kernel32 = ctypes.WinDLL("kernel32.dll", use_last_error=True)
    psapi = ctypes.WinDLL("psapi.dll", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS_EX), wintypes.DWORD]
    psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
    process = kernel32.OpenProcess(0x0400 | 0x0010, False, pid)
    if not process:
        result["error"] = "OpenProcess failed"
        return
    peak = 0
    observed: set[Path] = set()
    samples = 0
    try:
        while not stop.is_set():
            memory = PROCESS_MEMORY_COUNTERS_EX()
            memory.cb = ctypes.sizeof(memory)
            if psapi.GetProcessMemoryInfo(process, ctypes.byref(memory), memory.cb):
                peak = max(peak, int(memory.PeakWorkingSetSize))
            paths = _module_paths(process)
            observed.update(paths)
            samples += 1
            stop.wait(0.05)
    finally:
        kernel32.CloseHandle(process)
    modules = []
    unexpected = []
    seen_names = set()
    for path in sorted(observed, key=lambda item: (item.name.lower(), str(item).lower())):
        role = _root_role(path)
        name = path.name.lower()
        if role is None:
            unexpected.append(path.name)
            continue
        if name in seen_names:
            result["duplicateModuleBasename"] = name
            continue
        seen_names.add(name)
        root = {"runtime-bin": RUNTIME_ROOT, "cuda-bin": CUDA_ROOT, "system32": SYSTEM32}[role]
        relative = path.resolve().relative_to(root.resolve()).as_posix()
        modules.append({"name": path.name, "rootRole": role, "relativePath": relative, "identity": identity(path)})
    if not observed:
        result["error"] = "loaded module enumeration failed"
    result.update({
        "peakProcessRssBytes": peak,
        "loadedModules": modules,
        "unexpectedModuleBasenames": sorted(set(unexpected), key=str.lower),
        "sampleCount": samples,
        "lastSampleAtMs": (time.perf_counter() - started) * 1000,
    })


def validate_sampled_modules(result: dict[str, Any]) -> None:
    if result.get("error") or result.get("unexpectedModuleBasenames") or result.get("duplicateModuleBasename"):
        raise RuntimeError("worker loaded-module inventory is incomplete or escaped the restricted roots")
    modules = result.get("loadedModules")
    if not isinstance(modules, list) or not modules:
        raise RuntimeError("worker loaded-module inventory is missing")
    by_name: dict[str, dict[str, Any]] = {}
    expected_runtime = {**REQUIRED_LOADED_RUNTIME_IDENTITIES, "hikaru-asr-worker.exe": STATIC_IDENTITIES["worker"]}
    for module in modules:
        name = module["name"].lower()
        if name in by_name:
            raise RuntimeError("worker loaded-module basename is duplicated")
        by_name[name] = module
        role = module["rootRole"]
        relative = module["relativePath"].replace("\\", "/")
        if Path(relative).is_absolute() or ".." in Path(relative).parts or Path(relative).name.lower() != name:
            raise RuntimeError("worker loaded-module role-relative path is invalid")
        if role in {"runtime-bin", "cuda-bin"}:
            if role != "runtime-bin" or relative.lower() != name or name not in expected_runtime:
                raise RuntimeError(f"unexpected native module in restricted role: {name}")
            expected = expected_runtime[name]
            if module["identity"] != {"sizeBytes": expected[0], "sha256": expected[1]}:
                raise RuntimeError(f"restricted runtime module identity drifted: {name}")
    for name, expected in {**expected_runtime, **SYSTEM_MODULE_IDENTITIES}.items():
        module = by_name.get(name)
        expected_role = "system32" if name in SYSTEM_MODULE_IDENTITIES else "runtime-bin"
        if module is None or module["rootRole"] != expected_role or module["relativePath"].lower() != name or module["identity"] != {"sizeBytes": expected[0], "sha256": expected[1]}:
            raise RuntimeError(f"required loaded module identity drifted: {name}")


def load_protocol_limits() -> dict[str, int]:
    value = json.loads(PROTOCOL_LIMITS.read_text(encoding="utf-8"))
    if value.get("protocolVersion") != 1:
        raise RuntimeError("protocol limits drifted")
    return value


def validate_segment(segment: Any, duration_ms: int, limits: dict[str, int]) -> None:
    if not isinstance(segment, dict) or set(segment) != {"startMs", "endMs", "text"}:
        raise RuntimeError("protocol segment shape is invalid")
    start, end, text = segment["startMs"], segment["endMs"], segment["text"]
    if not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int) or isinstance(end, bool) or not isinstance(text, str) or not text:
        raise RuntimeError("protocol segment fields are invalid")
    encoded = text.encode("utf-8", "strict")
    if start < 0 or end <= start or end > duration_ms or len(encoded) > limits["maxTextBytes"] or any(byte < 0x20 or byte == 0x7f for byte in encoded):
        raise RuntimeError("protocol segment is out of bounds")


def validate_protocol_trace(events: list[dict[str, Any]], returncode: int, limits: dict[str, int]) -> dict[str, Any]:
    if not events:
        raise RuntimeError("worker emitted no protocol trace")
    ready = None
    replacement = None
    progress: list[int] = []
    terminal = None
    previous_segment_start = -1
    for index, item in enumerate(events):
        event = item.get("value")
        if not isinstance(event, dict) or event.get("protocolVersion") != 1 or not isinstance(event.get("event"), str):
            raise RuntimeError("worker emitted an invalid protocol event")
        kind = event["event"]
        if terminal:
            raise RuntimeError("event follows terminal event")
        if kind == "error":
            if not isinstance(event.get("code"), str) or not event["code"] or not isinstance(event.get("message"), str) or not event["message"]:
                raise RuntimeError("structured error is invalid")
            terminal = event
            continue
        if kind == "ready":
            if index != 0 or ready or event.get("backend") != "crispasr" or event.get("device") != "cuda" or not isinstance(event.get("durationMs"), int) or event["durationMs"] <= 0:
                raise RuntimeError("ready event is invalid")
            ready = event
            continue
        if not ready:
            raise RuntimeError("non-error event occurred before ready")
        duration = ready["durationMs"]
        if kind == "progress":
            processed = event.get("processedMs")
            if event.get("durationMs") != duration or not isinstance(processed, int) or isinstance(processed, bool) or processed < (progress[-1] if progress else 0) or processed > duration:
                raise RuntimeError("progress event is invalid")
            progress.append(processed)
        elif kind == "segment":
            raise RuntimeError("Reazon worker emitted an ineligible preview segment")
        elif kind == "segmentsReplace":
            if replacement is not None or not isinstance(event.get("segments"), list) or len(event["segments"]) > limits["maxReplacementSegments"]:
                raise RuntimeError("atomic replacement is invalid")
            for segment in event["segments"]:
                validate_segment(segment, duration, limits)
                if segment["startMs"] < previous_segment_start:
                    raise RuntimeError("replacement is not ordered")
                previous_segment_start = segment["startMs"]
            replacement = event
        elif kind == "completed":
            if replacement is None or event.get("durationMs") != duration or event.get("detectedLanguage") != "ja":
                raise RuntimeError("completed event is invalid")
            terminal = event
        else:
            raise RuntimeError("unknown protocol event")
    if not terminal:
        raise RuntimeError("worker trace lacks a terminal event")
    completed = terminal["event"] == "completed"
    if completed != (returncode == 0) or (not completed and returncode == 0):
        raise RuntimeError("worker exit/status identity drifted")
    if completed and not replacement:
        raise RuntimeError("completed trace lacks atomic replacement")
    if not completed and replacement is not None:
        raise RuntimeError("failed trace exposed accepted output")
    return {"status": "completed" if completed else "validated-failed", "ready": ready, "progressMs": progress, "replacement": replacement, "terminal": terminal}


def parse_evidence_trace(data: bytes) -> list[dict[str, Any]]:
    trace = []
    for line in data.splitlines():
        if not line.startswith(TRACE_PREFIX):
            continue
        value = json.loads(line[len(TRACE_PREFIX):].decode("utf-8", "strict"))
        if not isinstance(value, dict) or value.get("schema") != TRACE_SCHEMA:
            raise RuntimeError("worker evidence trace schema drifted")
        trace.append(value)
    if not trace:
        raise RuntimeError("worker evidence trace is missing")
    return trace


def validate_evidence_trace(
    trace: list[dict[str, Any]],
    windows: list[dict[str, int]],
    protocol: dict[str, Any],
) -> dict[str, Any]:
    identity_row = trace[0] if trace else None
    if not isinstance(identity_row, dict) or identity_row.get("kind") != "identity" or identity_row.get("device") != EXPECTED_DEVICE or identity_row.get("deviceSelectionEnvironment") != DEVICE_SELECTION_ENVIRONMENT:
        raise RuntimeError("child device/environment evidence drifted")
    cursor = 1
    ready = protocol["ready"] is not None
    status = protocol["status"]
    terminal = protocol["terminal"]
    if ready and cursor < len(trace) and trace[cursor].get("kind") == "vad":
        expected_windows = [{"index": item["index"], "startMs": item["startMs"], "endMs": item["endMs"]} for item in windows]
        if trace[cursor].get("windows") != expected_windows:
            raise RuntimeError("worker/backend VAD trace differs from the independent planner")
        cursor += 1
    attempts: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    while cursor < len(trace) and trace[cursor].get("kind") == "transcribeAttempt":
        attempt = trace[cursor]
        index = len(attempts)
        if index >= len(windows) or {key: attempt.get(key) for key in ("windowIndex", "startMs", "endMs")} != {
            "windowIndex": index,
            "startMs": windows[index]["startMs"],
            "endMs": windows[index]["endMs"],
        }:
            raise RuntimeError("transcribe attempt trace drifted")
        attempts.append(attempt)
        cursor += 1
        if cursor < len(trace) and trace[cursor].get("kind") == "sourceResult":
            source = trace[cursor]
            if {key: source.get(key) for key in ("windowIndex", "startMs", "endMs")} != {
                "windowIndex": index,
                "startMs": windows[index]["startMs"],
                "endMs": windows[index]["endMs"],
            }:
                raise RuntimeError("source result window trace drifted")
            segments = source.get("sourceSegments")
            if not isinstance(segments, list) or len(segments) != 1:
                raise RuntimeError("each completed VAD window must expose exactly one source result")
            segment = segments[0]
            if not isinstance(segment, dict) or set(segment) != {"startMs", "endMs", "textBytes", "textSha256"}:
                raise RuntimeError("source result trace shape drifted")
            if not isinstance(segment["startMs"], int) or not isinstance(segment["endMs"], int) or segment["startMs"] < windows[index]["startMs"] or segment["endMs"] > windows[index]["endMs"] or segment["endMs"] <= segment["startMs"] or not isinstance(segment["textBytes"], int) or segment["textBytes"] <= 0 or not isinstance(segment["textSha256"], str) or len(segment["textSha256"]) != 64:
                raise RuntimeError("source result trace is invalid or outside its matching window")
            sources.append(source)
            cursor += 1
    final_segments = [] if protocol["replacement"] is None else protocol["replacement"]["segments"]
    policy = None
    if cursor < len(trace) and trace[cursor].get("kind") == "policy":
        policy = trace[cursor]
        cursor += 1
    failure = None
    result_failure = None
    if cursor < len(trace) and trace[cursor].get("kind") == "failure":
        failure = trace[cursor]
        cursor += 1
    if cursor != len(trace):
        raise RuntimeError("worker evidence trace ordering drifted")
    if status == "completed":
        if failure is not None or policy is None or len(attempts) != len(windows) or len(sources) != len(windows) or len(final_segments) != len(windows):
            raise RuntimeError("completed worker evidence shape drifted")
    else:
        if failure is None or failure.get("code") != terminal.get("code"):
            raise RuntimeError("structured failure trace drifted")
        stage = failure.get("stage")
        if terminal.get("code") not in VALID_CANDIDATE_FAILURES or stage not in VALID_CANDIDATE_FAILURES[terminal["code"]]:
            raise RuntimeError("failure is not an identity-valid candidate-caused matrix row")
        if failure.get("attemptedTranscribeCalls") != len(attempts) or failure.get("completedTranscribeCalls") != len(sources):
            raise RuntimeError("failure call-count trace drifted")
        frontier = attempts[-1]["endMs"] if attempts else 0
        if failure.get("attemptedThroughMs") != frontier:
            raise RuntimeError("failure attempted-through trace drifted")
        if stage == "pre-ready" and (ready or attempts or sources):
            raise RuntimeError("pre-ready failure scope drifted")
        if stage == "vad" and (not ready or attempts or sources):
            raise RuntimeError("VAD-stage failure must record zero transcribe calls")
        if stage == "transcribe" and (not ready or len(attempts) != len(sources) + 1):
            raise RuntimeError("transcribe failure call scope drifted")
        if stage in {"policy", "protocol"} and (len(attempts) != len(windows) or len(sources) != len(windows)):
            raise RuntimeError("post-inference failure call scope drifted")
        raw_result_failure = failure.get("resultFailure")
        if terminal.get("code") == "crispasr_result_invalid":
            expected_keys = {
                "subtype",
                "zeroBasedWindowIndex",
                "windowStartMs",
                "windowEndMs",
                "localStartMs",
                "localEndMs",
                "segmentIndex",
                "resultTraceSha256",
            }
            if not isinstance(raw_result_failure, dict) or set(raw_result_failure) != expected_keys:
                raise RuntimeError("result-invalid failure subtype evidence is missing")
            integer_keys = expected_keys - {"subtype", "resultTraceSha256"}
            if any(
                not isinstance(raw_result_failure[key], int)
                or isinstance(raw_result_failure[key], bool)
                for key in integer_keys
            ):
                raise RuntimeError("result-invalid failure timing evidence is invalid")
            attempted = attempts[-1]
            if {
                "zeroBasedWindowIndex": raw_result_failure["zeroBasedWindowIndex"],
                "windowStartMs": raw_result_failure["windowStartMs"],
                "windowEndMs": raw_result_failure["windowEndMs"],
            } != {
                "zeroBasedWindowIndex": attempted["windowIndex"],
                "windowStartMs": attempted["startMs"],
                "windowEndMs": attempted["endMs"],
            }:
                raise RuntimeError("result-invalid failure window identity drifted")
            local_start = raw_result_failure["localStartMs"]
            local_end = raw_result_failure["localEndMs"]
            window_duration = attempted["endMs"] - attempted["startMs"]
            if (
                raw_result_failure["segmentIndex"] < 0
                or local_start < 0
                or local_end < local_start
                or local_end > window_duration
            ):
                raise RuntimeError("result-invalid local range is invalid")
            derived_subtype = (
                "zero_duration_top_level_result"
                if local_start == local_end
                else "other_top_level_result_invalid"
            )
            if raw_result_failure["subtype"] != derived_subtype:
                raise RuntimeError("result-invalid failure subtype was forged")
            expected_trace_hash = result_trace_sha256(
                raw_result_failure["segmentIndex"],
                local_start,
                local_end,
                window_duration,
            )
            if raw_result_failure["resultTraceSha256"] != expected_trace_hash:
                raise RuntimeError("result-invalid source/result trace hash drifted")
            result_failure = dict(raw_result_failure)
        elif raw_result_failure is not None:
            raise RuntimeError("non-result failure contains forged result subtype evidence")
    if policy is not None:
        final_evidence = policy.get("finalSegments")
        if not isinstance(final_evidence, list) or len(final_evidence) != len(final_segments) or len(sources) != len(final_segments):
            raise RuntimeError("policy/final evidence count drifted")
        source_bytes = 0
        final_text = bytearray()
        for index, final in enumerate(final_segments):
            encoded = final["text"].encode("utf-8", "strict")
            final_text.extend(encoded)
            source_segment = sources[index]["sourceSegments"][0]
            expected = {"startMs": final["startMs"], "endMs": final["endMs"], "textBytes": len(encoded), "textSha256": hashlib.sha256(encoded).hexdigest()}
            if source_segment != expected or final_evidence[index] != expected:
                raise RuntimeError("source result does not equal its matching final cue")
            source_bytes += source_segment["textBytes"]
        final_hash = hashlib.sha256(final_text).hexdigest()
        if policy.get("sourceTextBytes") != source_bytes or policy.get("finalTextBytes") != len(final_text) or policy.get("sourceTextSha256") != final_hash or policy.get("finalTextSha256") != final_hash:
            raise RuntimeError("source/final byte conservation drifted")
    progress = protocol["progressMs"]
    if progress != [source["endMs"] for source in sources]:
        raise RuntimeError("progress does not equal completed source-result frontiers")
    return {
        "attemptedTranscribeCalls": len(attempts),
        "completedTranscribeCalls": len(sources),
        "attemptedThroughMs": attempts[-1]["endMs"] if attempts else 0,
        "sourceResults": sources,
        "policy": policy,
        "failure": failure,
        "resultFailure": result_failure,
    }


def stderr_privacy(data: bytes, private_paths: list[Path]) -> bool:
    lower = data.lower()
    if any(secret in lower for secret in (b"authorization:", b"bearer ", b"password=", b"begin private key")):
        return False
    return all(os.fsencode(path) not in data and str(path).encode("utf-8") not in data for path in private_paths)


def expected_output(case_id: str, run_kind: str, repeat_index: int) -> tuple[Path, Path]:
    stem = f"{run_kind}-{repeat_index}"
    return RAW_ROOT / case_id / f"{stem}.json", STDERR_ROOT / case_id / f"{stem}.log"


def acquire(case_id: str, run_kind: str, repeat_index: int, timeout: int) -> dict[str, Any]:
    if (run_kind, repeat_index) not in EXPECTED_ROLES[case_id]:
        raise RuntimeError("case/sample role is outside the frozen matrix")
    prepare()
    name, _, _, declared_duration = CASES[case_id]
    audio = require_exact_role_path(AUDIO_ROOT / name, AUDIO_ROOT, name, "staged audio")
    worker = require_exact_role_path(RUNTIME_ROOT / "hikaru-asr-worker.exe", RUNTIME_ROOT, "hikaru-asr-worker.exe", "staged worker")
    model = require_exact_role_path(MODEL_ROOT / "reazonspeech-nemo-v2-q8_0.gguf", MODEL_ROOT, "reazonspeech-nemo-v2-q8_0.gguf", "staged model")
    require_private_path(audio, AUDIO_ROOT, "staged audio")
    require_private_path(worker, RUNTIME_ROOT, "staged worker")
    require_private_path(model, MODEL_ROOT, "staged model")
    output, stderr_path = expected_output(case_id, run_kind, repeat_index)
    stem = f"{run_kind}-{repeat_index}"
    require_exact_role_path(output, RAW_ROOT, f"{case_id}/{stem}.json", "raw output")
    require_exact_role_path(stderr_path, STDERR_ROOT, f"{case_id}/{stem}.log", "stderr output")
    require_private_path(output, RAW_ROOT, "raw output")
    require_private_path(stderr_path, STDERR_ROOT, "stderr output")
    windows = plan_vad_windows(audio)
    device = cuda_device()
    request = {
        "protocolVersion": 1,
        "jobId": f"r2-{case_id}-{run_kind}-{repeat_index}",
        "engine": "reazonspeech-nemo",
        "backend": "crispasr",
        "audioPath": str(audio.resolve()),
        "modelPaths": [{"role": "model", "path": str(model.resolve())}],
        "device": "cuda",
        "language": "ja",
        "useVad": False,
    }
    request_bytes = (json.dumps(request, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    env = dict(os.environ)
    sanitized_device_keys = set(DEVICE_SELECTION_ENVIRONMENT)
    for key in list(env):
        upper = key.upper()
        if upper.startswith("CRISPASR_PARAKEET_") or upper == "CRISPASR_SESSION_UNIFIED_DISPATCH" or upper in sanitized_device_keys:
            del env[key]
    env.update(ALGORITHM["strategy"]["environment"])
    env.update(DEVICE_SELECTION_ENVIRONMENT)
    env["HIKARU_ASR_R2_EVIDENCE_TRACE"] = "1"
    path_roots = [root.resolve(strict=True) for root in (RUNTIME_ROOT, CUDA_ROOT, SYSTEM32)]
    for role, root in zip(("runtime-bin", "cuda-bin", "system32"), path_roots):
        require_contained(root, root, f"child PATH {role}")
    env["PATH"] = os.pathsep.join(map(str, path_roots))
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    started = time.perf_counter()
    process = subprocess.Popen([str(worker)], cwd=RUNTIME_ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, creationflags=creationflags)
    assert process.stdin and process.stdout and process.stderr
    stderr_buffer = bytearray()
    stderr_thread = threading.Thread(target=lambda: stderr_buffer.extend(process.stderr.read()), daemon=True)
    stderr_thread.start()
    stop_sampler = threading.Event()
    sampler_result: dict[str, Any] = {}
    sampler_thread = threading.Thread(target=sample_process, args=(process.pid, stop_sampler, sampler_result, started), daemon=True)
    sampler_thread.start()
    timed_out = threading.Event()
    timer = threading.Timer(timeout, lambda: (timed_out.set(), process.kill()))
    timer.start()
    events: list[dict[str, Any]] = []
    stdout_bytes = bytearray()
    try:
        process.stdin.write(request_bytes)
        process.stdin.close()
        for line in iter(process.stdout.readline, b""):
            stdout_bytes.extend(line)
            wire = line.rstrip(b"\r\n")
            if not wire:
                continue
            if len(wire) > load_protocol_limits()["maxEventLineBytes"]:
                raise RuntimeError("worker event line exceeds protocol limit")
            value = json.loads(wire.decode("utf-8", "strict"))
            events.append({"atMs": (time.perf_counter() - started) * 1000, "lineSizeBytes": len(wire), "lineSha256": hashlib.sha256(wire).hexdigest(), "value": value})
        returncode = process.wait()
    finally:
        timer.cancel()
        if process.poll() is None:
            process.kill()
            process.wait()
        stop_sampler.set()
        sampler_thread.join(timeout=5)
        stderr_thread.join(timeout=5)
    stderr_path.parent.mkdir(parents=True, exist_ok=True)
    require_exact_role_path(stderr_path, STDERR_ROOT, f"{case_id}/{stem}.log", "stderr output")
    require_private_path(stderr_path, STDERR_ROOT, "stderr output")
    stderr_path.write_bytes(stderr_buffer)
    if timed_out.is_set():
        raise RuntimeError("external timeout produced unscored process evidence; rerun this role")
    limits = load_protocol_limits()
    trace = validate_protocol_trace(events, returncode, limits)
    ready = trace["ready"]
    if ready and ready["durationMs"] != declared_duration:
        raise RuntimeError("worker ready duration differs from the authoritative case")
    progress = trace["progressMs"]
    planned_ends = [window["endMs"] for window in windows]
    if progress != planned_ends[:len(progress)] or len(progress) > len(windows):
        raise RuntimeError("worker progress does not prove the frozen VAD call prefix")
    if trace["status"] == "completed" and progress != planned_ends:
        raise RuntimeError("completed worker did not transcribe every planned VAD window")
    replacement = trace["replacement"]
    final_segments = [] if replacement is None else replacement["segments"]
    evidence_trace = parse_evidence_trace(bytes(stderr_buffer))
    source_evidence = validate_evidence_trace(evidence_trace, windows, trace)
    terminal_at = events[-1]["atMs"]
    ready_at = next((item["atMs"] for item in events if item["value"]["event"] == "ready"), None)
    replacement_at = next((item["atMs"] for item in events if item["value"]["event"] == "segmentsReplace"), None)
    inference_end = replacement_at if replacement_at is not None else terminal_at
    inference_ms = None if ready_at is None else inference_end - ready_at
    attempted_windows = source_evidence["attemptedTranscribeCalls"]
    attempted_through_ms = source_evidence["attemptedThroughMs"]
    validate_sampled_modules(sampler_result)
    if not isinstance(sampler_result.get("peakProcessRssBytes"), int) or sampler_result["peakProcessRssBytes"] <= 0:
        raise RuntimeError("worker RSS evidence is missing")
    stderr_data = bytes(stderr_buffer)
    privacy = stderr_privacy(stderr_data, [audio, model, output, INPUT_LOCK])
    if not privacy:
        raise RuntimeError("stderr privacy validation failed")
    text_bytes = b"".join(segment["text"].encode("utf-8") for segment in final_segments)
    raw = {
        "schema": RAW_SCHEMA,
        "status": trace["status"],
        "candidateId": CANDIDATE_ID,
        "caseId": case_id,
        "runKind": run_kind,
        "repeatIndex": repeat_index,
        "identity": {
            "inputLock": identity(INPUT_LOCK),
            "runner": identity(Path(__file__).resolve()),
            "worker": identity(worker),
            "runtimeFiles": {name: identity(RUNTIME_ROOT / name) for name in sorted(RUNTIME_IDENTITIES)},
            "model": identity(model),
            "vad": identity(RUNTIME_ROOT / "ggml-silero-v6.2.0.bin"),
            "audio": identity(audio),
            "manifest": identity(MANIFEST),
            "comparator": identity(COMPARATOR),
            "protocolLimits": identity(PROTOCOL_LIMITS),
            "formalTools": verify_tool_identities(),
            "sourceFiles": {relative: identity(REPO_ROOT / relative) for relative in sorted(SOURCE_IDENTITIES)},
            "device": device,
            "deviceSelectionEnvironment": DEVICE_SELECTION_ENVIRONMENT,
            "pathPolicy": {"policy": PATH_POLICY, "orderedRootRoles": ["runtime-bin", "cuda-bin", "system32"], "orderedRoots": [str(root) for root in path_roots]},
            "loadedModules": sampler_result["loadedModules"],
        },
        "algorithm": ALGORITHM,
        "request": request,
        "requestSha256": hashlib.sha256(request_bytes.rstrip(b"\n")).hexdigest(),
        "durationMs": declared_duration,
        "vadWindows": windows,
        "vadWindowsSha256": canonical_hash(windows),
        "protocolTrace": {"stdoutSizeBytes": len(stdout_bytes), "stdoutSha256": hashlib.sha256(stdout_bytes).hexdigest(), "events": events},
        "evidenceTrace": evidence_trace,
        "shape": {
            "plannedVadWindows": len(windows),
            "completedTranscribeCalls": source_evidence["completedTranscribeCalls"],
            "attemptedTranscribeCalls": attempted_windows,
            "sourceSegmentsPerCompletedWindow": 1,
            "finalCueCount": len(final_segments),
            "sourceShapeProvenance": "worker-backend-sanitized-source-result-trace-v1",
            "sourceTextSha256": None if source_evidence["policy"] is None else source_evidence["policy"]["sourceTextSha256"],
            "finalTextSha256": hashlib.sha256(text_bytes).hexdigest() if final_segments else None,
        },
        "finalSegments": final_segments,
        "error": None if trace["status"] == "completed" else {
            "code": trace["terminal"]["code"],
            "message": trace["terminal"]["message"],
            "ready": ready is not None,
            "taxonomy": "candidate-caused-structured-failure",
            "stage": source_evidence["failure"]["stage"],
        },
        "timings": {
            "processWallMs": (time.perf_counter() - started) * 1000,
            "readyAtMs": ready_at,
            "terminalAtMs": terminal_at,
            "inferenceMs": inference_ms,
            "rtfScope": "full-case" if attempted_windows == len(windows) else "partial-attempt",
            "attemptedThroughMs": attempted_through_ms,
        },
        "resources": {"method": "GetProcessMemoryInfo.PeakWorkingSetSize", "peakProcessRssBytes": sampler_result["peakProcessRssBytes"], "moduleSampleCount": sampler_result["sampleCount"]},
        "stderr": {"relativePath": stderr_path.relative_to(LOCAL_ROOT).as_posix(), "sizeBytes": len(stderr_data), "sha256": hashlib.sha256(stderr_data).hexdigest(), "privacyPass": True},
        "returnCode": returncode,
    }
    atomic_json(output, raw)
    return {"caseId": case_id, "runKind": run_kind, "repeatIndex": repeat_index, "status": raw["status"], "raw": output.relative_to(LOCAL_ROOT).as_posix()}


def dry_run(case_id: str) -> dict[str, Any]:
    prepare()
    name = CASES[case_id][0]
    windows = plan_vad_windows(AUDIO_ROOT / name)
    return {"status": "dry-run-ok", "caseId": case_id, "vadWindowCount": len(windows), "maximumWindowDurationMs": max(window["durationMs"] for window in windows), "maximumAdjacentOverlapMs": max(window["overlapWithPreviousMs"] for window in windows)}


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("prepare")
    dry = subparsers.add_parser("dry-run")
    dry.add_argument("--case", choices=tuple(CASES), default="short-v1")
    run = subparsers.add_parser("acquire")
    run.add_argument("--case", choices=tuple(CASES), required=True)
    run.add_argument("--run-kind", choices=("cold", "warm", "measured"), required=True)
    run.add_argument("--repeat-index", type=int, required=True)
    run.add_argument("--timeout", type=int, default=7200)
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            result = prepare()
        elif args.command == "dry-run":
            result = dry_run(args.case)
        else:
            result = acquire(args.case, args.run_kind, args.repeat_index, args.timeout)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (OSError, RuntimeError, ValueError, KeyError, TypeError, json.JSONDecodeError, UnicodeDecodeError, subprocess.SubprocessError) as error:
        print(f"R2 acquisition rejected: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
