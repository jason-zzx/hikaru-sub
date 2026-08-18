#!/usr/bin/env python3
"""Publish sanitized aggregate metrics from the ReazonSpeech R2 oracle."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import sys
import wave

from run_r2_oracle import (
    CANDIDATE_ID,
    EXPECTED,
    EXPECTED_CONFIG_SHA256,
    EXPECTED_DEVICE,
    MAX_ADJACENT_OVERLAP_MS,
    MAX_ADJACENT_OVERLAP_SAMPLES,
    ORACLE_ROOT,
    PADDED_MAX_WINDOW_MS,
    PADDED_MAX_WINDOW_SAMPLES,
    PARAKEET_STRATEGY_POLICY,
    RAW_SCHEMA,
    REPO_ROOT,
    RUNTIME_MODULES,
    SAMPLE_RATE,
    VAD,
    WINDOW_POLICY,
    identity,
    load_config,
    require_contained,
    require_ignored,
    sha256,
    verify_inputs,
)

CASE_ORDER = ("short-v1", "medium-v1")
EXPECTED_RAW_SHA256 = {
    "short-v1": "b28b98625993889d1bd4de8a841c1156acd4b62abe9e307b510744c464779b78",
    "medium-v1": "f28d51efc545f55b3484e402765ea773bda780a407435575b24a93f8369e73dc",
}
MAX_CUE_CODE_POINTS = 96
MAX_CUE_DURATION_MS = 15000
R1 = {
    "short-v1": {"cer": 0.225, "semanticGaps": 1, "timelineErrors": 0},
    "medium-v1": {"cer": 0.37714285714285717, "semanticGaps": 22, "timelineErrors": 0},
}
TIMELINE_FIELDS = ("afterAudioEndCount", "emptyTextCount", "negativeStartCount", "nonMonotonicCount", "nonPositiveDurationCount")


def load_benchmark():
    path = REPO_ROOT / "scripts" / "asr-benchmark.py"
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark_r2_oracle", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load shared T01 comparator")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def exact_json_equal(left: object, right: object) -> bool:
    return json.dumps(left, ensure_ascii=False, sort_keys=True, separators=(",", ":")) \
        == json.dumps(right, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sample_to_ms(sample: int) -> int:
    return round(sample * 1000 / SAMPLE_RATE)


def audio_sample_count(path: Path) -> int:
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, SAMPLE_RATE, "NONE"):
            raise RuntimeError("oracle audio shape drifted")
        return audio.getnframes()


def load_protocol_limits() -> dict[str, int]:
    path = REPO_ROOT / "native-asr" / "protocol-v1-limits.json"
    expected_identity = EXPECTED["protocolLimits"]
    if not path.is_file() or (path.stat().st_size, sha256(path)) != expected_identity:
        raise RuntimeError("protocol-v1 limits authority drifted")
    value = json.loads(path.read_text(encoding="utf-8"))
    required = ("protocolVersion", "maxEventLineBytes", "maxTextBytes", "maxReplacementSegments")
    if any(not is_int(value.get(key)) or value[key] <= 0 for key in required) or value["protocolVersion"] != 1:
        raise RuntimeError("protocol-v1 limits authority is invalid")
    return value


def expected_algorithm() -> dict[str, object]:
    return {"apiOrder": ["crispasr_vad_slices", "crispasr_session_transcribe_lang-per-slice"],
            "vad": VAD, "windowPolicy": WINDOW_POLICY, "strategyPolicy": PARAKEET_STRATEGY_POLICY,
            "stitching": False, "gapFill": False, "ownershipRewrite": False, "dedup": False,
            "decoderSearch": False, "punctuationPostProcessing": False, "referenceRepair": False}


def replacement_size(segments: list[dict[str, object]]) -> int:
    event = {"event": "segmentsReplace", "protocolVersion": 1,
             "segments": [{"endMs": segment["endMs"], "startMs": segment["startMs"], "text": segment["text"]}
                          for segment in segments]}
    return len(json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def validate_window_trace(value: dict[str, object], sample_count: int, case_id: str) -> list[dict[str, int]]:
    duration_ms = sample_to_ms(sample_count)
    if value.get("durationMs") != duration_ms:
        raise RuntimeError(f"{case_id} duration drifted")
    windows = value.get("windows")
    if not isinstance(windows, list) or not windows:
        raise RuntimeError(f"{case_id} VAD window trace is incomplete")
    previous_start_sample = -1
    previous_end_sample = -1
    two_back_end_sample = -1
    for index, window in enumerate(windows):
        if not isinstance(window, dict):
            raise RuntimeError(f"{case_id} VAD window is invalid")
        fields = (window.get("index"), window.get("startSample"), window.get("endSample"),
                  window.get("startMs"), window.get("endMs"), window.get("durationMs"),
                  window.get("overlapWithPreviousMs"))
        if not all(is_int(field) for field in fields):
            raise RuntimeError(f"{case_id} VAD window fields are invalid")
        row_index, start_sample, end_sample, start_ms, end_ms, duration, overlap_ms = fields
        if row_index != index or start_sample < 0 or end_sample <= start_sample or end_sample > sample_count:
            raise RuntimeError(f"{case_id} VAD sample bounds/index are invalid")
        if index and (start_sample <= previous_start_sample or end_sample <= previous_end_sample):
            raise RuntimeError(f"{case_id} VAD starts/ends are not monotonic")
        if start_ms != sample_to_ms(start_sample) or end_ms != sample_to_ms(end_sample) \
                or duration != end_ms - start_ms or start_ms < 0 or end_ms > duration_ms or end_ms <= start_ms:
            raise RuntimeError(f"{case_id} VAD millisecond conversion/duration drifted")
        expected_overlap_samples = max(0, previous_end_sample - start_sample) if index else 0
        if overlap_ms != sample_to_ms(expected_overlap_samples) or expected_overlap_samples > MAX_ADJACENT_OVERLAP_SAMPLES:
            raise RuntimeError(f"{case_id} VAD adjacent padding overlap drifted")
        if index > 1 and start_sample < two_back_end_sample:
            raise RuntimeError(f"{case_id} VAD has non-adjacent overlap")
        if end_sample - start_sample > PADDED_MAX_WINDOW_SAMPLES or duration > PADDED_MAX_WINDOW_MS:
            raise RuntimeError(f"{case_id} exceeds the frozen padded inference cap")
        two_back_end_sample, previous_start_sample, previous_end_sample = \
            previous_end_sample, start_sample, end_sample
    if not is_int(value.get("vadWindowCount")) or value["vadWindowCount"] != len(windows):
        raise RuntimeError(f"{case_id} VAD window count drifted")
    if value.get("maximumWindowDurationMs") != max(window["durationMs"] for window in windows):
        raise RuntimeError(f"{case_id} maximum VAD duration drifted")
    if value.get("maximumAdjacentOverlapMs") != max(window["overlapWithPreviousMs"] for window in windows):
        raise RuntimeError(f"{case_id} maximum adjacent overlap drifted")
    return windows


def validate_protocol_replacement(segments: list[dict[str, object]], limits: dict[str, int], case_id: str) -> None:
    if not segments or len(segments) > limits["maxReplacementSegments"]:
        raise RuntimeError(f"{case_id} protocol replacement count is invalid")
    for segment in segments:
        text_bytes = segment["text"].encode("utf-8", "strict")
        if len(text_bytes) > limits["maxTextBytes"] or any(byte < 0x20 or byte == 0x7f for byte in text_bytes):
            raise RuntimeError(f"{case_id} protocol segment text is invalid")
    if replacement_size(segments) > limits["maxEventLineBytes"]:
        raise RuntimeError(f"{case_id} protocol replacement event line is too large")


def validate_raw_trace(value: dict[str, object], sample_count: int, protocol_limits: dict[str, int], case_id: str) -> None:
    if value.get("status") != "completed":
        raise RuntimeError(f"{case_id} raw status is invalid")
    if not exact_json_equal(value.get("algorithm"), expected_algorithm()):
        raise RuntimeError(f"{case_id} algorithm/window/strategy identity drifted")
    windows = validate_window_trace(value, sample_count, case_id)
    calls, segments = value.get("calls"), value.get("finalSegments")
    if not isinstance(calls, list) or not isinstance(segments, list):
        raise RuntimeError(f"{case_id} trace is incomplete")
    timings = value.get("timings")
    if not isinstance(timings, dict) or not isinstance(timings.get("vadMs"), (int, float)) \
            or isinstance(timings.get("vadMs"), bool) or not math.isfinite(timings["vadMs"]) or timings["vadMs"] < 0 \
            or not isinstance(timings.get("inferenceMs"), (int, float)) or isinstance(timings.get("inferenceMs"), bool) \
            or not math.isfinite(timings["inferenceMs"]) or timings["inferenceMs"] < 0:
        raise RuntimeError(f"{case_id} timing trace is invalid")
    if value.get("error") is not None:
        raise RuntimeError(f"{case_id} completed trace contains an error")
    if not is_int(value.get("transcribeCallCount")) or value["transcribeCallCount"] != len(calls) \
            or len(calls) != len(windows):
        raise RuntimeError(f"{case_id} must contain one transcribe call per VAD window")
    selected = []
    previous_result_start = -1
    for index, (window, call) in enumerate(zip(windows, calls)):
        if not isinstance(call, dict) or not all(is_int(call.get(key)) for key in
                                                ("index", "windowStartMs", "windowEndMs", "sourceSegmentCount")) \
                or call["index"] != index or call["windowStartMs"] != window["startMs"] \
                or call["windowEndMs"] != window["endMs"] or call["sourceSegmentCount"] != 1:
            raise RuntimeError(f"{case_id} transcribe call shape drifted")
        result = call.get("result")
        if not isinstance(result, dict):
            raise RuntimeError(f"{case_id} top-level result is missing")
        text, start_ms, end_ms = result.get("text"), result.get("startMs"), result.get("endMs")
        if not isinstance(text, str) or not text or len(text) > MAX_CUE_CODE_POINTS or not is_int(start_ms) or not is_int(end_ms):
            raise RuntimeError(f"{case_id} top-level text/timing is invalid")
        if start_ms < window["startMs"] or start_ms < previous_result_start or end_ms <= start_ms \
                or end_ms > window["endMs"] or end_ms > value["durationMs"] or end_ms - start_ms > MAX_CUE_DURATION_MS \
                or (start_ms - window["startMs"]) % 10 or (end_ms - window["startMs"]) % 10:
            raise RuntimeError(f"{case_id} top-level timeline is invalid")
        text.encode("utf-8", "strict")
        previous_result_start = start_ms
        selected.append(result)
    if segments != selected or b"".join(segment["text"].encode("utf-8") for segment in segments) \
            != b"".join(call["result"]["text"].encode("utf-8") for call in calls):
        raise RuntimeError(f"{case_id} text conservation failed")
    validate_protocol_replacement(segments, protocol_limits, case_id)


def load_raw(raw_root: Path, case_id: str, config: dict[str, object]) -> tuple[dict[str, object], str]:
    path = (raw_root / f"{case_id}.json").resolve()
    require_contained(path, ORACLE_ROOT, "raw result")
    require_ignored(path)
    raw_hash = sha256(path)
    if raw_hash != EXPECTED_RAW_SHA256.get(case_id):
        raise RuntimeError(f"{case_id} raw SHA-256 is not frozen")
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema") != RAW_SCHEMA:
        raise RuntimeError(f"{case_id} raw schema is invalid")
    if value.get("candidateId") != CANDIDATE_ID or value.get("caseId") != case_id:
        raise RuntimeError(f"{case_id} identity drifted")
    if value.get("configSha256") != EXPECTED_CONFIG_SHA256:
        raise RuntimeError(f"{case_id} config identity drifted")
    paths = verify_inputs(config, case_id)
    if value.get("audio") != identity(paths[f"audio:{case_id}"]):
        raise RuntimeError(f"{case_id} audio identity drifted")
    runtime = value.get("runtime")
    if not isinstance(runtime, dict) or runtime.get("library") != identity(paths["library"]) \
            or runtime.get("model") != identity(paths["model"]) or runtime.get("vad") != identity(paths["vad"]):
        raise RuntimeError(f"{case_id} runtime/model/VAD identity drifted")
    if runtime.get("openParams") != config["openParams"] or runtime.get("resolvedBackend") != "parakeet" \
            or runtime.get("device") != EXPECTED_DEVICE:
        raise RuntimeError(f"{case_id} route/device identity drifted")
    policy = runtime.get("pathPolicy")
    if policy != {"policy": "runtime-cuda12.8-system32-v1", "orderedRootRoles": ["runtime-bin", "cuda-bin", "system32"]}:
        raise RuntimeError(f"{case_id} PATH policy drifted")
    modules = runtime.get("loadedModules")
    if not isinstance(modules, list) or len(modules) != len(RUNTIME_MODULES) \
            or {str(row.get("name", "")).lower() for row in modules} != set(RUNTIME_MODULES):
        raise RuntimeError(f"{case_id} loaded module set drifted")
    for row in modules:
        name = str(row["name"]).lower()
        expected_role = "system32" if name == "nvcuda.dll" else "runtime-bin"
        expected_identity = {"sizeBytes": RUNTIME_MODULES[name][0], "sha256": RUNTIME_MODULES[name][1]}
        if row.get("rootRole") != expected_role or row.get("identity") != expected_identity:
            raise RuntimeError(f"{case_id} loaded module identity drifted: {name}")
    validate_raw_trace(value, audio_sample_count(paths[f"audio:{case_id}"]), load_protocol_limits(), case_id)
    return value, raw_hash


def score_case(benchmark, case: dict[str, object], raw: dict[str, object], raw_hash: str) -> dict[str, object]:
    segments = raw["finalSegments"]
    metrics = benchmark._sample_metrics(case["reference"]["text"], case["reference"]["segments"],
                                        case["reference"]["speechIntervals"], segments, case["durationMs"],
                                        "engine-native", "reazonspeech-nemo")
    timeline_errors = sum(int(metrics["timeline"].get(field, 0)) for field in TIMELINE_FIELDS)
    if timeline_errors:
        raise RuntimeError(f"{case['id']} shared T01 timeline validation failed")
    cer = metrics["cer"]["cer"]
    semantic_gaps = len(metrics["missingSpeechRegions"])
    excluded_gaps = len(metrics["excludedNonSemanticVocalizationRegions"])
    baseline = R1[case["id"]]
    lengths = [len(segment["text"]) for segment in segments]
    durations = [segment["endMs"] - segment["startMs"] for segment in segments]
    return {
        "caseId": case["id"], "rawSha256": raw_hash, "cer": cer, "semanticGaps": semantic_gaps,
        "excludedGaps": excluded_gaps, "timelineErrors": timeline_errors,
        "deltaVsR1": {"cer": cer - baseline["cer"], "semanticGaps": semantic_gaps - baseline["semanticGaps"],
                      "timelineErrors": timeline_errors - baseline["timelineErrors"]},
        "primaryLimitsPass": True,
        "shape": {"vadWindows": raw["vadWindowCount"], "transcribeCalls": raw["transcribeCallCount"],
                  "maximumWindowDurationMs": raw["maximumWindowDurationMs"],
                  "maximumAdjacentOverlapMs": raw["maximumAdjacentOverlapMs"],
                  "overlappedBoundaries": sum(window["overlapWithPreviousMs"] > 0 for window in raw["windows"]),
                  "cueCount": len(segments), "maximumCueCodePoints": max(lengths),
                  "maximumCueDurationMs": max(durations)},
    }


def render(results: list[dict[str, object]]) -> tuple[str, str]:
    completed = [result for result in results if result["status"] == "completed"]
    safe = len(completed) == len(CASE_ORDER) and all(
        result.get("primaryLimitsPass") is True and result["timelineErrors"] == 0
        and result["shape"]["maximumWindowDurationMs"] <= PADDED_MAX_WINDOW_MS
        and result["shape"]["maximumAdjacentOverlapMs"] <= MAX_ADJACENT_OVERLAP_MS
        and result["shape"]["maximumCueCodePoints"] <= MAX_CUE_CODE_POINTS
        and result["shape"]["maximumCueDurationMs"] <= MAX_CUE_DURATION_MS
        and result["shape"]["vadWindows"] == result["shape"]["transcribeCalls"]
        == result["shape"]["cueCount"] for result in completed)
    improvement = any(result["deltaVsR1"]["cer"] < 0 or result["deltaVsR1"]["semanticGaps"] < 0
                      for result in completed)
    classification = "promising" if safe and improvement else "not-promising"
    lines = [
        "# ReazonSpeech R2 source-only oracle report", "", f"Classification: **`{classification}`**", "",
        "This is a source-only diagnostic, not a reviewed worker candidate. It does not publish `qualified`, `stop-revise`, `better-than-r1`, or any release disposition.", "",
        "## Frozen diagnostic identity", "",
        f"- Candidate shape: `{CANDIDATE_ID}`.",
        "- User-reviewed relaxation: preserve official/default `speechPadMs=30`; distinguish the `12000ms` unpadded VAD/rechunk core cap from the direct-ABI padded inference cap.",
        f"- Input config SHA-256: `{EXPECTED_CONFIG_SHA256}`.",
        f"- Manifest SHA-256: `{EXPECTED['manifest'][1]}`; shared comparator SHA-256: `{EXPECTED['comparator'][1]}`; protocol-v1 limits SHA-256: `{EXPECTED['protocolLimits'][1]}`.",
        f"- Locked raw SHA-256: short-v1 `{EXPECTED_RAW_SHA256['short-v1']}`; medium-v1 `{EXPECTED_RAW_SHA256['medium-v1']}`.",
        "- CrispASR: `v0.8.22` / `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`; ggml `bfe8ea228d8134d03641c9fcf233a9931f3730de`; c2pa-audio `e40329b83f16f67bb5ddc7bb13ae18de0a9376fc`.",
        f"- Runtime/model/VAD SHA-256: `{EXPECTED['library'][1]}` / `{EXPECTED['model'][1]}` / `{EXPECTED['vad'][1]}`.",
        f"- CUDA device: `{EXPECTED_DEVICE['name']}`, compute capability `{EXPECTED_DEVICE['computeCapability']}`, driver API `{EXPECTED_DEVICE['driverApiVersion']}`.",
        "- Restricted PATH roles: `runtime-bin -> CUDA 12.8 bin -> System32`; loaded required module identities were revalidated.",
        "- VAD: threshold `0.5`, minimum speech `250ms`, minimum silence `100ms`, speech pad `30ms`, unpadded core cap `12000ms`.",
        "- Direct-ABI windows: positive and audio-bounded; starts and ends strictly increase; padded duration is at most `12060ms`; adjacent overlap is accepted only up to the ABI-native `60ms`; non-adjacent overlap is rejected.",
        "- ABI order: one `crispasr_vad_slices`, then exactly one `crispasr_session_transcribe_lang(..., \"ja\")` per returned window on one loaded CUDA session.",
        "- Exact single-pass identity: clear inherited `CRISPASR_PARAKEET_*`, set `CRISPASR_PARAKEET_STREAM_THRESHOLD=13`, set `CRISPASR_SESSION_UNIFIED_DISPATCH=0`, and reject windows above `192960` samples. The pinned legacy inline branch calls direct `parakeet_transcribe_ex`; a null result returns failure without reactive streamed fallback.",
        "- Final cues preserve one top-level result per window and byte-exact text; starts are nondecreasing; cue timing may inherit only the bounded native overlap and must pass `96` code-point / `15000ms` / protocol-v1 / T01 timeline limits.",
        "- Explicitly absent: CLI dispatcher, `transcribe_vad`, clamp, ownership rewrite, dedup, stitching, gap-fill, decoder search, punctuation post-processing, Python/reference repair.", "",
        "## Aggregate comparison with R1", "",
        "| Case | CER | Δ CER | Semantic gaps | Δ gaps | Excluded gaps | Timeline errors | Windows / calls / cues | Max window | Max overlap | Overlapped boundaries |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for result in completed:
        delta, shape = result["deltaVsR1"], result["shape"]
        lines.append(
            f"| `{result['caseId']}` | {result['cer']:.6f} | {delta['cer']:+.6f} | "
            f"{result['semanticGaps']} | {delta['semanticGaps']:+d} | {result['excludedGaps']} | "
            f"{result['timelineErrors']} | {shape['vadWindows']} / {shape['transcribeCalls']} / {shape['cueCount']} | "
            f"{shape['maximumWindowDurationMs']}ms | {shape['maximumAdjacentOverlapMs']}ms | {shape['overlappedBoundaries']} |")
    lines += ["", "## Gate decision", "", f"- Oracle classification: `{classification}`."]
    if classification == "promising":
        lines.append("- The source-only direction has at least one R1-relative CER or semantic-gap improvement signal and is structurally valid for both cases. Return to user review before any Step 2/product implementation.")
    else:
        lines.append("- No structurally safe R1-relative improvement signal was established. Return to planning; do not implement the product candidate merely to continue the task.")
    lines += [
        "- Stop after this oracle gate. Release/default remains Python legacy and the Reazon native route remains disabled.", "",
        "## Residual risks", "",
        "- Native padding overlap means adjacent inference calls hear up to `60ms` of the same audio. This oracle deliberately performs no ownership rewrite or dedup, so repeated/omitted boundary text remains a quality risk visible in CER/gap metrics.",
        "- The direct C ABI pads after rechunking, unlike the maintained CLI's pad-before-rechunk order; the identity is explicit but not byte-equivalent to CLI slicing.",
        "- The oracle does not exercise worker callbacks, protocol emission, atomic replacement, Rust recovery/cancellation, RSS/RTF publication, or long-v2 completion.",
        "- Silero VAD execution is CPU-side inside the pinned runtime while the opened ReazonSpeech session uses the declared CUDA development device.", "",
    ]
    return "\n".join(lines), classification


def publish(config_path: Path, raw_root: Path, output: Path) -> str:
    config = load_config(config_path)
    require_contained(raw_root, ORACLE_ROOT, "raw root")
    benchmark = load_benchmark()
    validation = benchmark.validate_manifest(REPO_ROOT / ".asr-benchmark" / "manifest.json", REPO_ROOT / ".asr-benchmark")
    if validation["manifestSha256"] != EXPECTED["manifest"][1]:
        raise RuntimeError("authoritative manifest identity drifted")
    cases = {case["id"]: case for case in validation["cases"]}
    results = []
    for case_id in CASE_ORDER:
        if not (raw_root / f"{case_id}.json").is_file():
            raise RuntimeError(f"missing oracle raw result: {case_id}")
        raw, raw_hash = load_raw(raw_root, case_id, config)
        if raw.get("durationMs") != cases[case_id]["durationMs"]:
            raise RuntimeError(f"{case_id} duration drifted")
        results.append(dict(score_case(benchmark, cases[case_id], raw, raw_hash), status="completed"))
    report, classification = render(results)
    atomic_text(output, report)
    print(json.dumps({"classification": classification, "cases": {row["caseId"]: row["status"] for row in results}}, sort_keys=True))
    return classification


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--raw-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        publish(args.config.resolve(), args.raw_root.resolve(), args.output.resolve())
        return 0
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"R2 oracle publication rejected: {error}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
