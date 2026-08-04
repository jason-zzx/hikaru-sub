#!/usr/bin/env python3
"""Publish deterministic sanitized T06 short decode-selection evidence."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import statistics
import sys
from pathlib import Path

EXPECTED_CORPUS_ID = "hikaru-user-ja-ground-truth-v1"
EXPECTED_MANIFEST_SHA256 = "e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277"
EXPECTED_CASE_ID = "short-v1"
EXPECTED_AUDIO_SHA256 = "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211"
EXPECTED_ASS_SHA256 = "60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b"
EXPECTED_DURATION_MS = 24_102
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
EXPECTED_CONFIG_BASE = {
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
TIMELINE_ERROR_FIELDS = (
    "afterAudioEndCount",
    "emptyTextCount",
    "negativeStartCount",
    "nonMonotonicCount",
    "nonPositiveDurationCount",
)
TASK_LOCAL_ROOT = Path(__file__).resolve().parent / "local"


def load_benchmark(repo_root: Path):
    path = repo_root / "scripts" / "asr-benchmark.py"
    spec = importlib.util.spec_from_file_location("hikaru_asr_benchmark_decode_selection", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load T01 benchmark implementation")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def write_lf(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))


def require_task_local_ignored(benchmark, path: Path, label: str) -> None:
    resolved = path.resolve()
    try:
        relative = resolved.relative_to(TASK_LOCAL_ROOT.resolve())
    except ValueError as exc:
        raise ValueError(f"{label} must stay below the canonical T06 research/local root") from exc
    if not relative.parts:
        raise ValueError(f"{label} must name a file below the canonical T06 research/local root")
    benchmark._require_ignored_raw_output(resolved)


def validate_file_entries(entries: list[dict], expected: dict[str, tuple[int, str]], label: str) -> dict[str, dict]:
    files = {entry.get("name"): entry for entry in entries}
    if len(entries) != len(files) or set(files) != set(expected):
        raise ValueError(f"{label} file set mismatch")
    for name, (size, sha256) in expected.items():
        if files[name].get("sizeBytes") != size or files[name].get("sha256") != sha256:
            raise ValueError(f"{label} identity mismatch: {name}")
    return files


def timeline_error_count(timeline: dict) -> int:
    return sum(int(timeline.get(field, 0)) for field in TIMELINE_ERROR_FIELDS)


def distribution(benchmark, values: list[int]) -> dict:
    if not values:
        raise ValueError("decode selection produced no subtitle segments")
    return {
        "count": len(values),
        "minimum": min(values),
        "median": statistics.median(values),
        "p95": benchmark.percentile(values, 0.95),
        "maximum": max(values),
    }


def choose_lowest_cost_passing(rows: list[dict]) -> dict | None:
    passing = [row for row in rows if row["qualityPass"]]
    return min(passing, key=lambda row: (row["inferenceRtf"], row["beamSize"])) if passing else None


def self_check() -> None:
    rows = [
        {"beamSize": 1, "qualityPass": True, "inferenceRtf": 0.7},
        {"beamSize": 5, "qualityPass": True, "inferenceRtf": 0.9},
    ]
    assert choose_lowest_cost_passing(rows)["beamSize"] == 1
    rows[0]["qualityPass"] = False
    assert choose_lowest_cost_passing(rows)["beamSize"] == 5
    rows[1]["qualityPass"] = False
    assert choose_lowest_cost_passing(rows) is None
    print("decode-selection publisher self-check passed")


def validate_raw(benchmark, raw: dict, validation: dict, raw_path: Path) -> tuple[dict, dict, list[dict]]:
    require_task_local_ignored(benchmark, raw_path, "short decode raw evidence")
    if (
        raw.get("schemaVersion") != 1
        or raw.get("kind") != "hikaru-ct2-whisper-short-decode-selection"
        or raw.get("qualificationEligible") is not False
        or raw.get("status") != "completed"
    ):
        raise ValueError("short decode raw schema/status mismatch")

    source = raw.get("source", {})
    if source != {
        "corpusId": EXPECTED_CORPUS_ID,
        "manifestSha256": EXPECTED_MANIFEST_SHA256,
        "caseId": EXPECTED_CASE_ID,
        "audioSha256": EXPECTED_AUDIO_SHA256,
        "assSha256": EXPECTED_ASS_SHA256,
        "durationMs": EXPECTED_DURATION_MS,
    }:
        raise ValueError("short decode source identity mismatch")
    if validation.get("manifestSha256") != EXPECTED_MANIFEST_SHA256:
        raise ValueError("authoritative manifest identity mismatch")
    authoritative_case = next(
        (case for case in validation["cases"] if case["id"] == EXPECTED_CASE_ID), None
    )
    if authoritative_case is None or any(
        authoritative_case[key] != expected
        for key, expected in (
            ("audioSha256", EXPECTED_AUDIO_SHA256),
            ("assSha256", EXPECTED_ASS_SHA256),
            ("durationMs", EXPECTED_DURATION_MS),
        )
    ):
        raise ValueError("authoritative short-v1 identity mismatch")

    model = raw.get("model", {})
    if model.get("id") != EXPECTED_MODEL_ID or model.get("revision") != EXPECTED_MODEL_REVISION:
        raise ValueError("short decode model identity mismatch")
    model_files = validate_file_entries(model.get("files", []), EXPECTED_MODEL_FILES, "short decode model")

    runtime = raw.get("runtime", {})
    if (
        runtime.get("device") != "cpu"
        or runtime.get("computeType") != "int8"
        or runtime.get("ctranslate2Version") != "4.8.0"
    ):
        raise ValueError("short decode runtime config mismatch")
    executable = runtime.get("measurementExecutable", {})
    if executable.get("sizeBytes", 0) <= 0 or not re.fullmatch(
        r"[0-9a-f]{64}", executable.get("sha256", "")
    ):
        raise ValueError("short decode executable identity is missing")
    runtime_dlls = validate_file_entries(
        runtime.get("requiredDlls", []), EXPECTED_RUNTIME_DLLS, "short decode runtime"
    )
    if raw.get("probePolicy") != {
        "singleDeterministicSamplePerBeam": True,
        "onlyVariable": "beamSize",
        "conditionOnPreviousText": False,
        "timestampDrivenSeek": True,
    }:
        raise ValueError("short decode probe policy mismatch")

    rows = raw.get("rows", [])
    beams = [row.get("beamSize") for row in rows]
    if beams not in ([1, 5], [1, 3, 5, 10]):
        raise ValueError("short decode beam set is outside the reviewed bound")
    thread_identities = set()
    for row in rows:
        beam = row["beamSize"]
        expected_config = {"beamSize": beam, **EXPECTED_CONFIG_BASE}
        if row.get("config") != expected_config:
            raise ValueError(f"short decode config mismatch: beam {beam}")
        if row.get("status") != "completed" or row.get("failure") is not None:
            raise ValueError(f"short decode row did not complete: beam {beam}")
        segments = row.get("segments", [])
        traces = row.get("tokenTraces", [])
        if not segments or len(traces) != 1:
            raise ValueError(f"short decode row has incomplete private evidence: beam {beam}")
        trace = traces[0]
        if (
            trace.get("windowOffsetMs") != 0
            or trace.get("sourceWindowDurationMs") != EXPECTED_DURATION_MS
            or trace.get("modelWindowDurationMs") != 30_000
            or trace.get("historyTokenCountBefore") != 0
            or trace.get("historyTokenCountAfter") != 0
            or trace.get("promptTokenCount") != 3
            or trace.get("generationCallCount") != 1
            or trace.get("fallbackCallCount") != 0
            or not trace.get("tokenIds")
            or not re.fullmatch(r"[0-9a-f]{64}", trace.get("sha256", ""))
        ):
            raise ValueError(f"short decode trace contract mismatch: beam {beam}")
        trace_hash = trace["sha256"]
        if any(segment.get("traceSha256") != trace_hash for segment in segments):
            raise ValueError(f"short decode segment provenance mismatch: beam {beam}")
        timings = row.get("timings", {})
        expected_rtf = timings.get("inferenceMs", 0) / EXPECTED_DURATION_MS
        if (
            timings.get("loadMs", 0) <= 0
            or timings.get("sampleWallMs", 0) <= 0
            or timings.get("modelGenerateMs", 0) <= 0
            or abs(timings.get("inferenceRtf", 0) - expected_rtf) > 1e-12
        ):
            raise ValueError(f"short decode timing contract mismatch: beam {beam}")
        threads = row.get("threads", {})
        thread_identities.add(
            (threads.get("resolvedIntraThreads"), threads.get("resolvedInterThreads"))
        )
    if len(thread_identities) != 1 or any(value in (None, 0) for value in next(iter(thread_identities))):
        raise ValueError("short decode thread identity differs between beam probes")
    if raw.get("resources", {}).get("peakProcessRssBytes", 0) <= 0:
        raise ValueError("short decode peak RSS evidence is missing")
    return authoritative_case, {"model": model_files, "runtime": runtime_dlls}, rows


def render_report(evidence: dict) -> str:
    rows = evidence["rows"]
    selected = evidence["decision"]["selectedBeamSize"]
    if selected is None:
        decision = "**not-selected** — no bounded beam-only variant passed short-v1 quality gates."
        next_step = (
            "Next reviewed planning question: should T06 authorize a new authoritative decode candidate "
            "outside the bounded beam-only ladder? No medium/long/model-matrix run is authorized by this result."
        )
    else:
        decision = f"**selected for authoritative rerun: beam {selected}** — lowest-cost short quality pass."
        next_step = (
            "Freeze a new selected CPU candidate identity, rebuild production defaults if required, then run only "
            "authoritative short (1 cold + 3 warm) and medium (one measured sample)."
        )
    table_rows = "\n".join(
        f"| {row['beamSize']} | `{row['aggregates']['cer']:.4f}` | "
        f"`{row['aggregates']['inferenceRtf']:.3f}` | "
        f"{row['aggregates']['timelineErrors']} | "
        f"{row['aggregates']['confirmedSpeechGapsAtLeast1500Ms']} | "
        f"{row['aggregates']['subtitleDistribution']['durationMs']['count']} | "
        f"`{row['ignoredRaw']['rowSha256']}` | "
        f"{'pass' if row['qualityPass'] else 'fail'} |"
        for row in rows
    )
    runtime = evidence["rows"][0]["identity"]["runtime"]
    return f"""# T06 Large-v3 Short Decode Selection

