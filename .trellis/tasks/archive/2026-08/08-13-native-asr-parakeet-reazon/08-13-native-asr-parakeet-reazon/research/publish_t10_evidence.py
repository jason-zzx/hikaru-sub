#!/usr/bin/env python3
"""Validate frozen T10 raw bytes and publish sanitized independent engine results."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import statistics
from typing import Any

TASK_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = TASK_ROOT.parents[2]
LOCAL_ROOT = (TASK_ROOT / "research" / "local").resolve()
CASE_ORDER = ("short-v1", "medium-v1", "long-v2")
ENGINES = ("reazonspeech-nemo", "parakeet")
EXPECTED = {
    "manifestSha256": "3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea",
    "comparatorSha256": "b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822",
    "cudaDevice": {"index": 0, "name": "NVIDIA GeForce RTX 3070", "computeCapability": "8.6", "driverApiVersion": 13020},
    "inputLock": {"sizeBytes": 5091, "sha256": "e342111bdc2cac5e0af6bc013a718f324cdc845577d587484020734db54ad9bd"},
    "runner": {"sizeBytes": 307712, "sha256": "845dc2e5f93f73a851789b0643d2e4e29aa6e29ea0835e037cfad047c58660c6"},
    "worker": {"sizeBytes": 571904, "sha256": "57e8d02c17c5a7a268b6a0c391beecbd0356bbcd03c3f361540606223efdba5d"},
    "library": {"sizeBytes": 11414528, "sha256": "824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e"},
    "engines": {
        "reazonspeech-nemo": {"candidateId": "R1-window15s-top-level-v1", "model": {"sizeBytes": 667147072, "sha256": "20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2"}, "longError": "crispasr_result_invalid"},
        "parakeet": {"candidateId": "P1-window15s-native-word-v1", "model": {"sizeBytes": 673554880, "sha256": "5a61e6c7d956c3c72a76fafcd798cac0c9ea66d0e29b3910cd04865a1e42cc17"}, "longError": "parakeet_family_text_conservation"},
    },
}
TIMELINE_FIELDS = ("afterAudioEndCount", "emptyTextCount", "negativeStartCount", "nonMonotonicCount", "nonPositiveDurationCount")
REQUIRED_MODULES = {
    "crispasr.dll": "runtime-bin",
    "ggml-base.dll": "runtime-bin",
    "ggml-cpu.dll": "runtime-bin",
    "ggml-cuda.dll": "runtime-bin",
    "ggml.dll": "runtime-bin",
    "cublas64_12.dll": "runtime-bin",
    "cublaslt64_12.dll": "runtime-bin",
    "cudart64_12.dll": "runtime-bin",
    "nvcuda.dll": "system32",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def load_benchmark():
    path = REPO_ROOT / "scripts" / "asr-benchmark.py"
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


def expected_paths() -> list[tuple[str, str, str, int, Path]]:
    rows = []
    for engine in ENGINES:
        rows.append((engine, "short-v1", "cold", 0, LOCAL_ROOT / "raw" / engine / "short-v1" / "cold-0.json"))
        for repeat in (1, 2, 3):
            rows.append((engine, "short-v1", "warm", repeat, LOCAL_ROOT / "raw" / engine / "short-v1" / f"warm-{repeat}.json"))
        for case_id in ("medium-v1", "long-v2"):
            rows.append((engine, case_id, "measured", 0, LOCAL_ROOT / "raw" / engine / case_id / "measured-0.json"))
    return rows


def build_index(path: Path) -> dict[str, Any]:
    entries = []
    for engine, case_id, run_kind, repeat, raw in expected_paths():
        if not raw.is_file():
            raise ValueError(f"missing raw row: {engine}/{case_id}/{run_kind}-{repeat}")
        entries.append({
            "engine": engine, "caseId": case_id, "runKind": run_kind, "repeatIndex": repeat,
            "relativeRawIdentifier": raw.relative_to(LOCAL_ROOT).as_posix(),
            "sizeBytes": raw.stat().st_size, "sha256": sha256(raw),
        })
    value = {"schema": "hikaru-t10-raw-index-v1", "frozen": True, "entries": entries}
    atomic(path, (json.dumps(value, sort_keys=True, indent=2) + "\n").encode())
    return value


def verify_frozen_inputs() -> None:
    lock = TASK_ROOT / "research" / "t10-input-lock.md"
    if not lock.is_file() or {"sizeBytes": lock.stat().st_size, "sha256": sha256(lock)} != EXPECTED["inputLock"]:
        raise ValueError("tracked input lock identity drifted")
    manifest = REPO_ROOT / ".asr-benchmark" / "manifest.json"
    comparator = REPO_ROOT / "scripts" / "asr-benchmark.py"
    if sha256(manifest) != EXPECTED["manifestSha256"]:
        raise ValueError("authoritative manifest identity drifted")
    if sha256(comparator) != EXPECTED["comparatorSha256"]:
        raise ValueError("shared comparator identity drifted")


def validate_path_policy(row: dict[str, Any]) -> None:
    policy = row.get("pathPolicy")
    if not isinstance(policy, dict) or policy.get("policy") != "runtime-cuda12.8-system32-v1":
        raise ValueError("restricted PATH policy drifted")
    roots = policy.get("orderedRoots")
    if not isinstance(roots, list) or len(roots) != 3 or not all(isinstance(root, str) and root for root in roots):
        raise ValueError("restricted PATH roots are invalid")
    normalized = [root.replace("\\", "/").lower().rstrip("/") for root in roots]
    if not normalized[0].endswith("/08-13-native-asr-parakeet-reazon/research/local/runtime"):
        raise ValueError("runtime PATH root drifted")
    if not normalized[1].endswith("/nvidia gpu computing toolkit/cuda/v12.8/bin"):
        raise ValueError("CUDA PATH root drifted")
    if not normalized[2].endswith("/windows/system32"):
        raise ValueError("System32 PATH root drifted")


def module_fingerprint(row: dict[str, Any]) -> str:
    checkpoints = row.get("moduleCheckpoints")
    if not isinstance(checkpoints, list) or not checkpoints:
        raise ValueError("module checkpoint trace is missing")
    first_fingerprint = None
    for index, checkpoint in enumerate(checkpoints):
        if not isinstance(checkpoint, dict) or not isinstance(checkpoint.get("stage"), str):
            raise ValueError("module checkpoint is invalid")
        modules = checkpoint.get("modules")
        if not isinstance(modules, list) or not modules:
            raise ValueError("module inventory is missing")
        inventory = []
        seen = set()
        for module in modules:
            if not isinstance(module, dict):
                raise ValueError("module entry is invalid")
            name = module.get("name")
            relative = module.get("relativePath")
            role = module.get("rootRole")
            identity = module.get("identity")
            if (not isinstance(name, str) or not name or not isinstance(relative, str) or not relative
                    or role not in {"runtime-bin", "cuda-bin", "system32"}
                    or not isinstance(identity, dict) or not isinstance(identity.get("sizeBytes"), int)
                    or identity["sizeBytes"] <= 0 or not isinstance(identity.get("sha256"), str)
                    or len(identity["sha256"]) != 64):
                raise ValueError("module identity is invalid")
            relative_path = Path(relative.replace("\\", "/"))
            if relative_path.is_absolute() or ".." in relative_path.parts:
                raise ValueError("module relative path is invalid")
            key = (name.lower(), relative.lower(), role)
            if key in seen:
                raise ValueError("module inventory is duplicated")
            seen.add(key)
            inventory.append((name.lower(), relative.lower(), role, identity["sizeBytes"], identity["sha256"].lower()))
        fingerprint = canonical_hash(sorted(inventory))
        if index == 0:
            if checkpoint["stage"] != "post-session-open":
                raise ValueError("first module checkpoint stage drifted")
            first_fingerprint = fingerprint
            by_name = {item[0]: item[2] for item in inventory}
            for name, role in REQUIRED_MODULES.items():
                if by_name.get(name) != role:
                    raise ValueError(f"required module identity is missing: {name}")
        elif fingerprint != first_fingerprint:
            raise ValueError("loaded module identity drifted during the attempt")
    return first_fingerprint


def load_index(path: Path) -> tuple[str, list[dict[str, Any]]]:
    verify_frozen_inputs()
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema") != "hikaru-t10-raw-index-v1" or value.get("frozen") is not True:
        raise ValueError("raw index is not frozen")
    expected = {(e, c, k, r) for e, c, k, r, _ in expected_paths()}
    actual = {(x["engine"], x["caseId"], x["runKind"], x["repeatIndex"]) for x in value.get("entries", [])}
    if actual != expected or len(actual) != len(value.get("entries", [])):
        raise ValueError("raw matrix is incomplete or duplicated")
    rows = []
    for entry in value["entries"]:
        raw = (LOCAL_ROOT / entry["relativeRawIdentifier"]).resolve()
        try:
            raw.relative_to(LOCAL_ROOT)
        except ValueError as error:
            raise ValueError("raw path escapes local root") from error
        if not raw.is_file() or raw.stat().st_size != entry["sizeBytes"] or sha256(raw) != entry["sha256"]:
            raise ValueError("indexed raw bytes drifted")
        row = json.loads(raw.read_text(encoding="utf-8"))
        if row.get("schema") != "hikaru-t10-parakeet-family-attempt-v1":
            raise ValueError("raw schema drifted")
        for key in ("engine", "caseId", "runKind", "repeatIndex"):
            if row.get(key) != entry[key]:
                raise ValueError(f"raw {key} differs from index")
        engine_expected = EXPECTED["engines"][row["engine"]]
        expected_status = "validated-failed" if row["caseId"] == "long-v2" else "completed"
        if row.get("status") != expected_status:
            raise ValueError("raw result promotion/status drifted")
        if expected_status == "validated-failed" and row.get("errorCode") != engine_expected["longError"]:
            raise ValueError("structured failure identity drifted")
        if row.get("resolvedBackend") != "parakeet" or row.get("device") != "cuda":
            raise ValueError("route/device identity drifted")
        if row.get("candidateId") != engine_expected["candidateId"] or row.get("model") != engine_expected["model"]:
            raise ValueError("candidate/model identity drifted")
        for key in ("inputLock", "runner", "worker", "library"):
            if row.get(key) != EXPECTED[key]:
                raise ValueError(f"{key} identity drifted")
        if (row.get("windowDurationMs"), row.get("overlapMs"), row.get("maxCueCodePoints"), row.get("maxCueDurationMs")) != (15000, 0, 96, 15000):
            raise ValueError("candidate configuration drifted")
        if row.get("cudaDevice") != EXPECTED["cudaDevice"]:
            raise ValueError("CUDA device identity drifted")
        if row.get("stderr", {}).get("privacyPass") is not True:
            raise ValueError("stderr privacy validation failed")
        validate_path_policy(row)
        module_fingerprint(row)
        if not isinstance(row.get("sourceSegments"), list):
            raise ValueError("raw trace is incomplete")
        rows.append(row)
    return sha256(path), rows


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def identity_key(row: dict[str, Any]) -> dict[str, Any]:
    identity = {key: row[key] for key in ("inputLock", "runner", "worker", "library", "model", "candidateId", "device", "cudaDevice", "windowDurationMs", "overlapMs", "maxCueCodePoints", "maxCueDurationMs")}
    identity["pathPolicySha256"] = canonical_hash(row["pathPolicy"])
    identity["loadedModulesSha256"] = module_fingerprint(row)
    return identity


def cue_summary(segments: list[dict[str, Any]]) -> dict[str, Any]:
    points = [len(item["text"]) for item in segments]
    durations = [int(item["endMs"]) - int(item["startMs"]) for item in segments]
    def percentile(values: list[int], q: float) -> float | None:
        if not values:
            return None
        ordered = sorted(values); pos = (len(ordered) - 1) * q; lower = int(pos); upper = min(lower + 1, len(ordered) - 1)
        return ordered[lower] + (ordered[upper] - ordered[lower]) * (pos - lower)
    return {"count": len(segments), "codePoints": {"p50": percentile(points, .5), "p95": percentile(points, .95), "max": max(points, default=None)}, "durationMs": {"p50": percentile(durations, .5), "p95": percentile(durations, .95), "max": max(durations, default=None)}}


def replacement_size(segments: list[dict[str, Any]]) -> int:
    event = {
        "event": "segmentsReplace",
        "protocolVersion": 1,
        "segments": [
            {"endMs": segment["endMs"], "startMs": segment["startMs"], "text": segment["text"]}
            for segment in segments
        ],
    }
    return len(json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def validate_trace(row: dict[str, Any], case: dict[str, Any]) -> None:
    duration_ms = case["durationMs"]
    for field in ("modelOpenMs", "inferenceMs", "inferenceRtf", "runnerWallMs", "peakProcessRssBytes"):
        value = row.get(field)
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
            raise ValueError(f"attempt measurement is invalid: {field}")
    expected_start = 0
    for window in row["sourceSegments"]:
        if not isinstance(window, dict) or expected_start >= duration_ms:
            raise ValueError("window trace is invalid")
        expected_end = min(expected_start + 15000, duration_ms)
        if (window.get("windowStartMs"), window.get("windowEndMs")) != (expected_start, expected_end):
            raise ValueError("window trace is not contiguous")
        if not isinstance(window.get("segments"), list) or len(window["segments"]) != 1:
            raise ValueError("source segment trace is invalid")
        expected_start = expected_end

    final_segments = row.get("finalSegments")
    if not isinstance(final_segments, list):
        raise ValueError("final segment trace is invalid")
    if row["status"] == "completed":
        if expected_start != duration_ms or not final_segments or row.get("errorCode") is not None:
            raise ValueError("completed trace is incomplete")
        replacement_bytes = row.get("replacementBytes")
        if (not isinstance(replacement_bytes, int) or replacement_bytes <= 0
                or replacement_bytes != replacement_size(final_segments) or replacement_bytes >= 8388608):
            raise ValueError("completed replacement size is invalid")
        if len(final_segments) > 32768:
            raise ValueError("completed replacement segment count is invalid")
        previous_start = -1
        for segment in final_segments:
            text = segment.get("text")
            start_ms = segment.get("startMs")
            end_ms = segment.get("endMs")
            if (not isinstance(text, str) or not text or len(text) > 96 or len(text.encode("utf-8")) > 16384
                    or not isinstance(start_ms, int) or not isinstance(end_ms, int)
                    or start_ms < previous_start or start_ms < 0 or end_ms <= start_ms
                    or end_ms > duration_ms or end_ms - start_ms > 15000):
                raise ValueError("completed final segment is invalid")
            previous_start = start_ms
    else:
        if not isinstance(row.get("errorCode"), str) or not row["errorCode"] or final_segments:
            raise ValueError("validated-failed trace is incomplete")
        failed_start = row.get("failedWindowStartMs")
        failed_end = row.get("failedWindowEndMs")
        if failed_start is None and failed_end is None:
            if expected_start != duration_ms:
                raise ValueError("policy failure trace is incomplete")
        else:
            if (failed_start, failed_end) != (expected_start, min(expected_start + 15000, duration_ms)) \
                    or failed_start >= duration_ms or failed_end <= failed_start:
                raise ValueError("failed window trace is incomplete")
            if not isinstance(row.get("errorMessage"), str) or not row["errorMessage"]:
                raise ValueError("structured backend failure detail is missing")


def score_case(benchmark, case: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    for row in rows:
        validate_trace(row, case)
    completed = [row for row in rows if row["status"] == "completed"]
    failed = [row for row in rows if row["status"] == "validated-failed"]
    if failed:
        if len(rows) != 1 or completed:
            raise ValueError("validated-failed case must have exactly one measured row")
        row = failed[0]
        attempted_through_ms = row.get("failedWindowEndMs") or case["durationMs"]
        summary = {"caseId": case["id"], "status": "validated-failed", "errorCode": row.get("errorCode"), "failedWindowStartMs": row.get("failedWindowStartMs"), "failedWindowEndMs": row.get("failedWindowEndMs"), "attemptedWindowCount": len(row["sourceSegments"]), "attemptedInferenceMs": row["inferenceMs"], "attemptedThroughMs": attempted_through_ms, "attemptedInferenceRtf": row["inferenceMs"] / attempted_through_ms, "peakProcessRssBytes": row["peakProcessRssBytes"], "allApplicableGatesPass": False}
        if row.get("failedWindowStartMs") is None:
            summary["fullCaseInferenceRtf"] = row["inferenceRtf"]
        return summary
    expected_count = 4 if case["id"] == "short-v1" else 1
    if len(completed) != expected_count:
        raise ValueError("completed sample count drifted")
    metrics = []
    for row in completed:
        segments = row["finalSegments"]
        selected = "".join(segment["text"] for window in row["sourceSegments"] for segment in window["segments"])
        final = "".join(segment["text"] for segment in segments)
        if selected != final:
            raise ValueError("publisher text conservation failed")
        metrics.append(benchmark._sample_metrics(case["reference"]["text"], case["reference"]["segments"], case["reference"]["speechIntervals"], segments, case["durationMs"], "engine-native", rows[0]["engine"]))
    warm = [row["inferenceRtf"] for row in completed if row["runKind"] == "warm"]
    rtf = statistics.median(warm) if warm else completed[0]["inferenceRtf"]
    cer = max(item["cer"]["cer"] for item in metrics)
    timeline = max(sum(int(item["timeline"].get(key, 0)) for key in TIMELINE_FIELDS) for item in metrics)
    gaps = max(len(item["missingSpeechRegions"]) for item in metrics)
    excluded = max(len(item["excludedNonSemanticVocalizationRegions"]) for item in metrics)
    cold_wall = next((row["runnerWallMs"] for row in completed if row["runKind"] == "cold"), None)
    rss = max(row["peakProcessRssBytes"] for row in completed)
    replacement = max(replacement_size(row["finalSegments"]) for row in completed)
    cues = cue_summary(completed[0]["finalSegments"])
    gates = {"cerAtMost0_35": cer <= .35, "acceleratedInferenceRtfAtMost0_5": rtf <= .5, "shortColdWallAtMost120s": None if cold_wall is None else cold_wall <= 120000, "peakRssAtMost12GiB": rss <= 12 * 1024**3, "timelineErrorsZero": timeline == 0, "semanticSpeechGapsZero": gaps == 0, "cueCodePointsAtMost96": cues["codePoints"]["max"] <= 96, "cueDurationAtMost15000Ms": cues["durationMs"]["max"] <= 15000, "replacementBelowProtocolLineLimit": replacement < 8388608}
    return {"caseId": case["id"], "status": "completed", "sampleCounts": {"cold": sum(row["runKind"] == "cold" for row in completed), "warm": len(warm), "measured": sum(row["runKind"] == "measured" for row in completed)}, "measurements": {"maximumSampleCer": cer, "acceleratedInferenceRtf": rtf, "coldProcessWallMs": cold_wall, "peakProcessRssBytes": rss, "maximumTimelineErrors": timeline, "maximumSemanticSpeechGapsAtLeast1500Ms": gaps, "maximumExcludedVocalizationGapsAtLeast1500Ms": excluded, "replacementBytes": replacement}, "cues": cues, "gates": gates, "allApplicableGatesPass": all(value is not False for value in gates.values())}


def publish(index_path: Path, evidence_path: Path, report_path: Path) -> dict[str, Any]:
    index_hash, rows = load_index(index_path)
    benchmark = load_benchmark()
    validation = benchmark.validate_manifest(REPO_ROOT / ".asr-benchmark" / "manifest.json", REPO_ROOT / ".asr-benchmark")
    cases = {case["id"]: case for case in validation["cases"]}
    results = {}
    for engine in ENGINES:
        engine_rows = [row for row in rows if row["engine"] == engine]
        identities = {json.dumps(identity_key(row), sort_keys=True) for row in engine_rows}
        if len(identities) != 1:
            raise ValueError(f"{engine} identity drifted across matrix")
        for row in engine_rows:
            case = cases[row["caseId"]]
            audio_path = REPO_ROOT / ".asr-benchmark" / case["audio"]
            if row.get("audio") != {"sizeBytes": audio_path.stat().st_size, "sha256": case["audioSha256"]}:
                raise ValueError("case/audio identity drifted")
        summaries = [score_case(benchmark, cases[case_id], [row for row in engine_rows if row["caseId"] == case_id]) for case_id in CASE_ORDER]
        disposition = "accepted-t10-engine-algorithm-input" if all(row["allApplicableGatesPass"] for row in summaries) else "stop-revise"
        results[engine] = {"disposition": disposition, "identity": identity_key(engine_rows[0]), "cases": summaries}
    publication = {"schema": "hikaru-t10-parakeet-reazon-publication-v1", "rawIndexSha256": index_hash, "manifestSha256": validation["manifestSha256"], "comparatorSha256": sha256(REPO_ROOT / "scripts" / "asr-benchmark.py"), "results": results, "releaseRouteEnabled": False, "limitations": ["Development CUDA quality evidence only; not a formal runtime pack/device qualification.", "Validated-failed cases retain native failure provenance and are not assigned synthetic CER/timeline metrics; partial attempts are not reported as full-case RTF.", "Release/default remains Python legacy."]}
    data = (json.dumps(publication, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode()
    lines = ["# T10 Parakeet / ReazonSpeech Report", "", f"Raw index SHA-256: `{index_hash}`", ""]
    for engine in ENGINES:
        result = results[engine]
        lines += [f"## {engine}", "", f"Disposition: `{result['disposition']}`", "", "| Case | Status | CER | CUDA RTF | Timeline | Semantic gaps | Result |", "|---|---|---:|---:|---:|---:|---|"]
        for case in result["cases"]:
            m = case.get("measurements", {})
            lines.append(f"| `{case['caseId']}` | `{case['status']}` | {m.get('maximumSampleCer', '—')} | {m.get('acceleratedInferenceRtf', case.get('fullCaseInferenceRtf', '—'))} | {m.get('maximumTimelineErrors', '—')} | {m.get('maximumSemanticSpeechGapsAtLeast1500Ms', '—')} | **{'pass' if case['allApplicableGatesPass'] else 'fail'}** |")
        lines += [""]
    lines += ["## Boundary", "", "No Release/default route, model downloader, settings, frontend, installer, or runtime-pack change.", ""]
    atomic(evidence_path, data); atomic(report_path, ("\n".join(lines)).encode())
    return publication


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-index", type=Path, required=True); parser.add_argument("--evidence-output", type=Path, required=True); parser.add_argument("--report-output", type=Path, required=True); parser.add_argument("--build-index", action="store_true")
    args = parser.parse_args()
    try:
        if args.build_index: build_index(args.raw_index)
        result = publish(args.raw_index, args.evidence_output, args.report_output)
        print(json.dumps({engine: value["disposition"] for engine, value in result["results"].items()}, sort_keys=True))
        return 0
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"T10 publication rejected: {error}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
