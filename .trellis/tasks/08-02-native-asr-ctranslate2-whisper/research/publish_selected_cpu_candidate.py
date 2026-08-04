#!/usr/bin/env python3
"""Publish deterministic sanitized T06 selected CPU short/medium evidence."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import statistics
import sys
from pathlib import Path

from selected_cpu_adapter import (
    EXPECTED_CASES,
    EXPECTED_CONFIG,
    EXPECTED_CORPUS_ID,
    EXPECTED_MANIFEST_SHA256,
    EXPECTED_MODEL_FILES,
    EXPECTED_MODEL_ID,
    EXPECTED_MODEL_REVISION,
    require_locked_tool,
    require_task_local_ignored,
    validate_raw_identity,
)

TIMELINE_ERROR_FIELDS = (
    "afterAudioEndCount",
    "emptyTextCount",
    "negativeStartCount",
    "nonMonotonicCount",
    "nonPositiveDurationCount",
)
ADAPTER_PATH = Path(__file__).with_name("selected_cpu_adapter.py")


def load_benchmark(repo_root: Path):
    path = repo_root / "scripts" / "asr-benchmark.py"
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark_selected_publish", path)
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


def write_lf(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))


def timeline_errors(timeline: dict) -> int:
    return sum(int(timeline.get(field, 0)) for field in TIMELINE_ERROR_FIELDS)


def distribution(benchmark, values: list[int]) -> dict:
    if not values:
        raise ValueError("selected CPU candidate returned no subtitle segments")
    return {
        "count": len(values),
        "minimum": min(values),
        "median": statistics.median(values),
        "p95": benchmark.percentile(values, 0.95),
        "maximum": max(values),
    }


def validate_adapted(
    benchmark,
    raw: dict,
    adapted: dict,
    authoritative_case: dict,
    candidate_sha256: str,
    config_sha256: str,
) -> None:
    case_id = authoritative_case["id"]
    runtime = adapted.get("runtime", {})
    cases = adapted.get("cases", [])
    reference = authoritative_case["reference"]
    manifest = adapted.get("manifest", {})
    if (
        adapted.get("schemaVersion") != benchmark.SCHEMA_VERSION
        or adapted.get("kind") != "hikaru-asr-benchmark-result"
        or adapted.get("candidateKind") != "native-candidate"
        or manifest.get("corpusId") != EXPECTED_CORPUS_ID
        or manifest.get("sha256") != EXPECTED_MANIFEST_SHA256
        or adapted.get("engine") != "faster-whisper"
        or adapted.get("model") != f"{EXPECTED_MODEL_ID}@{EXPECTED_MODEL_REVISION}"
        or adapted.get("device") != "cpu"
        or adapted.get("computeType") != "int8"
        or adapted.get("language") != "ja"
        or adapted.get("useVad") is not False
        or adapted.get("vadConfig") != {}
        or runtime.get("candidateLockSha256") != candidate_sha256
        or runtime.get("algorithmConfigSha256") != config_sha256
        or runtime.get("measurementExecutable") != raw["runtime"]["measurementExecutable"]
        or runtime.get("productionWorker") != raw["runtime"]["productionWorker"]
        or runtime.get("requiredDlls") != raw["runtime"]["requiredDlls"]
        or len(cases) != 1
        or cases[0].get("caseId") != case_id
        or cases[0].get("audioSha256") != authoritative_case["audioSha256"]
        or cases[0].get("assSha256") != authoritative_case["assSha256"]
        or cases[0].get("durationMs") != authoritative_case["durationMs"]
        or cases[0].get("audioSha256") != raw["audio"]["sha256"]
        or cases[0].get("durationMs") != raw["audio"]["durationMs"]
        or cases[0].get("referenceText") != reference["text"]
        or cases[0].get("referenceTextSha256") != reference["textSha256"]
        or cases[0].get("referenceNormalizedTextSha256") != reference["normalizedTextSha256"]
        or cases[0].get("referenceSegments") != reference["segments"]
        or cases[0].get("speechIntervals") != reference["speechIntervals"]
        or cases[0].get("dialogueCount") != reference["dialogueCount"]
        or cases[0].get("status") != "completed"
        or cases[0].get("error") is not None
        or cases[0].get("sampleCount") != len(raw["samples"])
    ):
        raise ValueError(f"selected CPU adapted identity mismatch: {case_id}")

    adapted_samples = cases[0].get("samples", [])
    if len(adapted_samples) != len(raw["samples"]):
        raise ValueError(f"selected CPU adapted sample count mismatch: {case_id}")
    for raw_sample, adapted_sample in zip(raw["samples"], adapted_samples, strict=True):
        segments = [
            {"startMs": item["startMs"], "endMs": item["endMs"], "text": item["text"]}
            for item in raw_sample["segments"]
        ]
        metrics = benchmark._sample_metrics(
            reference["text"],
            reference["segments"],
            reference["speechIntervals"],
            segments,
            authoritative_case["durationMs"],
            "engine-native",
            "faster-whisper",
        )
        expected_timings = dict(raw_sample["timings"])
        expected_timings.setdefault("totalMs", expected_timings["inferenceMs"])
        expected_timings.setdefault("totalRtf", expected_timings["inferenceRtf"])
        if (
            adapted_sample.get("status") != "completed"
            or adapted_sample.get("runKind") != raw_sample["runKind"]
            or adapted_sample.get("repeatIndex") != raw_sample["repeatIndex"]
            or adapted_sample.get("timings") != expected_timings
            or adapted_sample.get("tokenTraceHashes") != [trace["sha256"] for trace in raw_sample["tokenTraces"]]
            or any(
                adapted_sample.get(key) != metrics[key]
                for key in ("cer", "timeline", "missingSpeechRegions", "segments")
            )
        ):
            raise ValueError(f"selected CPU adapted metrics mismatch: {case_id}")

    expected_warm_rtfs = [
        sample["timings"]["inferenceRtf"]
        for sample in raw["samples"]
        if sample["runKind"] == "warm"
    ]
    cold = cases[0].get("coldProcess", {})
    if (
        cold.get("processWallMs") != raw["samples"][0]["timings"].get("totalMs")
        or cold.get("resolvedParameters") != EXPECTED_CONFIG
        or cold.get("resources", {}).get("peakProcessRssBytes")
        != raw["resources"]["peakProcessRssBytes"]
        or cases[0].get("warmInferenceRtfMedian")
        != (statistics.median(expected_warm_rtfs) if expected_warm_rtfs else None)
        or cases[0].get("warmSampleCount") != len(expected_warm_rtfs)
    ):
        raise ValueError(f"selected CPU adapted performance/resource mismatch: {case_id}")


def case_summary(benchmark, raw: dict, adapted: dict, case_id: str) -> dict:
    case = adapted["cases"][0]
    sample = case["samples"][0]
    durations = [segment["endMs"] - segment["startMs"] for segment in sample["segments"]]
    characters = [len(segment["text"]) for segment in sample["segments"]]
    warm_rtf = case["warmInferenceRtfMedian"]
    effective_rtf = warm_rtf if case_id == "short-v1" else sample["timings"]["inferenceRtf"]
    gates = {
        "cerAtMost0_35": sample["cer"]["cer"] <= 0.35,
        "cpuInferenceRtfAtMost1_0": effective_rtf <= 1.0,
        "shortColdWallAtMost120s": None if case_id != "short-v1" else case["coldProcess"]["processWallMs"] <= 120_000,
        "peakRssAtMost6GiB": case["coldProcess"]["resources"]["peakProcessRssBytes"] <= 6 * 1024**3,
        "timelineErrorsZero": timeline_errors(sample["timeline"]) == 0,
        "confirmedSpeechGapsZero": len(sample["missingSpeechRegions"]) == 0,
    }
    return {
        "caseId": case_id,
        "samples": {
            "cold": sum(item["runKind"] == "cold" for item in case["samples"]),
            "warm": sum(item["runKind"] == "warm" for item in case["samples"]),
        },
        "measurements": {
            "cer": sample["cer"]["cer"],
            "inferenceRtf": sample["timings"]["inferenceRtf"],
            "warmInferenceRtfMedian": warm_rtf,
            "coldProcessWallMs": case["coldProcess"]["processWallMs"],
            "peakProcessRssBytes": case["coldProcess"]["resources"]["peakProcessRssBytes"],
            "timelineErrors": timeline_errors(sample["timeline"]),
            "confirmedSpeechGapsAtLeast1500Ms": len(sample["missingSpeechRegions"]),
            "segmentCount": sample["timeline"]["segmentCount"],
        },
        "seekEvidence": {
            "windowCount": len(raw["samples"][0]["tokenTraces"]),
            "decodedTimestampSeekWindows": sum(
                trace["parseStatus"] == "decoded-seek" for trace in raw["samples"][0]["tokenTraces"]
            ),
            "sourceWindowEndSeekWindows": sum(
                trace["parseStatus"] == "source-window-end" for trace in raw["samples"][0]["tokenTraces"]
            ),
            "noSpeechWindows": sum(
                trace["parseStatus"] == "no-speech" for trace in raw["samples"][0]["tokenTraces"]
            ),
        },
        "subtitleDistribution": {
            "durationMs": distribution(benchmark, durations),
            "characters": distribution(benchmark, characters),
        },
        "gates": gates,
        "allApplicableGatesPass": all(value is not False for value in gates.values()),
        "ignoredEvidence": {
            "rawSha256": raw["_rawSha256"],
            "adaptedResultSha256": adapted["_adaptedSha256"],
        },
    }


def render_report(evidence: dict) -> str:
    short, medium = evidence["largeV3"]["measuredCases"]
    passed = evidence["decision"] == "short-medium-pass-long-pending"
    decision = (
        "**short/medium pass; long remains blocked pending review.**"
        if passed
        else "**stop-revise; do not run long or the model matrix.**"
    )
    def result(case: dict) -> str:
        return "pass" if case["allApplicableGatesPass"] else "fail"
    return f"""# T06 Selected CPU Candidate Short/Medium Report

