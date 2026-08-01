#!/usr/bin/env python3
"""Adapt ignored CrispASR evidence to the authoritative T01 envelope."""

from __future__ import annotations

import argparse
import importlib.util
import json
import statistics
import subprocess
import sys
from pathlib import Path, PurePosixPath

from evidence_contract import validate_evidence

RAW_KIND = "hikaru-crispasr-poc-raw"
RAW_SCHEMA = 3


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
    parser.add_argument("--raw", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--corpus-root", type=Path)
    parser.add_argument("--case")
    parser.add_argument("--lock", type=Path)
    parser.add_argument("--executable", type=Path)
    parser.add_argument("--runtime-dir", type=Path)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--aligner", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    required = ("raw", "manifest", "corpus_root", "case", "lock", "executable", "runtime_dir", "model", "output")
    missing = [name for name in required if getattr(args, name) is None]
    if missing:
        parser.error("missing required adaptation arguments: " + ", ".join(missing))

    repo_root = Path(__file__).resolve().parents[5]
    benchmark = load_benchmark(repo_root)
    benchmark._require_ignored_raw_output(args.raw)
    benchmark._require_ignored_raw_output(args.output)
    validation = benchmark.validate_manifest(args.manifest, args.corpus_root)
    case = next((item for item in validation["cases"] if item["id"] == args.case), None)
    if case is None:
        raise benchmark.ContractError(f"case not found: {args.case}")
    case = dict(case)
    case["resolvedAudioPath"] = str(validation["corpusRoot"] / Path(*PurePosixPath(case["audio"]).parts))

    raw = json.loads(args.raw.read_text(encoding="utf-8"))
    lock = json.loads(args.lock.read_text(encoding="utf-8"))
    try:
        validate_evidence(
            executable=args.executable, evidence=args.raw, manifest=args.manifest,
            manifest_sha256=validation["manifestSha256"], lock=args.lock, model=args.model,
            aligner=args.aligner, audio=Path(case["resolvedAudioPath"]), case_id=args.case,
            case_source="t01-authoritative",
        )
    except subprocess.CalledProcessError as error:
        raise benchmark.ContractError("shared native evidence identity validator rejected the selected record") from error
    if raw.get("status") != "completed":
        raise benchmark.ContractError("failed native evidence identities are valid but failed evidence is unscored")

    model_entry = next(
        item for item in lock["models"] if item.get("engine") == raw["engine"] and item.get("role") == "primary"
    )
    model_id = f"{model_entry['repository']}@{model_entry['revision']}:{model_entry['fileName']}"
    if raw.get("durationMs") != case["durationMs"]:
        raise benchmark.ContractError("native duration does not match the authoritative case")

    reference = case["reference"]
    samples = []
    for raw_sample in raw["samples"]:
        if raw_sample.get("status") != "completed":
            raise benchmark.ContractError("failed native sample cannot be adapted as completed evidence")
        provenance = raw_sample["timestampProvenance"]
        if raw["engine"] == "qwen3-asr" and provenance != "forced-aligner":
            raise benchmark.ContractError("Qwen3 accepted timeline is not exclusively ForcedAligner-derived")
        sample = benchmark._sample_metrics(
            reference["text"], reference["segments"], reference["speechIntervals"],
            raw_sample["segments"], case["durationMs"], provenance, raw["engine"],
        )
        timings = dict(raw_sample["timings"])
        timings.setdefault("totalMs", timings["inferenceMs"])
        timings.setdefault("totalRtf", timings["inferenceRtf"])
        callback = raw_sample["callback"]
        getter_timing = raw_sample["sessionGetterWordTiming"]
        word_legality = getter_timing["legality"]
        sample.update(
            status="completed", runKind=raw_sample["runKind"], repeatIndex=raw_sample["repeatIndex"],
            detectedLanguage="ja", detectedLanguageUnavailableReason=None,
            reportedDurationMs=case["durationMs"], timings=timings,
            nativeEvidence={
                "progressCallbackCount": len(callback["progress"]),
                "segmentCallbackCount": len(callback["segments"]),
                "tokenCallbackCount": len(callback["tokens"]),
                "progressMonotonic": callback["progressMonotonic"],
                "callbacksOnTranscribeThread": callback["callbacksOnTranscribeThread"],
                "lateCallbackCount": callback["lateCallbackCount"],
                "previewFinalRelationship": callback["previewFinalRelationship"],
                "callbackResetCount": callback["callbackResetCount"],
                "copyBeforeRelease": raw_sample["cleanup"]["copyBeforeRelease"],
                "exactOnceCleanup": raw_sample["cleanup"]["exactOnce"],
                "sessionGetterWordTiming": getter_timing,
                "rawAlignerEntryCount": len(raw_sample["rawAlignmentEntries"]),
                "alignmentUnitCount": raw_sample["alignmentUnitCount"],
                "alignmentGrouping": raw_sample["alignmentGrouping"],
            },
        )
        samples.append(sample)

    warm_rtfs = [sample["timings"]["inferenceRtf"] for sample in samples if sample["runKind"] == "warm"]
    generated_at = benchmark.utc_now()
    ids = raw["identities"]
    result = {
        "schemaVersion": benchmark.SCHEMA_VERSION,
        "kind": benchmark.RESULT_KIND,
        "candidateKind": "native-candidate",
        "runId": benchmark.sha256_bytes(
            f"{generated_at}|{validation['manifestSha256']}|{raw['engine']}|{args.case}|{ids['executable']['sha256']}".encode()
        )[:20],
        "generatedAt": generated_at,
        "manifest": {
            "corpusId": validation["manifest"]["corpusId"], "manifestKey": args.manifest.name,
            "sha256": validation["manifestSha256"],
            "durationClasses": sorted({item["durationClass"] for item in validation["manifest"]["cases"]}),
            "coverageTags": sorted({tag for item in validation["manifest"]["cases"] for tag in item["tags"]}),
            "validationWarnings": validation["warnings"],
        },
        "engine": raw["engine"], "model": model_id, "device": "cpu",
        "computeType": model_entry["quantization"], "language": "ja", "useVad": False, "vadConfig": {},
        "runtime": {
            "implementation": "CrispASR v0.8.22 public C ABI", "crispasrVersion": "0.8.22",
            "crispasrCommit": lock["crispasr"]["commit"], "inputLockSha256": ids["inputLock"]["sha256"],
            "executableSha256": ids["executable"]["sha256"],
            "requiredDllSha256": {item["fileName"]: item["sha256"] for item in ids["requiredDlls"]},
            "primaryModelSha256": ids["primaryModel"]["sha256"],
            "alignerModelSha256": None if ids["alignerModel"] is None else ids["alignerModel"]["sha256"],
            "pythonDependency": False, "cooperativeCancellation": "unsupported",
            "openParams": raw["runtime"]["openParams"],
            "loadedLocalModules": raw["runtime"]["loadedLocalModules"],
        },
        "environment": raw["environment"],
        "cases": [{
            "caseId": case["id"], "audioKey": case["audio"], "assKey": case["ass"],
            "audioSha256": case["audioSha256"], "assSha256": case["assSha256"],
            "durationMs": case["durationMs"], "durationClass": case["durationClass"],
            "tags": sorted(case["tags"]), "referenceDerivation": case["referenceDerivation"],
            "referenceText": reference["text"], "referenceTextSha256": reference["textSha256"],
            "referenceNormalizedTextSha256": reference["normalizedTextSha256"],
            "referenceSegments": reference["segments"], "speechIntervals": reference["speechIntervals"],
            "dialogueCount": reference["dialogueCount"], "status": "completed", "error": None,
            "dependencyAvailable": True, "modelCache": {"status": "ready"},
            "reproductionCommand": "task-local clean-PATH run_evidence.py + benchmark_adapter.py",
            "sampleCount": len(samples), "samples": samples,
            "coldProcess": {
                "preparation": {"loadMs": samples[0]["timings"].get("loadMs")},
                "processWallMs": samples[0]["timings"].get("totalMs"),
                "resources": {
                    "peakProcessRssBytes": raw["resources"]["peakProcessRssBytes"],
                    "peakProcessRssMethod": raw["resources"]["method"],
                    "peakProcessRssUnavailableReason": None,
                    "vram": {"peakVramBytes": None, "method": None,
                             "unavailableReason": "CPU-forced public open params; no VRAM gate"},
                },
                "resolvedParameters": {"backend": raw["resolvedBackend"],
                                       "timestampProvenance": samples[0]["timestampProvenance"]},
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
