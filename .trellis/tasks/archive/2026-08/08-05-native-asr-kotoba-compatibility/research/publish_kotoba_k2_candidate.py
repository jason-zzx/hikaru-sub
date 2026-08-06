#!/usr/bin/env python3
"""Publish the complete, sanitized Kotoba K2 matrix."""

from __future__ import annotations

import argparse
import json
import os
import statistics
from pathlib import Path
from typing import Any

import kotoba_k2_benchmark_adapter as adapter

CASE_ORDER = ("short-v1", "medium-v1", "long-v2")
TIMELINE_ERROR_FIELDS = ("afterAudioEndCount", "emptyTextCount", "negativeStartCount", "nonMonotonicCount", "nonPositiveDurationCount")


def _timeline_errors(value: dict[str, Any]) -> int:
    return sum(int(value.get(key, 0)) for key in TIMELINE_ERROR_FIELDS)


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def _write_json(path: Path, value: dict[str, Any]) -> None:
    _write(path, (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode())


def _require_correction_lock(correction_lock: Path, input_lock: Path, manifest: Path) -> str:
    if not correction_lock.is_file():
        raise adapter.EvidenceError("K2 correction lock is missing")
    text = correction_lock.read_text(encoding="utf-8")
    repo_root = Path(__file__).resolve().parents[4]
    required = (
        adapter.sha256_file(Path(__file__).resolve()),
        adapter.sha256_file(Path(adapter.__file__).resolve()),
        adapter.sha256_file(repo_root / "scripts" / "asr-benchmark.py"),
        adapter.sha256_file(manifest),
        adapter.sha256_file(input_lock),
    )
    if any(digest not in text for digest in required):
        raise adapter.EvidenceError("K2 correction lock does not bind publisher/adapter/comparator/inputs")
    return adapter.sha256_file(correction_lock)


def _metric_summary(benchmark, identity: dict[str, Any], case: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, int | str]]]:
    scored = []
    for sample in identity["samples"]:
        segments = [{"startMs": item["startMs"], "endMs": item["endMs"], "text": item["text"]} for item in sample["segments"]]
        metrics = benchmark._sample_metrics(case["reference"]["text"], case["reference"]["segments"], case["reference"]["speechIntervals"], segments, case["durationMs"], "engine-native", "kotoba-faster-whisper")
        scored.append((sample, metrics))
    warm = [sample["timings"]["inferenceRtf"] for sample, _ in scored if sample["runKind"] == "warm"]
    rtf = statistics.median(warm) if case["id"] == "short-v1" else scored[0][0]["timings"]["inferenceRtf"]
    cer = max(metrics["cer"]["cer"] for _, metrics in scored)
    timeline = max(_timeline_errors(metrics["timeline"]) for _, metrics in scored)
    semantic = max(len(metrics["missingSpeechRegions"]) for _, metrics in scored)
    excluded = max(len(metrics["excludedNonSemanticVocalizationRegions"]) for _, metrics in scored)
    rss = identity["resources"]["peakProcessRssBytes"]
    cold_wall = scored[0][0]["timings"].get("processWallMs")
    gates = {
        "cerAtMost0_35": cer <= 0.35,
        "acceleratedInferenceRtfAtMost0_5": rtf <= 0.5,
        "shortColdWallAtMost120s": None if case["id"] != "short-v1" else cold_wall <= 120_000,
        "peakRssAtMost6GiB": rss <= 6 * 1024**3,
        "timelineErrorsZero": timeline == 0,
        "semanticSpeechGapsZero": semantic == 0,
    }
    ownership = {key: sum(sample["ownership"][key] for sample in identity["samples"]) for key in ("windowCount", "parsedSegmentCount", "nonOwnerDiscardedCount", "exactDuplicateDiscardedCount", "emittedSegmentCount")}
    summary = {
        "caseId": case["id"],
        "sampleCounts": {"cold": sum(sample["runKind"] == "cold" for sample, _ in scored), "warm": sum(sample["runKind"] == "warm" for sample, _ in scored)},
        "measurements": {"maximumSampleCer": cer, "acceleratedInferenceRtf": rtf, "coldProcessWallMs": cold_wall, "peakProcessRssBytes": rss, "maximumTimelineErrors": timeline, "maximumSemanticSpeechGapsAtLeast1500Ms": semantic, "maximumExcludedNonSemanticVocalizationGapsAtLeast1500Ms": excluded},
        "ownership": ownership,
        "gates": gates,
        "allApplicableGatesPass": all(value is not False for value in gates.values()),
    }
    return summary, [(str(index),) for index in range(len(scored))]


