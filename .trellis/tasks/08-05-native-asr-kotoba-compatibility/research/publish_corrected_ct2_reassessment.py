#!/usr/bin/env python3
"""Validate retained CT2 evidence and publish the corrected long-v2 reassessment."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import statistics
import sys
from pathlib import Path, PurePosixPath
from typing import Any

TASK_ROOT = Path(__file__).resolve().parent.parent
RESEARCH_ROOT = Path(__file__).resolve().parent
LOCAL_ROOT = (RESEARCH_ROOT / "local").resolve()
OLD_MANIFEST = LOCAL_ROOT / "correction" / "manifest-long-v1.json"
T02_LOCK_CRLF = LOCAL_ROOT / "correction" / "t02-inputs-lock-crlf.json"
ORIGINAL_T08_ADAPTER = LOCAL_ROOT / "correction" / "original-kotoba_benchmark_adapter.py"
CORPUS_ID = "hikaru-user-ja-ground-truth-v1"
OLD_MANIFEST_SHA256 = "e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277"
CURRENT_MANIFEST_SHA256 = "3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea"
T02_HISTORICAL_LOCK_SHA256 = "e0036e0f4f63180239f05524cac62b895017e49bd0eed3e72420432bf2a9b9f7"
TIMELINE_ERROR_FIELDS = (
    "afterAudioEndCount",
    "emptyTextCount",
    "negativeStartCount",
    "nonMonotonicCount",
    "nonPositiveDurationCount",
)

SOURCES = {
    "t02-large-v3-fixed": {
        "task": "T02",
        "route": "ordinary-large-v3-fixed-window",
        "gate": "cpu",
        "lock": ".trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/inputs.lock.json",
        "adapter": ".trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/poc-src/benchmark_adapter.py",
        "raw": {
            "short-v1": (".trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/runs/final-large-v3-short.json", "2f7d38ecbcc1d5853b47f51c9468e7e949ac1b410d8aecc27e52a6e271af99e5"),
            "medium-v1": (".trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/runs/final-large-v3-medium.json", "453e2fe380bd3e2e809a9c6cc26533fca91c3ae1b1d37c666b5315e7d1704d74"),
            "long-v1": (".trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/runs/final-large-v3-long.json", "7f29ee9be534739e20d7f1d0f802a48a39844023c3c89c08d933cac6f7c2d3ca"),
        },
    },
    "t02-kotoba-fixed": {
        "task": "T02",
        "route": "kotoba-fixed-window",
        "gate": "cpu",
        "lock": ".trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/inputs.lock.json",
        "adapter": ".trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/poc-src/benchmark_adapter.py",
        "raw": {
            "short-v1": (".trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/runs/final-kotoba-short.json", "71db6d0572cc079588f65f87ed96b77acc3637ded8280bf6bad6961c527e4cc9"),
            "medium-v1": (".trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/runs/final-kotoba-medium.json", "bca05b36ab4898e552b75e2c90d28453792259e9738ce2e0af698ef195acf7cc"),
            "long-v1": (".trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/research/local/runs/final-kotoba-long.json", "4d661771477bbc7cf4e6d257885babae8c399371e0810583bcac58a5346f0086"),
        },
    },
    "t06-selected-a": {
        "task": "T06",
        "route": "ordinary-large-v3-selected-beam1-no-history",
        "gate": "cpu",
        "lock": ".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/selected-cpu-candidate-lock.md",
        "adapter": ".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/selected_cpu_adapter.py",
        "raw": {
            "short-v1": (".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local/raw/selected-cpu-large-v3-short.json", "1d559f9a68c4fc1bcd5acc820a0b650d58a30b10654ed31ef245a088bfee8166"),
            "medium-v1": (".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local/raw/selected-cpu-large-v3-medium.json", "5cd366a7737b503138e629ca6f6d2ca602e32697ebf69e900f3d649e5ad2c3b0"),
            "long-v1": (".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local/raw/selected-cpu-large-v3-long.json", "4ebb28126703b5ebb88184e78b6b4c7b181784e9f0b039bbd6d1fd9f4b84b32c"),
        },
    },
    "t06-candidate-b": {
        "task": "T06",
        "route": "ordinary-large-v3-candidate-b-silero-v6",
        "gate": "cpu",
        "lock": ".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/candidate-b-final-lock.md",
        "adapter": ".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/candidate_b_adapter.py",
        "raw": {
            "short-v1": (".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/raw/large-v3-short.json", "9fc31c5d3f97ae6de192edd26ac6a3a12836be7bf29f998a779e7594d9305afe"),
            "medium-v1": (".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/research/local/candidate-b/raw/large-v3-medium.json", "94c2a0c5a222f7f1bfe51f6710cc80fe8ebf54e5e3bd00f48648cfe222afca0b"),
        },
    },
    "t08-kotoba-k1": {
        "task": "T08",
        "route": "kotoba-k1-timestamp-driven",
        "gate": "gpu",
        "lock": ".trellis/tasks/08-05-native-asr-kotoba-compatibility/research/kotoba-k1-lock.md",
        "adapter": ".trellis/tasks/08-05-native-asr-kotoba-compatibility/research/local/correction/original-kotoba_benchmark_adapter.py",
        "raw": {
            "short-v1": (".trellis/tasks/08-05-native-asr-kotoba-compatibility/research/local/raw-full-matrix/short.json", "5f5695f961df5cf199aaba0b48af51f31de195fe847f170f122e40d3ee03e82d"),
            "medium-v1": (".trellis/tasks/08-05-native-asr-kotoba-compatibility/research/local/raw-full-matrix/medium.json", "dda53c612a0e7a03ee32775fdfe168b21522272e88d201838a91cdbc86005fba"),
            "long-v1": (".trellis/tasks/08-05-native-asr-kotoba-compatibility/research/local/raw-full-matrix/long.json", "9a55accff3b028de3882fc9db580061bf2f88b337e30ffc913205037d7307ba0"),
        },
    },
}

EXPECTED_PREVIEW = {
    ("t02-large-v3-fixed", "short-v1"): (0.3583, 0, 0),
    ("t02-large-v3-fixed", "medium-v1"): (0.1745, 10, 0),
    ("t02-large-v3-fixed", "long-v2"): (0.2245, 68, 0),
    ("t02-kotoba-fixed", "short-v1"): (0.3417, 0, 0),
    ("t02-kotoba-fixed", "medium-v1"): (0.2224, 3, 2),
    ("t02-kotoba-fixed", "long-v2"): (0.2512, 16, 0),
    ("t06-selected-a", "short-v1"): (0.2667, 0, 0),
    ("t06-selected-a", "medium-v1"): (0.1134, 0, 0),
    ("t06-selected-a", "long-v2"): (0.1509, 0, 0),
    ("t06-candidate-b", "short-v1"): (0.2667, 0, 0),
    ("t06-candidate-b", "medium-v1"): (0.1055, 0, 1),
    ("t08-kotoba-k1", "short-v1"): (0.3250, 0, 0),
    ("t08-kotoba-k1", "medium-v1"): (0.2163, 0, 2),
    ("t08-kotoba-k1", "long-v2"): (0.2268, 7, 0),
}


class EvidenceError(ValueError):
    pass


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise EvidenceError(f"cannot load evidence adapter: {name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _timeline_errors(timeline: dict[str, Any]) -> int:
    return sum(int(timeline.get(field, 0)) for field in TIMELINE_ERROR_FIELDS)


def _write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(payload)
    os.replace(temporary, path)


def _write_json(path: Path, value: dict[str, Any]) -> None:
    _write(path, (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode())


def _inside(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def require_ignored_local(benchmark, path: Path, label: str) -> None:
    if not _inside(LOCAL_ROOT, path) or path.resolve() == LOCAL_ROOT:
        raise EvidenceError(f"{label} must stay below the canonical T08 research/local root")
    benchmark._require_ignored_raw_output(path.resolve())


def require_hash(benchmark, path: Path, expected: str, label: str) -> str:
    if not path.is_file():
        raise EvidenceError(f"{label} is missing")
    actual = benchmark.sha256_file(path)
    if actual != expected:
        raise EvidenceError(f"{label} identity drifted")
    return actual


def _prepare_t02_historical_lock(repo_root: Path, benchmark) -> None:
    source = repo_root / SOURCES["t02-large-v3-fixed"]["lock"]
    normalized = source.read_bytes().replace(b"\r\n", b"\n")
    T02_LOCK_CRLF.parent.mkdir(parents=True, exist_ok=True)
    T02_LOCK_CRLF.write_bytes(normalized.replace(b"\n", b"\r\n"))
    require_hash(benchmark, T02_LOCK_CRLF, T02_HISTORICAL_LOCK_SHA256, "T02 historical CRLF input lock")


def _run_t02_original_adapters(repo_root: Path, benchmark) -> None:
    adapter_path = repo_root / SOURCES["t02-large-v3-fixed"]["adapter"]
    module = _load_module("t08_original_t02_adapter", adapter_path)
    module.__file__ = str((repo_root / ".trellis/tasks/08-05-native-asr-kotoba-compatibility/research/poc-src/benchmark_adapter.py").resolve())
    output_root = LOCAL_ROOT / "correction" / "original-adapted"
    output_root.mkdir(parents=True, exist_ok=True)
    saved_argv = sys.argv
    try:
        for candidate_id in ("t02-large-v3-fixed", "t02-kotoba-fixed"):
            for source_case_id, (raw_key, _raw_hash) in SOURCES[candidate_id]["raw"].items():
                output = output_root / f"{candidate_id}-{source_case_id}.json"
                sys.argv = [
                    module.__file__,
                    "--raw", str(repo_root / raw_key),
                    "--manifest", str(OLD_MANIFEST),
                    "--corpus-root", str(repo_root / ".asr-benchmark"),
                    "--case", source_case_id,
                    "--lock", str(T02_LOCK_CRLF),
                    "--output", str(output),
                ]
                if module.main() != 0 or not output.is_file():
                    raise EvidenceError(f"T02 archived adapter rejected {candidate_id}/{source_case_id}")
    finally:
        sys.argv = saved_argv


def _validate_source_identities(repo_root: Path, benchmark, correction_lock_text: str) -> dict[str, dict[str, Any]]:
    old_validation = benchmark.validate_manifest(OLD_MANIFEST, repo_root / ".asr-benchmark")
    if old_validation["manifestSha256"] != OLD_MANIFEST_SHA256 or old_validation["manifest"]["corpusId"] != CORPUS_ID:
        raise EvidenceError("historical long-v1 manifest identity drifted")
    _prepare_t02_historical_lock(repo_root, benchmark)
    _run_t02_original_adapters(repo_root, benchmark)

    selected_path = repo_root / SOURCES["t06-selected-a"]["adapter"]
    selected = _load_module("t08_selected_cpu_adapter", selected_path)
    selected.EXPECTED_CASES["long-v1"] = {
        "audioSha256": "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e",
        "assSha256": "7954ce24af05dca37b2930136c83ee722e80fd637ef298cc7eeb47f29cf8c6f3",
        "durationMs": 4_144_235,
        "sourceFrames": 414_424,
        "sampleCount": 1,
    }
    selected_lock = repo_root / SOURCES["t06-selected-a"]["lock"]
    selected_lock_sha = benchmark.sha256_file(selected_lock)
    selected_lock_text = selected_lock.read_text(encoding="utf-8")

    candidate_b_path = repo_root / SOURCES["t06-candidate-b"]["adapter"]
    candidate_b = _load_module("t08_candidate_b_adapter", candidate_b_path)
    candidate_b_lock = repo_root / SOURCES["t06-candidate-b"]["lock"]
    candidate_b_lock_sha = benchmark.sha256_file(candidate_b_lock)
    candidate_b_lock_text = candidate_b_lock.read_text(encoding="utf-8")

    original_t08 = _load_module("t08_original_kotoba_adapter", ORIGINAL_T08_ADAPTER)
    original_t08.LOCAL_ROOT = (RESEARCH_ROOT / "local").resolve()
    t08_lock = repo_root / SOURCES["t08-kotoba-k1"]["lock"]

    loaded: dict[str, dict[str, Any]] = {}
    for candidate_id, source in SOURCES.items():
        lock_path = repo_root / source["lock"]
        adapter_path = repo_root / source["adapter"]
        lock_sha = T02_HISTORICAL_LOCK_SHA256 if candidate_id.startswith("t02-") else benchmark.sha256_file(lock_path)
        adapter_sha = benchmark.sha256_file(adapter_path)
        if lock_sha not in correction_lock_text or adapter_sha not in correction_lock_text:
            raise EvidenceError(f"{candidate_id} source lock/adapter is not frozen by the correction lock")
        rows = {}
        for source_case_id, (raw_key, raw_hash) in source["raw"].items():
            raw_path = repo_root / raw_key
            require_hash(benchmark, raw_path, raw_hash, f"{candidate_id}/{source_case_id} raw")
            raw = json.loads(raw_path.read_text(encoding="utf-8"))
            if candidate_id.startswith("t02-"):
                if (
                    raw.get("kind") != "hikaru-ct2-poc-raw"
                    or raw.get("status") != "completed"
                    or raw.get("inputLockSha256") != T02_HISTORICAL_LOCK_SHA256
                    or raw.get("durationMs") not in {24_102, 498_872, 4_144_235}
                ):
                    raise EvidenceError(f"{candidate_id}/{source_case_id} T02 envelope drifted")
            elif candidate_id == "t06-selected-a":
                selected.validate_raw_identity(benchmark, raw, selected_lock_text, selected_lock_sha, source_case_id)
            elif candidate_id == "t06-candidate-b":
                candidate_b.validate_raw_identity(
                    benchmark, raw, candidate_b_lock_text, candidate_b_lock_sha, source_case_id
                )
            else:
                original_t08.validate_raw_identity(benchmark, raw, t08_lock, source_case_id)
            rows[source_case_id] = {"path": raw_path, "sha256": raw_hash, "raw": raw}
        loaded[candidate_id] = {
            "source": source,
            "lockSha256": lock_sha,
            "adapterSha256": adapter_sha,
            "rows": rows,
        }
    return loaded


def _segments(sample: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {"startMs": item["startMs"], "endMs": item["endMs"], "text": item["text"]}
        for item in sample["segments"]
    ]


def _cold_wall_ms(sample: dict[str, Any]) -> float:
    timings = sample["timings"]
    for key in ("processWallMs", "totalMs", "sampleWallMs"):
        value = timings.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    raise EvidenceError("cold process wall timing is missing")


def _case_summary(benchmark, candidate_id: str, source_case_id: str, raw_entry: dict[str, Any], case: dict[str, Any], gate: str) -> dict[str, Any]:
    raw = raw_entry["raw"]
    samples = raw.get("samples")
    if not isinstance(samples, list) or not samples:
        raise EvidenceError(f"{candidate_id}/{source_case_id} samples are missing")
    scored = []
    for sample in samples:
        metrics = benchmark._sample_metrics(
            case["reference"]["text"],
            case["reference"]["segments"],
            case["reference"]["speechIntervals"],
            _segments(sample),
            case["durationMs"],
            "engine-native",
            "kotoba-faster-whisper" if "kotoba" in candidate_id else "faster-whisper",
        )
        scored.append((sample, metrics))
    warm_rtfs = [float(sample["timings"]["inferenceRtf"]) for sample, _ in scored if sample.get("runKind") == "warm"]
    effective_rtf = statistics.median(warm_rtfs) if source_case_id == "short-v1" and warm_rtfs else float(scored[0][0]["timings"]["inferenceRtf"])
    cer = max(float(metrics["cer"]["cer"]) for _, metrics in scored)
    timeline_errors = max(_timeline_errors(metrics["timeline"]) for _, metrics in scored)
    semantic_gaps = max(len(metrics["missingSpeechRegions"]) for _, metrics in scored)
    excluded_gaps = max(len(metrics["excludedNonSemanticVocalizationRegions"]) for _, metrics in scored)
    peak_rss = int(raw["resources"]["peakProcessRssBytes"])
    current_case_id = case["id"]
    gates = {
        "cerAtMost0_35": cer <= 0.35,
        ("acceleratedInferenceRtfAtMost0_5" if gate == "gpu" else "cpuInferenceRtfAtMost1_0"): effective_rtf <= (0.5 if gate == "gpu" else 1.0),
        "shortColdWallAtMost120s": None if current_case_id != "short-v1" else _cold_wall_ms(scored[0][0]) <= 120_000,
        "peakRssAtMost6GiB": peak_rss <= 6 * 1024**3,
        "timelineErrorsZero": timeline_errors == 0,
        "semanticSpeechGapsZero": semantic_gaps == 0,
    }
    return {
        "caseId": current_case_id,
        "sourceCaseId": source_case_id,
        "samples": {
            "cold": sum(sample.get("runKind") == "cold" for sample, _ in scored),
            "warm": sum(sample.get("runKind") == "warm" for sample, _ in scored),
        },
        "measurements": {
            "cer": cer,
            "inferenceRtf": effective_rtf,
            "coldProcessWallMs": _cold_wall_ms(scored[0][0]),
            "peakProcessRssBytes": peak_rss,
            "timelineErrors": timeline_errors,
            "semanticSpeechGapsAtLeast1500Ms": semantic_gaps,
            "excludedNonSemanticVocalizationGapsAtLeast1500Ms": excluded_gaps,
            "segmentCount": min(metrics["timeline"]["segmentCount"] for _, metrics in scored),
        },
        "gates": gates,
        "allApplicableGatesPass": all(value is not False for value in gates.values()),
        "ignoredRawSha256": raw_entry["sha256"],
    }


def require_preview(rows: list[dict[str, Any]]) -> None:
    actual = {
        (row["candidateId"], row["caseId"]): (
            round(row["measurements"]["cer"], 4),
            row["measurements"]["semanticSpeechGapsAtLeast1500Ms"],
            row["measurements"]["excludedNonSemanticVocalizationGapsAtLeast1500Ms"],
        )
        for row in rows
    }
    if actual != EXPECTED_PREVIEW:
        raise EvidenceError(f"corrected reassessment differs from the reviewed preview: {actual!r}")


def _candidate_dispositions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped = {candidate_id: [row for row in rows if row["candidateId"] == candidate_id] for candidate_id in SOURCES}
    selected_pass = all(row["allApplicableGatesPass"] for row in grouped["t06-selected-a"])
    return [
        {
            "candidateId": "t02-large-v3-fixed",
            "disposition": "historical-stop-revise",
            "reason": "short CER and medium/long semantic-gap gates still fail",
        },
        {
            "candidateId": "t02-kotoba-fixed",
            "disposition": "historical-stop-revise",
            "reason": "medium/long semantic-gap gates still fail",
        },
        {
            "candidateId": "t06-selected-a",
            "disposition": "corrected-large-v3-pass" if selected_pass else "stop-revise",
            "reason": "short/medium/long-v2 pass; full ordinary model qualification remains follow-up work" if selected_pass else "corrected large-v3 gate did not pass",
        },
        {
            "candidateId": "t06-candidate-b",
            "disposition": "diagnostic-only-no-long-run",
            "reason": "selected Candidate A passes, so Candidate B long is unnecessary and ORT/VAD is not a package input",
        },
        {
            "candidateId": "t08-kotoba-k1",
            "disposition": "stop-revise",
            "reason": "short and medium pass, but long-v2 retains seven semantic gaps",
        },
    ]


def assert_public(value: Any) -> None:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    repo_root = Path(__file__).resolve().parents[4]
    benchmark = _load_module("t08_privacy_benchmark", repo_root / "scripts/asr-benchmark.py")
    if benchmark.contains_machine_absolute_path(text):
        raise EvidenceError("sanitized publication contains a machine absolute path")
    for forbidden in ("referenceText", "referenceSegments", "speechIntervals", "tokenIds", "canonicalPath"):
        if forbidden in text:
            raise EvidenceError(f"sanitized publication contains private field: {forbidden}")


def render_report(evidence: dict[str, Any]) -> str:
    lines = [
        "# Corrected CTranslate2 Reassessment",
        "",
        "The current benchmark uses `long-v2`; archived long-v1 reports remain historical. Approved standalone vocalization gaps are diagnostic-only and remain included in CER.",
        "",
        "| Candidate | Case | CER | RTF | Semantic gaps | Excluded vocalization gaps | Timeline errors | Result |",
        "|---|---|---:|---:|---:|---:|---:|---|",
    ]
    for row in evidence["rows"]:
        measurements = row["measurements"]
        lines.append(
            f"| `{row['candidateId']}` | `{row['caseId']}` | `{measurements['cer']:.4f}` | "
            f"`{measurements['inferenceRtf']:.3f}` | {measurements['semanticSpeechGapsAtLeast1500Ms']} | "
            f"{measurements['excludedNonSemanticVocalizationGapsAtLeast1500Ms']} | "
            f"{measurements['timelineErrors']} | **{'pass' if row['allApplicableGatesPass'] else 'fail'}** |"
        )
    lines += ["", "## Corrected Dispositions", ""]
    for item in evidence["candidateDispositions"]:
        lines.append(f"- `{item['candidateId']}`: `{item['disposition']}` — {item['reason']}.")
    lines += [
        "",
        "## Boundary",
        "",
        "No inference was rerun. Candidate B long was not run. Release/default routing remains Python legacy; no production route, UI, downloader, installer, runtime pack, or package input was enabled.",
    ]
    return "\n".join(lines) + "\n"


def publish(manifest: Path, corpus_root: Path, correction_lock: Path, evidence_output: Path, report_output: Path) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[4]
    benchmark = _load_module("t08_corrected_benchmark", repo_root / "scripts/asr-benchmark.py")
    validation = benchmark.validate_manifest(manifest, corpus_root)
    if validation["manifestSha256"] != CURRENT_MANIFEST_SHA256 or validation["manifest"]["corpusId"] != CORPUS_ID:
        raise EvidenceError("current long-v2 manifest identity drifted")
    require_ignored_local(benchmark, OLD_MANIFEST, "historical manifest snapshot")
    require_ignored_local(benchmark, ORIGINAL_T08_ADAPTER, "original T08 adapter copy")
    correction_lock_text = correction_lock.read_text(encoding="utf-8")
    required_tool_hashes = [
        benchmark.sha256_file(Path(__file__).resolve()),
        benchmark.sha256_file(repo_root / "scripts/asr-benchmark.py"),
        benchmark.sha256_file(manifest),
        benchmark.sha256_file(OLD_MANIFEST),
        benchmark.sha256_file(repo_root / ".trellis/tasks/08-05-native-asr-kotoba-compatibility/research/kotoba_benchmark_adapter.py"),
        benchmark.sha256_file(repo_root / ".trellis/tasks/08-05-native-asr-kotoba-compatibility/research/publish_kotoba_candidate.py"),
    ]
    if any(identity not in correction_lock_text for identity in required_tool_hashes):
        raise EvidenceError("correction tool/manifest identity is not frozen by the correction lock")

    loaded = _validate_source_identities(repo_root, benchmark, correction_lock_text)
    cases = {case["id"]: case for case in validation["cases"]}
    rows = []
    for candidate_id, candidate in loaded.items():
        source = candidate["source"]
        for source_case_id, raw_entry in candidate["rows"].items():
            current_case_id = "long-v2" if source_case_id == "long-v1" else source_case_id
            case = cases.get(current_case_id)
            if case is None:
                raise EvidenceError(f"current authoritative case missing: {current_case_id}")
            row = _case_summary(benchmark, candidate_id, source_case_id, raw_entry, case, source["gate"])
            row.update(
                candidateId=candidate_id,
                sourceTask=source["task"],
                route=source["route"],
                sourceLockSha256=candidate["lockSha256"],
                sourceAdapterSha256=candidate["adapterSha256"],
            )
            rows.append(row)
    rows.sort(key=lambda row: (list(SOURCES).index(row["candidateId"]), ("short-v1", "medium-v1", "long-v2").index(row["caseId"])))
    require_preview(rows)

    policy = {
        "normalization": "NFKC; remove whitespace, Unicode punctuation/symbols, and ー/〜/~",
        "approvedUnits": ["あ", "う", "え", "お", "ん", "うん", "うあ"],
        "repeatRange": [1, 6],
        "exclusionRule": "every reference cue overlapping the uncovered region must be an approved standalone vocalization",
        "cerTreatment": "included",
    }
    evidence = {
        "schemaVersion": 1,
        "kind": "hikaru-ct2-corrected-reassessment",
        "manifests": {
            "historical": {"caseId": "long-v1", "sha256": OLD_MANIFEST_SHA256},
            "current": {"caseId": "long-v2", "sha256": CURRENT_MANIFEST_SHA256},
        },
        "correctionLockSha256": benchmark.sha256_file(correction_lock),
        "comparatorSha256": benchmark.sha256_file(repo_root / "scripts/asr-benchmark.py"),
        "publisherSha256": benchmark.sha256_file(Path(__file__).resolve()),
        "policy": policy,
        "rows": rows,
        "candidateDispositions": _candidate_dispositions(rows),
        "downstream": {
            "ordinaryLargeV3": "corrected-pass-follow-up-seven-model-qualification-required",
            "candidateB": "diagnostic-only-no-long-run-no-ort-package-input",
            "kotobaK1": "stop-revise-native-disabled",
            "releaseRouteEnabled": False,
        },
        "limitations": [
            "Historical runtime/resource gates remain task-specific; T02/T06 CPU rows are not subjected to T08 GPU RTF limits.",
            "The corpus still lacks low-volume coverage.",
            "T08 K1 remains a reviewed CUDA development-lane result, not a publishable runtime pack or production route.",
        ],
        "privacy": "sanitized identities, hashes, aggregate metrics, dispositions, and limitations only; no transcript, segments, token traces, absolute paths, models, binaries, or private media",
    }
    assert_public(evidence)
    report = render_report(evidence)
    assert_public(report)
    _write_json(evidence_output, evidence)
    _write(report_output, report.encode())
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--correction-lock", type=Path, required=True)
    parser.add_argument("--evidence-output", type=Path, required=True)
    parser.add_argument("--report-output", type=Path, required=True)
    args = parser.parse_args()
    try:
        evidence = publish(
            args.manifest,
            args.corpus_root,
            args.correction_lock,
            args.evidence_output,
            args.report_output,
        )
    except EvidenceError as error:
        print(json.dumps({"status": "no-result", "error": str(error)}, sort_keys=True))
        return 2
    print(json.dumps({"status": "published", "rows": len(evidence["rows"])}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
