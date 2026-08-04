#!/usr/bin/env python3
"""Publish deterministic sanitized Candidate B short/medium evidence."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

import candidate_b_adapter as adapter

TIMELINE_ERROR_FIELDS = (
    "afterAudioEndCount", "emptyTextCount", "negativeStartCount",
    "nonMonotonicCount", "nonPositiveDurationCount",
)


def write_lf(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))


def timeline_errors(timeline: dict) -> int:
    return sum(int(timeline.get(field, 0)) for field in TIMELINE_ERROR_FIELDS)


def distribution(benchmark, values: list[int]) -> dict:
    if not values:
        raise ValueError("Candidate B returned no subtitle segments")
    return {
        "count": len(values), "minimum": min(values), "median": statistics.median(values),
        "p95": benchmark.percentile(values, 0.95), "maximum": max(values),
    }


def validate_adapted(
    benchmark, raw: dict, adapted: dict, authoritative: dict,
    lock_sha: str, config_sha: str, lock_text: str,
) -> None:
    cases = adapted.get("cases", [])
    runtime = adapted.get("runtime", {})
    reference = authoritative["reference"]
    if (
        adapted.get("schemaVersion") != benchmark.SCHEMA_VERSION
        or adapted.get("kind") != benchmark.RESULT_KIND
        or adapted.get("candidateKind") != "native-candidate"
        or adapted.get("engine") != "faster-whisper"
        or adapted.get("model") != f"{adapter.EXPECTED_MODEL_ID}@{adapter.EXPECTED_MODEL_REVISION}"
        or adapted.get("device") != "cpu"
        or adapted.get("computeType") != "int8"
        or adapted.get("language") != "ja"
        or adapted.get("useVad") is not True
        or runtime.get("candidateBLockSha256") != lock_sha
        or runtime.get("algorithmConfigSha256") != config_sha
        or runtime.get("measurementExecutable") != raw["runtime"]["measurementExecutable"]
        or runtime.get("productionWorker") != raw["runtime"]["productionWorker"]
        or runtime.get("requiredDlls") != raw["runtime"]["requiredDlls"]
        or runtime.get("vadModel") != raw["runtime"]["vadModel"]
        or runtime.get("moduleLayout") != adapter.EXPECTED_MODULE_LAYOUT
        or runtime.get("loadedModules") != adapter.validate_loaded_modules(
            raw["runtime"]["loadedModules"], lock_text,
            raw["runtime"]["pathPolicy"], raw["runtime"]["moduleLayout"])
        or adapted.get("environment") != {
            "os": "Windows",
            "architecture": raw["runtime"]["cpu"]["architecture"],
            "cpu": raw["runtime"]["cpu"],
            "pathPolicy": adapter.sanitize_path_policy(raw["runtime"]["pathPolicy"]),
        }
        or len(cases) != 1
        or cases[0].get("caseId") != authoritative["id"]
        or cases[0].get("audioSha256") != authoritative["audioSha256"]
        or cases[0].get("assSha256") != authoritative["assSha256"]
        or cases[0].get("durationMs") != authoritative["durationMs"]
        or cases[0].get("referenceText") != reference["text"]
        or cases[0].get("referenceSegments") != reference["segments"]
        or cases[0].get("speechIntervals") != reference["speechIntervals"]
        or cases[0].get("status") != "completed"
        or cases[0].get("sampleCount") != len(raw["samples"])
    ):
        raise ValueError(f"Candidate B adapted identity mismatch: {authoritative['id']}")
    for raw_sample, adapted_sample in zip(raw["samples"], cases[0]["samples"], strict=True):
        segments = [{"startMs": item["startMs"], "endMs": item["endMs"], "text": item["text"]} for item in raw_sample["segments"]]
        metrics = benchmark._sample_metrics(
            reference["text"], reference["segments"], reference["speechIntervals"],
            segments, authoritative["durationMs"], "engine-native", "faster-whisper",
        )
        timings = dict(raw_sample["timings"])
        timings.setdefault("totalMs", timings["inferenceMs"])
        timings.setdefault("totalRtf", timings["inferenceRtf"])
        if (
            adapted_sample.get("runKind") != raw_sample["runKind"]
            or adapted_sample.get("repeatIndex") != raw_sample["repeatIndex"]
            or adapted_sample.get("timings") != timings
            or any(adapted_sample.get(key) != metrics[key] for key in ("cer", "timeline", "missingSpeechRegions", "segments"))
        ):
            raise ValueError(f"Candidate B adapted metrics mismatch: {authoritative['id']}")


def case_summary(benchmark, raw: dict, adapted: dict, case_id: str) -> dict:
    case = adapted["cases"][0]
    sample = case["samples"][0]
    raw_sample = raw["samples"][0]
    durations = [item["endMs"] - item["startMs"] for item in sample["segments"]]
    characters = [len(item["text"]) for item in sample["segments"]]
    warm_rtf = case["warmInferenceRtfMedian"]
    effective_rtf = warm_rtf if case_id == "short-v1" else sample["timings"]["inferenceRtf"]
    max_duration = max(durations)
    gates = {
        "cerAtMost0_35": sample["cer"]["cer"] <= 0.35,
        "cpuInferenceRtfAtMost1_0": effective_rtf <= 1.0,
        "shortColdWallAtMost120s": None if case_id != "short-v1" else case["coldProcess"]["processWallMs"] <= 120_000,
        "peakRssAtMost6GiB": case["coldProcess"]["resources"]["peakProcessRssBytes"] <= 6 * 1024**3,
        "timelineErrorsZero": timeline_errors(sample["timeline"]) == 0,
        "confirmedSpeechGapsZero": len(sample["missingSpeechRegions"]) == 0,
        "subtitleScaleUsable": len(durations) > 1 and max_duration <= 30_000,
        "restoredProgressMonotonic": raw_sample["progressMs"] == sorted(raw_sample["progressMs"]) and raw_sample["progressMs"][-1] == case["durationMs"],
        "restoredProvenanceComplete": all(item["vadTimestampRestored"] for item in raw_sample["segments"]),
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
            "vadInferenceMs": raw_sample["vad"]["inferenceMs"],
        },
        "vad": {
            "originalSampleCount": raw_sample["vad"]["originalSampleCount"],
            "compressedSampleCount": raw_sample["vad"]["compressedSampleCount"],
            "retainedRatio": raw_sample["vad"]["compressedSampleCount"] / raw_sample["vad"]["originalSampleCount"],
            "intervalCount": len(raw_sample["vad"]["intervals"]),
            "rowCount": raw_sample["vad"]["rowCount"],
            "batchCount": raw_sample["vad"]["batchCount"],
        },
        "seekEvidence": {
            "windowCount": len(raw_sample["tokenTraces"]),
            "decodedTimestampSeekWindows": sum(item["parseStatus"] == "decoded-seek" for item in raw_sample["tokenTraces"]),
            "sourceWindowEndSeekWindows": sum(item["parseStatus"] == "source-window-end" for item in raw_sample["tokenTraces"]),
            "noSpeechWindows": sum(item["parseStatus"] == "no-speech" for item in raw_sample["tokenTraces"]),
        },
        "subtitleDistribution": {
            "durationMs": distribution(benchmark, durations),
            "characters": distribution(benchmark, characters),
        },
        "gates": gates,
        "allApplicableGatesPass": all(value is not False for value in gates.values()),
        "ignoredEvidence": {
            "rawSha256": adapter.sha256_file(raw["_path"]),
            "adaptedResultSha256": adapter.sha256_file(adapted["_path"]),
        },
    }


def render_report(evidence: dict) -> str:
    short, medium = evidence["largeV3"]["measuredCases"]
    passed = evidence["decision"] == "short-medium-pass-independent-long-review-required"
    decision = "**short/medium pass; independent review is required before long-v1.**" if passed else "**stop-revise; do not run long-v1 or any other model.**"
    def result(case: dict) -> str:
        return "pass" if case["allApplicableGatesPass"] else "fail"
    return f"""# T06 Candidate B Large-v3 Short/Medium Report

