#!/usr/bin/env python3
"""Strict adapter for the frozen Kotoba K2 CTranslate2 evidence envelope."""

from __future__ import annotations

import argparse
import bisect
import hashlib
import importlib.util
import json
import math
import ntpath
import sys
from pathlib import Path, PurePosixPath
from typing import Any

TASK_ROOT = Path(__file__).resolve().parent.parent
LOCAL_ROOT = (Path(__file__).resolve().parent / "local").resolve()
EXPECTED_KIND = "hikaru-ct2-kotoba-k2-raw"
EXPECTED_CORPUS_ID = "hikaru-user-ja-ground-truth-v1"
EXPECTED_MANIFEST_SHA256 = "3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea"
EXPECTED_MODEL = ("kotoba-tech/kotoba-whisper-v2.0-faster", "f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc")
CANDIDATE_ID = "kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1"
OWNERSHIP_RULE = "latest-start-half-open-v1"
K1_LONG_V2_GAP_COORDINATES = (
    (941630, 945090), (1276940, 1278540), (1289540, 1291540),
    (1456720, 1458540), (1606830, 1608540), (1845700, 1847230),
    (4050480, 4053460),
)

EXPECTED_MEASUREMENT_EXECUTABLE = (802_816, "314cb67dc87225787d480a6986da009f747d1e72b5cc122166fe292fb90f2b14")
EXPECTED_PRODUCTION_WORKER = (516_096, "93b8b6781ab419033695801f511e530467918fc0502f39494c92bf37116947bf")
EXPECTED_MODEL_FILES = {
    "config.json": (2_394, "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9"),
    "model.bin": (1_512_927_867, "60d2bc2e33de9d43f2745be09caefe1161acab670f6796d4a750d8d848382b36"),
    "preprocessor_config.json": (340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"),
    "tokenizer.json": (2_481_381, "f70c9740a90657b489cf05b0fa0605c1d497db542f11a70a8cc80a025c94c7d8"),
    "vocabulary.json": (1_068_114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"),
}
# T07's loaded module identity is retained until a later build changes it.
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
    "hikaru-asr-ctranslate2-tests.exe": ("task-local-runtime-bin", 802_816, "314cb67dc87225787d480a6986da009f747d1e72b5cc122166fe292fb90f2b14", ""),
    "hikaru_asr_tokenizer.dll": ("task-local-runtime-bin", 2_139_136, "7a767701e05b11fa4c2667409420eac513f2cf24fcdc52cf0d769ce752db2fea", ""),
    "nvcuda.dll": ("windows-system32", 4_466_920, "ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c", "32.0.15.9649"),
    "onnxruntime.dll": ("task-local-runtime-bin", 15_809_848, "18370c375f07357fa5874344a9d9ac17e6b6fe1eb18b1dd209d79483b4470257", "1.28.0.724"),
    "vcomp140.dll": ("windows-system32", 213_064, "31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7", "14.50.35719.0"),
}
EXPECTED_PATH_ROOT_IDENTITY = "307e7f236aeb7dc81b18bc42f292e1cac2ef58478f5beccb0a58ab19cff4eb22"
EXPECTED_GPU = {"deviceIndex": 0, "name": "NVIDIA GeForce RTX 3070", "driverModuleVersion": "32.0.15.9649", "cudaDriverApiVersion": 13_020, "computeCapability": "8.6", "visibleDeviceCount": 1, "float16Supported": True}
EXPECTED_CPU = {"architecture": "x86_64", "model": "AMD Ryzen 7 5800X 8-Core Processor", "logicalCores": 16, "availableIsa": {"avx": True, "avx2": True, "avx512f": False, "fma": True, "sse2": True}}
EXPECTED_CONFIG = {
    "beamSize": 5, "conditionOnPreviousText": False, "language": "ja", "lengthPenalty": 1.0,
    "logProbThreshold": -1.0, "maxInitialTimestampIndex": 50, "maxLength": 448,
    "maxSourceFrames": 1500, "maxSourceWindowDurationMs": 15000, "modelWindowDurationMs": 30000,
    "noRepeatNgramSize": 0, "noSpeechThreshold": 0.6, "patience": 1.0,
    "promptResetOnTemperature": 0.5, "repetitionPenalty": 1.0, "temperature": 0.0,
    "timestampDrivenSeek": True, "timestampResolutionMs": 20, "vad": False,
    "maxAppliedSeekFrames": 1000, "maxAppliedSeekDurationMs": 10000,
    "candidateId": CANDIDATE_ID, "ownershipRule": OWNERSHIP_RULE, "overlapFloorFrames": 500,
}
EXPECTED_CASES = {
    "short-v1": {"audioSha256": "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211", "assSha256": "60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b", "durationMs": 24_102, "sourceFrames": 2_411, "sampleCount": 4},
    "medium-v1": {"audioSha256": "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458", "assSha256": "d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e", "durationMs": 498_872, "sourceFrames": 49_888, "sampleCount": 1},
    "long-v2": {"audioSha256": "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e", "assSha256": "46b4891a4f86c70c1fe54ba4dcfbd776b361f73bb774f1d14e0f2bb53659d04b", "durationMs": 4_144_235, "sourceFrames": 414_424, "sampleCount": 1},
}

class EvidenceError(ValueError):
    pass


def load_benchmark(repo_root: Path):
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark_kotoba_k2", repo_root / "scripts" / "asr-benchmark.py")
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


def coordinate_set_hash(coordinates: Any = K1_LONG_V2_GAP_COORDINATES) -> str:
    if not isinstance(coordinates, (list, tuple)) or any(not isinstance(pair, (list, tuple)) or len(pair) != 2 for pair in coordinates):
        raise EvidenceError("K1 coordinate set is invalid")
    return hashlib.sha256(json.dumps(coordinates, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


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


def _identity(value: Any, label: str, allow_placeholder: bool = False) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("sizeBytes"), int) or value["sizeBytes"] < 0:
        raise EvidenceError(f"{label} size is invalid")
    digest = value.get("sha256")
    if not isinstance(digest, str) or len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
        raise EvidenceError(f"{label} hash is invalid")
    if value["sizeBytes"] == 0 and not allow_placeholder:
        raise EvidenceError(f"{label} is a placeholder")
    return {"sizeBytes": value["sizeBytes"], "sha256": digest}


def _named_files(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise EvidenceError(f"{label} files are missing")
    names: set[str] = set(); result = []
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise EvidenceError(f"{label} entry is invalid")
        key = item["name"].lower()
        if key in names:
            raise EvidenceError(f"{label} names are duplicated")
        names.add(key); result.append({"name": item["name"], **_identity(item, f"{label} {item['name']}")})
    return sorted(result, key=lambda item: item["name"].lower())


def _validate_modules(runtime: dict[str, Any], lock_text: str) -> list[dict[str, Any]]:
    policy = runtime.get("pathPolicy")
    roles = ["task-local-runtime-bin", "cuda-toolkit-12.8-bin", "windows-system32"]
    if not isinstance(policy, dict) or policy.get("name") != "t07-windows-cuda-restricted-path-v1" or policy.get("restricted") is not True or policy.get("orderedEntryRoles") != roles or policy.get("rootIdentitySha256") != EXPECTED_PATH_ROOT_IDENTITY:
        raise EvidenceError("K2 restricted PATH policy drifted")
    roots = policy.get("resolvedRoots")
    if not isinstance(roots, list) or [item.get("role") for item in roots if isinstance(item, dict)] != roles:
        raise EvidenceError("K2 restricted PATH roots are invalid")
    root_map: dict[str, str] = {}; identity_lines = []
    for item in roots:
        path = item.get("canonicalPath")
        if not isinstance(path, str) or not ntpath.isabs(path):
            raise EvidenceError("K2 restricted PATH root is not absolute")
        root_map[item["role"]] = ntpath.normcase(ntpath.normpath(path)); identity_lines.append(f"{item['role']}={path}")
    if hashlib.sha256("\n".join(identity_lines).encode()).hexdigest() != EXPECTED_PATH_ROOT_IDENTITY:
        raise EvidenceError("K2 restricted PATH root identity is inconsistent")
    modules = runtime.get("loadedModules")
    if not isinstance(modules, list) or not modules:
        raise EvidenceError("K2 loaded-module inventory is empty")
    result = []; names: set[str] = set()
    for item in modules:
        if not isinstance(item, dict): raise EvidenceError("K2 loaded-module entry is invalid")
        name, role, path = item.get("name"), item.get("rootRole"), item.get("canonicalPath")
        normalized = name.lower() if isinstance(name, str) else ""
        if not normalized or normalized in names or role not in root_map or not isinstance(path, str) or not ntpath.isabs(path) or ntpath.normcase(ntpath.normpath(ntpath.dirname(path))) != root_map[role] or ntpath.basename(path).lower() != normalized:
            raise EvidenceError("K2 loaded-module path/root identity is invalid")
        expected = EXPECTED_LOADED_MODULES.get(normalized)
        identity = _identity(item, f"loaded module {name}")
        if expected is None or (role, identity["sizeBytes"], identity["sha256"], item.get("version", "")) != expected:
            raise EvidenceError("K2 loaded-module identity drifted")
        if identity["sha256"] not in lock_text: raise EvidenceError("K2 module is not frozen by lock")
        names.add(normalized); result.append({"name": name, "rootRole": role, "version": item.get("version", ""), **identity})
    if names != set(EXPECTED_LOADED_MODULES): raise EvidenceError("K2 CUDA module evidence is incomplete")
    return sorted(result, key=lambda item: item["name"].lower())


def _trace_hash(tokens: list[int]) -> str:
    return hashlib.sha256(",".join(str(token) for token in tokens).encode()).hexdigest()


def _tuple_hash(start: int, end: int, text: str) -> str:
    return hashlib.sha256(f"{start}\n{end}\n{text}".encode()).hexdigest()


def _num(value: Any, label: str) -> float:
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0: raise EvidenceError(f"K2 {label} is invalid")
    return float(value)


def _validate_sample(sample: Any, index: int, expected: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(sample, dict) or sample.get("status") != "completed" or sample.get("failure") is not None or sample.get("runKind") != ("cold" if index == 0 else "warm") or sample.get("repeatIndex") != index + 1 or sample.get("generationCompleted") is not True:
        raise EvidenceError("K2 sample status/order is invalid")
    traces = sample.get("tokenTraces"); segments = sample.get("segments")
    if not isinstance(traces, list) or not traces or not isinstance(segments, list): raise EvidenceError("K2 sample trace/segments are missing")
    window_starts = [trace.get("seekFramesBefore") * 10 for trace in traces if isinstance(trace, dict) and isinstance(trace.get("seekFramesBefore"), int)]
    if len(window_starts) != len(traces) or not window_starts or window_starts[0] != 0 or window_starts != sorted(set(window_starts)):
        raise EvidenceError("K2 window-start chain is invalid")
    previous_seek = 0; previous_progress = 0; previous_emitted_start = -1; trace_hashes: set[str] = set(); emitted_tuple_hashes: set[str] = set(); emitted = []
    feature_total = generate_total = 0.0
    for trace_index, trace in enumerate(traces):
        if not isinstance(trace, dict): raise EvidenceError("K2 trace is invalid")
        tokens = trace.get("tokenIds"); digest = trace.get("sha256")
        before, after = trace.get("seekFramesBefore"), trace.get("seekFramesAfter")
        if not isinstance(tokens, list) or not tokens or any(not isinstance(token, int) or token < 0 for token in tokens) or digest != _trace_hash(tokens): raise EvidenceError("K2 token trace hash is invalid")
        if trace.get("candidateId") != CANDIDATE_ID or trace.get("ownershipRule") != OWNERSHIP_RULE or trace.get("windowIndex") != trace_index: raise EvidenceError("K2 trace candidate/window identity drifted")
        if before != previous_seek or not isinstance(after, int) or after <= before or after > expected["sourceFrames"]: raise EvidenceError("K2 seek chain is invalid")
        segment_frames = min(1500, expected["sourceFrames"] - before); source_ms = trace.get("sourceWindowDurationMs")
        if source_ms != min(15000, expected["durationMs"] - before * 10) or trace.get("modelWindowDurationMs") != 30000 or trace.get("windowOffsetMs") != before * 10: raise EvidenceError("K2 source/model window identity drifted")
        proposed, applied = trace.get("proposedAdvanceFrames"), trace.get("appliedSeekAdvanceFrames")
        parsed = trace.get("parsedSeekAdvanceFrames")
        parse_status = trace.get("parseStatus")
        if not all(isinstance(value, int) for value in (parsed, proposed, applied)) or parsed <= 0:
            raise EvidenceError("K2 advance values are invalid")
        expected_proposed = segment_frames if parse_status == "no-speech" else min(parsed, segment_frames)
        expected_applied = min(expected_proposed, 1000, expected["sourceFrames"] - before)
        if proposed != expected_proposed or applied != expected_applied or after - before != expected_applied:
            raise EvidenceError("K2 advance/cap formula drifted")
        if parse_status not in {"decoded-seek", "source-window-end", "no-speech"} or trace.get("parseError") is not None or trace.get("skippedAsNoSpeech") != (parse_status == "no-speech"):
            raise EvidenceError("K2 parser flags are invalid")
        if parse_status == "no-speech" and parsed != segment_frames:
            raise EvidenceError("K2 no-speech advance drifted")
        if trace.get("usedDecodedSeek") != (parse_status == "decoded-seek"):
            raise EvidenceError("K2 decoded-seek flag drifted")
        if trace.get("vadTimestampRestored") is not False or trace.get("historyTokenCountBefore") != 0 or trace.get("historyTokenCountAfter") != 0: raise EvidenceError("K2 history/VAD identity drifted")
        next_ms = min(expected["durationMs"], after * 10); final = after == expected["sourceFrames"]
        overlap = segment_frames - applied
        if trace.get("nextWindowStartMs") != next_ms or trace.get("actualSourceOverlapFrames") != overlap or trace.get("actualSourceOverlapMs") != overlap * 10 or trace.get("ownershipStartMs") != before * 10 or trace.get("ownershipEndMs") != (expected["durationMs"] if final else next_ms) or trace.get("ownershipEndExclusive") != (not final) or trace.get("finalWindow") != final: raise EvidenceError("K2 ownership frontier is invalid")
        if source_ms == 15000 and not final and overlap < 500: raise EvidenceError("K2 overlap floor is invalid")
        if trace.get("sourceProgressBeforeMs") != previous_progress or trace.get("sourceProgressAfterMs") != next_ms: raise EvidenceError("K2 progress frontier is invalid")
        for flag in ("singleTimestampEnding", "usedDecodedSeek"):
            if not isinstance(trace.get(flag), bool): raise EvidenceError("K2 parser flag type is invalid")
        trace_last_before = previous_emitted_start
        dispositions = trace.get("segmentDispositions")
        count_names = ("parsedSegmentCount", "ownedBeforeDedupCount", "nonOwnerDiscardedCount", "exactDuplicateDiscardedCount", "emittedSegmentCount")
        counts = {key: trace.get(key) for key in count_names}
        if not isinstance(dispositions, list) or not all(isinstance(value, int) and value >= 0 for value in counts.values()):
            raise EvidenceError("K2 disposition counts are invalid")
        actual_counts = {key: 0 for key in count_names}
        for disposition in dispositions:
            if not isinstance(disposition, dict):
                raise EvidenceError("K2 disposition is invalid")
            start, end, text = disposition.get("startMs"), disposition.get("endMs"), disposition.get("text")
            segment_tokens = disposition.get("tokenIds")
            if (not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end <= expected["durationMs"]
                    or not isinstance(text, str) or not text.strip()
                    or not isinstance(segment_tokens, list) or len(segment_tokens) < 2
                    or any(not isinstance(token, int) or token < 0 for token in segment_tokens)):
                raise EvidenceError("K2 disposition segment is invalid")
            tuple_sha256 = _tuple_hash(start, end, text)
            if (disposition.get("tupleSha256") != tuple_sha256
                    or disposition.get("traceSha256") != digest
                    or disposition.get("ownershipAnchor") != "startMs"):
                raise EvidenceError("K2 tuple/trace provenance is invalid")
            ownership_end = expected["durationMs"] if final else next_ms
            owned = before * 10 <= start < ownership_end
            expected_owner = max(0, bisect.bisect_right(window_starts, start) - 1)
            kind = disposition.get("disposition")
            if disposition.get("ownerWindowIndex") != expected_owner:
                raise EvidenceError("K2 latest-start owner index is invalid")
            expected_kind = "non-owner" if not owned else (
                "exact-duplicate" if tuple_sha256 in emitted_tuple_hashes else "emitted"
            )
            if kind != expected_kind:
                raise EvidenceError("K2 disposition does not match ownership/dedup semantics")
            target = disposition.get("duplicateTargetSha256")
            if kind == "exact-duplicate":
                if target != tuple_sha256 or tuple_sha256 not in emitted_tuple_hashes:
                    raise EvidenceError("K2 exact-duplicate target is invalid")
            elif target is not None:
                raise EvidenceError("K2 non-duplicate has a target")
            actual_counts["parsedSegmentCount"] += 1
            if owned:
                actual_counts["ownedBeforeDedupCount"] += 1
            if kind == "non-owner":
                actual_counts["nonOwnerDiscardedCount"] += 1
            elif kind == "exact-duplicate":
                actual_counts["exactDuplicateDiscardedCount"] += 1
            else:
                actual_counts["emittedSegmentCount"] += 1
                if start < previous_emitted_start:
                    raise EvidenceError("K2 emitted start regressed")
                previous_emitted_start = start
                emitted_tuple_hashes.add(tuple_sha256)
                emitted.append(disposition)
        if counts != actual_counts:
            raise EvidenceError("K2 disposition category counts are not conserved")
        if trace.get("lastEmittedStartBeforeMs") != trace_last_before:
            raise EvidenceError("K2 last-emitted start-before anchor is invalid")
        if trace.get("lastEmittedStartAfterMs") != previous_emitted_start:
            raise EvidenceError("K2 last-emitted start-after anchor is invalid")
        previous_seek = after; previous_progress = next_ms; trace_hashes.add(digest)
        feature_total += _num(trace.get("featureMs"), "feature timing"); generate_total += _num(trace.get("generateMs"), "generate timing")
    if (previous_seek != expected["sourceFrames"] or previous_progress != expected["durationMs"]
            or sample.get("progressMs") != [trace["sourceProgressAfterMs"] for trace in traces]
            or sample.get("generationCallCount") != sum(trace["generationCallCount"] for trace in traces)):
        raise EvidenceError("K2 trace/progress/generation chain does not end at source duration")
    emitted_top = []
    for segment in segments:
        if not isinstance(segment, dict): raise EvidenceError("K2 top-level segment is invalid")
        start, end, text = segment.get("startMs"), segment.get("endMs"), segment.get("text")
        segment_tokens = segment.get("tokenIds")
        if (not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end <= expected["durationMs"]
                or not isinstance(text, str) or not text.strip()
                or not isinstance(segment_tokens, list) or len(segment_tokens) < 2
                or segment.get("timestampStartToken") != segment_tokens[0]
                or segment.get("timestampEndToken") != segment_tokens[-1]
                or segment.get("rawStartMs") != start
                or not isinstance(segment.get("rawEndMs"), int) or segment["rawEndMs"] < end
                or segment.get("endBoundedToAudio") is not (segment["rawEndMs"] != end)
                or segment.get("compressedStartMs") is not None
                or segment.get("compressedEndMs") is not None
                or segment.get("vadTimestampRestored") is not False):
            raise EvidenceError("K2 top-level segment provenance is invalid")
        emitted_top.append((start, end, text, tuple(segment_tokens), segment.get("traceSha256")))
    expected_top = [(item["startMs"], item["endMs"], item["text"], tuple(item["tokenIds"]), item["traceSha256"]) for item in emitted]
    if emitted_top != expected_top:
        raise EvidenceError("K2 emitted top-level segments differ from dispositions")
    timings = sample.get("timings")
    if not isinstance(timings, dict): raise EvidenceError("K2 timings are missing")
    numeric = {key: _num(timings.get(key), key) for key in ("sampleWallMs", "featureMs", "modelGenerateMs", "inferenceMs", "inferenceRtf")}
    if not math.isclose(numeric["featureMs"], feature_total, rel_tol=1e-9, abs_tol=1e-6) or not math.isclose(numeric["modelGenerateMs"], generate_total, rel_tol=1e-9, abs_tol=1e-6) or not math.isclose(numeric["inferenceRtf"], numeric["inferenceMs"] / expected["durationMs"], rel_tol=1e-9, abs_tol=1e-12): raise EvidenceError("K2 timing components are inconsistent")
    if index == 0:
        numeric["loadMs"] = _num(timings.get("loadMs"), "loadMs"); numeric["processWallMs"] = _num(timings.get("processWallMs"), "processWallMs"); numeric["processWallRtf"] = _num(timings.get("processWallRtf"), "processWallRtf")
        if not math.isclose(numeric["processWallRtf"], numeric["processWallMs"] / expected["durationMs"], rel_tol=1e-9, abs_tol=1e-12): raise EvidenceError("K2 cold wall timing is inconsistent")
    elif any(timings.get(key) is not None for key in ("loadMs", "processWallMs", "processWallRtf")): raise EvidenceError("K2 warm sample contains cold timing")
    return {"runKind": sample["runKind"], "repeatIndex": sample["repeatIndex"], "segments": segments, "tokenTraces": traces, "timings": numeric, "ownership": {"windowCount": len(traces), "parsedSegmentCount": sum(trace["parsedSegmentCount"] for trace in traces), "nonOwnerDiscardedCount": sum(trace["nonOwnerDiscardedCount"] for trace in traces), "exactDuplicateDiscardedCount": sum(trace["exactDuplicateDiscardedCount"] for trace in traces), "emittedSegmentCount": sum(trace["emittedSegmentCount"] for trace in traces)}}


def validate_raw_identity(benchmark, raw: dict[str, Any], lock_path: Path, case_id: str) -> dict[str, Any]:
    expected = EXPECTED_CASES.get(case_id); lock_sha256 = sha256_file(lock_path); lock_text = lock_path.read_text(encoding="utf-8")
    if expected is None or raw.get("schemaVersion") != 1 or raw.get("kind") != EXPECTED_KIND or raw.get("status") != "completed" or raw.get("caseId") != case_id or raw.get("engine") != "kotoba-faster-whisper" or raw.get("candidate") != CANDIDATE_ID or raw.get("config") != EXPECTED_CONFIG or raw.get("inputLockSha256") != lock_sha256 or raw.get("audio") != {"sha256": expected["audioSha256"], "durationMs": expected["durationMs"], "sourceFrames": expected["sourceFrames"]}: raise EvidenceError("K2 raw envelope/config/source identity mismatch")
    model = raw.get("model")
    if not isinstance(model, dict) or (model.get("id"), model.get("revision")) != EXPECTED_MODEL or model.get("legacyCache") != {"layout": "huggingface-immutable-snapshot", "revisionDirectoryVerified": True, "usedInPlace": True}: raise EvidenceError("K2 model/cache identity mismatch")
    files = _named_files(model.get("files"), "Kotoba model")
    if {item["name"]: (item["sizeBytes"], item["sha256"]) for item in files} != EXPECTED_MODEL_FILES: raise EvidenceError("K2 model file identity drifted")
    runtime = raw.get("runtime")
    if not isinstance(runtime, dict) or runtime.get("requestedDevice") != "cuda" or runtime.get("resolvedDevice") != "cuda" or runtime.get("computeType") != "float16" or runtime.get("deviceIndex") != 0 or runtime.get("ctranslate2Version") != "4.8.0" or runtime.get("cudaBuildEnabled") is not True or runtime.get("cudaDynamicLoading") is not True or runtime.get("withCudnn") is not False or runtime.get("gpu") != EXPECTED_GPU or runtime.get("cpu") != EXPECTED_CPU: raise EvidenceError("K2 CUDA runtime identity drifted")
    executable = _identity(runtime.get("measurementExecutable"), "measurement executable")
    worker = _identity(runtime.get("productionWorker"), "production worker")
    if (executable["sizeBytes"], executable["sha256"]) != EXPECTED_MEASUREMENT_EXECUTABLE:
        raise EvidenceError("K2 measurement executable identity drifted")
    if (worker["sizeBytes"], worker["sha256"]) != EXPECTED_PRODUCTION_WORKER:
        raise EvidenceError("K2 production worker identity drifted")
    dlls = _named_files(runtime.get("requiredDlls"), "runtime")
    if {item["name"].lower(): (item["sizeBytes"], item["sha256"]) for item in dlls} != EXPECTED_RUNTIME_DLLS: raise EvidenceError("K2 runtime DLL set drifted")
    for item in (executable, worker, *dlls):
        if item["sha256"] not in lock_text: raise EvidenceError("K2 runtime identity is not frozen by lock")
    modules = _validate_modules(runtime, lock_text)
    resources = raw.get("resources")
    if not isinstance(resources, dict) or resources.get("method") != "GetProcessMemoryInfo.PeakWorkingSetSize" or not isinstance(resources.get("peakProcessRssBytes"), int) or resources["peakProcessRssBytes"] <= 0: raise EvidenceError("K2 process RSS evidence is invalid")
    samples = raw.get("samples")
    if not isinstance(samples, list) or len(samples) != expected["sampleCount"]: raise EvidenceError("K2 sample count is incomplete")
    validated = [_validate_sample(sample, index, expected) for index, sample in enumerate(samples)]
    return {"caseId": case_id, "audio": raw["audio"], "model": {"id": model["id"], "revision": model["revision"], "files": files, "legacyCache": model["legacyCache"]}, "config": raw["config"], "inputLockSha256": lock_sha256, "runtime": {"measurementExecutable": executable, "productionWorker": worker, "requiredDlls": dlls, "gpu": runtime["gpu"], "cpu": runtime["cpu"], "pathPolicy": {"name": runtime["pathPolicy"]["name"], "orderedEntryRoles": runtime["pathPolicy"]["orderedEntryRoles"], "rootIdentitySha256": runtime["pathPolicy"].get("rootIdentitySha256")}, "loadedModules": modules}, "resources": resources, "samples": validated}


def adapt(raw_path: Path, manifest: Path, corpus_root: Path, case_id: str, lock_path: Path, output: Path) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[4]; benchmark = load_benchmark(repo_root)
    require_task_local(benchmark, raw_path, "K2 raw evidence"); require_task_local(benchmark, output, "K2 adapted evidence")
    validation = benchmark.validate_manifest(manifest, corpus_root)
    if validation["manifestSha256"] != EXPECTED_MANIFEST_SHA256 or validation["manifest"]["corpusId"] != EXPECTED_CORPUS_ID: raise EvidenceError("K2 authoritative manifest identity drifted")
    case = next((item for item in validation["cases"] if item["id"] == case_id), None); expected = EXPECTED_CASES.get(case_id)
    if case is None or expected is None or any(case.get(key) != expected[key] for key in ("audioSha256", "assSha256", "durationMs")): raise EvidenceError("K2 authoritative case identity drifted")
    identity = validate_raw_identity(benchmark, json.loads(raw_path.read_text(encoding="utf-8")), lock_path, case_id)
    audio_path = validation["corpusRoot"] / Path(*PurePosixPath(case["audio"]).parts)
    if benchmark.sha256_file(audio_path) != expected["audioSha256"]: raise EvidenceError("K2 authoritative audio hash drifted")
    samples = []
    for sample in identity["samples"]:
        metrics = benchmark._sample_metrics(case["reference"]["text"], case["reference"]["segments"], case["reference"]["speechIntervals"], [{"startMs": item["startMs"], "endMs": item["endMs"], "text": item["text"]} for item in sample["segments"]], case["durationMs"], "engine-native", "kotoba-faster-whisper")
        samples.append({"status": "completed", "runKind": sample["runKind"], "repeatIndex": sample["repeatIndex"], "timings": sample["timings"], "metrics": {"cer": metrics["cer"]["cer"], "timelineErrors": sum(int(metrics["timeline"].get(key, 0)) for key in ("afterAudioEndCount", "emptyTextCount", "negativeStartCount", "nonMonotonicCount", "nonPositiveDurationCount")), "semanticGapCount": len(metrics["missingSpeechRegions"]), "excludedVocalizationGapCount": len(metrics["excludedNonSemanticVocalizationRegions"])}, "ownership": sample["ownership"]})
    result = {"schemaVersion": 1, "kind": "hikaru-ct2-kotoba-k2-adapted", "manifest": {"corpusId": EXPECTED_CORPUS_ID, "sha256": EXPECTED_MANIFEST_SHA256}, "engine": "kotoba-faster-whisper", "candidateId": CANDIDATE_ID, "ownershipRule": OWNERSHIP_RULE, "model": f"{EXPECTED_MODEL[0]}@{EXPECTED_MODEL[1]}", "device": "cuda", "computeType": "float16", "case": {"caseId": case_id, "audioSha256": expected["audioSha256"], "assSha256": expected["assSha256"], "durationMs": expected["durationMs"], "samples": samples}, "runtime": identity["runtime"], "privacy": "sanitized identities, hashes, aggregates, and metrics only"}
    benchmark.atomic_write_json(output, result); return result


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--raw", type=Path, required=True); parser.add_argument("--manifest", type=Path, required=True); parser.add_argument("--corpus-root", type=Path, required=True); parser.add_argument("--case", choices=tuple(EXPECTED_CASES), required=True); parser.add_argument("--input-lock", type=Path, required=True); parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try: adapt(args.raw, args.manifest, args.corpus_root, args.case, args.input_lock, args.output)
    except EvidenceError as error: print(json.dumps({"status": "no-result", "error": str(error)}, sort_keys=True)); return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
