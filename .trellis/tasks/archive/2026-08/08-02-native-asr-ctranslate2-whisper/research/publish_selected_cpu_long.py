#!/usr/bin/env python3
"""Publish deterministic sanitized T06 selected CPU large-v3 long-v1 evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import selected_cpu_adapter as adapter
from publish_selected_cpu_candidate import (
    case_summary,
    load_benchmark,
    validate_adapted,
    write_lf,
)
from selected_cpu_long_adapter import LONG_CASE

EXPECTED_LOCK_SHA256 = "0be239a83640c65f740f169da6c37a1141d3e92140d829243787671f9f410083"
EXPECTED_CONFIG_SHA256 = "77120c8543e780231d8c65b3868c07f44d685a22a136da56c64e6a6922d4f9e6"
EXPECTED_ADAPTER_SHA256 = "4c650fc4f6e07ab5c2fa0315c722966499001622868a861d223be368246835da"
EXPECTED_SHORT_MEDIUM_PUBLISHER_SHA256 = "0b041931680b1de1aaf8a540ef5f4c07f6e3b9fc401f7d692e36d6854cffc300"
EXPECTED_SHORT_MEDIUM_EVIDENCE_SHA256 = "05beeec3410e7cef720bf73b1afebe0e371bfe81ec359f265575a3090809c3b4"
SCRIPT_DIR = Path(__file__).resolve().parent
ADAPTER_PATH = SCRIPT_DIR / "selected_cpu_adapter.py"
LONG_ADAPTER_PATH = SCRIPT_DIR / "selected_cpu_long_adapter.py"
SHORT_MEDIUM_PUBLISHER_PATH = SCRIPT_DIR / "publish_selected_cpu_candidate.py"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_file(path: Path, size: int, sha256: str, label: str) -> None:
    if not path.is_file() or path.stat().st_size != size or sha256_file(path) != sha256:
        raise ValueError(f"{label} identity mismatch")


def validate_current_inputs(args: argparse.Namespace) -> None:
    require_file(args.candidate_lock, 11_428, EXPECTED_LOCK_SHA256, "selected candidate lock")
    require_file(args.runner, 562_688, adapter.EXPECTED_RUNTIME_FILES["measurementExecutable"][1], "measurement executable")
    require_file(args.worker, 459_776, adapter.EXPECTED_RUNTIME_FILES["productionWorker"][1], "production worker")
    for name, (size, sha256) in adapter.EXPECTED_RUNTIME_DLLS.items():
        require_file(args.runtime_dir / name, size, sha256, name)
    for name, (size, sha256) in adapter.EXPECTED_MODEL_FILES.items():
        require_file(args.model / name, size, sha256, f"model {name}")
    require_file(ADAPTER_PATH, 23_330, EXPECTED_ADAPTER_SHA256, "frozen selected adapter")
    require_file(
        SHORT_MEDIUM_PUBLISHER_PATH,
        19_808,
        EXPECTED_SHORT_MEDIUM_PUBLISHER_SHA256,
        "frozen short/medium publisher",
    )


def validate_short_medium(path: Path) -> dict:
    if sha256_file(path) != EXPECTED_SHORT_MEDIUM_EVIDENCE_SHA256:
        raise ValueError("accepted selected short/medium evidence identity mismatch")
    evidence = json.loads(path.read_text(encoding="utf-8"))
    cases = evidence.get("largeV3", {}).get("measuredCases", [])
    if (
        evidence.get("decision") != "short-medium-pass-long-pending"
        or evidence.get("candidate") != "selected-cpu-beam1-no-history"
        or evidence.get("qualificationEligible") is not False
        or evidence.get("identity", {}).get("candidateLockSha256") != EXPECTED_LOCK_SHA256
        or evidence.get("identity", {}).get("configSha256") != EXPECTED_CONFIG_SHA256
        or evidence.get("identity", {}).get("modelRevision") != adapter.EXPECTED_MODEL_REVISION
        or evidence.get("identity", {}).get("modelBinSha256") != adapter.EXPECTED_MODEL_FILES["model.bin"][1]
        or [case.get("caseId") for case in cases] != ["short-v1", "medium-v1"]
        or not all(case.get("allApplicableGatesPass") is True for case in cases)
    ):
        raise ValueError("accepted selected short/medium evidence content mismatch")
    return evidence


def provenance(raw: dict) -> dict:
    sample = raw["samples"][0]
    traces = sample["tokenTraces"]
    segments = sample["segments"]
    return {
        "traceCount": len(traces),
        "decodedTimestampSeekWindows": sum(trace["parseStatus"] == "decoded-seek" for trace in traces),
        "sourceWindowEndSeekWindows": sum(trace["parseStatus"] == "source-window-end" for trace in traces),
        "noSpeechWindows": sum(trace["parseStatus"] == "no-speech" for trace in traces),
        "finalSeekFrames": traces[-1]["seekFramesAfter"],
        "expectedSourceFrames": LONG_CASE["sourceFrames"],
        "modelWindowDurationMs": 30_000,
        "historyDisabledEveryWindow": all(
            trace["historyTokenCountBefore"] == 0 and trace["historyTokenCountAfter"] == 0
            for trace in traces
        ),
        "fallbackCallCount": sum(trace["fallbackCallCount"] for trace in traces),
        "generationCallCount": sum(trace["generationCallCount"] for trace in traces),
        "wavEndBoundedSegmentCount": sum(segment["endBoundedToAudio"] for segment in segments),
        "segmentTraceProvenanceComplete": True,
        "sourceAndModelWindowProvenanceComplete": True,
    }


def render_report(evidence: dict) -> str:
    case = evidence["largeV3LongV1"]
    measurements = case["measurements"]
    duration = case["subtitleDistribution"]["durationMs"]
    characters = case["subtitleDistribution"]["characters"]
    decision = (
        "**pass — large-v3 has passed its authoritative short/medium/long CPU hard gate.**"
        if evidence["decision"] == "large-v3-hard-gate-pass-large-v2-next"
        else "**fail — stop; do not run large-v2 or any other model.**"
    )
    result = "pass" if case["allApplicableGatesPass"] else "fail"
    return f"""# T06 Selected CPU Candidate Large-v3 Long-v1 Report