## Decision

{decision}

Candidate B is the locked ordinary faster-whisper 1.2.1 Silero V6 stage followed by the selected timestamp-driven/no-history/beam-1 CT2 decode. It uses direct official ORT 1.28.0 CPU execution and no fallback, repair, batched 160ms/30s policy, Silero V4, current Hikaru VAD settings, Python call, or Release route change.

| Case | Samples | CER | CPU inference RTF | Cold wall | Peak RSS | Timeline errors | Gaps >=1.5s | Segments | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| short-v1 | 1 cold + 3 warm | `{short['measurements']['cer']:.4f}` | warm median `{short['measurements']['warmInferenceRtfMedian']:.3f}` | `{short['measurements']['coldProcessWallMs']/1000:.3f}s` | `{short['measurements']['peakProcessRssBytes']/1_000_000_000:.2f} GB` | {short['measurements']['timelineErrors']} | {short['measurements']['confirmedSpeechGapsAtLeast1500Ms']} | {short['measurements']['segmentCount']} | **{result(short)}** |
| medium-v1 | 1 measured | `{medium['measurements']['cer']:.4f}` | `{medium['measurements']['inferenceRtf']:.3f}` | informational | `{medium['measurements']['peakProcessRssBytes']/1_000_000_000:.2f} GB` | {medium['measurements']['timelineErrors']} | {medium['measurements']['confirmedSpeechGapsAtLeast1500Ms']} | {medium['measurements']['segmentCount']} | **{result(medium)}** |

