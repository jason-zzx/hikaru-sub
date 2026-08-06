#!/usr/bin/env python3
"""Validate and deterministically supersede retained T03 CrispASR evidence."""

from __future__ import annotations

import argparse
import contextlib
import copy
import hashlib
import importlib.util
import json
import os
import statistics
import subprocess
import sys
import unicodedata
from pathlib import Path, PurePosixPath

TASK = Path(__file__).resolve().parents[1]
REPO = Path(__file__).resolve().parents[4]
LOCAL = TASK / "research" / "local"
T03 = REPO / ".trellis/tasks/archive/2026-08/07-25-native-asr-crispasr-poc/research"
T03_LOCAL = T03 / "local"
T01 = REPO / ".trellis/tasks/archive/2026-07/07-25-native-asr-benchmark-baseline/research"
T08 = REPO / ".trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research"
CORPUS = REPO / ".asr-benchmark"
OLD_MANIFEST = LOCAL / "manifest-long-v1.json"
CURRENT_MANIFEST = CORPUS / "manifest.json"
LOCK = TASK / "research" / "crispasr-long-v2-correction-lock.md"
COMPARATOR = REPO / "scripts/asr-benchmark.py"
OLD_MANIFEST_SHA = "e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277"
CURRENT_MANIFEST_SHA = "3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea"
COMPARATOR_SHA = "b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822"
PUBLICATION_DATA_SHA = "0dde2c901a41b808259967ade7f5255f4942b21da6fd604eb158bf4122020f2a"
LONG_AUDIO_SHA = "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e"
OLD_LONG_ASS_SHA = "7954ce24af05dca37b2930136c83ee722e80fd637ef298cc7eeb47f29cf8c6f3"
CURRENT_LONG_ASS_SHA = "46b4891a4f86c70c1fe54ba4dcfbd776b361f73bb774f1d14e0f2bb53659d04b"
LONG_DURATION_MS = 4_144_235
GIB = 1024 ** 3
ROUTES = ("parakeet", "reazonspeech", "qwen3")
CASES = ("short", "medium", "long")
RAW_HASHES = {
    "parakeet-short": "5e68c20de04c60022550c50664758c43ec71cd48c1564bd8f9c6217b62c0e37c",
    "parakeet-medium": "684ee6dbb5ebdeea1ab6e47288d349dcd272fb3132238b66fceeebbf192dfec5",
    "parakeet-long": "49520ba5851050701ae3936e58e5c3e6e3a2ae47c840e2e4bfbd372fa165255d",
    "reazonspeech-short": "f48b010c50d3d599f35c3ed5658f085469affafd3817039c762ca3d3c45165ef",
    "reazonspeech-medium": "d531864d763ee7f4c010b2e683a4bda578c60a61509f171d7a1063d22681074c",
    "reazonspeech-long": "967a881a1e9a3c49b017eb54e0bedc251be454f6ec15477fc4bdc189d9e81634",
    "qwen3-short": "2b7fe38eab319f85e232a6219cb6b48efaff730e5e573683d87ac759fa9022f4",
    "qwen3-medium": "02013002cd133bb3619e18637654a50ec970ba9d7ac5bc7340bed6c677ee0b87",
    "qwen3-long": "33d46de94e42d86c7cd9b315c1b143b306cf2cd12abdbf13ed062f5a53fe8943",
}
EXPECTED = {
    "parakeet-short-v1": (0.4917, 2, 0, 0),
    "parakeet-medium-v1": (0.6123, 1, 0, 0),
    "parakeet-long-v2": (0.5962, 0, 0, 0),
    "reazonspeech-short-v1": (0.1333, 0, 0, 0),
    "reazonspeech-medium-v1": (0.2857, 0, 0, 0),
    "reazonspeech-long-v2": (0.2944, 0, 0, 0),
    "qwen3-short-v1": (0.2083, 0, 0, 0),
}
DISPOSITIONS = {
    "parakeet": "stop-revise",
    "reazonspeech": "proceed-with-named-risks",
    "qwen3": "stop-revise",
}
BUDGETS = {
    "cerMax": 0.35,
    "cpuInferenceRtfMax": 1.0,
    "shortColdWallMsMax": 120000,
    "crispasrPeakRssBytesMax": 12 * GIB,
    "timelineErrorsMax": 0,
    "semanticGapsMax": 0,
    "qwenStartMedianMsMax": 150,
    "qwenStartP95MsMax": 500,
}
MODEL_FILES = {
    "parakeet-ja": "parakeet-tdt-0.6b-ja-q8_0.gguf",
    "reazonspeech": "reazonspeech-nemo-v2-q8_0.gguf",
    "qwen3-asr": "qwen3-asr-1.7b-q4_k.gguf",
}
ALIGNER_FILE = "qwen3-forced-aligner-0.6b-q4_k.gguf"
_PRIVATE_TEXT_CACHE: tuple[str, ...] | None = None