## Decision

{decision}

The run used the accepted selected lock: timestamp-driven seek, no previous-text history, beam 1, CPU int8, and no VAD, fallback, transcript prompt, repair, or Python/private-fork behavior.

| Case | Samples | CER | CPU inference RTF | Peak RSS | Timeline errors | Gaps >=1.5s | Segments | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| long-v1 | 1 measured | `{measurements['cer']:.4f}` | `{measurements['inferenceRtf']:.3f}` | `{measurements['peakProcessRssBytes'] / 1_000_000_000:.2f} GB` | {measurements['timelineErrors']} | {measurements['confirmedSpeechGapsAtLeast1500Ms']} | {measurements['segmentCount']} | **{result}** |

## Subtitle And Timestamp Provenance

- Segment duration median/P95/max: `{duration['median']:.0f}` / `{duration['p95']:.0f}` / `{duration['maximum']}` ms.
- Segment characters median/P95/max: `{characters['median']:.0f}` / `{characters['p95']:.1f}` / `{characters['maximum']}`.
- {case['seekEvidence']['decodedTimestampSeekWindows']} of {case['seekEvidence']['windowCount']} windows advanced from decoded timestamp evidence; {case['seekEvidence']['sourceWindowEndSeekWindows']} advanced at source-window end.
- The trace chain reached source frame {case['provenance']['finalSeekFrames']} of {case['provenance']['expectedSourceFrames']}; history stayed disabled, fallback calls were zero, and {case['provenance']['wavEndBoundedSegmentCount']} token-derived final end was explicitly bounded to verified WAV end.
- Every accepted segment retained source/model-window, token-trace, timestamp-token, raw-end/final-end, and WAV-end-bound provenance in ignored raw evidence. Tracked evidence contains aggregates and hashes only.

## Frozen Identity

- Selected lock SHA-256: `{evidence['identity']['candidateLockSha256']}`
- Config SHA-256: `{evidence['identity']['configSha256']}`
- Measurement executable SHA-256: `{evidence['identity']['runtime']['measurementExecutable']['sha256']}`
- Production worker SHA-256: `{evidence['identity']['runtime']['productionWorker']['sha256']}`
- model.bin SHA-256: `{evidence['identity']['modelBinSha256']}`
- Long raw SHA-256: `{evidence['identity']['longRawSha256']}`
- Long adapted result SHA-256: `{evidence['identity']['longAdaptedResultSha256']}`
- Long publisher SHA-256: `{evidence['identity']['publisher']['sha256']}`

