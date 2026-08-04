#!/usr/bin/env python3
"""Publish deterministic sanitized T06 Candidate A decision evidence."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import statistics
import sys
from pathlib import Path

from benchmark_adapter import (
    EXPECTED_MODEL_FILES,
    EXPECTED_MODEL_ID,
    EXPECTED_MODEL_REVISION,
    validate_raw_identity,
)


def load_benchmark(repo_root: Path):
    path = repo_root / "scripts" / "asr-benchmark.py"
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark_publish", path)
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
    path.write_bytes(text.encode("utf-8"))


def canonical_sha256(value: dict) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def timeline_errors(timeline: dict) -> int:
    return sum(
        int(timeline[key])
        for key in (
            "afterAudioEndCount",
            "emptyTextCount",
            "negativeStartCount",
            "nonMonotonicCount",
            "nonPositiveDurationCount",
        )
    )


def distribution(benchmark, values: list[int]) -> dict:
    return {
        "count": len(values),
        "minimum": min(values),
        "median": statistics.median(values),
        "p95": benchmark.percentile(values, 0.95),
        "maximum": max(values),
    }


def validate_adapted_identity(
    benchmark,
    raw: dict,
    adapted: dict,
    authoritative_case: dict,
    algorithm_sha256: str,
    config_sha256: str,
) -> None:
    case_id = authoritative_case["id"]
    if (
        adapted.get("kind") != "hikaru-asr-benchmark-result"
        or adapted.get("candidateKind") != "native-candidate"
        or adapted.get("engine") != "faster-whisper"
        or adapted.get("model") != f"{EXPECTED_MODEL_ID}@{EXPECTED_MODEL_REVISION}"
        or adapted.get("device") != "cpu"
        or adapted.get("computeType") != "int8"
        or adapted.get("useVad") is not False
    ):
        raise RuntimeError(f"adapted Candidate A route identity mismatch: {case_id}")
    runtime = adapted.get("runtime", {})
    if (
        runtime.get("algorithmLockSha256") != algorithm_sha256
        or runtime.get("algorithmConfigSha256") != config_sha256
        or runtime.get("measurementExecutable") != raw["runtime"]["measurementExecutable"]
        or runtime.get("productionWorker") != raw["runtime"]["productionWorker"]
        or runtime.get("requiredDlls") != raw["runtime"]["requiredDlls"]
    ):
        raise RuntimeError(f"adapted Candidate A runtime identity mismatch: {case_id}")
    if adapted.get("manifest", {}).get("sha256") != "e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277":
        raise RuntimeError(f"adapted Candidate A manifest identity mismatch: {case_id}")
    cases = adapted.get("cases", [])
    reference = authoritative_case["reference"]
    if (
        len(cases) != 1
        or cases[0].get("caseId") != case_id
        or cases[0].get("audioSha256") != authoritative_case["audioSha256"]
        or cases[0].get("assSha256") != authoritative_case["assSha256"]
        or cases[0].get("durationMs") != authoritative_case["durationMs"]
        or cases[0].get("audioSha256") != raw["audio"]["sha256"]
        or cases[0].get("durationMs") != raw["audio"]["durationMs"]
        or cases[0].get("referenceText") != reference["text"]
        or cases[0].get("referenceSegments") != reference["segments"]
        or cases[0].get("speechIntervals") != reference["speechIntervals"]
    ):
        raise RuntimeError(f"adapted Candidate A case/reference identity mismatch: {case_id}")
    adapted_samples = cases[0].get("samples", [])
    if len(adapted_samples) != len(raw["samples"]):
        raise RuntimeError(f"adapted Candidate A sample count mismatch: {case_id}")
    for raw_sample, adapted_sample in zip(raw["samples"], adapted_samples, strict=True):
        expected_hashes = [trace["sha256"] for trace in raw_sample["tokenTraces"]]
        expected_timings = dict(raw_sample["timings"])
        expected_timings.setdefault("totalMs", expected_timings["inferenceMs"])
        expected_timings.setdefault("totalRtf", expected_timings["inferenceRtf"])
        segments = [
            {"startMs": item["startMs"], "endMs": item["endMs"], "text": item["text"]}
            for item in raw_sample["segments"]
        ]
        expected_metrics = benchmark._sample_metrics(
            reference["text"],
            reference["segments"],
            reference["speechIntervals"],
            segments,
            authoritative_case["durationMs"],
            "engine-native",
            "faster-whisper",
        )
        if (
            adapted_sample.get("tokenTraceHashes") != expected_hashes
            or adapted_sample.get("timings") != expected_timings
            or adapted_sample.get("runKind") != raw_sample["runKind"]
            or adapted_sample.get("repeatIndex") != raw_sample["repeatIndex"]
            or any(adapted_sample.get(key) != expected_metrics[key] for key in ("cer", "timeline", "missingSpeechRegions", "segments"))
        ):
            raise RuntimeError(f"adapted Candidate A metrics/trace identity mismatch: {case_id}")
    expected_warm_rtfs = [
        sample["timings"]["inferenceRtf"]
        for sample in raw["samples"]
        if sample["runKind"] == "warm"
    ]
    cold = cases[0].get("coldProcess", {})
    if (
        cold.get("processWallMs") != raw["samples"][0]["timings"].get("totalMs")
        or cold.get("resources", {}).get("peakProcessRssBytes") != raw["resources"]["peakProcessRssBytes"]
        or cases[0].get("warmInferenceRtfMedian")
        != (statistics.median(expected_warm_rtfs) if expected_warm_rtfs else None)
    ):
        raise RuntimeError(f"adapted Candidate A performance/resource identity mismatch: {case_id}")
    representative = raw["samples"][0]["segments"]
    if any(sample["segments"] != representative for sample in raw["samples"][1:]):
        raise RuntimeError(f"Candidate A repeated output drifted within {case_id}")


def validate_timeout_identity(timeout: dict, final_raw: dict, lock_text: str) -> None:
    if (
        timeout.get("schemaVersion") != 1
        or timeout.get("kind") != "hikaru-ct2-whisper-candidate-a-controlled-timeout"
        or timeout.get("candidate") != "A"
        or timeout.get("engine") != "faster-whisper"
        or timeout.get("caseId") != "long-v1"
        or timeout.get("status") != "failed"
        or timeout.get("scoreEligible") is not False
        or timeout.get("segments") != []
        or timeout.get("tokenTraces") != []
    ):
        raise RuntimeError("long timeout record is not the controlled failed Candidate A shape")
    model = timeout.get("model", {})
    model_files = {item.get("name"): item for item in model.get("files", [])}
    if (
        model.get("id") != EXPECTED_MODEL_ID
        or model.get("revision") != EXPECTED_MODEL_REVISION
        or set(model_files) != set(EXPECTED_MODEL_FILES)
        or any(
            model_files[name].get("sizeBytes") != size
            or model_files[name].get("sha256") != sha256
            or sha256 not in lock_text
            for name, (size, sha256) in EXPECTED_MODEL_FILES.items()
        )
    ):
        raise RuntimeError("long timeout model identity mismatch")
    if (
        timeout.get("audio", {}).get("sha256")
        != "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e"
        or timeout.get("audio", {}).get("durationMs") != 4_144_235
    ):
        raise RuntimeError("long timeout authoritative audio identity mismatch")
    failure = timeout.get("failure", {})
    if (
        failure.get("kind") != "external-timeout-termination"
        or failure.get("timeoutMs") != 7_200_000
        or failure.get("scoreEligible") is not False
        or timeout.get("failureTraceSha256") != canonical_sha256(failure)
    ):
        raise RuntimeError("long timeout failure trace identity mismatch")
    expected_lower_bound = failure["timeoutMs"] / timeout["audio"]["durationMs"]
    if abs(timeout.get("timings", {}).get("wallRtfLowerBound", 0) - expected_lower_bound) > 1e-12:
        raise RuntimeError("long timeout wall-RTF lower bound mismatch")
    attempt = timeout.get("attemptIdentity", {})
    if (
        attempt.get("algorithmLockSha256") == final_raw["algorithmLockSha256"]
        or attempt.get("measurementExecutable") == final_raw["runtime"]["measurementExecutable"]
        or attempt.get("productionWorker") == final_raw["runtime"]["productionWorker"]
    ):
        raise RuntimeError("long timeout attempt must remain distinct from final completed rows")


def case_summary(benchmark, raw: dict, adapted: dict, case_id: str) -> dict:
    case = adapted["cases"][0]
    sample = case["samples"][0]
    durations = [segment["endMs"] - segment["startMs"] for segment in sample["segments"]]
    characters = [len(segment["text"]) for segment in sample["segments"]]
    traces = raw["samples"][0]["tokenTraces"]
    return {
        "caseId": case_id,
        "samples": {
            "cold": sum(item["runKind"] == "cold" for item in case["samples"]),
            "warm": sum(item["runKind"] == "warm" for item in case["samples"]),
        },
        "measurements": {
            "cer": sample["cer"]["cer"],
            "inferenceRtf": sample["timings"]["inferenceRtf"],
            "warmInferenceRtfMedian": case["warmInferenceRtfMedian"],
            "coldProcessWallMs": case["coldProcess"]["processWallMs"],
            "peakProcessRssBytes": case["coldProcess"]["resources"]["peakProcessRssBytes"],
            "timelineErrors": timeline_errors(sample["timeline"]),
            "confirmedSpeechGapsAtLeast1500Ms": len(sample["missingSpeechRegions"]),
            "segmentCount": sample["timeline"]["segmentCount"],
        },
        "seekEvidence": {
            "windowCount": len(traces),
            "decodedTimestampSeekWindows": sum(item["parseStatus"] == "decoded-seek" for item in traces),
            "sourceWindowEndSeekWindows": sum(item["parseStatus"] == "source-window-end" for item in traces),
            "noSpeechWindows": sum(item["parseStatus"] == "no-speech" for item in traces),
            "modelWindowDurationMs": 30000,
        },
        "subtitleDistribution": {
            "durationMs": distribution(benchmark, durations),
            "characters": distribution(benchmark, characters),
        },
        "gates": {
            "cerAtMost0_35": sample["cer"]["cer"] <= 0.35,
            "cpuInferenceRtfAtMost1_0": (
                case["warmInferenceRtfMedian"] if case_id == "short-v1" else sample["timings"]["inferenceRtf"]
            ) <= 1.0,
            "shortColdWallAtMost120s": None if case_id != "short-v1" else case["coldProcess"]["processWallMs"] <= 120000,
            "peakRssAtMost6GiB": case["coldProcess"]["resources"]["peakProcessRssBytes"] <= 6 * 1024**3,
            "timelineErrorsZero": timeline_errors(sample["timeline"]) == 0,
            "confirmedSpeechGapsZero": len(sample["missingSpeechRegions"]) == 0,
        },
        "ignoredEvidence": {
            "rawSha256": raw["_rawSha256"],
            "adaptedResultSha256": adapted["_adaptedSha256"],
        },
    }


def markdown_report(evidence: dict) -> str:
    short, medium = evidence["largeV3"]["measuredCases"]
    timeout = evidence["largeV3"]["longAttempt"]
    runtime = evidence["identity"]["runtime"]
    return f"""# T06 CTranslate2 Whisper Candidate A Report

