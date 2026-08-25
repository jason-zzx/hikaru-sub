#!/usr/bin/env python3
"""Validate T06R GPU evidence and publish deterministic quality decisions."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import re
import sys
import zlib
from pathlib import Path
from typing import Any, Sequence

REPO_ROOT = Path(__file__).resolve().parents[4]
RESEARCH_ROOT = Path(__file__).resolve().parent
LOCAL_ROOT = (RESEARCH_ROOT / "local").resolve()
PROFILE = "native-gpu-authoritative-v1"
BASELINE_PROFILE = "python-legacy-cuda-v1"
DIAGNOSTIC_KIND = "hikaru-ct2-whisper-gpu-quality-diagnostic-raw"
VAD_DIAGNOSTIC_KIND = "hikaru-ct2-whisper-gpu-quality-vad-diagnostic-raw"
FALLBACK_DIAGNOSTIC_KIND = "hikaru-ct2-whisper-gpu-quality-fallback-diagnostic-raw"
FORMAL_KIND = "hikaru-ct2-whisper-gpu-quality-candidate-raw"
VAD_MODEL = (1_245_151, "4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2")
MANIFEST_SHA256 = "3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea"
MAX_RSS_BYTES = 6 * 1024**3
MAX_GPU_RTF = 0.5
MAX_SHORT_PROCESS_WALL_MS = 120_000
QUALITY_FIELDS = (
    "cer",
    "substitutions",
    "deletions",
    "insertions",
    "emptyTextCount",
    "semanticGapCount",
    "semanticGapDurationMs",
)
DIAGNOSTIC_CELLS = {
    "short-b1-off": ("short-v1", 1, False),
    "short-b5-off": ("short-v1", 5, False),
    "medium-b1-off": ("medium-v1", 1, False),
    "medium-b1-on": ("medium-v1", 1, True),
    "medium-b5-off": ("medium-v1", 5, False),
    "medium-b5-on": ("medium-v1", 5, True),
}
VAD_DIAGNOSTIC_CELLS = {
    "short-b5-vad": ("short-v1", 5, False),
    "medium-b5-on-vad": ("medium-v1", 5, True),
}
FALLBACK_DIAGNOSTIC_CELLS = {
    "short-b5-on-vad-fallback": ("short-v1", 5, True),
    "medium-b5-on-vad-fallback": ("medium-v1", 5, True),
}
FALLBACK_TEMPERATURES = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
CASES = {
    "short-v1": {
        "durationMs": 24_102,
        "sampleCount": 385_637,
        "audioSha256": "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211",
        "assSha256": "60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b",
    },
    "medium-v1": {
        "durationMs": 498_872,
        "sampleCount": 7_981_952,
        "audioSha256": "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458",
        "assSha256": "d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e",
    },
    "long-v2": {
        "durationMs": 4_144_235,
        "audioSha256": "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e",
        "assSha256": "46b4891a4f86c70c1fe54ba4dcfbd776b361f73bb774f1d14e0f2bb53659d04b",
    },
}
MODELS = {
    "large-v3": {
        "logicalModelIdentity": "faster-whisper/large-v3",
        "id": "Systran/faster-whisper-large-v3",
        "revision": "edaa852ec7e145841d8ffdb056a99866b5f0a478",
        "files": {
            "config.json": (2_394, "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9"),
            "model.bin": (3_087_284_237, "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1"),
            "preprocessor_config.json": (340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"),
            "tokenizer.json": (2_480_617, "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"),
            "vocabulary.json": (1_068_114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"),
        },
    },
    "large-v2": {
        "logicalModelIdentity": "faster-whisper/large-v2",
        "id": "Systran/faster-whisper-large-v2",
        "revision": "f0fe81560cb8b68660e564f55dd99207059c092e",
        "files": {
            "config.json": (2_796, "d86b7a7664a12559d644aa210a32ce9a7e03913e794b7ea4fb7182de69e273a7"),
            "model.bin": (3_086_912_962, "bf2a9746382e1aa7ffff6b3a0d137ed9edbd9670c3b87e5d35f5e85e70d0333a"),
            "tokenizer.json": (2_203_239, "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"),
            "vocabulary.txt": (459_861, "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"),
        },
    },
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
FALLBACK_LOADED_MODULES = {
    item["name"].lower(): item
    for item in (
        {
            "name": "hikaru-asr-ctranslate2-tests.exe",
            "rootRole": "task-local-runtime-bin",
            "version": "",
            "sizeBytes": 978_944,
            "sha256": "1f72c282f342abc84d69f2e663d021d06b6957a44cdef83d25c44f53e5ec0e39",
        },
        {
            "name": "ctranslate2.dll",
            "rootRole": "task-local-runtime-bin",
            "version": "",
            "sizeBytes": 36_974_592,
            "sha256": "e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2",
        },
        {
            "name": "hikaru_asr_tokenizer.dll",
            "rootRole": "task-local-runtime-bin",
            "version": "",
            "sizeBytes": 2_137_088,
            "sha256": "d0ac979b132073ba76220f47e5b77538bf03ec1dcaea01fb5d9d928762939cad",
        },
        {
            "name": "onnxruntime.dll",
            "rootRole": "task-local-runtime-bin",
            "version": "1.28.0.724",
            "sizeBytes": 15_809_848,
            "sha256": "18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257",
        },
        {
            "name": "vcomp140.dll",
            "rootRole": "windows-system32",
            "version": "14.50.35719.0",
            "sizeBytes": 213_064,
            "sha256": "31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7",
        },
        {
            "name": "nvcuda.dll",
            "rootRole": "windows-system32",
            "version": "32.0.15.9649",
            "sizeBytes": 4_466_920,
            "sha256": "ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c",
        },
        {
            "name": "cublas64_12.dll",
            "rootRole": "cuda-toolkit-12.8-bin",
            "version": "6.14.11.1284",
            "sizeBytes": 113_716_224,
            "sha256": "9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99",
        },
        {
            "name": "cublasLt64_12.dll",
            "rootRole": "cuda-toolkit-12.8-bin",
            "version": "6.14.11.1284",
            "sizeBytes": 674_667_520,
            "sha256": "b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7",
        },
    )
}
FORBIDDEN_OUTPUT_KEYS = {
    "text",
    "decodedText",
    "segments",
    "tokenIds",
    "tokenTraces",
    "canonicalPath",
    "resolvedRoots",
    "audioPath",
    "modelPath",
    "stderr",
    "errorMessage",
}


class EvidenceError(ValueError):
    pass


def _load_benchmark():
    path = REPO_ROOT / "scripts" / "asr-benchmark.py"
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark_t06r", path)
    if spec is None or spec.loader is None:
        raise EvidenceError("cannot load T01 benchmark implementation")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


BENCHMARK = _load_benchmark()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def fallback_attempt_aggregate(attempt: dict[str, Any]) -> str:
    token_hash = hashlib.sha256(
        ",".join(str(token) for token in attempt["tokenIds"]).encode()
    ).hexdigest()
    text_hash = hashlib.sha256(attempt["decodedText"].encode("utf-8")).hexdigest()
    identity = "\n".join((
        format(float(attempt["temperature"]), ".17g"),
        str(attempt["beamSize"]),
        "1",
        str(attempt["numHypotheses"]),
        "default" if attempt["samplingTopK"] is None else str(attempt["samplingTopK"]),
        "default" if attempt["samplingTemperature"] is None else format(float(attempt["samplingTemperature"]), ".17g"),
        "1" if attempt["decodeMode"] == "sampling" else "0",
        format(float(attempt["averageLogProbability"]), ".17g"),
        format(float(attempt["compressionRatio"]), ".17g"),
        format(float(attempt["noSpeechProbability"]), ".17g"),
        "1" if attempt["compressionTriggered"] else "0",
        "1" if attempt["logProbabilityTriggered"] else "0",
        "1" if attempt["silenceOverride"] else "0",
        token_hash,
        text_hash,
    ))
    return hashlib.sha256(identity.encode()).hexdigest()


def _inside(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceError(f"cannot read {path.name}: {error}") from error
    if not isinstance(value, dict):
        raise EvidenceError(f"{path.name} root must be an object")
    return value


def _require_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        raise EvidenceError(f"{label} field inventory drift")


def _hex(value: Any, label: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise EvidenceError(f"{label} must be a lowercase SHA-256")
    return value


def _identity(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise EvidenceError(f"{label} identity is missing")
    size = value.get("sizeBytes")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise EvidenceError(f"{label} size is invalid")
    return {"sizeBytes": size, "sha256": _hex(value.get("sha256"), f"{label} hash")}


def _named_identities(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise EvidenceError(f"{label} identity list is empty")
    result: list[dict[str, Any]] = []
    names: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"]:
            raise EvidenceError(f"{label} name is invalid")
        key = item["name"].lower()
        if key in names:
            raise EvidenceError(f"{label} names are duplicated")
        names.add(key)
        result.append({"name": item["name"], **_identity(item, f"{label} {item['name']}")})
    return sorted(result, key=lambda item: item["name"].lower())


def expected_config(beam_size: int, history: bool) -> dict[str, Any]:
    return {
        "beamSize": beam_size,
        "patience": 1.0,
        "lengthPenalty": 1.0,
        "repetitionPenalty": 1.0,
        "noRepeatNgramSize": 0,
        "maxLength": 448,
        "temperature": 0.0,
        "conditionOnPreviousText": history,
        "timestampDrivenSeek": True,
        "promptResetOnTemperature": 0.5,
        "noSpeechThreshold": 0.6,
        "logProbThreshold": -1.0,
        "maxInitialTimestampIndex": 50,
        "modelWindowDurationMs": 30_000,
        "timestampResolutionMs": 20,
        "vad": False,
    }


def expected_vad_config(beam_size: int, history: bool) -> dict[str, Any]:
    value = expected_config(beam_size, history)
    value.update({
        "vad": True,
        "vadAlgorithm": "faster-whisper-v1.2.1-silero-v6-exact",
        "sampleRate": 16_000,
        "windowSamples": 512,
        "contextSamples": 64,
        "encoderBatchRows": 10_000,
        "threshold": 0.5,
        "negativeThreshold": 0.35,
        "minSpeechDurationMs": 0,
        "maxSpeechDurationSeconds": None,
        "minSilenceDurationMs": 2_000,
        "speechPadMs": 400,
    })
    return value


def expected_fallback_config() -> dict[str, Any]:
    value = expected_vad_config(5, True)
    value.update({
        "generationFallback": "faster-whisper-v1.2.1-exact",
        "fallbackTemperatures": FALLBACK_TEMPERATURES,
        "compressionRatioThreshold": 2.4,
        "samplingBestOf": 5,
        "samplingTopK": 0,
        "zlibVersion": "1.3.1",
    })
    return value


def _validate_model(value: Any, model_key: str, lock_text: str) -> dict[str, Any]:
    expected = MODELS[model_key]
    if not isinstance(value, dict) or value.get("id") != expected["id"] or value.get("revision") != expected["revision"]:
        raise EvidenceError(f"{model_key} repository/revision drift")
    files = _named_identities(value.get("files"), f"{model_key} model")
    actual = {item["name"]: (item["sizeBytes"], item["sha256"]) for item in files}
    if actual != expected["files"]:
        raise EvidenceError(f"{model_key} file identity drift")
    if any(sha256 not in lock_text for _size, sha256 in actual.values()):
        raise EvidenceError(f"{model_key} files are not frozen by the input lock")
    return {"key": model_key, "logicalModelIdentity": expected["logicalModelIdentity"], "files": files}


def _validate_path_policy(value: Any, lock_text: str) -> tuple[dict[str, Any], dict[str, str]]:
    roles = ["task-local-runtime-bin", "cuda-toolkit-12.8-bin", "windows-system32"]
    if (
        not isinstance(value, dict)
        or value.get("name") != "t07-windows-cuda-restricted-path-v1"
        or value.get("restricted") is not True
        or value.get("entryCount") != 3
        or value.get("orderedEntryRoles") != roles
    ):
        raise EvidenceError("restricted CUDA PATH policy drift")
    root_hash = _hex(value.get("rootIdentitySha256"), "restricted PATH root identity")
    if root_hash not in lock_text:
        raise EvidenceError("restricted PATH root identity is not frozen")
    roots = value.get("resolvedRoots")
    if not isinstance(roots, list) or len(roots) != 3:
        raise EvidenceError("restricted PATH roots are incomplete")
    root_map: dict[str, str] = {}
    for item in roots:
        if not isinstance(item, dict) or item.get("role") not in roles or not isinstance(item.get("canonicalPath"), str):
            raise EvidenceError("restricted PATH root row is invalid")
        path = os.path.normcase(os.path.normpath(item["canonicalPath"]))
        if not os.path.isabs(path) or item["role"] in root_map:
            raise EvidenceError("restricted PATH roots are not absolute and unique")
        root_map[item["role"]] = path
    if list(root_map) != roles:
        raise EvidenceError("restricted PATH root order drift")
    return {"name": value["name"], "orderedEntryRoles": roles, "rootIdentitySha256": root_hash}, root_map


def _validate_modules(
    value: Any,
    roots: dict[str, str],
    lock_text: str,
    expected: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise EvidenceError("loaded module inventory is empty")
    result: list[dict[str, Any]] = []
    names: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise EvidenceError("loaded module row is invalid")
        name = item["name"]
        key = name.lower()
        role = item.get("rootRole")
        path = item.get("canonicalPath")
        if key in names or role not in roots or not isinstance(path, str) or not os.path.isabs(path):
            raise EvidenceError("loaded module name/path/root is invalid")
        if os.path.normcase(os.path.normpath(os.path.dirname(path))) != roots[role]:
            raise EvidenceError("loaded module escaped its attested root")
        if key.startswith("cudnn"):
            raise EvidenceError("no-cuDNN candidate loaded cuDNN")
        identity = _identity(item, f"loaded module {name}")
        if identity["sha256"] not in lock_text:
            raise EvidenceError(f"loaded module is not frozen: {name}")
        version = item.get("version")
        if not isinstance(version, str):
            raise EvidenceError("loaded module version is invalid")
        names.add(key)
        result.append({"name": name, "rootRole": role, "version": version, **identity})
    required = {
        "hikaru-asr-ctranslate2-tests.exe",
        "ctranslate2.dll",
        "hikaru_asr_tokenizer.dll",
        "nvcuda.dll",
        "cublas64_12.dll",
        "cublaslt64_12.dll",
    }
    if not required.issubset(names):
        raise EvidenceError("required CUDA execution modules are missing")
    result = sorted(result, key=lambda item: item["name"].lower())
    if expected is not None and {item["name"].lower(): item for item in result} != expected:
        raise EvidenceError("loaded module inventory drift")
    return result


def _validate_runtime(
    value: Any,
    lock_text: str,
    *,
    vad: bool = False,
    fallback: bool = False,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise EvidenceError("runtime identity is missing")
    if vad:
        _require_keys(value, {
            "measurementExecutable", "productionWorker", "requiredDlls",
            "requestedDevice", "resolvedDevice", "computeType", "deviceIndex",
            "ctranslate2Version", "onnxRuntimeVersion", "vadModel",
            "cudaBuildEnabled", "cudaDynamicLoading", "withCudnn", "gpu",
            "cpu", "pathPolicy", "loadedModules",
        }, "VAD diagnostic runtime")
    if (
        value.get("requestedDevice") != "cuda"
        or value.get("resolvedDevice") != "cuda"
        or value.get("computeType") != "float16"
        or value.get("deviceIndex") != 0
        or value.get("ctranslate2Version") != "4.8.0"
        or value.get("cudaBuildEnabled") is not True
        or value.get("cudaDynamicLoading") is not True
        or value.get("withCudnn") is not False
        or value.get("gpu") != EXPECTED_GPU
    ):
        raise EvidenceError("CUDA runtime/device identity drift")
    measurement = _identity(value.get("measurementExecutable"), "measurement executable")
    worker = _identity(value.get("productionWorker"), "production worker")
    dlls = _named_identities(value.get("requiredDlls"), "runtime DLL")
    if {item["name"].lower() for item in dlls} != {
        "ctranslate2.dll",
        "hikaru_asr_tokenizer.dll",
        "onnxruntime.dll",
        "onnxruntime_providers_shared.dll",
    }:
        raise EvidenceError("runtime DLL inventory drift")
    if any(item["sha256"] not in lock_text for item in [measurement, worker, *dlls]):
        raise EvidenceError("runtime binary identity is not frozen")
    path_policy, roots = _validate_path_policy(value.get("pathPolicy"), lock_text)
    modules = _validate_modules(
        value.get("loadedModules"),
        roots,
        lock_text,
        FALLBACK_LOADED_MODULES if fallback else None,
    )
    result = {
        "measurementExecutable": measurement,
        "productionWorker": worker,
        "requiredDlls": dlls,
        "gpu": EXPECTED_GPU,
        "pathPolicy": path_policy,
        "loadedModules": modules,
    }
    if vad:
        if value.get("onnxRuntimeVersion") != "1.28.0":
            raise EvidenceError("VAD diagnostic ONNX Runtime version drift")
        vad_model = _identity(value.get("vadModel"), "Silero V6 model")
        if (vad_model["sizeBytes"], vad_model["sha256"]) != VAD_MODEL:
            raise EvidenceError("VAD diagnostic Silero V6 identity drift")
        if vad_model["sha256"] not in lock_text:
            raise EvidenceError("VAD diagnostic Silero V6 identity is not frozen")
        ort_modules = [
            item for item in modules
            if item["name"].lower() == "onnxruntime.dll"
        ]
        if len(ort_modules) != 1 or ort_modules[0]["rootRole"] != "task-local-runtime-bin":
            raise EvidenceError("VAD diagnostic did not load task-local ONNX Runtime")
        result.update({
            "onnxRuntimeVersion": "1.28.0",
            "vadModel": vad_model,
        })
    return result


def _validate_trace(
    trace: Any,
    failure_code: str | None,
    *,
    vad: bool = False,
    fallback: bool = False,
) -> tuple[int, bool, dict[str, Any] | None]:
    if not isinstance(trace, dict):
        raise EvidenceError("token trace is invalid")
    tokens = trace.get("tokenIds")
    trace_hash = _hex(trace.get("sha256"), "token trace hash")
    if not isinstance(tokens, list) or not tokens or any(not isinstance(token, int) or token < 0 for token in tokens):
        raise EvidenceError("token trace IDs are invalid")
    expected_hash = hashlib.sha256(",".join(str(token) for token in tokens).encode()).hexdigest()
    if trace_hash != expected_hash:
        raise EvidenceError("token trace hash does not match token IDs")
    failed_trace = trace.get("parseStatus") == "failed" and trace.get("parseError") == failure_code
    normal_trace = trace.get("parseStatus") in {"decoded-seek", "source-window-end", "no-speech"} and trace.get("parseError") is None
    if (
        trace.get("modelWindowDurationMs") != 30_000
        or not isinstance(trace.get("sourceWindowDurationMs"), int)
        or not 0 < trace["sourceWindowDurationMs"] <= 30_000
        or not isinstance(trace.get("generationCallCount"), int)
        or trace["generationCallCount"] < 0
        or not (normal_trace or failed_trace)
        or (vad and trace.get("vadTimestampRestored") is not True)
    ):
        raise EvidenceError("token trace contract drift")
    fallback_summary = None
    if fallback:
        _require_keys(trace, {
            "windowOffsetMs", "sourceWindowDurationMs", "modelWindowDurationMs",
            "seekFramesBefore", "seekFramesAfter", "sourceOverlapMs",
            "sourceProgressBeforeMs", "sourceProgressAfterMs", "vadTimestampRestored",
            "promptTokenCount", "historyTokenCountBefore", "historyTokenCountAfter",
            "prefixForwardTokenCount", "generatedTokenCount", "featureMs", "generateMs",
            "generationCallCount", "fallbackCallCount", "noSpeechProbability",
            "averageLogProbability", "skippedAsNoSpeech", "parseStatus", "parseError",
            "sha256", "tokenIds", "generationFallbackEnabled", "selectedAttemptIndex",
            "selectedTemperature", "compressionRatio", "fallbackAttempts",
        }, "fallback token trace")
        if zlib.ZLIB_VERSION != "1.3.1" or zlib.ZLIB_RUNTIME_VERSION != "1.3.1":
            raise EvidenceError("fallback publisher zlib identity drift")
        attempts = trace.get("fallbackAttempts")
        selected_index = trace.get("selectedAttemptIndex")
        selected_temperature = trace.get("selectedTemperature")
        average_summary = trace.get("averageLogProbability")
        no_speech_summary = trace.get("noSpeechProbability")
        compression_ratio = trace.get("compressionRatio")
        if (
            trace.get("generationFallbackEnabled") is not True
            or not isinstance(attempts, list)
            or not 1 <= len(attempts) <= len(FALLBACK_TEMPERATURES)
            or trace.get("generationCallCount") != len(attempts)
            or trace.get("fallbackCallCount") != len(attempts) - 1
            or not isinstance(selected_index, int)
            or isinstance(selected_index, bool)
            or not 0 <= selected_index < len(attempts)
            or selected_temperature not in FALLBACK_TEMPERATURES
            or not isinstance(average_summary, (int, float))
            or isinstance(average_summary, bool)
            or not math.isfinite(average_summary)
            or not isinstance(no_speech_summary, (int, float))
            or isinstance(no_speech_summary, bool)
            or not math.isfinite(no_speech_summary)
            or not isinstance(compression_ratio, (int, float))
            or isinstance(compression_ratio, bool)
            or not math.isfinite(compression_ratio)
        ):
            raise EvidenceError("fallback trace summary drift")
        validated_attempts = []
        trigger_counts = {"compression": 0, "logProbability": 0, "silenceOverride": 0}
        for index, attempt in enumerate(attempts):
            _require_keys(attempt, {
                "temperature", "decodeMode", "beamSize", "patience",
                "numHypotheses", "samplingTopK", "samplingTemperature",
                "tokenIds", "score", "averageLogProbability", "noSpeechProbability", "decodedText",
                "compressionRatio", "compressionTriggered",
                "logProbabilityTriggered", "silenceOverride", "aggregateSha256",
            }, "fallback attempt")
            temperature = attempt.get("temperature")
            sampling = index > 0
            sampling_temperature = attempt.get("samplingTemperature")
            token_ids = attempt.get("tokenIds")
            score = attempt.get("score")
            average = attempt.get("averageLogProbability")
            no_speech = attempt.get("noSpeechProbability")
            decoded_text = attempt.get("decodedText")
            ratio = attempt.get("compressionRatio")
            if (
                temperature != FALLBACK_TEMPERATURES[index]
                or attempt.get("decodeMode") != ("sampling" if sampling else "beam")
                or attempt.get("beamSize") != (1 if sampling else 5)
                or attempt.get("patience") != (None if sampling else 1.0)
                or attempt.get("numHypotheses") != (5 if sampling else 1)
                or attempt.get("samplingTopK") != (0 if sampling else None)
                or sampling_temperature != (temperature if sampling else None)
                or not isinstance(token_ids, list)
                or not token_ids
                or any(not isinstance(token, int) or isinstance(token, bool) or token < 0 for token in token_ids)
                or not isinstance(score, (int, float))
                or isinstance(score, bool)
                or not math.isfinite(score)
                or not isinstance(average, (int, float))
                or isinstance(average, bool)
                or not math.isfinite(average)
                or not isinstance(no_speech, (int, float))
                or isinstance(no_speech, bool)
                or not math.isfinite(no_speech)
                or not isinstance(decoded_text, str)
                or not isinstance(ratio, (int, float))
                or isinstance(ratio, bool)
                or not math.isfinite(ratio)
                or any(not isinstance(attempt.get(key), bool) for key in (
                    "compressionTriggered", "logProbabilityTriggered", "silenceOverride"
                ))
            ):
                raise EvidenceError("fallback attempt option/metric drift")
            expected_average = float(score) * len(token_ids) / (len(token_ids) + 1)
            stripped = decoded_text.strip().encode("utf-8")
            expected_ratio = len(stripped) / len(zlib.compress(stripped))
            if float(average) != expected_average or float(ratio) != expected_ratio:
                raise EvidenceError("fallback attempt aggregate source drift")
            if attempt["compressionTriggered"] != (expected_ratio > 2.4):
                raise EvidenceError("fallback compression predicate drift")
            if attempt["logProbabilityTriggered"] != (expected_average < -1.0):
                raise EvidenceError("fallback log-probability predicate drift")
            if attempt["silenceOverride"] != (no_speech > 0.6 and expected_average < -1.0):
                raise EvidenceError("fallback silence override drift")
            aggregate = _hex(attempt.get("aggregateSha256"), "fallback attempt aggregate")
            if aggregate != fallback_attempt_aggregate(attempt):
                raise EvidenceError("fallback attempt aggregate binding drift")
            for key, source in (
                ("compression", "compressionTriggered"),
                ("logProbability", "logProbabilityTriggered"),
                ("silenceOverride", "silenceOverride"),
            ):
                trigger_counts[key] += int(attempt[source])
            validated_attempts.append(aggregate)
        needs_fallback = [
            (attempt["compressionTriggered"] or attempt["logProbabilityTriggered"])
            and not attempt["silenceOverride"]
            for attempt in attempts
        ]
        if any(not value for value in needs_fallback[:-1]):
            raise EvidenceError("fallback continued after a passing attempt")
        if not needs_fallback[-1]:
            expected_selected_index = len(attempts) - 1
            expected_temperature = attempts[-1]["temperature"]
        else:
            if len(attempts) != len(FALLBACK_TEMPERATURES):
                raise EvidenceError("fallback stopped before exhausting failed attempts")
            eligible = [
                index for index, attempt in enumerate(attempts)
                if not attempt["compressionTriggered"]
            ] or list(range(len(attempts)))
            expected_selected_index = max(
                eligible, key=lambda index: attempts[index]["averageLogProbability"]
            )
            expected_temperature = FALLBACK_TEMPERATURES[-1]
        selected = attempts[expected_selected_index]
        if (
            selected_index != expected_selected_index
            or selected_temperature != expected_temperature
            or tokens != selected["tokenIds"]
            or float(compression_ratio) != float(selected["compressionRatio"])
            or float(average_summary) != float(selected["averageLogProbability"])
            or float(no_speech_summary) != float(selected["noSpeechProbability"])
        ):
            raise EvidenceError("fallback selected result drift")
        fallback_summary = {
            "attemptCount": len(attempts),
            "selectedTemperature": selected_temperature,
            "triggerCounts": trigger_counts,
            "attemptAggregateSha256": canonical_hash(validated_attempts),
        }
    return trace["generationCallCount"], failed_trace, fallback_summary


def _round_samples_to_10ms(sample: int) -> int:
    if sample < 0:
        raise EvidenceError("restored VAD sample is negative")
    units, remainder = divmod(sample, 160)
    if remainder > 80 or (remainder == 80 and units % 2):
        units += 1
    return units * 10


def _restore_vad_time_ms(
    intervals: Sequence[dict[str, Any]],
    compressed_time_ms: int,
    *,
    is_end: bool,
) -> int:
    if compressed_time_ms < 0:
        raise EvidenceError("compressed VAD timestamp is negative")
    compressed_sample = compressed_time_ms * 16
    index = None
    if is_end:
        index = next((i for i, item in enumerate(intervals) if item["compressedEndSample"] == compressed_sample), None)
    if index is None:
        index = next((i for i, item in enumerate(intervals) if compressed_sample < item["compressedEndSample"]), len(intervals) - 1)
    return _round_samples_to_10ms(
        compressed_sample + intervals[index]["silenceBeforeSamples"]
    )


def _validate_sample(
    value: Any,
    case_id: str,
    run_kind: str,
    repeat_index: int,
    *,
    vad: bool = False,
    fallback: bool = False,
) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("runKind") != run_kind or value.get("repeatIndex") != repeat_index:
        raise EvidenceError("sample role/repeat drift")
    if vad:
        _require_keys(value, {
            "status", "runKind", "repeatIndex", "segments", "tokenTraces",
            "generationCompleted", "generationCallCount", "failure", "timings",
            "progressMs", "vad",
        }, "VAD diagnostic sample")
    status = value.get("status")
    failure = value.get("failure")
    if status == "completed":
        if failure is not None or value.get("generationCompleted") is not True:
            raise EvidenceError("completed diagnostic sample has inconsistent failure state")
        failure_code = None
    elif status == "failed":
        if (
            not isinstance(failure, dict)
            or not isinstance(failure.get("code"), str)
            or not failure["code"]
            or value.get("generationCompleted") is not False
        ):
            raise EvidenceError("failed diagnostic sample has no complete structured failure")
        failure_code = failure["code"]
    else:
        raise EvidenceError("diagnostic sample status is invalid")
    traces = value.get("tokenTraces")
    segments = value.get("segments")
    if not isinstance(traces, list) or not traces or not isinstance(segments, list):
        raise EvidenceError("sample private trace/segment payload is incomplete")
    validated_traces = [
        _validate_trace(trace, failure_code, vad=vad, fallback=fallback)
        for trace in traces
    ]
    generation_calls = sum(item[0] for item in validated_traces)
    failed_trace_indices = [index for index, item in enumerate(validated_traces) if item[1]]
    if failure_code is None and failed_trace_indices:
        raise EvidenceError("completed sample contains a failed trace")
    if failure_code is not None and failed_trace_indices != [len(traces) - 1]:
        raise EvidenceError("structured failure must bind exactly one final failed trace")
    if generation_calls <= 0 or value.get("generationCallCount") != generation_calls:
        raise EvidenceError("sample generation-call attestation drift")
    for segment in segments:
        if (
            not isinstance(segment, dict)
            or not isinstance(segment.get("startMs"), int)
            or not isinstance(segment.get("endMs"), int)
            or not isinstance(segment.get("text"), str)
        ):
            raise EvidenceError("sample segment payload is invalid")
        if vad:
            _require_keys(segment, {
                "startMs", "endMs", "text", "rawStartMs", "rawEndMs",
                "endBoundedToAudio", "compressedStartMs", "compressedEndMs",
                "vadTimestampRestored", "timestampStartToken", "timestampEndToken",
                "tokenIds", "traceSha256",
            }, "VAD diagnostic segment")
        if vad and (
            segment.get("vadTimestampRestored") is not True
            or not isinstance(segment.get("compressedStartMs"), int)
            or not isinstance(segment.get("compressedEndMs"), int)
            or not isinstance(segment.get("rawStartMs"), int)
            or not isinstance(segment.get("rawEndMs"), int)
            or segment["compressedEndMs"] <= segment["compressedStartMs"]
            or segment["rawEndMs"] <= segment["rawStartMs"]
        ):
            raise EvidenceError("VAD segment restoration provenance is invalid")
    timings = value.get("timings")
    if not isinstance(timings, dict):
        raise EvidenceError("sample timings are missing")
    if vad:
        _require_keys(timings, {
            "loadMs", "sampleWallMs", "featureMs", "modelGenerateMs",
            "inferenceMs", "inferenceRtf", "processWallMs", "processWallRtf",
            "vadMs",
        }, "VAD diagnostic timings")
    numeric: dict[str, float] = {}
    timing_keys = (
        "loadMs", "sampleWallMs", "featureMs", "modelGenerateMs",
        "inferenceMs", "inferenceRtf", "processWallMs", "processWallRtf",
    ) + (("vadMs",) if vad else ())
    for key in timing_keys:
        item = timings.get(key)
        if not isinstance(item, (int, float)) or isinstance(item, bool) or not math.isfinite(item) or item < 0:
            raise EvidenceError(f"sample timing is invalid: {key}")
        numeric[key] = float(item)
    duration = CASES[case_id]["durationMs"]
    if (
        numeric["loadMs"] <= 0
        or numeric["sampleWallMs"] < numeric["inferenceMs"]
        or numeric["inferenceMs"] < numeric["featureMs"] + numeric["modelGenerateMs"]
        or not math.isclose(numeric["inferenceRtf"], numeric["inferenceMs"] / duration, rel_tol=1e-9, abs_tol=1e-12)
        or numeric["processWallMs"] < numeric["loadMs"] + numeric["sampleWallMs"]
        or not math.isclose(numeric["processWallRtf"], numeric["processWallMs"] / duration, rel_tol=1e-9, abs_tol=1e-12)
    ):
        raise EvidenceError("sample timing components are inconsistent")
    vad_summary = None
    if vad:
        vad_value = value.get("vad")
        progress = value.get("progressMs")
        if not isinstance(vad_value, dict) or not isinstance(progress, list):
            raise EvidenceError("VAD sample provenance is missing")
        _require_keys(vad_value, {
            "inferenceMs", "originalSampleCount", "compressedSampleCount",
            "rowCount", "batchCount", "intervals",
        }, "VAD diagnostic summary")
        original = vad_value.get("originalSampleCount")
        compressed = vad_value.get("compressedSampleCount")
        row_count = vad_value.get("rowCount")
        batch_count = vad_value.get("batchCount")
        intervals = vad_value.get("intervals")
        vad_inference = vad_value.get("inferenceMs")
        expected_original = CASES[case_id]["sampleCount"]
        if (
            original != expected_original
            or not isinstance(compressed, int)
            or not 0 < compressed <= original
            or row_count != original // 512 + 1
            or batch_count != (row_count + 9_999) // 10_000
            or not isinstance(intervals, list)
            or not intervals
            or not isinstance(vad_inference, (int, float))
            or isinstance(vad_inference, bool)
            or not math.isfinite(vad_inference)
            or not math.isclose(vad_inference, numeric["vadMs"], rel_tol=1e-9, abs_tol=1e-9)
        ):
            raise EvidenceError("VAD sample counts/timing drift")
        previous_end = cumulative_silence = compressed_end = 0
        for interval in intervals:
            if not isinstance(interval, dict):
                raise EvidenceError("VAD interval row is invalid")
            _require_keys(interval, {
                "startSample", "endSample", "compressedEndSample",
                "silenceBeforeSamples",
            }, "VAD diagnostic interval")
            start = interval.get("startSample")
            end = interval.get("endSample")
            if (
                not isinstance(start, int)
                or not isinstance(end, int)
                or start < previous_end
                or end <= start
                or end > original
            ):
                raise EvidenceError("VAD interval range is invalid")
            cumulative_silence += start - previous_end
            compressed_end += end - start
            if (
                interval.get("silenceBeforeSamples") != cumulative_silence
                or interval.get("compressedEndSample") != compressed_end
            ):
                raise EvidenceError("VAD interval restoration map drift")
            previous_end = end
        if compressed != compressed_end:
            raise EvidenceError("VAD compressed sample count drift")
        if any(not isinstance(item, int) or item < 0 or item > CASES[case_id]["durationMs"] for item in progress):
            raise EvidenceError("VAD restored progress is invalid")
        if progress != sorted(progress) or (status == "completed" and (not progress or progress[-1] != CASES[case_id]["durationMs"])):
            raise EvidenceError("VAD restored progress contract drift")
        trace_hashes = {trace["sha256"] for trace in traces}
        duration_ms = CASES[case_id]["durationMs"]
        for segment in segments:
            token_ids = segment.get("tokenIds")
            trace_sha256 = segment.get("traceSha256")
            if (
                not isinstance(token_ids, list)
                or len(token_ids) < 2
                or any(not isinstance(token, int) or token < 0 for token in token_ids)
                or segment.get("timestampStartToken") != token_ids[0]
                or segment.get("timestampEndToken") != token_ids[-1]
                or trace_sha256 not in trace_hashes
                or not isinstance(segment.get("endBoundedToAudio"), bool)
            ):
                raise EvidenceError("VAD segment token/trace provenance is invalid")
            restored_start = _restore_vad_time_ms(
                intervals, segment["compressedStartMs"], is_end=False
            )
            restored_raw_end = _restore_vad_time_ms(
                intervals, segment["compressedEndMs"], is_end=True
            )
            restored_end = min(restored_raw_end, duration_ms)
            if (
                segment["rawStartMs"] != restored_start
                or segment["rawEndMs"] != restored_raw_end
                or segment["startMs"] != restored_start
                or segment["endMs"] != restored_end
                or segment["endBoundedToAudio"] != (restored_raw_end != restored_end)
                or restored_start >= duration_ms
                or restored_end <= restored_start
            ):
                raise EvidenceError("VAD segment restoration map drift")
        vad_summary = {
            "originalSampleCount": original,
            "compressedSampleCount": compressed,
            "rowCount": row_count,
            "batchCount": batch_count,
            "intervalCount": len(intervals),
        }
    fallback_summaries = [item[2] for item in validated_traces if item[2] is not None]
    fallback_summary = None
    if fallback:
        if len(fallback_summaries) != len(traces):
            raise EvidenceError("fallback trace coverage is incomplete")
        trigger_counts = {"compression": 0, "logProbability": 0, "silenceOverride": 0}
        temperatures: dict[str, int] = {}
        aggregates = []
        for summary in fallback_summaries:
            for key in trigger_counts:
                trigger_counts[key] += summary["triggerCounts"][key]
            temperature = format(summary["selectedTemperature"], ".1f")
            temperatures[temperature] = temperatures.get(temperature, 0) + 1
            aggregates.append(summary["attemptAggregateSha256"])
        fallback_summary = {
            "windowCount": len(fallback_summaries),
            "generationCallCount": generation_calls,
            "fallbackCallCount": generation_calls - len(fallback_summaries),
            "selectedTemperatureCounts": dict(sorted(temperatures.items())),
            "triggerCounts": trigger_counts,
            "attemptAggregateSha256": canonical_hash(aggregates),
        }
    return {
        "status": status,
        "failureCode": failure_code,
        "segments": segments,
        "timings": numeric,
        "vad": vad_summary,
        "fallback": fallback_summary,
    }


def _validate_diagnostic_raw(
    path: Path,
    cell_id: str,
    lock_path: Path,
    *,
    vad: bool,
    fallback: bool = False,
) -> dict[str, Any]:
    if not _inside(LOCAL_ROOT, path):
        raise EvidenceError("diagnostic raw is outside the canonical T06R local root")
    raw = _read_json(path)
    if vad:
        _require_keys(raw, {
            "schemaVersion", "kind", "status", "qualificationEligible",
            "comparisonProfile", "candidateId", "diagnosticCell", "caseId",
            "engine", "model", "audio", "algorithm", "config",
            "inputLockSha256", "runtime", "samples", "resources",
        }, "VAD diagnostic envelope")
        _require_keys(raw.get("model"), {"id", "revision", "files"}, "VAD diagnostic model")
        _require_keys(raw.get("audio"), {"sha256", "durationMs"}, "VAD diagnostic audio")
        _require_keys(raw.get("resources"), {"peakProcessRssBytes", "method"}, "VAD diagnostic resources")
    cells = (
        FALLBACK_DIAGNOSTIC_CELLS
        if fallback
        else (VAD_DIAGNOSTIC_CELLS if vad else DIAGNOSTIC_CELLS)
    )
    if cell_id not in cells:
        raise EvidenceError("diagnostic cell is not allowed")
    case_id, beam_size, history = cells[cell_id]
    lock_text = lock_path.read_text(encoding="utf-8")
    lock_sha256 = sha256_file(lock_path)
    raw_status = raw.get("status")
    if (
        raw.get("schemaVersion") != 1
        or raw.get("kind") != (
            FALLBACK_DIAGNOSTIC_KIND
            if fallback
            else (VAD_DIAGNOSTIC_KIND if vad else DIAGNOSTIC_KIND)
        )
        or raw_status not in {"completed", "failed"}
        or raw.get("qualificationEligible") is not False
        or raw.get("comparisonProfile") != PROFILE
        or raw.get("candidateId") != cell_id
        or raw.get("diagnosticCell") != cell_id
        or raw.get("caseId") != case_id
        or raw.get("engine") != "faster-whisper"
        or raw.get("algorithm") != (
            "upstream-generation-fallback-parity-v1"
            if fallback
            else (
                "ordinary-whisper-timestamp-driven-silero-v6"
                if vad else "ordinary-whisper-timestamp-driven"
            )
        )
        or raw.get("config") != (
            expected_fallback_config()
            if fallback
            else (
                expected_vad_config(beam_size, history)
                if vad else expected_config(beam_size, history)
            )
        )
        or raw.get("inputLockSha256") != lock_sha256
    ):
        raise EvidenceError(f"diagnostic envelope/config drift: {cell_id}")
    expected_case = CASES[case_id]
    if raw.get("audio") != {"sha256": expected_case["audioSha256"], "durationMs": expected_case["durationMs"]}:
        raise EvidenceError(f"diagnostic corpus identity drift: {cell_id}")
    model = _validate_model(raw.get("model"), "large-v3", lock_text)
    runtime = _validate_runtime(raw.get("runtime"), lock_text, vad=vad, fallback=fallback)
    resources = raw.get("resources")
    if (
        not isinstance(resources, dict)
        or resources.get("method") != "GetProcessMemoryInfo.PeakWorkingSetSize"
        or not isinstance(resources.get("peakProcessRssBytes"), int)
        or resources["peakProcessRssBytes"] <= 0
    ):
        raise EvidenceError("diagnostic resource evidence is invalid")
    samples = raw.get("samples")
    if not isinstance(samples, list) or len(samples) != 1:
        raise EvidenceError("diagnostic must contain exactly one sample")
    sample = _validate_sample(
        samples[0],
        case_id,
        "fallback-diagnostic" if fallback else ("vad-diagnostic" if vad else "diagnostic"),
        1,
        vad=vad,
        fallback=fallback,
    )
    if sample["status"] != raw_status:
        raise EvidenceError("diagnostic envelope/sample status drift")
    return {
        "cellId": cell_id,
        "caseId": case_id,
        "beamSize": beam_size,
        "conditionOnPreviousText": history,
        "vadEnabled": vad,
        "status": sample["status"],
        "failureCode": sample["failureCode"],
        "model": model,
        "runtime": runtime,
        "segments": sample["segments"],
        "timings": sample["timings"],
        "vad": sample["vad"],
        "fallback": sample["fallback"],
        "peakProcessRssBytes": resources["peakProcessRssBytes"],
        "rawEvidenceSha256": sha256_file(path),
    }


def validate_diagnostic_raw(path: Path, cell_id: str, lock_path: Path) -> dict[str, Any]:
    return _validate_diagnostic_raw(path, cell_id, lock_path, vad=False)


def validate_vad_diagnostic_raw(path: Path, cell_id: str, lock_path: Path) -> dict[str, Any]:
    return _validate_diagnostic_raw(path, cell_id, lock_path, vad=True)


def validate_fallback_diagnostic_raw(path: Path, cell_id: str, lock_path: Path) -> dict[str, Any]:
    return _validate_diagnostic_raw(path, cell_id, lock_path, vad=True, fallback=True)


def _baseline_index(baseline: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    if (
        baseline.get("kind") != "hikaru-asr-python-legacy-baseline"
        or baseline.get("comparisonProfile") != BASELINE_PROFILE
        or baseline.get("authorityDisposition") != "complete"
    ):
        raise EvidenceError("Python legacy baseline authority drift")
    result: dict[tuple[str, str], dict[str, Any]] = {}
    for model in baseline.get("models", []):
        logical_id = model.get("logicalModelIdentity")
        for case in model.get("cases", []):
            key = (logical_id, case.get("caseId"))
            if key in result:
                raise EvidenceError("Python legacy baseline contains duplicate rows")
            result[key] = case
    return result


def _quality(metrics: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    cer = metrics["cer"]
    timeline = metrics["timeline"]
    gaps = metrics["missingSpeechRegions"]
    quality = {
        "cer": cer["cer"],
        "substitutions": cer["substitutions"],
        "deletions": cer["deletions"],
        "insertions": cer["insertions"],
        "emptyTextCount": timeline["emptyTextCount"],
        "semanticGapCount": len(gaps),
        "semanticGapDurationMs": sum(item["endMs"] - item["startMs"] for item in gaps),
    }
    structural = {
        "negativeStartCount": timeline["negativeStartCount"],
        "nonPositiveDurationCount": timeline["nonPositiveDurationCount"],
        "afterAudioEndCount": timeline["afterAudioEndCount"],
        "nonMonotonicCount": timeline["nonMonotonicCount"],
        "segmentCount": timeline["segmentCount"],
    }
    return quality, structural


def _score_diagnostic(
    validated: dict[str, Any],
    manifest_validation: dict[str, Any],
    baselines: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    case_id = validated["caseId"]
    timings = validated["timings"]
    base_engineering = {
        "gpuInferenceRtf": timings["inferenceRtf"],
        "gpuInferenceRtfPass": timings["inferenceRtf"] <= MAX_GPU_RTF,
        "processWallMs": timings["processWallMs"],
        "shortProcessWallPass": case_id != "short-v1" or timings["processWallMs"] <= MAX_SHORT_PROCESS_WALL_MS,
        "peakProcessRssBytes": validated["peakProcessRssBytes"],
        "peakProcessRssPass": validated["peakProcessRssBytes"] <= MAX_RSS_BYTES,
    }
    if validated["status"] == "failed":
        return {
            "cellId": validated["cellId"],
            "caseId": case_id,
            "beamSize": validated["beamSize"],
            "conditionOnPreviousText": validated["conditionOnPreviousText"],
            "vadEnabled": validated["vadEnabled"],
            "vad": validated["vad"],
            "fallback": validated["fallback"],
            "quality": None,
            "structural": None,
            "comparisons": {},
            "engineering": {**base_engineering, "timelinePass": False},
            "failureCode": validated["failureCode"],
            "disposition": "stop-revise",
            "rawEvidenceSha256": validated["rawEvidenceSha256"],
        }
    truth = next((item for item in manifest_validation["cases"] if item["id"] == case_id), None)
    if truth is None:
        raise EvidenceError(f"authoritative case is missing: {case_id}")
    reference = truth["reference"]
    metrics = BENCHMARK._sample_metrics(
        reference["text"],
        reference["segments"],
        reference["speechIntervals"],
        validated["segments"],
        truth["durationMs"],
        "engine-native",
        "faster-whisper",
    )
    quality, structural = _quality(metrics)
    baseline = baselines.get(("faster-whisper/large-v3", case_id))
    if baseline is None or baseline.get("status") != "completed" or baseline.get("corpusIdentity", {}).get("audioSha256") != CASES[case_id]["audioSha256"]:
        raise EvidenceError(f"matching Python baseline is missing: large-v3/{case_id}")
    baseline_quality = baseline.get("quality")
    if not isinstance(baseline_quality, dict) or any(field not in baseline_quality for field in QUALITY_FIELDS):
        raise EvidenceError(f"matching Python baseline quality is incomplete: {case_id}")
    comparisons = {
        field: {
            "baseline": baseline_quality[field],
            "native": quality[field],
            "delta": quality[field] - baseline_quality[field],
            "disposition": "qualified" if quality[field] <= baseline_quality[field] else "stop-revise",
        }
        for field in QUALITY_FIELDS
    }
    engineering = {
        **base_engineering,
        "timelinePass": all(structural[field] == 0 for field in (
            "negativeStartCount", "nonPositiveDurationCount", "afterAudioEndCount", "nonMonotonicCount"
        )),
    }
    qualified = all(item["disposition"] == "qualified" for item in comparisons.values()) and all(
        engineering[field]
        for field in ("gpuInferenceRtfPass", "shortProcessWallPass", "peakProcessRssPass", "timelinePass")
    )
    return {
        "cellId": validated["cellId"],
        "caseId": case_id,
        "beamSize": validated["beamSize"],
        "conditionOnPreviousText": validated["conditionOnPreviousText"],
        "vadEnabled": validated["vadEnabled"],
        "vad": validated["vad"],
        "fallback": validated["fallback"],
        "quality": quality,
        "structural": structural,
        "comparisons": comparisons,
        "engineering": engineering,
        "disposition": "qualified" if qualified else "stop-revise",
        "rawEvidenceSha256": validated["rawEvidenceSha256"],
    }


def select_diagnostic_candidate(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    by_cell = {row["cellId"]: row for row in rows}
    if set(by_cell) != set(DIAGNOSTIC_CELLS):
        raise EvidenceError("diagnostic row inventory is incomplete")
    eligible: list[dict[str, Any]] = []
    for beam_size in (1, 5):
        short = by_cell[f"short-b{beam_size}-off"]
        for history in (False, True):
            medium = by_cell[f"medium-b{beam_size}-{'on' if history else 'off'}"]
            if short["disposition"] == "qualified" and medium["disposition"] == "qualified":
                eligible.append({
                    "beamSize": beam_size,
                    "conditionOnPreviousText": history,
                    "shortCell": short["cellId"],
                    "mediumCell": medium["cellId"],
                    "mediumGpuInferenceRtf": medium["engineering"]["gpuInferenceRtf"],
                })
    if not eligible:
        return {"status": "no-candidate-selected", "eligible": []}
    eligible.sort(key=lambda item: (
        item["mediumGpuInferenceRtf"],
        item["beamSize"],
        item["conditionOnPreviousText"],
    ))
    return {"status": "selected", "selected": eligible[0], "eligible": eligible}


def select_vad_diagnostic_candidate(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    by_cell = {row["cellId"]: row for row in rows}
    if set(by_cell) != set(VAD_DIAGNOSTIC_CELLS):
        raise EvidenceError("VAD diagnostic row inventory is incomplete")
    short = by_cell["short-b5-vad"]
    medium = by_cell["medium-b5-on-vad"]
    if short["disposition"] != "qualified" or medium["disposition"] != "qualified":
        return {"status": "no-candidate-selected", "eligible": []}
    selected = {
        "beamSize": 5,
        "conditionOnPreviousText": True,
        "vadAlgorithm": "faster-whisper-v1.2.1-silero-v6-exact",
        "shortCell": short["cellId"],
        "mediumCell": medium["cellId"],
        "mediumGpuInferenceRtf": medium["engineering"]["gpuInferenceRtf"],
    }
    return {"status": "selected", "selected": selected, "eligible": [selected]}


def select_fallback_diagnostic_candidate(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    by_cell = {row["cellId"]: row for row in rows}
    if set(by_cell) != set(FALLBACK_DIAGNOSTIC_CELLS):
        raise EvidenceError("fallback diagnostic row inventory is incomplete")
    short = by_cell["short-b5-on-vad-fallback"]
    medium = by_cell["medium-b5-on-vad-fallback"]
    if short["disposition"] != "qualified" or medium["disposition"] != "qualified":
        return {"status": "no-candidate-selected", "eligible": []}
    selected = {
        "candidateId": "upstream-generation-fallback-parity-v1",
        "beamSize": 5,
        "conditionOnPreviousText": True,
        "vadAlgorithm": "faster-whisper-v1.2.1-silero-v6-exact",
        "generationFallback": "faster-whisper-v1.2.1-exact",
        "shortCell": short["cellId"],
        "mediumCell": medium["cellId"],
        "mediumGpuInferenceRtf": medium["engineering"]["gpuInferenceRtf"],
    }
    return {"status": "selected", "selected": selected, "eligible": [selected]}


def privacy_scan(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in FORBIDDEN_OUTPUT_KEYS:
                raise EvidenceError(f"tracked publication contains forbidden key: {key}")
            privacy_scan(item)
    elif isinstance(value, list):
        for item in value:
            privacy_scan(item)
    elif isinstance(value, str):
        normalized = value.replace("\\", "/")
        if re.search(r"(^|[^A-Za-z])[A-Za-z]:/", normalized) or "research/local/" in normalized:
            raise EvidenceError("tracked publication contains a private path")


def _atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def render_diagnostic_markdown(
    publication: dict[str, Any],
    title: str = "Native Faster-Whisper GPU diagnostic",
) -> str:
    lines = [
        f"# {title}",
        "",
        f"**Selection: `{publication['selection']['status']}`.**",
        "",
        "| Cell | Case | CER | S/D/I | Gaps | GPU RTF | RSS MiB | Result |",
        "|---|---|---:|---:|---:|---:|---:|---|",
    ]
    for row in publication["rows"]:
        quality = row["quality"]
        quality_cells = (
            (f"{quality['cer']:.6f}", f"{quality['substitutions']}/{quality['deletions']}/{quality['insertions']}", str(quality["semanticGapCount"]))
            if quality is not None
            else ("-", "-", "-")
        )
        result = row["disposition"] if row.get("failureCode") is None else f"{row['disposition']}:{row['failureCode']}"
        lines.append(
            f"| `{row['cellId']}` | `{row['caseId']}` | `{quality_cells[0]}` | "
            f"`{quality_cells[1]}` | `{quality_cells[2]}` | "
            f"`{row['engineering']['gpuInferenceRtf']:.6f}` | "
            f"`{row['engineering']['peakProcessRssBytes'] / 1024**2:.1f}` | `{result}` |"
        )
    lines.extend(["", "Diagnostic rows are selection-only and cannot be promoted to formal evidence.", ""])
    return "\n".join(lines)


def publish_diagnostic(
    raw_dir: Path,
    input_lock: Path,
    manifest: Path,
    corpus_root: Path,
    baseline_path: Path,
    json_output: Path,
    report_output: Path,
) -> dict[str, Any]:
    if not input_lock.is_file() or not _inside(RESEARCH_ROOT, input_lock) or _inside(LOCAL_ROOT, input_lock):
        raise EvidenceError("diagnostic input lock must be a tracked T06R research file")
    if sha256_file(manifest) != MANIFEST_SHA256:
        raise EvidenceError("benchmark manifest identity drift")
    manifest_validation = BENCHMARK.validate_manifest(manifest, corpus_root)
    if manifest_validation["manifestSha256"] != MANIFEST_SHA256:
        raise EvidenceError("validated benchmark manifest identity drift")
    baseline = _read_json(baseline_path)
    baselines = _baseline_index(baseline)
    validated = [
        validate_diagnostic_raw(raw_dir / f"{cell_id}.json", cell_id, input_lock)
        for cell_id in DIAGNOSTIC_CELLS
    ]
    runtime_hashes = {canonical_hash(row["runtime"]) for row in validated}
    model_hashes = {canonical_hash(row["model"]) for row in validated}
    if len(runtime_hashes) != 1 or len(model_hashes) != 1:
        raise EvidenceError("diagnostic rows do not share one runtime/model identity")
    rows = [_score_diagnostic(row, manifest_validation, baselines) for row in validated]
    publication = {
        "schemaVersion": 1,
        "kind": "hikaru-native-whisper-gpu-quality-diagnostic",
        "comparisonProfile": PROFILE,
        "qualificationEligible": False,
        "authority": {
            "benchmarkManifestSha256": MANIFEST_SHA256,
            "benchmarkRunnerSha256": sha256_file(REPO_ROOT / "scripts" / "asr-benchmark.py"),
            "pythonLegacyBaselineSha256": sha256_file(baseline_path),
            "inputLockSha256": sha256_file(input_lock),
            "publisherSha256": sha256_file(Path(__file__)),
            "runtimeIdentitySha256": next(iter(runtime_hashes)),
            "modelIdentitySha256": next(iter(model_hashes)),
        },
        "rows": rows,
        "selection": select_diagnostic_candidate(rows),
        "limitations": [
            "Selection-only large-v3 short/medium evidence; no formal qualification claim.",
            "No CPU model-backed measurements were acquired.",
            "T14/T15 must rebuild and rerun the selected algorithm under the final GPU pack identity.",
        ],
    }
    privacy_scan(publication)
    _atomic_write_json(json_output, publication)
    report_output.parent.mkdir(parents=True, exist_ok=True)
    temporary = report_output.with_suffix(report_output.suffix + ".tmp")
    temporary.write_text(render_diagnostic_markdown(publication), encoding="utf-8")
    temporary.replace(report_output)
    return publication


def publish_vad_diagnostic(
    raw_dir: Path,
    input_lock: Path,
    manifest: Path,
    corpus_root: Path,
    baseline_path: Path,
    json_output: Path,
    report_output: Path,
) -> dict[str, Any]:
    if not input_lock.is_file() or not _inside(RESEARCH_ROOT, input_lock) or _inside(LOCAL_ROOT, input_lock):
        raise EvidenceError("VAD diagnostic input lock must be a tracked T06R research file")
    if sha256_file(manifest) != MANIFEST_SHA256:
        raise EvidenceError("benchmark manifest identity drift")
    manifest_validation = BENCHMARK.validate_manifest(manifest, corpus_root)
    if manifest_validation["manifestSha256"] != MANIFEST_SHA256:
        raise EvidenceError("validated benchmark manifest identity drift")
    baseline = _read_json(baseline_path)
    baselines = _baseline_index(baseline)
    validated = [
        validate_vad_diagnostic_raw(raw_dir / f"{cell_id}.json", cell_id, input_lock)
        for cell_id in VAD_DIAGNOSTIC_CELLS
    ]
    runtime_hashes = {canonical_hash(row["runtime"]) for row in validated}
    model_hashes = {canonical_hash(row["model"]) for row in validated}
    if len(runtime_hashes) != 1 or len(model_hashes) != 1:
        raise EvidenceError("VAD diagnostic rows do not share one runtime/model identity")
    rows = [_score_diagnostic(row, manifest_validation, baselines) for row in validated]
    publication = {
        "schemaVersion": 1,
        "kind": "hikaru-native-whisper-gpu-quality-vad-diagnostic",
        "comparisonProfile": PROFILE,
        "qualificationEligible": False,
        "authority": {
            "benchmarkManifestSha256": MANIFEST_SHA256,
            "benchmarkRunnerSha256": sha256_file(REPO_ROOT / "scripts" / "asr-benchmark.py"),
            "pythonLegacyBaselineSha256": sha256_file(baseline_path),
            "inputLockSha256": sha256_file(input_lock),
            "publisherSha256": sha256_file(Path(__file__)),
            "runtimeIdentitySha256": next(iter(runtime_hashes)),
            "modelIdentitySha256": next(iter(model_hashes)),
        },
        "rows": rows,
        "selection": select_vad_diagnostic_candidate(rows),
        "limitations": [
            "Selection-only large-v3 short/medium exact-VAD evidence; no formal qualification claim.",
            "No CPU model-backed measurements were acquired.",
            "Diagnostic rows cannot be promoted; a selected algorithm requires a new lock, rebuild, and formal rerun.",
        ],
    }
    privacy_scan(publication)
    _atomic_write_json(json_output, publication)
    report_output.parent.mkdir(parents=True, exist_ok=True)
    temporary = report_output.with_suffix(report_output.suffix + ".tmp")
    temporary.write_text(
        render_diagnostic_markdown(publication, "Native Faster-Whisper GPU exact-VAD diagnostic"),
        encoding="utf-8",
    )
    temporary.replace(report_output)
    return publication


def publish_fallback_diagnostic(
    raw_dir: Path,
    input_lock: Path,
    manifest: Path,
    corpus_root: Path,
    baseline_path: Path,
    json_output: Path,
    report_output: Path,
) -> dict[str, Any]:
    if not input_lock.is_file() or not _inside(RESEARCH_ROOT, input_lock) or _inside(LOCAL_ROOT, input_lock):
        raise EvidenceError("fallback diagnostic input lock must be a tracked T06R research file")
    if sha256_file(manifest) != MANIFEST_SHA256:
        raise EvidenceError("benchmark manifest identity drift")
    manifest_validation = BENCHMARK.validate_manifest(manifest, corpus_root)
    baseline = _read_json(baseline_path)
    baselines = _baseline_index(baseline)
    validated = [
        validate_fallback_diagnostic_raw(raw_dir / f"{cell_id}.json", cell_id, input_lock)
        for cell_id in FALLBACK_DIAGNOSTIC_CELLS
    ]
    runtime_hashes = {canonical_hash(row["runtime"]) for row in validated}
    model_hashes = {canonical_hash(row["model"]) for row in validated}
    if len(runtime_hashes) != 1 or len(model_hashes) != 1:
        raise EvidenceError("fallback diagnostic rows do not share one runtime/model identity")
    rows = [_score_diagnostic(row, manifest_validation, baselines) for row in validated]
    publication = {
        "schemaVersion": 1,
        "kind": "hikaru-native-whisper-gpu-quality-fallback-diagnostic",
        "comparisonProfile": PROFILE,
        "qualificationEligible": False,
        "authority": {
            "benchmarkManifestSha256": MANIFEST_SHA256,
            "benchmarkRunnerSha256": sha256_file(REPO_ROOT / "scripts" / "asr-benchmark.py"),
            "pythonLegacyBaselineSha256": sha256_file(baseline_path),
            "inputLockSha256": sha256_file(input_lock),
            "publisherSha256": sha256_file(Path(__file__)),
            "runtimeIdentitySha256": next(iter(runtime_hashes)),
            "modelIdentitySha256": next(iter(model_hashes)),
        },
        "rows": rows,
        "selection": select_fallback_diagnostic_candidate(rows),
        "limitations": [
            "Selection-only large-v3 short/medium fallback evidence; no formal qualification claim.",
            "No CPU model-backed measurements were acquired.",
            "Diagnostic rows cannot be promoted; selection requires a new lock, rebuild, and formal rerun.",
        ],
    }
    privacy_scan(publication)
    _atomic_write_json(json_output, publication)
    report_output.parent.mkdir(parents=True, exist_ok=True)
    temporary = report_output.with_suffix(report_output.suffix + ".tmp")
    temporary.write_text(
        render_diagnostic_markdown(publication, "Native Faster-Whisper GPU fallback diagnostic"),
        encoding="utf-8",
    )
    temporary.replace(report_output)
    return publication


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("diagnostic", "vad-diagnostic", "fallback-diagnostic"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--raw-dir", type=Path, required=True)
        subparser.add_argument("--input-lock", type=Path, required=True)
        subparser.add_argument("--manifest", type=Path, required=True)
        subparser.add_argument("--corpus-root", type=Path, required=True)
        subparser.add_argument("--baseline", type=Path, required=True)
        subparser.add_argument("--json-output", type=Path, required=True)
        subparser.add_argument("--report-output", type=Path, required=True)
    args = parser.parse_args(argv)
    publisher = {
        "diagnostic": publish_diagnostic,
        "vad-diagnostic": publish_vad_diagnostic,
        "fallback-diagnostic": publish_fallback_diagnostic,
    }[args.command]
    result = publisher(
        args.raw_dir,
        args.input_lock,
        args.manifest,
        args.corpus_root,
        args.baseline,
        args.json_output,
        args.report_output,
    )
    print(json.dumps({"selection": result["selection"]["status"], "rows": len(result["rows"])}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
