#!/usr/bin/env python3
"""Publish sanitized deterministic T03 evidence from ignored raw/result JSON."""

from __future__ import annotations

import hashlib
import json
import statistics
from pathlib import Path

from evidence_contract import row_identity, validate_evidence

TASK = Path(__file__).resolve().parents[1]
REPO = Path(__file__).resolve().parents[5]
LOCAL = TASK / "local"
OUT = TASK / "evidence"
BUILD = LOCAL / "build" / "windows-x64-cpu-poc"
EXE = BUILD / "hikaru-crispasr-poc.exe"
LOCK = TASK / "crispasr-input-lock.json"
MODELS = LOCAL / "models"
CORPUS = REPO / ".asr-benchmark"
MANIFEST = CORPUS / "manifest.json"
GIB = 1024**3
CASES = ("short", "medium", "long")
ROUTES = ("parakeet", "reazonspeech", "qwen3")
MANIFEST_SHA = "e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write(name: str, value) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    (OUT / name).write_bytes(content.encode("utf-8"))


def timeline_error_count(timeline: dict) -> int:
    return sum(timeline[key] for key in (
        "afterAudioEndCount", "emptyTextCount", "negativeStartCount", "nonMonotonicCount", "nonPositiveDurationCount"
    ))


def derived_exact_once(created: bool, free_count: int) -> bool:
    return free_count == (1 if created else 0)


def checked_align_lifecycle(lifecycle: dict) -> dict:
    created = lifecycle["alignResultCreated"]
    free_count = lifecycle["alignResultFreeCount"]
    exact = derived_exact_once(created, free_count)
    if lifecycle["exactOnce"] != exact:
        raise RuntimeError("align-result exactOnce is not derived from created/free count")
    return {"alignResultCreated": created, "alignResultFreeCount": free_count, "exactOnce": exact}


def evidence_identity(raw: dict) -> tuple:
    ids = raw["identities"]
    return (
        ids["inputLock"]["sha256"], ids["executable"]["sha256"], ids["executable"]["sizeBytes"],
        tuple((item["fileName"], item["sizeBytes"], item["sha256"]) for item in ids["requiredDlls"]),
    )


def all_raw() -> dict[str, dict]:
    names = [f"{route}-{case}" for route in ROUTES for case in CASES]
    names += ["qwen-leading-silence-v1", "qwen-boundary-v1"]
    return {name: load(LOCAL / "runs" / f"{name}.json") for name in names}


def validate_all(raws: dict[str, dict]) -> tuple[dict, dict[str, dict], dict]:
    model_paths = {
        "parakeet-ja": MODELS / "parakeet-tdt-0.6b-ja-q8_0.gguf",
        "reazonspeech": MODELS / "reazonspeech-nemo-v2-q8_0.gguf",
        "qwen3-asr": MODELS / "qwen3-asr-1.7b-q4_k.gguf",
    }
    aligner = MODELS / "qwen3-forced-aligner-0.6b-q4_k.gguf"
    identities = {evidence_identity(raw) for raw in raws.values()}
    if len(identities) != 1:
        raise RuntimeError("published rows mix executable/DLL/input-lock evidence sets")
    row_map = {}
    for key, raw in raws.items():
        case = raw["identities"]["case"]
        source = case["caseSource"]
        audio = CORPUS / f"{case['caseId'].removesuffix('-v1')}.wav" if source == "t01-authoritative" else (
            LOCAL / "derived" / ("qwen-leading-silence.wav" if key == "qwen-leading-silence-v1" else "qwen-boundary.wav")
        )
        kwargs = dict(
            executable=EXE, evidence=LOCAL / "runs" / f"{key}.json", manifest=MANIFEST,
            manifest_sha256=MANIFEST_SHA, lock=LOCK, model=model_paths[raw["engine"]],
            aligner=aligner if raw["engine"] == "qwen3-asr" else None, audio=audio,
            case_id=case["caseId"], case_source=source,
        )
        if source == "derived-obligation":
            kwargs.update(source_audio=CORPUS / "short.wav", derivation=case["derivation"]["id"])
        validate_evidence(**kwargs)
        row_map[key] = row_identity(raw)

    negative_path = LOCAL / "negative" / "matrix.json"
    negative = load(negative_path)
    corrupt = LOCAL / "negative" / "corrupt-aligner.gguf"
    unloadable = LOCAL / "negative" / "qwen3-forced-aligner-unloadable.gguf"
    validate_evidence(
        executable=EXE, evidence=negative_path, manifest=MANIFEST, manifest_sha256=MANIFEST_SHA,
        lock=LOCK, model=model_paths["qwen3-asr"], aligner=aligner, audio=CORPUS / "short.wav",
        case_id="short-v1", case_source="negative-obligation",
        corrupt_aligner=corrupt, unloadable_aligner=unloadable,
    )
    for item in negative["cases"]:
        row_map[f"negative:{item['case']}"] = {
            **row_identity(negative),
            "expectedAligner": item["identity"]["expectedAligner"],
            "observedAligner": item["identity"]["observedAligner"],
        }

    lock_sha, exe_sha, exe_size, dlls = next(iter(identities))
    identity = {
        "manifestSha256": MANIFEST_SHA,
        "inputLockSha256": lock_sha,
        "executable": {"fileName": EXE.name, "sizeBytes": exe_size, "sha256": exe_sha},
        "requiredDlls": [
            {"fileName": name, "sizeBytes": size, "sha256": digest} for name, size, digest in dlls
        ],
    }
    return identity, row_map, negative