## Decision

**`stop-revise` — do not promote the ordinary faster-whisper native route.**

The frozen timestamp-driven Candidate A is executable and protocol-compatible, but it fails mandatory large-v3 gates:

- short-v1 CER is `{short['measurements']['cer']:.4f}` (`> 0.35`);
- medium-v1 CPU inference RTF is `{medium['measurements']['inferenceRtf']:.3f}` (`> 1.0`);
- long-v1 exceeded the controlled `{timeout['timeoutMs'] / 1000:.0f}s` harness limit, a wall-RTF lower bound of `{timeout['wallRtfLowerBound']:.3f}`, and was terminated before an atomic scoreable result was published.

Short and medium have zero observed confirmed speech gaps and zero timeline errors. Those passing dimensions do not override the per-case CER/performance failures. Candidate B was not activated: VAD/chunking cannot reasonably repair the already-failing short CER or CPU RTF, and adding an ONNX runtime would increase package/runtime cost without a viable promotion path.

## Frozen Identity

| Input | SHA-256 |
|---|---|
| algorithm-lock.md | `{evidence['identity']['algorithmLockSha256']}` |
| measurement executable | `{runtime['measurementExecutable']['sha256']}` |
| production worker | `{runtime['productionWorker']['sha256']}` |
| CTranslate2 DLL | `{runtime['requiredDlls'][0]['sha256']}` |
| tokenizer DLL | `{runtime['requiredDlls'][1]['sha256']}` |
| large-v3 model.bin | `{evidence['identity']['modelBinSha256']}` |