class CorrectionError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CorrectionError(f"invalid JSON input: {path.name}") from error


def publication_data_sha(data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def require_hash(path: Path, expected: str, label: str) -> None:
    if not path.is_file() or sha256(path) != expected:
        raise CorrectionError(f"{label} identity drift")


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise CorrectionError(f"cannot import {path.name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def validate_correction_lock() -> dict:
    try:
        text = LOCK.read_text(encoding="utf-8")
        payload = text.split("```json\n", 1)[1].split("\n```", 1)[0]
        lock = json.loads(payload)
    except (OSError, IndexError, json.JSONDecodeError) as error:
        raise CorrectionError("correction lock is missing or malformed") from error
    test_path = TASK / "research/test_publish_crispasr_long_v2_correction.py"
    expected = {
        "oldManifestSha256": OLD_MANIFEST_SHA,
        "currentManifestSha256": CURRENT_MANIFEST_SHA,
        "comparatorSha256": COMPARATOR_SHA,
        "publicationDataSha256": PUBLICATION_DATA_SHA,
        "longAudioSha256": LONG_AUDIO_SHA,
        "oldLongAssSha256": OLD_LONG_ASS_SHA,
        "currentLongAssSha256": CURRENT_LONG_ASS_SHA,
        "longDurationMs": LONG_DURATION_MS,
        "rawSha256": RAW_HASHES,
        "budgets": BUDGETS,
        "dispositions": DISPOSITIONS,
        "preview": {key: list(value) for key, value in EXPECTED.items()},
        "publisherSha256": sha256(Path(__file__)),
        "testSha256": sha256(test_path),
    }
    for key, value in expected.items():
        if lock.get(key) != value:
            raise CorrectionError(f"correction lock drift: {key}")
    source_hashes = lock.get("archivedSourceSha256", {})
    required_sources = {
        "t01BenchmarkContract": T01 / "benchmark-contract.md",
        "t03Report": T03 / "crispasr-poc-report.md",
        "t03InputLock": T03 / "crispasr-input-lock.json",
        "t03EvidenceContract": T03 / "poc-src/evidence_contract.py",
        "t03Adapter": T03 / "poc-src/benchmark_adapter.py",
        "t03Publisher": T03 / "poc-src/publish_evidence.py",
    }
    if source_hashes != {key: sha256(path) for key, path in required_sources.items()}:
        raise CorrectionError("correction lock archived source drift")
    return lock


def validate_manifest_identities(benchmark) -> tuple[dict, dict]:
    require_hash(OLD_MANIFEST, OLD_MANIFEST_SHA, "historical manifest")
    require_hash(CURRENT_MANIFEST, CURRENT_MANIFEST_SHA, "current manifest")
    require_hash(COMPARATOR, COMPARATOR_SHA, "shared comparator")
    old = benchmark.validate_manifest(OLD_MANIFEST, CORPUS)
    current = benchmark.validate_manifest(CURRENT_MANIFEST, CORPUS)
    if old["manifestSha256"] != OLD_MANIFEST_SHA or current["manifestSha256"] != CURRENT_MANIFEST_SHA:
        raise CorrectionError("validated manifest digest mismatch")
    old_cases = {item["id"]: item for item in old["cases"]}
    current_cases = {item["id"]: item for item in current["cases"]}
    old_long = old_cases.get("long-v1")
    current_long = current_cases.get("long-v2")
    if not old_long or not current_long:
        raise CorrectionError("long reference identity missing")
    if (old_long["audioSha256"], old_long["assSha256"], old_long["durationMs"], old_long["reference"]["dialogueCount"]) != (
        LONG_AUDIO_SHA, OLD_LONG_ASS_SHA, LONG_DURATION_MS, 908
    ):
        raise CorrectionError("historical long identity drift")
    if (current_long["audioSha256"], current_long["assSha256"], current_long["durationMs"], current_long["reference"]["dialogueCount"]) != (
        LONG_AUDIO_SHA, CURRENT_LONG_ASS_SHA, LONG_DURATION_MS, 681
    ):
        raise CorrectionError("current long-v2 identity drift")
    if old_long["audioSha256"] != current_long["audioSha256"] or old_long["durationMs"] != current_long["durationMs"]:
        raise CorrectionError("long-v1 to long-v2 audio remap is not reference-only")
    return old, current


@contextlib.contextmanager
def compiled_root_seam():
    """Temporarily restore the archived binary's compiled local-root junction."""
    old = REPO / ".trellis/tasks/07-25-native-asr-crispasr-poc/research/local"
    created = False
    if old.exists():
        if old.resolve() != T03_LOCAL.resolve():
            raise CorrectionError("compiled validator seam path is occupied")
    else:
        old.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(old), str(T03_LOCAL)],
            text=True, capture_output=True,
        )
        if result.returncode != 0:
            raise CorrectionError("cannot create temporary compiled-validator junction")
        created = True
    try:
        yield
    finally:
        if created:
            os.rmdir(old)
            for directory in (old.parent, old.parent.parent, old.parent.parent.parent):
                try:
                    directory.rmdir()
                except OSError:
                    pass


