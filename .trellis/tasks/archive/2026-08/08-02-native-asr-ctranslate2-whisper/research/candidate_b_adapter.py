#!/usr/bin/env python3
"""Adapt locked T06 Candidate B output with the authoritative T01 comparator."""

from __future__ import annotations

import argparse
import bisect
import hashlib
import importlib.util
import json
import math
import statistics
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath

EXPECTED_MODEL_ID = "Systran/faster-whisper-large-v3"
EXPECTED_MODEL_REVISION = "edaa852ec7e145841d8ffdb056a99866b5f0a478"
EXPECTED_MODEL_FILES = {
    "config.json": (2_394, "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9"),
    "model.bin": (3_087_284_237, "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1"),
    "preprocessor_config.json": (340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"),
    "tokenizer.json": (2_480_617, "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"),
    "vocabulary.json": (1_068_114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"),
}
EXPECTED_RUNTIME_FILES = {
    "measurementExecutable": (671_232, "4218523d53d09eba8a09023630fe612b1590310d101e7d5d37d9f4d127f5ea22"),
    "productionWorker": (496_128, "fb55512246b2a28b4b0c62d23618f6da84e8e3cd792be1e1bcf55c865bc52bdb"),
}
EXPECTED_RUNTIME_DLLS = {
    "ctranslate2.dll": (22_417_408, "e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59"),
    "hikaru_asr_tokenizer.dll": (2_137_088, "892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d"),
    "onnxruntime.dll": (15_809_848, "18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257"),
    "onnxruntime_providers_shared.dll": (21_856, "599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8"),
}
EXPECTED_LOADED_MODULES = {
    "ctranslate2.dll": (22_417_408, "e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59"),
    "hikaru-asr-ctranslate2-tests.exe": (671_232, "4218523d53d09eba8a09023630fe612b1590310d101e7d5d37d9f4d127f5ea22"),
    "hikaru_asr_tokenizer.dll": (2_137_088, "892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d"),
    "onnxruntime.dll": (15_809_848, "18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257"),
    "vcomp140.dll": (213_064, "31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7"),
}
EXPECTED_OPTIONAL_LOADED_MODULES = {
    "onnxruntime_providers_shared.dll": (21_856, "599629fa643707defe9156140ae5edd73531f221aa97b7585b1c9bb0a93586f8"),
}
EXPECTED_CPU = {
    "architecture": "x86_64",
    "model": "AMD Ryzen 7 5800X 8-Core Processor",
    "logicalCores": 16,
    "availableIsa": {"sse2": True, "avx": True, "avx2": True, "fma": True, "avx512f": False},
}
EXPECTED_PATH_POLICY = {
    "name": "windows-restricted-path-v1",
    "restricted": True,
    "entryCount": 2,
    "orderedEntryRoles": ["measurement-executable-directory", "windows-system32"],
    "identitySha256": "439a4172b0cb5d50232784da10208261f69eea476773a2e737b3fe2293a53043",
}
EXPECTED_ROOT_IDENTITY_SHA256 = "77f4714aeb184e043f881d7d7a8ba3028e0d67944e7b727cc2f08009ec8c871e"
EXPECTED_MODULE_LAYOUT = {
    "name": "candidate-b-module-layout-v2",
    "identitySha256": "a650e185dc2983b7e5af7e56f17211cf1c7bf2ab9fadb1ccebf07d04e8323994",
    "runnerRootRole": "measurement-executable-directory",
    "openmpRootRole": "windows-system32",
    "localModuleNames": [
        "ctranslate2.dll", "hikaru_asr_tokenizer.dll", "onnxruntime.dll",
        "onnxruntime_providers_shared.dll",
    ],
}
EXPECTED_VAD_MODEL = (1_245_151, "4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2")
EXPECTED_CORPUS_ID = "hikaru-user-ja-ground-truth-v1"
EXPECTED_MANIFEST_SHA256 = "e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277"
EXPECTED_CASES = {
    "short-v1": {
        "audioSha256": "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211",
        "assSha256": "60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b",
        "durationMs": 24_102,
        "sampleCount": 4,
        "sourceSamples": 385_637,
    },
    "medium-v1": {
        "audioSha256": "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458",
        "assSha256": "d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e",
        "durationMs": 498_872,
        "sampleCount": 1,
        "sourceSamples": 7_981_952,
    },
}
EXPECTED_TIMESTAMP_BEGIN = 50_365
TASK_LOCAL_ROOT = Path(__file__).resolve().parent / "local"
EXPECTED_CONFIG = {
    "beamSize": 1,
    "patience": 1.0,
    "lengthPenalty": 1.0,
    "repetitionPenalty": 1.0,
    "noRepeatNgramSize": 0,
    "maxLength": 448,
    "temperature": 0.0,
    "conditionOnPreviousText": False,
    "timestampDrivenSeek": True,
    "promptResetOnTemperature": 0.5,
    "noSpeechThreshold": 0.6,
    "logProbThreshold": -1.0,
    "maxInitialTimestampIndex": 50,
    "modelWindowDurationMs": 30_000,
    "timestampResolutionMs": 20,
    "vad": True,
    "vadAlgorithm": "candidate-b-faster-whisper-v1.2.1-silero-v6",
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
}


def load_benchmark(repo_root: Path):
    path = repo_root / "scripts" / "asr-benchmark.py"
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark_candidate_b", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load T01 benchmark implementation")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_task_local_ignored(benchmark, path: Path, label: str) -> None:
    resolved = path.resolve()
    try:
        relative = resolved.relative_to(TASK_LOCAL_ROOT.resolve())
    except ValueError as exc:
        raise benchmark.ContractError(f"{label} must stay below canonical T06 research/local") from exc
    if not relative.parts:
        raise benchmark.ContractError(f"{label} must name a file below research/local")
    benchmark._require_ignored_raw_output(resolved)


def require_locked_tool(benchmark, path: Path, lock_text: str, label: str) -> None:
    if benchmark.sha256_file(path) not in lock_text:
        raise benchmark.ContractError(f"{label} identity is not frozen by Candidate B final lock")


def validate_files(entries: list[dict], expected: dict[str, tuple[int, str]], lock_text: str, label: str) -> None:
    files = {entry.get("name"): entry for entry in entries}
    if len(entries) != len(files) or set(files) != set(expected):
        raise ValueError(f"{label} file set mismatch")
    for name, (size, sha256) in expected.items():
        if files[name] != {"name": name, "sizeBytes": size, "sha256": sha256} or sha256 not in lock_text:
            raise ValueError(f"{label} identity mismatch: {name}")


def validate_authoritative_manifest(benchmark, validation: dict) -> dict[str, dict]:
    if (
        validation.get("manifestSha256") != EXPECTED_MANIFEST_SHA256
        or validation.get("manifest", {}).get("corpusId") != EXPECTED_CORPUS_ID
    ):
        raise benchmark.ContractError("Candidate B authoritative manifest identity mismatch")
    cases = {case["id"]: case for case in validation.get("cases", [])}
    for case_id, expected in EXPECTED_CASES.items():
        case = cases.get(case_id, {})
        if any(case.get(field) != expected[field] for field in ("audioSha256", "assSha256", "durationMs")):
            raise benchmark.ContractError(f"Candidate B authoritative case identity mismatch: {case_id}")
    return cases


def _canonical_windows_path(value: object) -> str:
    if isinstance(value, PureWindowsPath):
        path = value
    elif isinstance(value, str):
        path = PureWindowsPath(value)
    else:
        raise ValueError("Candidate B canonical path is missing")
    if not path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("Candidate B canonical path is not a normalized absolute Windows path")
    return str(path).rstrip("\\/").casefold()


def sanitize_path_policy(policy: dict) -> dict:
    if {
        key: policy.get(key) for key in EXPECTED_PATH_POLICY
    } != EXPECTED_PATH_POLICY:
        raise ValueError("Candidate B restricted PATH policy identity mismatch")
    return dict(EXPECTED_PATH_POLICY)


def validate_path_policy(policy: dict, parsed_paths: dict[str, PureWindowsPath]) -> dict:
    sanitize_path_policy(policy)
    roots = policy.get("resolvedRoots")
    if not isinstance(roots, list) or len(roots) != 2:
        raise ValueError("Candidate B resolved PATH roots are incomplete")
    expected_roles = EXPECTED_PATH_POLICY["orderedEntryRoles"]
    if [item.get("role") for item in roots] != expected_roles:
        raise ValueError("Candidate B resolved PATH root roles drifted")
    root_paths = [_canonical_windows_path(item.get("canonicalPath")) for item in roots]
    root_identity_input = (
        f"measurement-executable-directory={roots[0]['canonicalPath']}\n"
        f"windows-system32={roots[1]['canonicalPath']}"
    )
    root_identity = hashlib.sha256(root_identity_input.encode()).hexdigest()
    if (
        policy.get("rootIdentitySha256") != EXPECTED_ROOT_IDENTITY_SHA256
        or root_identity != EXPECTED_ROOT_IDENTITY_SHA256
    ):
        raise ValueError("Candidate B resolved PATH root identity is not locked")
    runner = parsed_paths["hikaru-asr-ctranslate2-tests.exe"]
    openmp = parsed_paths["vcomp140.dll"]
    if _canonical_windows_path(runner.parent) != root_paths[0]:
        raise ValueError("Candidate B runner is not beside the measured PATH root")
    if _canonical_windows_path(openmp.parent) != root_paths[1]:
        raise ValueError("Candidate B OpenMP module is not from the locked PATH root")
    return dict(EXPECTED_PATH_POLICY)


def validate_module_layout(layout: dict) -> None:
    if layout != EXPECTED_MODULE_LAYOUT:
        raise ValueError("Candidate B module layout identity mismatch")


def validate_loaded_modules(
    entries: list[dict],
    lock_text: str,
    path_policy: dict | None = None,
    module_layout: dict | None = None,
) -> list[dict]:
    if not EXPECTED_LOADED_MODULES:
        raise ValueError("Candidate B loaded-module lock is not frozen")
    modules = {str(entry.get("name", "")).lower(): entry for entry in entries}
    expected = {
        name.lower(): (name, identity)
        for name, identity in {**EXPECTED_LOADED_MODULES, **EXPECTED_OPTIONAL_LOADED_MODULES}.items()
    }
    required = {name.lower() for name in EXPECTED_LOADED_MODULES}
    if len(entries) != len(modules) or not required <= set(modules) or not set(modules) <= set(expected):
        raise ValueError("Candidate B loaded-module set mismatch")

    parsed_paths: dict[str, PureWindowsPath] = {}
    for normalized_name, (locked_name, (size, sha256)) in expected.items():
        if normalized_name not in modules:
            continue
        entry = modules[normalized_name]
        path_text = entry.get("canonicalPath")
        path = PureWindowsPath(path_text) if isinstance(path_text, str) else PureWindowsPath()
        if (
            entry.get("name") != locked_name
            or entry.get("sizeBytes") != size
            or entry.get("sha256") != sha256
            or sha256 not in lock_text
            or not path.is_absolute()
            or path.name.lower() != normalized_name
        ):
            raise ValueError(f"Candidate B loaded-module identity mismatch: {locked_name}")
        parsed_paths[normalized_name] = path

    validate_module_layout(module_layout or {})
    if path_policy is not None:
        validate_path_policy(path_policy, parsed_paths)
    runner_name = "hikaru-asr-ctranslate2-tests.exe"
    runner_parent = _canonical_windows_path(parsed_paths[runner_name].parent)
    local_names = {
        runner_name,
        "ctranslate2.dll",
        "hikaru_asr_tokenizer.dll",
        "onnxruntime.dll",
        "onnxruntime_providers_shared.dll",
    } & set(parsed_paths)
    if any(_canonical_windows_path(parsed_paths[name].parent) != runner_parent for name in local_names):
        raise ValueError("Candidate B loaded local module escaped the measurement executable directory")
    openmp_names = {name for name in parsed_paths if name.startswith(("vcomp", "openmp", "iomp"))}
    if openmp_names != {"vcomp140.dll"}:
        raise ValueError("Candidate B loaded OpenMP module set is not locked")
    if path_policy is None:
        for name in openmp_names:
            if parsed_paths[name].parent.name.casefold() != "system32":
                raise ValueError("Candidate B loaded OpenMP runtime is outside Windows System32")

    return [
        {
            "name": entry["name"],
            "sizeBytes": entry["sizeBytes"],
            "sha256": entry["sha256"],
            "location": "windows-system32" if normalized.startswith(("vcomp", "openmp", "iomp")) else "measurement-executable-directory",
        }
        for normalized, entry in sorted(modules.items())
    ]


def config_sha256(benchmark, config: dict) -> str:
    canonical = {
        "algorithm": "candidate-b-faster-whisper-v1.2.1-silero-v6",
        "computeType": "int8",
        "device": "cpu",
        "language": "ja",
        **config,
    }
    return benchmark.sha256_bytes(
        json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    )


def trace_sha256(token_ids: list[int]) -> str:
    return hashlib.sha256(",".join(str(value) for value in token_ids).encode()).hexdigest()


def restore_ms(intervals: list[dict], compressed_ms: int, is_end: bool) -> int:
    sample = compressed_ms * 16
    ends = [interval["compressedEndSample"] for interval in intervals]
    if is_end and sample in ends:
        index = ends.index(sample)
    else:
        index = min(bisect.bisect(ends, sample), len(ends) - 1)
    restored_sample = sample + intervals[index]["silenceBeforeSamples"]
    units, remainder = divmod(restored_sample, 160)
    if remainder > 80 or (remainder == 80 and units % 2):
        units += 1
    return units * 10


def validate_raw_identity(benchmark, raw: dict, lock_text: str, lock_sha256: str, case_id: str) -> str:
    expected_case = EXPECTED_CASES.get(case_id)
    if expected_case is None:
        raise benchmark.ContractError(f"Candidate B case is outside reviewed scope: {case_id}")
    if (
        raw.get("schemaVersion") != 1
        or raw.get("kind") != "hikaru-ct2-whisper-candidate-b-raw"
        or raw.get("status") != "completed"
        or raw.get("caseId") != case_id
        or raw.get("candidate") != "candidate-b-silero-v6-beam1-no-history"
        or raw.get("candidateBLockSha256") != lock_sha256
        or raw.get("engine") != "faster-whisper"
        or raw.get("config") != EXPECTED_CONFIG
        or raw.get("audio") != {"sha256": expected_case["audioSha256"], "durationMs": expected_case["durationMs"]}
    ):
        raise benchmark.ContractError("Candidate B raw envelope/config/source identity mismatch")

    model = raw.get("model", {})
    if model.get("id") != EXPECTED_MODEL_ID or model.get("revision") != EXPECTED_MODEL_REVISION:
        raise benchmark.ContractError("Candidate B model repository/revision mismatch")
    validate_files(model.get("files", []), EXPECTED_MODEL_FILES, lock_text, "Candidate B model")

    runtime = raw.get("runtime", {})
    path_policy = runtime.get("pathPolicy", {})
    if (
        runtime.get("device") != "cpu"
        or runtime.get("computeType") != "int8"
        or runtime.get("ctranslate2Version") != "4.8.0"
        or runtime.get("onnxRuntimeVersion") != "1.28.0"
        or runtime.get("cpu") != EXPECTED_CPU
        or runtime.get("vadModel") != {"sizeBytes": EXPECTED_VAD_MODEL[0], "sha256": EXPECTED_VAD_MODEL[1]}
        or runtime.get("moduleLayout") != EXPECTED_MODULE_LAYOUT
    ):
        raise benchmark.ContractError("Candidate B runtime parameters/VAD/layout identity mismatch")
    for key, (size, sha256) in EXPECTED_RUNTIME_FILES.items():
        if runtime.get(key) != {"sizeBytes": size, "sha256": sha256} or sha256 not in lock_text:
            raise benchmark.ContractError(f"Candidate B runtime identity is not frozen: {key}")
    validate_files(runtime.get("requiredDlls", []), EXPECTED_RUNTIME_DLLS, lock_text, "Candidate B runtime")
    validate_loaded_modules(runtime.get("loadedModules", []), lock_text, path_policy, runtime.get("moduleLayout"))

    resources = raw.get("resources", {})
    if (
        resources.get("method") != "GetProcessMemoryInfo.PeakWorkingSetSize"
        or not isinstance(resources.get("peakProcessRssBytes"), int)
        or resources["peakProcessRssBytes"] <= 0
    ):
        raise benchmark.ContractError("Candidate B RSS evidence is incomplete")

    samples = raw.get("samples", [])
    if len(samples) != expected_case["sampleCount"]:
        raise benchmark.ContractError(f"Candidate B {case_id} sample count is incomplete")
    representative_segments = None
    for index, sample in enumerate(samples, start=1):
        expected_kind = "cold" if index == 1 else "warm"
        if (
            sample.get("status") != "completed"
            or sample.get("failure") is not None
            or sample.get("runKind") != expected_kind
            or sample.get("repeatIndex") != index
        ):
            raise benchmark.ContractError(f"Candidate B {case_id} sample order/status is invalid")
        timings = sample.get("timings", {})
        for field in ("vadMs", "featureMs", "modelGenerateMs", "inferenceMs", "inferenceRtf"):
            if not isinstance(timings.get(field), (int, float)) or not math.isfinite(timings[field]) or timings[field] < 0:
                raise benchmark.ContractError(f"Candidate B {case_id} timing is invalid: {field}")
        if (
            timings["vadMs"] <= 0
            or timings["modelGenerateMs"] <= 0
            or timings["inferenceMs"] <= 0
            or abs(timings["inferenceRtf"] - timings["inferenceMs"] / expected_case["durationMs"]) > 1e-12
            or timings["vadMs"] + timings["featureMs"] + timings["modelGenerateMs"] > timings["inferenceMs"]
        ):
            raise benchmark.ContractError(f"Candidate B {case_id} timing identity is inconsistent")
        if index == 1:
            if any(not isinstance(timings.get(field), (int, float)) or timings[field] <= 0 for field in ("loadMs", "totalMs", "totalRtf")):
                raise benchmark.ContractError(f"Candidate B {case_id} cold timing is incomplete")
        elif any(field in timings for field in ("loadMs", "totalMs", "totalRtf")):
            raise benchmark.ContractError(f"Candidate B {case_id} warm timing contains cold-only fields")

        vad = sample.get("vad", {})
        intervals = vad.get("intervals", [])
        expected_rows = expected_case["sourceSamples"] // 512 + 1
        if (
            vad.get("originalSampleCount") != expected_case["sourceSamples"]
            or not isinstance(vad.get("compressedSampleCount"), int)
            or not 0 < vad["compressedSampleCount"] <= expected_case["sourceSamples"]
            or vad.get("rowCount") != expected_rows
            or vad.get("batchCount") != math.ceil(expected_rows / 10_000)
            or abs(vad.get("inferenceMs", -1) - timings["vadMs"]) > 1e-9
            or not intervals
        ):
            raise benchmark.ContractError(f"Candidate B {case_id} VAD evidence is incomplete")
        previous_end = previous_compressed = previous_silence = 0
        for interval in intervals:
            start = interval.get("startSample")
            end = interval.get("endSample")
            compressed_end = interval.get("compressedEndSample")
            silence = interval.get("silenceBeforeSamples")
            if (
                not all(isinstance(value, int) for value in (start, end, compressed_end, silence))
                or not previous_end <= start < end <= expected_case["sourceSamples"]
                or compressed_end != previous_compressed + end - start
                or silence != previous_silence + start - previous_end
            ):
                raise benchmark.ContractError(f"Candidate B {case_id} interval map is invalid")
            previous_end, previous_compressed, previous_silence = end, compressed_end, silence
        if previous_compressed != vad["compressedSampleCount"]:
            raise benchmark.ContractError(f"Candidate B {case_id} compressed length mismatch")

        progress = sample.get("progressMs")
        if (
            not isinstance(progress, list)
            or not progress
            or progress != sorted(progress)
            or progress[-1] != expected_case["durationMs"]
            or any(not isinstance(value, int) or not 0 <= value <= expected_case["durationMs"] for value in progress)
        ):
            raise benchmark.ContractError(f"Candidate B {case_id} original-source progress is invalid")

        traces = sample.get("tokenTraces", [])
        segments = sample.get("segments", [])
        compressed_frames = math.ceil(vad["compressedSampleCount"] / 160)
        if not traces or not segments:
            raise benchmark.ContractError(f"Candidate B {case_id} private evidence is incomplete")
        previous_seek = previous_progress = 0
        trace_by_hash: dict[str, list[dict]] = {}
        for trace in traces:
            token_ids = trace.get("tokenIds")
            seek_before, seek_after = trace.get("seekFramesBefore"), trace.get("seekFramesAfter")
            source_before, source_after = trace.get("sourceProgressBeforeMs"), trace.get("sourceProgressAfterMs")
            expected_after = min(expected_case["durationMs"], restore_ms(intervals, seek_after * 10, True)) if isinstance(seek_after, int) else -1
            if (
                trace.get("vadTimestampRestored") is not True
                or trace.get("modelWindowDurationMs") != 30_000
                or not isinstance(seek_before, int)
                or not isinstance(seek_after, int)
                or seek_before != previous_seek
                or not seek_before < seek_after <= compressed_frames
                or trace.get("windowOffsetMs") != seek_before * 10
                or trace.get("historyTokenCountBefore") != 0
                or trace.get("historyTokenCountAfter") != 0
                or trace.get("promptTokenCount") != 3
                or trace.get("prefixForwardTokenCount") != 2
                or trace.get("generationCallCount") != 1
                or trace.get("fallbackCallCount") != 0
                or trace.get("parseStatus") not in {"decoded-seek", "source-window-end", "no-speech"}
                or trace.get("parseError") is not None
                or source_before != previous_progress
                or source_after != expected_after
                or not isinstance(token_ids, list)
                or not token_ids
                or trace_sha256(token_ids) != trace.get("sha256")
            ):
                raise benchmark.ContractError(f"Candidate B {case_id} trace/progress provenance is invalid")
            previous_seek, previous_progress = seek_after, source_after
            trace_by_hash.setdefault(trace["sha256"], []).append(trace)
        if previous_seek != compressed_frames:
            raise benchmark.ContractError(f"Candidate B {case_id} trace chain did not reach compressed end")

        previous_start = -1
        for segment in segments:
            start, end = segment.get("startMs"), segment.get("endMs")
            raw_start, raw_end = segment.get("rawStartMs"), segment.get("rawEndMs")
            compressed_start, compressed_end = segment.get("compressedStartMs"), segment.get("compressedEndMs")
            candidates = trace_by_hash.get(segment.get("traceSha256"), [])
            trace = next((item for item in candidates if item["windowOffsetMs"] <= compressed_start < item["windowOffsetMs"] + 30_000), None)
            restored_start = restore_ms(intervals, compressed_start, False) if isinstance(compressed_start, int) else -1
            restored_raw_end = restore_ms(intervals, compressed_end, True) if isinstance(compressed_end, int) else -1
            tokens = segment.get("tokenIds")
            if (
                trace is None
                or segment.get("vadTimestampRestored") is not True
                or not all(isinstance(value, int) for value in (start, end, raw_start, raw_end, compressed_start, compressed_end))
                or not 0 <= start == raw_start == restored_start < end <= expected_case["durationMs"]
                or raw_end != restored_raw_end
                or end != min(raw_end, expected_case["durationMs"])
                or start < previous_start
                or not isinstance(segment.get("text"), str)
                or not segment["text"].strip()
                or compressed_start % 20 != 0
                or compressed_end % 20 != 0
                or not compressed_start < compressed_end
                or segment.get("endBoundedToAudio") is not (raw_end != end)
                or not isinstance(tokens, list)
                or len(tokens) < 2
                or tokens[0] != segment.get("timestampStartToken")
                or tokens[-1] != segment.get("timestampEndToken")
                or segment["timestampStartToken"] - (compressed_start - trace["windowOffsetMs"]) // 20 != EXPECTED_TIMESTAMP_BEGIN
                or segment["timestampEndToken"] - (compressed_end - trace["windowOffsetMs"]) // 20 != EXPECTED_TIMESTAMP_BEGIN
            ):
                raise benchmark.ContractError(f"Candidate B {case_id} segment restoration/provenance is invalid")
            previous_start = start
        if representative_segments is None:
            representative_segments = segments
        elif segments != representative_segments:
            raise benchmark.ContractError(f"Candidate B repeated output drifted within {case_id}")
    return config_sha256(benchmark, raw["config"])


def main() -> int:
    if sys.argv[1:] == ["--self-check"]:
        assert EXPECTED_CONFIG["vad"] is True
        assert json.dumps(EXPECTED_CONFIG["negativeThreshold"]) == "0.35"
        assert restore_ms([
            {"compressedEndSample": 16_000, "silenceBeforeSamples": 16_000},
            {"compressedEndSample": 32_000, "silenceBeforeSamples": 32_000},
        ], 1_000, True) == 2_000
        assert restore_ms([
            {"compressedEndSample": 200_000, "silenceBeforeSamples": 12_000},
        ], 7_440, True) == 8_190
        print("Candidate B adapter self-check passed")
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--case", required=True)
    parser.add_argument("--candidate-b-lock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[4]
    benchmark = load_benchmark(repo_root)
    require_task_local_ignored(benchmark, args.raw, "Candidate B raw evidence")
    require_task_local_ignored(benchmark, args.output, "Candidate B adapted result")
    validation = benchmark.validate_manifest(args.manifest, args.corpus_root)
    cases = validate_authoritative_manifest(benchmark, validation)
    case = cases.get(args.case)
    expected_case = EXPECTED_CASES.get(args.case)
    if case is None or expected_case is None:
        raise benchmark.ContractError(f"Candidate B authoritative case identity mismatch: {args.case}")

    raw = json.loads(args.raw.read_text(encoding="utf-8"))
    lock_sha256 = benchmark.sha256_file(args.candidate_b_lock)
    lock_text = args.candidate_b_lock.read_text(encoding="utf-8")
    require_locked_tool(benchmark, Path(__file__), lock_text, "Candidate B adapter")
    config_identity = validate_raw_identity(benchmark, raw, lock_text, lock_sha256, args.case)
    audio_path = validation["corpusRoot"] / Path(*PurePosixPath(case["audio"]).parts)
    if benchmark.sha256_file(audio_path) != expected_case["audioSha256"]:
        raise benchmark.ContractError("Candidate B audio does not match authoritative hash")

    reference = case["reference"]
    samples = []
    for raw_sample in raw["samples"]:
        segments = [{"startMs": item["startMs"], "endMs": item["endMs"], "text": item["text"]} for item in raw_sample["segments"]]
        sample = benchmark._sample_metrics(
            reference["text"], reference["segments"], reference["speechIntervals"],
            segments, case["durationMs"], "engine-native", "faster-whisper",
        )
        timings = dict(raw_sample["timings"])
        timings.setdefault("totalMs", timings["inferenceMs"])
        timings.setdefault("totalRtf", timings["inferenceRtf"])
        sample.update(
            status="completed", runKind=raw_sample["runKind"], repeatIndex=raw_sample["repeatIndex"],
            detectedLanguage="ja", detectedLanguageUnavailableReason=None,
            reportedDurationMs=case["durationMs"], timings=timings,
            tokenTraceHashes=[trace["sha256"] for trace in raw_sample["tokenTraces"]],
        )
        samples.append(sample)

    warm_rtfs = [sample["timings"]["inferenceRtf"] for sample in samples if sample["runKind"] == "warm"]
    generated_at = benchmark.utc_now()
    result = {
        "schemaVersion": benchmark.SCHEMA_VERSION,
        "kind": benchmark.RESULT_KIND,
        "candidateKind": "native-candidate",
        "runId": benchmark.sha256_bytes(f"{generated_at}|{validation['manifestSha256']}|candidate-b|{args.case}".encode())[:20],
        "generatedAt": generated_at,
        "manifest": {
            "corpusId": validation["manifest"]["corpusId"], "manifestKey": args.manifest.name,
            "sha256": validation["manifestSha256"],
            "durationClasses": sorted({item["durationClass"] for item in validation["manifest"]["cases"]}),
            "coverageTags": sorted({tag for item in validation["manifest"]["cases"] for tag in item["tags"]}),
            "validationWarnings": validation["warnings"],
        },
        "engine": "faster-whisper",
        "model": f"{raw['model']['id']}@{raw['model']['revision']}",
        "device": "cpu", "computeType": "int8", "language": "ja",
        "useVad": True,
        "vadConfig": {key: EXPECTED_CONFIG[key] for key in (
            "threshold", "negativeThreshold", "minSpeechDurationMs", "maxSpeechDurationSeconds",
            "minSilenceDurationMs", "speechPadMs", "windowSamples", "contextSamples", "encoderBatchRows",
        )},
        "runtime": {
            "implementation": "T06 Candidate B direct ORT Silero V6 + selected CT2 decode",
            "ctranslate2Version": "4.8.0", "onnxRuntimeVersion": "1.28.0",
            "candidateBLockSha256": lock_sha256, "algorithmConfigSha256": config_identity,
            "measurementExecutable": raw["runtime"]["measurementExecutable"],
            "productionWorker": raw["runtime"]["productionWorker"],
            "requiredDlls": raw["runtime"]["requiredDlls"], "vadModel": raw["runtime"]["vadModel"],
            "loadedModules": validate_loaded_modules(
                raw["runtime"]["loadedModules"], lock_text,
                raw["runtime"]["pathPolicy"], raw["runtime"]["moduleLayout"]),
            "moduleLayout": EXPECTED_MODULE_LAYOUT,
            "pythonDependency": False, "cudaDependency": False,
        },
        "environment": {
            "os": "Windows",
            "architecture": raw["runtime"]["cpu"]["architecture"],
            "cpu": raw["runtime"]["cpu"],
            "pathPolicy": sanitize_path_policy(raw["runtime"]["pathPolicy"]),
        },
        "cases": [{
            "caseId": case["id"], "audioKey": case["audio"], "assKey": case["ass"],
            "audioSha256": case["audioSha256"], "assSha256": case["assSha256"],
            "durationMs": case["durationMs"], "durationClass": case["durationClass"],
            "tags": sorted(case["tags"]), "referenceDerivation": case["referenceDerivation"],
            "referenceText": reference["text"], "referenceTextSha256": reference["textSha256"],
            "referenceNormalizedTextSha256": reference["normalizedTextSha256"],
            "referenceSegments": reference["segments"], "speechIntervals": reference["speechIntervals"],
            "dialogueCount": reference["dialogueCount"], "status": "completed", "error": None,
            "dependencyAvailable": True, "modelCache": {"status": "ready"},
            "reproductionCommand": "T06 candidate-b-final-lock.md command",
            "sampleCount": len(samples), "samples": samples,
            "coldProcess": {
                "preparation": {"loadMs": samples[0]["timings"].get("loadMs")},
                "processWallMs": samples[0]["timings"].get("totalMs"),
                "resources": {
                    "peakProcessRssBytes": raw["resources"]["peakProcessRssBytes"],
                    "peakProcessRssMethod": raw["resources"]["method"],
                    "peakProcessRssUnavailableReason": None,
                    "vram": {"peakVramBytes": None, "method": None, "unavailableReason": "CPU-only T06"},
                },
                "resolvedParameters": raw["config"],
            },
            "warmProcess": None if not warm_rtfs else {"resources": None},
            "warmInferenceRtfMedian": statistics.median(warm_rtfs) if warm_rtfs else None,
            "warmSampleCount": len(warm_rtfs),
        }],
    }
    benchmark.atomic_write_json(args.output, result)
    print(f"wrote {args.output}: {args.case}=completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
