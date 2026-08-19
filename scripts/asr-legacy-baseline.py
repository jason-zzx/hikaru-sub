#!/usr/bin/env python3
"""Publish and compare identity-bound Python legacy ASR quality baselines."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import re
from pathlib import Path
from typing import Any, Iterable, Sequence

REPO_ROOT = Path(__file__).resolve().parents[1]
PROFILE = "python-legacy-cuda-v1"
BASELINE_KIND = "hikaru-asr-python-legacy-baseline"
COMPARISON_KIND = "hikaru-asr-native-legacy-comparison"
SCHEMA_VERSION = 1
REQUIRED_CASES = ("short-v1", "medium-v1", "long-v2")
QUALITY_METRICS = (
    ("cer", "lower-or-equal"),
    ("substitutions", "lower-or-equal"),
    ("deletions", "lower-or-equal"),
    ("insertions", "lower-or-equal"),
    ("emptyTextCount", "lower-or-equal"),
    ("semanticGapCount", "lower-or-equal"),
    ("semanticGapDurationMs", "lower-or-equal"),
)
ABSOLUTE_GATES = (
    "timeline legality: zero invalid/out-of-bounds/negative/reversed/zero-duration segments",
    "valid UTF-8, text conservation, subtitle and protocol legality",
    "complete required matrix and identity/evidence attestation",
    "CPU inference RTF <= 1.0 and accelerated GPU inference RTF <= 0.5",
    "short cold process wall <= 120s",
    "peak RSS <= 6 GiB for CTranslate2 and <= 12 GiB for CrispASR",
    "process cancellation/reap, recovery, path containment, privacy and license contracts",
)


class ContractError(ValueError):
    pass


def _load_benchmark() -> Any:
    path = REPO_ROOT / "scripts" / "asr-benchmark.py"
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark", path)
    if spec is None or spec.loader is None:
        raise ContractError("cannot load shared T01 benchmark implementation")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BENCHMARK = _load_benchmark()


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"cannot read {path.name}: {exc}") from exc
    if not isinstance(value, dict):
        raise ContractError(f"{path.name} root must be an object")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_json(path: Path, value: Any) -> None:
    BENCHMARK.atomic_write_json(path, value)


def _atomic_text(path: Path, value: str) -> None:
    BENCHMARK.atomic_write_text(path, value)


def _profile(manifest: dict[str, Any]) -> dict[str, Any]:
    profiles = [item for item in manifest.get("comparisonProfiles", []) if item.get("comparisonProfile") == PROFILE]
    if len(profiles) != 1:
        raise ContractError(f"identity manifest must contain exactly one {PROFILE} profile")
    return profiles[0]


def _gate_models(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    return [model for model in manifest.get("models", []) if model.get("qualityGate") != "whisper-family-unlock-only"]


def _model_index(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    models = manifest.get("models", [])
    index = {model.get("logicalModelIdentity"): model for model in models}
    if len(index) != len(models) or None in index:
        raise ContractError("logicalModelIdentity values must be present and unique")
    return index


def _validate_acquisition_tool(result: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    identity = result.get("acquisitionTool")
    if not isinstance(identity, dict):
        raise ContractError("raw result is missing acquisition-time benchmark runner identity")
    expected = {
        "schemaVersion": BENCHMARK.RUNNER_IDENTITY_SCHEMA_VERSION,
        "kind": BENCHMARK.RUNNER_IDENTITY_KIND,
        "sourcePath": BENCHMARK.RUNNER_SOURCE_PATH,
        "sha256": profile.get("benchmarkRunnerSha256"),
    }
    if identity != expected:
        raise ContractError("acquisition-time benchmark runner identity drift")
    return identity


def _case_reference(validation: dict[str, Any], case_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    matches = [case for case in validation["cases"] if case["id"] == case_id]
    if len(matches) != 1:
        raise ContractError(f"benchmark manifest must contain exactly one {case_id}")
    case = matches[0]
    ass_path = validation["corpusRoot"] / Path(*case["ass"].split("/"))
    return case, BENCHMARK.parse_ass_reference(ass_path)


def _canonical_sample(case: dict[str, Any]) -> dict[str, Any]:
    cold = [sample for sample in case.get("samples", []) if sample.get("runKind") == "cold"]
    if len(cold) != 1 or cold[0].get("status") != "completed":
        raise ContractError(f"{case.get('caseId')} must contain exactly one completed cold sample")
    return cold[0]


def _recomputed_metrics(result: dict[str, Any], case: dict[str, Any], reference: dict[str, Any]) -> dict[str, Any]:
    sample = _canonical_sample(case)
    metrics = BENCHMARK._sample_metrics(
        reference["text"],
        reference["segments"],
        reference["speechIntervals"],
        copy.deepcopy(sample.get("segments", [])),
        case["durationMs"],
        sample.get("timestampProvenance", "unknown"),
        result["engine"],
    )
    return metrics


def _quality(metrics: dict[str, Any], *, qwen: bool) -> dict[str, Any]:
    gaps = metrics["missingSpeechRegions"]
    timing = metrics.get("timingAccuracy") or {}
    quality = {
        "cer": metrics["cer"]["cer"],
        "substitutions": metrics["cer"]["substitutions"],
        "deletions": metrics["cer"]["deletions"],
        "insertions": metrics["cer"]["insertions"],
        "emptyTextCount": metrics["timeline"]["emptyTextCount"],
        "semanticGapCount": len(gaps),
        "semanticGapDurationMs": sum(int(gap["durationMs"]) for gap in gaps),
    }
    if qwen:
        quality["qwenForcedAlignerTiming"] = {
            "eligible": bool(timing.get("eligible")) and metrics.get("timestampProvenance") == "forced-aligner",
            "provenance": metrics.get("timestampProvenance", "unknown"),
            "medianStartErrorMs": timing.get("medianStartErrorMs"),
            "p95StartErrorMs": timing.get("p95StartErrorMs"),
            "unavailableReason": timing.get("unavailableReason"),
        }
    return quality


def _validate_result_identity(
    result: dict[str, Any], model: dict[str, Any], case_id: str, validation: dict[str, Any], profile: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    if result.get("kind") != BENCHMARK.RESULT_KIND or result.get("schemaVersion") != BENCHMARK.SCHEMA_VERSION:
        raise ContractError("raw result schema identity differs")
    if result.get("candidateKind") != "python-reference":
        raise ContractError("baseline input must be a python-reference result")
    _validate_acquisition_tool(result, profile)
    python_identity = model["python"]
    expected = (python_identity["engine"], python_identity["model"], "cuda", "ja")
    actual = (result.get("engine"), result.get("model"), result.get("device"), result.get("language"))
    if actual != expected:
        raise ContractError(f"python identity drift for {model['logicalModelIdentity']} / {case_id}")
    if result.get("useVad") is not False or result.get("vadConfig") not in ({}, None):
        raise ContractError("baseline runner-level VAD identity drift")
    if result.get("manifest", {}).get("sha256") != validation["manifestSha256"]:
        raise ContractError("benchmark manifest identity drift")
    cases = result.get("cases", [])
    if len(cases) != 1 or cases[0].get("caseId") != case_id:
        raise ContractError("result must contain exactly the expected case")
    case = cases[0]
    source_case, reference = _case_reference(validation, case_id)
    for field, result_field in (("audioSha256", "audioSha256"), ("assSha256", "assSha256"), ("durationMs", "durationMs")):
        if case.get(result_field) != source_case.get(field):
            raise ContractError(f"{case_id} {field} identity drift")
    if case.get("status") != "completed" or case.get("dependencyAvailable") is not True:
        raise ContractError(f"{model['logicalModelIdentity']} / {case_id} is not a completed baseline row")
    expected_samples = 4 if case_id == "short-v1" else 1
    expected_warm = 3 if case_id == "short-v1" else 0
    if case.get("sampleCount") != expected_samples or case.get("warmSampleCount") != expected_warm:
        raise ContractError(f"{case_id} sample-count contract differs")
    runtime = result.get("runtime", {})
    if runtime.get("interpreterMatches") is not True or runtime.get("cacheExplicit") is not True:
        raise ContractError("Python interpreter/cache attestation is invalid")
    interpreter = str(runtime.get("interpreter", "")).replace("\\", "/").lower()
    expected_suffix = str(profile["interpreter"]["path"]).replace("<repo>/", "").lower()
    if not interpreter.endswith(expected_suffix):
        raise ContractError("Python interpreter identity drift")
    hf_home = str(runtime.get("hfHome", "")).replace("\\", "/").lower()
    expected_hf = str(profile["hfHome"]).replace("<repo>/", "").lower()
    if not hf_home.endswith(expected_hf):
        raise ContractError("HF_HOME identity drift")
    environment = result.get("environment", {})
    if environment.get("python") != profile["interpreter"]["pythonVersion"]:
        raise ContractError("Python version identity drift")
    if environment.get("git", {}).get("revision") != profile["gitRevisionAtFreeze"]:
        raise ContractError("git revision identity drift")
    observed_packages = environment.get("packages", {})
    frozen_packages = profile.get("dependencyVersions", {})
    for name, version in observed_packages.items():
        if name in frozen_packages and version != frozen_packages[name]:
            raise ContractError(f"dependency identity drift: {name}")
    gpu_devices = environment.get("gpu", {}).get("devices", [])
    if len(gpu_devices) != 1:
        raise ContractError("exactly one GPU attestation is required")
    gpu = gpu_devices[0]
    if (
        gpu.get("name") != profile["gpu"]["expectedDevice"]
        or gpu.get("memoryTotalMiB") != profile["gpu"]["expectedMemoryTotalMiB"]
        or gpu.get("driverVersion") != profile["gpu"]["expectedDriver"]
    ):
        raise ContractError("GPU identity drift")
    cache = case.get("modelCache", {})
    artifact = python_identity["artifact"]
    if cache.get("status") != "ready" or cache.get("revision") != artifact.get("revision"):
        raise ContractError("model cache revision identity drift")
    companion = python_identity.get("companion")
    if companion and companion.get("repository"):
        observed = cache.get("companions", {}).get(companion["repository"], {})
        if observed.get("revision") != companion.get("revision"):
            raise ContractError("companion revision identity drift")
    metrics = _recomputed_metrics(result, case, reference)
    sample = _canonical_sample(case)
    for field in ("cer", "timeline", "missingSpeechRegions", "excludedNonSemanticVocalizationRegions", "timingAccuracy"):
        if sample.get(field) != metrics.get(field):
            raise ContractError(f"mutable metric field differs from shared T01 recomputation: {field}")
    return case, metrics, source_case


def _public_runtime(result: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    environment = result["environment"]
    return {
        "pythonVersion": environment["python"],
        "interpreterIdentity": profile["interpreter"]["path"],
        "hfHomeIdentity": profile["hfHome"],
        "gitRevision": environment["git"]["revision"],
        "gitDirty": environment["git"]["dirty"],
        "packages": profile["dependencyVersions"],
        "observedPackages": environment["packages"],
        "gpu": environment["gpu"],
        "resourceSampling": {
            "rss": "Windows PeakWorkingSetSize",
            "vram": "nvidia-smi compute-app polling at 250 ms; unavailable values remain explicit",
        },
    }


def publish_baseline(
    identity_manifest_path: Path, benchmark_manifest_path: Path, corpus_root: Path, results_path: Path
) -> dict[str, Any]:
    identity_manifest = _read_json(identity_manifest_path)
    profile = _profile(identity_manifest)
    model_index = _model_index(identity_manifest)
    validation = BENCHMARK.validate_manifest(benchmark_manifest_path, corpus_root)
    if validation["manifestSha256"] != identity_manifest.get("corpus", {}).get("manifestSha256"):
        raise ContractError("identity manifest corpus hash differs from validated benchmark manifest")
    runner_path = REPO_ROOT / "scripts" / "asr-benchmark.py"
    if _sha256(runner_path) != profile.get("benchmarkRunnerSha256"):
        raise ContractError("shared T01 benchmark runner identity drift")
    result_files = sorted(results_path.glob("*.json")) if results_path.is_dir() else [results_path]
    raw: dict[tuple[str, str], tuple[Path, dict[str, Any]]] = {}
    for path in result_files:
        result = _read_json(path)
        if result.get("kind") != BENCHMARK.RESULT_KIND:
            continue
        cases = result.get("cases", [])
        if len(cases) != 1:
            raise ContractError(f"{path.name} must contain exactly one case")
        key = (result.get("engine"), cases[0].get("caseId"))
        model_matches = [
            model for model in _gate_models(identity_manifest)
            if model["python"]["engine"] == result.get("engine") and model["python"]["model"] == result.get("model")
        ]
        if len(model_matches) != 1:
            raise ContractError(f"{path.name} does not map to exactly one logical model identity")
        logical_key = (model_matches[0]["logicalModelIdentity"], cases[0].get("caseId"))
        if logical_key in raw:
            raise ContractError(f"duplicate baseline row: {logical_key}")
        raw[logical_key] = (path, result)
    models_out = []
    generated_values: list[str] = []
    for logical_id, model in model_index.items():
        if model.get("comparisonProfile") != PROFILE or tuple(model.get("requiredCases", ())) != REQUIRED_CASES:
            raise ContractError(f"model profile/case contract differs: {logical_id}")
        common = {
            "logicalModelIdentity": logical_id,
            "family": model["family"],
            "qualityGate": model["qualityGate"],
            "comparisonProfile": model["comparisonProfile"],
            "pythonIdentity": model["python"],
            "nativeMapping": model["native"],
            "mappingRule": model["mappingRule"],
        }
        if model["qualityGate"] == "whisper-family-unlock-only":
            models_out.append({**common, "baselineDisposition": "family-gated-no-baseline", "cases": []})
            continue
        rows = []
        for case_id in REQUIRED_CASES:
            item = raw.get((logical_id, case_id))
            if item is None:
                raise ContractError(f"missing required baseline row: {logical_id} / {case_id}")
            path, result = item
            case, metrics, source_case = _validate_result_identity(result, model, case_id, validation, profile)
            generated_values.append(result.get("generatedAt", ""))
            cold = _canonical_sample(case)
            cold_process = case["coldProcess"]
            rows.append(
                {
                    "caseId": case_id,
                    "status": "completed",
                    "rawResultSha256": _sha256(path),
                    "corpusIdentity": {
                        "audioSha256": source_case["audioSha256"],
                        "assSha256": source_case["assSha256"],
                        "durationMs": source_case["durationMs"],
                        "dialogueCount": case["dialogueCount"],
                        "tags": sorted(case["tags"]),
                    },
                    "runIdentity": {
                        "engine": result["engine"],
                        "model": result["model"],
                        "device": result["device"],
                        "language": result["language"],
                        "useVad": result["useVad"],
                        "resolvedParameters": cold_process["resolvedParameters"],
                        "modelCache": case["modelCache"],
                        "acquisitionTool": result["acquisitionTool"],
                        "runtime": _public_runtime(result, profile),
                    },
                    "sampleContract": {
                        "qualitySample": "cold",
                        "sampleCount": case["sampleCount"],
                        "warmSampleCount": case["warmSampleCount"],
                    },
                    "quality": _quality(metrics, qwen=result["engine"] == "qwen3-asr"),
                    "structuralDiagnostics": {
                        "timeline": metrics["timeline"],
                        "timestampProvenance": metrics["timestampProvenance"],
                        "excludedNonSemanticVocalizationGapCount": len(metrics["excludedNonSemanticVocalizationRegions"]),
                    },
                    "performanceDiagnostics": {
                        "coldProcessWallMs": cold_process["processWallMs"],
                        "coldInferenceRtf": cold["timings"]["inferenceRtf"],
                        "coldTotalRtf": cold["timings"]["totalRtf"],
                        "warmInferenceRtfMedian": case["warmInferenceRtfMedian"],
                        "peakProcessRssBytes": cold_process["resources"]["peakProcessRssBytes"],
                        "peakProcessRssMethod": cold_process["resources"]["peakProcessRssMethod"],
                        "peakVramBytes": cold_process["resources"]["vram"]["peakVramBytes"],
                        "peakVramUnavailableReason": cold_process["resources"]["vram"]["unavailableReason"],
                    },
                }
            )
        models_out.append({**common, "baselineDisposition": "complete", "cases": rows})
    expected_keys = {(m["logicalModelIdentity"], case) for m in _gate_models(identity_manifest) for case in REQUIRED_CASES}
    if set(raw) != expected_keys:
        raise ContractError("result set contains missing or unexpected identity/case rows")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": BASELINE_KIND,
        "comparisonProfile": PROFILE,
        "authorityDisposition": "complete",
        "generatedAt": max(generated_values),
        "authority": {
            "identityManifestSha256": _sha256(identity_manifest_path),
            "benchmarkManifestSha256": validation["manifestSha256"],
            "benchmarkRunnerSha256": _sha256(REPO_ROOT / "scripts" / "asr-benchmark.py"),
            "publisherSha256": _sha256(Path(__file__).resolve()),
            "corpusId": validation["manifest"]["corpusId"],
            "qualitySampleReduction": "the single completed cold sample is authoritative; three short warm samples are performance/reproducibility evidence",
            "supersedes": [
                ".trellis/tasks/archive/2026-07/07-25-native-asr-benchmark-baseline/research/python-reference-report.md"
            ],
            "historicalEvidencePolicy": "archived reports remain immutable; this handoff changes only prospective native subtitle-quality qualification",
        },
        "qualityComparisonContract": {
            "key": ["logicalModelIdentity", "caseId", "comparisonProfile"],
            "metrics": [{"id": metric, "direction": direction} for metric, direction in QUALITY_METRICS]
            + [
                {"id": "qwenForcedAlignerMedianStartErrorMs", "direction": "lower-or-equal", "requires": "eligible forced-aligner provenance on both rows"},
                {"id": "qwenForcedAlignerP95StartErrorMs", "direction": "lower-or-equal", "requires": "eligible forced-aligner provenance on both rows"},
            ],
            "statusOrdering": ["qualified", "stop-revise", "baseline-incomplete", "unscored"],
            "invalidityRules": [
                "cross-model, family-only, case, profile, artifact, revision or companion substitution is rejected",
                "missing, invalid, identity-drifted or provenance-ineligible baseline evidence cannot qualify a native row",
                "no average may hide a per-case or per-metric regression",
                "a legal Python structured failure is not a waiver for native structural or non-quality gates",
            ],
            "independentAbsoluteGates": list(ABSOLUTE_GATES),
            "releaseBoundary": "this comparison can qualify subtitle quality only; release additionally requires every independent absolute gate",
        },
        "whisperFamilyGate": {
            "anchors": ["faster-whisper/large-v2", "faster-whisper/large-v3"],
            "rule": "both anchors must complete all three cases, pass every relative quality metric, and pass all independent absolute gates before family unlock",
            "unlockedModels": [
                model["logicalModelIdentity"] for model in identity_manifest["models"]
                if model["qualityGate"] == "whisper-family-unlock-only"
            ],
        },
        "limitations": [
            "low-volume remains absent from the authoritative corpus coverage",
            "Python CUDA performance and resource values are diagnostic only and never establish relative native gates",
            "Qwen3 long-v2 uses mixed timestamp provenance, so its baseline timing fields are ineligible while its text/gap quality fields remain published",
            "native GGUF revisions/hashes marked pending in the identity manifest must be frozen before those model comparisons can qualify",
        ],
        "models": models_out,
    }


def _fmt(value: Any, digits: int = 3) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def render_baseline_markdown(baseline: dict[str, Any]) -> str:
    lines = [
        "# Python Legacy CUDA ASR Baseline",
        "",
        "> Deterministically generated from `python-legacy-baseline.json`. WAV+ASS remains the only reference truth; Python output is only a same-model/same-case subtitle-quality floor.",
        "",
        f"- Comparison profile: `{baseline['comparisonProfile']}`",
        f"- Corpus: `{baseline['authority']['corpusId']}`",
        f"- Benchmark manifest SHA-256: `{baseline['authority']['benchmarkManifestSha256']}`",
        "- Performance/resource and structural/security gates remain absolute and independent.",
        "",
        "## Baseline Rows",
        "",
        "| Logical model | Case | Status | CER | S | D | I | Empty | Semantic gaps | Gap ms | Timeline errors | Cold inference RTF | Warm inference RTF | Cold wall ms | Peak RSS bytes | Timing provenance | Qwen median ms | Qwen P95 ms | Raw result SHA-256 |",
        "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|",
    ]
    for model in baseline["models"]:
        for row in model["cases"]:
            quality = row["quality"]
            timeline = row["structuralDiagnostics"]["timeline"]
            timeline_errors = sum(
                int(timeline.get(field, 0) or 0)
                for field in ("emptyTextCount", "nonPositiveDurationCount", "negativeStartCount", "afterAudioEndCount", "nonMonotonicCount")
            )
            timing = quality.get("qwenForcedAlignerTiming") or {}
            perf = row["performanceDiagnostics"]
            lines.append(
                "| `{}` | `{}` | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | `{}` | {} | {} | `{}` |".format(
                    model["logicalModelIdentity"], row["caseId"], row["status"], _fmt(quality["cer"]),
                    quality["substitutions"], quality["deletions"], quality["insertions"], quality["emptyTextCount"],
                    quality["semanticGapCount"], quality["semanticGapDurationMs"], timeline_errors,
                    _fmt(perf["coldInferenceRtf"]), _fmt(perf["warmInferenceRtfMedian"]), _fmt(perf["coldProcessWallMs"]),
                    _fmt(perf["peakProcessRssBytes"]), row["structuralDiagnostics"]["timestampProvenance"],
                    _fmt(timing.get("medianStartErrorMs"), 1), _fmt(timing.get("p95StartErrorMs"), 1), row["rawResultSha256"],
                )
            )
    lines.extend(["", "## Family-Gated Whisper Models", ""])
    for model in baseline["models"]:
        if model["baselineDisposition"] == "family-gated-no-baseline":
            lines.append(f"- `{model['logicalModelIdentity']}`: `family-gated-no-baseline`; it borrows no anchor metrics.")
    lines.extend(["", "## Native Comparison Contract", ""])
    for metric in baseline["qualityComparisonContract"]["metrics"]:
        suffix = f"; {metric['requires']}" if metric.get("requires") else ""
        lines.append(f"- `{metric['id']}`: `{metric['direction']}`{suffix}.")
    lines.extend(["", "Independent absolute gates:", ""])
    for gate in baseline["qualityComparisonContract"]["independentAbsoluteGates"]:
        lines.append(f"- {gate}.")
    lines.extend(["", "## Limitations And Supersession", ""])
    for limitation in baseline["limitations"]:
        lines.append(f"- {limitation}.")
    for old in baseline["authority"]["supersedes"]:
        lines.append(f"- Supersedes for prospective Python quality authority only: `{old}`; historical contents remain immutable.")
    lines.append("")
    return "\n".join(lines)


def _mapping_complete(model: dict[str, Any]) -> bool:
    artifact = model["native"]["artifact"]
    if artifact.get("identityStatus", "").startswith("pending"):
        return False
    if artifact.get("revision") is None and artifact.get("sha256") is None:
        return False
    companion = model["native"].get("companion")
    if not companion:
        return True
    return not companion.get("identityStatus", "").startswith("pending") and (
        companion.get("revision") is not None or companion.get("sha256") is not None
    )


def _compare_value(metric: str, baseline_value: Any, native_value: Any) -> dict[str, Any]:
    if baseline_value is None or native_value is None:
        return {"metric": metric, "direction": "lower-or-equal", "baseline": baseline_value, "native": native_value, "delta": None, "disposition": "unscored"}
    delta = native_value - baseline_value
    return {"metric": metric, "direction": "lower-or-equal", "baseline": baseline_value, "native": native_value, "delta": delta, "disposition": "qualified" if delta <= 0 else "stop-revise"}


def compare_native_result(
    baseline: dict[str, Any], identity_manifest: dict[str, Any], validation: dict[str, Any],
    logical_id: str, native_result: dict[str, Any], native_identity: dict[str, Any]
) -> dict[str, Any]:
    models = _model_index(identity_manifest)
    if logical_id not in models or models[logical_id]["qualityGate"] == "whisper-family-unlock-only":
        raise ContractError("logical model has no independent Python baseline")
    model = models[logical_id]
    if native_identity.get("logicalModelIdentity") != logical_id or native_identity.get("comparisonProfile") != PROFILE:
        raise ContractError("native identity logical model/profile drift")
    result_identity = native_identity.get("result")
    if not isinstance(result_identity, dict):
        raise ContractError("native identity must bind the result engine/model/device/language")
    for field in ("engine", "model", "device", "language"):
        if result_identity.get(field) != native_result.get(field):
            raise ContractError(f"native result identity drift: {field}")
    if native_result.get("engine") != model["python"]["engine"]:
        raise ContractError("native result product-engine identity drift")
    for role in ("artifact", "companion"):
        expected = model["native"].get(role)
        actual = native_identity.get(role)
        if expected is None:
            if actual not in (None, {}):
                raise ContractError(f"unexpected native {role}")
            continue
        if not isinstance(actual, dict):
            raise ContractError(f"missing native {role} identity")
        for key, value in expected.items():
            if value is not None and key not in {"role", "identityStatus"} and actual.get(key) != value:
                raise ContractError(f"native {role} identity drift: {key}")
    if (
        native_result.get("kind") != BENCHMARK.RESULT_KIND
        or native_result.get("schemaVersion") != BENCHMARK.SCHEMA_VERSION
        or native_result.get("candidateKind") != "native-candidate"
    ):
        raise ContractError("native result envelope identity differs")
    result_manifest = native_result.get("manifest", {})
    if (
        result_manifest.get("sha256") != validation["manifestSha256"]
        or result_manifest.get("corpusId") != validation["manifest"]["corpusId"]
    ):
        raise ContractError("native benchmark manifest identity drift")
    baseline_model = next(item for item in baseline["models"] if item["logicalModelIdentity"] == logical_id)
    baseline_cases = {row["caseId"]: row for row in baseline_model["cases"]}
    native_cases = native_result.get("cases", [])
    native_case_ids = [case.get("caseId") for case in native_cases]
    if len(native_case_ids) != len(REQUIRED_CASES) or set(native_case_ids) != set(REQUIRED_CASES):
        raise ContractError("native result must contain the complete unique required case matrix")
    rows = []
    for case in native_cases:
        case_id = case["caseId"]
        source_case, reference = _case_reference(validation, case_id)
        if (
            case.get("audioSha256") != source_case["audioSha256"]
            or case.get("assSha256") != source_case["assSha256"]
            or case.get("durationMs") != source_case["durationMs"]
        ):
            raise ContractError("native case corpus identity drift")
        if case.get("status") != "completed":
            rows.append({"caseId": case_id, "subtitleQualityDisposition": "unscored", "metrics": [], "reason": "native case did not complete"})
            continue
        metrics = _recomputed_metrics(native_result, case, reference)
        native_quality = _quality(metrics, qwen=native_result.get("engine") == "qwen3-asr")
        base_quality = baseline_cases[case_id]["quality"]
        compared = [_compare_value(metric, base_quality[metric], native_quality[metric]) for metric, _ in QUALITY_METRICS]
        if native_result.get("engine") == "qwen3-asr":
            base_timing = base_quality.get("qwenForcedAlignerTiming") or {}
            native_timing = native_quality.get("qwenForcedAlignerTiming") or {}
            for metric, field in (("qwenForcedAlignerMedianStartErrorMs", "medianStartErrorMs"), ("qwenForcedAlignerP95StartErrorMs", "p95StartErrorMs")):
                if not base_timing.get("eligible") or not native_timing.get("eligible"):
                    compared.append({"metric": metric, "direction": "lower-or-equal", "baseline": base_timing.get(field), "native": native_timing.get(field), "delta": None, "disposition": "unscored", "provenance": {"baseline": base_timing.get("provenance"), "native": native_timing.get("provenance")}})
                else:
                    compared.append(_compare_value(metric, base_timing.get(field), native_timing.get(field)))
        if not _mapping_complete(model) or any(item["disposition"] == "unscored" for item in compared):
            disposition = "baseline-incomplete"
        elif any(item["disposition"] == "stop-revise" for item in compared):
            disposition = "stop-revise"
        else:
            disposition = "qualified"
        rows.append({"caseId": case_id, "subtitleQualityDisposition": disposition, "metrics": compared})
    model_disposition = "baseline-incomplete" if any(row["subtitleQualityDisposition"] in {"baseline-incomplete", "unscored"} for row in rows) else ("stop-revise" if any(row["subtitleQualityDisposition"] == "stop-revise" for row in rows) else "qualified")
    return {
        "logicalModelIdentity": logical_id,
        "comparisonProfile": PROFILE,
        "subtitleQualityDisposition": model_disposition,
        "cases": sorted(rows, key=lambda row: REQUIRED_CASES.index(row["caseId"])),
        "independentAbsoluteGates": list(ABSOLUTE_GATES),
        "releaseEligibility": "not-decided-by-this-comparison",
    }


def command_publish(args: argparse.Namespace) -> int:
    baseline = publish_baseline(Path(args.identity_manifest), Path(args.benchmark_manifest), Path(args.corpus_root), Path(args.results))
    _atomic_json(Path(args.output_json), baseline)
    _atomic_text(Path(args.output_markdown), render_baseline_markdown(baseline))
    print(f"published {sum(len(model['cases']) for model in baseline['models'])} baseline rows")
    return 0


def command_compare(args: argparse.Namespace) -> int:
    baseline_path = Path(args.baseline)
    identity_manifest_path = Path(args.identity_manifest)
    native_result_path = Path(args.native_result)
    baseline = _read_json(baseline_path)
    identity_manifest = _read_json(identity_manifest_path)
    validation = BENCHMARK.validate_manifest(Path(args.benchmark_manifest), Path(args.corpus_root))
    authority = baseline.get("authority", {})
    if (
        baseline.get("kind") != BASELINE_KIND
        or baseline.get("schemaVersion") != SCHEMA_VERSION
        or baseline.get("comparisonProfile") != PROFILE
        or baseline.get("authorityDisposition") != "complete"
        or authority.get("identityManifestSha256") != _sha256(identity_manifest_path)
        or authority.get("benchmarkManifestSha256") != validation["manifestSha256"]
        or authority.get("benchmarkRunnerSha256") != _sha256(REPO_ROOT / "scripts" / "asr-benchmark.py")
        or authority.get("publisherSha256") != _sha256(Path(__file__).resolve())
    ):
        raise ContractError("baseline authority identity drift")
    identity = _read_json(Path(args.native_identity))
    if identity.get("nativeResultSha256") != _sha256(native_result_path):
        raise ContractError("native result hash identity drift")
    result = compare_native_result(
        baseline, identity_manifest, validation, args.logical_model_identity, _read_json(native_result_path), identity
    )
    output = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": COMPARISON_KIND,
        "comparisonProfile": PROFILE,
        "models": [result],
        "whisperFamilyDisposition": "blocked-pending-complete-two-anchor-aggregation" if result["logicalModelIdentity"].startswith("faster-whisper/") else "not-applicable",
    }
    _atomic_json(Path(args.output), output)
    print(f"compared {args.logical_model_identity}: {result['subtitleQualityDisposition']}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    publish = sub.add_parser("publish")
    publish.add_argument("--identity-manifest", required=True)
    publish.add_argument("--benchmark-manifest", required=True)
    publish.add_argument("--corpus-root", required=True)
    publish.add_argument("--results", required=True)
    publish.add_argument("--output-json", required=True)
    publish.add_argument("--output-markdown", required=True)
    publish.set_defaults(func=command_publish)
    compare = sub.add_parser("compare")
    compare.add_argument("--baseline", required=True)
    compare.add_argument("--identity-manifest", required=True)
    compare.add_argument("--benchmark-manifest", required=True)
    compare.add_argument("--corpus-root", required=True)
    compare.add_argument("--native-result", required=True)
    compare.add_argument("--native-identity", required=True)
    compare.add_argument("--logical-model-identity", required=True)
    compare.add_argument("--output", required=True)
    compare.set_defaults(func=command_compare)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (ContractError, BENCHMARK.ContractError) as exc:
        print(f"error: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
