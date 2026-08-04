#!/usr/bin/env python3
"""Adapt ignored T06 native output with the authoritative T01 comparator."""

from __future__ import annotations

import argparse
import importlib.util
import json
import statistics
import sys
from pathlib import Path, PurePosixPath


EXPECTED_MODEL_ID = "Systran/faster-whisper-large-v3"
EXPECTED_MODEL_REVISION = "edaa852ec7e145841d8ffdb056a99866b5f0a478"
EXPECTED_MODEL_BIN_SHA256 = "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1"
EXPECTED_MODEL_FILES = {
    "config.json": (2_394, "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9"),
    "model.bin": (3_087_284_237, EXPECTED_MODEL_BIN_SHA256),
    "preprocessor_config.json": (340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"),
    "tokenizer.json": (2_480_617, "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"),
    "vocabulary.json": (1_068_114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"),
}
EXPECTED_RUNTIME = {
    "measurementExecutable": (449_024, "3bf320a41bfbed3ab0687ccccd20f02691ada834596bdfa2a3ef40212595ce8d"),
    "productionWorker": (459_776, "bd103e4fc1c80e8bd6e465bc1e41030be873fa192315547a76debd71cd11cf69"),
    "requiredDlls": {
        "ctranslate2.dll": (22_417_408, "e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59"),
        "hikaru_asr_tokenizer.dll": (2_137_088, "892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d"),
    },
}
EXPECTED_CONFIG = {
    "beamSize": 5,
    "patience": 1.0,
    "lengthPenalty": 1.0,
    "repetitionPenalty": 1.0,
    "noRepeatNgramSize": 0,
    "maxLength": 448,
    "temperature": 0.0,
    "conditionOnPreviousText": True,
    "promptResetOnTemperature": 0.5,
    "noSpeechThreshold": 0.6,
    "logProbThreshold": -1.0,
    "maxInitialTimestampIndex": 50,
    "modelWindowDurationMs": 30_000,
    "timestampResolutionMs": 20,
    "vad": False,
}


def load_benchmark(repo_root: Path):
    path = repo_root / "scripts" / "asr-benchmark.py"
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load T01 benchmark implementation")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def config_sha256(benchmark, config: dict) -> str:
    canonical = {
        "algorithm": "candidate-a-timestamp-driven",
        "computeType": "int8",
        "device": "cpu",
        "language": "ja",
        **config,
    }
    return benchmark.sha256_bytes(
        json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    )


def validate_raw_identity(benchmark, raw: dict, lock_text: str, case_id: str) -> str:
    if raw.get("config") != EXPECTED_CONFIG:
        raise benchmark.ContractError("T06 Candidate A config does not match the frozen family")
    if raw.get("engine") != "faster-whisper":
        raise benchmark.ContractError("T06 raw engine identity mismatch")
    model = raw.get("model", {})
    if model.get("id") != EXPECTED_MODEL_ID or model.get("revision") != EXPECTED_MODEL_REVISION:
        raise benchmark.ContractError("T06 raw model repository/revision mismatch")

    model_files = {item["name"]: item for item in model.get("files", [])}
    if set(model_files) != set(EXPECTED_MODEL_FILES):
        raise benchmark.ContractError("T06 large-v3 model file identity is incomplete")
    for name, (size, sha256) in EXPECTED_MODEL_FILES.items():
        item = model_files[name]
        if item.get("sizeBytes") != size or item.get("sha256") != sha256 or sha256 not in lock_text:
            raise benchmark.ContractError(f"T06 model file is not the locked input: {name}")

    runtime = raw.get("runtime", {})
    if (
        runtime.get("device") != "cpu"
        or runtime.get("computeType") != "int8"
        or runtime.get("ctranslate2Version") != "4.8.0"
    ):
        raise benchmark.ContractError("T06 runtime parameters are not the frozen CPU identity")
    for key in ("measurementExecutable", "productionWorker"):
        size, sha256 = EXPECTED_RUNTIME[key]
        if runtime.get(key) != {"sizeBytes": size, "sha256": sha256} or sha256 not in lock_text:
            raise benchmark.ContractError(f"T06 runtime identity is not the frozen {key}")
    runtime_dlls = {item.get("name"): item for item in runtime.get("requiredDlls", [])}
    if set(runtime_dlls) != set(EXPECTED_RUNTIME["requiredDlls"]):
        raise benchmark.ContractError("T06 runtime DLL identity is incomplete")
    for name, (size, sha256) in EXPECTED_RUNTIME["requiredDlls"].items():
        if runtime_dlls[name] != {"name": name, "sizeBytes": size, "sha256": sha256} or sha256 not in lock_text:
            raise benchmark.ContractError(f"T06 runtime DLL is not the frozen input: {name}")

    expected_samples = 4 if case_id == "short-v1" else 1
    samples = raw.get("samples", [])
    if len(samples) != expected_samples:
        raise benchmark.ContractError(f"T06 {case_id} sample count is incomplete")
    for index, sample in enumerate(samples, start=1):
        trace_hashes = set()
        expected_kind = "cold" if index == 1 else "warm"
        if sample.get("runKind") != expected_kind or sample.get("repeatIndex") != index:
            raise benchmark.ContractError(f"T06 {case_id} sample order is invalid")
        traces = sample.get("tokenTraces", [])
        if not traces or not sample.get("segments"):
            raise benchmark.ContractError(f"T06 {case_id} completed sample has incomplete trace output")
        for trace in traces:
            if (
                trace.get("modelWindowDurationMs") != 30_000
                or not 0 < trace.get("sourceWindowDurationMs", 0) <= 30_000
                or trace.get("seekFramesAfter", 0) <= trace.get("seekFramesBefore", 0)
                or trace.get("parseStatus") not in {"decoded-seek", "source-window-end", "no-speech"}
                or not trace.get("tokenIds")
                or not isinstance(trace.get("sha256"), str)
                or len(trace["sha256"]) != 64
            ):
                raise benchmark.ContractError(f"T06 {case_id} window trace is incomplete")
            trace_hashes.add(trace.get("sha256"))
        if any(segment.get("traceSha256") not in trace_hashes for segment in sample["segments"]):
            raise benchmark.ContractError(f"T06 {case_id} segment trace provenance is incomplete")
    return config_sha256(benchmark, raw["config"])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--case", required=True)
    parser.add_argument("--algorithm-lock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[4]
    benchmark = load_benchmark(repo_root)
    benchmark._require_ignored_raw_output(args.raw)
    benchmark._require_ignored_raw_output(args.output)
    validation = benchmark.validate_manifest(args.manifest, args.corpus_root)
    case = next((item for item in validation["cases"] if item["id"] == args.case), None)
    if case is None:
        raise benchmark.ContractError(f"case not found: {args.case}")

    raw = json.loads(args.raw.read_text(encoding="utf-8"))
    if (
        raw.get("kind") != "hikaru-ct2-whisper-candidate-a-raw"
        or raw.get("schemaVersion") != 1
        or raw.get("status") != "completed"
    ):
        raise benchmark.ContractError("T06 raw evidence is not a completed schema-version 1 result")
    if raw.get("caseId") != args.case or raw.get("candidate") != "A":
        raise benchmark.ContractError("T06 raw case/candidate identity mismatch")
    algorithm_sha256 = benchmark.sha256_file(args.algorithm_lock)
    if raw.get("algorithmLockSha256") != algorithm_sha256:
        raise benchmark.ContractError("T06 raw evidence does not match algorithm-lock.md")
    config_identity = validate_raw_identity(
        benchmark,
        raw,
        args.algorithm_lock.read_text(encoding="utf-8"),
        args.case,
    )
    if raw.get("audio", {}).get("durationMs") != case["durationMs"]:
        raise benchmark.ContractError("T06 duration does not match the authoritative case")
    audio_path = validation["corpusRoot"] / Path(*PurePosixPath(case["audio"]).parts)
    audio_sha256 = benchmark.sha256_file(audio_path)
    if audio_sha256 != case["audioSha256"] or raw.get("audio", {}).get("sha256") != audio_sha256:
        raise benchmark.ContractError("T06 audio does not match the authoritative hash")

    reference = case["reference"]
    samples = []
    for raw_sample in raw["samples"]:
        if raw_sample.get("status") != "completed" or raw_sample.get("failure") is not None:
            raise benchmark.ContractError("failed T06 evidence is complete but is not scoreable")
        segments = [
            {"startMs": item["startMs"], "endMs": item["endMs"], "text": item["text"]}
            for item in raw_sample["segments"]
        ]
        sample = benchmark._sample_metrics(
            reference["text"],
            reference["segments"],
            reference["speechIntervals"],
            segments,
            case["durationMs"],
            "engine-native",
            "faster-whisper",
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

    warm_rtfs = [
        sample["timings"]["inferenceRtf"]
        for sample in samples
        if sample["runKind"] == "warm"
    ]
    generated_at = benchmark.utc_now()
    result = {
        "schemaVersion": benchmark.SCHEMA_VERSION,
        "kind": benchmark.RESULT_KIND,
        "candidateKind": "native-candidate",
        "runId": benchmark.sha256_bytes(
            f"{generated_at}|{validation['manifestSha256']}|candidate-a|{args.case}".encode()
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
        "engine": "faster-whisper",
        "model": f"{raw['model']['id']}@{raw['model']['revision']}",
        "device": "cpu",
        "computeType": "int8",
        "language": "ja",
        "useVad": False,
        "vadConfig": {},
        "runtime": {
            "implementation": "T06 CTranslate2 Candidate A",
            "ctranslate2Version": "4.8.0",
            "algorithmLockSha256": algorithm_sha256,
            "algorithmConfigSha256": config_identity,
            "measurementExecutable": raw["runtime"]["measurementExecutable"],
            "productionWorker": raw["runtime"]["productionWorker"],
            "requiredDlls": raw["runtime"]["requiredDlls"],
            "pythonDependency": False,
            "cudaDependency": False,
        },
        "environment": {
            "os": "Windows",
            "architecture": "x86_64",
            "runtime": "CTranslate2 C++ public Whisper API",
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
            "reproductionCommand": "T06 algorithm-lock.md Candidate A command",
            "sampleCount": len(samples),
            "samples": samples,
            "coldProcess": {
                "preparation": {"loadMs": samples[0]["timings"].get("loadMs")},
                "processWallMs": samples[0]["timings"].get("totalMs"),
                "resources": {
                    "peakProcessRssBytes": raw["resources"]["peakProcessRssBytes"],
                    "peakProcessRssMethod": raw["resources"]["method"],
                    "peakProcessRssUnavailableReason": None,
                    "vram": {"peakVramBytes": None, "method": None, "unavailableReason": "CPU-only T06"},
                },
                "resolvedParameters": raw["config"],
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
