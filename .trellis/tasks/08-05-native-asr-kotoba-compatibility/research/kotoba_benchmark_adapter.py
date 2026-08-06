#!/usr/bin/env python3
"""Validate T08 K1 raw evidence and adapt it through the authoritative T01 comparator."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import ntpath
import re
import statistics
import sys
from pathlib import Path, PurePosixPath
from typing import Any

TASK_ROOT = Path(__file__).resolve().parent.parent
LOCAL_ROOT = (Path(__file__).resolve().parent / "local").resolve()
EXPECTED_KIND = "hikaru-ct2-kotoba-k1-raw"
EXPECTED_CORPUS_ID = "hikaru-user-ja-ground-truth-v1"
ORIGINAL_MANIFEST_SHA256 = "e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277"
EXPECTED_MANIFEST_SHA256 = "3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea"
EXPECTED_MODEL = (
    "kotoba-tech/kotoba-whisper-v2.0-faster",
    "f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc",
)
EXPECTED_MODEL_FILES = {
    "config.json": (2_394, "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9"),
    "model.bin": (1_512_927_867, "60d2bc2e33de9d43f2745be09caefe1161acab670f6796d4a750d8d848382b36"),
    "preprocessor_config.json": (340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"),
    "tokenizer.json": (2_481_381, "f70c9740a90657b489cf05b0fa0605c1d497db542f11a70a8cc80a025c94c7d8"),
    "vocabulary.json": (1_068_114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"),
}
EXPECTED_CASES = {
    "short-v1": {
        "audioSha256": "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211",
        "assSha256": "60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b",
        "durationMs": 24_102,
        "sourceFrames": 2_411,
        "sampleCount": 4,
    },
    "medium-v1": {
        "audioSha256": "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458",
        "assSha256": "d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e",
        "durationMs": 498_872,
        "sourceFrames": 49_888,
        "sampleCount": 1,
    },
    "long-v1": {
        "audioSha256": "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e",
        "assSha256": "7954ce24af05dca37b2930136c83ee722e80fd637ef298cc7eeb47f29cf8c6f3",
        "durationMs": 4_144_235,
        "sourceFrames": 414_424,
        "sampleCount": 1,
    },
}
RAW_TO_CURRENT_CASE = {
    "short-v1": "short-v1",
    "medium-v1": "medium-v1",
    "long-v1": "long-v2",
}
CURRENT_CASES = {
    "short-v1": EXPECTED_CASES["short-v1"],
    "medium-v1": EXPECTED_CASES["medium-v1"],
    "long-v2": {
        "audioSha256": "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e",
        "assSha256": "46b4891a4f86c70c1fe54ba4dcfbd776b361f73bb774f1d14e0f2bb53659d04b",
        "durationMs": 4_144_235,
        "sourceFrames": 414_424,
        "sampleCount": 1,
    },
}
EXPECTED_CONFIG = {
    "beamSize": 5,
    "conditionOnPreviousText": False,
    "language": "ja",
    "lengthPenalty": 1.0,
    "logProbThreshold": -1.0,
    "maxInitialTimestampIndex": 50,
    "maxLength": 448,
    "maxSourceFrames": 1_500,
    "maxSourceWindowDurationMs": 15_000,
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
EXPECTED_MEASUREMENT_EXECUTABLE = (769_024, "6951747504d6150e50d357406b5aee7449a7c4d2291a8155ac3cf953561ed114")
EXPECTED_PRODUCTION_WORKER = (500_224, "bc8f5f9696dfe98229f4d39db0ddfdc6ba86a0078611c59f815ac2044101117b")
EXPECTED_RUNTIME_DLLS = {
    "ctranslate2.dll": (36_974_592, "0c0f1436489b656d893c0e7c186192526edbe6106b530c09753b981294c9a337"),
    "hikaru_asr_tokenizer.dll": (2_139_136, "7a767701e05b11fa4c2667409420eac513f2cf24fcdc52cf0d769ce752db2fea"),
    "onnxruntime.dll": (15_809_848, "18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257"),
    "onnxruntime_providers_shared.dll": (21_856, "599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8"),
}
EXPECTED_LOADED_MODULES = {
    "ctranslate2.dll": ("task-local-runtime-bin", 36_974_592, "0c0f1436489b656d893c0e7c186192526edbe6106b530c09753b981294c9a337", ""),
    "cublas64_12.dll": ("cuda-toolkit-12.8-bin", 113_716_224, "9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99", "6.14.11.1284"),
    "cublaslt64_12.dll": ("cuda-toolkit-12.8-bin", 674_667_520, "b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7", "6.14.11.1284"),
    "hikaru-asr-ctranslate2-tests.exe": ("task-local-runtime-bin", 769_024, "6951747504d6150e50d357406b5aee7449a7c4d2291a8155ac3cf953561ed114", ""),
    "hikaru_asr_tokenizer.dll": ("task-local-runtime-bin", 2_139_136, "7a767701e05b11fa4c2667409420eac513f2cf24fcdc52cf0d769ce752db2fea", ""),
    "nvcuda.dll": ("windows-system32", 4_466_920, "ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c", "32.0.15.9649"),
    "onnxruntime.dll": ("task-local-runtime-bin", 15_809_848, "18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257", "1.28.0.724"),
    "vcomp140.dll": ("windows-system32", 213_064, "31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7", "14.50.35719.0"),
}
EXPECTED_PATH_ROOT_IDENTITY = "307e7f236aeb7dc81b18bc42f292e1cac2ef58478f5beccb0a58ab19cff4eb22"
EXPECTED_GPU = {
    "deviceIndex": 0,
    "name": "NVIDIA GeForce RTX 3070",
    "driverModuleVersion": "32.0.15.9649",
    "cudaDriverApiVersion": 13_020,
    "computeCapability": "8.6",
    "visibleDeviceCount": 1,
    "float16Supported": True,
}
EXPECTED_CPU = {
    "architecture": "x86_64",
    "model": "AMD Ryzen 7 5800X 8-Core Processor",
    "logicalCores": 16,
    "availableIsa": {"avx": True, "avx2": True, "avx512f": False, "fma": True, "sse2": True},
}


class EvidenceError(ValueError):
    pass


def load_benchmark(repo_root: Path):
    path = repo_root / "scripts" / "asr-benchmark.py"
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark_kotoba", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load T01 benchmark implementation")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def sha256_file(path: Path) -> str:
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


def require_task_local(benchmark, path: Path, label: str) -> None:
    if not _inside(LOCAL_ROOT, path) or path.resolve() == LOCAL_ROOT:
        raise EvidenceError(f"{label} must stay below the canonical T08 research/local root")
    benchmark._require_ignored_raw_output(path.resolve())


def _file_identity(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("sizeBytes"), int) or value["sizeBytes"] <= 0:
        raise EvidenceError(f"{label} size is invalid")
    digest = value.get("sha256")
    if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
        raise EvidenceError(f"{label} hash is invalid")
    return {"sizeBytes": value["sizeBytes"], "sha256": digest}


def _expected_file_identity(value: Any, label: str, expected: tuple[int, str]) -> dict[str, Any]:
    identity = _file_identity(value, label)
    if (identity["sizeBytes"], identity["sha256"]) != expected:
        raise EvidenceError(f"{label} identity drifted")
    return identity


def _named_files(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise EvidenceError(f"{label} files are missing")
    result = []
    names = set()
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise EvidenceError(f"{label} file entry is invalid")
        name = item["name"]
        if name.lower() in names:
            raise EvidenceError(f"{label} file names are duplicated")
        names.add(name.lower())
        result.append({"name": name, **_file_identity(item, f"{label} {name}")})
    return sorted(result, key=lambda item: item["name"].lower())


def _validate_modules(runtime: dict[str, Any], lock_text: str) -> list[dict[str, Any]]:
    policy = runtime.get("pathPolicy")
    roles = ["task-local-runtime-bin", "cuda-toolkit-12.8-bin", "windows-system32"]
    if (
        not isinstance(policy, dict)
        or policy.get("name") != "t07-windows-cuda-restricted-path-v1"
        or policy.get("restricted") is not True
        or policy.get("orderedEntryRoles") != roles
        or policy.get("rootIdentitySha256") != EXPECTED_PATH_ROOT_IDENTITY
    ):
        raise EvidenceError("T08 restricted PATH policy drifted")
    roots = policy.get("resolvedRoots")
    if not isinstance(roots, list) or [item.get("role") for item in roots if isinstance(item, dict)] != roles:
        raise EvidenceError("T08 restricted PATH roots are invalid")
    root_map = {}
    identity_lines = []
    for item in roots:
        path = item.get("canonicalPath")
        if not isinstance(path, str) or not ntpath.isabs(path):
            raise EvidenceError("T08 restricted PATH root is not absolute")
        root_map[item["role"]] = ntpath.normcase(ntpath.normpath(path))
        identity_lines.append(f"{item['role']}={path}")
    if hashlib.sha256("\n".join(identity_lines).encode()).hexdigest() != policy["rootIdentitySha256"]:
        raise EvidenceError("T08 restricted PATH root identity is inconsistent")

    modules = runtime.get("loadedModules")
    if not isinstance(modules, list) or not modules:
        raise EvidenceError("T08 loaded-module inventory is empty")
    result = []
    names = set()
    for item in modules:
        if not isinstance(item, dict):
            raise EvidenceError("T08 loaded-module entry is invalid")
        name = item.get("name")
        role = item.get("rootRole")
        path = item.get("canonicalPath")
        normalized_name = name.lower() if isinstance(name, str) else ""
        if (
            not normalized_name
            or normalized_name in names
            or role not in root_map
            or not isinstance(path, str)
            or not ntpath.isabs(path)
            or ntpath.normcase(ntpath.normpath(ntpath.dirname(path))) != root_map[role]
            or ntpath.basename(path).lower() != normalized_name
        ):
            raise EvidenceError("T08 loaded-module path/root identity is invalid")
        expected = EXPECTED_LOADED_MODULES.get(normalized_name)
        identity = _file_identity(item, f"loaded module {name}")
        version = item.get("version", "")
        if expected is None or (role, identity["sizeBytes"], identity["sha256"], version) != expected:
            raise EvidenceError("T08 loaded-module identity drifted")
        names.add(normalized_name)
        if identity["sha256"] not in lock_text:
            raise EvidenceError("T08 loaded-module identity is not frozen by the K1 lock")
        result.append({
            "name": name,
            "rootRole": role,
            "version": version,
            **identity,
        })
    if names != set(EXPECTED_LOADED_MODULES):
        raise EvidenceError("T08 CUDA module evidence is incomplete")
    return sorted(result, key=lambda item: item["name"].lower())


def _trace_hash(token_ids: list[int]) -> str:
    return hashlib.sha256(",".join(str(token) for token in token_ids).encode()).hexdigest()


def _validate_sample(sample: Any, index: int, expected: dict[str, Any]) -> dict[str, Any]:
    run_kind = "cold" if index == 0 else "warm"
    if (
        not isinstance(sample, dict)
        or sample.get("status") != "completed"
        or sample.get("failure") is not None
        or sample.get("runKind") != run_kind
        or sample.get("repeatIndex") != index + 1
        or sample.get("generationCompleted") is not True
    ):
        raise EvidenceError("T08 sample status/order is invalid")
    traces = sample.get("tokenTraces")
    segments = sample.get("segments")
    if not isinstance(traces, list) or not traces or not isinstance(segments, list) or not segments:
        raise EvidenceError("T08 completed sample lacks private trace/segment evidence")
    previous_seek = 0
    trace_hashes = set()
    generation_calls = 0
    trace_feature_ms = 0.0
    trace_generate_ms = 0.0
    for trace in traces:
        tokens = trace.get("tokenIds") if isinstance(trace, dict) else None
        before = trace.get("seekFramesBefore") if isinstance(trace, dict) else None
        after = trace.get("seekFramesAfter") if isinstance(trace, dict) else None
        source_ms = trace.get("sourceWindowDurationMs") if isinstance(trace, dict) else None
        digest = trace.get("sha256") if isinstance(trace, dict) else None
        if (
            not isinstance(tokens, list)
            or not tokens
            or any(not isinstance(token, int) or token < 0 for token in tokens)
            or digest != _trace_hash(tokens)
            or before != previous_seek
            or not isinstance(after, int)
            or not before < after <= expected["sourceFrames"]
            or not isinstance(source_ms, int)
            or not 0 < source_ms <= 15_000
            or source_ms != min(15_000, expected["durationMs"] - before * 10)
            or trace.get("modelWindowDurationMs") != 30_000
            or trace.get("windowOffsetMs") != before * 10
            or trace.get("sourceOverlapMs") != max(0, source_ms - (after - before) * 10)
            or trace.get("sourceProgressBeforeMs") != min(expected["durationMs"], before * 10)
            or trace.get("sourceProgressAfterMs") != min(expected["durationMs"], after * 10)
            or trace.get("vadTimestampRestored") is not False
            or trace.get("historyTokenCountBefore") != 0
            or trace.get("historyTokenCountAfter") != 0
            or trace.get("promptTokenCount") != 3
            or trace.get("prefixForwardTokenCount") != 2
            or trace.get("generatedTokenCount") != len(tokens)
            or trace.get("generationCallCount") != 1
            or trace.get("fallbackCallCount") != 0
            or trace.get("parseStatus") not in {"decoded-seek", "source-window-end", "no-speech"}
            or trace.get("parseError") is not None
            or trace.get("skippedAsNoSpeech") != (trace.get("parseStatus") == "no-speech")
        ):
            raise EvidenceError("T08 K1 trace identity is invalid")
        feature_ms, generate_ms = trace.get("featureMs"), trace.get("generateMs")
        if any(not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 for value in (feature_ms, generate_ms)):
            raise EvidenceError("T08 K1 trace timing is invalid")
        previous_seek = after
        generation_calls += trace["generationCallCount"]
        trace_feature_ms += feature_ms
        trace_generate_ms += generate_ms
        trace_hashes.add(digest)
    if previous_seek != expected["sourceFrames"] or generation_calls != sample.get("generationCallCount"):
        raise EvidenceError("T08 K1 trace chain/generation count is incomplete")

    previous_start = -1
    for segment in segments:
        if not isinstance(segment, dict):
            raise EvidenceError("T08 segment evidence is invalid")
        start, end = segment.get("startMs"), segment.get("endMs")
        segment_tokens = segment.get("tokenIds")
        raw_start, raw_end = segment.get("rawStartMs"), segment.get("rawEndMs")
        bounded = segment.get("endBoundedToAudio")
        if (
            not isinstance(start, int)
            or not isinstance(end, int)
            or not 0 <= start < end <= expected["durationMs"]
            or start < previous_start
            or not isinstance(segment.get("text"), str)
            or not segment["text"].strip()
            or segment.get("traceSha256") not in trace_hashes
            or not isinstance(segment_tokens, list)
            or len(segment_tokens) < 2
            or any(not isinstance(token, int) or token < 0 for token in segment_tokens)
            or segment.get("timestampStartToken") != segment_tokens[0]
            or segment.get("timestampEndToken") != segment_tokens[-1]
            or not isinstance(raw_start, int)
            or not isinstance(raw_end, int)
            or raw_start != start
            or raw_end < end
            or bounded is not (raw_end != end)
            or segment.get("compressedStartMs") is not None
            or segment.get("compressedEndMs") is not None
            or segment.get("vadTimestampRestored") is not False
        ):
            raise EvidenceError("T08 segment timeline/provenance is invalid")
        previous_start = start

    timings = sample.get("timings")
    if not isinstance(timings, dict):
        raise EvidenceError("T08 timings are missing")
    numeric = {}
    for key in ("sampleWallMs", "featureMs", "modelGenerateMs", "inferenceMs", "inferenceRtf"):
        value = timings.get(key)
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            raise EvidenceError(f"T08 timing is invalid: {key}")
        numeric[key] = float(value)
    if (
        numeric["modelGenerateMs"] <= 0
        or numeric["inferenceMs"] <= 0
        or numeric["sampleWallMs"] < numeric["inferenceMs"]
        or not math.isclose(numeric["featureMs"], trace_feature_ms, rel_tol=1e-9, abs_tol=1e-6)
        or not math.isclose(numeric["modelGenerateMs"], trace_generate_ms, rel_tol=1e-9, abs_tol=1e-6)
        or numeric["featureMs"] + numeric["modelGenerateMs"] > numeric["inferenceMs"]
        or not math.isclose(
            numeric["inferenceRtf"],
            numeric["inferenceMs"] / expected["durationMs"],
            rel_tol=1e-9,
            abs_tol=1e-12,
        )
    ):
        raise EvidenceError("T08 timing components are inconsistent")
    if index == 0:
        load_ms = timings.get("loadMs")
        wall_ms = timings.get("processWallMs")
        wall_rtf = timings.get("processWallRtf")
        if (
            not isinstance(load_ms, (int, float))
            or load_ms <= 0
            or not isinstance(wall_ms, (int, float))
            or wall_ms < load_ms + numeric["sampleWallMs"]
            or not isinstance(wall_rtf, (int, float))
            or not math.isclose(wall_rtf, wall_ms / expected["durationMs"], rel_tol=1e-9, abs_tol=1e-12)
        ):
            raise EvidenceError("T08 cold process timing is invalid")
        numeric.update(loadMs=float(load_ms), processWallMs=float(wall_ms), processWallRtf=float(wall_rtf))
    elif timings.get("loadMs") is not None or "processWallMs" in timings or "processWallRtf" in timings:
        raise EvidenceError("T08 warm sample contains cold-only timing")
    return {"runKind": run_kind, "repeatIndex": index + 1, "segments": segments, "tokenTraces": traces, "timings": numeric}


def validate_raw_identity(benchmark, raw: dict[str, Any], lock_path: Path, case_id: str) -> dict[str, Any]:
    expected = EXPECTED_CASES.get(case_id)
    lock_sha256 = sha256_file(lock_path)
    lock_text = lock_path.read_text(encoding="utf-8")
    if (
        expected is None
        or raw.get("schemaVersion") != 1
        or raw.get("kind") != EXPECTED_KIND
        or raw.get("status") != "completed"
        or raw.get("caseId") != case_id
        or raw.get("engine") != "kotoba-faster-whisper"
        or raw.get("candidate") != "kotoba-k1"
        or raw.get("config") != EXPECTED_CONFIG
        or raw.get("inputLockSha256") != lock_sha256
        or raw.get("audio") != {
            "sha256": expected["audioSha256"],
            "durationMs": expected["durationMs"],
            "sourceFrames": expected["sourceFrames"],
        }
    ):
        raise EvidenceError("T08 raw envelope/config/source identity mismatch")
    model = raw.get("model")
    if not isinstance(model, dict) or (model.get("id"), model.get("revision")) != EXPECTED_MODEL:
        raise EvidenceError("T08 Kotoba repository/revision identity mismatch")
    if model.get("legacyCache") != {
        "layout": "huggingface-immutable-snapshot",
        "revisionDirectoryVerified": True,
        "usedInPlace": True,
    }:
        raise EvidenceError("T08 legacy cache attestation is invalid")
    model_files = _named_files(model.get("files"), "Kotoba model")
    if {item["name"]: (item["sizeBytes"], item["sha256"]) for item in model_files} != EXPECTED_MODEL_FILES:
        raise EvidenceError("T08 Kotoba model file identity drifted")

    runtime = raw.get("runtime")
    if not isinstance(runtime, dict):
        raise EvidenceError("T08 runtime identity is missing")
    if (
        runtime.get("requestedDevice") != "cuda"
        or runtime.get("resolvedDevice") != "cuda"
        or runtime.get("computeType") != "float16"
        or runtime.get("deviceIndex") != 0
        or runtime.get("ctranslate2Version") != "4.8.0"
        or runtime.get("cudaBuildEnabled") is not True
        or runtime.get("cudaDynamicLoading") is not True
        or runtime.get("withCudnn") is not False
    ):
        raise EvidenceError("T08 CUDA runtime identity drifted")
    if runtime.get("gpu") != EXPECTED_GPU or runtime.get("cpu") != EXPECTED_CPU:
        raise EvidenceError("T08 reviewed T07 device identity drifted")
    executable = _expected_file_identity(
        runtime.get("measurementExecutable"),
        "measurement executable",
        EXPECTED_MEASUREMENT_EXECUTABLE,
    )
    worker = _expected_file_identity(
        runtime.get("productionWorker"),
        "production worker",
        EXPECTED_PRODUCTION_WORKER,
    )
    required_dlls = _named_files(runtime.get("requiredDlls"), "runtime")
    if {
        item["name"].lower(): (item["sizeBytes"], item["sha256"])
        for item in required_dlls
    } != EXPECTED_RUNTIME_DLLS:
        raise EvidenceError("T08 runtime DLL set drifted")
    for identity in [executable, worker, *required_dlls]:
        if identity["sha256"] not in lock_text:
            raise EvidenceError("T08 runtime identity is not frozen by the K1 lock")
    modules = _validate_modules(runtime, lock_text)
    resources = raw.get("resources")
    if (
        not isinstance(resources, dict)
        or resources.get("method") != "GetProcessMemoryInfo.PeakWorkingSetSize"
        or not isinstance(resources.get("peakProcessRssBytes"), int)
        or resources["peakProcessRssBytes"] <= 0
    ):
        raise EvidenceError("T08 process RSS evidence is invalid")
    samples = raw.get("samples")
    if not isinstance(samples, list) or len(samples) != expected["sampleCount"]:
        raise EvidenceError("T08 sample count is incomplete")
    validated_samples = [_validate_sample(sample, index, expected) for index, sample in enumerate(samples)]
    return {
        "caseId": case_id,
        "audio": raw["audio"],
        "model": {"id": model["id"], "revision": model["revision"], "files": model_files, "legacyCache": model["legacyCache"]},
        "config": raw["config"],
        "inputLockSha256": lock_sha256,
        "runtime": {
            "measurementExecutable": executable,
            "productionWorker": worker,
            "requiredDlls": required_dlls,
            "gpu": runtime.get("gpu"),
            "cpu": runtime.get("cpu"),
            "pathPolicy": {
                "name": runtime["pathPolicy"]["name"],
                "orderedEntryRoles": runtime["pathPolicy"]["orderedEntryRoles"],
                "rootIdentitySha256": runtime["pathPolicy"].get("rootIdentitySha256"),
            },
            "loadedModules": modules,
        },
        "resources": resources,
        "samples": validated_samples,
    }


def adapt(raw_path: Path, manifest: Path, corpus_root: Path, case_id: str, lock_path: Path, output: Path) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[4]
    benchmark = load_benchmark(repo_root)
    require_task_local(benchmark, raw_path, "T08 raw evidence")
    require_task_local(benchmark, output, "T08 adapted evidence")
    validation = benchmark.validate_manifest(manifest, corpus_root)
    if validation["manifestSha256"] != EXPECTED_MANIFEST_SHA256 or validation["manifest"]["corpusId"] != EXPECTED_CORPUS_ID:
        raise EvidenceError("T08 authoritative manifest identity drifted")
    source_case_id = "long-v1" if case_id == "long-v2" else case_id
    current_case_id = RAW_TO_CURRENT_CASE.get(source_case_id)
    case = next((item for item in validation["cases"] if item["id"] == current_case_id), None)
    expected = CURRENT_CASES.get(current_case_id or "")
    if case is None or expected is None or any(case.get(key) != expected[key] for key in ("audioSha256", "assSha256", "durationMs")):
        raise EvidenceError("T08 authoritative case identity drifted")
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    identity = validate_raw_identity(benchmark, raw, lock_path, source_case_id)
    audio_path = validation["corpusRoot"] / Path(*PurePosixPath(case["audio"]).parts)
    if benchmark.sha256_file(audio_path) != expected["audioSha256"]:
        raise EvidenceError("T08 authoritative audio hash drifted")

    reference = case["reference"]
    samples = []
    for sample in identity["samples"]:
        segments = [{"startMs": item["startMs"], "endMs": item["endMs"], "text": item["text"]} for item in sample["segments"]]
        metrics = benchmark._sample_metrics(
            reference["text"],
            reference["segments"],
            reference["speechIntervals"],
            segments,
            case["durationMs"],
            "engine-native",
            "kotoba-faster-whisper",
        )
        metrics.update(
            status="completed",
            runKind=sample["runKind"],
            repeatIndex=sample["repeatIndex"],
            timings=sample["timings"],
            tokenTraceHashes=[trace["sha256"] for trace in sample["tokenTraces"]],
        )
        samples.append(metrics)
    result = {
        "schemaVersion": benchmark.SCHEMA_VERSION,
        "kind": benchmark.RESULT_KIND,
        "candidateKind": "native-candidate",
        "manifest": {"corpusId": EXPECTED_CORPUS_ID, "sha256": EXPECTED_MANIFEST_SHA256},
        "engine": "kotoba-faster-whisper",
        "model": f"{EXPECTED_MODEL[0]}@{EXPECTED_MODEL[1]}",
        "device": "cuda",
        "computeType": "float16",
        "language": "ja",
        "useVad": False,
        "runtime": identity["runtime"],
        "cases": [{
            "caseId": current_case_id,
            "audioSha256": expected["audioSha256"],
            "assSha256": expected["assSha256"],
            "durationMs": expected["durationMs"],
            "referenceText": reference["text"],
            "referenceSegments": reference["segments"],
            "speechIntervals": reference["speechIntervals"],
            "samples": samples,
            "warmInferenceRtfMedian": statistics.median(
                sample["timings"]["inferenceRtf"] for sample in samples if sample["runKind"] == "warm"
            ) if case_id == "short-v1" else None,
        }],
    }
    benchmark.atomic_write_json(output, result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--case", required=True)
    parser.add_argument("--input-lock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    adapt(args.raw, args.manifest, args.corpus_root, args.case, args.input_lock, args.output)
    print(f"wrote {args.output}: {args.case}=completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