The completed short/medium rows use this single identity. The long timeout is retained as a separate, explicitly unscored process-termination record from a pre-final build; it is not merged into the completed evidence set or used to score quality. The final build adds path/identity validation without changing the frozen Candidate A decode policy.

## Large-v3 Measurements

| Case | Samples | CER | CPU inference RTF | Cold wall | Peak RSS | Timeline errors | Gaps >=1.5s | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| short-v1 | 1 cold + 3 warm | `{short['measurements']['cer']:.4f}` | warm median `{short['measurements']['warmInferenceRtfMedian']:.3f}` | `{short['measurements']['coldProcessWallMs'] / 1000:.3f}s` | `{short['measurements']['peakProcessRssBytes'] / 1_000_000_000:.2f} GB` | {short['measurements']['timelineErrors']} | {short['measurements']['confirmedSpeechGapsAtLeast1500Ms']} | **fail: CER** |
| medium-v1 | 1 cold | `{medium['measurements']['cer']:.4f}` | `{medium['measurements']['inferenceRtf']:.3f}` | informational | `{medium['measurements']['peakProcessRssBytes'] / 1_000_000_000:.2f} GB` | {medium['measurements']['timelineErrors']} | {medium['measurements']['confirmedSpeechGapsAtLeast1500Ms']} | **fail: CPU RTF** |
| long-v1 | 1 terminated attempt | unscored | wall lower bound `{timeout['wallRtfLowerBound']:.3f}` | `> {timeout['timeoutMs'] / 1000:.0f}s` | unavailable | unavailable | unavailable | **failed/incomplete: timeout** |