def benchmark_summary(route: str, case: str) -> dict | None:
    path = LOCAL / "results" / f"{route}-{case}-benchmark.json"
    if not path.exists():
        return None
    raw = load(LOCAL / "runs" / f"{route}-{case}.json")
    if raw["status"] != "completed":
        return None
    result = load(path)
    case_result = result["cases"][0]
    sample = case_result["samples"][0]
    timing = sample["timingAccuracy"]
    getter_timing = sample["nativeEvidence"]["sessionGetterWordTiming"]
    rss = case_result["coldProcess"]["resources"]["peakProcessRssBytes"]
    total_ms = sample["timings"]["totalMs"]
    segment_lengths = [len(item["text"]) for item in raw["samples"][0]["segments"]]
    row = {
        "evidenceKey": f"{route}-{case}", "engine": raw["engine"], "case": f"{case}-v1", "status": "measured",
        "classification": "measured-pass" if (
            sample["cer"]["cer"] <= 0.35
            and sample["timings"]["inferenceRtf"] <= 1.0
            and timeline_error_count(sample["timeline"]) == 0
            and len(sample["missingSpeechRegions"]) == 0
            and rss <= 12 * GIB
        ) else "measured-fail",
        "cer": sample["cer"]["cer"], "cerGate": "pass" if sample["cer"]["cer"] <= 0.35 else "fail",
        "inferenceRtf": sample["timings"]["inferenceRtf"],
        "cpuRtfGate": "pass" if sample["timings"]["inferenceRtf"] <= 1.0 else "fail",
        "coldProcessWallMs": total_ms,
        "shortColdWallGate": (
            "pass" if case == "short" and total_ms <= 120000
            else "fail" if case == "short"
            else "not-applicable"
        ),
        "peakProcessRssBytes": rss, "rssGate": "pass" if rss <= 12 * GIB else "fail",
        "timelineErrorCount": timeline_error_count(sample["timeline"]),
        "timelineGate": "pass" if timeline_error_count(sample["timeline"]) == 0 else "fail",
        "confirmedGapCount": len(sample["missingSpeechRegions"]),
        "gapGate": "pass" if not sample["missingSpeechRegions"] else "fail",
        "timestampProvenance": sample["timestampProvenance"],
        "topLevelSegmentCount": len(raw["samples"][0]["segments"]),
        "topLevelTextLength": {
            "min": min(segment_lengths), "median": statistics.median(segment_lengths), "max": max(segment_lengths)
        },
        "sessionGetterWordTiming": getter_timing,
        "warmInferenceRtfMedian": case_result["warmInferenceRtfMedian"],
        "warmSampleCount": case_result["warmSampleCount"],
        "rawEvidenceSha256": sha256(LOCAL / "runs" / f"{route}-{case}.json"),
        "benchmarkEvidenceSha256": sha256(path),
    }
    if raw["engine"] == "qwen3-asr":
        row.update({
            "qwenTimingEligible": timing["eligible"],
            "qwenStartMedianMs": timing["medianStartErrorMs"],
            "qwenStartP95Ms": timing["p95StartErrorMs"],
            "qwenTimingGate": "pass" if (
                timing["eligible"] and timing["medianStartErrorMs"] <= 150 and timing["p95StartErrorMs"] <= 500
            ) else "fail",
            "alignmentUnitCount": raw["samples"][0]["alignmentUnitCount"],
            "rawAlignerEntryCount": len(raw["samples"][0]["rawAlignmentEntries"]),
            "rawAlignerZeroDurationCount": sum(
                item["startMs"] >= item["endMs"] for item in raw["samples"][0]["rawAlignmentEntries"]
            ),
        })
        if row["qwenTimingGate"] == "fail":
            row["classification"] = "measured-fail"
    return row


