#!/usr/bin/env python3
"""Recompute T08 K1 gates and publish deterministic sanitized evidence."""

from __future__ import annotations

import argparse
import json
import os
import statistics
from pathlib import Path, PurePosixPath
from typing import Any

import kotoba_benchmark_adapter as adapter

TIMELINE_ERROR_FIELDS = (
    "afterAudioEndCount",
    "emptyTextCount",
    "negativeStartCount",
    "nonMonotonicCount",
    "nonPositiveDurationCount",
)
RAW_CASE_ORDER = ("short-v1", "medium-v1", "long-v1")
CASE_ORDER = ("short-v1", "medium-v1", "long-v2")


def _timeline_errors(timeline: dict[str, Any]) -> int:
    return sum(int(timeline.get(field, 0)) for field in TIMELINE_ERROR_FIELDS)


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def _write_json(path: Path, value: dict[str, Any]) -> None:
    _write(path, (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode())


def _case_summary(benchmark, raw_path: Path, identity: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    reference = case["reference"]
    scored = []
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
        scored.append({"runKind": sample["runKind"], "timings": sample["timings"], "metrics": metrics})
    case_id = case["id"]
    warm_rtfs = [item["timings"]["inferenceRtf"] for item in scored if item["runKind"] == "warm"]
    inference_rtf = statistics.median(warm_rtfs) if case_id == "short-v1" else scored[0]["timings"]["inferenceRtf"]
    cer = max(item["metrics"]["cer"]["cer"] for item in scored)
    timeline_errors = max(_timeline_errors(item["metrics"]["timeline"]) for item in scored)
    gaps = max(len(item["metrics"]["missingSpeechRegions"]) for item in scored)
    excluded_gaps = max(
        len(item["metrics"]["excludedNonSemanticVocalizationRegions"]) for item in scored
    )
    cold_wall = scored[0]["timings"]["processWallMs"]
    peak_rss = identity["resources"]["peakProcessRssBytes"]
    gates = {
        "cerAtMost0_35": cer <= 0.35,
        "acceleratedInferenceRtfAtMost0_5": inference_rtf <= 0.5,
        "shortColdWallAtMost120s": None if case_id != "short-v1" else cold_wall <= 120_000,
        "peakRssAtMost6GiB": peak_rss <= 6 * 1024**3,
        "timelineErrorsZero": timeline_errors == 0,
        "semanticSpeechGapsZero": gaps == 0,
    }
    return {
        "caseId": case_id,
        "sampleCounts": {
            "cold": sum(item["runKind"] == "cold" for item in scored),
            "warm": sum(item["runKind"] == "warm" for item in scored),
        },
        "measurements": {
            "maximumSampleCer": cer,
            "acceleratedInferenceRtf": inference_rtf,
            "coldProcessWallMs": cold_wall,
            "peakProcessRssBytes": peak_rss,
            "maximumTimelineErrors": timeline_errors,
            "maximumSemanticSpeechGapsAtLeast1500Ms": gaps,
            "maximumExcludedNonSemanticVocalizationGapsAtLeast1500Ms": excluded_gaps,
            "minimumSegmentCount": min(item["metrics"]["timeline"]["segmentCount"] for item in scored),
        },
        "windowEvidence": {
            "maximumSourceWindowDurationMs": max(
                trace["sourceWindowDurationMs"]
                for sample in identity["samples"]
                for trace in sample["tokenTraces"]
            ),
            "modelWindowDurationMs": 30_000,
            "decodedTimestampSeekWindows": sum(
                trace["parseStatus"] == "decoded-seek"
                for trace in identity["samples"][0]["tokenTraces"]
            ),
            "windowCount": len(identity["samples"][0]["tokenTraces"]),
        },
        "gates": gates,
        "allApplicableGatesPass": all(value is not False for value in gates.values()),
        "ignoredRawSha256": adapter.sha256_file(raw_path),
    }


def _candidate_state(summaries: list[dict[str, Any]]) -> tuple[str, str | None]:
    if not summaries:
        raise adapter.EvidenceError("T08 publication requires at least short-v1 evidence")
    if len(summaries) > len(CASE_ORDER):
        raise adapter.EvidenceError("T08 publication contains too many cases")
    if len(summaries) == len(CASE_ORDER):
        if any(not row["allApplicableGatesPass"] for row in summaries):
            return "stop-revise", None
        return "accepted-kotoba-algorithm-input", None
    failed = any(not row["allApplicableGatesPass"] for row in summaries)
    outcome = "fail" if failed else "pass"
    return f"{summaries[-1]['caseId']}-{outcome}-next-gate", CASE_ORDER[len(summaries)]


def render_report(evidence: dict[str, Any]) -> str:
    lines = [
        "# T08 Kotoba K1 Candidate Report",
        "",
        f"**Disposition: `{evidence['disposition']}`.**",
        "",
        "K1 uses 15-second maximum source windows, a padded 30-second model range, beam 5, no previous-text history, timestamp-driven seek, no VAD, and CUDA device 0/FLOAT16.",
        "",
        "| Case | Samples | CER | GPU RTF | Cold wall | Peak RSS | Timeline errors | Semantic gaps >=1.5s | Excluded vocalization gaps | Result |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in evidence["cases"]:
        measurements = row["measurements"]
        samples = row["sampleCounts"]
        sample_text = f"{samples['cold']} cold + {samples['warm']} warm" if samples["warm"] else "1 measured"
        lines.append(
            f"| `{row['caseId']}` | {sample_text} | `{measurements['maximumSampleCer']:.4f}` | "
            f"`{measurements['acceleratedInferenceRtf']:.3f}` | "
            f"`{measurements['coldProcessWallMs'] / 1000:.3f}s` | "
            f"`{measurements['peakProcessRssBytes'] / 1_000_000_000:.2f} GB` | "
            f"{measurements['maximumTimelineErrors']} | "
            f"{measurements['maximumSemanticSpeechGapsAtLeast1500Ms']} | "
            f"{measurements['maximumExcludedNonSemanticVocalizationGapsAtLeast1500Ms']} | "
            f"**{'pass' if row['allApplicableGatesPass'] else 'fail'}** |"
        )
    lines += [
        "",
        "## Cache Compatibility",
        "",
        "The exact pinned Hugging Face snapshot revision was opened in place. No model file was copied, relocated, rewritten, or deleted.",
        "",
        "## Scope",
        "",
        "Release/default routing remains Python legacy. This result is not a publishable GPU pack, device matrix, downloader input, installer change, or production route enablement.",
    ]
    return "\n".join(lines) + "\n"


def publish(
    raw_paths: list[Path],
    manifest: Path,
    corpus_root: Path,
    input_lock: Path,
    correction_lock: Path,
    evidence_output: Path,
    report_output: Path,
) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[4]
    benchmark = adapter.load_benchmark(repo_root)
    validation = benchmark.validate_manifest(manifest, corpus_root)
    if validation["manifestSha256"] != adapter.EXPECTED_MANIFEST_SHA256 or validation["manifest"]["corpusId"] != adapter.EXPECTED_CORPUS_ID:
        raise adapter.EvidenceError("T08 authoritative manifest identity drifted")
    correction_lock_text = correction_lock.read_text(encoding="utf-8")
    required_correction_hashes = (
        adapter.sha256_file(Path(__file__).resolve()),
        adapter.sha256_file(Path(adapter.__file__).resolve()),
        adapter.sha256_file(repo_root / "scripts" / "asr-benchmark.py"),
        adapter.sha256_file(manifest),
        adapter.sha256_file(input_lock),
    )
    if any(identity not in correction_lock_text for identity in required_correction_hashes):
        raise adapter.EvidenceError("T08 corrected publication identity is not frozen by the correction lock")

    cases_by_id = {case["id"]: case for case in validation["cases"]}
    loaded = []
    for raw_path in raw_paths:
        adapter.require_task_local(benchmark, raw_path, "T08 raw evidence")
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        source_case_id = raw.get("caseId")
        current_case_id = adapter.RAW_TO_CURRENT_CASE.get(source_case_id)
        if source_case_id not in adapter.EXPECTED_CASES or current_case_id not in cases_by_id:
            raise adapter.EvidenceError("T08 raw case identity is invalid")
        expected = adapter.CURRENT_CASES[current_case_id]
        case = cases_by_id[current_case_id]
        if any(case.get(key) != expected[key] for key in ("audioSha256", "assSha256", "durationMs")):
            raise adapter.EvidenceError("T08 authoritative case identity drifted")
        audio_path = validation["corpusRoot"] / Path(*PurePosixPath(case["audio"]).parts)
        if benchmark.sha256_file(audio_path) != expected["audioSha256"]:
            raise adapter.EvidenceError("T08 authoritative audio hash drifted")
        identity = adapter.validate_raw_identity(benchmark, raw, input_lock, source_case_id)
        loaded.append((raw_path, identity, case))

    actual_order = [identity["caseId"] for _, identity, _ in loaded]
    if actual_order != list(RAW_CASE_ORDER[: len(actual_order)]) or len(set(actual_order)) != len(actual_order):
        raise adapter.EvidenceError("T08 cases must be the short/medium/long prefix in gate order")
    shared = None
    for _, identity, _ in loaded:
        current = {
            "model": identity["model"],
            "config": identity["config"],
            "inputLockSha256": identity["inputLockSha256"],
            "runtime": identity["runtime"],
        }
        if shared is None:
            shared = current
        elif current != shared:
            raise adapter.EvidenceError("T08 worker/model/config/device identity drifted across cases")

    summaries = [_case_summary(benchmark, raw_path, identity, case) for raw_path, identity, case in loaded]
    disposition, next_case = _candidate_state(summaries)
    evidence = {
        "schemaVersion": 1,
        "kind": "hikaru-ct2-kotoba-k1-candidate-result",
        "disposition": disposition,
        "nextCase": next_case,
        "qualificationComplete": disposition == "accepted-kotoba-algorithm-input",
        "releaseRouteEnabled": False,
        "publisherSha256": adapter.sha256_file(Path(__file__).resolve()),
        "adapterSha256": adapter.sha256_file(Path(adapter.__file__).resolve()),
        "manifest": {
            "corpusId": adapter.EXPECTED_CORPUS_ID,
            "sha256": adapter.EXPECTED_MANIFEST_SHA256,
        },
        "identity": shared,
        "correctionLockSha256": adapter.sha256_file(correction_lock),
        "cases": summaries,
        "limitations": [
            "Windows x64 reviewed CUDA development lane only.",
            "No VRAM gate is defined.",
            "Production model management, runtime packs, routing, UI, installer, and release qualification remain downstream work.",
        ],
        "privacy": "sanitized hashes, identities, aggregates, dispositions, and limitations only; no transcript, token IDs, absolute paths, model bytes, or private media",
    }
    _write_json(evidence_output, evidence)
    _write(report_output, render_report(evidence).encode())
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, action="append", required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--input-lock", type=Path, required=True)
    parser.add_argument("--correction-lock", type=Path, required=True)
    parser.add_argument("--evidence-output", type=Path, required=True)
    parser.add_argument("--report-output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = publish(
            args.raw,
            args.manifest,
            args.corpus_root,
            args.input_lock,
            args.correction_lock,
            args.evidence_output,
            args.report_output,
        )
    except adapter.EvidenceError as error:
        print(json.dumps({"status": "no-result", "error": str(error)}, sort_keys=True))
        return 2
    print(json.dumps({"status": "published", "disposition": result["disposition"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