Medium contains {medium['seekEvidence']['decodedTimestampSeekWindows']} decoded-timestamp seek windows out of {medium['seekEvidence']['windowCount']}; seek is no longer an unconditional fixed 30-second step. The short file is one final partial source window, so it correctly advances at the verified source end.

## Subtitle Segmentation

| Case | Segments | Duration median / P95 / max | Characters median / P95 / max |
|---|---:|---:|---:|
| short-v1 | {short['subtitleDistribution']['durationMs']['count']} | {short['subtitleDistribution']['durationMs']['median']:.0f} / {short['subtitleDistribution']['durationMs']['p95']:.0f} / {short['subtitleDistribution']['durationMs']['maximum']} ms | {short['subtitleDistribution']['characters']['median']:.1f} / {short['subtitleDistribution']['characters']['p95']:.1f} / {short['subtitleDistribution']['characters']['maximum']} |
| medium-v1 | {medium['subtitleDistribution']['durationMs']['count']} | {medium['subtitleDistribution']['durationMs']['median']:.0f} / {medium['subtitleDistribution']['durationMs']['p95']:.0f} / {medium['subtitleDistribution']['durationMs']['maximum']} ms | {medium['subtitleDistribution']['characters']['median']:.1f} / {medium['subtitleDistribution']['characters']['p95']:.1f} / {medium['subtitleDistribution']['characters']['maximum']} |

