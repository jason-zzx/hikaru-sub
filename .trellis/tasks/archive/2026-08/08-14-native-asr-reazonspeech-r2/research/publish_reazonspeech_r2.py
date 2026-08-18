#!/usr/bin/env python3
"""Validate frozen R2 raw bytes and publish sanitized deterministic evidence."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import statistics
import sys
import wave
from typing import Any

import run_reazonspeech_r2 as runner

TASK_ROOT = runner.TASK_ROOT
REPO_ROOT = runner.REPO_ROOT
RESEARCH_ROOT = runner.RESEARCH_ROOT
LOCAL_ROOT = runner.LOCAL_ROOT
RAW_ROOT = runner.RAW_ROOT
CASE_ORDER = ("short-v1", "medium-v1", "long-v2")
TIMELINE_FIELDS = ("afterAudioEndCount", "emptyTextCount", "negativeStartCount", "nonMonotonicCount", "nonPositiveDurationCount")
R1_PUBLICATION = REPO_ROOT / ".trellis" / "tasks" / "archive" / "2026-08" / "08-13-native-asr-parakeet-reazon" / "08-13-native-asr-parakeet-reazon" / "research" / "evidence" / "t10-parakeet-reazon.json"
R1_PUBLICATION_IDENTITY = (10_349, "ca7512e91b8b69197ff22acbcb5f5b45434c4b5c9b92c1307e479d6a50d246af")
R1_LONG_RAW = REPO_ROOT / ".trellis" / "tasks" / "archive" / "2026-08" / "08-13-native-asr-parakeet-reazon" / "08-13-native-asr-parakeet-reazon" / "research" / "local" / "raw" / "reazonspeech-nemo" / "long-v2" / "measured-0.json"
R1_LONG_RAW_IDENTITY = (126_944, "2a80b258a661c1c83993c7caf3eac96ff3dfee0471a256905ef09c787b0c21b9")
R1_REVIEWED_LONG_FAILURE = {
    "subtype": "zero_duration_top_level_result",
    "zeroBasedWindowIndex": 23,
    "windowStartMs": 345_000,
    "windowEndMs": 360_000,
    "localStartMs": 14_800,
    "localEndMs": 14_800,
    "segmentIndex": 0,
    "resultTraceSha256": "3bfbc7e4f380eea9c5f7940def40e576dcb80caa458f093bef247eca6c76889b",
}
R2_REVIEWED_LONG_FAILURE = {
    "subtype": "zero_duration_top_level_result",
    "zeroBasedWindowIndex": 61,
    "windowStartMs": 763_590,
    "windowEndMs": 768_570,
    "localStartMs": 2_160,
    "localEndMs": 2_160,
    "segmentIndex": 0,
    "resultTraceSha256": "f3179c7ab489bfcc211b4779fa15fb481354850dd08cbf2286b64c00f13c45bb",
}
R1_BASELINE = {
    "candidateId": "R1-window15s-top-level-v1",
    "short-v1": {"status": "completed", "cer": 0.225, "semanticGaps": 1, "timelineErrors": 0},
    "medium-v1": {"status": "completed", "cer": 0.37714285714285717, "semanticGaps": 22, "timelineErrors": 0},
    "long-v2": {
        "status": "validated-failed",
        "errorCode": "crispasr_result_invalid",
        "resultFailureSubtype": "zero_duration_top_level_result",
        "resultFailureFingerprintSha256": "6c76aa3a15660de07b377754a75c9938add1a71edb58d3b1a988ab5c75935716",
    },
}
GATES = {
    "cerMax": 0.35,
    "acceleratedInferenceRtfMax": 0.5,
    "shortColdWallMsMax": 120_000,
    "crispasrPeakRssBytesMax": 12 * 1024**3,
    "timelineErrorsMax": 0,
    "semanticGapsMax": 0,
    "maxCueCodePoints": 96,
    "maxCueDurationMs": 15_000,
    "maxAdjacentNativePaddingOverlapMs": 60,
    "paddedMaxInferenceWindowMs": 12_060,
}
RELATIVE_THRESHOLDS = {
    "cerAbsoluteReductionMin": 0.02,
    "mediumSemanticGapMaximum": 17,
    "shortSemanticGapMaximum": 0,
    "antiRegressionCerIncreaseMax": 0.02,
}
RELATIVE_SAFETY_FAILURE_CODES = frozenset({
    "crispasr_vad_result_invalid",
    "crispasr_result_invalid",
    "crispasr_window_invalid",
    "parakeet_family_invalid_input",
    "parakeet_family_empty_output",
    "parakeet_family_text_conservation",
    "parakeet_family_cue_limit",
    "invalid_segment",
    "invalid_segment_order",
    "replacement_too_large",
    "event_line_too_large",
})


class EvidenceError(ValueError):
    pass


def load_benchmark():
    path = REPO_ROOT / "scripts" / "asr-benchmark.py"
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark_reazonspeech_r2", path)
    if spec is None or spec.loader is None:
        raise EvidenceError("cannot load shared T01 comparator")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def atomic_bytes(path: Path, data: bytes) -> None:
    runner.require_contained(path, RESEARCH_ROOT, "tracked publication output")
    path.parent.mkdir(parents=True, exist_ok=True)
    runner.require_contained(path, RESEARCH_ROOT, "tracked publication output")
    temporary = path.with_suffix(path.suffix + ".tmp")
    runner.require_contained(temporary, RESEARCH_ROOT, "tracked publication temporary output")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def exact_json(left: Any, right: Any) -> bool:
    return json.dumps(left, ensure_ascii=False, sort_keys=True, separators=(",", ":")) == json.dumps(right, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def published_result_failure(detail: dict[str, Any]) -> dict[str, Any]:
    value = dict(detail)
    value["fingerprintSha256"] = runner.result_failure_fingerprint(detail)
    return value


def expected_paths() -> list[tuple[str, str, int, Path]]:
    rows = []
    for case_id in CASE_ORDER:
        for run_kind, repeat_index in sorted(runner.EXPECTED_ROLES[case_id], key=lambda item: (item[0] != "cold", item[0] != "warm", item[1])):
            raw, _ = runner.expected_output(case_id, run_kind, repeat_index)
            rows.append((case_id, run_kind, repeat_index, raw))
    return rows


def build_index(path: Path) -> dict[str, Any]:
    verify_frozen_inputs()
    runner.require_exact_role_path(path, RESEARCH_ROOT, "r2-raw-index.json", "raw index")
    entries = []
    for case_id, run_kind, repeat_index, raw in expected_paths():
        if not raw.is_file():
            raise EvidenceError(f"missing raw row: {case_id}/{run_kind}-{repeat_index}")
        relative = f"formal/raw/{case_id}/{run_kind}-{repeat_index}.json"
        runner.require_exact_role_path(raw, RAW_ROOT, f"{case_id}/{run_kind}-{repeat_index}.json", "raw row")
        runner.require_private_path(raw, RAW_ROOT, "raw row")
        entries.append({
            "caseId": case_id,
            "runKind": run_kind,
            "repeatIndex": repeat_index,
            "relativeRawPath": relative,
            "sizeBytes": raw.stat().st_size,
            "sha256": runner.sha256(raw),
        })
    value = {"schema": runner.INDEX_SCHEMA, "frozen": True, "candidateId": runner.CANDIDATE_ID, "entries": entries}
    atomic_bytes(path, (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode("utf-8"))
    return value


def verify_r1_authority() -> None:
    runner.require_identity(R1_PUBLICATION, R1_PUBLICATION_IDENTITY, "R1 publication")
    value = json.loads(R1_PUBLICATION.read_text(encoding="utf-8"))
    result = value.get("results", {}).get("reazonspeech-nemo", {})
    if result.get("identity", {}).get("candidateId") != R1_BASELINE["candidateId"]:
        raise EvidenceError("R1 candidate identity drifted")
    cases = {case["caseId"]: case for case in result.get("cases", [])}
    for case_id in ("short-v1", "medium-v1"):
        expected = R1_BASELINE[case_id]
        row = cases.get(case_id, {})
        actual = {
            "status": row.get("status"),
            "cer": row.get("measurements", {}).get("maximumSampleCer"),
            "semanticGaps": row.get("measurements", {}).get("maximumSemanticSpeechGapsAtLeast1500Ms"),
            "timelineErrors": row.get("measurements", {}).get("maximumTimelineErrors"),
        }
        if actual != expected:
            raise EvidenceError(f"R1 {case_id} thresholds drifted")
    long_row = cases.get("long-v2", {})
    if {
        "status": long_row.get("status"),
        "errorCode": long_row.get("errorCode"),
    } != {
        "status": R1_BASELINE["long-v2"]["status"],
        "errorCode": R1_BASELINE["long-v2"]["errorCode"],
    }:
        raise EvidenceError("R1 long-v2 baseline drifted")
    runner.require_identity(R1_LONG_RAW, R1_LONG_RAW_IDENTITY, "R1 long-v2 ignored raw authority")
    raw = json.loads(R1_LONG_RAW.read_text(encoding="utf-8"))
    match = re.fullmatch(
        r"CrispASR final result is invalid: segment=(\d+) startMs=(\d+) endMs=(\d+) durationMs=(\d+)",
        raw.get("errorMessage", ""),
    )
    if not match:
        raise EvidenceError("R1 long-v2 result failure trace is invalid")
    segment_index, local_start, local_end, window_duration = map(int, match.groups())
    derived = {
        "subtype": (
            "zero_duration_top_level_result"
            if local_start == local_end
            else "other_top_level_result_invalid"
        ),
        "zeroBasedWindowIndex": len(raw.get("sourceSegments", [])),
        "windowStartMs": raw.get("failedWindowStartMs"),
        "windowEndMs": raw.get("failedWindowEndMs"),
        "localStartMs": local_start,
        "localEndMs": local_end,
        "segmentIndex": segment_index,
        "resultTraceSha256": runner.result_trace_sha256(
            segment_index, local_start, local_end, window_duration
        ),
    }
    if (
        raw.get("candidateId") != R1_BASELINE["candidateId"]
        or raw.get("caseId") != "long-v2"
        or raw.get("status") != "validated-failed"
        or raw.get("errorCode") != "crispasr_result_invalid"
        or raw.get("finalSegments") != []
        or derived != R1_REVIEWED_LONG_FAILURE
        or runner.result_failure_fingerprint(derived)
        != R1_BASELINE["long-v2"]["resultFailureFingerprintSha256"]
    ):
        raise EvidenceError("R1 long-v2 reviewed result subtype/fingerprint drifted")


def verify_frozen_inputs() -> None:
    runner.verify_static_inputs()
    verify_r1_authority()
    runner.require_identity(runner.BUILD_BIN / "hikaru-asr-worker.exe", runner.STATIC_IDENTITIES["worker"], "final worker")
    if Path(runner.__file__).resolve() != runner.TOOL_PATHS["research/run_reazonspeech_r2.py"].resolve():
        raise EvidenceError("acquisition runner import path drifted")


def load_index(path: Path) -> tuple[str, list[dict[str, Any]]]:
    verify_frozen_inputs()
    runner.require_exact_role_path(path, RESEARCH_ROOT, "r2-raw-index.json", "raw index")
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema") != runner.INDEX_SCHEMA or value.get("frozen") is not True or value.get("candidateId") != runner.CANDIDATE_ID:
        raise EvidenceError("raw index identity drifted")
    entries = value.get("entries")
    expected_order = [(case_id, run_kind, repeat) for case_id, run_kind, repeat, _ in expected_paths()]
    if not isinstance(entries, list) or len(entries) != len(expected_order):
        raise EvidenceError("raw role matrix is incomplete")
    actual_order = [(entry.get("caseId"), entry.get("runKind"), entry.get("repeatIndex")) for entry in entries if isinstance(entry, dict)]
    if actual_order != expected_order:
        raise EvidenceError("raw role matrix is duplicated, reordered, or drifted")
    rows = []
    for entry in entries:
        relative = entry.get("relativeRawPath")
        expected_relative = f"formal/raw/{entry['caseId']}/{entry['runKind']}-{entry['repeatIndex']}.json"
        if relative != expected_relative:
            raise EvidenceError("raw path role drifted")
        raw = runner.require_exact_role_path(
            LOCAL_ROOT / relative,
            RAW_ROOT,
            f"{entry['caseId']}/{entry['runKind']}-{entry['repeatIndex']}.json",
            "indexed raw")
        runner.require_private_path(raw, RAW_ROOT, "indexed raw")
        if not raw.is_file() or raw.stat().st_size != entry.get("sizeBytes") or runner.sha256(raw) != entry.get("sha256"):
            raise EvidenceError("indexed raw bytes drifted")
        row = json.loads(raw.read_text(encoding="utf-8"))
        for key in ("caseId", "runKind", "repeatIndex"):
            if row.get(key) != entry[key]:
                raise EvidenceError(f"raw {key} differs from index")
        rows.append(row)
    return runner.sha256(path), rows


def validate_identity(row: dict[str, Any], case_id: str) -> None:
    identity = row.get("identity")
    if not isinstance(identity, dict):
        raise EvidenceError("raw identity is missing")
    expected_files = {
        "inputLock": runner.identity(runner.INPUT_LOCK),
        "runner": runner.identity(Path(runner.__file__).resolve()),
        "worker": {"sizeBytes": runner.STATIC_IDENTITIES["worker"][0], "sha256": runner.STATIC_IDENTITIES["worker"][1]},
        "model": {"sizeBytes": runner.STATIC_IDENTITIES["model"][0], "sha256": runner.STATIC_IDENTITIES["model"][1]},
        "vad": {"sizeBytes": runner.STATIC_IDENTITIES["vad"][0], "sha256": runner.STATIC_IDENTITIES["vad"][1]},
        "manifest": {"sizeBytes": runner.STATIC_IDENTITIES["manifest"][0], "sha256": runner.STATIC_IDENTITIES["manifest"][1]},
        "comparator": {"sizeBytes": runner.STATIC_IDENTITIES["comparator"][0], "sha256": runner.STATIC_IDENTITIES["comparator"][1]},
        "protocolLimits": {"sizeBytes": runner.STATIC_IDENTITIES["protocolLimits"][0], "sha256": runner.STATIC_IDENTITIES["protocolLimits"][1]},
        "formalTools": runner.verify_tool_identities(),
    }
    for key, expected in expected_files.items():
        if identity.get(key) != expected:
            raise EvidenceError(f"{key} identity drifted")
    _, audio_size, audio_hash, _ = runner.CASES[case_id]
    if identity.get("audio") != {"sizeBytes": audio_size, "sha256": audio_hash}:
        raise EvidenceError("audio identity drifted")
    expected_runtime = {name: {"sizeBytes": size, "sha256": digest} for name, (size, digest) in sorted(runner.RUNTIME_IDENTITIES.items())}
    if identity.get("runtimeFiles") != expected_runtime:
        raise EvidenceError("runtime identity drifted")
    expected_sources = {relative: {"sizeBytes": size, "sha256": digest} for relative, (size, digest) in sorted(runner.SOURCE_IDENTITIES.items())}
    if identity.get("sourceFiles") != expected_sources:
        raise EvidenceError("worker/policy source identity drifted")
    if identity.get("device") != runner.EXPECTED_DEVICE:
        raise EvidenceError("CUDA device identity drifted")
    if identity.get("deviceSelectionEnvironment") != runner.DEVICE_SELECTION_ENVIRONMENT:
        raise EvidenceError("child device-selection environment drifted")
    policy = identity.get("pathPolicy")
    if not isinstance(policy, dict) or policy.get("policy") != runner.PATH_POLICY or policy.get("orderedRootRoles") != ["runtime-bin", "cuda-bin", "system32"]:
        raise EvidenceError("restricted PATH policy drifted")
    roots = policy.get("orderedRoots")
    if not isinstance(roots, list) or len(roots) != 3:
        raise EvidenceError("restricted PATH roots are invalid")
    expected_roots = [str(root.resolve(strict=True)) for root in (runner.RUNTIME_ROOT, runner.CUDA_ROOT, runner.SYSTEM32)]
    if roots != expected_roots:
        raise EvidenceError("restricted PATH root identity drifted")
    for role, root in zip(policy["orderedRootRoles"], (runner.RUNTIME_ROOT, runner.CUDA_ROOT, runner.SYSTEM32)):
        runner.require_contained(root.resolve(strict=True), root.resolve(strict=True), f"published PATH {role}")
    validate_modules(identity.get("loadedModules"))


def validate_modules(value: Any) -> str:
    if not isinstance(value, list) or not value:
        raise EvidenceError("loaded module inventory is missing")
    seen_names = set()
    sanitized = []
    by_name: dict[str, tuple[str, str, dict[str, Any]]] = {}
    expected_runtime = {**runner.REQUIRED_LOADED_RUNTIME_IDENTITIES, "hikaru-asr-worker.exe": runner.STATIC_IDENTITIES["worker"]}
    for module in value:
        if not isinstance(module, dict):
            raise EvidenceError("loaded module row is invalid")
        name, role, relative, file_identity = module.get("name"), module.get("rootRole"), module.get("relativePath"), module.get("identity")
        if not isinstance(name, str) or not name or role not in {"runtime-bin", "cuda-bin", "system32"} or not isinstance(relative, str) or not relative or not isinstance(file_identity, dict):
            raise EvidenceError("loaded module fields are invalid")
        lower_name = name.lower()
        relative_path = Path(relative.replace("\\", "/"))
        if relative_path.is_absolute() or ".." in relative_path.parts or relative_path.name.lower() != lower_name:
            raise EvidenceError("loaded module relative path is invalid")
        if lower_name in seen_names:
            raise EvidenceError("loaded module basename is duplicated")
        seen_names.add(lower_name)
        if role in {"runtime-bin", "cuda-bin"}:
            if role != "runtime-bin" or relative.lower() != lower_name or lower_name not in expected_runtime:
                raise EvidenceError(f"unexpected native module in restricted role: {lower_name}")
            size, digest = expected_runtime[lower_name]
            if file_identity != {"sizeBytes": size, "sha256": digest}:
                raise EvidenceError(f"restricted runtime module identity drifted: {lower_name}")
        by_name[lower_name] = (role, relative.lower(), file_identity)
        sanitized.append((lower_name, role, relative.lower(), file_identity.get("sizeBytes"), file_identity.get("sha256")))
    expected = {name: ("runtime-bin", name, {"sizeBytes": size, "sha256": digest}) for name, (size, digest) in expected_runtime.items()}
    expected.update({name: ("system32", name, {"sizeBytes": size, "sha256": digest}) for name, (size, digest) in runner.SYSTEM_MODULE_IDENTITIES.items()})
    for name, expected_row in expected.items():
        if by_name.get(name) != expected_row:
            raise EvidenceError(f"required loaded module identity drifted: {name}")
    return runner.canonical_hash(sorted(sanitized))


def audio_sample_count(case_id: str) -> int:
    name = runner.CASES[case_id][0]
    path = runner.require_exact_role_path(runner.AUDIO_ROOT / name, runner.AUDIO_ROOT, name, "published staged audio")
    runner.require_private_path(path, runner.AUDIO_ROOT, "published staged audio")
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, runner.SAMPLE_RATE, "NONE"):
            raise EvidenceError("audio shape drifted")
        return audio.getnframes()


def validate_windows(row: dict[str, Any]) -> list[dict[str, int]]:
    case_id = row["caseId"]
    windows = row.get("vadWindows")
    if not isinstance(windows, list) or not windows:
        raise EvidenceError("VAD window evidence is missing")
    sample_count = audio_sample_count(case_id)
    previous_start_ms = previous_end_ms = two_back_end_ms = -1
    samples_per_ms = runner.SAMPLE_RATE // 1000
    if runner.SAMPLE_RATE % 1000:
        raise EvidenceError("sample rate cannot represent integer milliseconds")
    for index, window in enumerate(windows):
        if not isinstance(window, dict) or set(window) != {"index", "startSample", "endSample", "startMs", "endMs", "durationMs", "overlapWithPreviousMs"}:
            raise EvidenceError("VAD window shape drifted")
        if any(not isinstance(window[key], int) or isinstance(window[key], bool) for key in window):
            raise EvidenceError("VAD window field type drifted")
        start_ms, end_ms = window["startMs"], window["endMs"]
        start_sample, end_sample = window["startSample"], window["endSample"]
        overlap_ms = max(0, previous_end_ms - start_ms) if index else 0
        if (window["index"] != index
                or start_ms < 0 or end_ms <= start_ms
                or start_sample != start_ms * samples_per_ms
                or end_sample != end_ms * samples_per_ms
                or end_sample > sample_count
                or window["durationMs"] != end_ms - start_ms):
            raise EvidenceError("VAD window bounds/conversion drifted")
        if index and (start_ms <= previous_start_ms or end_ms <= previous_end_ms):
            raise EvidenceError("VAD window order drifted")
        if (window["overlapWithPreviousMs"] != overlap_ms
                or overlap_ms > runner.MAX_ADJACENT_OVERLAP_MS
                or (index > 1 and start_ms < two_back_end_ms)):
            raise EvidenceError("VAD overlap policy drifted")
        if end_ms - start_ms > runner.PADDED_MAX_WINDOW_MS or end_sample - start_sample > runner.PADDED_MAX_WINDOW_SAMPLES:
            raise EvidenceError("VAD padded cap drifted")
        two_back_end_ms, previous_start_ms, previous_end_ms = previous_end_ms, start_ms, end_ms
    if row.get("vadWindowsSha256") != runner.canonical_hash(windows):
        raise EvidenceError("VAD window hash drifted")
    return windows


def protocol_limits() -> dict[str, int]:
    value = json.loads(runner.PROTOCOL_LIMITS.read_text(encoding="utf-8"))
    if value.get("protocolVersion") != 1:
        raise EvidenceError("protocol authority drifted")
    return value


def validate_segment(segment: Any, duration_ms: int, limits: dict[str, int]) -> None:
    if not isinstance(segment, dict) or set(segment) != {"startMs", "endMs", "text"}:
        raise EvidenceError("replacement segment shape drifted")
    start, end, text = segment["startMs"], segment["endMs"], segment["text"]
    if not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int) or isinstance(end, bool) or not isinstance(text, str) or not text:
        raise EvidenceError("replacement segment fields drifted")
    encoded = text.encode("utf-8", "strict")
    if start < 0 or end <= start or end > duration_ms or len(encoded) > limits["maxTextBytes"] or any(byte < 0x20 or byte == 0x7f for byte in encoded):
        raise EvidenceError("replacement segment violates protocol")


def validate_protocol(row: dict[str, Any], windows: list[dict[str, int]]) -> tuple[list[dict[str, Any]], list[int], dict[str, Any]]:
    trace = row.get("protocolTrace")
    if not isinstance(trace, dict) or not isinstance(trace.get("events"), list) or not trace["events"]:
        raise EvidenceError("protocol trace is missing")
    events = trace["events"]
    wire = bytearray()
    ready = replacement = terminal = None
    progress = []
    previous_start = -1
    limits = protocol_limits()
    previous_at_ms = -1.0
    for index, item in enumerate(events):
        if not isinstance(item, dict) or not isinstance(item.get("atMs"), (int, float)) or isinstance(item.get("atMs"), bool) or not math.isfinite(item["atMs"]) or item["atMs"] < previous_at_ms or not isinstance(item.get("lineSizeBytes"), int) or item["lineSizeBytes"] <= 0 or not isinstance(item.get("lineSha256"), str) or len(item["lineSha256"]) != 64:
            raise EvidenceError("protocol event envelope is invalid")
        previous_at_ms = item["atMs"]
        event = item.get("value")
        canonical = json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if hashlib.sha256(canonical).hexdigest() != item["lineSha256"] or len(canonical) != item["lineSizeBytes"]:
            raise EvidenceError("protocol line bytes/hash drifted")
        wire.extend(canonical)
        wire.append(0x0A)
        if not isinstance(event, dict) or event.get("protocolVersion") != 1:
            raise EvidenceError("protocol event version drifted")
        kind = event.get("event")
        if terminal is not None:
            raise EvidenceError("protocol event follows terminal")
        if kind == "error":
            if not isinstance(event.get("code"), str) or not event["code"] or not isinstance(event.get("message"), str) or not event["message"]:
                raise EvidenceError("structured error is invalid")
            terminal = event
        elif kind == "ready":
            if index != 0 or ready is not None or event.get("backend") != "crispasr" or event.get("device") != "cuda" or event.get("durationMs") != row["durationMs"]:
                raise EvidenceError("ready event drifted")
            ready = event
        elif ready is None:
            raise EvidenceError("non-error event occurred before ready")
        elif kind == "progress":
            processed = event.get("processedMs")
            if event.get("durationMs") != row["durationMs"] or not isinstance(processed, int) or isinstance(processed, bool) or processed < (progress[-1] if progress else 0) or processed > row["durationMs"]:
                raise EvidenceError("progress event drifted")
            progress.append(processed)
        elif kind == "segment":
            raise EvidenceError("raw preview segment is forbidden")
        elif kind == "segmentsReplace":
            if replacement is not None or not isinstance(event.get("segments"), list) or len(event["segments"]) > limits["maxReplacementSegments"]:
                raise EvidenceError("atomic replacement drifted")
            for segment in event["segments"]:
                validate_segment(segment, row["durationMs"], limits)
                if segment["startMs"] < previous_start:
                    raise EvidenceError("replacement order drifted")
                previous_start = segment["startMs"]
            replacement = event
        elif kind == "completed":
            if replacement is None or event.get("durationMs") != row["durationMs"] or event.get("detectedLanguage") != "ja":
                raise EvidenceError("completed event drifted")
            terminal = event
        else:
            raise EvidenceError("unknown protocol event")
    if trace.get("stdoutSizeBytes") != len(wire) or trace.get("stdoutSha256") != hashlib.sha256(wire).hexdigest():
        raise EvidenceError("stdout byte evidence drifted")
    if terminal is None:
        raise EvidenceError("protocol trace lacks terminal event")
    completed = terminal["event"] == "completed"
    if completed != (row.get("status") == "completed") or completed != (row.get("returnCode") == 0):
        raise EvidenceError("status/result promotion drifted")
    if not completed and row.get("status") != "validated-failed":
        raise EvidenceError("failed status drifted")
    if completed and replacement is None or not completed and replacement is not None:
        raise EvidenceError("atomic replacement/failure boundary drifted")
    planned_ends = [window["endMs"] for window in windows]
    if progress != planned_ends[:len(progress)] or len(progress) > len(windows) or (completed and progress != planned_ends):
        raise EvidenceError("progress/VAD call shape drifted")
    final_segments = [] if replacement is None else replacement["segments"]
    if row.get("finalSegments") != final_segments:
        raise EvidenceError("final segment trace drifted")
    state = {
        "status": "completed" if completed else "validated-failed",
        "ready": ready,
        "progressMs": progress,
        "replacement": replacement,
        "terminal": terminal,
    }
    return final_segments, progress, state


def validate_attempt(row: dict[str, Any]) -> dict[str, Any]:
    if row.get("schema") != runner.RAW_SCHEMA or row.get("candidateId") != runner.CANDIDATE_ID or row.get("caseId") not in CASE_ORDER:
        raise EvidenceError("raw schema/candidate/case drifted")
    case_id = row["caseId"]
    if (row.get("runKind"), row.get("repeatIndex")) not in runner.EXPECTED_ROLES[case_id]:
        raise EvidenceError("raw role drifted")
    if not exact_json(row.get("algorithm"), runner.ALGORITHM):
        raise EvidenceError("algorithm/VAD/strategy identity drifted")
    _, _, _, duration = runner.CASES[case_id]
    if row.get("durationMs") != duration:
        raise EvidenceError("case duration drifted")
    validate_identity(row, case_id)
    windows = validate_windows(row)
    final_segments, progress, protocol_state = validate_protocol(row, windows)
    evidence_trace = row.get("evidenceTrace")
    if not isinstance(evidence_trace, list):
        raise EvidenceError("worker/backend evidence trace is missing")
    try:
        source_evidence = runner.validate_evidence_trace(evidence_trace, windows, protocol_state)
    except RuntimeError as error:
        raise EvidenceError(str(error)) from error
    request = row.get("request")
    expected_request = {
        "protocolVersion": 1,
        "jobId": f"r2-{case_id}-{row['runKind']}-{row['repeatIndex']}",
        "engine": "reazonspeech-nemo",
        "backend": "crispasr",
        "audioPath": str((runner.AUDIO_ROOT / runner.CASES[case_id][0]).resolve()),
        "modelPaths": [{"role": "model", "path": str((runner.MODEL_ROOT / "reazonspeech-nemo-v2-q8_0.gguf").resolve())}],
        "device": "cuda",
        "language": "ja",
        "useVad": False,
    }
    if request != expected_request:
        raise EvidenceError("worker request identity drifted")
    request_bytes = json.dumps(request, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if row.get("requestSha256") != hashlib.sha256(request_bytes).hexdigest():
        raise EvidenceError("worker request hash drifted")
    shape = row.get("shape")
    attempted = source_evidence["attemptedTranscribeCalls"]
    completed_calls = source_evidence["completedTranscribeCalls"]
    text_bytes = b"".join(segment["text"].encode("utf-8") for segment in final_segments)
    expected_shape = {
        "plannedVadWindows": len(windows),
        "completedTranscribeCalls": completed_calls,
        "attemptedTranscribeCalls": attempted,
        "sourceSegmentsPerCompletedWindow": 1,
        "finalCueCount": len(final_segments),
        "sourceShapeProvenance": "worker-backend-sanitized-source-result-trace-v1",
        "sourceTextSha256": None if source_evidence["policy"] is None else source_evidence["policy"]["sourceTextSha256"],
        "finalTextSha256": hashlib.sha256(text_bytes).hexdigest() if final_segments else None,
    }
    if shape != expected_shape or (row["status"] == "completed" and len(final_segments) != len(windows)):
        raise EvidenceError("source/final shape or text conservation drifted")
    error = row.get("error")
    if row["status"] == "completed":
        if error is not None or not final_segments:
            raise EvidenceError("completed result contains failure/empty output")
    else:
        terminal = row["protocolTrace"]["events"][-1]["value"]
        failure = source_evidence["failure"]
        if not isinstance(error, dict) or error != {
            "code": terminal.get("code"),
            "message": terminal.get("message"),
            "ready": protocol_state["ready"] is not None,
            "taxonomy": "candidate-caused-structured-failure",
            "stage": failure["stage"],
        } or final_segments:
            raise EvidenceError("structured failure provenance/taxonomy drifted")
    timings = row.get("timings")
    if not isinstance(timings, dict) or not isinstance(timings.get("processWallMs"), (int, float)) or isinstance(timings.get("processWallMs"), bool) or not math.isfinite(timings["processWallMs"]) or timings["processWallMs"] <= 0:
        raise EvidenceError("process timing is invalid")
    event_rows = row["protocolTrace"]["events"]
    ready_row = next((item for item in event_rows if item["value"]["event"] == "ready"), None)
    replacement_row = next((item for item in event_rows if item["value"]["event"] == "segmentsReplace"), None)
    expected_ready_at = None if ready_row is None else ready_row["atMs"]
    expected_terminal_at = event_rows[-1]["atMs"]
    expected_inference_end = replacement_row["atMs"] if replacement_row is not None else expected_terminal_at
    expected_inference = None if expected_ready_at is None else expected_inference_end - expected_ready_at
    if timings.get("readyAtMs") != expected_ready_at or timings.get("terminalAtMs") != expected_terminal_at or timings.get("inferenceMs") != expected_inference or timings["processWallMs"] < expected_terminal_at:
        raise EvidenceError("event-derived timing drifted")
    if expected_inference is not None and (not math.isfinite(expected_inference) or expected_inference <= 0):
        raise EvidenceError("inference timing is invalid")
    expected_attempted_through = source_evidence["attemptedThroughMs"]
    if timings.get("attemptedThroughMs") != expected_attempted_through:
        raise EvidenceError("attempted-through duration drifted")
    expected_scope = "full-case" if attempted == len(windows) else "partial-attempt"
    if timings.get("rtfScope") != expected_scope or (row["status"] == "completed" and expected_scope != "full-case"):
        raise EvidenceError("partial/full RTF labeling drifted")
    resources = row.get("resources")
    if not isinstance(resources, dict) or resources.get("method") != "GetProcessMemoryInfo.PeakWorkingSetSize" or not isinstance(resources.get("peakProcessRssBytes"), int) or resources["peakProcessRssBytes"] <= 0 or not isinstance(resources.get("moduleSampleCount"), int) or resources["moduleSampleCount"] <= 0:
        raise EvidenceError("resource evidence is invalid")
    stderr = row.get("stderr")
    expected_stderr_relative = f"formal/stderr/{case_id}/{row['runKind']}-{row['repeatIndex']}.log"
    if not isinstance(stderr, dict) or stderr.get("privacyPass") is not True or stderr.get("relativePath") != expected_stderr_relative:
        raise EvidenceError("stderr evidence drifted")
    stderr_path = runner.require_exact_role_path(
        LOCAL_ROOT / expected_stderr_relative,
        runner.STDERR_ROOT,
        f"{case_id}/{row['runKind']}-{row['repeatIndex']}.log",
        "stderr")
    runner.require_private_path(stderr_path, runner.STDERR_ROOT, "stderr")
    if not stderr_path.is_file() or stderr_path.stat().st_size != stderr.get("sizeBytes") or runner.sha256(stderr_path) != stderr.get("sha256"):
        raise EvidenceError("stderr bytes drifted")
    parsed_stderr_trace = runner.parse_evidence_trace(stderr_path.read_bytes())
    if not exact_json(parsed_stderr_trace, evidence_trace):
        raise EvidenceError("raw worker/backend trace differs from ignored stderr bytes")
    forbidden = {
        "metrics",
        "qualityDisposition",
        "relativeSelection",
        "relativeReasons",
        "gates",
        "allApplicableGatesPass",
        "_derivedResultFailure",
    }
    if forbidden & row.keys():
        raise EvidenceError("raw row contains caller-supplied result promotion fields")
    validated = dict(row)
    validated["_derivedResultFailure"] = source_evidence["resultFailure"]
    return validated


def percentile(values: list[int], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def replacement_size(segments: list[dict[str, Any]]) -> int:
    event = {"event": "segmentsReplace", "protocolVersion": 1, "segments": segments}
    return len(json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def cue_summary(segments: list[dict[str, Any]]) -> dict[str, Any]:
    code_points = [len(segment["text"]) for segment in segments]
    durations = [segment["endMs"] - segment["startMs"] for segment in segments]
    overlaps = [max(0, segments[index - 1]["endMs"] - segments[index]["startMs"]) for index in range(1, len(segments))]
    return {
        "count": len(segments),
        "codePoints": {"p50": percentile(code_points, 0.5), "p95": percentile(code_points, 0.95), "max": max(code_points, default=None)},
        "durationMs": {"p50": percentile(durations, 0.5), "p95": percentile(durations, 0.95), "max": max(durations, default=None)},
        "adjacentOverlapMs": {"count": sum(value > 0 for value in overlaps), "max": max(overlaps, default=0)},
    }


def score_completed(benchmark: Any, case: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    scored = []
    for row in rows:
        segments = row["finalSegments"]
        metrics = benchmark._sample_metrics(case["reference"]["text"], case["reference"]["segments"], case["reference"]["speechIntervals"], segments, case["durationMs"], "engine-native", "reazonspeech-nemo")
        scored.append((row, metrics))
    warm_rtfs = [row["timings"]["inferenceMs"] / row["durationMs"] for row, _ in scored if row["runKind"] == "warm"]
    accelerated_rtf = statistics.median(warm_rtfs) if warm_rtfs else scored[0][0]["timings"]["inferenceMs"] / scored[0][0]["durationMs"]
    cer = max(metrics["cer"]["cer"] for _, metrics in scored)
    timeline = max(sum(int(metrics["timeline"].get(field, 0)) for field in TIMELINE_FIELDS) for _, metrics in scored)
    semantic = max(len(metrics["missingSpeechRegions"]) for _, metrics in scored)
    excluded = max(len(metrics["excludedNonSemanticVocalizationRegions"]) for _, metrics in scored)
    rss = max(row["resources"]["peakProcessRssBytes"] for row, _ in scored)
    cold_wall = next((row["timings"]["processWallMs"] for row, _ in scored if row["runKind"] == "cold"), None)
    replacement_bytes = max(replacement_size(row["finalSegments"]) for row, _ in scored)
    cues_per_sample = [cue_summary(row["finalSegments"]) for row, _ in scored]
    maximum_code_points = max(item["codePoints"]["max"] for item in cues_per_sample)
    maximum_duration = max(item["durationMs"]["max"] for item in cues_per_sample)
    maximum_cue_overlap = max(item["adjacentOverlapMs"]["max"] for item in cues_per_sample)
    maximum_window = max(max(window["durationMs"] for window in row["vadWindows"]) for row, _ in scored)
    maximum_window_overlap = max(max(window["overlapWithPreviousMs"] for window in row["vadWindows"]) for row, _ in scored)
    limits = protocol_limits()
    gates = {
        "cerAtMost0_35": cer <= GATES["cerMax"],
        "acceleratedInferenceRtfAtMost0_5": accelerated_rtf <= GATES["acceleratedInferenceRtfMax"],
        "shortColdWallAtMost120s": None if cold_wall is None else cold_wall <= GATES["shortColdWallMsMax"],
        "peakRssAtMost12GiB": rss <= GATES["crispasrPeakRssBytesMax"],
        "timelineErrorsZero": timeline == 0,
        "semanticSpeechGapsZero": semantic == 0,
        "cueCodePointsAtMost96": maximum_code_points <= GATES["maxCueCodePoints"],
        "cueDurationAtMost15000Ms": maximum_duration <= GATES["maxCueDurationMs"],
        "cueStartsOrderedAndAudioBounded": True,
        "cueAdjacentOverlapAtMost60Ms": maximum_cue_overlap <= GATES["maxAdjacentNativePaddingOverlapMs"],
        "paddedWindowAtMost12060Ms": maximum_window <= GATES["paddedMaxInferenceWindowMs"],
        "adjacentNativePaddingOverlapAtMost60Ms": maximum_window_overlap <= GATES["maxAdjacentNativePaddingOverlapMs"],
        "oneCallAndCuePerVadWindow": all(row["shape"]["plannedVadWindows"] == row["shape"]["completedTranscribeCalls"] == row["shape"]["finalCueCount"] for row, _ in scored),
        "sourceResultsMatchFinalCues": True,
        "textConservation": all(row["shape"]["sourceTextSha256"] == row["shape"]["finalTextSha256"] for row, _ in scored),
        "oneAtomicReplacement": True,
        "replacementWithinProtocol": replacement_bytes <= limits["maxEventLineBytes"] and all(len(row["finalSegments"]) <= limits["maxReplacementSegments"] for row, _ in scored),
    }
    return {
        "caseId": case["id"],
        "status": "completed",
        "sampleCounts": {"cold": sum(row["runKind"] == "cold" for row, _ in scored), "warm": sum(row["runKind"] == "warm" for row, _ in scored), "measured": sum(row["runKind"] == "measured" for row, _ in scored)},
        "measurements": {
            "maximumSampleCer": cer,
            "acceleratedInferenceRtf": accelerated_rtf,
            "coldProcessWallMs": cold_wall,
            "peakProcessRssBytes": rss,
            "maximumTimelineErrors": timeline,
            "maximumSemanticSpeechGapsAtLeast1500Ms": semantic,
            "maximumExcludedVocalizationGapsAtLeast1500Ms": excluded,
            "maximumReplacementBytes": replacement_bytes,
            "maximumVadWindowDurationMs": maximum_window,
            "maximumVadWindowOverlapMs": maximum_window_overlap,
            "maximumCueOverlapMs": maximum_cue_overlap,
        },
        "cues": {
            "countRange": [min(item["count"] for item in cues_per_sample), max(item["count"] for item in cues_per_sample)],
            "maximumCodePoints": maximum_code_points,
            "maximumDurationMs": maximum_duration,
            "maximumAdjacentOverlapMs": maximum_cue_overlap,
        },
        "gates": gates,
        "allApplicableGatesPass": all(value is not False for value in gates.values()),
    }


def score_failed(case: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
    timings = row["timings"]
    attempted = timings["attemptedThroughMs"]
    inference = timings["inferenceMs"]
    summary = {
        "caseId": case["id"],
        "status": "validated-failed",
        "errorCode": row["error"]["code"],
        "ready": row["error"]["ready"],
        "attemptedWindowCount": row["shape"]["attemptedTranscribeCalls"],
        "completedWindowCount": row["shape"]["completedTranscribeCalls"],
        "attemptedThroughMs": attempted,
        "attemptedInferenceMs": inference,
        "attemptedInferenceRtf": None if not inference or attempted <= 0 else inference / attempted,
        "rtfScope": timings["rtfScope"],
        "peakProcessRssBytes": row["resources"]["peakProcessRssBytes"],
        "allApplicableGatesPass": False,
    }
    if timings["rtfScope"] == "full-case" and inference:
        summary["fullCaseInferenceRtf"] = inference / case["durationMs"]
    if row.get("_derivedResultFailure") is not None:
        summary["resultFailure"] = published_result_failure(row["_derivedResultFailure"])
    return summary


def case_summary(benchmark: Any, case: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    expected_count = 4 if case["id"] == "short-v1" else 1
    if len(rows) != expected_count:
        raise EvidenceError("case role count drifted")
    completed = [row for row in rows if row["status"] == "completed"]
    failed = [row for row in rows if row["status"] == "validated-failed"]
    if failed:
        failures = [score_failed(case, row) for row in failed]
        return {
            "caseId": case["id"],
            "status": "validated-failed",
            "sampleCounts": {
                "cold": sum(row["runKind"] == "cold" for row in rows),
                "warm": sum(row["runKind"] == "warm" for row in rows),
                "measured": sum(row["runKind"] == "measured" for row in rows),
                "completed": len(completed),
                "failed": len(failed),
            },
            "errorCode": failures[0]["errorCode"] if len({failure["errorCode"] for failure in failures}) == 1 else "multiple_structured_failures",
            "failures": failures,
            "peakProcessRssBytes": max(row["resources"]["peakProcessRssBytes"] for row in rows),
            "allApplicableGatesPass": False,
        }
    return score_completed(benchmark, case, completed)


def is_reviewed_same_class_r2_result_failure(case_id: str, failure: dict[str, Any]) -> bool:
    return (
        case_id == "long-v2"
        and failure.get("errorCode") == "crispasr_result_invalid"
        and failure.get("resultFailure") == published_result_failure(R2_REVIEWED_LONG_FAILURE)
        and R2_REVIEWED_LONG_FAILURE["subtype"] == R1_REVIEWED_LONG_FAILURE["subtype"]
    )


def relative_decision(cases: list[dict[str, Any]]) -> tuple[str, list[str], list[str]]:
    by_case = {case["caseId"]: case for case in cases}
    reasons = []
    regressions = []
    safety_blocked = False
    safety_gates = (
        "timelineErrorsZero",
        "cueCodePointsAtMost96",
        "cueDurationAtMost15000Ms",
        "cueStartsOrderedAndAudioBounded",
        "cueAdjacentOverlapAtMost60Ms",
        "paddedWindowAtMost12060Ms",
        "adjacentNativePaddingOverlapAtMost60Ms",
        "oneCallAndCuePerVadWindow",
        "sourceResultsMatchFinalCues",
        "textConservation",
        "oneAtomicReplacement",
        "replacementWithinProtocol",
    )
    safe_completed: dict[str, bool] = {}
    for case in cases:
        safe = case["status"] == "completed" and all(case.get("gates", {}).get(gate) is True for gate in safety_gates)
        safe_completed[case["caseId"]] = safe
        if case["status"] == "completed" and not safe:
            safety_blocked = True
            regressions.append(f"{case['caseId']}_new_evidence_timeline_protocol_text_or_cue_failure")
        failures = [
            failure
            for failure in case.get("failures", [])
            if isinstance(failure, dict)
        ]
        if not failures and case.get("errorCode") is not None:
            failures = [{"errorCode": case["errorCode"]}]
        for failure in failures:
            code = failure.get("errorCode")
            if code not in RELATIVE_SAFETY_FAILURE_CODES:
                continue
            if code == "crispasr_result_invalid" and is_reviewed_same_class_r2_result_failure(
                case["caseId"], failure
            ):
                continue
            safety_blocked = True
            regressions.append(
                f"{case['caseId']}_new_evidence_timeline_protocol_text_or_cue_failure"
            )
    if safe_completed["long-v2"]:
        reasons.append("long_completed")
    for case_id in ("short-v1", "medium-v1"):
        case = by_case[case_id]
        baseline = R1_BASELINE[case_id]
        if case["status"] != "completed":
            continue
        measurements = case["measurements"]
        if safe_completed[case_id] and measurements["maximumSampleCer"] <= baseline["cer"] - RELATIVE_THRESHOLDS["cerAbsoluteReductionMin"]:
            reasons.append(f"{case_id}_cer_reduction")
        if measurements["maximumSampleCer"] > baseline["cer"] + RELATIVE_THRESHOLDS["antiRegressionCerIncreaseMax"] and measurements["maximumSemanticSpeechGapsAtLeast1500Ms"] > baseline["semanticGaps"]:
            regressions.append(f"{case_id}_cer_and_gap_regression")
    medium = by_case["medium-v1"]
    if safe_completed["medium-v1"] and medium["measurements"]["maximumSemanticSpeechGapsAtLeast1500Ms"] <= RELATIVE_THRESHOLDS["mediumSemanticGapMaximum"]:
        reasons.append("medium_gap_reduction")
    short = by_case["short-v1"]
    if safe_completed["short-v1"] and short["measurements"]["maximumSemanticSpeechGapsAtLeast1500Ms"] <= RELATIVE_THRESHOLDS["shortSemanticGapMaximum"]:
        reasons.append("short_gap_eliminated")
    if safety_blocked:
        reasons.clear()
    selection = "better-than-r1" if reasons and not regressions else "no-material-improvement"
    return selection, sorted(set(reasons)), sorted(set(regressions))


def sanitized_identity(row: dict[str, Any]) -> dict[str, Any]:
    identity = row["identity"]
    return {
        "candidateId": runner.CANDIDATE_ID,
        "inputLock": identity["inputLock"],
        "acquisitionRunner": identity["runner"],
        "worker": identity["worker"],
        "runtimeFilesSha256": runner.canonical_hash(identity["runtimeFiles"]),
        "model": identity["model"],
        "vad": identity["vad"],
        "manifest": identity["manifest"],
        "comparator": identity["comparator"],
        "protocolLimits": identity["protocolLimits"],
        "formalToolsSha256": runner.canonical_hash(identity["formalTools"]),
        "sourceFilesSha256": runner.canonical_hash(identity["sourceFiles"]),
        "device": identity["device"],
        "deviceSelectionEnvironmentSha256": runner.canonical_hash(identity["deviceSelectionEnvironment"]),
        "pathPolicy": identity["pathPolicy"]["policy"],
        "loadedModulesSha256": validate_modules(identity["loadedModules"]),
        "algorithmSha256": runner.canonical_hash(runner.ALGORITHM),
    }


def publication(index_hash: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    validated = [validate_attempt(row) for row in rows]
    identities = {json.dumps(sanitized_identity(row), sort_keys=True) for row in validated}
    if len(identities) != 1:
        raise EvidenceError("formal matrix identity drifted")
    benchmark = load_benchmark()
    validation = benchmark.validate_manifest(runner.MANIFEST, REPO_ROOT / ".asr-benchmark")
    if validation["manifestSha256"] != runner.STATIC_IDENTITIES["manifest"][1]:
        raise EvidenceError("shared comparator manifest identity drifted")
    cases_by_id = {case["id"]: case for case in validation["cases"]}
    summaries = [case_summary(benchmark, cases_by_id[case_id], [row for row in validated if row["caseId"] == case_id]) for case_id in CASE_ORDER]
    quality = "qualified" if all(case["allApplicableGatesPass"] for case in summaries) else "stop-revise"
    relative, reasons, regressions = relative_decision(summaries)
    if quality == "qualified" and relative != "better-than-r1":
        raise EvidenceError("qualified result is inconsistent with the failed R1 baseline")
    result = {
        "schema": "hikaru-reazonspeech-r2-publication-v1",
        "candidateId": runner.CANDIDATE_ID,
        "rawIndexSha256": index_hash,
        "publisher": runner.identity(Path(__file__).resolve()),
        "identity": sanitized_identity(validated[0]),
        "r1Authority": {
            "publication": {
                "sizeBytes": R1_PUBLICATION_IDENTITY[0],
                "sha256": R1_PUBLICATION_IDENTITY[1],
            },
            "longRaw": {
                "sizeBytes": R1_LONG_RAW_IDENTITY[0],
                "sha256": R1_LONG_RAW_IDENTITY[1],
            },
            "candidateId": R1_BASELINE["candidateId"],
            "baseline": R1_BASELINE,
            "reviewedLongFailure": published_result_failure(R1_REVIEWED_LONG_FAILURE),
            "relativeThresholds": RELATIVE_THRESHOLDS,
        },
        "absoluteGates": GATES,
        "cases": summaries,
        "qualityDisposition": quality,
        "relativeSelection": relative,
        "relativeReasons": reasons,
        "relativeAntiRegressionFindings": regressions,
        "releaseRouteEnabled": False,
        "acceptedAlgorithmHandoff": quality == "qualified",
        "limitations": [
            "Development CUDA evidence only; runtime pack, VAD delivery, and device qualification remain downstream.",
            "Validated structured failures retain attempted-through timing and are never promoted to completed metrics.",
            "Release/default remains Python legacy and the Reazon native route remains disabled.",
        ],
    }
    privacy_scan(result)
    return result


def privacy_scan(value: Any) -> None:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    benchmark = load_benchmark()
    if benchmark.contains_machine_absolute_path(text):
        raise EvidenceError("sanitized publication contains a machine absolute path")
    forbidden = ("audioPath", "modelPaths", "errorMessage", "stderrPath", "sourceText", "finalText")
    if any(token in text for token in forbidden):
        raise EvidenceError("sanitized publication contains private raw fields")


def ordinal(value: int) -> str:
    suffix = "th" if 10 <= value % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(value % 10, "th")
    return f"{value}{suffix}"


def report_performance(case: dict[str, Any]) -> str:
    measurements = case.get("measurements", {})
    if "acceleratedInferenceRtf" in measurements:
        return str(measurements["acceleratedInferenceRtf"])
    failure = case.get("failures", [{}])[0]
    if failure.get("rtfScope") == "partial-attempt":
        return (
            f"partial-attempt {failure.get('attemptedInferenceRtf', '—')} through "
            f"{failure.get('attemptedThroughMs', '—')}ms; no full-case RTF"
        )
    if "fullCaseInferenceRtf" in failure:
        return f"full-case {failure['fullCaseInferenceRtf']}"
    return "—"


def report_result(case: dict[str, Any]) -> str:
    if case["allApplicableGatesPass"]:
        return "**pass**"
    failure = case.get("failures", [{}])[0]
    detail = failure.get("resultFailure")
    if isinstance(detail, dict):
        index = detail["zeroBasedWindowIndex"]
        return (
            f"**fail** `{failure['errorCode']}` / `{detail['subtype']}` at zero-based "
            f"window `{index}` ({ordinal(index + 1)} window)"
        )
    return "**fail**"


def render_report(value: dict[str, Any]) -> str:
    lines = [
        "# ReazonSpeech R2 formal report", "",
        f"Candidate: `{value['candidateId']}`", "",
        f"Quality disposition: **`{value['qualityDisposition']}`**", "",
        f"Relative selection: **`{value['relativeSelection']}`**", "",
        f"Raw index SHA-256: `{value['rawIndexSha256']}`", "",
        "| Case | Status | CER | CUDA RTF | Semantic gaps | Excluded gaps | Timeline | Max cue cp/ms | Max VAD window/overlap | Result |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for case in value["cases"]:
        measurements = case.get("measurements", {})
        cues = case.get("cues", {})
        lines.append(
            f"| `{case['caseId']}` | `{case['status']}` | {measurements.get('maximumSampleCer', '—')} | "
            f"{report_performance(case)} | "
            f"{measurements.get('maximumSemanticSpeechGapsAtLeast1500Ms', '—')} | "
            f"{measurements.get('maximumExcludedVocalizationGapsAtLeast1500Ms', '—')} | "
            f"{measurements.get('maximumTimelineErrors', '—')} | "
            f"{cues.get('maximumCodePoints', '—')} / {cues.get('maximumDurationMs', '—')} | "
            f"{measurements.get('maximumVadWindowDurationMs', '—')} / {measurements.get('maximumVadWindowOverlapMs', '—')} | "
            f"{report_result(case)} |")
    lines += [
        "", "## Relative reasons", "",
        *(f"- `{reason}`" for reason in value["relativeReasons"]),
        *(f"- Anti-regression: `{finding}`" for finding in value["relativeAntiRegressionFindings"]),
        "", "## Boundary", "",
        "No Release/default, frontend, settings, downloader, installer, portable, package, Parakeet, Qwen, or CTranslate2 route change.", "",
    ]
    return "\n".join(lines)


def render_handoff(value: dict[str, Any]) -> str:
    if value["qualityDisposition"] == "qualified":
        decision = "Accepted ReazonSpeech algorithm input for downstream qualification; route remains disabled."
    elif value["relativeSelection"] == "better-than-r1":
        decision = "Preferred development basis only; not accepted algorithm input and no T14/T15 handoff."
    else:
        decision = "No material improvement; return to planning before any secondary candidate."
    return "\n".join([
        "# ReazonSpeech R2 handoff", "",
        f"- Candidate: `{value['candidateId']}`",
        f"- Quality: `{value['qualityDisposition']}`",
        f"- Relative selection: `{value['relativeSelection']}`",
        f"- Decision: {decision}",
        "- Release/default remains Python legacy; Reazon native remains disabled.",
        "- Gap-fill/F16/decoder/overlap expansion is not authorized by this publication.", "",
    ])


def validate_generated(actual: Any, expected: Any) -> None:
    if not exact_json(actual, expected):
        raise EvidenceError("publication/result promotion mutation detected")


def render_publication(index_path: Path) -> tuple[dict[str, Any], bytes, bytes, bytes]:
    index_hash, rows = load_index(index_path)
    value = publication(index_hash, rows)
    return (
        value,
        (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode("utf-8"),
        render_report(value).encode("utf-8"),
        render_handoff(value).encode("utf-8"),
    )


def publish(index_path: Path, evidence_path: Path, report_path: Path, handoff_path: Path) -> dict[str, Any]:
    runner.require_exact_role_path(evidence_path, RESEARCH_ROOT, "evidence/reazonspeech-r2.json", "evidence output")
    runner.require_exact_role_path(report_path, RESEARCH_ROOT, "reazonspeech-r2-report.md", "report output")
    runner.require_exact_role_path(handoff_path, RESEARCH_ROOT, "reazonspeech-r2-handoff.md", "handoff output")
    first = render_publication(index_path)
    second = render_publication(index_path)
    if first[1:] != second[1:]:
        raise EvidenceError("publisher double-run output is not byte-identical")
    value, evidence, report, handoff = first
    atomic_bytes(evidence_path, evidence)
    atomic_bytes(report_path, report)
    atomic_bytes(handoff_path, handoff)
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-index", type=Path, required=True)
    parser.add_argument("--evidence-output", type=Path, required=True)
    parser.add_argument("--report-output", type=Path, required=True)
    parser.add_argument("--handoff-output", type=Path, required=True)
    parser.add_argument("--build-index", action="store_true")
    args = parser.parse_args()
    try:
        if args.build_index:
            build_index(args.raw_index)
        value = publish(args.raw_index, args.evidence_output, args.report_output, args.handoff_output)
        print(json.dumps({"qualityDisposition": value["qualityDisposition"], "relativeSelection": value["relativeSelection"]}, sort_keys=True))
        return 0
    except (OSError, EvidenceError, RuntimeError, ValueError, KeyError, TypeError, json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"R2 publication rejected: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
