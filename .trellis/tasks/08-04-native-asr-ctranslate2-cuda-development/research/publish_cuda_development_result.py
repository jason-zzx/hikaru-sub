#!/usr/bin/env python3
"""Validate ignored-local T07 evidence and publish one deterministic development result."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import statistics
from pathlib import Path
from typing import Any

TASK_ROOT = Path(__file__).resolve().parent.parent
LOCAL_ROOT = (Path(__file__).resolve().parent / "local").resolve()
EXPECTED_KIND = "hikaru-ct2-whisper-cuda-development-raw"
EXPECTED_MODEL = ("Systran/faster-whisper-large-v3", "edaa852ec7e145841d8ffdb056a99866b5f0a478")
EXPECTED_MODEL_BIN = "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1"
EXPECTED_INPUT_LOCK_SHA256 = "42d2de13627de0d83d6ecaa118897e370899734dfb3d26b5840802612c353bc9"
EXPECTED_PATH_ROOT_IDENTITY = "7a4ed8f631101a0d939c76c3795af907c74b79ae5dda3a116ba3a032d666bc6d"
EXPECTED_CASES = {
    "short-v1": (24_102, "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211"),
    "medium-v1-first-120s": (120_000, "d7b8c62d1358eee4f7ca40596ec424e91cde6992654add5c0219cdeed3907b42"),
}
EXPECTED_MODEL_FILES = {
    "config.json": (2_394, "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9"),
    "model.bin": (3_087_284_237, EXPECTED_MODEL_BIN),
    "preprocessor_config.json": (340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"),
    "tokenizer.json": (2_480_617, "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"),
    "vocabulary.json": (1_068_114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"),
}
EXPECTED_CONFIG = {
    "beamSize": 1,
    "conditionOnPreviousText": False,
    "lengthPenalty": 1.0,
    "logProbThreshold": -1.0,
    "maxInitialTimestampIndex": 50,
    "maxLength": 448,
    "modelWindowDurationMs": 30_000,
    "noRepeatNgramSize": 0,
    "noSpeechThreshold": 0.6,
    "patience": 1.0,
    "promptResetOnTemperature": 0.5,
    "repetitionPenalty": 1.0,
    "temperature": 0.0,
    "timestampDrivenSeek": True,
    "timestampResolutionMs": 20,
    "vad": False,
}
EXPECTED_CPU = {
    "architecture": "x86_64",
    "model": "AMD Ryzen 7 5800X 8-Core Processor",
    "logicalCores": 16,
    "availableIsa": {"avx": True, "avx2": True, "avx512f": False, "fma": True, "sse2": True},
}
EXPECTED_RUNTIME_DLL_NAMES = {
    "ctranslate2.dll", "hikaru_asr_tokenizer.dll", "onnxruntime.dll", "onnxruntime_providers_shared.dll"
}
EXPECTED_CUDA_MODULES = {
    "cublas64_12.dll": (113_716_224, "9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99", "cuda-toolkit-12.8-bin"),
    "cublaslt64_12.dll": (674_667_520, "b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7", "cuda-toolkit-12.8-bin"),
    "nvcuda.dll": (4_466_920, "ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c", "windows-system32"),
}
EXPECTED_GPU = {
    "deviceIndex": 0,
    "name": "NVIDIA GeForce RTX 3070",
    "driverVersion": "596.49",
    "driverModuleVersion": "32.0.15.9649",
    "cudaDriverApiVersion": 13_020,
    "computeCapability": "8.6",
    "visibleDeviceCount": 1,
    "float16Supported": True,
}
CUDA_MODULE_PREFIXES = ("cublas", "cudart", "curand", "cufft", "cusparse", "nvrtc", "nvcuda")
SAFE_UNAVAILABLE_CODES = {
    "cuda_device_unavailable",
    "cuda_compute_type_unsupported",
    "cuda_runtime_failed",
    "cuda_model_load_failed",
}
FAILURE_COMMANDS = {
    "configure": "cmake --preset windows-x64-ct2-cuda-development",
    "build": "cmake --build --preset windows-x64-ct2-cuda-development",
    "pre-ready": "hikaru-asr-worker protocol-v1 cuda",
}
EXPECTED_FAILURE_TOOLCHAIN = "msvc-19.44.35221+cmake-4.1.1-msvc1+ninja-1.12.1"
EXPECTED_FAILURE_RUNTIME = "ctranslate2-4.8.0+cuda-12.8.93+sm86+no-cudnn"


class EvidenceError(ValueError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _inside(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _load_raw(path: Path) -> dict[str, Any]:
    if not _inside(LOCAL_ROOT, path):
        raise EvidenceError("raw evidence is outside the canonical T07 local root")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceError(f"raw evidence could not be read: {error}") from error
    if not isinstance(value, dict):
        raise EvidenceError("raw evidence must be a JSON object")
    return value


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceError(f"JSON input could not be read: {error}") from error
    if not isinstance(value, dict):
        raise EvidenceError("JSON input must be an object")
    return value


def _hex(value: Any, label: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(ch not in "0123456789abcdef" for ch in value):
        raise EvidenceError(f"{label} is not a lowercase SHA-256")
    return value


def _file_identity(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("sizeBytes"), int) or value["sizeBytes"] <= 0:
        raise EvidenceError(f"{label} file size is invalid")
    return {"sizeBytes": value["sizeBytes"], "sha256": _hex(value.get("sha256"), f"{label} hash")}


def _named_files(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise EvidenceError(f"{label} file list is empty")
    result = []
    names = set()
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"]:
            raise EvidenceError(f"{label} file name is invalid")
        name = item["name"]
        if name.lower() in names:
            raise EvidenceError(f"{label} contains duplicate files")
        names.add(name.lower())
        result.append({"name": name, **_file_identity(item, f"{label} {name}")})
    return sorted(result, key=lambda item: item["name"].lower())


def _normalized_path(value: str) -> str:
    return os.path.normcase(os.path.normpath(value))


def _path_policy(value: Any) -> tuple[dict[str, Any], dict[str, str]]:
    expected_roles = ["task-local-runtime-bin", "cuda-toolkit-12.8-bin", "windows-system32"]
    if not isinstance(value, dict) or value.get("name") != "t07-windows-cuda-restricted-path-v1":
        raise EvidenceError("restricted PATH policy name is invalid")
    if value.get("restricted") is not True or value.get("entryCount") != 3:
        raise EvidenceError("restricted PATH policy is not exact")
    if value.get("orderedEntryRoles") != expected_roles:
        raise EvidenceError("restricted PATH role order drifted")
    root_hash = _hex(value.get("rootIdentitySha256"), "restricted PATH root identity")
    if root_hash != EXPECTED_PATH_ROOT_IDENTITY:
        raise EvidenceError("restricted PATH roots differ from the frozen development machine identity")
    roots = value.get("resolvedRoots")
    if not isinstance(roots, list) or len(roots) != 3:
        raise EvidenceError("restricted PATH resolved roots are invalid")
    root_map: dict[str, str] = {}
    for root in roots:
        if not isinstance(root, dict) or root.get("role") not in expected_roles or not isinstance(root.get("canonicalPath"), str):
            raise EvidenceError("restricted PATH root is invalid")
        path = root["canonicalPath"]
        if not os.path.isabs(path) or root["role"] in root_map:
            raise EvidenceError("restricted PATH root is not absolute or unique")
        root_map[root["role"]] = _normalized_path(path)
    if list(root_map) != expected_roles:
        raise EvidenceError("restricted PATH resolved-root order drifted")
    return {
        "name": value["name"],
        "orderedEntryRoles": expected_roles,
        "rootIdentitySha256": root_hash,
    }, root_map


def _modules(value: Any, roots: dict[str, str]) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise EvidenceError("loaded-module inventory is empty")
    result = []
    names = set()
    for item in value:
        if not isinstance(item, dict):
            raise EvidenceError("loaded-module row is invalid")
        name = item.get("name")
        role = item.get("rootRole")
        path = item.get("canonicalPath")
        if not isinstance(name, str) or not name or name.lower() in names:
            raise EvidenceError("loaded-module names are invalid or duplicated")
        if role not in roots or not isinstance(path, str) or not os.path.isabs(path):
            raise EvidenceError("loaded-module path/root role is invalid")
        if _normalized_path(os.path.dirname(path)) != roots[role]:
            raise EvidenceError("loaded-module path escaped or was correlated with a rewritten root")
        if name.lower().startswith("cudnn"):
            raise EvidenceError("no-cuDNN identity loaded cudnn")
        names.add(name.lower())
        identity = _file_identity(item, f"loaded module {name}")
        version = item.get("version")
        if not isinstance(version, str):
            raise EvidenceError("loaded-module version is invalid")
        result.append({"name": name, "rootRole": role, "version": version, **identity})
    return sorted(result, key=lambda item: item["name"].lower())


def _sample_rows(raw: dict[str, Any], discovery: bool) -> list[dict[str, Any]]:
    samples = raw.get("samples")
    expected_count = 1 if discovery else 4
    if not isinstance(samples, list) or len(samples) != expected_count:
        raise EvidenceError("evidence does not contain the required repeat count")
    expected_kinds = ["module-discovery"] if discovery else ["cold", "warm", "warm", "warm"]
    duration = raw["audio"]["durationMs"]
    result = []
    for index, sample in enumerate(samples):
        if not isinstance(sample, dict) or sample.get("status") != "completed":
            raise EvidenceError("measurement did not complete")
        if sample.get("runKind") != expected_kinds[index] or sample.get("repeatIndex") != index + 1:
            raise EvidenceError("cold/warm repeat sequence drifted")
        generation_count = sample.get("generationCallCount")
        traces = sample.get("tokenTraces")
        if sample.get("generationCompleted") is not True or not isinstance(generation_count, int) or generation_count <= 0:
            raise EvidenceError("completed generation attestation is missing")
        if not isinstance(traces, list) or not traces:
            raise EvidenceError("completed generation trace is missing")
        traced_generation_count = 0
        for trace in traces:
            if not isinstance(trace, dict) or not isinstance(trace.get("generationCallCount"), int) or trace["generationCallCount"] < 0:
                raise EvidenceError("generation trace call count is invalid")
            _hex(trace.get("sha256"), "generation trace hash")
            traced_generation_count += trace["generationCallCount"]
        if traced_generation_count != generation_count:
            raise EvidenceError("generation trace count differs from completed attestation")
        timings = sample.get("timings")
        if not isinstance(timings, dict):
            raise EvidenceError("measurement timings are missing")
        numeric = {}
        for key in ("sampleWallMs", "featureMs", "modelGenerateMs", "inferenceMs", "inferenceRtf"):
            value = timings.get(key)
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise EvidenceError(f"measurement timing {key} is invalid")
            numeric[key] = float(value)
        if numeric["sampleWallMs"] < numeric["inferenceMs"] or numeric["inferenceMs"] < numeric["featureMs"] + numeric["modelGenerateMs"]:
            raise EvidenceError("measurement timing components are inconsistent")
        if not math.isclose(numeric["inferenceRtf"], numeric["inferenceMs"] / duration, rel_tol=1e-9, abs_tol=1e-12):
            raise EvidenceError("inference RTF does not match inference time and duration")
        load_ms = timings.get("loadMs")
        if index == 0:
            process_wall_ms = timings.get("processWallMs")
            process_wall_rtf = timings.get("processWallRtf")
            if not isinstance(load_ms, (int, float)) or not math.isfinite(load_ms) or load_ms <= 0:
                raise EvidenceError("cold model load timing is invalid")
            if not isinstance(process_wall_ms, (int, float)) or not math.isfinite(process_wall_ms) or process_wall_ms < load_ms + numeric["sampleWallMs"]:
                raise EvidenceError("cold process wall timing is invalid")
            if not isinstance(process_wall_rtf, (int, float)) or not math.isclose(process_wall_rtf, process_wall_ms / duration, rel_tol=1e-9, abs_tol=1e-12):
                raise EvidenceError("cold process wall RTF is invalid")
            numeric.update(loadMs=float(load_ms), processWallMs=float(process_wall_ms), processWallRtf=float(process_wall_rtf))
        elif load_ms is not None or "processWallMs" in timings or "processWallRtf" in timings:
            raise EvidenceError("warm rows must not contain cold process timings")
        result.append({"runKind": expected_kinds[index], "repeatIndex": index + 1, **numeric})
    return result


def _validate_raw(path: Path, *, discovery: bool) -> dict[str, Any]:
    raw = _load_raw(path)
    if raw.get("schemaVersion") != 1 or raw.get("kind") != EXPECTED_KIND or raw.get("status") != "completed":
        raise EvidenceError("T07 raw envelope is invalid")
    if raw.get("qualificationEligible") is not False or raw.get("moduleDiscovery") is not discovery:
        raise EvidenceError("T07 evidence purpose/discovery flag drifted")
    case_id = raw.get("caseId")
    if case_id not in EXPECTED_CASES or raw.get("engine") != "faster-whisper":
        raise EvidenceError("T07 case/engine identity is invalid")
    duration, audio_hash = EXPECTED_CASES[case_id]
    audio = raw.get("audio")
    if not isinstance(audio, dict) or audio.get("durationMs") != duration or audio.get("sha256") != audio_hash:
        raise EvidenceError("T07 audio identity drifted")
    if case_id == "medium-v1-first-120s":
        source = audio.get("source")
        if not isinstance(source, dict) or source.get("pcmPrefixVerified") is not True or source.get("sha256") != "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458":
            raise EvidenceError("120-second source-prefix identity is invalid")
    model = raw.get("model")
    if not isinstance(model, dict) or (model.get("id"), model.get("revision")) != EXPECTED_MODEL:
        raise EvidenceError("large-v3 identity drifted")
    model_files = _named_files(model.get("files"), "model")
    actual_model_files = {item["name"]: (item["sizeBytes"], item["sha256"]) for item in model_files}
    if actual_model_files != EXPECTED_MODEL_FILES:
        raise EvidenceError("large-v3 model file identity drifted")
    if raw.get("algorithm") != "selected-timestamp-no-history-beam1":
        raise EvidenceError("algorithm identity drifted")
    config = raw.get("config")
    if config != EXPECTED_CONFIG:
        raise EvidenceError("selected algorithm config drifted")
    lock_hash = _hex(raw.get("inputLockSha256"), "input lock")
    if lock_hash != EXPECTED_INPUT_LOCK_SHA256:
        raise EvidenceError("T07 CUDA input lock identity drifted")

    runtime = raw.get("runtime")
    if not isinstance(runtime, dict):
        raise EvidenceError("runtime identity is missing")
    requested = runtime.get("requestedDevice")
    resolved = runtime.get("resolvedDevice")
    if requested not in ("cpu", "cuda") or resolved != requested:
        raise EvidenceError("requested/resolved device mismatch")
    expected_compute = "float16" if requested == "cuda" else "int8"
    if runtime.get("computeType") != expected_compute or runtime.get("deviceIndex") != 0:
        raise EvidenceError("device compute mapping drifted")
    if runtime.get("ctranslate2Version") != "4.8.0" or runtime.get("cudaBuildEnabled") is not True or runtime.get("cudaDynamicLoading") is not True or runtime.get("withCudnn") is not False:
        raise EvidenceError("CUDA-enabled CTranslate2 build identity drifted")
    gpu = runtime.get("gpu")
    if requested == "cuda":
        if gpu != EXPECTED_GPU:
            raise EvidenceError("CUDA device/driver/FP16 attestation drifted")
    elif gpu is not None:
        raise EvidenceError("CPU evidence unexpectedly contains GPU attestation")
    if runtime.get("cpu") != EXPECTED_CPU:
        raise EvidenceError("paired CPU identity drifted")
    required_dlls = _named_files(runtime.get("requiredDlls"), "runtime DLL")
    if {item["name"].lower() for item in required_dlls} != EXPECTED_RUNTIME_DLL_NAMES:
        raise EvidenceError("runtime DLL set drifted")
    path_policy, roots = _path_policy(runtime.get("pathPolicy"))
    modules = _modules(runtime.get("loadedModules"), roots)
    module_names = {item["name"].lower() for item in modules}
    if requested == "cpu" and any(name.startswith(CUDA_MODULE_PREFIXES) for name in module_names):
        raise EvidenceError("CPU evidence unexpectedly loaded CUDA modules")
    if requested == "cuda" and not set(EXPECTED_CUDA_MODULES).issubset(module_names):
        raise EvidenceError("CUDA evidence is missing required driver/math modules")
    module_map = _module_map(modules)
    for name, (size, sha256, role) in EXPECTED_CUDA_MODULES.items():
        if requested == "cuda" and (
            module_map[name]["sizeBytes"], module_map[name]["sha256"], module_map[name]["rootRole"]
        ) != (size, sha256, role):
            raise EvidenceError(f"locked CUDA module identity drifted: {name}")

    return {
        "path": str(path.resolve()),
        "caseId": case_id,
        "audio": {"durationMs": duration, "sha256": audio_hash},
        "model": {"id": model["id"], "revision": model["revision"], "files": model_files},
        "algorithm": raw["algorithm"],
        "config": config,
        "inputLockSha256": lock_hash,
        "runtime": {
            "measurementExecutable": _file_identity(runtime.get("measurementExecutable"), "measurement executable"),
            "productionWorker": _file_identity(runtime.get("productionWorker"), "production worker"),
            "requiredDlls": required_dlls,
            "requestedDevice": requested,
            "resolvedDevice": resolved,
            "computeType": expected_compute,
            "deviceIndex": 0,
            "ctranslate2Version": "4.8.0",
            "gpu": gpu,
            "cpu": runtime.get("cpu"),
            "pathPolicy": path_policy,
            "modules": modules,
        },
        "samples": _sample_rows(raw, discovery),
    }


def _shared_identity(row: dict[str, Any]) -> dict[str, Any]:
    runtime = row["runtime"]
    return {
        "inputLockSha256": row["inputLockSha256"],
        "model": row["model"],
        "algorithm": row["algorithm"],
        "config": row["config"],
        "measurementExecutable": runtime["measurementExecutable"],
        "productionWorker": runtime["productionWorker"],
        "requiredDlls": runtime["requiredDlls"],
        "ctranslate2Version": runtime["ctranslate2Version"],
        "cpu": runtime["cpu"],
        "pathPolicy": runtime["pathPolicy"],
    }


def _module_map(modules: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {item["name"].lower(): item for item in modules}


def freeze_modules(cpu_path: Path, cuda_path: Path, output: Path) -> dict[str, Any]:
    cpu = _validate_raw(cpu_path, discovery=True)
    cuda = _validate_raw(cuda_path, discovery=True)
    if cpu["caseId"] != cuda["caseId"] or cpu["audio"] != cuda["audio"]:
        raise EvidenceError("CPU/CUDA discovery sample identity differs")
    if cpu["runtime"]["requestedDevice"] != "cpu" or cuda["runtime"]["requestedDevice"] != "cuda":
        raise EvidenceError("discovery device roles are reversed")
    if _shared_identity(cpu) != _shared_identity(cuda):
        raise EvidenceError("CPU/CUDA discovery shared identity drifted")
    cpu_modules = _module_map(cpu["runtime"]["modules"])
    cuda_modules = _module_map(cuda["runtime"]["modules"])
    shared_names = sorted(set(cpu_modules) & set(cuda_modules))
    for name in shared_names:
        if cpu_modules[name] != cuda_modules[name]:
            raise EvidenceError(f"shared module identity drifted: {name}")
    value = {
        "schemaVersion": 1,
        "kind": "hikaru-ct2-whisper-cuda-development-module-lock",
        "publisherSha256": _sha256(Path(__file__).resolve()),
        "identity": _shared_identity(cpu),
        "gpu": cuda["runtime"]["gpu"],
        "sharedModules": [cpu_modules[name] for name in shared_names],
        "cpuOnlyModules": [cpu_modules[name] for name in sorted(set(cpu_modules) - set(cuda_modules))],
        "cudaOnlyModules": [cuda_modules[name] for name in sorted(set(cuda_modules) - set(cpu_modules))],
        "discovery": {
            "caseId": cpu["caseId"],
            "audioSha256": cpu["audio"]["sha256"],
            "cpuRawSha256": _sha256(cpu_path),
            "cudaRawSha256": _sha256(cuda_path),
            "excludedFromMeasurement": True,
        },
    }
    _write_json(output, value)
    return value


def _locked_modules(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise EvidenceError(f"module lock {label} set is invalid")
    result = []
    names = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {"name", "rootRole", "version", "sizeBytes", "sha256"}:
            raise EvidenceError(f"module lock {label} row is invalid")
        name = item.get("name")
        role = item.get("rootRole")
        version = item.get("version")
        if not isinstance(name, str) or not name or name.lower() in names:
            raise EvidenceError(f"module lock {label} names are invalid or duplicated")
        if role not in {"task-local-runtime-bin", "cuda-toolkit-12.8-bin", "windows-system32"} or not isinstance(version, str):
            raise EvidenceError(f"module lock {label} role/version is invalid")
        names.add(name.lower())
        result.append({"name": name, "rootRole": role, "version": version, **_file_identity(item, f"module lock {label} {name}")})
    return sorted(result, key=lambda item: item["name"].lower())


def _validate_module_lock(value: dict[str, Any]) -> None:
    if value.get("schemaVersion") != 1 or value.get("kind") != "hikaru-ct2-whisper-cuda-development-module-lock":
        raise EvidenceError("module lock envelope is invalid")
    identity = value.get("identity")
    if not isinstance(identity, dict):
        raise EvidenceError("module lock shared identity is missing")
    model = identity.get("model")
    model_files = _named_files(model.get("files") if isinstance(model, dict) else None, "module lock model")
    if not isinstance(model, dict) or (model.get("id"), model.get("revision")) != EXPECTED_MODEL:
        raise EvidenceError("module lock model identity drifted")
    if {item["name"]: (item["sizeBytes"], item["sha256"]) for item in model_files} != EXPECTED_MODEL_FILES:
        raise EvidenceError("module lock model files drifted")
    if identity.get("inputLockSha256") != EXPECTED_INPUT_LOCK_SHA256 or identity.get("algorithm") != "selected-timestamp-no-history-beam1" or identity.get("config") != EXPECTED_CONFIG:
        raise EvidenceError("module lock algorithm/input identity drifted")
    if identity.get("ctranslate2Version") != "4.8.0" or identity.get("cpu") != EXPECTED_CPU:
        raise EvidenceError("module lock runtime identity drifted")
    expected_path_policy = {
        "name": "t07-windows-cuda-restricted-path-v1",
        "orderedEntryRoles": ["task-local-runtime-bin", "cuda-toolkit-12.8-bin", "windows-system32"],
        "rootIdentitySha256": EXPECTED_PATH_ROOT_IDENTITY,
    }
    if identity.get("pathPolicy") != expected_path_policy:
        raise EvidenceError("module lock restricted PATH identity drifted")
    _file_identity(identity.get("measurementExecutable"), "module lock measurement executable")
    _file_identity(identity.get("productionWorker"), "module lock production worker")
    required_dlls = _named_files(identity.get("requiredDlls"), "module lock runtime DLL")
    if {item["name"].lower() for item in required_dlls} != EXPECTED_RUNTIME_DLL_NAMES:
        raise EvidenceError("module lock runtime DLL set drifted")
    if value.get("gpu") != EXPECTED_GPU:
        raise EvidenceError("module lock GPU identity drifted")
    sets = {key: _locked_modules(value.get(key), key) for key in ("sharedModules", "cpuOnlyModules", "cudaOnlyModules")}
    all_names = [item["name"].lower() for modules in sets.values() for item in modules]
    if len(all_names) != len(set(all_names)):
        raise EvidenceError("module lock sets overlap")
    shared_map = _module_map(sets["sharedModules"])
    if not {"ctranslate2.dll", "hikaru-asr-ctranslate2-tests.exe", "hikaru_asr_tokenizer.dll"}.issubset(shared_map):
        raise EvidenceError("module lock shared set is incomplete")
    executable_identity = _file_identity(identity["measurementExecutable"], "module lock measurement executable")
    loaded_executable = shared_map["hikaru-asr-ctranslate2-tests.exe"]
    if (loaded_executable["sizeBytes"], loaded_executable["sha256"]) != (executable_identity["sizeBytes"], executable_identity["sha256"]):
        raise EvidenceError("module lock loaded executable identity drifted")
    required_map = {item["name"].lower(): item for item in required_dlls}
    for name in ("ctranslate2.dll", "hikaru_asr_tokenizer.dll", "onnxruntime.dll"):
        if name in shared_map and (shared_map[name]["sizeBytes"], shared_map[name]["sha256"]) != (required_map[name]["sizeBytes"], required_map[name]["sha256"]):
            raise EvidenceError(f"module lock loaded runtime identity drifted: {name}")
    cuda_map = _module_map(sets["cudaOnlyModules"])
    for name, (size, sha256, role) in EXPECTED_CUDA_MODULES.items():
        if name not in cuda_map or (cuda_map[name]["sizeBytes"], cuda_map[name]["sha256"], cuda_map[name]["rootRole"]) != (size, sha256, role):
            raise EvidenceError(f"module lock CUDA identity drifted: {name}")
    discovery = value.get("discovery")
    if not isinstance(discovery, dict) or discovery.get("caseId") != "short-v1" or discovery.get("audioSha256") != EXPECTED_CASES["short-v1"][1] or discovery.get("excludedFromMeasurement") is not True:
        raise EvidenceError("module lock discovery identity drifted")
    _hex(discovery.get("cpuRawSha256"), "CPU discovery raw hash")
    _hex(discovery.get("cudaRawSha256"), "CUDA discovery raw hash")
    if value.get("publisherSha256") != _sha256(Path(__file__).resolve()):
        raise EvidenceError("module lock publisher identity drifted")


def _expected_modules(lock: dict[str, Any], device: str) -> list[dict[str, Any]]:
    return sorted(
        lock["sharedModules"] + lock["cpuOnlyModules" if device == "cpu" else "cudaOnlyModules"],
        key=lambda item: item["name"].lower(),
    )


def _validate_measurement(path: Path, case_id: str, device: str, lock: dict[str, Any]) -> dict[str, Any]:
    row = _validate_raw(path, discovery=False)
    if row["caseId"] != case_id or row["runtime"]["requestedDevice"] != device:
        raise EvidenceError("measurement case/device role drifted")
    if _shared_identity(row) != lock["identity"]:
        raise EvidenceError("measurement shared identity differs from module discovery lock")
    if row["runtime"]["modules"] != _expected_modules(lock, device):
        raise EvidenceError("measurement loaded-module set differs from the frozen device set")
    if device == "cuda" and row["runtime"]["gpu"] != lock["gpu"]:
        raise EvidenceError("measurement GPU identity differs from discovery")
    return row


def publish_measurements(
    short_cpu: Path,
    short_cuda: Path,
    diagnostic_cpu: Path,
    diagnostic_cuda: Path,
    module_lock_path: Path,
    evidence_output: Path,
    report_output: Path,
) -> dict[str, Any]:
    lock = _load_json(module_lock_path)
    _validate_module_lock(lock)
    rows = {
        "shortCpu": _validate_measurement(short_cpu, "short-v1", "cpu", lock),
        "shortCuda": _validate_measurement(short_cuda, "short-v1", "cuda", lock),
        "diagnosticCpu": _validate_measurement(diagnostic_cpu, "medium-v1-first-120s", "cpu", lock),
        "diagnosticCuda": _validate_measurement(diagnostic_cuda, "medium-v1-first-120s", "cuda", lock),
    }
    raw_paths = {
        "shortCpu": short_cpu,
        "shortCuda": short_cuda,
        "diagnosticCpu": diagnostic_cpu,
        "diagnosticCuda": diagnostic_cuda,
    }
    for cpu_key, cuda_key in (("shortCpu", "shortCuda"), ("diagnosticCpu", "diagnosticCuda")):
        if rows[cpu_key]["audio"] != rows[cuda_key]["audio"]:
            raise EvidenceError("paired CPU/CUDA audio identity differs")
    aggregates = {}
    ready = True
    for sample_id, cpu_key, cuda_key in (
        ("short-v1", "shortCpu", "shortCuda"),
        ("medium-v1-first-120s", "diagnosticCpu", "diagnosticCuda"),
    ):
        cpu_warm = [item["inferenceRtf"] for item in rows[cpu_key]["samples"] if item["runKind"] == "warm"]
        cuda_warm = [item["inferenceRtf"] for item in rows[cuda_key]["samples"] if item["runKind"] == "warm"]
        cpu_median = statistics.median(cpu_warm)
        cuda_median = statistics.median(cuda_warm)
        threshold = cpu_median * 0.8
        passes = cuda_median <= threshold
        ready = ready and passes
        aggregates[sample_id] = {
            "durationMs": rows[cpu_key]["audio"]["durationMs"],
            "audioSha256": rows[cpu_key]["audio"]["sha256"],
            "rawEvidenceSha256": {
                "cpu": _sha256(raw_paths[cpu_key]),
                "cuda": _sha256(raw_paths[cuda_key]),
            },
            "cpuColdLoadMs": rows[cpu_key]["samples"][0]["loadMs"],
            "gpuColdLoadMs": rows[cuda_key]["samples"][0]["loadMs"],
            "cpuColdProcessWallMs": rows[cpu_key]["samples"][0]["processWallMs"],
            "gpuColdProcessWallMs": rows[cuda_key]["samples"][0]["processWallMs"],
            "cpuWarmInferenceRtfMedian": cpu_median,
            "gpuWarmInferenceRtfMedian": cuda_median,
            "gpuToCpuRatio": cuda_median / cpu_median,
            "requiredMaximumRatio": 0.8,
            "atLeast20PercentSpeedup": passes,
            "gpuMedianRtfAtMost0_5": cuda_median <= 0.5,
        }
    result = "development-gpu-ready" if ready else "development-gpu-no-speedup"
    evidence = {
        "schemaVersion": 1,
        "kind": "hikaru-ct2-whisper-cuda-development-result",
        "developmentResult": result,
        "qualificationEligible": False,
        "decisionInputsExcludeSubtitleQuality": True,
        "publisherSha256": _sha256(Path(__file__).resolve()),
        "identity": lock["identity"],
        "gpu": lock["gpu"],
        "moduleLockSha256": _sha256(module_lock_path),
        "moduleSets": {
            "shared": lock["sharedModules"],
            "cpuOnly": lock["cpuOnlyModules"],
            "cudaOnly": lock["cudaOnlyModules"],
        },
        "samples": aggregates,
        "limitations": [
            "Ignored-local RTX 3070 development evidence only; not a runtime pack or release qualification.",
            "CER, confirmed gaps, segmentation, and timeline quality were not read or scored.",
            "RTF <= 0.5 is diagnostic for future T15 work and does not override the paired 20% rule.",
        ],
    }
    _write_json(evidence_output, evidence)
    _write_text(report_output, _report(evidence))
    return evidence


def publish_unavailable(envelope_path: Path, evidence_output: Path, report_output: Path) -> dict[str, Any]:
    envelope = _load_raw(envelope_path)
    if envelope.get("schemaVersion") != 1 or envelope.get("kind") != "hikaru-ct2-whisper-cuda-development-failure" or envelope.get("status") != "failed":
        raise EvidenceError("CUDA unavailable envelope is invalid")
    stage = envelope.get("failureStage")
    code = envelope.get("errorCode")
    if stage not in FAILURE_COMMANDS:
        raise EvidenceError("CUDA unavailable failure stage is not eligible")
    expected_code = {"configure": "cuda_configure_failed", "build": "cuda_build_failed"}.get(stage)
    if (stage == "pre-ready" and code not in SAFE_UNAVAILABLE_CODES) or (expected_code and code != expected_code):
        raise EvidenceError("CUDA unavailable error code is not eligible")
    identity = envelope.get("identity")
    expected_identity = {
        "command": FAILURE_COMMANDS[stage],
        "toolchain": EXPECTED_FAILURE_TOOLCHAIN,
        "runtime": EXPECTED_FAILURE_RUNTIME,
        "inputLockSha256": EXPECTED_INPUT_LOCK_SHA256,
    }
    if identity != expected_identity:
        raise EvidenceError("CUDA unavailable identity differs from the pinned build")
    failure = {"stage": stage, "errorCode": code, "identity": identity}
    if stage == "pre-ready":
        pre_ready = envelope.get("preReady")
        if not isinstance(pre_ready, dict) or pre_ready.get("requestedDevice") != "cuda" or pre_ready.get("readyEmitted") is not False or pre_ready.get("structuredError") is not True:
            raise EvidenceError("pre-ready CUDA failure attestation is incomplete")
        worker = _file_identity(pre_ready.get("worker"), "pre-ready worker")
        model = pre_ready.get("model")
        if not isinstance(model, dict) or (model.get("id"), model.get("revision")) != EXPECTED_MODEL:
            raise EvidenceError("pre-ready model identity drifted")
        model_files = _named_files(model.get("files"), "pre-ready model")
        if {item["name"]: (item["sizeBytes"], item["sha256"]) for item in model_files} != EXPECTED_MODEL_FILES:
            raise EvidenceError("pre-ready model files drifted")
        failure["preReady"] = {
            "requestedDevice": "cuda",
            "readyEmitted": False,
            "structuredError": True,
            "worker": worker,
            "model": {"id": model["id"], "revision": model["revision"], "files": model_files},
        }
    evidence = {
        "schemaVersion": 1,
        "kind": "hikaru-ct2-whisper-cuda-development-result",
        "developmentResult": "development-gpu-unavailable",
        "qualificationEligible": False,
        "decisionInputsExcludeSubtitleQuality": True,
        "publisherSha256": _sha256(Path(__file__).resolve()),
        "failureEnvelopeSha256": _sha256(envelope_path),
        "failure": failure,
        "limitations": ["Validated development failure only; not a product support or driver-floor statement."],
    }
    _write_json(evidence_output, evidence)
    _write_text(report_output, _report(evidence))
    return evidence


def _report(evidence: dict[str, Any]) -> str:
    result = evidence["developmentResult"]
    lines = [
        "# T07 CTranslate2 CUDA Development Result",
        "",
        f"**Development result: `{result}`.**",
        "",
        "This result is ignored-local development evidence only. It is not a publishable runtime pack or route qualification.",
        "",
    ]
    if "samples" in evidence:
        lines += [
            "| Sample | CPU warm median RTF | GPU warm median RTF | GPU/CPU | >=20% faster | GPU RTF <=0.5 diagnostic |",
            "|---|---:|---:|---:|---|---|",
        ]
        for sample_id, row in evidence["samples"].items():
            lines.append(
                f"| `{sample_id}` | `{row['cpuWarmInferenceRtfMedian']:.6f}` | "
                f"`{row['gpuWarmInferenceRtfMedian']:.6f}` | `{row['gpuToCpuRatio']:.4f}` | "
                f"`{'yes' if row['atLeast20PercentSpeedup'] else 'no'}` | "
                f"`{'yes' if row['gpuMedianRtfAtMost0_5'] else 'no'}` |"
            )
        lines += [
            "",
            "The decision reads no subtitle text and does not calculate CER, confirmed gaps, segmentation, or timeline quality.",
        ]
        if result == "development-gpu-ready":
            lines.append("T08 should use this GPU lane for repeated subtitle-quality iteration even when subtitle quality gates still fail.")
    else:
        failure = evidence["failure"]
        lines.append(f"Validated failure: stage `{failure['stage']}`, code `{failure['errorCode']}`.")
    lines += ["", "## Limitations", ""] + [f"- {item}" for item in evidence["limitations"]]
    return "\n".join(lines) + "\n"


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(data, encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def _write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(value, encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--freeze-modules", action="store_true")
    mode.add_argument("--publish-measurements", action="store_true")
    mode.add_argument("--publish-unavailable", action="store_true")
    parser.add_argument("--cpu-discovery", type=Path)
    parser.add_argument("--cuda-discovery", type=Path)
    parser.add_argument("--module-lock", type=Path)
    parser.add_argument("--short-cpu", type=Path)
    parser.add_argument("--short-cuda", type=Path)
    parser.add_argument("--diagnostic-cpu", type=Path)
    parser.add_argument("--diagnostic-cuda", type=Path)
    parser.add_argument("--failure-envelope", type=Path)
    parser.add_argument("--evidence-output", type=Path)
    parser.add_argument("--report-output", type=Path)
    args = parser.parse_args()
    try:
        if args.freeze_modules:
            if not all((args.cpu_discovery, args.cuda_discovery, args.module_lock)):
                parser.error("module freeze requires discovery inputs and --module-lock")
            result = freeze_modules(args.cpu_discovery, args.cuda_discovery, args.module_lock)
        elif args.publish_measurements:
            required = (args.short_cpu, args.short_cuda, args.diagnostic_cpu, args.diagnostic_cuda, args.module_lock, args.evidence_output, args.report_output)
            if not all(required):
                parser.error("measurement publication inputs are incomplete")
            result = publish_measurements(*required)
        else:
            if not all((args.failure_envelope, args.evidence_output, args.report_output)):
                parser.error("unavailable publication inputs are incomplete")
            result = publish_unavailable(args.failure_envelope, args.evidence_output, args.report_output)
    except EvidenceError as error:
        print(json.dumps({"status": "no-result", "error": str(error)}, sort_keys=True))
        return 2
    print(json.dumps({"status": "published", "developmentResult": result.get("developmentResult"), "kind": result["kind"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