## Decision

{decision}

The selected candidate is timestamp-driven, CPU int8, beam 1, and `conditionOnPreviousText=false`. It was selected by the separate bounded short decode diagnostic; this report uses a new lock and final rebuilt production defaults. Candidate A and the CPU RTF matrix remain separate historical identities.

| Case | Samples | CER | CPU inference RTF | Cold wall | Peak RSS | Timeline errors | Gaps >=1.5s | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| short-v1 | 1 cold + 3 warm | `{short['measurements']['cer']:.4f}` | warm median `{short['measurements']['warmInferenceRtfMedian']:.3f}` | `{short['measurements']['coldProcessWallMs'] / 1000:.3f}s` | `{short['measurements']['peakProcessRssBytes'] / 1_000_000_000:.2f} GB` | {short['measurements']['timelineErrors']} | {short['measurements']['confirmedSpeechGapsAtLeast1500Ms']} | **{result(short)}** |
| medium-v1 | 1 measured | `{medium['measurements']['cer']:.4f}` | `{medium['measurements']['inferenceRtf']:.3f}` | informational | `{medium['measurements']['peakProcessRssBytes'] / 1_000_000_000:.2f} GB` | {medium['measurements']['timelineErrors']} | {medium['measurements']['confirmedSpeechGapsAtLeast1500Ms']} | **{result(medium)}** |