def failed_qwen_row(case: str) -> dict:
    path = LOCAL / "runs" / f"qwen3-{case}.json"
    raw = load(path)
    sample = raw["samples"][0]
    ranges = sample["rawAlignmentEntries"]
    return {
        "evidenceKey": f"qwen3-{case}", "engine": "qwen3-asr", "case": f"{case}-v1", "status": "upstream-blocker",
        "classification": "upstream-blocker",
        "attempted": True, "failureCode": sample["failure"]["code"],
        "blocker": "pinned upstream segment grouping inherits zero-centisecond endpoints for some complete source segments; fail-closed legality accepts no timed output",
        "acceptedTimedSegmentCount": 0, "timestampProvenance": "forced-aligner",
        "rawAlignerEntryCount": len(ranges),
        "rawAlignerZeroDurationCount": sum(item["startMs"] >= item["endMs"] for item in ranges),
        "nativeSourceSegmentCount": len(sample["nativeFinalSegments"]),
        "alignmentUnitCount": sample["alignmentUnitCount"],
        "sessionGetterWordTiming": sample["sessionGetterWordTiming"],
        "inferenceRtf": sample["timings"]["inferenceRtf"],
        "peakProcessRssBytes": raw["resources"]["peakProcessRssBytes"],
        "cerGate": "blocked", "cpuRtfGate": "blocked", "shortColdWallGate": "not-applicable",
        "rssGate": "pass" if raw["resources"]["peakProcessRssBytes"] <= 12 * GIB else "fail",
        "timelineGate": "blocked", "gapGate": "blocked", "qwenTimingGate": "blocked",
        "rawEvidenceSha256": sha256(path), "benchmarkEvidenceSha256": None,
    }


def matrix(raws: dict[str, dict], identity: dict, row_map: dict[str, dict]) -> dict:
    rows = []
    for route in ("parakeet", "reazonspeech"):
        rows.extend(benchmark_summary(route, case) for case in CASES)
    rows.append(benchmark_summary("qwen3", "short"))
    rows.extend(failed_qwen_row(case) for case in ("medium", "long"))
    return {
        "schemaVersion": 3, "evidenceSetIdentity": identity,
        "rowIdentityMap": {row["evidenceKey"]: row_map[row["evidenceKey"]] for row in rows},
        "budgets": {"cerMax": 0.35, "cpuInferenceRtfMax": 1.0, "shortColdWallMsMax": 120000,
                    "crispasrPeakRssBytesMax": 12 * GIB, "timelineErrorsMax": 0, "confirmedGapsMax": 0,
                    "qwenStartMedianMsMax": 150, "qwenStartP95MsMax": 500},
        "rows": rows,
    }