## VAD And Restored-Timeline Evidence

- short retained `{short['vad']['retainedRatio']:.3f}` of source samples across {short['vad']['intervalCount']} padded speech intervals; medium retained `{medium['vad']['retainedRatio']:.3f}` across {medium['vad']['intervalCount']} intervals.
- ORT VAD inference was `{short['measurements']['vadInferenceMs']:.3f}ms` for short and `{medium['measurements']['vadInferenceMs']:.3f}ms` for medium, included in Candidate B inference RTF.
- Original-source progress was monotonic and ended at verified WAV duration. Every accepted segment retained compressed timestamps, restored source timestamps, token trace identity, and WAV-end bound provenance in ignored raw evidence.
- Subtitle duration max is `{short['subtitleDistribution']['durationMs']['maximum']}`ms for short and `{medium['subtitleDistribution']['durationMs']['maximum']}`ms for medium; no whole-audio giant segment was accepted.

## Frozen Identity

- Candidate B final lock SHA-256: `{evidence['identity']['candidateBLockSha256']}`
- Config SHA-256: `{evidence['identity']['configSha256']}`
- Measurement executable SHA-256: `{evidence['identity']['runtime']['measurementExecutable']['sha256']}`
- Production worker SHA-256: `{evidence['identity']['runtime']['productionWorker']['sha256']}`
- ONNX Runtime DLL SHA-256: `{next(item['sha256'] for item in evidence['identity']['runtime']['requiredDlls'] if item['name'] == 'onnxruntime.dll')}`
- Silero V6 model SHA-256: `{evidence['identity']['runtime']['vadModel']['sha256']}`
- CPU identity: `{evidence['identity']['environment']['cpu']['model']}` / `{evidence['identity']['environment']['cpu']['logicalCores']}` logical cores
- Restricted PATH policy SHA-256: `{evidence['identity']['environment']['pathPolicy']['identitySha256']}`
- Actual loaded module set: `{', '.join(item['name'] for item in evidence['identity']['runtime']['loadedModules'])}`
- large-v3 model.bin SHA-256: `{evidence['identity']['modelBinSha256']}`

## Scope

No long-v1, large-v2, other model, GPU, packaging, downloader/readiness, setting, frontend, or native default-route work was run. Passing short/medium does not qualify Candidate B and does not establish that long-v1 gaps are repaired. The corpus still lacks `low-volume` coverage.
"""


def render_disposition(evidence: dict) -> str:
    passed = evidence["decision"] == "short-medium-pass-independent-long-review-required"
    status = "short-medium-pass-long-not-run" if passed else "stop-revise"
    reason = "Candidate B passed large-v3 short/medium; long-v1 requires independent review and was not run" if passed else "Candidate B failed at least one large-v3 short/medium gate"
    rows = [
        ("large-v3", status, reason),
        ("large-v2", "blocked-not-run", "Candidate B large-v3 hard gate is incomplete"),
        ("tiny", "blocked-not-run", "Candidate B large-v3 hard gate is incomplete"),
        ("base", "blocked-not-run", "Candidate B large-v3 hard gate is incomplete"),
        ("small", "blocked-not-run", "Candidate B large-v3 hard gate is incomplete"),
        ("medium", "blocked-not-run", "Candidate B large-v3 hard gate is incomplete"),
        ("large-v3-turbo", "blocked-not-run", "Candidate B large-v3 hard gate is incomplete"),
    ]
    body = "\n".join(f"| {model} | `{state}` | {why} |" for model, state, why in rows)
    return f"""# T06 Candidate B Product-Model Disposition

Candidate B is `{status}`. It is a separate evidence identity from Candidate A, CPU RTF diagnosis, beam selection, selected CPU short/medium, and selected CPU long. No route is qualified or enabled; Release/default remains Python legacy.

| Model | Candidate B status | Reason |
|---|---|---|
{body}