Medium used {medium['seekEvidence']['decodedTimestampSeekWindows']} decoded-timestamp seek windows out of {medium['seekEvidence']['windowCount']}; previous-text history remained disabled in every trace. No VAD, temperature fallback, transcript prompt, suppress-token change, private fork, synthetic timing, or reference repair was added.

## Frozen Identity

- Candidate lock SHA-256: `{evidence['identity']['candidateLockSha256']}`
- Config SHA-256: `{evidence['identity']['configSha256']}`
- Measurement executable SHA-256: `{evidence['identity']['runtime']['measurementExecutable']['sha256']}`
- Production worker SHA-256: `{evidence['identity']['runtime']['productionWorker']['sha256']}`
- CTranslate2 DLL SHA-256: `{evidence['identity']['runtime']['requiredDlls'][0]['sha256']}`
- Tokenizer DLL SHA-256: `{evidence['identity']['runtime']['requiredDlls'][1]['sha256']}`
- model.bin SHA-256: `{evidence['identity']['modelBinSha256']}`

## Scope And Residual Gate

No long-v1 or seven-model run was started. Even when short/medium pass, large-v3 is not qualified until authoritative long-v1 passes, followed by the remaining T06 matrix. Release/default routing remains Python legacy. The corpus still lacks `low-volume` coverage.
"""


def render_disposition(evidence: dict) -> str:
    passed = evidence["decision"] == "short-medium-pass-long-pending"
    large_v3_status = "qualification-pending" if passed else "stop-revise"
    large_v3_reason = (
        "selected CPU candidate passes authoritative short/medium; long-v1 is deliberately not run yet"
        if passed
        else "selected CPU candidate failed at least one authoritative short/medium gate"
    )
    rows = [
        ("large-v3", large_v3_status, large_v3_reason),
        ("large-v2", "blocked-not-run", "large-v3 hard gate is not complete"),
        ("tiny", "blocked-not-run", "large-v3 hard gate is not complete"),
        ("base", "blocked-not-run", "large-v3 hard gate is not complete"),
        ("small", "blocked-not-run", "large-v3 hard gate is not complete"),
        ("medium", "blocked-not-run", "large-v3 hard gate is not complete"),
        ("large-v3-turbo", "blocked-not-run", "large-v3 hard gate is not complete"),
    ]
    body = "\n".join(f"| {model} | `{status}` | {reason} |" for model, status, reason in rows)
    return f"""# T06 Ordinary Faster-Whisper Product-Model Disposition

Candidate A remains a historical provisional `stop-revise` evidence set. The separate selected CPU beam-1/no-history candidate is now `{large_v3_status}`. No route is qualified or enabled; Release/default remains Python legacy.

| Model | Current T06 status | Reason |
|---|---|---|
{body}