def raw_path(key: str) -> Path:
    return T03_LOCAL / "runs" / f"{key}.json"


def validate_raw_inventory(paths: dict[str, Path] | None = None) -> dict[str, dict]:
    selected = paths or {key: raw_path(key) for key in RAW_HASHES}
    if set(selected) != set(RAW_HASHES):
        raise CorrectionError("authoritative raw matrix is incomplete or substituted")
    raws = {}
    expected_engine = {"parakeet": "parakeet-ja", "reazonspeech": "reazonspeech", "qwen3": "qwen3-asr"}
    for key, expected_hash in RAW_HASHES.items():
        path = selected[key]
        require_hash(path, expected_hash, f"raw {key}")
        raw = load_json(path)
        route, source_case = key.rsplit("-", 1)
        case_id = f"{source_case}-v1"
        if raw.get("engine") != expected_engine[route] or raw.get("identities", {}).get("case", {}).get("caseId") != case_id:
            raise CorrectionError(f"raw role substitution: {key}")
        expected_status = "failed" if key in {"qwen3-medium", "qwen3-long"} else "completed"
        if raw.get("status") != expected_status:
            raise CorrectionError(f"raw status drift: {key}")
        sample = raw.get("samples", [{}])[0]
        if expected_status == "failed" and (
            sample.get("failure", {}).get("code") != "segment-legality-failed"
            or sample.get("segments") != []
        ):
            raise CorrectionError(f"Qwen failed-row promotion: {key}")
        raws[key] = raw
    return raws


def validate_compiled_identities(raws: dict[str, dict], evidence_contract) -> list[str]:
    exe = T03_LOCAL / "build/windows-x64-cpu-poc/hikaru-crispasr-poc.exe"
    lock = T03 / "crispasr-input-lock.json"
    models = T03_LOCAL / "models"
    aligner = models / ALIGNER_FILE
    validations = []
    with compiled_root_seam():
        for key in RAW_HASHES:
            raw = raws[key]
            case = raw["identities"]["case"]["caseId"]
            audio = CORPUS / f"{case.removesuffix('-v1')}.wav"
            model = models / MODEL_FILES[raw["engine"]]
            try:
                result = evidence_contract.validate_evidence(
                    executable=exe,
                    evidence=raw_path(key),
                    manifest=OLD_MANIFEST,
                    manifest_sha256=OLD_MANIFEST_SHA,
                    lock=lock,
                    model=model,
                    aligner=aligner if raw["engine"] == "qwen3-asr" else None,
                    audio=audio,
                    case_id=case,
                    case_source="t01-authoritative",
                )
            except subprocess.CalledProcessError as error:
                detail = (error.stderr or error.stdout or "validator rejected row").strip()
                raise CorrectionError(f"compiled identity validation failed for {key}: {detail}") from error
            validations.append(f"{key}:{load_json_text(result.stdout).get('status')}")
    return validations