All seven model IDs remain visible for downstream T17. No model is hidden, silently routed, or classified unsupported by this checkpoint.
"""


def main() -> int:
    if sys.argv[1:] == ["--self-check"]:
        assert adapter.EXPECTED_CONFIG["vad"] is True
        assert timeline_errors({field: 0 for field in TIMELINE_ERROR_FIELDS}) == 0
        print("Candidate B publisher self-check passed")
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--short-raw", type=Path, required=True)
    parser.add_argument("--short-result", type=Path, required=True)
    parser.add_argument("--medium-raw", type=Path, required=True)
    parser.add_argument("--medium-result", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--candidate-b-lock", type=Path, required=True)
    parser.add_argument("--evidence-output", type=Path, required=True)
    parser.add_argument("--report-output", type=Path, required=True)
    parser.add_argument("--disposition-output", type=Path, required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[4]
    benchmark = adapter.load_benchmark(repo_root)
    validation = benchmark.validate_manifest(args.manifest, args.corpus_root)
    cases = adapter.validate_authoritative_manifest(benchmark, validation)
    lock_sha = adapter.sha256_file(args.candidate_b_lock)
    lock_text = args.candidate_b_lock.read_text(encoding="utf-8")
    adapter.require_locked_tool(benchmark, Path(__file__), lock_text, "Candidate B publisher")
    adapter.require_locked_tool(benchmark, Path(adapter.__file__), lock_text, "Candidate B adapter")

    loaded = []
    config_sha = None
    for raw_path, result_path, case_id in (
        (args.short_raw, args.short_result, "short-v1"),
        (args.medium_raw, args.medium_result, "medium-v1"),
    ):
        adapter.require_task_local_ignored(benchmark, raw_path, f"Candidate B {case_id} raw")
        adapter.require_task_local_ignored(benchmark, result_path, f"Candidate B {case_id} result")
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        adapted = json.loads(result_path.read_text(encoding="utf-8"))
        current_config = adapter.validate_raw_identity(benchmark, raw, lock_text, lock_sha, case_id)
        if config_sha is None:
            config_sha = current_config
        elif config_sha != current_config:
            raise ValueError("Candidate B short/medium config identity differs")
        validate_adapted(
            benchmark, raw, adapted, cases[case_id], lock_sha, current_config, lock_text
        )
        raw["_path"] = raw_path
        adapted["_path"] = result_path
        loaded.append((raw, adapted, case_id))

    short_raw, medium_raw = loaded[0][0], loaded[1][0]
    for key in ("config", "runtime", "model"):
        if short_raw[key] != medium_raw[key]:
            raise ValueError(f"Candidate B short/medium identity differs: {key}")
    summaries = [case_summary(benchmark, raw, adapted, case_id) for raw, adapted, case_id in loaded]
    passed = all(summary["allApplicableGatesPass"] for summary in summaries)
    evidence = {
        "schemaVersion": 1,
        "decision": "short-medium-pass-independent-long-review-required" if passed else "stop-revise",
        "candidate": "candidate-b-silero-v6-beam1-no-history",
        "qualificationEligible": False,
        "manifest": {
            "corpusId": adapter.EXPECTED_CORPUS_ID,
            "sha256": adapter.EXPECTED_MANIFEST_SHA256,
            "coverageLimitation": "low-volume is absent",
        },
        "identity": {
            "candidateBLockSha256": lock_sha,
            "planningLockSha256": adapter.sha256_file(Path(__file__).with_name("candidate-b-lock.md")),
            "configSha256": config_sha,
            "runtime": loaded[0][1]["runtime"],
            "environment": loaded[0][1]["environment"],
            "modelRevision": short_raw["model"]["revision"],
            "modelBinSha256": adapter.EXPECTED_MODEL_FILES["model.bin"][1],
            "adapter": {"sizeBytes": Path(adapter.__file__).stat().st_size, "sha256": adapter.sha256_file(Path(adapter.__file__))},
            "publisher": {"sizeBytes": Path(__file__).stat().st_size, "sha256": adapter.sha256_file(Path(__file__))},
        },
        "largeV3": {
            "status": "short-medium-pass-long-not-run" if passed else "stop-revise",
            "measuredCases": summaries,
            "longV1": "not-run-independent-review-required" if passed else "not-run-stop-condition",
        },
        "historicalEvidence": "all Candidate A/diagnosis/selection/selected identities remain unchanged and separate",
        "privacy": "sanitized identities, aggregates, distributions, and hashes only; no transcript, tokens, segments, paths, model bytes, or private media",
    }
    write_lf(args.evidence_output, json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n")
    write_lf(args.report_output, render_report(evidence))
    write_lf(args.disposition_output, render_disposition(evidence))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