## Next Gate

{"Large-v2 short/medium/long is the next mandatory CPU gate, but it was not started here." if evidence['decision'] == 'large-v3-hard-gate-pass-large-v2-next' else "Stop the product-model matrix. Any Candidate B work must first return to planning and pin the minimal native ONNX executor, license/archive identity, size, and packaging impact."} No other model ran, the seven-model matrix did not start, and Release/default routing remains Python legacy. The corpus still lacks `low-volume` coverage.
"""


def render_disposition(passed: bool) -> str:
    large_v3_status = "hard-gate-passed" if passed else "stop-revise"
    large_v3_reason = (
        "selected CPU candidate passes authoritative short, medium, and long-v1; full T06 route qualification remains pending"
        if passed
        else "selected CPU candidate failed at least one authoritative long-v1 gate"
    )
    rows = [
        ("large-v3", large_v3_status, large_v3_reason),
        ("large-v2", "blocked-not-run", "next mandatory CPU gate; not started in this run" if passed else "large-v3 hard gate failed"),
        ("tiny", "blocked-not-run", "large-v2 and the mandatory matrix have not run" if passed else "large-v3 hard gate failed"),
        ("base", "blocked-not-run", "large-v2 and the mandatory matrix have not run" if passed else "large-v3 hard gate failed"),
        ("small", "blocked-not-run", "large-v2 and the mandatory matrix have not run" if passed else "large-v3 hard gate failed"),
        ("medium", "blocked-not-run", "large-v2 and the mandatory matrix have not run" if passed else "large-v3 hard gate failed"),
        ("large-v3-turbo", "blocked-not-run", "large-v2 and the mandatory matrix have not run" if passed else "large-v3 hard gate failed"),
    ]
    body = "\n".join(f"| {model} | `{status}` | {reason} |" for model, status, reason in rows)
    return f"""# T06 Ordinary Faster-Whisper Product-Model Disposition

Candidate A remains a historical provisional `stop-revise` evidence set. The separate selected CPU beam-1/no-history candidate has large-v3 status `{large_v3_status}`. No route is enabled; Release/default remains Python legacy.

| Model | Current T06 status | Reason |
|---|---|---|
{body}