## Decision

{decision}

{next_step}

This diagnostic changes only beam size. Every row uses timestamp-driven seek, `conditionOnPreviousText=false`, CPU int8, one deterministic authoritative short-v1 sample, no VAD, no fallback ladder, and no transcript prompt or repair. It is selection evidence, not qualification evidence.

## Bound Identities

- Manifest SHA-256: `{EXPECTED_MANIFEST_SHA256}`
- short-v1 WAV SHA-256: `{EXPECTED_AUDIO_SHA256}`
- short-v1 ASS SHA-256: `{EXPECTED_ASS_SHA256}`
- large-v3 revision: `{EXPECTED_MODEL_REVISION}`
- model.bin SHA-256: `{EXPECTED_MODEL_FILES['model.bin'][1]}`
- tokenizer.json SHA-256: `{EXPECTED_MODEL_FILES['tokenizer.json'][1]}`
- measurement executable SHA-256: `{runtime['measurementExecutable']['sha256']}`
- CTranslate2 DLL SHA-256: `{EXPECTED_RUNTIME_DLLS['ctranslate2.dll'][1]}`
- tokenizer DLL SHA-256: `{EXPECTED_RUNTIME_DLLS['hikaru_asr_tokenizer.dll'][1]}`
- ignored raw file SHA-256: `{evidence['ignoredRawFileSha256']}`
- publisher SHA-256: `{evidence['publisherSha256']}`