def lifecycle(raws: dict[str, dict], identity: dict, row_map: dict[str, dict]) -> dict:
    routes = []
    for name, raw in sorted(raws.items()):
        samples = []
        for sample in raw["samples"]:
            callback = sample["callback"]
            cleanup = sample["cleanup"]
            result_exact = derived_exact_once(cleanup["resultCreated"], cleanup["resultFreeCount"])
            align_exact = derived_exact_once(cleanup["alignResultCreated"], cleanup["alignResultFreeCount"])
            callbacks_required = raw["lifecycle"]["sessionOpened"] and sample["transcribeCall"] != "not-reached-or-failed"
            callback_exact = not callbacks_required or cleanup["callbackResetCount"] == 3
            exact = result_exact and align_exact and callback_exact
            if (cleanup["resultExactOnce"] != result_exact
                    or cleanup["alignResultExactOnce"] != align_exact
                    or cleanup["exactOnce"] != exact):
                raise RuntimeError(f"raw lifecycle exactOnce is not derived for {name}")
            samples.append({
                "status": sample["status"], "progressCallbackCount": len(callback["progress"]),
                "segmentCallbackCount": len(callback["segments"]), "tokenCallbackCount": len(callback["tokens"]),
                "progressMonotonic": callback["progressMonotonic"],
                "callbacksOnTranscribeThread": callback["callbacksOnTranscribeThread"],
                "lateCallbackCount": callback["lateCallbackCount"],
                "previewFinalRelationship": callback["previewFinalRelationship"],
                "callbackResetCount": callback["callbackResetCount"],
                "callbackContextActiveAfterReset": callback["callbackContextActiveAfterReset"],
                "resultCreated": cleanup["resultCreated"], "resultFreeCount": cleanup["resultFreeCount"],
                "resultExactOnce": result_exact,
                "alignResultCreated": cleanup["alignResultCreated"],
                "alignResultFreeCount": cleanup["alignResultFreeCount"],
                "alignResultExactOnce": align_exact,
                "copyBeforeRelease": cleanup["copyBeforeRelease"], "exactOnce": exact,
            })
        routes.append({
            "evidenceKey": name, "engine": raw["engine"], "status": raw["status"],
            "resolvedBackend": raw["resolvedBackend"], "sessionOpened": raw["lifecycle"]["sessionOpened"],
            "sessionCloseCount": raw["lifecycle"]["sessionCloseCount"],
            "sessionExactOnce": raw["lifecycle"]["sessionExactOnce"],
            "openParams": raw["runtime"]["openParams"],
            "loadedLocalModuleNames": [item["fileName"] for item in raw["runtime"]["loadedLocalModules"]],
            "restrictedPath": raw["environment"]["pathPolicy"]["restricted"],
            "cooperativeCancellation": raw["runtime"]["cooperativeCancellation"],
            "samples": samples, "rawEvidenceSha256": sha256(LOCAL / "runs" / f"{name}.json"),
        })
    return {"schemaVersion": 3, "evidenceSetIdentity": identity, "rowIdentityMap": row_map,
            "callbackOwnership": "borrowed callback/getter text is copied before callback return or owner release",
            "routes": routes}


