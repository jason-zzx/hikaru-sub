#!/usr/bin/env python3
"""Re-evaluate frozen native ASR evidence against the Python legacy baseline."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Sequence

REPO_ROOT = Path(__file__).resolve().parents[4]
TASK_ROOT = Path(__file__).resolve().parents[1]
RESEARCH_ROOT = TASK_ROOT / "research"
PROFILE = "python-legacy-cuda-v1"
CASES = ("short-v1", "medium-v1", "long-v2")
SCHEMA_VERSION = 1
KIND = "hikaru-native-asr-legacy-quality-reevaluation"
LOCK_KIND = "hikaru-native-legacy-quality-evidence-lock"
EXPECTED_CANDIDATES = {
    "large-v3-candidate-a": ("faster-whisper/large-v3", "selected-cpu-beam1-no-history", "complete"),
    "kotoba-k2": (
        "kotoba-faster-whisper/kotoba-whisper-v2.0-faster",
        "kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1",
        "complete",
    ),
    "parakeet-p1": ("parakeet/parakeet-tdt_ctc-0.6b-ja", "P1-window15s-native-word-v1", "pending-t12-native-model-manifest"),
    "reazonspeech-r2": (
        "reazonspeech-nemo/reazonspeech-nemo-v2",
        "R2-vad12-pad30-overlap-top-level-v1",
        "pending-t12-native-model-manifest",
    ),
    "qwen-t03c": ("qwen3-asr/qwen3-asr-1.7b", "t03c-corrected-qwen-poc", "pending-t12-native-model-manifest"),
}
EXPECTED_STATUSES = {
    "large-v3-candidate-a": ("completed", "completed", "completed"),
    "kotoba-k2": ("completed", "completed", "completed"),
    "parakeet-p1": ("completed", "completed", "validated-failed"),
    "reazonspeech-r2": ("completed", "completed", "validated-failed"),
    "qwen-t03c": ("completed", "validated-failed", "validated-failed"),
}
EXPECTED_LOCK_METADATA = {
    "large-v3-candidate-a": {
        "oldDisposition": "corrected-large-v3-pass",
        "independentGateDisposition": "pass",
        "ignoredRoot": ".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local",
        "publicationRoles": ("publication", "publication", "candidate-lock", "correction-authority", "correction-lock"),
        "sourceRoles": ("raw", "adapted"),
    },
    "kotoba-k2": {
        "oldDisposition": "accepted-kotoba-algorithm-input",
        "independentGateDisposition": "pass",
        "ignoredRoot": ".trellis/tasks/archive/2026-08/08-05-native-asr-kotoba-compatibility/research/local",
        "publicationRoles": ("publication", "input-lock", "correction-lock"),
        "sourceRoles": ("raw", "adapted"),
    },
    "parakeet-p1": {
        "oldDisposition": "stop-revise",
        "independentGateDisposition": "stop-revise",
        "ignoredRoot": ".trellis/tasks/archive/2026-08/08-13-native-asr-parakeet-reazon/08-13-native-asr-parakeet-reazon/research/local",
        "publicationRoles": ("publication", "input-lock", "raw-index"),
        "sourceRoles": ("raw",),
    },
    "reazonspeech-r2": {
        "oldDisposition": "stop-revise + better-than-r1",
        "independentGateDisposition": "stop-revise",
        "ignoredRoot": ".trellis/tasks/archive/2026-08/08-14-native-asr-reazonspeech-r2/research/local",
        "publicationRoles": ("publication", "input-lock", "raw-index"),
        "sourceRoles": ("raw",),
    },
    "qwen-t03c": {
        "oldDisposition": "stop-revise",
        "independentGateDisposition": "stop-revise",
        "ignoredRoot": ".trellis/tasks/archive/2026-08/07-25-native-asr-crispasr-poc/research/local",
        "publicationRoles": ("correction-authority", "correction-lock", "input-lock"),
        "sourceRoles": ("raw",),
    },
}
EXPECTED_AUTHORITY_PATHS = {
    "baseline": ".trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json",
    "identityManifest": ".trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/model-identity-manifest.json",
    "benchmarkManifest": ".asr-benchmark/manifest.json",
    "benchmarkRunner": "scripts/asr-benchmark.py",
    "legacyPublisher": "scripts/asr-legacy-baseline.py",
}
FORBIDDEN_OUTPUT_KEYS = {
    "text",
    "segments",
    "reference",
    "referenceText",
    "referenceSegments",
    "speechIntervals",
    "rawAlignmentEntries",
    "sessionGetterWords",
    "stderr",
    "errorMessage",
    "audioPath",
    "modelPaths",
}


class EvidenceError(ValueError):
    pass


def _load_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise EvidenceError(f"cannot load shared module: {path.name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


BENCHMARK = _load_module("hikaru_asr_benchmark_native_legacy", REPO_ROOT / "scripts/asr-benchmark.py")
LEGACY = _load_module("hikaru_asr_legacy_native_legacy", REPO_ROOT / "scripts/asr-legacy-baseline.py")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceError(f"cannot read {path.name}: {error}") from error
    if not isinstance(value, dict):
        raise EvidenceError(f"{path.name} root must be an object")
    return value


def repo_path(value: Any, label: str) -> Path:
    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{label} path is required")
    pure = PurePosixPath(value)
    if pure.is_absolute() or ".." in pure.parts or pure.as_posix() != value or re.match(r"^[A-Za-z]:", value) or "\\" in value:
        raise EvidenceError(f"{label} must be a safe repository-relative POSIX path")
    path = (REPO_ROOT / Path(*pure.parts)).resolve()
    try:
        path.relative_to(REPO_ROOT.resolve())
    except ValueError as error:
        raise EvidenceError(f"{label} escapes the repository") from error
    return path


def _is_ignored(path: Path) -> bool:
    result = subprocess.run(
        ["git", "check-ignore", "--quiet", "--", str(path)],
        cwd=REPO_ROOT,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def _require_identity(item: dict[str, Any], label: str) -> Path:
    path = repo_path(item.get("path"), label)
    expected = item.get("sha256")
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise EvidenceError(f"{label} SHA-256 is invalid")
    if not path.is_file():
        raise EvidenceError(f"{label} is missing")
    if sha256_file(path) != expected:
        raise EvidenceError(f"{label} hash drift")
    return path


def validate_lock(lock: dict[str, Any], *, verify_files: bool = True) -> dict[str, Any]:
    if lock.get("schemaVersion") != 1 or lock.get("kind") != LOCK_KIND or lock.get("comparisonProfile") != PROFILE:
        raise EvidenceError("evidence lock schema/profile drift")
    if lock.get("task") != "08-19-native-asr-legacy-quality-reevaluation":
        raise EvidenceError("evidence lock task drift")
    authorities = lock.get("authorities")
    if not isinstance(authorities, dict) or set(authorities) != set(EXPECTED_AUTHORITY_PATHS):
        raise EvidenceError("evidence lock authority inventory drift")
    for role, expected_path in EXPECTED_AUTHORITY_PATHS.items():
        if authorities[role].get("path") != expected_path:
            raise EvidenceError(f"{role} authority path drift")

    candidates = lock.get("candidates")
    if not isinstance(candidates, list) or len(candidates) != len(EXPECTED_CANDIDATES):
        raise EvidenceError("evidence lock must contain exactly five candidates")
    by_kind: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        if not isinstance(candidate, dict):
            raise EvidenceError("candidate lock row must be an object")
        kind = candidate.get("adapterKind")
        if kind in by_kind or kind not in EXPECTED_CANDIDATES:
            raise EvidenceError("candidate adapter inventory is duplicated or unexpected")
        logical_id, candidate_id, mapping = EXPECTED_CANDIDATES[kind]
        metadata = EXPECTED_LOCK_METADATA[kind]
        if (
            candidate.get("logicalModelIdentity") != logical_id
            or candidate.get("candidateId") != candidate_id
            or candidate.get("mappingReadiness") != mapping
            or candidate.get("oldDisposition") != metadata["oldDisposition"]
            or candidate.get("independentGateDisposition") != metadata["independentGateDisposition"]
            or candidate.get("ignoredRoot") != metadata["ignoredRoot"]
        ):
            raise EvidenceError(f"candidate/model/disposition/mapping identity drift: {kind}")
        cases = candidate.get("cases")
        if not isinstance(cases, list) or [row.get("caseId") for row in cases] != list(CASES):
            raise EvidenceError(f"candidate case inventory drift: {kind}")
        if [row.get("expectedStatus") for row in cases] != list(EXPECTED_STATUSES[kind]):
            raise EvidenceError(f"candidate status inventory drift: {kind}")
        ignored_root = repo_path(candidate.get("ignoredRoot"), f"{kind} ignored root")
        publications = candidate.get("publications")
        if not isinstance(publications, list) or tuple(item.get("role") for item in publications) != metadata["publicationRoles"]:
            raise EvidenceError(f"candidate publication inventory drift: {kind}")
        for case in cases:
            sources = case.get("sources")
            if not isinstance(sources, list) or tuple(source.get("role") for source in sources) != metadata["sourceRoles"]:
                raise EvidenceError(f"candidate source roles drift: {kind}/{case.get('caseId')}")
            for source in sources:
                source_path = repo_path(source.get("path"), f"{kind}/{case.get('caseId')} source")
                try:
                    source_path.relative_to(ignored_root)
                except ValueError as error:
                    raise EvidenceError(f"source escapes frozen ignored root: {kind}/{case.get('caseId')}") from error
                if verify_files and not _is_ignored(source_path):
                    raise EvidenceError(f"raw source is not ignored: {kind}/{case.get('caseId')}")
        by_kind[kind] = candidate

    excluded = {row.get("subject") for row in lock.get("excludedScopes", []) if isinstance(row, dict)}
    required_exclusions = {
        "faster-whisper/large-v2", "faster-whisper/tiny", "faster-whisper/base", "faster-whisper/small",
        "faster-whisper/medium", "faster-whisper/large-v3-turbo", "t02-large-v3-fixed", "t02-kotoba-fixed",
        "t06-candidate-b", "t08-kotoba-k1", "R1-window15s-top-level-v1", "t09-development-gpu-speed-rows",
    }
    if excluded != required_exclusions:
        raise EvidenceError("excluded/superseded scope inventory drift")

    identity_items = list(authorities.values()) + [
        item
        for candidate in candidates
        for item in candidate["publications"] + [source for case in candidate["cases"] for source in case["sources"]]
    ]
    identity_paths = [item.get("path") for item in identity_items]
    if len(identity_items) != 43 or len(set(identity_paths)) != 43:
        raise EvidenceError("evidence lock must contain exactly 43 unique path/hash identities")

    if verify_files:
        for role, item in authorities.items():
            _require_identity(item, f"authority {role}")
        for kind, candidate in by_kind.items():
            for index, item in enumerate(candidate["publications"]):
                _require_identity(item, f"{kind} publication {index}")
            for case in candidate["cases"]:
                for index, item in enumerate(case["sources"]):
                    _require_identity(item, f"{kind}/{case['caseId']} source {index}")
    return by_kind


def _baseline_index(baseline: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    if (
        baseline.get("schemaVersion") != 1
        or baseline.get("kind") != LEGACY.BASELINE_KIND
        or baseline.get("comparisonProfile") != PROFILE
        or baseline.get("authorityDisposition") != "complete"
    ):
        raise EvidenceError("Python legacy baseline authority drift")
    rows: dict[tuple[str, str], dict[str, Any]] = {}
    for model in baseline.get("models", []):
        logical_id = model.get("logicalModelIdentity")
        if model.get("cases") and model.get("comparisonProfile") != PROFILE:
            raise EvidenceError("Python baseline model profile drift")
        for row in model.get("cases", []):
            key = (logical_id, row.get("caseId"))
            if key in rows:
                raise EvidenceError("duplicate Python baseline row")
            rows[key] = row
    return rows


def matching_baseline(rows: dict[tuple[str, str], dict[str, Any]], logical_id: str, case_id: str) -> dict[str, Any]:
    row = rows.get((logical_id, case_id))
    if row is None or row.get("caseId") != case_id or row.get("status") != "completed":
        raise EvidenceError(f"matching Python baseline row is missing: {logical_id}/{case_id}")
    return row


def load_authorities(lock: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[tuple[str, str], dict[str, Any]]]:
    authorities = lock["authorities"]
    baseline_path = repo_path(authorities["baseline"]["path"], "baseline")
    manifest_path = repo_path(authorities["identityManifest"]["path"], "identity manifest")
    benchmark_path = repo_path(authorities["benchmarkManifest"]["path"], "benchmark manifest")
    baseline = read_json(baseline_path)
    identity_manifest = read_json(manifest_path)
    validation = BENCHMARK.validate_manifest(benchmark_path, benchmark_path.parent)
    if validation["manifestSha256"] != authorities["benchmarkManifest"]["sha256"]:
        raise EvidenceError("validated benchmark manifest hash drift")
    baseline_authority = baseline.get("authority", {})
    if (
        baseline_authority.get("identityManifestSha256") != authorities["identityManifest"]["sha256"]
        or baseline_authority.get("benchmarkManifestSha256") != authorities["benchmarkManifest"]["sha256"]
        or baseline_authority.get("benchmarkRunnerSha256") != authorities["benchmarkRunner"]["sha256"]
        or baseline_authority.get("publisherSha256") != authorities["legacyPublisher"]["sha256"]
    ):
        raise EvidenceError("Python baseline embedded authority drift")
    profile = LEGACY._profile(identity_manifest)
    if profile.get("benchmarkRunnerSha256") != authorities["benchmarkRunner"]["sha256"]:
        raise EvidenceError("identity manifest comparator authority drift")
    model_index = LEGACY._model_index(identity_manifest)
    for logical_id, _candidate_id, mapping in EXPECTED_CANDIDATES.values():
        model = model_index.get(logical_id)
        if model is None or model.get("comparisonProfile") != PROFILE or tuple(model.get("requiredCases", ())) != CASES:
            raise EvidenceError(f"identity manifest model/case/profile drift: {logical_id}")
        expected_mapping = "complete" if LEGACY._mapping_complete(model) else "pending-t12-native-model-manifest"
        if mapping != expected_mapping:
            raise EvidenceError(f"lock mapping readiness differs from identity manifest: {logical_id}")
    return baseline, identity_manifest, validation, _baseline_index(baseline)


def _source(candidate: dict[str, Any], case: dict[str, Any], role: str) -> Path:
    matches = [item for item in case["sources"] if item.get("role") == role]
    if len(matches) != 1:
        raise EvidenceError(f"expected one {role} source for {candidate['adapterKind']}/{case['caseId']}")
    return repo_path(matches[0]["path"], f"{candidate['adapterKind']}/{case['caseId']} {role}")


def _publication(candidate: dict[str, Any], role: str) -> dict[str, Any]:
    matches = [item for item in candidate["publications"] if item.get("role") == role]
    if len(matches) != 1:
        raise EvidenceError(f"expected one {role} publication for {candidate['adapterKind']}")
    return read_json(repo_path(matches[0]["path"], f"{candidate['adapterKind']} {role}"))


def _segments(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise EvidenceError(f"{label} has no accepted segments")
    result = []
    for item in value:
        if not isinstance(item, dict):
            raise EvidenceError(f"{label} segment is invalid")
        start, end, text = item.get("startMs"), item.get("endMs"), item.get("text")
        if not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int) or isinstance(end, bool) or not isinstance(text, str):
            raise EvidenceError(f"{label} segment fields are invalid")
        result.append({"startMs": start, "endMs": end, "text": text})
    return result


def _case_truth(validation: dict[str, Any], case_id: str) -> dict[str, Any]:
    matches = [case for case in validation["cases"] if case["id"] == case_id]
    if len(matches) != 1:
        raise EvidenceError(f"authoritative benchmark case missing: {case_id}")
    return matches[0]


def _validate_corpus(raw_audio: dict[str, Any], truth: dict[str, Any], duration: Any, label: str) -> None:
    if raw_audio.get("sha256") != truth["audioSha256"] or duration != truth["durationMs"]:
        raise EvidenceError(f"{label} corpus identity drift")


def _large_v3(candidate: dict[str, Any], case_lock: dict[str, Any], truth: dict[str, Any]) -> dict[str, Any]:
    raw = read_json(_source(candidate, case_lock, "raw"))
    adapted = read_json(_source(candidate, case_lock, "adapted"))
    identity = candidate["identity"]
    source_case = case_lock["sourceCaseId"]
    model_id, revision = str(identity["model"]).rsplit("@", 1)
    if (
        raw.get("kind") != identity["rawKind"] or raw.get("candidate") != candidate["candidateId"]
        or raw.get("caseId") != source_case or raw.get("engine") != identity["engine"]
        or raw.get("status") != "completed" or raw.get("candidateLockSha256") != identity["candidateLockSha256"]
        or raw.get("runtime", {}).get("device") != identity["device"] or raw.get("runtime", {}).get("computeType") != "int8"
        or raw.get("model", {}).get("id") != model_id or raw.get("model", {}).get("revision") != revision
    ):
        raise EvidenceError(f"large-v3 candidate identity drift: {case_lock['caseId']}")
    _validate_corpus(raw.get("audio", {}), truth, raw.get("audio", {}).get("durationMs"), "large-v3")
    samples = raw.get("samples")
    expected_count = 4 if case_lock["caseId"] == "short-v1" else 1
    expected_run_kinds = ["cold", *("warm" for _ in range(expected_count - 1))]
    if (
        not isinstance(samples, list) or len(samples) != expected_count
        or [sample.get("runKind") for sample in samples] != expected_run_kinds
        or any(sample.get("status") != "completed" for sample in samples)
    ):
        raise EvidenceError("large-v3 sample contract drift")
    adapted_case = (adapted.get("cases") or [{}])[0]
    if (
        adapted.get("kind") != BENCHMARK.RESULT_KIND or adapted.get("candidateKind") != "native-candidate"
        or adapted.get("engine") != identity["engine"] or adapted.get("model") != identity["model"]
        or adapted.get("device") != identity["device"] or adapted.get("runtime", {}).get("candidateLockSha256") != identity["candidateLockSha256"]
        or adapted_case.get("caseId") != source_case or adapted_case.get("audioSha256") != truth["audioSha256"]
    ):
        raise EvidenceError("large-v3 adapted identity drift")
    adapted_samples = adapted_case.get("samples")
    if not isinstance(adapted_samples, list) or len(adapted_samples) != len(samples):
        raise EvidenceError("large-v3 adapted sample contract drift")
    for raw_sample, adapted_sample in zip(samples, adapted_samples, strict=True):
        segments = _segments(raw_sample.get("segments"), "large-v3 raw")
        if segments != _segments(adapted_sample.get("segments"), "large-v3 adapted"):
            raise EvidenceError("large-v3 raw/adapted segment drift")
        if case_lock["caseId"] != "long-v2":
            metrics = BENCHMARK._sample_metrics(
                truth["reference"]["text"], truth["reference"]["segments"], truth["reference"]["speechIntervals"],
                segments, truth["durationMs"], identity["timestampProvenance"], identity["engine"],
            )
            for field in ("cer", "timeline", "missingSpeechRegions", "timingAccuracy"):
                if adapted_sample.get(field) != metrics.get(field):
                    raise EvidenceError(f"large-v3 adapted metric drift: {field}")
    if case_lock["caseId"] == "long-v2":
        correction = _publication(candidate, "correction-authority")
        matches = [row for row in correction.get("rows", []) if row.get("candidateId") == "t06-selected-a" and row.get("caseId") == "long-v2"]
        expected = case_lock.get("correctionAuthority", {})
        metrics = BENCHMARK._sample_metrics(
            truth["reference"]["text"], truth["reference"]["segments"], truth["reference"]["speechIntervals"],
            _segments(samples[0]["segments"], "large-v3 long"), truth["durationMs"], identity["timestampProvenance"], identity["engine"],
        )
        measured = matches[0].get("measurements", {}) if len(matches) == 1 else {}
        if (
            len(matches) != 1 or matches[0].get("sourceCaseId") != expected.get("rowSourceCaseId")
            or matches[0].get("ignoredRawSha256") != expected.get("rowIgnoredRawSha256")
            or matches[0].get("allApplicableGatesPass") is not expected.get("rowAllApplicableGatesPass")
            or measured.get("cer") != metrics["cer"]["cer"]
            or measured.get("semanticSpeechGapsAtLeast1500Ms") != len(metrics["missingSpeechRegions"])
            or measured.get("segmentCount") != metrics["timeline"]["segmentCount"]
        ):
            raise EvidenceError("large-v3 long-v2 correction authority/metric drift")
    return {"status": "completed", "segments": _segments(samples[0]["segments"], "large-v3"), "timestampProvenance": identity["timestampProvenance"]}


def _kotoba(candidate: dict[str, Any], case_lock: dict[str, Any], truth: dict[str, Any]) -> dict[str, Any]:
    raw = read_json(_source(candidate, case_lock, "raw"))
    adapted = read_json(_source(candidate, case_lock, "adapted"))
    identity = candidate["identity"]
    model_id, revision = str(identity["model"]).rsplit("@", 1)
    if (
        raw.get("kind") != identity["rawKind"] or raw.get("candidate") != candidate["candidateId"]
        or raw.get("caseId") != case_lock["sourceCaseId"] or raw.get("engine") != identity["engine"]
        or raw.get("status") != "completed" or raw.get("inputLockSha256") != identity["inputLockSha256"]
        or raw.get("runtime", {}).get("resolvedDevice") != identity["device"] or raw.get("runtime", {}).get("computeType") != "float16"
        or raw.get("model", {}).get("id") != model_id or raw.get("model", {}).get("revision") != revision
    ):
        raise EvidenceError(f"Kotoba K2 identity drift: {case_lock['caseId']}")
    _validate_corpus(raw.get("audio", {}), truth, raw.get("audio", {}).get("durationMs"), "Kotoba K2")
    samples = raw.get("samples")
    expected_count = 4 if case_lock["caseId"] == "short-v1" else 1
    expected_run_kinds = ["cold", *("warm" for _ in range(expected_count - 1))]
    if (
        not isinstance(samples, list) or len(samples) != expected_count
        or [sample.get("runKind") for sample in samples] != expected_run_kinds
        or any(sample.get("status") != "completed" for sample in samples)
    ):
        raise EvidenceError("Kotoba K2 sample contract drift")
    adapted_case = adapted.get("case", {})
    if (
        adapted.get("kind") != identity["adaptedKind"] or adapted.get("candidateId") != candidate["candidateId"]
        or adapted.get("engine") != identity["engine"] or adapted.get("model") != identity["model"]
        or adapted.get("device") != identity["device"] or adapted.get("manifest", {}).get("sha256") != truth["_manifestSha256"]
        or adapted_case.get("caseId") != case_lock["caseId"] or adapted_case.get("audioSha256") != truth["audioSha256"]
        or adapted_case.get("assSha256") != truth["assSha256"] or adapted_case.get("durationMs") != truth["durationMs"]
    ):
        raise EvidenceError("Kotoba K2 adapted identity drift")
    adapted_samples = adapted_case.get("samples")
    if not isinstance(adapted_samples, list) or len(adapted_samples) != len(samples):
        raise EvidenceError("Kotoba K2 adapted sample contract drift")
    for raw_sample, adapted_sample in zip(samples, adapted_samples, strict=True):
        segments = _segments(raw_sample.get("segments"), "Kotoba K2 raw")
        metrics = BENCHMARK._sample_metrics(
            truth["reference"]["text"], truth["reference"]["segments"], truth["reference"]["speechIntervals"],
            segments, truth["durationMs"], identity["timestampProvenance"], identity["engine"],
        )
        timeline_errors = sum(int(metrics["timeline"].get(field, 0)) for field in (
            "afterAudioEndCount", "emptyTextCount", "negativeStartCount", "nonMonotonicCount", "nonPositiveDurationCount"
        ))
        expected_metrics = {
            "cer": metrics["cer"]["cer"],
            "timelineErrors": timeline_errors,
            "semanticGapCount": len(metrics["missingSpeechRegions"]),
            "excludedVocalizationGapCount": len(metrics["excludedNonSemanticVocalizationRegions"]),
        }
        if adapted_sample.get("metrics") != expected_metrics:
            raise EvidenceError("Kotoba K2 adapted metric drift")
    publication = _publication(candidate, "publication")
    if publication.get("candidateId") != candidate["candidateId"] or publication.get("disposition") != candidate["oldDisposition"]:
        raise EvidenceError("Kotoba K2 publication candidate drift")
    return {"status": "completed", "segments": _segments(samples[0]["segments"], "Kotoba K2"), "timestampProvenance": identity["timestampProvenance"]}


def _parakeet(candidate: dict[str, Any], case_lock: dict[str, Any], truth: dict[str, Any]) -> dict[str, Any]:
    raw = read_json(_source(candidate, case_lock, "raw"))
    identity = candidate["identity"]
    expected_status = case_lock["expectedStatus"]
    if (
        raw.get("schema") != identity["schema"] or raw.get("candidateId") != candidate["candidateId"]
        or raw.get("caseId") != case_lock["caseId"] or raw.get("engine") != identity["engine"]
        or raw.get("device") != identity["device"] or raw.get("status") != expected_status
        or raw.get("runKind") != case_lock.get("runKind") or raw.get("repeatIndex") != 0
        or raw.get("resolvedBackend") != "parakeet" or raw.get("model") != identity["model"]
        or raw.get("worker", {}).get("sha256") != identity["workerSha256"]
        or raw.get("runner", {}).get("sha256") != identity["runnerSha256"]
        or raw.get("library", {}).get("sha256") != identity["librarySha256"]
        or raw.get("inputLock", {}).get("sha256") != identity["inputLockSha256"]
    ):
        raise EvidenceError(f"Parakeet P1 identity drift: {case_lock['caseId']}")
    _validate_corpus(raw.get("audio", {}), truth, truth["durationMs"], "Parakeet P1")
    publication = _publication(candidate, "publication")
    published = publication.get("results", {}).get("parakeet", {})
    published_cases = {row.get("caseId"): row for row in published.get("cases", [])}
    if (
        published.get("identity", {}).get("candidateId") != candidate["candidateId"]
        or published.get("identity", {}).get("model") != identity["model"]
        or published_cases.get(case_lock["caseId"], {}).get("status") != expected_status
    ):
        raise EvidenceError("Parakeet P1 publication identity/status drift")
    if expected_status == "completed":
        if raw.get("errorCode") is not None:
            raise EvidenceError("Parakeet completed row contains a failure")
        return {"status": "completed", "segments": _segments(raw.get("finalSegments"), "Parakeet P1"), "timestampProvenance": identity["timestampProvenance"]}
    failure = case_lock["failure"]
    if raw.get("errorCode") != failure["errorCode"] or raw.get("finalSegments") != [] or not raw.get("sourceSegments"):
        raise EvidenceError("Parakeet structured failure drift")
    return {"status": "validated-failed", "failure": copy.deepcopy(failure)}


def _reazon_failure(raw: dict[str, Any]) -> dict[str, Any]:
    error = raw.get("error") or {}
    match = re.fullmatch(r"CrispASR final result is invalid: segment=(\d+) startMs=(\d+) endMs=(\d+) durationMs=(\d+)", str(error.get("message", "")))
    if match is None:
        raise EvidenceError("ReazonSpeech failure trace is malformed")
    segment_index, local_start, local_end, window_duration = map(int, match.groups())
    result = {
        "subtype": "zero_duration_top_level_result" if local_start == local_end else "other_top_level_result_invalid",
        "resultTraceSha256": hashlib.sha256(
            f"segmentIndex={segment_index}\nlocalStartMs={local_start}\nlocalEndMs={local_end}\nwindowDurationMs={window_duration}".encode("utf-8")
        ).hexdigest(),
        "segmentIndex": segment_index,
        "localStartMs": local_start,
        "localEndMs": local_end,
        "windowStartMs": raw.get("vadWindows", [])[raw.get("shape", {}).get("completedTranscribeCalls", -1)].get("startMs") if raw.get("vadWindows") else None,
        "windowEndMs": raw.get("vadWindows", [])[raw.get("shape", {}).get("completedTranscribeCalls", -1)].get("endMs") if raw.get("vadWindows") else None,
        "zeroBasedWindowIndex": raw.get("shape", {}).get("completedTranscribeCalls"),
    }
    result["fingerprintSha256"] = canonical_hash({key: value for key, value in result.items() if key != "fingerprintSha256"})
    return result


def _reazon(candidate: dict[str, Any], case_lock: dict[str, Any], truth: dict[str, Any]) -> dict[str, Any]:
    raw = read_json(_source(candidate, case_lock, "raw"))
    identity = candidate["identity"]
    expected_status = case_lock["expectedStatus"]
    raw_identity = raw.get("identity", {})
    if (
        raw.get("schema") != identity["schema"] or raw.get("candidateId") != candidate["candidateId"]
        or raw.get("caseId") != case_lock["caseId"] or raw.get("status") != expected_status
        or raw.get("runKind") != case_lock.get("runKind") or raw.get("repeatIndex") != 0
        or raw.get("request", {}).get("backend") != "crispasr"
        or raw.get("request", {}).get("engine") != identity["engine"]
        or raw.get("request", {}).get("device") != identity["device"]
        or raw.get("algorithm", {}).get("candidateId") != candidate["candidateId"]
        or raw_identity.get("device", {}).get("index") != 0 or raw_identity.get("model") != identity["model"]
        or raw_identity.get("worker", {}).get("sha256") != identity["workerSha256"]
        or raw_identity.get("runner", {}).get("sha256") != identity["runnerSha256"]
        or raw_identity.get("inputLock", {}).get("sha256") != identity["inputLockSha256"]
        or raw_identity.get("manifest", {}).get("sha256") != truth.get("_manifestSha256")
    ):
        raise EvidenceError(f"ReazonSpeech R2 identity drift: {case_lock['caseId']}")
    _validate_corpus(raw_identity.get("audio", {}), truth, raw.get("durationMs"), "ReazonSpeech R2")
    publication = _publication(candidate, "publication")
    published_cases = {row.get("caseId"): row for row in publication.get("cases", [])}
    if (
        publication.get("candidateId") != candidate["candidateId"]
        or publication.get("identity", {}).get("model") != identity["model"]
        or published_cases.get(case_lock["caseId"], {}).get("status") != expected_status
    ):
        raise EvidenceError("ReazonSpeech R2 publication identity/status drift")
    if expected_status == "completed":
        if raw.get("error") is not None:
            raise EvidenceError("ReazonSpeech completed row contains a failure")
        return {"status": "completed", "segments": _segments(raw.get("finalSegments"), "ReazonSpeech R2"), "timestampProvenance": identity["timestampProvenance"]}
    expected = case_lock["failure"]
    actual_failure = _reazon_failure(raw)
    if (
        raw.get("error", {}).get("code") != expected["errorCode"] or raw.get("error", {}).get("taxonomy") != expected["failureClass"]
        or raw.get("finalSegments") != [] or actual_failure != expected["resultFailure"]
        or raw.get("shape", {}).get("attemptedTranscribeCalls") != expected["attemptedWindowCount"]
        or raw.get("shape", {}).get("completedTranscribeCalls") != expected["completedWindowCount"]
        or raw.get("timings", {}).get("attemptedThroughMs") != expected["attemptedThroughMs"]
    ):
        raise EvidenceError("ReazonSpeech structured failure/fingerprint drift")
    return {
        "status": "validated-failed",
        "failure": {
            "errorCode": expected["errorCode"],
            "failureClass": expected["failureClass"],
            "resultFailure": copy.deepcopy(expected["resultFailure"]),
            "attemptedWindowCount": expected["attemptedWindowCount"],
            "completedWindowCount": expected["completedWindowCount"],
            "attemptedThroughMs": expected["attemptedThroughMs"],
        },
    }


def _qwen(candidate: dict[str, Any], case_lock: dict[str, Any], truth: dict[str, Any]) -> dict[str, Any]:
    raw = read_json(_source(candidate, case_lock, "raw"))
    identity = candidate["identity"]
    expected_status = case_lock["expectedStatus"]
    expected_raw_status = "completed" if expected_status == "completed" else "failed"
    identities = raw.get("identities", {})
    if (
        raw.get("kind") != identity["rawKind"] or raw.get("engine") != identity["engine"]
        or raw.get("device") != identity["device"] or raw.get("status") != expected_raw_status
        or identities.get("case", {}).get("caseId") != case_lock["sourceCaseId"]
        or identities.get("case", {}).get("audio", {}).get("sha256") != truth["audioSha256"]
        or raw.get("durationMs") != truth["durationMs"]
        or identities.get("inputLock", {}).get("sha256") != identity["inputLockSha256"]
        or identities.get("primaryModel", {}).get("engine") != "qwen3-asr"
        or identities.get("alignerModel", {}).get("role") != "aligner"
    ):
        raise EvidenceError(f"Qwen T03C identity drift: {case_lock['caseId']}")
    correction = _publication(candidate, "correction-authority")
    correction_rows = {row.get("rowId"): row for row in correction.get("rows", [])}
    correction_row = correction_rows.get(case_lock["correctionRow"]["rowId"], {})
    correction_models = {
        item.get("role"): item for item in correction.get("identity", {}).get("models", [])
        if item.get("engine") == "qwen3-asr"
    }
    if (
        correction_row.get("status") != case_lock["correctionRow"]["status"]
        or correction_row.get("rawSha256") != case_lock["sources"][0]["sha256"]
        or identities.get("primaryModel", {}).get("sha256") != correction_models.get("primary", {}).get("sha256")
        or identities.get("alignerModel", {}).get("sha256") != correction_models.get("aligner", {}).get("sha256")
    ):
        raise EvidenceError("Qwen correction row/model/companion drift")
    samples = raw.get("samples")
    expected_count = 4 if case_lock["caseId"] == "short-v1" else 1
    expected_run_kinds = ["cold", *("warm" for _ in range(expected_count - 1))]
    if not isinstance(samples, list) or len(samples) != expected_count or [sample.get("runKind") for sample in samples] != expected_run_kinds:
        raise EvidenceError("Qwen sample trace/run-role drift")
    if expected_status == "completed":
        if any(sample.get("status") != "completed" or sample.get("timestampProvenance") != "forced-aligner" for sample in samples):
            raise EvidenceError("Qwen completed timing provenance drift")
        return {"status": "completed", "segments": _segments(samples[0].get("segments"), "Qwen T03C"), "timestampProvenance": "forced-aligner"}
    expected = case_lock["failure"]
    sample = samples[0]
    if (
        raw.get("failure", {}).get("code") != expected["errorCode"]
        or raw.get("failure", {}).get("acceptedTimedSegmentCount") != expected["acceptedTimedSegmentCount"]
        or sample.get("status") != "failed" or sample.get("segments") != []
        or sample.get("timestampProvenance") != "forced-aligner"
    ):
        raise EvidenceError("Qwen failed-row promotion or provenance drift")
    return {"status": "validated-failed", "failure": copy.deepcopy(expected), "timestampProvenance": "forced-aligner"}


def adapt_case(candidate: dict[str, Any], case_lock: dict[str, Any], validation: dict[str, Any]) -> dict[str, Any]:
    truth = copy.deepcopy(_case_truth(validation, case_lock["caseId"]))
    truth["_manifestSha256"] = validation["manifestSha256"]
    kind = candidate["adapterKind"]
    if kind == "large-v3-candidate-a":
        return _large_v3(candidate, case_lock, truth)
    if kind == "kotoba-k2":
        return _kotoba(candidate, case_lock, truth)
    if kind == "parakeet-p1":
        return _parakeet(candidate, case_lock, truth)
    if kind == "reazonspeech-r2":
        return _reazon(candidate, case_lock, truth)
    if kind == "qwen-t03c":
        return _qwen(candidate, case_lock, truth)
    raise EvidenceError(f"unsupported historical adapter: {kind}")


def recompute_quality(validation: dict[str, Any], logical_id: str, case_id: str, adapted: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    truth = _case_truth(validation, case_id)
    engine = logical_id.split("/", 1)[0]
    metrics = BENCHMARK._sample_metrics(
        truth["reference"]["text"],
        truth["reference"]["segments"],
        truth["reference"]["speechIntervals"],
        copy.deepcopy(adapted["segments"]),
        truth["durationMs"],
        adapted.get("timestampProvenance", "unknown"),
        engine,
    )
    quality = LEGACY._quality(metrics, qwen=logical_id.startswith("qwen3-asr/"))
    diagnostics = {
        "timeline": metrics["timeline"],
        "timestampProvenance": metrics["timestampProvenance"],
        "excludedNonSemanticVocalizationGapCount": len(metrics["excludedNonSemanticVocalizationRegions"]),
    }
    return quality, diagnostics


def compare_quality(baseline_quality: dict[str, Any], native_quality: dict[str, Any], *, qwen: bool) -> list[dict[str, Any]]:
    compared = []
    for metric, _direction in LEGACY.QUALITY_METRICS:
        item = LEGACY._compare_value(metric, baseline_quality.get(metric), native_quality.get(metric))
        item["provenance"] = {"baseline": "python-legacy-cuda-v1", "native": "shared-t01-recomputed-historical-native"}
        compared.append(item)
    if qwen:
        baseline_timing = baseline_quality.get("qwenForcedAlignerTiming") or {}
        native_timing = native_quality.get("qwenForcedAlignerTiming") or {}
        for metric, field in (
            ("qwenForcedAlignerMedianStartErrorMs", "medianStartErrorMs"),
            ("qwenForcedAlignerP95StartErrorMs", "p95StartErrorMs"),
        ):
            provenance = {"baseline": baseline_timing.get("provenance", "unknown"), "native": native_timing.get("provenance", "unknown")}
            if not baseline_timing.get("eligible") or not native_timing.get("eligible"):
                compared.append({
                    "metric": metric,
                    "direction": "lower-or-equal",
                    "baseline": baseline_timing.get(field),
                    "native": native_timing.get(field),
                    "delta": None,
                    "disposition": "unscored",
                    "provenance": provenance,
                    "reason": "ForcedAligner timing provenance is not eligible on both rows",
                })
            else:
                item = LEGACY._compare_value(metric, baseline_timing.get(field), native_timing.get(field))
                item["provenance"] = provenance
                compared.append(item)
    return compared


def _observed_disposition(case_rows: list[dict[str, Any]]) -> str:
    if any(row["slotStatus"] in {"validated-failed", "unaccepted", "invalid"} for row in case_rows):
        return "stop-revise"
    dispositions = [metric["disposition"] for row in case_rows for metric in row.get("metrics", [])]
    if not dispositions:
        return "unscored"
    if "stop-revise" in dispositions:
        return "stop-revise"
    if "unscored" in dispositions:
        return "baseline-incomplete"
    return "qualified"


def summarize_model(candidate: dict[str, Any], case_rows: list[dict[str, Any]], mapping_complete: bool) -> dict[str, Any]:
    logical_id = candidate["logicalModelIdentity"]
    observed = _observed_disposition(case_rows)
    return {
        "logicalModelIdentity": logical_id,
        "candidateId": candidate["candidateId"],
        "adapterKind": candidate["adapterKind"],
        "oldDisposition": candidate["oldDisposition"],
        "observedMetricDisposition": observed,
        "subtitleQualityDisposition": observed if mapping_complete else "baseline-incomplete",
        "nativeEvidenceDisposition": "validated-failure" if any(row["slotStatus"] == "validated-failed" for row in case_rows) else "complete",
        "independentGateDisposition": candidate["independentGateDisposition"],
        "mappingReadiness": candidate["mappingReadiness"],
        "releaseEligibility": "not-decided-by-this-task",
        "whisperFamilyDisposition": "blocked-pending-large-v2-anchor" if logical_id == "faster-whisper/large-v3" else "not-applicable",
        "cases": case_rows,
    }


def build_publication(lock_path: Path) -> dict[str, Any]:
    lock = read_json(lock_path)
    candidates = validate_lock(lock, verify_files=True)
    baseline, identity_manifest, validation, baseline_rows = load_authorities(lock)
    model_manifest = LEGACY._model_index(identity_manifest)
    slots = []
    models = []
    for kind in EXPECTED_CANDIDATES:
        candidate = candidates[kind]
        logical_id = candidate["logicalModelIdentity"]
        case_rows = []
        for case_lock in candidate["cases"]:
            case_id = case_lock["caseId"]
            baseline_row = matching_baseline(baseline_rows, logical_id, case_id)
            adapted = adapt_case(candidate, case_lock, validation)
            raw_sha = next(item["sha256"] for item in case_lock["sources"] if item["role"] == "raw")
            base = {
                "logicalModelIdentity": logical_id,
                "candidateId": candidate["candidateId"],
                "caseId": case_id,
                "comparisonProfile": PROFILE,
                "expectedStatus": case_lock["expectedStatus"],
                "rawEvidenceSha256": raw_sha,
                "baselineRawResultSha256": baseline_row["rawResultSha256"],
            }
            if adapted["status"] != "completed":
                row = {
                    **base,
                    "slotStatus": adapted["status"],
                    "observedMetricDisposition": "unscored",
                    "subtitleQualityDisposition": "unscored",
                    "metrics": [],
                    "failure": adapted["failure"],
                }
            else:
                native_quality, diagnostics = recompute_quality(validation, logical_id, case_id, adapted)
                metrics = compare_quality(baseline_row["quality"], native_quality, qwen=logical_id.startswith("qwen3-asr/"))
                disposition = "stop-revise" if any(item["disposition"] == "stop-revise" for item in metrics) else (
                    "baseline-incomplete" if any(item["disposition"] == "unscored" for item in metrics) else "qualified"
                )
                row = {
                    **base,
                    "slotStatus": "completed-comparison",
                    "observedMetricDisposition": disposition,
                    "subtitleQualityDisposition": disposition if candidate["mappingReadiness"] == "complete" else "baseline-incomplete",
                    "metrics": metrics,
                    "nativeQuality": native_quality,
                    "structuralDiagnostics": diagnostics,
                }
            case_rows.append(row)
            slots.append({key: row[key] for key in (
                "logicalModelIdentity", "candidateId", "caseId", "slotStatus", "observedMetricDisposition", "subtitleQualityDisposition"
            )})
        models.append(summarize_model(candidate, case_rows, LEGACY._mapping_complete(model_manifest[logical_id])))
    if len(slots) != 15 or len({(row["logicalModelIdentity"], row["caseId"]) for row in slots}) != 15:
        raise EvidenceError("expected model/case slot matrix is incomplete or duplicated")
    publication = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": KIND,
        "comparisonProfile": PROFILE,
        "generatedAt": baseline.get("generatedAt"),
        "authority": {
            "baselineSha256": lock["authorities"]["baseline"]["sha256"],
            "identityManifestSha256": lock["authorities"]["identityManifest"]["sha256"],
            "benchmarkManifestSha256": validation["manifestSha256"],
            "benchmarkRunnerSha256": lock["authorities"]["benchmarkRunner"]["sha256"],
            "legacyPublisherSha256": lock["authorities"]["legacyPublisher"]["sha256"],
            "nativeEvidenceLockSha256": sha256_file(lock_path),
            "publisherSha256": sha256_file(Path(__file__).resolve()),
            "corpusId": validation["manifest"]["corpusId"],
        },
        "candidateInventory": [
            {
                "logicalModelIdentity": candidate["logicalModelIdentity"],
                "candidateId": candidate["candidateId"],
                "adapterKind": candidate["adapterKind"],
                "oldDisposition": candidate["oldDisposition"],
                "mappingReadiness": candidate["mappingReadiness"],
                "device": candidate["identity"].get("device"),
                "engine": candidate["identity"].get("engine"),
                "identitySha256": canonical_hash(candidate["identity"]),
                "publicationSha256": [item["sha256"] for item in candidate["publications"]],
                "rawEvidenceSha256": [next(source["sha256"] for source in case["sources"] if source["role"] == "raw") for case in candidate["cases"]],
            }
            for candidate in candidates.values()
        ],
        "expectedSlots": slots,
        "models": models,
        "qualityComparisonContract": {
            "key": ["logicalModelIdentity", "caseId", "comparisonProfile"],
            "direction": "lower-or-equal",
            "metrics": [metric for metric, _ in LEGACY.QUALITY_METRICS] + [
                "qwenForcedAlignerMedianStartErrorMs", "qwenForcedAlignerP95StartErrorMs"
            ],
            "reduction": "each completed historical native row is recomputed from private WAV+ASS truth through scripts/asr-benchmark.py; no case/model average",
        },
        "independentAbsoluteGates": list(LEGACY.ABSOLUTE_GATES),
        "limitations": [
            "Historical archived artifacts remain immutable and no native inference was run.",
            "Parakeet, ReazonSpeech, and Qwen native artifact/companion mappings remain pending T12; their identity-aware subtitle disposition is baseline-incomplete.",
            "Validated native failures retain failure provenance and receive no synthetic CER, gap, or timing metrics.",
            "Large-v3 is only one Whisper anchor; missing large-v2 native qualification keeps the Whisper family blocked.",
            "Qwen product grouping/timeline policy remains owned by T11; runtime packs, device qualification, and release eligibility remain owned by T14/T15/T18.",
            "The authoritative corpus still lacks low-volume coverage.",
        ],
        "downstreamHandoff": {
            "productionRouteChanged": False,
            "historicalArtifactsRewritten": False,
            "releaseEligibility": "not-decided-by-this-task",
            "t11Boundary": "Qwen grouping/timeline productization remains pending",
            "t12Boundary": "formal native model and companion mappings remain pending where marked",
            "t14T15T18Boundary": "runtime packs, device qualification, and release cutover remain independent",
        },
    }
    privacy_scan(publication)
    return publication


def privacy_scan(value: Any) -> None:
    def visit(item: Any) -> None:
        if isinstance(item, dict):
            leaked = FORBIDDEN_OUTPUT_KEYS.intersection(item)
            if leaked:
                raise EvidenceError(f"sanitized output contains private fields: {', '.join(sorted(leaked))}")
            for child in item.values():
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)
        elif isinstance(item, str):
            if BENCHMARK.contains_machine_absolute_path(item):
                raise EvidenceError("sanitized output contains a machine absolute path")
            lowered = item.lower()
            if "research/local/" in lowered or ".asr-benchmark/" in lowered:
                raise EvidenceError("sanitized output contains a private local path")
    visit(value)


def _fmt(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.4f}"
    return str(value)


def render_markdown(publication: dict[str, Any]) -> str:
    lines = [
        "# Native ASR Legacy-Relative Quality Re-evaluation",
        "",
        "> Deterministically generated from `native-asr-legacy-quality-reevaluation.json`. This is a historical-evidence quality reassessment, not production qualification.",
        "",
        f"- Comparison profile: `{publication['comparisonProfile']}`",
        f"- Benchmark manifest SHA-256: `{publication['authority']['benchmarkManifestSha256']}`",
        "- Native inference rerun: **none**",
        "- Release eligibility: `not-decided-by-this-task`",
        "",
        "## Model Summary",
        "",
        "| Logical model | Frozen candidate | Old disposition | Observed relative metrics | Identity-aware subtitle quality | Native evidence | Independent gates |",
        "|---|---|---|---|---|---|---|",
    ]
    for model in publication["models"]:
        lines.append(
            f"| `{model['logicalModelIdentity']}` | `{model['candidateId']}` | `{model['oldDisposition']}` | "
            f"`{model['observedMetricDisposition']}` | `{model['subtitleQualityDisposition']}` | "
            f"`{model['nativeEvidenceDisposition']}` | `{model['independentGateDisposition']}` |"
        )
    lines += ["", "## Per-case Metrics", ""]
    for model in publication["models"]:
        lines += [f"### `{model['logicalModelIdentity']}`", ""]
        for row in model["cases"]:
            lines.append(
                f"#### `{row['caseId']}` — `{row['slotStatus']}` / observed `{row['observedMetricDisposition']}` / identity-aware `{row['subtitleQualityDisposition']}`"
            )
            lines.append("")
            if row["slotStatus"] != "completed-comparison":
                failure = row["failure"]
                lines.append(f"Validated native failure: `{failure.get('errorCode')}` (`{failure.get('failureClass', 'candidate-caused-structured-failure')}`). No CER, gap, or timing metric was synthesized.")
                lines.append("")
                continue
            lines += [
                "| Metric | Python | Native | Delta | Direction | Disposition | Provenance |",
                "|---|---:|---:|---:|---|---|---|",
            ]
            for metric in row["metrics"]:
                provenance = metric.get("provenance", {})
                lines.append(
                    f"| `{metric['metric']}` | {_fmt(metric['baseline'])} | {_fmt(metric['native'])} | {_fmt(metric['delta'])} | "
                    f"`{metric['direction']}` | `{metric['disposition']}` | `{provenance.get('baseline')}` / `{provenance.get('native')}` |"
                )
            lines.append("")
    lines += ["## Boundaries And Limitations", ""]
    for limitation in publication["limitations"]:
        lines.append(f"- {limitation}")
    lines += ["", "No production route, worker, Tauri/React code, installer, runtime pack, model downloader, or archived evidence was changed.", ""]
    return "\n".join(lines)


def render_handoff(publication: dict[str, Any]) -> str:
    lines = [
        "# Native ASR Legacy Quality Handoff",
        "",
        f"Authority: `research/evidence/native-asr-legacy-quality-reevaluation.json` (`{publication['authority']['nativeEvidenceLockSha256']}` lock).",
        "",
        "| Model | Observed relative metrics | Identity-aware subtitle quality | Evidence | Independent gate |",
        "|---|---|---|---|---|",
    ]
    for model in publication["models"]:
        lines.append(
            f"| `{model['logicalModelIdentity']}` | `{model['observedMetricDisposition']}` | `{model['subtitleQualityDisposition']}` | "
            f"`{model['nativeEvidenceDisposition']}` | `{model['independentGateDisposition']}` |"
        )
    lines += [
        "",
        "- Large-v3 does not unlock Whisper: large-v2 remains missing as an independently qualified anchor.",
        "- Parakeet, ReazonSpeech, and Qwen remain identity-aware `baseline-incomplete` until T12 freezes native model/companion mappings; their existing structural failures remain blocking.",
        "- Qwen T11 grouping/timeline productization and T14/T15/T18 runtime/device/release gates are unchanged.",
        "- This handoff changes no production route and does not rewrite archived conclusions.",
        "",
    ]
    return "\n".join(lines)


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = __import__("tempfile").mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise


def publish(lock_path: Path, output_json: Path, output_markdown: Path, output_handoff: Path) -> dict[str, Any]:
    publication = build_publication(lock_path)
    json_bytes = (json.dumps(publication, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")
    markdown_bytes = render_markdown(publication).encode("utf-8")
    handoff_bytes = render_handoff(publication).encode("utf-8")
    atomic_write(output_json, json_bytes)
    atomic_write(output_markdown, markdown_bytes)
    atomic_write(output_handoff, handoff_bytes)
    return publication


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", type=Path, default=RESEARCH_ROOT / "native-evidence-lock.json")
    parser.add_argument("--output-json", type=Path, default=RESEARCH_ROOT / "evidence/native-asr-legacy-quality-reevaluation.json")
    parser.add_argument("--output-markdown", type=Path, default=RESEARCH_ROOT / "native-asr-legacy-quality-reevaluation.md")
    parser.add_argument("--output-handoff", type=Path, default=RESEARCH_ROOT / "native-asr-legacy-quality-handoff.md")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        publication = publish(args.lock, args.output_json, args.output_markdown, args.output_handoff)
    except (EvidenceError, BENCHMARK.ContractError, LEGACY.ContractError, KeyError, TypeError, IndexError) as error:
        print(f"native legacy reassessment rejected: {error}")
        return 2
    print(f"published {len(publication['expectedSlots'])} historical native comparison slots")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