def _gap_status(metrics: dict[str, Any]) -> list[dict[str, int | str]]:
    missing = metrics.get("missingSpeechRegions", [])
    result = []
    for index, (start, end) in enumerate(adapter.K1_LONG_V2_GAP_COORDINATES, 1):
        covered = not any(max(start, int(region["startMs"])) < min(end, int(region["endMs"])) for region in missing)
        result.append({"index": index, "startMs": start, "endMs": end, "status": "covered" if covered else "still-missing"})
    return result


def _candidate_state(summaries: list[dict[str, Any]]) -> tuple[str, str | None]:
    if not summaries:
        raise adapter.EvidenceError("K2 publication requires evidence")
    if len(summaries) > len(CASE_ORDER):
        raise adapter.EvidenceError("K2 publication contains too many cases")
    if len(summaries) != len(CASE_ORDER):
        return f"{summaries[-1]['caseId']}-diagnostic-next-gate", CASE_ORDER[len(summaries)]
    return ("accepted-kotoba-algorithm-input", None) if all(row["allApplicableGatesPass"] for row in summaries) else ("stop-revise", None)


def render_report(evidence: dict[str, Any]) -> str:
    lines = ["# T08 Kotoba K2 Candidate Report", "", f"**Disposition: `{evidence['disposition']}`.**", "", "K2 uses bounded 15-second source windows, a 10-second maximum applied stride, and latest-start half-open ownership. The complete matrix is required for acceptance.", "", "| Case | Samples | CER | GPU RTF | Cold wall | Peak RSS | Timeline errors | Semantic gaps | Excluded vocalization gaps | Result |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
    for row in evidence["cases"]:
        m, counts = row["measurements"], row["sampleCounts"]
        sample_text = f"{counts['cold']} cold + {counts['warm']} warm" if counts["warm"] else "1 measured"
        lines.append(f"| `{row['caseId']}` | {sample_text} | `{m['maximumSampleCer']:.4f}` | `{m['acceleratedInferenceRtf']:.3f}` | `{m['coldProcessWallMs'] / 1000:.3f}s` | `{m['peakProcessRssBytes'] / 1_000_000_000:.2f} GB` | {m['maximumTimelineErrors']} | {m['maximumSemanticSpeechGapsAtLeast1500Ms']} | {m['maximumExcludedNonSemanticVocalizationGapsAtLeast1500Ms']} | **{'pass' if row['allApplicableGatesPass'] else 'fail'}** |")
    lines += [
        "",
        "## Gap Reassessment",
        "",
        f"Coordinate-set hash: `{evidence['k1LongV2GapCoordinateSetSha256']}`.",
        "",
        "| K1 gap | Start ms | End ms | K2 status |",
        "|---:|---:|---:|---|",
    ]
    for gap in evidence["k1LongV2GapDiagnostics"]:
        lines.append(
            f"| {gap['index']} | {gap['startMs']} | {gap['endMs']} | `{gap['status']}` |"
        )
    lines += [
        "",
        "These diagnostics do not alter the unchanged zero-semantic-gap gate.",
        "",
        "## Scope",
        "",
        "This is sanitized development evidence on the reviewed CUDA lane. Release/default routing remains Python legacy; no runtime pack or production route is enabled.",
    ]
    return "\n".join(lines) + "\n"


def publish(raw_paths: list[Path], manifest: Path, corpus_root: Path, input_lock: Path, correction_lock: Path, evidence_output: Path, report_output: Path) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[4]
    correction_lock_sha256 = _require_correction_lock(correction_lock, input_lock, manifest)
    benchmark = adapter.load_benchmark(repo_root)
    validation = benchmark.validate_manifest(manifest, corpus_root)
    if validation["manifestSha256"] != adapter.EXPECTED_MANIFEST_SHA256 or validation["manifest"]["corpusId"] != adapter.EXPECTED_CORPUS_ID:
        raise adapter.EvidenceError("K2 authoritative manifest identity drifted")
    if len(raw_paths) != len(CASE_ORDER):
        raise adapter.EvidenceError("K2 publication requires the complete short/medium/long-v2 matrix")
    cases = {case["id"]: case for case in validation["cases"]}
    loaded = []
    for expected_case_id, raw_path in zip(CASE_ORDER, raw_paths):
        adapter.require_task_local(benchmark, raw_path, "K2 raw evidence")
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        if raw.get("caseId") != expected_case_id or expected_case_id not in cases:
            raise adapter.EvidenceError("K2 cases must be supplied in short/medium/long-v2 order")
        expected = adapter.EXPECTED_CASES[expected_case_id]; case = cases[expected_case_id]
        if any(case.get(key) != expected[key] for key in ("audioSha256", "assSha256", "durationMs")):
            raise adapter.EvidenceError("K2 authoritative case identity drifted")
        audio_path = validation["corpusRoot"] / Path(*Path(case["audio"]).parts)
        if benchmark.sha256_file(audio_path) != expected["audioSha256"]:
            raise adapter.EvidenceError("K2 authoritative audio hash drifted")
        identity = adapter.validate_raw_identity(benchmark, raw, input_lock, expected_case_id)
        loaded.append((raw_path, identity, case))
    shared = None
    for _, identity, _ in loaded:
        current = {"model": identity["model"], "config": identity["config"], "inputLockSha256": identity["inputLockSha256"], "runtime": identity["runtime"]}
        if shared is None: shared = current
        elif current != shared: raise adapter.EvidenceError("K2 worker/model/config/runtime identity drifted across cases")
    summaries = []
    gap_diagnostics = []
    for raw_path, identity, case in loaded:
        summary, _ = _metric_summary(benchmark, identity, case)
        summary["ignoredRawSha256"] = adapter.sha256_file(raw_path)
        summaries.append(summary)
        if case["id"] == "long-v2":
            all_metrics = []
            for sample in identity["samples"]:
                segments = [{"startMs": item["startMs"], "endMs": item["endMs"], "text": item["text"]} for item in sample["segments"]]
                all_metrics.append(benchmark._sample_metrics(case["reference"]["text"], case["reference"]["segments"], case["reference"]["speechIntervals"], segments, case["durationMs"], "engine-native", "kotoba-faster-whisper"))
            merged_missing = { (int(region["startMs"]), int(region["endMs"])) for metric in all_metrics for region in metric["missingSpeechRegions"] }
            gap_diagnostics = []
            for index, (start, end) in enumerate(adapter.K1_LONG_V2_GAP_COORDINATES, 1):
                gap_diagnostics.append({"index": index, "startMs": start, "endMs": end, "status": "still-missing" if any(max(start, missing_start) < min(end, missing_end) for missing_start, missing_end in merged_missing) else "covered"})
    disposition, next_case = _candidate_state(summaries)
    evidence = {"schemaVersion": 1, "kind": "hikaru-ct2-kotoba-k2-candidate-result", "candidateId": adapter.CANDIDATE_ID, "ownershipRule": adapter.OWNERSHIP_RULE, "maxAppliedSeekFrames": 1000, "maxAppliedSeekDurationMs": 10000, "overlapFloorFrames": 500, "disposition": disposition, "nextCase": next_case, "qualificationComplete": len(summaries) == 3 and disposition == "accepted-kotoba-algorithm-input", "releaseRouteEnabled": False, "publisherSha256": adapter.sha256_file(Path(__file__).resolve()), "adapterSha256": adapter.sha256_file(Path(adapter.__file__).resolve()), "manifest": {"corpusId": adapter.EXPECTED_CORPUS_ID, "sha256": adapter.EXPECTED_MANIFEST_SHA256}, "identity": shared, "correctionLockSha256": correction_lock_sha256, "k1LongV2GapCoordinateSetSha256": adapter.coordinate_set_hash(), "k1LongV2GapDiagnostics": gap_diagnostics, "cases": summaries, "limitations": ["Windows x64 reviewed CUDA development lane only.", "No VRAM gate is defined.", "Production model management, runtime packs, routing, UI, installer, and release qualification remain downstream work."], "privacy": "sanitized hashes, identities, aggregates, dispositions, and limitations only; no transcript, token IDs, absolute paths, model bytes, or private media"}
    _write_json(evidence_output, evidence); _write(report_output, render_report(evidence).encode()); return evidence


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--raw", type=Path, action="append", required=True); parser.add_argument("--manifest", type=Path, required=True); parser.add_argument("--corpus-root", type=Path, required=True); parser.add_argument("--input-lock", type=Path, required=True); parser.add_argument("--correction-lock", type=Path, required=True); parser.add_argument("--evidence-output", type=Path, required=True); parser.add_argument("--report-output", type=Path, required=True)
    args = parser.parse_args()
    try: result = publish(args.raw, args.manifest, args.corpus_root, args.input_lock, args.correction_lock, args.evidence_output, args.report_output)
    except adapter.EvidenceError as error: print(json.dumps({"status": "no-result", "error": str(error)}, sort_keys=True)); return 2
    print(json.dumps({"status": "published", "disposition": result["disposition"]}, sort_keys=True)); return 0


if __name__ == "__main__":
    raise SystemExit(main())