The candidate does not use a whole-film segment, synthetic timing, reference repair, Python parity, or VAD.

## Product-Model Consequence

Only large-v3 was measured because it is the mandatory first algorithm gate. large-v2, tiny, base, small, medium, and large-v3-turbo are `blocked-not-run`; they are neither qualified nor classified unsupported. Running them would spend substantial CPU time on an algorithm already rejected for the default hard gate.

## Compatibility And Limitations

- `hikaru-asr-worker` emits protocol v1 ready/progress/segment/completed or structured error events; stdout remains JSONL-only.
- T05 `NativeAsrHost` real-worker success, pre-ready structured failure/recovery, and cancellation tests pass with test-only environment injection. Release/default routing remains Python legacy.
- The authoritative corpus still lacks `low-volume`; no complete acoustic coverage claim is made.
- Raw transcripts, token traces, model/build files, absolute paths, and private WAV/ASS remain ignored.
- long-v1 has no scoreable Candidate A transcript because the external timeout terminated the runner before atomic publication. The timeout record is complete for process identity/termination, but not a complete model-generation token trace.
"""


def disposition_markdown(evidence: dict) -> str:
    rows = []
    for item in evidence["productModels"]:
        rows.append(f"| {item['model']} | `{item['disposition']}` | {item['reason']} |")
    return """# T06 Ordinary Faster-Whisper Product-Model Disposition

The selected Candidate A algorithm is rejected by the mandatory large-v3 gate. These are provisional CPU data/handoff dispositions only; T15 owns CUDA qualification when required, T16 owns runtime qualification metadata, and T17 owns all-model-visible UI behavior.