## Beam Probes

| Beam | CER | CPU inference RTF | Timeline errors | Gaps >=1.5s | Segments | Exact raw-row SHA-256 | Quality gate |
|---:|---:|---:|---:|---:|---:|---|---|
{table_rows}

Quality pass means CER `<=0.35`, zero timeline errors, and zero confirmed speech gaps. Lowest cost is the lowest measured inference RTF among quality-passing rows; final CPU qualification still requires the frozen short/medium reruns and all resource/performance gates.

## Privacy And Scope

Tracked output contains identities, aggregate metrics, subtitle distributions, hashes, and the decision only. Transcript text, token IDs, raw segments, absolute paths, model bytes, and private media remain under the canonical ignored T06 `research/local/` root. Release/default routing remains Python legacy.
"""


def main() -> int:
    if sys.argv[1:] == ["--self-check"]:
        self_check()
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--evidence-output", type=Path, required=True)
    parser.add_argument("--report-output", type=Path, required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[4]
    benchmark = load_benchmark(repo_root)
    validation = benchmark.validate_manifest(args.manifest, args.corpus_root)
    raw = json.loads(args.raw.read_text(encoding="utf-8"))
    authoritative_case, identities, raw_rows = validate_raw(benchmark, raw, validation, args.raw)
    reference = authoritative_case["reference"]
    raw_file_sha256 = sha256_file(args.raw)
    sanitized_rows = []
    for row in raw_rows:
        segments = [
            {"startMs": item["startMs"], "endMs": item["endMs"], "text": item["text"]}
            for item in row["segments"]
        ]
        metrics = benchmark._sample_metrics(
            reference["text"],
            reference["segments"],
            reference["speechIntervals"],
            segments,
            EXPECTED_DURATION_MS,
            "engine-native",
            "faster-whisper",
        )
        timeline_errors = timeline_error_count(metrics["timeline"])
        gap_count = len(metrics["missingSpeechRegions"])
        quality_pass = metrics["cer"]["cer"] <= 0.35 and timeline_errors == 0 and gap_count == 0
        config = row["config"]
        identity = {
            "source": raw["source"],
            "model": {
                "id": raw["model"]["id"],
                "revision": raw["model"]["revision"],
                "modelBinSha256": identities["model"]["model.bin"]["sha256"],
                "tokenizerJsonSha256": identities["model"]["tokenizer.json"]["sha256"],
            },
            "config": config,
            "configSha256": canonical_sha256(config),
            "runtime": {
                "measurementExecutable": raw["runtime"]["measurementExecutable"],
                "requiredDlls": raw["runtime"]["requiredDlls"],
                "tokenizerDllSha256": identities["runtime"]["hikaru_asr_tokenizer.dll"]["sha256"],
                "device": "cpu",
                "computeType": "int8",
                "ctranslate2Version": "4.8.0",
            },
        }
        durations = [segment["endMs"] - segment["startMs"] for segment in segments]
        characters = [len(segment["text"]) for segment in segments]
        sanitized_rows.append({
            "beamSize": row["beamSize"],
            "identity": identity,
            "ignoredRaw": {
                "fileSha256": raw_file_sha256,
                "rowSha256": canonical_sha256(row),
            },
            "aggregates": {
                "cer": metrics["cer"]["cer"],
                "inferenceRtf": row["timings"]["inferenceRtf"],
                "sampleWallMs": row["timings"]["sampleWallMs"],
                "peakProcessRssBytes": raw["resources"]["peakProcessRssBytes"],
                "timelineErrors": timeline_errors,
                "confirmedSpeechGapsAtLeast1500Ms": gap_count,
                "subtitleDistribution": {
                    "durationMs": distribution(benchmark, durations),
                    "characters": distribution(benchmark, characters),
                },
            },
            "qualityPass": quality_pass,
            "inferenceRtf": row["timings"]["inferenceRtf"],
        })

    selected = choose_lowest_cost_passing(sanitized_rows)
    evidence = {
        "schemaVersion": 1,
        "kind": "hikaru-ct2-whisper-short-decode-selection-sanitized",
        "qualificationEligible": False,
        "publisherSha256": sha256_file(Path(__file__)),
        "ignoredRawFileSha256": raw_file_sha256,
        "decision": {
            "status": "selected" if selected else "not-selected",
            "selectedBeamSize": None if selected is None else selected["beamSize"],
            "selectionRule": "lowest inference RTF among rows with CER<=0.35, zero timeline errors, and zero confirmed gaps>=1500ms",
            "nextReviewedPlanningQuestion": None if selected else (
                "Should T06 authorize a new authoritative decode candidate outside the bounded beam-only ladder?"
            ),
        },
        "rows": sanitized_rows,
        "privacy": "identities, aggregates, distributions, hashes, and decision only; no transcript, token IDs, paths, model bytes, or private media",
    }
    for row in evidence["rows"]:
        row.pop("inferenceRtf")
    write_lf(
        args.evidence_output,
        json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n",
    )
    write_lf(args.report_output, render_report(evidence))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