All seven model IDs remain visible for downstream T17. No model is hidden, silently routed, or classified unsupported by this checkpoint.
"""


def self_check() -> None:
    adapter.EXPECTED_CASES["long-v1"] = LONG_CASE
    assert LONG_CASE["durationMs"] == 4_144_235
    assert LONG_CASE["sourceFrames"] == 414_424
    assert adapter.EXPECTED_CONFIG["beamSize"] == 1
    assert adapter.EXPECTED_CONFIG["conditionOnPreviousText"] is False
    assert adapter.EXPECTED_CONFIG["timestampDrivenSeek"] is True
    assert sha256_file(ADAPTER_PATH) == EXPECTED_ADAPTER_SHA256
    print("selected CPU long publisher self-check passed")


def main() -> int:
    if sys.argv[1:] == ["--self-check"]:
        self_check()
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--long-raw", type=Path, required=True)
    parser.add_argument("--long-result", type=Path, required=True)
    parser.add_argument("--short-medium-evidence", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--candidate-lock", type=Path, required=True)
    parser.add_argument("--runner", type=Path, required=True)
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--runtime-dir", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--evidence-output", type=Path, required=True)
    parser.add_argument("--report-output", type=Path, required=True)
    parser.add_argument("--disposition-output", type=Path, required=True)
    args = parser.parse_args()

    validate_current_inputs(args)
    short_medium = validate_short_medium(args.short_medium_evidence)
    repo_root = Path(__file__).resolve().parents[4]
    benchmark = load_benchmark(repo_root)
    adapter.require_task_local_ignored(benchmark, args.long_raw, "selected CPU long raw evidence")
    adapter.require_task_local_ignored(benchmark, args.long_result, "selected CPU long adapted result")
    validation = benchmark.validate_manifest(args.manifest, args.corpus_root)
    cases = {case["id"]: case for case in validation["cases"]}
    authoritative_case = cases.get("long-v1", {})
    if (
        validation.get("manifestSha256") != adapter.EXPECTED_MANIFEST_SHA256
        or validation.get("manifest", {}).get("corpusId") != adapter.EXPECTED_CORPUS_ID
        or any(authoritative_case.get(field) != LONG_CASE[field] for field in ("audioSha256", "assSha256", "durationMs"))
    ):
        raise ValueError("selected CPU authoritative long-v1 identity mismatch")

    adapter.EXPECTED_CASES["long-v1"] = LONG_CASE
    raw = json.loads(args.long_raw.read_text(encoding="utf-8"))
    adapted = json.loads(args.long_result.read_text(encoding="utf-8"))
    config_sha256 = adapter.validate_raw_identity(
        benchmark,
        raw,
        args.candidate_lock.read_text(encoding="utf-8"),
        EXPECTED_LOCK_SHA256,
        "long-v1",
    )
    if config_sha256 != EXPECTED_CONFIG_SHA256:
        raise ValueError("selected CPU long config identity mismatch")
    validate_adapted(
        benchmark,
        raw,
        adapted,
        authoritative_case,
        EXPECTED_LOCK_SHA256,
        EXPECTED_CONFIG_SHA256,
    )
    raw["_rawSha256"] = sha256_file(args.long_raw)
    adapted["_adaptedSha256"] = sha256_file(args.long_result)
    summary = case_summary(benchmark, raw, adapted, "long-v1")
    summary["provenance"] = provenance(raw)
    subtitle_usable = (
        summary["measurements"]["segmentCount"] > 1
        and summary["subtitleDistribution"]["durationMs"]["maximum"] <= 30_000
    )
    summary["gates"]["subtitleScaleUsable"] = subtitle_usable
    summary["allApplicableGatesPass"] = summary["allApplicableGatesPass"] and subtitle_usable
    passed = summary["allApplicableGatesPass"]
    publisher_identity = {"sizeBytes": Path(__file__).stat().st_size, "sha256": sha256_file(Path(__file__))}
    long_adapter_identity = {"sizeBytes": LONG_ADAPTER_PATH.stat().st_size, "sha256": sha256_file(LONG_ADAPTER_PATH)}
    evidence = {
        "schemaVersion": 1,
        "decision": "large-v3-hard-gate-pass-large-v2-next" if passed else "stop-revise",
        "candidate": "selected-cpu-beam1-no-history",
        "qualificationEligible": False,
        "manifest": {
            "corpusId": adapter.EXPECTED_CORPUS_ID,
            "sha256": adapter.EXPECTED_MANIFEST_SHA256,
            "caseId": "long-v1",
            "audioSha256": LONG_CASE["audioSha256"],
            "assSha256": LONG_CASE["assSha256"],
            "durationMs": LONG_CASE["durationMs"],
            "coverageLimitation": "low-volume is absent",
        },
        "identity": {
            "candidateLockSha256": EXPECTED_LOCK_SHA256,
            "configSha256": EXPECTED_CONFIG_SHA256,
            "publisher": publisher_identity,
            "longAdapter": long_adapter_identity,
            "frozenSelectedAdapterSha256": EXPECTED_ADAPTER_SHA256,
            "frozenShortMediumPublisherSha256": EXPECTED_SHORT_MEDIUM_PUBLISHER_SHA256,
            "acceptedShortMediumEvidenceSha256": EXPECTED_SHORT_MEDIUM_EVIDENCE_SHA256,
            "longRawSha256": sha256_file(args.long_raw),
            "longAdaptedResultSha256": sha256_file(args.long_result),
            "runtime": raw["runtime"],
            "modelId": raw["model"]["id"],
            "modelRevision": raw["model"]["revision"],
            "modelFiles": raw["model"]["files"],
            "modelBinSha256": adapter.EXPECTED_MODEL_FILES["model.bin"][1],
        },
        "largeV3ShortMedium": {
            "status": "pass",
            "evidenceSha256": EXPECTED_SHORT_MEDIUM_EVIDENCE_SHA256,
            "caseIds": [case["caseId"] for case in short_medium["largeV3"]["measuredCases"]],
        },
        "largeV3LongV1": summary,
        "largeV3Status": "hard-gate-passed" if passed else "stop-revise",
        "nextGate": "large-v2-short-medium-long-not-started" if passed else "stop-no-other-model",
        "privacy": "sanitized identities, aggregates, distributions, and hashes only; no transcript, token IDs, segments, paths, model bytes, or private media",
    }
    write_lf(
        args.evidence_output,
        json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n",
    )
    write_lf(args.report_output, render_report(evidence))
    write_lf(args.disposition_output, render_disposition(passed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