def load_json_text(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise CorrectionError("compiled validator returned malformed output") from error


def timeline_error_count(timeline: dict) -> int:
    return sum(timeline[key] for key in (
        "afterAudioEndCount", "emptyTextCount", "negativeStartCount", "nonMonotonicCount", "nonPositiveDurationCount"
    ))


def current_case(validation: dict, case_id: str) -> dict:
    case = next((item for item in validation["cases"] if item["id"] == case_id), None)
    if case is None:
        raise CorrectionError(f"current case missing: {case_id}")
    return case


def score_completed(key: str, raw: dict, current: dict, benchmark) -> dict:
    route, source_case = key.rsplit("-", 1)
    case_id = "long-v2" if source_case == "long" else f"{source_case}-v1"
    case = current_case(current, case_id)
    reference = case["reference"]
    scored = []
    for sample in raw["samples"]:
        if sample.get("status") != "completed":
            raise CorrectionError(f"completed row contains failed sample: {key}")
        metrics = benchmark._sample_metrics(
            reference["text"], reference["segments"], reference["speechIntervals"],
            sample["segments"], case["durationMs"], sample["timestampProvenance"], raw["engine"],
        )
        scored.append(metrics)
    signatures = {
        (
            round(item["cer"]["cer"], 12),
            len(item["missingSpeechRegions"]),
            len(item["excludedNonSemanticVocalizationRegions"]),
            timeline_error_count(item["timeline"]),
        )
        for item in scored
    }
    if len(signatures) != 1:
        raise CorrectionError(f"repeat quality drift: {key}")
    metrics = scored[0]
    raw_sample = raw["samples"][0]
    timings = raw_sample["timings"]
    legality = raw_sample["sessionGetterWordTiming"]["legality"]
    segment_lengths = [len(item["text"]) for item in raw_sample["segments"]]
    warm_rtfs = [sample["timings"]["inferenceRtf"] for sample in raw["samples"] if sample["runKind"] == "warm"]
    timing = metrics["timingAccuracy"]
    row = {
        "rowId": f"{route}-{case_id}",
        "route": route,
        "engine": raw["engine"],
        "sourceHistoricalCaseId": f"{source_case}-v1",
        "currentCaseId": case_id,
        "status": "measured",
        "rawSha256": RAW_HASHES[key],
        "sampleCount": len(raw["samples"]),
        "cer": metrics["cer"],
        "inferenceRtf": timings["inferenceRtf"],
        "warmInferenceRtfMedian": statistics.median(warm_rtfs) if warm_rtfs else None,
        "coldProcessWallMs": timings["totalMs"] if source_case == "short" else None,
        "peakProcessRssBytes": raw["resources"]["peakProcessRssBytes"],
        "timelineErrorCount": timeline_error_count(metrics["timeline"]),
        "semanticGapCount": len(metrics["missingSpeechRegions"]),
        "excludedVocalizationGapCount": len(metrics["excludedNonSemanticVocalizationRegions"]),
        "timestampProvenance": raw_sample["timestampProvenance"],
        "topLevelSegmentCount": len(segment_lengths),
        "topLevelTextLength": {
            "min": min(segment_lengths), "median": statistics.median(segment_lengths), "max": max(segment_lengths)
        },
        "nativeWordRangeCount": legality["count"],
        "nativeWordNonPositiveDurationCount": legality["nonPositiveDurationCount"],
        "gates": {
            "cer": "pass" if metrics["cer"]["cer"] <= BUDGETS["cerMax"] else "fail",
            "cpuRtf": "pass" if timings["inferenceRtf"] <= BUDGETS["cpuInferenceRtfMax"] else "fail",
            "shortColdWall": (
                "pass" if source_case == "short" and timings["totalMs"] <= BUDGETS["shortColdWallMsMax"]
                else "fail" if source_case == "short" else "not-applicable"
            ),
            "rss": "pass" if raw["resources"]["peakProcessRssBytes"] <= BUDGETS["crispasrPeakRssBytesMax"] else "fail",
            "timeline": "pass" if timeline_error_count(metrics["timeline"]) == 0 else "fail",
            "semanticGaps": "pass" if not metrics["missingSpeechRegions"] else "fail",
        },
    }
    if route == "qwen3":
        row["qwenTiming"] = {
            "eligible": timing["eligible"],
            "medianStartErrorMs": timing["medianStartErrorMs"],
            "p95StartErrorMs": timing["p95StartErrorMs"],
            "gate": "pass" if timing["eligible"] and timing["medianStartErrorMs"] <= 150 and timing["p95StartErrorMs"] <= 500 else "fail",
        }
    row["result"] = "pass" if all(value in {"pass", "not-applicable"} for value in row["gates"].values()) else "fail"
    if route == "qwen3" and row["qwenTiming"]["gate"] == "fail":
        row["result"] = "fail"
    return row


def failed_qwen(key: str, raw: dict) -> dict:
    source_case = key.rsplit("-", 1)[1]
    case_id = "long-v2" if source_case == "long" else "medium-v1"
    sample = raw["samples"][0]
    return {
        "rowId": f"qwen3-{case_id}",
        "route": "qwen3",
        "engine": "qwen3-asr",
        "sourceHistoricalCaseId": f"{source_case}-v1",
        "currentCaseId": case_id,
        "status": "upstream-blocker",
        "attempted": True,
        "failureCode": "segment-legality-failed",
        "acceptedTimedSegmentCount": 0,
        "rawSha256": RAW_HASHES[key],
        "timestampProvenance": "forced-aligner",
        "alignmentUnitCount": sample["alignmentUnitCount"],
        "rawAlignerEntryCount": len(sample["rawAlignmentEntries"]),
        "inferenceRtf": sample["timings"]["inferenceRtf"],
        "peakProcessRssBytes": raw["resources"]["peakProcessRssBytes"],
        "cer": None,
        "timelineErrorCount": None,
        "semanticGapCount": None,
        "excludedVocalizationGapCount": None,
        "qwenTiming": None,
        "gates": {
            "cer": "blocked", "cpuRtf": "blocked", "shortColdWall": "not-applicable",
            "rss": "pass" if raw["resources"]["peakProcessRssBytes"] <= BUDGETS["crispasrPeakRssBytesMax"] else "fail",
            "timeline": "blocked", "semanticGaps": "blocked", "qwenTiming": "blocked",
        },
        "result": "upstream-blocker",
    }


def build_publication(validate_compiled: bool = True, paths: dict[str, Path] | None = None) -> dict:
    if not validate_compiled:
        raise CorrectionError("compiled identity validation is mandatory")
    validate_correction_lock()
    benchmark = load_module("hikaru_asr_benchmark_t03c", COMPARATOR)
    old, current = validate_manifest_identities(benchmark)
    raws = validate_raw_inventory(paths)
    validation_rows = []
    if validate_compiled:
        evidence_contract = load_module("t03_archived_evidence_contract", T03 / "poc-src/evidence_contract.py")
        validation_rows = validate_compiled_identities(raws, evidence_contract)
    rows = []
    for route in ("parakeet", "reazonspeech"):
        for case in CASES:
            rows.append(score_completed(f"{route}-{case}", raws[f"{route}-{case}"], current, benchmark))
    rows.append(score_completed("qwen3-short", raws["qwen3-short"], current, benchmark))
    rows.extend(failed_qwen(key, raws[key]) for key in ("qwen3-medium", "qwen3-long"))
    lock = load_json(T03 / "crispasr-input-lock.json")
    result = {
        "schemaVersion": 1,
        "kind": "hikaru-crispasr-long-v2-correction",
        "identity": {
            "historicalManifest": {
                "sha256": old["manifestSha256"], "longCaseId": "long-v1", "assSha256": OLD_LONG_ASS_SHA,
            },
            "currentManifest": {
                "sha256": current["manifestSha256"], "longCaseId": "long-v2", "assSha256": CURRENT_LONG_ASS_SHA,
                "dialogueCount": 681,
            },
            "longAudio": {"sha256": LONG_AUDIO_SHA, "durationMs": LONG_DURATION_MS},
            "comparatorSha256": COMPARATOR_SHA,
            "t03InputLockSha256": sha256(T03 / "crispasr-input-lock.json"),
            "t03Executable": raws["parakeet-short"]["identities"]["executable"],
            "requiredDlls": raws["parakeet-short"]["identities"]["requiredDlls"],
            "models": [
                {key: item[key] for key in ("engine", "role", "fileName", "sizeBytes", "sha256")}
                for item in lock["models"]
            ],
            "cpuOpenParams": raws["parakeet-short"]["runtime"]["openParams"],
            "loadedLocalModules": raws["parakeet-short"]["runtime"]["loadedLocalModules"],
            "restrictedPath": raws["parakeet-short"]["environment"]["pathPolicy"],
            "compiledValidationRows": validation_rows,
        },
        "budgets": copy.deepcopy(BUDGETS),
        "routeDispositions": copy.deepcopy(DISPOSITIONS),
        "rows": rows,
        "namedRisks": {
            "parakeet": ["all completed cases fail CER", "one oversized top-level segment per case"],
            "reazonspeech": ["one oversized top-level segment per case", "most native word ranges are zero-duration", "not subtitle-ready"],
            "qwen3": ["short ForcedAligner start timing fails", "medium/long-v2 have no legal accepted timeline"],
        },
        "supersession": {
            "currentAuthority": "this matrix supersedes T03 quality conclusions for the current long-v2 benchmark",
            "historicalBoundary": "archived T01/T03 long-v1 reports remain immutable provenance only",
            "productBoundary": "no inference, rebuild, production route, package, settings, UI, downloader, or installer change",
            "releaseDefault": "python-legacy",
        },
    }
    validate_publication_data(result, require_compiled=validate_compiled)
    return result


def validate_publication_data(data: dict, require_compiled: bool = True) -> None:
    if not require_compiled:
        raise CorrectionError("compiled identity validation cannot be disabled")
    lock = validate_correction_lock()
    identity = data.get("identity", {})
    expected_compiled = [f"{key}:valid" for key in RAW_HASHES]
    if identity.get("compiledValidationRows", []) != expected_compiled:
        raise CorrectionError("not all nine rows passed compiled identity validation")
    if publication_data_sha(data) != PUBLICATION_DATA_SHA:
        raise CorrectionError("published canonical data drift")
    expected_identity = {
        "historicalManifest": {"sha256": OLD_MANIFEST_SHA, "longCaseId": "long-v1", "assSha256": OLD_LONG_ASS_SHA},
        "currentManifest": {"sha256": CURRENT_MANIFEST_SHA, "longCaseId": "long-v2", "assSha256": CURRENT_LONG_ASS_SHA, "dialogueCount": 681},
        "longAudio": {"sha256": LONG_AUDIO_SHA, "durationMs": LONG_DURATION_MS},
        "comparatorSha256": COMPARATOR_SHA,
        "t03InputLockSha256": lock["archivedSourceSha256"]["t03InputLock"],
        "t03ExecutableSha256": lock["executable"]["sha256"],
        "requiredDllSha256": lock["requiredDllSha256"],
        "modelSha256": lock["modelSha256"],
        "cpuOpenParams": lock["cpuOpenParams"],
        "restrictedPath": lock["restrictedPath"],
    }
    actual_identity = {
        "historicalManifest": identity.get("historicalManifest"),
        "currentManifest": identity.get("currentManifest"),
        "longAudio": identity.get("longAudio"),
        "comparatorSha256": identity.get("comparatorSha256"),
        "t03InputLockSha256": identity.get("t03InputLockSha256"),
        "t03ExecutableSha256": identity.get("t03Executable", {}).get("sha256"),
        "requiredDllSha256": {item["fileName"]: item["sha256"] for item in identity.get("requiredDlls", [])},
        "modelSha256": {
            ("qwen3-aligner" if item["engine"] == "qwen3-asr" and item["role"] == "aligner" else item["engine"]): item["sha256"]
            for item in identity.get("models", [])
        },
        "cpuOpenParams": identity.get("cpuOpenParams"),
        "restrictedPath": identity.get("restrictedPath"),
    }
    if actual_identity != expected_identity:
        raise CorrectionError("published benchmark/runtime/model identity drift")
    if data.get("budgets") != BUDGETS or data.get("routeDispositions") != DISPOSITIONS:
        raise CorrectionError("gate or disposition drift")
    rows = data.get("rows", [])
    ids = [row.get("rowId") for row in rows]
    expected_ids = [
        "parakeet-short-v1", "parakeet-medium-v1", "parakeet-long-v2",
        "reazonspeech-short-v1", "reazonspeech-medium-v1", "reazonspeech-long-v2",
        "qwen3-short-v1", "qwen3-medium-v1", "qwen3-long-v2",
    ]
    if ids != expected_ids:
        raise CorrectionError("published matrix is incomplete or reordered")
    for row in rows[:7]:
        expected = EXPECTED[row["rowId"]]
        cer = row["cer"]
        actual = (
            round(cer["cer"], 4), row["semanticGapCount"],
            row["excludedVocalizationGapCount"], row["timelineErrorCount"],
        )
        if actual != expected:
            raise CorrectionError(f"preview reproduction failed: {row['rowId']}")
        if cer["errors"] != cer["substitutions"] + cer["deletions"] + cer["insertions"]:
            raise CorrectionError(f"CER component drift: {row['rowId']}")
        if not cer["referenceCharacters"] or abs(cer["cer"] - cer["errors"] / cer["referenceCharacters"]) > 1e-12:
            raise CorrectionError(f"CER scalar drift: {row['rowId']}")
    for row in rows[7:]:
        if (
            row.get("status") != "upstream-blocker"
            or row.get("failureCode") != "segment-legality-failed"
            or row.get("acceptedTimedSegmentCount") != 0
            or row.get("cer") is not None
            or row.get("timelineErrorCount") is not None
            or row.get("semanticGapCount") is not None
            or row.get("qwenTiming") is not None
        ):
            raise CorrectionError("Qwen failed row was promoted or synthesized")
    if rows[6]["qwenTiming"]["gate"] != "fail":
        raise CorrectionError("Qwen short timing failure was lost")
    if data["routeDispositions"] != DISPOSITIONS:
        raise CorrectionError("route disposition drift")
    validate_publication_privacy(data)


def private_text_candidates() -> tuple[str, ...]:
    global _PRIVATE_TEXT_CACHE
    if _PRIVATE_TEXT_CACHE is not None:
        return _PRIVATE_TEXT_CACHE
    benchmark = load_module("hikaru_asr_benchmark_t03c_privacy", COMPARATOR)
    old, current = validate_manifest_identities(benchmark)
    raws = validate_raw_inventory()
    candidates: set[str] = set()

    def add(value) -> None:
        if not isinstance(value, str):
            return
        normalized = unicodedata.normalize("NFKC", value).strip()
        if normalized:
            candidates.add(normalized)

    for validation in (old, current):
        for case in validation["cases"]:
            reference = case["reference"]
            add(reference.get("text"))
            for segment in reference.get("segments", []):
                add(segment.get("text"))
    for raw in raws.values():
        for sample in raw.get("samples", []):
            for segment in sample.get("segments", []):
                add(segment.get("text"))
    _PRIVATE_TEXT_CACHE = tuple(sorted(candidates, key=lambda value: (-len(value), value)))
    return _PRIVATE_TEXT_CACHE


def validate_publication_privacy(data: dict) -> None:
    forbidden_keys = {"text", "segments", "reference", "speechIntervals", "tokens", "rawAlignmentEntries", "sessionGetterWords"}
    forbidden_values = (str(REPO), str(REPO).replace("\\", "/"), ".asr-benchmark/", "research/local/")
    private_texts = private_text_candidates()

    def scan(value):
        if isinstance(value, dict):
            if forbidden_keys.intersection(value):
                raise CorrectionError("private transcript/alignment field leaked")
            for child in value.values():
                scan(child)
        elif isinstance(value, list):
            for child in value:
                scan(child)
        elif isinstance(value, str):
            if any(marker and marker in value for marker in forbidden_values):
                raise CorrectionError("private or absolute path leaked")
            normalized = unicodedata.normalize("NFKC", value).strip()
            if any(normalized == private or (len(private) >= 8 and private in normalized) for private in private_texts):
                raise CorrectionError("private reference or transcript text leaked")

    scan(data)


def render_markdown(data: dict) -> str:
    lines = [
        "# CrispASR Long-v2 Corrected Supersession", "",
        "Current authority uses manifest `3c05c0eb...` and `long-v2`; archived T03 long-v1 results remain immutable historical provenance.", "",
        "| Route | Case | Status | CER | CPU RTF | Semantic gaps | Excluded vocalizations | Timeline errors | Result |",
        "|---|---|---|---:|---:|---:|---:|---:|---|",
    ]
    for row in data["rows"]:
        cer = "unscored" if row["cer"] is None else f"{row['cer']['cer']:.4f}"
        gaps = "blocked" if row["semanticGapCount"] is None else str(row["semanticGapCount"])
        excluded = "blocked" if row["excludedVocalizationGapCount"] is None else str(row["excludedVocalizationGapCount"])
        timeline = "blocked" if row["timelineErrorCount"] is None else str(row["timelineErrorCount"])
        lines.append(
            f"| `{row['route']}` | `{row['currentCaseId']}` | `{row['status']}` | {cer} | {row['inferenceRtf']:.3f} | {gaps} | {excluded} | {timeline} | `{row['result']}` |"
        )
    lines.extend(["", "## Corrected Dispositions", ""])
    for route in ROUTES:
        lines.append(f"- **{route}:** `{data['routeDispositions'][route]}`.")
    lines.extend([
        "", "## Named Risks And Boundaries", "",
        "- ReazonSpeech remains a text/runtime input with named segmentation/timing risks, not a subtitle-ready route.",
        "- Parakeet retains one oversized top-level segment and fails CER on every completed case.",
        "- Qwen short retains its ForcedAligner timing failure; medium and long-v2 remain validated, unscored `segment-legality-failed` blockers with zero accepted timed output.",
        "- Standalone approved vocalizations remain in CER and are reported separately from semantic gaps.",
        "- No inference or worker build ran. Python legacy remains Release/default; no product route or package changed.",
        "", "## Identity", "",
        f"- Historical manifest: `{data['identity']['historicalManifest']['sha256']}` (`long-v1`, superseded for current authority).",
        f"- Current manifest: `{data['identity']['currentManifest']['sha256']}` (`long-v2`, 681 Dialogue rows).",
        f"- Unchanged long WAV: `{data['identity']['longAudio']['sha256']}`, `{data['identity']['longAudio']['durationMs']}ms`.",
        f"- Shared comparator: `{data['identity']['comparatorSha256']}`.",
        f"- T03 input lock: `{data['identity']['t03InputLockSha256']}`; all nine authoritative rows passed the original compiled identity validator.",
        "", "## Supersession Boundary", "",
        "This report supersedes only current T03 benchmark conclusions. Archived T01/T03 reports and evidence remain byte-identical historical records. T09/T10/T11 still own later backend/product work.",
        "",
    ])
    return "\n".join(lines)


def write_publication(output_json: Path, output_md: Path, validate_compiled: bool = True) -> dict:
    data = build_publication(validate_compiled=validate_compiled)
    json_bytes = (json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    markdown_bytes = render_markdown(data).encode("utf-8")
    for path, content in ((output_json, json_bytes), (output_md, markdown_bytes)):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(content)
        temporary.replace(path)
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-json", type=Path, default=TASK / "research/evidence/crispasr-long-v2-correction.json")
    parser.add_argument("--output-md", type=Path, default=TASK / "research/crispasr-long-v2-correction-report.md")
    args = parser.parse_args()
    write_publication(args.output_json, args.output_md, validate_compiled=True)
    print(f"published deterministic CrispASR correction: {args.output_json} ; {args.output_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