All seven model IDs remain visible for downstream T17. No model is hidden, silently routed, or classified unsupported by this checkpoint.
"""


def self_check() -> None:
    assert EXPECTED_CONFIG["beamSize"] == 1
    assert EXPECTED_CONFIG["conditionOnPreviousText"] is False
    print("selected CPU publisher self-check passed")


def main() -> int:
    if sys.argv[1:] == ["--self-check"]:
        self_check()
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--short-raw", type=Path, required=True)
    parser.add_argument("--short-result", type=Path, required=True)
    parser.add_argument("--medium-raw", type=Path, required=True)
    parser.add_argument("--medium-result", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--candidate-lock", type=Path, required=True)
    parser.add_argument("--evidence-output", type=Path, required=True)
    parser.add_argument("--report-output", type=Path, required=True)
    parser.add_argument("--disposition-output", type=Path, required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[4]
    benchmark = load_benchmark(repo_root)
    validation = benchmark.validate_manifest(args.manifest, args.corpus_root)
    if (
        validation.get("manifestSha256") != EXPECTED_MANIFEST_SHA256
        or validation.get("manifest", {}).get("corpusId") != EXPECTED_CORPUS_ID
    ):
        raise ValueError("selected CPU authoritative manifest identity mismatch")
    cases = {case["id"]: case for case in validation["cases"]}
    for case_id, expected in EXPECTED_CASES.items():
        case = cases.get(case_id, {})
        if any(
            case.get(field) != expected[field]
            for field in ("audioSha256", "assSha256", "durationMs")
        ):
            raise ValueError(f"selected CPU authoritative case identity mismatch: {case_id}")
    candidate_sha256 = sha256_file(args.candidate_lock)
    lock_text = args.candidate_lock.read_text(encoding="utf-8")
    require_locked_tool(benchmark, Path(__file__), lock_text, "selected CPU publisher")
    require_locked_tool(benchmark, ADAPTER_PATH, lock_text, "selected CPU adapter")
    loaded = []
    config_hash = None
    for raw_path, result_path, case_id in (
        (args.short_raw, args.short_result, "short-v1"),
        (args.medium_raw, args.medium_result, "medium-v1"),
    ):
        require_task_local_ignored(benchmark, raw_path, f"selected CPU {case_id} raw evidence")
        require_task_local_ignored(benchmark, result_path, f"selected CPU {case_id} adapted result")
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        adapted = json.loads(result_path.read_text(encoding="utf-8"))
        current_config_hash = validate_raw_identity(
            benchmark, raw, lock_text, candidate_sha256, case_id
        )
        if config_hash is None:
            config_hash = current_config_hash
        elif config_hash != current_config_hash:
            raise ValueError("selected CPU short/medium config identity mismatch")
        validate_adapted(benchmark, raw, adapted, cases[case_id], candidate_sha256, current_config_hash)
        raw["_rawSha256"] = sha256_file(raw_path)
        adapted["_adaptedSha256"] = sha256_file(result_path)
        loaded.append((raw, adapted, case_id))

    short_raw, medium_raw = loaded[0][0], loaded[1][0]
    for key in ("config", "runtime", "model"):
        if short_raw[key] != medium_raw[key]:
            raise ValueError(f"selected CPU short/medium identity differs: {key}")
    summaries = [case_summary(benchmark, raw, adapted, case_id) for raw, adapted, case_id in loaded]
    passed = all(summary["allApplicableGatesPass"] for summary in summaries)
    evidence = {
        "schemaVersion": 1,
        "decision": "short-medium-pass-long-pending" if passed else "stop-revise",
        "candidate": "selected-cpu-beam1-no-history",
        "qualificationEligible": False,
        "manifest": {
            "corpusId": "hikaru-user-ja-ground-truth-v1",
            "sha256": "e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277",
            "coverageLimitation": "low-volume is absent",
        },
        "identity": {
            "candidateLockSha256": candidate_sha256,
            "configSha256": config_hash,
            "runtime": short_raw["runtime"],
            "modelRevision": short_raw["model"]["revision"],
            "modelBinSha256": EXPECTED_MODEL_FILES["model.bin"][1],
        },
        "largeV3": {
            "status": "qualification-pending" if passed else "stop-revise",
            "measuredCases": summaries,
            "longV1": "not-run",
        },
        "historicalEvidence": {
            "candidateA": "preserved separately in candidate-a-decision.json and ctranslate2-whisper-report.md",
            "cpuRtfDiagnostic": "preserved separately in cpu-rtf-diagnosis.md",
            "decodeSelection": "preserved separately in decode-selection.json and decode-selection.md",
        },
        "privacy": "sanitized identities, aggregates, distributions, and hashes only; no transcript, token IDs, paths, model bytes, or private media",
    }
    write_lf(
        args.evidence_output,
        json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n",
    )
    write_lf(args.report_output, render_report(evidence))
    write_lf(args.disposition_output, render_disposition(evidence))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
