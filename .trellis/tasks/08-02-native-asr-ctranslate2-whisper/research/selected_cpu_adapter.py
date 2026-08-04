#!/usr/bin/env python3
"""Adapt selected T06 CPU candidate output with the authoritative T01 comparator."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import re
import statistics
import sys
from pathlib import Path, PurePosixPath

EXPECTED_MODEL_ID = "Systran/faster-whisper-large-v3"
EXPECTED_MODEL_REVISION = "edaa852ec7e145841d8ffdb056a99866b5f0a478"
EXPECTED_MODEL_FILES = {
    "config.json": (2_394, "a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9"),
    "model.bin": (3_087_284_237, "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1"),
    "preprocessor_config.json": (340, "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"),
    "tokenizer.json": (2_480_617, "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"),
    "vocabulary.json": (1_068_114, "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"),
}
EXPECTED_RUNTIME_DLLS = {
    "ctranslate2.dll": (22_417_408, "e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59"),
    "hikaru_asr_tokenizer.dll": (2_137_088, "892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d"),
}
EXPECTED_RUNTIME_FILES = {
    "measurementExecutable": (562_688, "9acbf01a68bb95bac54bd2aab67a83c48ab240900d1317f55acb5861028e8254"),
    "productionWorker": (459_776, "cb77a661a9cca23895cd8c9a56fe18e1a99bdeb324f30390f7f38b77aa0764ad"),
}
EXPECTED_CORPUS_ID = "hikaru-user-ja-ground-truth-v1"
EXPECTED_MANIFEST_SHA256 = "e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277"
EXPECTED_CASES = {
    "short-v1": {
        "audioSha256": "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211",
        "assSha256": "60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b",
        "durationMs": 24_102,
        "sourceFrames": 2_411,
        "sampleCount": 4,
    },
    "medium-v1": {
        "audioSha256": "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458",
        "assSha256": "d8849bcdb3f2c65a96fa2721d29ddcc919ac6532af20cba1d20fc7b82602404e",
        "durationMs": 498_872,
        "sourceFrames": 49_888,
        "sampleCount": 1,
    },
}
EXPECTED_TIMESTAMP_BEGIN = 50_365
TASK_LOCAL_ROOT = Path(__file__).resolve().parent / "local"
EXPECTED_CONFIG = {
    "beamSize": 1,
    "patience": 1.0,
    "lengthPenalty": 1.0,
    "repetitionPenalty": 1.0,
    "noRepeatNgramSize": 0,
    "maxLength": 448,
    "temperature": 0.0,
    "conditionOnPreviousText": False,
    "timestampDrivenSeek": True,
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
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark_selected_cpu", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load T01 benchmark implementation")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def config_sha256(benchmark, config: dict) -> str:
    canonical = {
        "algorithm": "selected-cpu-timestamp-no-history-beam1",
        "computeType": "int8",
        "device": "cpu",
        "language": "ja",
        **config,
    }
    return benchmark.sha256_bytes(
        json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    )


def validate_file_entries(entries: list[dict], expected: dict[str, tuple[int, str]], lock_text: str, label: str) -> None:
    files = {entry.get("name"): entry for entry in entries}
    if len(entries) != len(files) or set(files) != set(expected):
        raise ValueError(f"{label} file set mismatch")
    for name, (size, sha256) in expected.items():
        if files[name].get("sizeBytes") != size or files[name].get("sha256") != sha256 or sha256 not in lock_text:
            raise ValueError(f"{label} identity mismatch: {name}")


def require_task_local_ignored(benchmark, path: Path, label: str) -> None:
    resolved = path.resolve()
    try:
        relative = resolved.relative_to(TASK_LOCAL_ROOT.resolve())
    except ValueError as exc:
        raise benchmark.ContractError(
            f"{label} must stay below the canonical T06 research/local root"
        ) from exc
    if not relative.parts:
        raise benchmark.ContractError(
            f"{label} must name a file below the canonical T06 research/local root"
        )
    benchmark._require_ignored_raw_output(resolved)


def require_locked_tool(benchmark, path: Path, lock_text: str, label: str) -> None:
    identity = benchmark.sha256_file(path)
    if identity not in lock_text:
        raise benchmark.ContractError(f"{label} identity is not frozen by the selected candidate lock")


def token_trace_sha256(token_ids: list[int]) -> str:
    return hashlib.sha256(",".join(str(token) for token in token_ids).encode()).hexdigest()


def is_contiguous_subsequence(values: list[int], source: list[int]) -> bool:
    if not values or len(values) > len(source):
        return False
    return any(source[index:index + len(values)] == values for index in range(len(source) - len(values) + 1))


def validate_raw_identity(
    benchmark,
    raw: dict,
    lock_text: str,
    candidate_sha256: str,
    case_id: str,
) -> str:
    expected_case = EXPECTED_CASES.get(case_id)
    if expected_case is None:
        raise benchmark.ContractError(f"selected CPU case is outside the reviewed checkpoint: {case_id}")
    if (
        raw.get("schemaVersion") != 1
        or raw.get("kind") != "hikaru-ct2-whisper-selected-cpu-raw"
        or raw.get("status") != "completed"
        or raw.get("caseId") != case_id
        or raw.get("candidate") != "selected-cpu-beam1-no-history"
        or raw.get("candidateLockSha256") != candidate_sha256
        or raw.get("engine") != "faster-whisper"
        or raw.get("config") != EXPECTED_CONFIG
        or raw.get("audio") != {
            "sha256": expected_case["audioSha256"],
            "durationMs": expected_case["durationMs"],
        }
    ):
        raise benchmark.ContractError("selected CPU raw envelope/config/source identity mismatch")

    model = raw.get("model", {})
    if model.get("id") != EXPECTED_MODEL_ID or model.get("revision") != EXPECTED_MODEL_REVISION:
        raise benchmark.ContractError("selected CPU model repository/revision mismatch")
    validate_file_entries(model.get("files", []), EXPECTED_MODEL_FILES, lock_text, "selected CPU model")

    runtime = raw.get("runtime", {})
    if (
        runtime.get("device") != "cpu"
        or runtime.get("computeType") != "int8"
        or runtime.get("ctranslate2Version") != "4.8.0"
    ):
        raise benchmark.ContractError("selected CPU runtime parameters mismatch")
    for key, (size, sha256) in EXPECTED_RUNTIME_FILES.items():
        if runtime.get(key) != {"sizeBytes": size, "sha256": sha256} or sha256 not in lock_text:
            raise benchmark.ContractError(f"selected CPU runtime identity is not frozen: {key}")
    validate_file_entries(
        runtime.get("requiredDlls", []), EXPECTED_RUNTIME_DLLS, lock_text, "selected CPU runtime"
    )

    resources = raw.get("resources", {})
    if (
        resources.get("method") != "GetProcessMemoryInfo.PeakWorkingSetSize"
        or not isinstance(resources.get("peakProcessRssBytes"), int)
        or resources["peakProcessRssBytes"] <= 0
    ):
        raise benchmark.ContractError(f"selected CPU {case_id} resource evidence is incomplete")

    samples = raw.get("samples", [])
    if len(samples) != expected_case["sampleCount"]:
        raise benchmark.ContractError(f"selected CPU {case_id} sample count is incomplete")
    representative_segments = None
    for index, sample in enumerate(samples, start=1):
        expected_kind = "cold" if index == 1 else "warm"
        if (
            sample.get("status") != "completed"
            or sample.get("failure") is not None
            or sample.get("runKind") != expected_kind
            or sample.get("repeatIndex") != index
        ):
            raise benchmark.ContractError(f"selected CPU {case_id} sample order/status is invalid")
        timings = sample.get("timings", {})
        required_timings = ("featureMs", "modelGenerateMs", "inferenceMs", "inferenceRtf")
        if any(
            not isinstance(timings.get(field), (int, float))
            or not math.isfinite(timings[field])
            or timings[field] < 0
            for field in required_timings
        ):
            raise benchmark.ContractError(f"selected CPU {case_id} timing evidence is invalid")
        if (
            timings["modelGenerateMs"] <= 0
            or timings["inferenceMs"] <= 0
            or abs(timings["inferenceRtf"] - timings["inferenceMs"] / expected_case["durationMs"]) > 1e-12
            or timings["featureMs"] + timings["modelGenerateMs"] > timings["inferenceMs"]
        ):
            raise benchmark.ContractError(f"selected CPU {case_id} timing identity is inconsistent")
        if index == 1:
            if (
                not isinstance(timings.get("loadMs"), (int, float))
                or timings["loadMs"] <= 0
                or not isinstance(timings.get("totalMs"), (int, float))
                or timings["totalMs"] <= 0
                or abs(timings.get("totalRtf", 0) - timings["totalMs"] / expected_case["durationMs"]) > 1e-12
            ):
                raise benchmark.ContractError(f"selected CPU {case_id} cold timing is incomplete")
        elif any(field in timings for field in ("loadMs", "totalMs", "totalRtf")):
            raise benchmark.ContractError(f"selected CPU {case_id} warm timing contains cold-only fields")

        traces = sample.get("tokenTraces", [])
        segments = sample.get("segments", [])
        if not traces or not segments:
            raise benchmark.ContractError(f"selected CPU {case_id} sample has incomplete private evidence")
        previous_seek_after = 0
        trace_by_hash: dict[str, list[dict]] = {}
        for trace in traces:
            token_ids = trace.get("tokenIds")
            seek_before = trace.get("seekFramesBefore")
            seek_after = trace.get("seekFramesAfter")
            window_offset = trace.get("windowOffsetMs")
            source_duration = trace.get("sourceWindowDurationMs")
            trace_sha256 = trace.get("sha256")
            if (
                trace.get("modelWindowDurationMs") != 30_000
                or not isinstance(seek_before, int)
                or not isinstance(seek_after, int)
                or seek_before != previous_seek_after
                or not seek_before < seek_after <= expected_case["sourceFrames"]
                or window_offset != seek_before * 10
                or source_duration != min(30_000, expected_case["durationMs"] - window_offset)
                or trace.get("sourceOverlapMs") != max(0, source_duration - (seek_after - seek_before) * 10)
                or trace.get("historyTokenCountBefore") != 0
                or trace.get("historyTokenCountAfter") != 0
                or trace.get("promptTokenCount") != 3
                or trace.get("prefixForwardTokenCount") != 2
                or trace.get("generationCallCount") != 1
                or trace.get("fallbackCallCount") != 0
                or trace.get("parseStatus") not in {"decoded-seek", "source-window-end", "no-speech"}
                or trace.get("parseError") is not None
                or not isinstance(token_ids, list)
                or not token_ids
                or any(not isinstance(token, int) or token < 0 for token in token_ids)
                or not re.fullmatch(r"[0-9a-f]{64}", trace_sha256 or "")
                or token_trace_sha256(token_ids) != trace_sha256
            ):
                raise benchmark.ContractError(f"selected CPU {case_id} trace is incomplete or inconsistent")
            for field in ("featureMs", "generateMs"):
                if (
                    not isinstance(trace.get(field), (int, float))
                    or not math.isfinite(trace[field])
                    or trace[field] < 0
                ):
                    raise benchmark.ContractError(f"selected CPU {case_id} trace timing is invalid")
            trace_by_hash.setdefault(trace_sha256, []).append(trace)
            previous_seek_after = seek_after
        if previous_seek_after != expected_case["sourceFrames"]:
            raise benchmark.ContractError(f"selected CPU {case_id} trace chain did not reach WAV end")

        previous_start = -1
        for segment in segments:
            start = segment.get("startMs")
            end = segment.get("endMs")
            raw_start = segment.get("rawStartMs")
            raw_end = segment.get("rawEndMs")
            segment_tokens = segment.get("tokenIds")
            trace_candidates = [
                trace
                for trace in trace_by_hash.get(segment.get("traceSha256"), [])
                if trace["windowOffsetMs"] <= raw_start < trace["windowOffsetMs"] + 30_000
            ] if isinstance(raw_start, int) else []
            if len(trace_candidates) != 1:
                raise benchmark.ContractError(f"selected CPU {case_id} segment trace provenance is ambiguous")
            trace = trace_candidates[0]
            relative_start = raw_start - trace["windowOffsetMs"]
            relative_end = raw_end - trace["windowOffsetMs"] if isinstance(raw_end, int) else -1
            bounded = raw_end != end
            if (
                not isinstance(start, int)
                or not isinstance(end, int)
                or not isinstance(raw_start, int)
                or not isinstance(raw_end, int)
                or not 0 <= start == raw_start < end <= expected_case["durationMs"]
                or start < previous_start
                or not isinstance(segment.get("text"), str)
                or not segment["text"].strip()
                or not 0 <= relative_start < relative_end <= 30_000
                or relative_start % 20 != 0
                or relative_end % 20 != 0
                or segment.get("endBoundedToAudio") is not bounded
                or (bounded and (end != expected_case["durationMs"] or raw_end <= end))
                or (not bounded and raw_end != end)
                or not isinstance(segment_tokens, list)
                or len(segment_tokens) < 2
                or segment_tokens[0] != segment.get("timestampStartToken")
                or segment_tokens[-1] != segment.get("timestampEndToken")
                or segment["timestampStartToken"] - relative_start // 20 != EXPECTED_TIMESTAMP_BEGIN
                or segment["timestampEndToken"] - relative_end // 20 != EXPECTED_TIMESTAMP_BEGIN
                or not is_contiguous_subsequence(segment_tokens, trace["tokenIds"])
            ):
                raise benchmark.ContractError(f"selected CPU {case_id} segment timing/provenance is invalid")
            previous_start = start
        if representative_segments is None:
            representative_segments = segments
        elif segments != representative_segments:
            raise benchmark.ContractError(f"selected CPU repeated output drifted within {case_id}")
    return config_sha256(benchmark, raw["config"])


def self_check() -> None:
    assert EXPECTED_CONFIG["beamSize"] == 1
    assert EXPECTED_CONFIG["conditionOnPreviousText"] is False
    assert EXPECTED_CONFIG["timestampDrivenSeek"] is True
    assert token_trace_sha256([1, 2, 3]) == hashlib.sha256(b"1,2,3").hexdigest()
    assert is_contiguous_subsequence([2, 3], [1, 2, 3, 4])
    assert not is_contiguous_subsequence([2, 4], [1, 2, 3, 4])
    print("selected CPU adapter self-check passed")


def main() -> int:
    if sys.argv[1:] == ["--self-check"]:
        self_check()
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--case", required=True)
    parser.add_argument("--candidate-lock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[4]
    benchmark = load_benchmark(repo_root)
    require_task_local_ignored(benchmark, args.raw, "selected CPU raw evidence")
    require_task_local_ignored(benchmark, args.output, "selected CPU adapted result")
    validation = benchmark.validate_manifest(args.manifest, args.corpus_root)
    if (
        validation.get("manifestSha256") != EXPECTED_MANIFEST_SHA256
        or validation.get("manifest", {}).get("corpusId") != EXPECTED_CORPUS_ID
    ):
        raise benchmark.ContractError("selected CPU authoritative manifest identity mismatch")
    case = next((item for item in validation["cases"] if item["id"] == args.case), None)
    expected_case = EXPECTED_CASES.get(args.case)
    if case is None or expected_case is None or any(
        case.get(field) != expected_case[field]
        for field in ("audioSha256", "assSha256", "durationMs")
    ):
        raise benchmark.ContractError(f"selected CPU authoritative case identity mismatch: {args.case}")

    raw = json.loads(args.raw.read_text(encoding="utf-8"))
    candidate_sha256 = benchmark.sha256_file(args.candidate_lock)
    lock_text = args.candidate_lock.read_text(encoding="utf-8")
    require_locked_tool(benchmark, Path(__file__), lock_text, "selected CPU adapter")
    config_identity = validate_raw_identity(
        benchmark, raw, lock_text, candidate_sha256, args.case
    )
    audio_path = validation["corpusRoot"] / Path(*PurePosixPath(case["audio"]).parts)
    audio_sha256 = benchmark.sha256_file(audio_path)
    if audio_sha256 != expected_case["audioSha256"]:
        raise benchmark.ContractError("selected CPU audio does not match authoritative hash")

    reference = case["reference"]
    samples = []
    for raw_sample in raw["samples"]:
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
        sample["timings"]["inferenceRtf"] for sample in samples if sample["runKind"] == "warm"
    ]
    generated_at = benchmark.utc_now()
    result = {
        "schemaVersion": benchmark.SCHEMA_VERSION,
        "kind": benchmark.RESULT_KIND,
        "candidateKind": "native-candidate",
        "runId": benchmark.sha256_bytes(
            f"{generated_at}|{validation['manifestSha256']}|selected-cpu|{args.case}".encode()
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
            "implementation": "T06 selected CPU timestamp/no-history/beam1",
            "ctranslate2Version": "4.8.0",
            "candidateLockSha256": candidate_sha256,
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
            "reproductionCommand": "T06 selected-cpu-candidate-lock.md command",
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