def qwen(raws: dict[str, dict], identity: dict, row_map: dict[str, dict], negatives: dict) -> dict:
    short = raws["qwen3-short"]
    short_result = load(LOCAL / "results" / "qwen3-short-benchmark.json")["cases"][0]["samples"][0]
    positive = []
    for key in ("qwen3-short", "qwen-leading-silence-v1", "qwen-boundary-v1", "qwen3-medium", "qwen3-long"):
        raw = raws[key]
        sample = raw["samples"][0]
        entries = sample["rawAlignmentEntries"]
        positive.append({
            "obligation": key, "status": raw["status"],
            "classification": "measured" if raw["status"] == "completed" else "upstream-blocker",
            "durationMs": raw["durationMs"], "acceptedTimedSegmentCount": len(sample["segments"]),
            "timestampProvenance": sample["timestampProvenance"],
            "alignmentUnitCount": sample["alignmentUnitCount"],
            "rawAlignerEntryCount": len(entries),
            "rawZeroDurationEntryCount": sum(item["startMs"] >= item["endMs"] for item in entries),
            "failureCode": None if raw["status"] == "completed" else sample["failure"]["code"],
            "rawEvidenceSha256": sha256(LOCAL / "runs" / f"{key}.json"),
        })
    baseline_lifecycle = checked_align_lifecycle(negatives["baseline"]["lifecycle"])
    matrix_rows = []
    for item in negatives["cases"]:
        lifecycle = checked_align_lifecycle(item["lifecycle"])
        matrix_rows.append({
            "case": item["case"], "status": item["status"], "stage": item["stage"], "code": item["code"],
            "apiCalled": item["apiCalled"], "acceptedTimedSegmentCount": item["acceptedTimedSegmentCount"],
            "modelLoadReached": item["trace"].get("modelLoadReached"),
            "baselineModelLoadSucceeded": item["trace"].get("baselineModelLoadSucceeded"),
            **lifecycle,
        })
    timing = short_result["timingAccuracy"]
    return {
        "schemaVersion": 3, "evidenceSetIdentity": identity,
        "rowIdentityMap": {key: value for key, value in row_map.items()
                           if key.startswith("qwen") or key.startswith("negative:")},
        "normalShortDecision": {
            "cer": short_result["cer"]["cer"], "cerGate": "pass" if short_result["cer"]["cer"] <= 0.35 else "fail",
            "timingEligible": timing["eligible"], "startMedianMs": timing["medianStartErrorMs"],
            "startP95Ms": timing["p95StartErrorMs"], "timingGate": "pass" if (
                timing["eligible"] and timing["medianStartErrorMs"] <= 150 and timing["p95StartErrorMs"] <= 500
            ) else "fail",
            "grouping": short["samples"][0]["alignmentGrouping"],
            "sessionGetterWordTiming": short["samples"][0]["sessionGetterWordTiming"],
        },
        "positiveMatrix": positive,
        "negativeBaseline": {
            "modelLoadAndAlignmentSucceeded": negatives["baseline"]["modelLoadAndAlignmentSucceeded"],
            "rawAlignmentEntryCount": negatives["baseline"]["rawAlignmentEntryCount"],
            **baseline_lifecycle,
        },
        "negativeMatrix": matrix_rows,
        "negativeRawEvidenceSha256": sha256(LOCAL / "negative" / "matrix.json"),
        "syntheticTimingUsed": False,
    }


def runtime_inventory(identity: dict) -> dict:
    lock = load(TASK / "crispasr-input-lock.json")
    return {
        "schemaVersion": 3, "evidenceSetIdentity": identity,
        "crispasr": lock["crispasr"], "toolchain": lock["toolchain"],
        "runtimeArchive": lock["archives"][0], "runtimeFiles": lock["runtime"]["files"],
        "harnessBinary": identity["executable"], "requiredDlls": identity["requiredDlls"],
        "models": [{key: item[key] for key in (
            "engine", "role", "repository", "revision", "fileName", "quantization", "sizeBytes", "sha256", "license", "attribution"
        )} for item in lock["models"]],
        "licenses": [
            {"component": "CrispASR", "license": "MIT"},
            {"component": "Parakeet JA model", "license": "CC-BY-4.0"},
            {"component": "ReazonSpeech model", "license": "Apache-2.0"},
            {"component": "Qwen3-ASR model", "license": "Apache-2.0"},
            {"component": "Qwen3 ForcedAligner model", "license": "Apache-2.0"},
            {"component": "nlohmann/json", "license": "MIT"},
        ],
        "packagingRisk": lock["runtime"]["packagingObservation"],
    }


def main() -> int:
    raws = all_raw()
    identity, row_map, negatives = validate_all(raws)
    write("matrix.json", matrix(raws, identity, row_map))
    write("lifecycle-callbacks.json", lifecycle(raws, identity, row_map))
    write("qwen-aligner.json", qwen(raws, identity, row_map, negatives))
    write("runtime-inventory.json", runtime_inventory(identity))
    print("published sanitized evidence after shared validation of every authoritative, failed, derived, and negative row")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
