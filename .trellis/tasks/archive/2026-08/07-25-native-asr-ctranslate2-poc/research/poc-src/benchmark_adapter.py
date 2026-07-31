#!/usr/bin/env python3
"""Adapt ignored native PoC output to the authoritative T01 result envelope."""

from __future__ import annotations

import argparse
import importlib.util
import json
import statistics
import sys
from pathlib import Path, PurePosixPath


def load_benchmark(repo_root: Path):
    path = repo_root / "scripts" / "asr-benchmark.py"
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load T01 benchmark implementation")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--case", required=True)
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[5]
    benchmark = load_benchmark(repo_root)
    benchmark._require_ignored_raw_output(args.raw)
    benchmark._require_ignored_raw_output(args.output)
    validation = benchmark.validate_manifest(args.manifest, args.corpus_root)
    case = next((item for item in validation["cases"] if item["id"] == args.case), None)
    if case is None:
        raise benchmark.ContractError(f"case not found: {args.case}")

    raw = json.loads(args.raw.read_text(encoding="utf-8"))
    if raw.get("kind") != "hikaru-ct2-poc-raw" or raw.get("status") != "completed":
        raise benchmark.ContractError("native raw evidence is not completed schema-version 1 output")
    lock_sha256 = benchmark.sha256_file(args.lock)
    if raw.get("inputLockSha256") != lock_sha256:
        raise benchmark.ContractError("native raw evidence does not match the supplied input lock")
    lock = json.loads(args.lock.read_text(encoding="utf-8"))
    model_entry = next(
        (item for item in lock.get("models", []) if item.get("engine") == raw.get("engine")),
        None,
    )
    if model_entry is None:
        raise benchmark.ContractError("native engine is absent from the supplied input lock")
    model_id = f"{model_entry['repository']}@{model_entry['revision']}"
    if raw.get("durationMs") != case["durationMs"]:
        raise benchmark.ContractError("native duration does not match the authoritative case")
    audio_path = validation["corpusRoot"] / Path(*PurePosixPath(case["audio"]).parts)
    if benchmark.sha256_file(audio_path) != case["audioSha256"]:
        raise benchmark.ContractError("native audio does not match the authoritative case hash")

    reference = case["reference"]
    samples = []
    for raw_sample in raw["samples"]:
        segments = raw_sample["segments"]
        sample = benchmark._sample_metrics(
            reference["text"],
            reference["segments"],
            reference["speechIntervals"],
            segments,
            case["durationMs"],
            "engine-native",
            raw["engine"],
        )
        timings = dict(raw_sample["timings"])
        timings.setdefault("totalMs", timings["inferenceMs"])
        timings.setdefault("totalRtf", timings["inferenceRtf"])
        sample.update(
            status="completed",
            runKind=raw_sample["runKind"],
            repeatIndex=raw_sample["repeatIndex"],
            detectedLanguage="ja",
            detectedLanguageUnavailableReason=None,
            reportedDurationMs=case["durationMs"],
            timings=timings,
            tokenTraceHashes=[trace["sha256"] for trace in raw_sample["tokenTraces"]],
        )
        samples.append(sample)

    warm_rtfs = [sample["timings"]["inferenceRtf"] for sample in samples if sample["runKind"] == "warm"]
    generated_at = benchmark.utc_now()
    result = {
        "schemaVersion": benchmark.SCHEMA_VERSION,
        "kind": benchmark.RESULT_KIND,
        "candidateKind": "native-candidate",
        "runId": benchmark.sha256_bytes(
            f"{generated_at}|{validation['manifestSha256']}|{raw['engine']}|{args.case}".encode()
        )[:20],
        "generatedAt": generated_at,
        "manifest": {
            "corpusId": validation["manifest"]["corpusId"],
            "manifestKey": args.manifest.name,
            "sha256": validation["manifestSha256"],
            "durationClasses": sorted({item["durationClass"] for item in validation["manifest"]["cases"]}),
            "coverageTags": sorted({tag for item in validation["manifest"]["cases"] for tag in item["tags"]}),
            "validationWarnings": validation["warnings"],
        },
        "engine": raw["engine"],
        "model": model_id,
        "device": "cpu",
        "computeType": "int8",
        "language": "ja",
        "useVad": False,
        "vadConfig": {},
        "runtime": {
            "implementation": "CTranslate2 C++ public Whisper API",
            "ctranslate2Version": "4.8.0",
            "inputLockSha256": lock_sha256,
            "pythonDependency": False,
            "cudaDependency": False,
        },
        "environment": raw.get("environment") or {
            "unavailableReason": "native environment metadata missing",
        },
        "cases": [{
            "caseId": case["id"],
            "audioKey": case["audio"],
            "assKey": case["ass"],
            "audioSha256": case["audioSha256"],
            "assSha256": case["assSha256"],
            "durationMs": case["durationMs"],
            "durationClass": case["durationClass"],
            "tags": sorted(case["tags"]),
            "referenceDerivation": case["referenceDerivation"],
            "referenceText": reference["text"],
            "referenceTextSha256": reference["textSha256"],
            "referenceNormalizedTextSha256": reference["normalizedTextSha256"],
            "referenceSegments": reference["segments"],
            "speechIntervals": reference["speechIntervals"],
            "dialogueCount": reference["dialogueCount"],
            "status": "completed",
            "error": None,
            "dependencyAvailable": True,
            "modelCache": {"status": "ready"},
            "reproductionCommand": "poc executable --run followed by benchmark_adapter.py; see T02 report",
            "sampleCount": len(samples),
            "samples": samples,
            "coldProcess": {
                "preparation": {"loadMs": samples[0]["timings"].get("loadMs")},
                "processWallMs": samples[0]["timings"].get("totalMs"),
                "resources": {
                    "peakProcessRssBytes": raw["resources"]["peakProcessRssBytes"],
                    "peakProcessRssMethod": raw["resources"]["method"],
                    "peakProcessRssUnavailableReason": None,
                    "vram": {"peakVramBytes": None, "method": None, "unavailableReason": "CPU-only PoC"},
                },
                "resolvedParameters": {
                    "decode": raw["decode"], "window": raw["window"],
                    "promptSha256": raw["prompt"]["sha256"], "preprocessor": raw["preprocessor"],
                },
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