| Model | Disposition | Reason |
|---|---|---|
""" + "\n".join(rows) + "\n\nNo model is qualified, hidden, silently routed to Python, or marked unsupported by T06.\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--short-raw", type=Path, required=True)
    parser.add_argument("--short-result", type=Path, required=True)
    parser.add_argument("--medium-raw", type=Path, required=True)
    parser.add_argument("--medium-result", type=Path, required=True)
    parser.add_argument("--long-timeout", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--algorithm-lock", type=Path, required=True)
    parser.add_argument("--evidence-output", type=Path, required=True)
    parser.add_argument("--report-output", type=Path, required=True)
    parser.add_argument("--disposition-output", type=Path, required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[4]
    benchmark = load_benchmark(repo_root)
    short_raw = json.loads(args.short_raw.read_text(encoding="utf-8"))
    medium_raw = json.loads(args.medium_raw.read_text(encoding="utf-8"))
    short_result = json.loads(args.short_result.read_text(encoding="utf-8"))
    medium_result = json.loads(args.medium_result.read_text(encoding="utf-8"))
    timeout = json.loads(args.long_timeout.read_text(encoding="utf-8"))
    validation = benchmark.validate_manifest(args.manifest, args.corpus_root)
    authoritative_cases = {case["id"]: case for case in validation["cases"]}
    if set(authoritative_cases) != {"short-v1", "medium-v1", "long-v1"}:
        raise RuntimeError("authoritative T01 case set mismatch")
    algorithm_sha256 = sha256_file(args.algorithm_lock)
    lock_text = args.algorithm_lock.read_text(encoding="utf-8")
    short_config_sha256 = validate_raw_identity(benchmark, short_raw, lock_text, "short-v1")
    medium_config_sha256 = validate_raw_identity(benchmark, medium_raw, lock_text, "medium-v1")
    if short_config_sha256 != medium_config_sha256:
        raise RuntimeError("completed Candidate A rows do not share one config identity")

    for raw, raw_path, adapted, adapted_path, case_id in (
        (short_raw, args.short_raw, short_result, args.short_result, "short-v1"),
        (medium_raw, args.medium_raw, medium_result, args.medium_result, "medium-v1"),
    ):
        if raw.get("status") != "completed" or raw.get("caseId") != case_id:
            raise RuntimeError(f"invalid completed raw evidence: {case_id}")
        if raw.get("algorithmLockSha256") != algorithm_sha256:
            raise RuntimeError(f"algorithm identity mismatch: {case_id}")
        validate_adapted_identity(
            benchmark,
            raw,
            adapted,
            authoritative_cases[case_id],
            algorithm_sha256,
            short_config_sha256,
        )
        raw["_rawSha256"] = sha256_file(raw_path)
        adapted["_adaptedSha256"] = sha256_file(adapted_path)

    identity_keys = ("config", "runtime", "model")
    if any(short_raw[key] != medium_raw[key] for key in identity_keys):
        raise RuntimeError("completed Candidate A rows do not share one identity")
    validate_timeout_identity(timeout, short_raw, lock_text)

    short = case_summary(benchmark, short_raw, short_result, "short-v1")
    medium = case_summary(benchmark, medium_raw, medium_result, "medium-v1")
    long_attempt = {
        "caseId": "long-v1",
        "status": "failed-incomplete-timeout",
        "scoreEligible": False,
        "timeoutMs": timeout["failure"]["timeoutMs"],
        "wallRtfLowerBound": timeout["timings"]["wallRtfLowerBound"],
        "failureTraceSha256": timeout["failureTraceSha256"],
        "attemptMeasurementExecutableSha256": timeout["attemptIdentity"]["measurementExecutable"]["sha256"],
        "attemptAlgorithmLockSha256": timeout["attemptIdentity"]["algorithmLockSha256"],
        "ignoredRecordSha256": sha256_file(args.long_timeout),
        "limitation": "process termination occurred before atomic token-trace/result publication; retained unscored",
    }

    products = [
        {"model": "large-v3", "disposition": "stop-revise", "reason": "mandatory short CER and medium CPU RTF gates failed; long timed out"},
        {"model": "large-v2", "disposition": "blocked-not-run", "reason": "mandatory large-v3 algorithm gate rejected Candidate A before the full matrix"},
        {"model": "tiny", "disposition": "blocked-not-run", "reason": "mandatory large-v3 algorithm gate rejected Candidate A before the full matrix"},
        {"model": "base", "disposition": "blocked-not-run", "reason": "mandatory large-v3 algorithm gate rejected Candidate A before the full matrix"},
        {"model": "small", "disposition": "blocked-not-run", "reason": "mandatory large-v3 algorithm gate rejected Candidate A before the full matrix"},
        {"model": "medium", "disposition": "blocked-not-run", "reason": "mandatory large-v3 algorithm gate rejected Candidate A before the full matrix"},
        {"model": "large-v3-turbo", "disposition": "blocked-not-run", "reason": "mandatory large-v3 algorithm gate rejected Candidate A before the full matrix"},
    ]
    evidence = {
        "schemaVersion": 1,
        "decision": "stop-revise",
        "candidate": "A",
        "candidateBActivated": False,
        "candidateBReason": "VAD/chunking cannot repair the observed short CER and CPU RTF failures and would add runtime/package cost",
        "manifest": {
            "corpusId": "hikaru-user-ja-ground-truth-v1",
            "sha256": "e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277",
            "coverageLimitation": "low-volume is absent",
        },
        "identity": {
            "algorithmLockSha256": algorithm_sha256,
            "configSha256": short_config_sha256,
            "runtime": short_raw["runtime"],
            "modelRevision": short_raw["model"]["revision"],
            "modelBinSha256": next(item["sha256"] for item in short_raw["model"]["files"] if item["name"] == "model.bin"),
        },
        "largeV3": {
            "disposition": "stop-revise",
            "measuredCases": [short, medium],
            "longAttempt": long_attempt,
        },
        "productModels": products,
        "privacy": "sanitized identities, aggregates, distributions and failure hashes only; no transcript, token IDs, absolute path, model bytes, or private media",
    }

    args.evidence_output.parent.mkdir(parents=True, exist_ok=True)
    write_lf(
        args.evidence_output,
        json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
    )
    write_lf(args.report_output, markdown_report(evidence))
    write_lf(args.disposition_output, disposition_markdown(evidence))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
