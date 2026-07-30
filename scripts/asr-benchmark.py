#!/usr/bin/env python3
"""Dependency-free Japanese ASR benchmark contract and registry runner."""

from __future__ import annotations

import time

PROCESS_START = time.perf_counter()

import argparse
import contextlib
import ctypes
import datetime as dt
import difflib
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import re
import shlex
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import unicodedata
import wave
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Sequence

REPO_ROOT = Path(__file__).resolve().parents[1]
ASR_SERVICE_ROOT = REPO_ROOT / "asr-service"
RESULT_KIND = "hikaru-asr-benchmark-result"
SCHEMA_VERSION = 1
CANDIDATE_KINDS = ("native-candidate", "python-reference")
REFERENCE_DERIVATION_TYPE = "ass-dialogue-v1"
AUTHORIZATION_STATUSES = ("redistributable", "private-use-authorized")
CHILD_SENTINEL = "HIKARU_ASR_BENCHMARK_RESULT="
REQUIRED_ENGINES = (
    "faster-whisper",
    "kotoba-faster-whisper",
    "parakeet",
    "qwen3-asr",
    "reazonspeech-nemo",
)
REQUIRED_COVERAGE_TAGS = {
    "clear-japanese",
    "long-silence",
    "background-noise",
    "rapid-dialogue",
    "continuous-speech-over-30s",
    "low-volume",
    "numbers",
    "english",
    "person-names",
    "proper-nouns",
}
PACKAGE_NAMES = (
    "av",
    "ctranslate2",
    "faster-whisper",
    "huggingface-hub",
    "nemo-toolkit",
    "numpy",
    "qwen-asr",
    "safetensors",
    "tokenizers",
    "torch",
    "transformers",
)
STABLE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
MANIFEST_FIELDS = {"schemaVersion", "corpusId", "description", "cases"}
CASE_FIELDS = {
    "id",
    "audio",
    "ass",
    "audioSha256",
    "assSha256",
    "durationMs",
    "sampleRate",
    "channels",
    "sampleWidthBits",
    "durationClass",
    "dialogueCount",
    "tags",
    "source",
    "license",
    "authorizationStatus",
    "referenceDerivation",
}
REFERENCE_DERIVATION_FIELDS = {"type", "speechConfirmation"}
PUBLIC_ERROR_NOTES = {
    "dependency-unavailable": "engine dependency is not installed in this Python environment",
    "dependency-check-failed": "engine dependency availability could not be checked",
    "model-not-cached": "model cache is not ready; the benchmark runner does not download models",
    "model-cache-check-failed": "model cache readiness could not be verified",
    "model-load-failed": "the cached model could not be loaded",
    "inference-failed": "the engine failed while transcribing or consuming final segments",
    "child-process-error": "the isolated benchmark child did not return a valid result",
    "invalid-engine-or-request": "the engine ID or child request was invalid",
}


class ContractError(ValueError):
    """Invalid benchmark manifest or result contract."""


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_japanese_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", str(text).replace("\r\n", "\n").replace("\r", "\n"))
    return "".join(char for char in normalized if not char.isspace())


ASS_OVERRIDE_RE = re.compile(r"\{[^}]*\}")
ASS_TIME_RE = re.compile(r"^(\d+):(\d{2}):(\d{2})[.](\d{2})$")


def _ass_text(value: str) -> str:
    return ASS_OVERRIDE_RE.sub("", value).replace(r"\N", "\n").replace(r"\n", "\n").replace(r"\h", " ")


def _ass_time_ms(value: str) -> int:
    match = ASS_TIME_RE.fullmatch(value.strip())
    if match is None:
        raise ContractError(f"invalid ASS timestamp: {value!r}")
    hours, minutes, seconds, centiseconds = (int(part) for part in match.groups())
    if minutes >= 60 or seconds >= 60:
        raise ContractError(f"invalid ASS timestamp: {value!r}")
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + centiseconds * 10


def parse_ass_reference(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ContractError(f"cannot read ASS reference: {exc}") from exc
    encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
    try:
        text = raw.decode(encoding)
    except UnicodeDecodeError as exc:
        raise ContractError("ASS reference must be UTF-8 or BOM-marked UTF-16") from exc

    in_events = False
    fields: list[str] | None = None
    segments: list[dict[str, Any]] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            in_events = stripped.casefold() == "[events]"
            fields = None
            continue
        if not in_events:
            continue
        key, separator, value = line.partition(":")
        if not separator:
            if stripped.casefold().startswith("dialogue"):
                raise ContractError(f"malformed ASS Dialogue at line {line_number}")
            continue
        event_type = key.strip().casefold()
        if event_type == "format":
            fields = [item.strip().casefold() for item in value.split(",")]
            if not fields or any(not field for field in fields) or len(fields) != len(set(fields)):
                raise ContractError(f"invalid ASS [Events] Format at line {line_number}")
            if not {"start", "end", "text"}.issubset(fields) or fields[-1] != "text":
                raise ContractError("ASS [Events] Format must define Start, End, and final Text before Dialogue")
            continue
        if event_type != "dialogue":
            continue
        if not fields:
            raise ContractError("ASS [Events] Format must define Start, End, and final Text before Dialogue")
        values = value.lstrip().split(",", len(fields) - 1)
        if len(values) != len(fields):
            raise ContractError(f"ASS Dialogue at line {line_number} does not match the Events Format")
        event = dict(zip(fields, values))
        start_ms = _ass_time_ms(event["start"])
        end_ms = _ass_time_ms(event["end"])
        dialogue_text = _ass_text(event["text"])
        if end_ms <= start_ms:
            raise ContractError(f"ASS Dialogue at line {line_number} must have start < end")
        if not normalize_japanese_text(dialogue_text):
            raise ContractError(f"ASS Dialogue at line {line_number} has empty text after normalization")
        segments.append(
            {
                "startMs": start_ms,
                "endMs": end_ms,
                "text": dialogue_text,
                "speech": True,
                "sourceLine": line_number,
            }
        )
    if not segments:
        raise ContractError("ASS reference must contain at least one Dialogue event")
    segments.sort(key=lambda item: (item["startMs"], item["endMs"], item["sourceLine"]))
    for segment in segments:
        segment.pop("sourceLine")
    reference_text = "".join(segment["text"] for segment in segments)
    speech_intervals = [
        {"startMs": start, "endMs": end}
        for start, end in _merge_ranges((segment["startMs"], segment["endMs"]) for segment in segments)
    ]
    return {
        "text": reference_text,
        "segments": segments,
        "speechIntervals": speech_intervals,
        "dialogueCount": len(segments),
        "textSha256": sha256_bytes(reference_text.encode("utf-8")),
        "normalizedTextSha256": sha256_bytes(normalize_japanese_text(reference_text).encode("utf-8")),
    }


def contains_machine_absolute_path(value: str) -> bool:
    text = str(value)
    if re.search(r"(?i)(?<![A-Za-z0-9])[A-Z]:[\\/]", text) or "\\\\" in text:
        return True
    if re.search(r"(?<![:/\w])/(?:[^/\s\"'<>]+/)+[^/\s\"'<>]+", text):
        return True
    return re.search(
        r"(?i)(?<![:/\w])/(?:home|users|tmp|var|mnt|opt|etc|private|volumes|root|srv|data|workspace)(?:/|\b)",
        text,
    ) is not None


def _manifest_absolute_path_fields(value: Any, field: str = "manifest") -> list[str]:
    if isinstance(value, dict):
        return [
            path
            for key, child in value.items()
            for path in _manifest_absolute_path_fields(child, f"{field}.{key}")
        ]
    if isinstance(value, list):
        return [
            path
            for index, child in enumerate(value)
            for path in _manifest_absolute_path_fields(child, f"{field}[{index}]")
        ]
    return [field] if isinstance(value, str) and contains_machine_absolute_path(value) else []


def levenshtein_counts(reference: str, hypothesis: str) -> dict[str, int | float]:
    """Return exact deterministic S/D/I counts using an exact widening DP band."""
    reference = str(reference)
    hypothesis = str(hypothesis)
    reference_count = len(reference)
    hypothesis_count = len(hypothesis)
    if reference == hypothesis:
        substitutions = deletions = insertions = distance = 0
    elif not reference:
        substitutions = deletions = 0
        insertions = distance = hypothesis_count
    elif not hypothesis:
        substitutions = insertions = 0
        deletions = distance = reference_count
    else:
        band = max(1, abs(reference_count - hypothesis_count))
        maximum_band = max(reference_count, hypothesis_count)
        while True:
            previous: dict[int, tuple[int, int, int, int]] = {
                index: (index, 0, 0, index) for index in range(min(hypothesis_count, band) + 1)
            }
            for reference_index in range(1, reference_count + 1):
                start = max(0, reference_index - band)
                end = min(hypothesis_count, reference_index + band)
                current: dict[int, tuple[int, int, int, int]] = {}
                if start == 0:
                    current[0] = (reference_index, 0, reference_index, 0)
                for hypothesis_index in range(max(1, start), end + 1):
                    candidates: list[tuple[int, int, int, int, int]] = []
                    diagonal = previous.get(hypothesis_index - 1)
                    if diagonal is not None:
                        edit, substitutions, deletions, insertions = diagonal
                        if reference[reference_index - 1] == hypothesis[hypothesis_index - 1]:
                            candidates.append((edit, 0, substitutions, deletions, insertions))
                        else:
                            candidates.append((edit + 1, 0, substitutions + 1, deletions, insertions))
                    deletion = previous.get(hypothesis_index)
                    if deletion is not None:
                        edit, substitutions, deletions, insertions = deletion
                        candidates.append((edit + 1, 1, substitutions, deletions + 1, insertions))
                    insertion = current.get(hypothesis_index - 1)
                    if insertion is not None:
                        edit, substitutions, deletions, insertions = insertion
                        candidates.append((edit + 1, 2, substitutions, deletions, insertions + 1))
                    edit, _rank, substitutions, deletions, insertions = min(
                        candidates, key=lambda item: (item[0], item[1])
                    )
                    current[hypothesis_index] = (edit, substitutions, deletions, insertions)
                previous = current
            final = previous.get(hypothesis_count)
            if final is not None and final[0] <= band:
                distance, substitutions, deletions, insertions = final
                break
            if band >= maximum_band:  # pragma: no cover - a full band always contains an optimal path
                raise AssertionError("Levenshtein DP did not reach the target")
            band = min(maximum_band, band * 2)
    return {
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
        "referenceCharacters": reference_count,
        "errors": distance,
        "cer": distance / reference_count if reference_count else math.nan,
    }


def cer_metrics(reference: str, hypothesis: str) -> dict[str, Any]:
    normalized_reference = normalize_japanese_text(reference)
    normalized_hypothesis = normalize_japanese_text(hypothesis)
    if not normalized_reference:
        raise ContractError("CER reference text is empty after normalization")
    metrics = levenshtein_counts(normalized_reference, normalized_hypothesis)
    metrics.update(
        {
            "referenceRawSha256": sha256_bytes(reference.encode("utf-8")),
            "hypothesisRawSha256": sha256_bytes(hypothesis.encode("utf-8")),
            "referenceNormalizedSha256": sha256_bytes(normalized_reference.encode("utf-8")),
            "hypothesisNormalizedSha256": sha256_bytes(normalized_hypothesis.encode("utf-8")),
        }
    )
    return metrics


def percentile(values: Sequence[float | int], quantile: float) -> float | None:
    """Linear percentile using index (n - 1) * q."""
    if not 0 <= quantile <= 1:
        raise ValueError("quantile must be between 0 and 1")
    if not values:
        return None
    ordered = sorted(float(value) for value in values)
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _segment_dict(segment: Any) -> dict[str, Any]:
    if isinstance(segment, dict):
        return {
            "startMs": int(segment["startMs"]),
            "endMs": int(segment["endMs"]),
            "text": str(segment.get("text", "")),
        }
    return {
        "startMs": int(segment.start_ms),
        "endMs": int(segment.end_ms),
        "text": str(segment.text or ""),
    }


def reduce_segment_events(events: Iterable[Any], refresh_type: type | tuple[type, ...] | None = None) -> list[dict[str, Any]]:
    final: list[dict[str, Any]] = []
    iterator = iter(events)
    try:
        for event in iterator:
            is_refresh = isinstance(event, refresh_type) if refresh_type is not None else False
            if is_refresh:
                final = [_segment_dict(segment) for segment in event.segments]
            else:
                final.append(_segment_dict(event))
    finally:
        close = getattr(iterator, "close", None)
        if close is not None:
            close()
    return final


def timeline_metrics(segments: Sequence[dict[str, Any]], duration_ms: int) -> dict[str, int]:
    empty_text = invalid_range = negative_start = after_duration = non_monotonic = 0
    previous_start: int | None = None
    for segment in segments:
        start = int(segment["startMs"])
        end = int(segment["endMs"])
        if not str(segment.get("text", "")).strip():
            empty_text += 1
        if end <= start:
            invalid_range += 1
        if start < 0:
            negative_start += 1
        if end > duration_ms:
            after_duration += 1
        if previous_start is not None and start < previous_start:
            non_monotonic += 1
        previous_start = start
    return {
        "segmentCount": len(segments),
        "emptyTextCount": empty_text,
        "nonPositiveDurationCount": invalid_range,
        "negativeStartCount": negative_start,
        "afterAudioEndCount": after_duration,
        "nonMonotonicCount": non_monotonic,
    }


def _merge_ranges(ranges: Iterable[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[list[int]] = []
    for start, end in sorted(ranges):
        if end <= start:
            continue
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return [(start, end) for start, end in merged]


def missing_speech_regions(
    speech_intervals: Sequence[dict[str, Any]],
    hypothesis_segments: Sequence[dict[str, Any]],
    *,
    minimum_gap_ms: int = 1500,
) -> list[dict[str, int]]:
    confirmed = _merge_ranges(
        (int(interval["startMs"]), int(interval["endMs"]))
        for interval in speech_intervals
        if interval.get("speech", True) and int(interval["endMs"]) > int(interval["startMs"])
    )
    coverage = _merge_ranges(
        (int(segment["startMs"]), int(segment["endMs"]))
        for segment in hypothesis_segments
        if int(segment["endMs"]) > int(segment["startMs"])
        and normalize_japanese_text(segment.get("text", ""))
    )
    missing: list[dict[str, int]] = []
    for index, (reference_start, reference_end) in enumerate(confirmed):
        pieces = [(reference_start, reference_end)]
        for covered_start, covered_end in coverage:
            next_pieces: list[tuple[int, int]] = []
            for start, end in pieces:
                if covered_end <= start or covered_start >= end:
                    next_pieces.append((start, end))
                    continue
                if covered_start > start:
                    next_pieces.append((start, min(end, covered_start)))
                if covered_end < end:
                    next_pieces.append((max(start, covered_end), end))
            pieces = next_pieces
        for start, end in pieces:
            if end - start >= minimum_gap_ms:
                missing.append(
                    {
                        "speechIntervalIndex": index,
                        "startMs": start,
                        "endMs": end,
                        "durationMs": end - start,
                    }
                )
    return missing


def timing_metrics(
    reference_segments: Sequence[dict[str, Any]],
    hypothesis_segments: Sequence[dict[str, Any]],
    timestamp_provenance: str,
    engine_name: str,
) -> dict[str, Any]:
    eligible = timestamp_provenance == "forced-aligner" if engine_name == "qwen3-asr" else timestamp_provenance in {
        "forced-aligner",
        "engine-native",
    }
    reference_count = sum(
        bool(item.get("speech")) and bool(normalize_japanese_text(item.get("text", "")))
        for item in reference_segments
    )
    if not eligible:
        reason = (
            f"qwen3 timing requires forced-aligner provenance, got {timestamp_provenance}"
            if engine_name == "qwen3-asr"
            else f"timestamp provenance is {timestamp_provenance}"
        )
        return {
            "eligible": False,
            "unavailableReason": reason,
            "matchedCount": 0,
            "unmatchedReferenceCount": reference_count,
            "unmatchedHypothesisCount": len(hypothesis_segments),
            "medianStartErrorMs": None,
            "p95StartErrorMs": None,
        }

    reference_text = ""
    reference_spans: list[tuple[int, int, dict[str, Any]]] = []
    for segment in reference_segments:
        normalized = normalize_japanese_text(segment.get("text", ""))
        start = len(reference_text)
        reference_text += normalized
        reference_spans.append((start, len(reference_text), segment))

    hypothesis_text = ""
    hypothesis_char_owners: list[int] = []
    for index, segment in enumerate(hypothesis_segments):
        normalized = normalize_japanese_text(segment.get("text", ""))
        hypothesis_text += normalized
        hypothesis_char_owners.extend([index] * len(normalized))

    reference_to_hypothesis: dict[int, int] = {}
    for block in difflib.SequenceMatcher(None, reference_text, hypothesis_text, autojunk=False).get_matching_blocks():
        for offset in range(block.size):
            reference_to_hypothesis[block.a + offset] = block.b + offset

    matched_hypothesis_indexes = {
        hypothesis_char_owners[index]
        for index in reference_to_hypothesis.values()
        if index < len(hypothesis_char_owners)
    }
    errors: list[int] = []
    unmatched = 0
    for start, end, reference in reference_spans:
        if not reference.get("speech", False) or start == end:
            continue
        hypothesis_char = next(
            (reference_to_hypothesis[index] for index in range(start, end) if index in reference_to_hypothesis),
            None,
        )
        if hypothesis_char is None or hypothesis_char >= len(hypothesis_char_owners):
            unmatched += 1
            continue
        hypothesis_index = hypothesis_char_owners[hypothesis_char]
        errors.append(abs(int(hypothesis_segments[hypothesis_index]["startMs"]) - int(reference["startMs"])))
    return {
        "eligible": True,
        "unavailableReason": None,
        "matchedCount": len(errors),
        "unmatchedReferenceCount": unmatched,
        "unmatchedHypothesisCount": len(hypothesis_segments) - len(matched_hypothesis_indexes),
        "medianStartErrorMs": statistics.median(errors) if errors else None,
        "p95StartErrorMs": percentile(errors, 0.95),
    }


def duration_class(duration_ms: int) -> str | None:
    if duration_ms < 30_000:
        return "short"
    if 300_000 <= duration_ms <= 900_000:
        return "medium"
    if duration_ms > 3_600_000:
        return "long"
    return None


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"cannot read manifest: {exc}") from exc
    if not isinstance(data, dict):
        raise ContractError("manifest root must be an object")
    return data


def _resolve_relative_key(root: Path, value: Any, field: str, errors: list[str]) -> tuple[str | None, Path | None]:
    if not isinstance(value, str) or not value:
        errors.append(f"{field} is required")
        return None, None
    pure = PurePosixPath(value)
    if (
        pure.is_absolute()
        or re.match(r"^[A-Za-z]:", value)
        or ".." in pure.parts
        or "." in pure.parts
        or pure.as_posix() != value
        or any(char in value for char in ':*?"<>|')
        or "\\" in value
        or "\x00" in value
    ):
        errors.append(f"{field} must be a safe POSIX relative key")
        return None, None
    try:
        resolved = (root / Path(*pure.parts)).resolve()
        resolved.relative_to(root)
    except (OSError, ValueError):
        errors.append(f"{field} resolves outside corpus root")
        return value, None
    return value, resolved


def validate_manifest(path: Path, corpus_root: Path | None = None) -> dict[str, Any]:
    manifest = load_manifest(path)
    root = (corpus_root or path.parent).resolve()
    errors: list[str] = []
    warnings: list[str] = []
    for field in _manifest_absolute_path_fields(manifest):
        errors.append(f"{field} must not contain a machine absolute path")
    unknown_manifest_fields = sorted(set(manifest) - MANIFEST_FIELDS)
    if unknown_manifest_fields:
        errors.append(f"manifest contains unsupported fields: {', '.join(unknown_manifest_fields)}")
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(f"schemaVersion must be {SCHEMA_VERSION}")
    corpus_id_value = manifest.get("corpusId")
    corpus_id = corpus_id_value.strip() if isinstance(corpus_id_value, str) else ""
    if not corpus_id:
        errors.append("corpusId is required and must be a string")
    elif not STABLE_ID_RE.fullmatch(corpus_id):
        errors.append("corpusId must use only letters, digits, dot, underscore, and hyphen")
    if not isinstance(manifest.get("description"), str) or not manifest["description"].strip():
        errors.append("description is required and must be a non-empty string")
    cases = manifest.get("cases")
    if not isinstance(cases, list) or not cases:
        errors.append("cases must be a non-empty array")
        cases = []

    seen_ids: set[str] = set()
    seen_tags: set[str] = set()
    validated_cases: list[dict[str, Any]] = []
    for index, case in enumerate(cases):
        prefix = f"cases[{index}]"
        if not isinstance(case, dict):
            errors.append(f"{prefix} must be an object")
            continue
        forbidden_reference_fields = sorted({"referenceText", "referenceSegments", "speechIntervals"} & set(case))
        if forbidden_reference_fields:
            errors.append(
                f"{prefix} must derive private reference data from ASS, not store: {', '.join(forbidden_reference_fields)}"
            )
        unknown_case_fields = sorted(set(case) - CASE_FIELDS - set(forbidden_reference_fields))
        if unknown_case_fields:
            errors.append(f"{prefix} contains unsupported fields: {', '.join(unknown_case_fields)}")
        case_id_value = case.get("id")
        case_id = case_id_value.strip() if isinstance(case_id_value, str) else ""
        if not case_id:
            errors.append(f"{prefix}.id is required and must be a string")
        elif not STABLE_ID_RE.fullmatch(case_id):
            errors.append(f"{prefix}.id must use only letters, digits, dot, underscore, and hyphen")
        elif case_id in seen_ids:
            errors.append(f"{prefix}.id is duplicated: {case_id}")
        seen_ids.add(case_id)

        audio_key, audio_path = _resolve_relative_key(root, case.get("audio"), f"{prefix}.audio", errors)
        ass_key, ass_path = _resolve_relative_key(root, case.get("ass"), f"{prefix}.ass", errors)
        declared_duration = case.get("durationMs")
        if not isinstance(declared_duration, int) or isinstance(declared_duration, bool) or declared_duration <= 0:
            errors.append(f"{prefix}.durationMs must be a positive integer")
            declared_duration = 0
        expected_class = duration_class(declared_duration) if declared_duration else None
        if expected_class is None:
            errors.append(f"{prefix}.durationMs is outside the supported short/medium/long classes")
        elif case.get("durationClass") != expected_class:
            errors.append(f"{prefix}.durationClass must be {expected_class}")
        if case.get("sampleRate") != 16_000:
            errors.append(f"{prefix}.sampleRate must be 16000")
        if case.get("channels") != 1:
            errors.append(f"{prefix}.channels must be 1")
        if case.get("sampleWidthBits") != 16:
            errors.append(f"{prefix}.sampleWidthBits must be 16")
        expected_audio_hash = case.get("audioSha256")
        if not isinstance(expected_audio_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_audio_hash):
            errors.append(f"{prefix}.audioSha256 must be a lowercase SHA-256")
        expected_ass_hash = case.get("assSha256")
        if not isinstance(expected_ass_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_ass_hash):
            errors.append(f"{prefix}.assSha256 must be a lowercase SHA-256")
        dialogue_count = case.get("dialogueCount")
        if not isinstance(dialogue_count, int) or isinstance(dialogue_count, bool) or dialogue_count <= 0:
            errors.append(f"{prefix}.dialogueCount must be a positive integer")

        tags = case.get("tags")
        if not isinstance(tags, list) or not tags or not all(isinstance(tag, str) and tag for tag in tags):
            errors.append(f"{prefix}.tags must be a non-empty string array")
        else:
            unknown_tags = sorted(set(tags) - REQUIRED_COVERAGE_TAGS)
            if unknown_tags:
                errors.append(f"{prefix}.tags contains unknown coverage labels: {', '.join(unknown_tags)}")
            if len(tags) != len(set(tags)):
                errors.append(f"{prefix}.tags must not contain duplicates")
            seen_tags.update(tags)
        source_value = case.get("source")
        source = source_value.strip() if isinstance(source_value, str) else ""
        if not source or source.lower() in {"unknown", "unspecified"}:
            errors.append(f"{prefix}.source must be an explicit string")
        license_value = case.get("license")
        license_name = license_value.strip() if isinstance(license_value, str) else ""
        if not license_name or license_name.lower() in {"unknown", "unspecified"}:
            errors.append(f"{prefix}.license must be an explicit string")
        if case.get("authorizationStatus") not in AUTHORIZATION_STATUSES:
            errors.append(f"{prefix}.authorizationStatus must be one of: {', '.join(AUTHORIZATION_STATUSES)}")
        derivation = case.get("referenceDerivation")
        if not isinstance(derivation, dict):
            errors.append(f"{prefix}.referenceDerivation must be an object")
            derivation = {}
        unknown_derivation_fields = sorted(set(derivation) - REFERENCE_DERIVATION_FIELDS)
        if unknown_derivation_fields:
            errors.append(
                f"{prefix}.referenceDerivation contains unsupported fields: {', '.join(unknown_derivation_fields)}"
            )
        if derivation.get("type") != REFERENCE_DERIVATION_TYPE:
            errors.append(f"{prefix}.referenceDerivation.type must be {REFERENCE_DERIVATION_TYPE}")
        if derivation.get("speechConfirmation") != "confirmed":
            errors.append(f"{prefix}.referenceDerivation.speechConfirmation must be confirmed")

        if audio_path is not None:
            if not audio_path.is_file():
                errors.append(f"{prefix}.audio does not exist under corpus root")
            else:
                try:
                    actual_hash = sha256_file(audio_path)
                    if isinstance(expected_audio_hash, str) and actual_hash != expected_audio_hash:
                        errors.append(f"{prefix}.audioSha256 does not match audio")
                    with wave.open(str(audio_path), "rb") as audio:
                        sample_rate = audio.getframerate()
                        actual_duration = round(audio.getnframes() * 1000 / sample_rate) if sample_rate > 0 else None
                        if audio.getcomptype() != "NONE":
                            errors.append(f"{prefix}.audio must be uncompressed PCM WAV")
                        if sample_rate != 16_000 or audio.getnchannels() != 1 or audio.getsampwidth() != 2:
                            errors.append(f"{prefix}.audio must be 16 kHz 16-bit mono PCM WAV")
                        if actual_duration is None:
                            errors.append(f"{prefix}.audio has an invalid zero sample rate")
                        elif declared_duration and abs(actual_duration - declared_duration) > 1:
                            errors.append(f"{prefix}.durationMs does not match WAV duration ({actual_duration})")
                except (OSError, wave.Error, EOFError) as exc:
                    errors.append(f"{prefix}.audio is not a readable WAV: {exc}")

        reference: dict[str, Any] | None = None
        if ass_path is not None:
            if not ass_path.is_file():
                errors.append(f"{prefix}.ass does not exist under corpus root")
            else:
                try:
                    actual_ass_hash = sha256_file(ass_path)
                    if isinstance(expected_ass_hash, str) and actual_ass_hash != expected_ass_hash:
                        errors.append(f"{prefix}.assSha256 does not match ASS")
                    reference = parse_ass_reference(ass_path)
                    if isinstance(dialogue_count, int) and reference["dialogueCount"] != dialogue_count:
                        errors.append(f"{prefix}.dialogueCount does not match ASS ({reference['dialogueCount']})")
                    for segment_index, segment in enumerate(reference["segments"]):
                        if declared_duration and segment["endMs"] > declared_duration:
                            errors.append(f"{prefix} ASS Dialogue[{segment_index}].endMs exceeds durationMs")
                except ContractError as exc:
                    errors.append(f"{prefix}.ass is invalid: {exc}")
                except OSError as exc:
                    errors.append(f"{prefix}.ass cannot be hashed: {exc}")

        if reference is not None and audio_key is not None and ass_key is not None:
            derived = dict(case)
            derived["reference"] = reference
            validated_cases.append(derived)

    missing_tags = sorted(REQUIRED_COVERAGE_TAGS - seen_tags)
    if missing_tags:
        warnings.append("corpus does not yet cover required tags: " + ", ".join(missing_tags))
    present_classes = {case.get("durationClass") for case in cases if isinstance(case, dict)}
    missing_classes = sorted({"short", "medium", "long"} - present_classes)
    if missing_classes:
        warnings.append("corpus does not yet cover duration classes: " + ", ".join(missing_classes))
    if errors:
        raise ContractError("\n".join(errors))
    return {
        "manifest": manifest,
        "manifestSha256": sha256_file(path),
        "corpusRoot": root,
        "cases": validated_cases,
        "warnings": warnings,
    }


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n"
    atomic_write_text(path, payload)


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temporary_name)
        raise


def _git_metadata() -> dict[str, Any]:
    def run(*arguments: str) -> str | None:
        try:
            completed = subprocess.run(
                ["git", *arguments], cwd=REPO_ROOT, text=True, capture_output=True, timeout=10, check=True
            )
            return completed.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return None

    revision = run("rev-parse", "HEAD")
    status = run("status", "--porcelain")
    return {
        "revision": revision,
        "dirty": None if status is None else bool(status),
        "unavailableReason": None if revision is not None and status is not None else "git command unavailable",
    }


def _total_memory_bytes() -> tuple[int | None, str | None]:
    if os.name == "nt":
        class MemoryStatusEx(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        value = MemoryStatusEx()
        value.dwLength = ctypes.sizeof(value)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)):
            return int(value.ullTotalPhys), None
        return None, "GlobalMemoryStatusEx failed"
    try:
        return int(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")), None
    except (AttributeError, OSError, ValueError):
        return None, "platform memory query unavailable"


def _gpu_metadata() -> dict[str, Any]:
    executable = shutil.which("nvidia-smi")
    if executable is not None:
        try:
            completed = subprocess.run(
                [
                    executable,
                    "--query-gpu=name,driver_version,memory.total",
                    "--format=csv,noheader,nounits",
                ],
                text=True,
                capture_output=True,
                timeout=10,
                check=True,
            )
            devices = []
            for line in completed.stdout.splitlines():
                fields = [field.strip() for field in line.split(",")]
                if len(fields) >= 3:
                    devices.append({"name": fields[0], "driverVersion": fields[1], "memoryTotalMiB": int(fields[2])})
            return {
                "devices": devices or None,
                "method": "nvidia-smi",
                "unavailableReason": None if devices else "nvidia-smi returned no devices",
            }
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            nvidia_reason = f"nvidia-smi query failed: {type(exc).__name__}"
    else:
        nvidia_reason = "nvidia-smi not found"

    if os.name == "nt":
        powershell = shutil.which("powershell") or shutil.which("pwsh")
        if powershell is not None:
            try:
                completed = subprocess.run(
                    [
                        powershell,
                        "-NoProfile",
                        "-NonInteractive",
                        "-Command",
                        "Get-CimInstance Win32_VideoController | "
                        "Select-Object Name,DriverVersion,AdapterRAM | ConvertTo-Json -Compress",
                    ],
                    text=True,
                    capture_output=True,
                    timeout=15,
                    check=True,
                )
                payload = json.loads(completed.stdout)
                entries = payload if isinstance(payload, list) else [payload]
                devices = []
                for entry in entries:
                    if not isinstance(entry, dict) or not entry.get("Name"):
                        continue
                    adapter_ram = entry.get("AdapterRAM")
                    devices.append(
                        {
                            "name": str(entry["Name"]),
                            "driverVersion": str(entry.get("DriverVersion") or "unknown"),
                            "memoryTotalMiB": round(int(adapter_ram) / (1024 * 1024))
                            if isinstance(adapter_ram, int) and adapter_ram > 0
                            else None,
                        }
                    )
                return {
                    "devices": devices or None,
                    "method": "PowerShell Win32_VideoController",
                    "unavailableReason": None if devices else "Win32_VideoController returned no devices",
                }
            except (OSError, subprocess.SubprocessError, json.JSONDecodeError, TypeError, ValueError) as exc:
                return {
                    "devices": None,
                    "method": "PowerShell Win32_VideoController",
                    "unavailableReason": f"{nvidia_reason}; Windows GPU query failed: {type(exc).__name__}",
                }
        return {"devices": None, "method": None, "unavailableReason": f"{nvidia_reason}; PowerShell not found"}
    return {"devices": None, "method": None, "unavailableReason": nvidia_reason}


def _package_versions() -> dict[str, str | None]:
    versions: dict[str, str | None] = {}
    for name in PACKAGE_NAMES:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    return versions


def environment_metadata() -> dict[str, Any]:
    memory, memory_reason = _total_memory_bytes()
    processor = platform.processor() or os.environ.get("PROCESSOR_IDENTIFIER") or "unknown"
    return {
        "os": platform.system(),
        "osRelease": platform.release(),
        "architecture": platform.machine(),
        "cpu": processor,
        "logicalCores": os.cpu_count(),
        "totalMemoryBytes": memory,
        "totalMemoryUnavailableReason": memory_reason,
        "gpu": _gpu_metadata(),
        "python": platform.python_version(),
        "packages": _package_versions(),
        "git": _git_metadata(),
    }


def _peak_rss() -> tuple[int | None, str, str | None]:
    if os.name == "nt":
        class ProcessMemoryCountersEx(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
                ("PrivateUsage", ctypes.c_size_t),
            ]

        counters = ProcessMemoryCountersEx()
        counters.cb = ctypes.sizeof(counters)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.GetCurrentProcess.argtypes = []
        kernel32.GetCurrentProcess.restype = ctypes.c_void_p
        psapi.GetProcessMemoryInfo.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ProcessMemoryCountersEx),
            ctypes.c_ulong,
        ]
        psapi.GetProcessMemoryInfo.restype = ctypes.c_int
        process = kernel32.GetCurrentProcess()
        if psapi.GetProcessMemoryInfo(process, ctypes.byref(counters), counters.cb):
            return int(counters.PeakWorkingSetSize), "Windows PeakWorkingSetSize", None
        return None, "Windows PeakWorkingSetSize", f"GetProcessMemoryInfo failed (winerror={ctypes.get_last_error()})"
    try:
        import resource

        value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        multiplier = 1 if sys.platform == "darwin" else 1024
        return int(value * multiplier), "getrusage(RUSAGE_SELF).ru_maxrss", None
    except (ImportError, OSError, ValueError) as exc:
        return None, "getrusage(RUSAGE_SELF).ru_maxrss", type(exc).__name__


class _VramSampler:
    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled
        self.executable = shutil.which("nvidia-smi") if enabled else None
        self.peak_mib: int | None = None
        self.reason = None if self.executable else ("device is not CUDA" if not enabled else "nvidia-smi not found")
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self.executable is None:
            return
        self._thread = threading.Thread(target=self._sample_loop, daemon=True)
        self._thread.start()

    def _sample_loop(self) -> None:
        while not self._stop.is_set():
            try:
                completed = subprocess.run(
                    [
                        self.executable,
                        "--query-compute-apps=pid,used_gpu_memory",
                        "--format=csv,noheader,nounits",
                    ],
                    text=True,
                    capture_output=True,
                    timeout=5,
                    check=True,
                )
                for line in completed.stdout.splitlines():
                    fields = [field.strip() for field in line.split(",")]
                    if len(fields) >= 2 and int(fields[0]) == os.getpid():
                        value = int(fields[1])
                        self.peak_mib = value if self.peak_mib is None else max(self.peak_mib, value)
            except (OSError, subprocess.SubprocessError, ValueError):
                self.reason = "nvidia-smi process sampling failed"
            self._stop.wait(0.25)

    def stop(self) -> dict[str, Any]:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
        if self.executable is not None and self.peak_mib is None and self.reason is None:
            self.reason = "process was not visible in nvidia-smi samples"
        return {
            "peakVramBytes": None if self.peak_mib is None else self.peak_mib * 1024 * 1024,
            "method": "nvidia-smi compute-app polling at 250 ms" if self.executable else None,
            "unavailableReason": self.reason,
        }


def _hf_revision(model_id: str) -> tuple[str | None, str | None]:
    if Path(model_id).is_dir():
        config = Path(model_id) / "config.json"
        return (f"local-config-sha256:{sha256_file(config)}", None) if config.is_file() else (None, "local config.json not found")
    if "/" not in model_id:
        return None, "model alias does not expose a cache revision"
    cache_root = Path(
        os.environ.get("HF_HUB_CACHE")
        or (Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")) / "hub")
    )
    reference = cache_root / ("models--" + model_id.replace("/", "--")) / "refs" / "main"
    try:
        revision = reference.read_text(encoding="utf-8").strip()
    except OSError:
        return None, "Hugging Face refs/main not found"
    return (revision, None) if revision else (None, "Hugging Face refs/main is empty")


def _model_revision_key(engine: Any, model: str) -> str:
    if Path(model).is_dir():
        return model
    module = sys.modules.get(engine.__class__.__module__)
    resolver = getattr(module, "_model_repo", None) if module else None
    if callable(resolver):
        with contextlib.suppress(Exception):
            return str(resolver(model))
    return model


def _model_cache_metadata(engine: Any, model: str) -> dict[str, Any]:
    try:
        downloaded: bool | None = bool(engine.is_model_downloaded(model))
        check_reason = None
    except Exception as exc:  # noqa: BLE001
        downloaded = None
        check_reason = f"model readiness check failed: {type(exc).__name__}"
    revision_key = _model_revision_key(engine, model)
    if downloaded is True:
        revision, revision_reason = _hf_revision(revision_key)
    elif downloaded is False:
        revision, revision_reason = None, "model is not cached"
    else:
        revision, revision_reason = None, "model readiness is unknown"
    companions: dict[str, Any] = {}
    module = sys.modules.get(engine.__class__.__module__)
    companion_id = getattr(module, "ALIGNER_MODEL_ID", None) if module else None
    if companion_id:
        if downloaded is True:
            companion_revision, companion_reason = _hf_revision(companion_id)
        elif downloaded is False:
            companion_revision, companion_reason = None, "model is not cached"
        else:
            companion_revision, companion_reason = None, "model readiness is unknown"
        companions[companion_id] = {"revision": companion_revision, "unavailableReason": companion_reason}
    return {
        "status": "ready" if downloaded is True else "missing" if downloaded is False else "unknown",
        "checkUnavailableReason": check_reason,
        "revision": revision,
        "revisionUnavailableReason": revision_reason,
        "companions": companions,
    }


def _force_offline_model_loading() -> None:
    for name in (
        "HF_HUB_OFFLINE",
        "HF_DATASETS_OFFLINE",
        "TRANSFORMERS_OFFLINE",
        "HF_HUB_DISABLE_TELEMETRY",
    ):
        os.environ[name] = "1"


def _engine_parameters(engine_name: str, engine: Any) -> dict[str, Any]:
    module = sys.modules.get(engine.__class__.__module__)
    device = str(getattr(engine, "device", "unknown"))
    requested_compute = getattr(engine, "compute_type", None)
    if engine_name in {"faster-whisper", "kotoba-faster-whisper"}:
        if requested_compute and requested_compute not in {"auto", "default"}:
            effective_compute = requested_compute
        elif device == "cpu":
            effective_compute = "int8"
        elif device == "cuda":
            effective_compute = "float16"
        else:
            effective_compute = "default"
        engine_specific: dict[str, Any] = {"beamSize": 5, "vadFilter": True}
        if engine_name == "kotoba-faster-whisper":
            engine_specific.update({"chunkLengthSeconds": 15, "conditionOnPreviousText": False})
    elif engine_name == "qwen3-asr":
        effective_compute = "bfloat16" if device == "cuda" else "float32"
        engine_specific = {
            "chunkMs": getattr(module, "CHUNK_MS", None),
            "chunkOverlapMs": getattr(module, "CHUNK_OVERLAP_MS", None),
            "maxNewTokens": getattr(module, "DEFAULT_MAX_NEW_TOKENS", None),
            "forcedAligner": getattr(module, "ALIGNER_MODEL_ID", None),
        }
    elif engine_name == "parakeet":
        effective_compute = "float32"
        engine_specific = {
            "chunkingMinDurationMs": getattr(module, "CHUNKING_MIN_DURATION_MS", None),
            "chunkMs": getattr(module, "DEFAULT_CHUNK_MS", None),
            "chunkOverlapMs": getattr(module, "DEFAULT_CHUNK_OVERLAP_MS", None),
            "backfillMinGapMs": getattr(module, "DEFAULT_BACKFILL_MIN_GAP_MS", None),
            "backfillMinUncoveredMs": getattr(module, "DEFAULT_BACKFILL_MIN_UNCOVERED_MS", None),
        }
    else:
        effective_compute = "float32"
        engine_specific = {
            "padSeconds": getattr(module, "PAD_SECONDS", None),
            "secondsPerStep": getattr(module, "SECONDS_PER_STEP", None),
            "subwordsPerSegment": getattr(module, "SUBWORDS_PER_SEGMENTS", None),
            "phonemicBreakSeconds": getattr(module, "PHONEMIC_BREAK", None),
        }
    use_vad = bool(getattr(engine, "use_vad", False))
    vad_config = dict(getattr(engine, "vad_config", {}) or {})
    return {
        "resolvedDevice": device,
        "requestedComputeType": requested_compute,
        "effectiveComputeType": effective_compute,
        "useVad": use_vad,
        "vadConfig": vad_config,
        "engineSpecific": engine_specific,
    }


def _redact_error(text: Any) -> str:
    value = str(text).replace("\r", " ").replace("\n", " ")
    value = re.sub(r"(?i)https?://[^\s\"'<>]+", "<url>", value)
    value = re.sub(r"(?i)\bBearer\s+[^\s,;]+", "Bearer <redacted>", value)
    value = re.sub(
        r"(?i)\b(authorization|api[-_]?key|access[-_]?token|token|password|secret)\b\s*[:=]\s*[^\s,;]+",
        lambda match: f"{match.group(1)}=<redacted>",
        value,
    )
    for private_root in (str(REPO_ROOT), str(Path.home()), tempfile.gettempdir()):
        if private_root:
            value = re.sub(re.escape(private_root), "<path>", value, flags=re.IGNORECASE)
    value = re.sub(r"(?i)(?:[A-Z]:[\\/]|\\\\)[^\"'\r\n<>|]*", "<path>", value)
    value = re.sub(r"(?<![\w.])/(?:[^\s\"'<>|]+/)*[^\s\"'<>|]*", "<path>", value)
    return value[:1000]


def _timestamp_tracker(engine_name: str, engine: Any) -> tuple[dict[str, list[str]], Any]:
    state: dict[str, list[str]] = {"observations": []}
    if engine_name != "qwen3-asr" or not hasattr(engine, "_segments_from_result"):
        return state, None
    module = sys.modules.get(engine.__class__.__module__)
    extractor = getattr(module, "_extract_char_timestamps", None) if module else None
    if extractor is None:
        return state, None
    original = engine._segments_from_result

    def tracked(result: Any, *, fallback_duration_ms: int) -> Any:
        state["observations"].append("forced-aligner" if extractor(result) else "synthetic")
        return original(result, fallback_duration_ms=fallback_duration_ms)

    engine._segments_from_result = tracked
    return state, original


def _timestamp_provenance(engine_name: str, observations: Sequence[str]) -> str:
    if engine_name == "qwen3-asr":
        values = set(observations)
        if values == {"forced-aligner"}:
            return "forced-aligner"
        if values == {"synthetic"}:
            return "synthetic"
        if values:
            return "mixed"
        return "unknown"
    if engine_name in {"faster-whisper", "kotoba-faster-whisper", "reazonspeech-nemo"}:
        return "engine-native"
    return "engine-native-or-synthetic-fallback"


def _resource_metadata(vram: _VramSampler | None) -> dict[str, Any]:
    vram_result = (
        vram.stop()
        if vram is not None
        else {"peakVramBytes": None, "method": None, "unavailableReason": "sampling was not started"}
    )
    peak_rss, rss_method, rss_reason = _peak_rss()
    return {
        "peakProcessRssBytes": peak_rss,
        "peakProcessRssMethod": rss_method,
        "peakProcessRssUnavailableReason": rss_reason,
        "vram": vram_result,
    }


def _sample_metrics(
    reference_text: str,
    reference_segments: Sequence[dict[str, Any]],
    speech_intervals: Sequence[dict[str, Any]],
    segments: list[dict[str, Any]],
    duration_ms: int,
    timestamp_provenance: str,
    engine_name: str,
) -> dict[str, Any]:
    hypothesis = "".join(segment["text"] for segment in segments)
    normalized_hypothesis = normalize_japanese_text(hypothesis)
    return {
        "segments": segments,
        "text": {
            "hypothesis": hypothesis,
            "normalizedHypothesis": normalized_hypothesis,
            "hypothesisRawSha256": sha256_bytes(hypothesis.encode("utf-8")),
            "hypothesisNormalizedSha256": sha256_bytes(normalized_hypothesis.encode("utf-8")),
        },
        "cer": cer_metrics(reference_text, hypothesis),
        "timeline": timeline_metrics(segments, duration_ms),
        "missingSpeechRegions": missing_speech_regions(speech_intervals, segments),
        "timestampProvenance": timestamp_provenance,
        "timingAccuracy": timing_metrics(reference_segments, segments, timestamp_provenance, engine_name),
    }


def _child_main() -> int:
    response: dict[str, Any] = {"schemaVersion": SCHEMA_VERSION, "status": "failed", "samples": []}
    engine = None
    tracker: dict[str, list[str]] = {"observations": []}
    original_tracker = None
    vram: _VramSampler | None = None
    stage = "request"
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ContractError("child request must be an object")
        mode = request.get("mode")
        repeat_count = request.get("repeatCount", 1)
        if mode not in {"cold", "warm"} or not isinstance(repeat_count, int) or isinstance(repeat_count, bool) or repeat_count <= 0:
            raise ContractError("child mode must be cold/warm and repeatCount must be a positive integer")
        if request.get("engine") not in REQUIRED_ENGINES:
            raise ContractError("child engine must be one of the registered benchmark engines")
        if not isinstance(request.get("durationMs"), int) or isinstance(request.get("durationMs"), bool) or request["durationMs"] <= 0:
            raise ContractError("child durationMs must be a positive integer")
        hf_home = request.get("hfHome")
        if hf_home is not None:
            if not isinstance(hf_home, str) or not hf_home:
                raise ContractError("child hfHome must be a non-empty string when provided")
            os.environ["HF_HOME"] = hf_home
        _force_offline_model_loading()
        if str(ASR_SERVICE_ROOT) not in sys.path:
            sys.path.insert(0, str(ASR_SERVICE_ROOT))

        stage = "registry-import"
        import_started = time.perf_counter()
        from engines.base import TranscriptSegmentRefresh
        from engines.registry import create_engine
        import_ms = (time.perf_counter() - import_started) * 1000
        response["registryImportMs"] = round(import_ms, 3)
        response["startupImportMs"] = round((time.perf_counter() - PROCESS_START) * 1000, 3)

        stage = "engine-create"
        engine = create_engine(
            request["engine"],
            request["model"],
            request["device"],
            request.get("computeType"),
            request.get("useVad", False),
            request.get("vadConfig") or {},
        )

        stage = "dependency-check"
        dependency_started = time.perf_counter()
        available = bool(engine.is_available())
        response["dependencyCheckMs"] = round((time.perf_counter() - dependency_started) * 1000, 3)
        response["dependencyAvailable"] = available
        response["resolvedParameters"] = _engine_parameters(request["engine"], engine)

        stage = "model-cache-check"
        cache_started = time.perf_counter()
        response["modelCache"] = _model_cache_metadata(engine, request["model"])
        response["modelCacheCheckMs"] = round((time.perf_counter() - cache_started) * 1000, 3)

        if not available:
            response.update(
                {
                    "status": "skipped",
                    "error": {
                        "classification": "dependency-unavailable",
                        "message": PUBLIC_ERROR_NOTES["dependency-unavailable"],
                    },
                }
            )
        elif response["modelCache"]["status"] == "unknown":
            response["error"] = {
                "classification": "model-cache-check-failed",
                "message": response["modelCache"]["checkUnavailableReason"] or PUBLIC_ERROR_NOTES["model-cache-check-failed"],
            }
        elif response["modelCache"]["status"] != "ready":
            response.update(
                {
                    "status": "skipped",
                    "error": {
                        "classification": "model-not-cached",
                        "message": PUBLIC_ERROR_NOTES["model-not-cached"],
                    },
                }
            )
        else:
            tracker, original_tracker = _timestamp_tracker(request["engine"], engine)
            vram = _VramSampler(request["device"] == "cuda")
            vram.start()

            stage = "model-load"
            load_started = time.perf_counter()
            engine.load()
            load_ms = (time.perf_counter() - load_started) * 1000
            response["preparation"] = {"loadMs": round(load_ms, 3)}
            response["resolvedParameters"] = _engine_parameters(request["engine"], engine)

            for repeat_index in range(repeat_count):
                stage = "inference"
                inference_started = time.perf_counter()
                transcription = engine.transcribe(request["audioPath"], language=request.get("language", "ja"))
                segments = reduce_segment_events(transcription.segments, TranscriptSegmentRefresh)
                inference_ms = (time.perf_counter() - inference_started) * 1000

                stage = "metrics"
                provenance = _timestamp_provenance(request["engine"], tracker["observations"])
                metrics = _sample_metrics(
                    request["referenceText"],
                    request["referenceSegments"],
                    request["speechIntervals"],
                    segments,
                    request["durationMs"],
                    provenance,
                    request["engine"],
                )
                inference_and_metrics_ms = (time.perf_counter() - inference_started) * 1000
                metrics.update(
                    {
                        "status": "completed",
                        "runKind": mode,
                        "repeatIndex": repeat_index + 1,
                        "detectedLanguage": transcription.language,
                        "detectedLanguageUnavailableReason": None
                        if transcription.language is not None
                        else "engine did not report a language",
                        "reportedDurationMs": transcription.duration_ms,
                        "timings": {
                            "startupImportMs": response["startupImportMs"]
                            if mode == "cold" and repeat_index == 0
                            else None,
                            "loadMs": round(load_ms, 3) if mode == "cold" and repeat_index == 0 else None,
                            "inferenceMs": round(inference_ms, 3),
                            "totalMs": round(inference_and_metrics_ms, 3),
                            "inferenceRtf": inference_ms / request["durationMs"],
                            "totalRtf": inference_and_metrics_ms / request["durationMs"],
                        },
                    }
                )
                response["samples"].append(metrics)
                tracker["observations"].clear()

            benchmark_total_ms = (time.perf_counter() - PROCESS_START) * 1000
            if mode == "cold" and response["samples"]:
                cold_timing = response["samples"][0]["timings"]
                cold_timing["inferenceAndMetricsMs"] = cold_timing["totalMs"]
                cold_timing["totalMs"] = round(benchmark_total_ms, 3)
                cold_timing["totalRtf"] = benchmark_total_ms / request["durationMs"]
            response["status"] = "completed"
    except (ContractError, json.JSONDecodeError, TypeError, ValueError) as exc:
        response["error"] = {"classification": "invalid-engine-or-request", "message": _redact_error(exc)}
    except KeyError as exc:
        response["error"] = {"classification": "invalid-engine-or-request", "message": _redact_error(exc)}
    except Exception as exc:  # noqa: BLE001
        classification = {
            "engine-create": "invalid-engine-or-request",
            "dependency-check": "dependency-check-failed",
            "model-cache-check": "model-cache-check-failed",
            "model-load": "model-load-failed",
            "inference": "inference-failed",
            "metrics": "benchmark-metric-error",
        }.get(stage, "engine-error")
        response["error"] = {"classification": classification, "message": _redact_error(exc)}
    finally:
        if engine is not None and original_tracker is not None:
            engine._segments_from_result = original_tracker
        with contextlib.suppress(Exception):
            response["resources"] = _resource_metadata(vram)
        with contextlib.suppress(Exception):
            response["environment"] = environment_metadata()
    response.setdefault("environment", {"unavailableReason": "environment metadata collection failed"})
    response.setdefault(
        "resources",
        {
            "peakProcessRssBytes": None,
            "peakProcessRssMethod": None,
            "peakProcessRssUnavailableReason": "resource measurement failed",
            "vram": {"peakVramBytes": None, "method": None, "unavailableReason": "resource measurement failed"},
        },
    )
    return _emit_child(response)


def _emit_child(response: dict[str, Any]) -> int:
    print(CHILD_SENTINEL + json.dumps(response, ensure_ascii=False, sort_keys=True, allow_nan=False))
    return 0


def _invoke_child(request: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "_engine-child"],
            input=json.dumps(request, ensure_ascii=False),
            text=True,
            capture_output=True,
            cwd=REPO_ROOT,
            timeout=None,
        )
    except OSError as exc:
        return {
            "schemaVersion": SCHEMA_VERSION,
            "status": "failed",
            "environment": environment_metadata(),
            "samples": [],
            "error": {"classification": "child-process-error", "message": _redact_error(exc)},
            "processWallMs": round((time.perf_counter() - started) * 1000, 3),
        }
    wall_ms = (time.perf_counter() - started) * 1000
    response = None
    for line in reversed(completed.stdout.splitlines()):
        if line.startswith(CHILD_SENTINEL):
            try:
                response = json.loads(line[len(CHILD_SENTINEL) :])
            except json.JSONDecodeError:
                response = None
            break
    if response is None:
        return {
            "schemaVersion": SCHEMA_VERSION,
            "status": "failed",
            "environment": environment_metadata(),
            "samples": [],
            "error": {
                "classification": "child-process-error",
                "message": f"benchmark child exited {completed.returncode} without a result; stderr={_redact_error(completed.stderr)}",
            },
            "processWallMs": round(wall_ms, 3),
        }
    response["processWallMs"] = round(wall_ms, 3)
    return response


def _reproduction_command(args: argparse.Namespace, case_id: str, warm_runs: int) -> str:
    pieces = [
        "PATH_TO_DEVELOPMENT_PYTHON",
        "scripts/asr-benchmark.py",
        "run",
        "--manifest",
        "PATH_TO_MANIFEST.json",
        "--corpus-root",
        "PATH_TO_CORPUS_ROOT",
        "--expected-interpreter",
        "PATH_TO_DEVELOPMENT_PYTHON",
        "--hf-home",
        "PATH_TO_HF_HOME",
        "--case",
        case_id,
        "--engine",
        args.engine,
        "--model",
        args.model,
        "--device",
        args.device,
        "--language",
        args.language,
        "--warm-runs",
        str(warm_runs),
        "--output",
        "PATH_TO_IGNORED_RESULT.json",
    ]
    if args.compute_type:
        pieces.extend(["--compute-type", args.compute_type])
    if args.use_vad:
        pieces.append("--use-vad")
    return subprocess.list2cmdline(pieces) if os.name == "nt" else shlex.join(pieces)


def _case_result(
    case: dict[str, Any],
    audio_path: Path,
    args: argparse.Namespace,
    warm_runs: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    reference = case["reference"]
    request = {
        "engine": args.engine,
        "model": args.model,
        "device": args.device,
        "computeType": args.compute_type,
        "language": args.language,
        "useVad": args.use_vad,
        "vadConfig": {},
        "audioPath": str(audio_path),
        "durationMs": case["durationMs"],
        "referenceText": reference["text"],
        "referenceSegments": reference["segments"],
        "speechIntervals": reference["speechIntervals"],
        "hfHome": getattr(args, "hf_home", None),
        "mode": "cold",
        "repeatCount": 1,
    }
    cold = _invoke_child(request)
    samples = list(cold.get("samples", []))
    warm = None
    if cold.get("status") == "completed" and warm_runs:
        warm_request = dict(request, mode="warm", repeatCount=warm_runs)
        warm = _invoke_child(warm_request)
        samples.extend(warm.get("samples", []))
    status = cold.get("status", "failed")
    error = cold.get("error")
    if warm is not None and warm.get("status") != "completed":
        status = "failed"
        error = warm.get("error")
    warm_rtfs = [sample["timings"]["inferenceRtf"] for sample in samples if sample.get("runKind") == "warm"]
    result = {
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
        "status": status,
        "error": error,
        "dependencyAvailable": cold.get("dependencyAvailable"),
        "modelCache": cold.get("modelCache"),
        "reproductionCommand": _reproduction_command(args, case["id"], warm_runs),
        "sampleCount": len(samples),
        "samples": samples,
        "coldProcess": {
            "startupImportMs": cold.get("startupImportMs"),
            "registryImportMs": cold.get("registryImportMs"),
            "dependencyCheckMs": cold.get("dependencyCheckMs"),
            "modelCacheCheckMs": cold.get("modelCacheCheckMs"),
            "processWallMs": cold.get("processWallMs"),
            "resolvedParameters": cold.get("resolvedParameters"),
            "preparation": cold.get("preparation")
            or {"loadMs": None, "loadUnavailableReason": "run did not reach model load"},
            "resources": cold.get("resources")
            or {
                "peakProcessRssBytes": None,
                "peakProcessRssMethod": None,
                "peakProcessRssUnavailableReason": "run did not reach inference",
                "vram": {"peakVramBytes": None, "method": None, "unavailableReason": "run did not reach inference"},
            },
        },
        "warmProcess": None
        if warm is None
        else {
            "startupImportMs": warm.get("startupImportMs"),
            "registryImportMs": warm.get("registryImportMs"),
            "dependencyCheckMs": warm.get("dependencyCheckMs"),
            "modelCacheCheckMs": warm.get("modelCacheCheckMs"),
            "processWallMs": warm.get("processWallMs"),
            "resolvedParameters": warm.get("resolvedParameters"),
            "preparation": warm.get("preparation"),
            "resources": warm.get("resources"),
        },
        "warmInferenceRtfMedian": statistics.median(warm_rtfs) if warm_rtfs else None,
        "warmSampleCount": len(warm_rtfs),
    }
    return result, cold.get("environment") or environment_metadata()


def _require_ignored_raw_output(path: Path) -> None:
    resolved = path.resolve()
    try:
        relative = resolved.relative_to(REPO_ROOT)
    except ValueError:
        return
    try:
        completed = subprocess.run(
            ["git", "check-ignore", "--quiet", "--no-index", relative.as_posix()],
            cwd=REPO_ROOT,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ContractError(f"cannot verify that raw output is ignored: {exc}") from exc
    if completed.returncode != 0:
        raise ContractError("raw result output inside the repository must be covered by .gitignore")


def command_run(args: argparse.Namespace) -> int:
    _require_ignored_raw_output(Path(args.output))
    expected_interpreter = Path(args.expected_interpreter).resolve()
    actual_interpreter = Path(sys.executable).resolve()
    if expected_interpreter != actual_interpreter:
        raise ContractError(
            "current interpreter does not match --expected-interpreter; invoke the benchmark with the Hikaru Sub development Python"
        )
    manifest_path = Path(args.manifest)
    validation = validate_manifest(manifest_path, Path(args.corpus_root) if args.corpus_root else None)
    manifest = validation["manifest"]
    selected = [case for case in validation["cases"] if args.case in (None, case["id"])]
    if not selected:
        raise ContractError(f"case not found: {args.case}")
    case_results = []
    environment = None
    for case in selected:
        warm_runs = args.warm_runs if args.warm_runs is not None else (3 if case["durationClass"] == "short" else 0)
        if warm_runs < 0:
            raise ContractError("--warm-runs cannot be negative")
        audio_path = validation["corpusRoot"] / Path(*PurePosixPath(case["audio"]).parts)
        case_result, case_environment = _case_result(case, audio_path, args, warm_runs)
        case_results.append(case_result)
        environment = environment or case_environment
    generated_at = utc_now()
    result = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": RESULT_KIND,
        "candidateKind": "python-reference",
        "runId": sha256_bytes(
            f"{generated_at}|{validation['manifestSha256']}|{args.engine}|{args.model}|{args.device}".encode("utf-8")
        )[:20],
        "generatedAt": generated_at,
        "manifest": {
            "corpusId": manifest["corpusId"],
            "manifestKey": manifest_path.name,
            "sha256": validation["manifestSha256"],
            "durationClasses": sorted({case["durationClass"] for case in manifest["cases"]}),
            "coverageTags": sorted({tag for case in manifest["cases"] for tag in case["tags"]}),
            "validationWarnings": validation["warnings"],
        },
        "engine": args.engine,
        "model": args.model,
        "device": args.device,
        "computeType": args.compute_type,
        "language": args.language,
        "useVad": args.use_vad,
        "vadConfig": {},
        "runtime": {
            "interpreter": str(actual_interpreter),
            "expectedInterpreter": str(expected_interpreter),
            "interpreterMatches": True,
            "hfHome": str(Path(args.hf_home).resolve()),
            "cacheExplicit": True,
        },
        "environment": environment or environment_metadata(),
        "cases": case_results,
    }
    atomic_write_json(Path(args.output), result)
    statuses = ", ".join(f"{case['caseId']}={case['status']}" for case in case_results)
    print(f"wrote {args.output}: {statuses}")
    return 0


def _load_results(path: Path) -> list[dict[str, Any]]:
    files = [path] if path.is_file() else sorted(path.glob("*.json"))
    results = []
    for file in files:
        try:
            value = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ContractError(f"cannot read result {file.name}: {exc}") from exc
        if not isinstance(value, dict):
            raise ContractError(f"result {file.name} root must be an object")
        if value.get("kind") != RESULT_KIND or value.get("schemaVersion") != SCHEMA_VERSION:
            continue
        if value.get("candidateKind") not in CANDIDATE_KINDS:
            raise ContractError(f"result {file.name} candidateKind must be native-candidate or python-reference")
        results.append(value)
    if not results:
        raise ContractError("no schema-version 1 benchmark result JSON files found")
    return results


def _markdown_text(value: Any) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("|", "\\|")
        .replace("\r", " ")
        .replace("\n", " ")
    )


def _markdown_code(value: Any) -> str:
    return "`" + _markdown_text(value).replace("`", "'") + "`"


def _public_model(value: Any) -> str:
    redacted = _redact_error(value)
    return "<redacted-model>" if "<path>" in redacted or "<url>" in redacted or "<redacted>" in redacted else redacted


def _public_identifier(value: Any) -> str:
    text = str(value)
    return text if STABLE_ID_RE.fullmatch(text) else "<redacted-id>"


def _public_error_note(classification: str) -> str:
    return PUBLIC_ERROR_NOTES.get(classification, "diagnostic details remain only in the ignored result JSON")


def _format_number(value: Any, digits: int = 3) -> str:
    if value is None:
        return "—"
    return f"{float(value):.{digits}f}"


def render_markdown(results: Sequence[dict[str, Any]]) -> str:
    rows: list[dict[str, Any]] = []
    for result in results:
        for case in result.get("cases", []):
            cold = next((sample for sample in case.get("samples", []) if sample.get("runKind") == "cold"), None)
            rows.append(
                {
                    "candidateKind": result.get("candidateKind", "python-reference"),
                    "engine": result["engine"],
                    "model": result["model"],
                    "device": result["device"],
                    "manifest": result.get("manifest") or {},
                    "case": case,
                    "cold": cold,
                }
            )
    rows.sort(key=lambda row: (REQUIRED_ENGINES.index(row["engine"]) if row["engine"] in REQUIRED_ENGINES else 99, row["case"]["caseId"], row["device"], row["model"]))
    lines = [
        "# ASR Benchmark Results",
        "",
        "> Generated deterministically from schema-version 1 benchmark JSON. Ground-truth references come only from validated WAV+ASS; do not edit metrics by hand.",
        "",
        "## Candidate Status",
        "",
        "| Kind | Engine | Model | Device | Case | Class | Status | CER | Timeline errors | Confirmed gaps >=1.5s | Cold total RTF | Warm inference RTF median | Timestamp provenance | Qwen start median ms | Qwen start P95 ms |",
        "|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|",
    ]
    for row in rows:
        case = row["case"]
        cold = row["cold"]
        timeline = cold.get("timeline", {}) if cold else {}
        timeline_errors = sum(
            int(timeline.get(field, 0) or 0)
            for field in (
                "emptyTextCount",
                "nonPositiveDurationCount",
                "negativeStartCount",
                "afterAudioEndCount",
                "nonMonotonicCount",
            )
        )
        timing = cold.get("timingAccuracy", {}) if cold and row["engine"] == "qwen3-asr" else {}
        lines.append(
            "| {candidate_kind} | {engine} | `{model}` | {device} | `{case_id}` | {duration_class} | {status} | {cer} | {timeline_errors} | {gap_count} | {total_rtf} | {warm_rtf} | {provenance} | {timing_median} | {timing_p95} |".format(
                candidate_kind=_markdown_text(row["candidateKind"]),
                engine=_markdown_text(_public_identifier(row["engine"])),
                model=_markdown_text(_public_model(row["model"])).replace("`", "'"),
                device=_markdown_text(_public_identifier(row["device"])),
                case_id=_markdown_text(_public_identifier(case["caseId"])).replace("`", "'"),
                duration_class=_markdown_text(case["durationClass"]),
                status=_markdown_text(case["status"]),
                cer=_format_number(cold.get("cer", {}).get("cer") if cold else None),
                timeline_errors=timeline_errors if cold else "—",
                gap_count=len(cold.get("missingSpeechRegions", [])) if cold else "—",
                total_rtf=_format_number(cold.get("timings", {}).get("totalRtf") if cold else None),
                warm_rtf=_format_number(case.get("warmInferenceRtfMedian")),
                provenance=_markdown_text(cold.get("timestampProvenance", "—") if cold else "—"),
                timing_median=_format_number(timing.get("medianStartErrorMs"), 1),
                timing_p95=_format_number(timing.get("p95StartErrorMs"), 1),
            )
        )
    lines.extend(
        [
            "",
            "## Manifest Evidence",
            "",
            "| Corpus | Manifest SHA-256 |",
            "|---|---|",
        ]
    )
    seen_manifests: set[tuple[str, str]] = set()
    for row in rows:
        manifest = row["manifest"]
        corpus_id = _public_identifier(manifest.get("corpusId", "<missing>"))
        manifest_sha = str(manifest.get("sha256", ""))
        public_sha = manifest_sha if re.fullmatch(r"[0-9a-f]{64}", manifest_sha) else "<redacted-hash>"
        key = (corpus_id, public_sha)
        if key in seen_manifests:
            continue
        seen_manifests.add(key)
        lines.append(f"| {_markdown_code(corpus_id)} | {_markdown_code(public_sha)} |")
    lines.extend(["", "## Corpus Evidence", "", "| Case | WAV SHA-256 | ASS SHA-256 | Duration ms | Dialogue count | Tags |", "|---|---|---|---:|---:|---|"])
    seen_cases: set[tuple[str, str, str]] = set()
    for row in rows:
        case = row["case"]
        key = (case["caseId"], case["audioSha256"], case.get("assSha256", ""))
        if key in seen_cases:
            continue
        seen_cases.add(key)
        public_case_id = _public_identifier(case["caseId"])
        audio_sha = str(case["audioSha256"])
        public_audio_sha = audio_sha if re.fullmatch(r"[0-9a-f]{64}", audio_sha) else "<redacted-hash>"
        ass_sha = str(case.get("assSha256", ""))
        public_ass_sha = ass_sha if re.fullmatch(r"[0-9a-f]{64}", ass_sha) else "<redacted-hash>"
        public_tags = sorted(set(case.get("tags", [])) & REQUIRED_COVERAGE_TAGS)
        lines.append(
            f"| {_markdown_code(public_case_id)} | {_markdown_code(public_audio_sha)} | {_markdown_code(public_ass_sha)} | "
            f"{case['durationMs']} | {case.get('dialogueCount', '—')} | {_markdown_text(', '.join(public_tags))} |"
        )
    lines.extend(["", "## Limitations And Reproduction", ""])
    limitations = [row for row in rows if row["case"]["status"] != "completed"]
    if not limitations:
        lines.extend(["No failed or skipped records.", ""])
    for row in limitations:
        case = row["case"]
        error = case.get("error") or {}
        cache = case.get("modelCache") or {}
        classification = str(error.get("classification", "unknown"))
        lines.extend(
            [
                f"### {_markdown_text(_public_identifier(row['engine']))} / {_markdown_text(_public_identifier(case['caseId']))}",
                "",
                f"- Status: {_markdown_code(case['status'])}",
                f"- Classification: {_markdown_code(_public_identifier(classification))}",
                f"- Dependency available: {_markdown_code(case.get('dependencyAvailable'))}",
                f"- Model cache: {_markdown_code(cache.get('status', 'unknown'))}",
                f"- Reproduction: {_markdown_code(_redact_error(case.get('reproductionCommand', '<not-recorded>')))}",
                f"- Note: {_markdown_text(_public_error_note(classification))}",
                "",
            ]
        )
    present_classes = {
        duration_class
        for row in rows
        for duration_class in row["manifest"].get("durationClasses", [row["case"]["durationClass"]])
        if duration_class in {"short", "medium", "long"}
    }
    missing_classes = sorted({"short", "medium", "long"} - present_classes)
    present_tags = {
        tag
        for row in rows
        for tag in row["manifest"].get("coverageTags", row["case"].get("tags", []))
        if tag in REQUIRED_COVERAGE_TAGS
    }
    missing_tags = sorted(REQUIRED_COVERAGE_TAGS - present_tags)
    lines.extend(["## Handoff Status", ""])
    for engine in REQUIRED_ENGINES:
        reference_rows = [
            row for row in rows if row["candidateKind"] == "python-reference" and row["engine"] == engine
        ]
        if not reference_rows:
            status = "not recorded; optional diagnostic only"
        elif all(row["case"]["status"] == "completed" for row in reference_rows):
            status = "recorded for all listed cases; diagnostic only"
        elif any(row["case"]["status"] == "completed" for row in reference_rows):
            status = "partial diagnostic reference; limitations recorded"
        else:
            status = "unavailable diagnostic reference; native ground-truth comparison is not blocked"
        lines.append(f"- Python reference `{engine}`: {status}.")
    if missing_classes:
        lines.append(f"- Corpus manifest missing duration classes: {', '.join(missing_classes)}; corpus-wide claims remain blocked.")
    reference_duration_classes = {
        row["case"]["durationClass"] for row in rows if row["candidateKind"] == "python-reference"
    }
    missing_reference_classes = sorted({"short", "medium", "long"} - reference_duration_classes)
    if missing_reference_classes:
        lines.append(
            f"- Python-reference duration classes not recorded: {', '.join(missing_reference_classes)}; "
            "diagnostic claims for those classes remain unavailable and do not block native ground-truth comparison."
        )
    if missing_tags:
        lines.append(f"- Missing coverage tags: {', '.join(missing_tags)}; corpus-wide claims remain blocked.")
    lines.extend(
        [
            "- User-reviewed T01 budgets are frozen: each engine/case CER `<=0.35`; inference RTF `<=1.0` on CPU or `<=0.5` on accelerated GPU paths; short cold process wall `<=120s`; peak RSS `<=6 GiB` for CTranslate2 or `<=12 GiB` for CrispASR. No VRAM gate is defined.",
            "- Listed Python results are current-implementation diagnostics only and are not evaluated as pass/fail against the frozen budgets.",
            "- Qwen3 timing accuracy is eligible only when `timestampProvenance` is `forced-aligner`; synthetic, mixed, unknown, and generic `engine-native` timestamps are excluded.",
            "- T02/T03 must consume the same manifest, WAV/ASS hashes, schema, and metric implementation rather than reimplementing CER/P95/gap logic.",
            "",
        ]
    )
    return "\n".join(lines)


def command_report(args: argparse.Namespace) -> int:
    results = _load_results(Path(args.results))
    markdown = render_markdown(results)
    atomic_write_text(Path(args.output), markdown)
    print(f"wrote {args.output} from {len(results)} JSON result file(s)")
    return 0


def command_validate(args: argparse.Namespace) -> int:
    validation = validate_manifest(Path(args.manifest), Path(args.corpus_root) if args.corpus_root else None)
    manifest = validation["manifest"]
    print(f"valid: corpus={manifest['corpusId']} cases={len(manifest['cases'])} sha256={validation['manifestSha256']}")
    for warning in validation["warnings"]:
        print(f"warning: {warning}")
    return 0


def command_self_check(_args: argparse.Namespace) -> int:
    assert normalize_japanese_text("Ａ B\r\n\t語") == "AB語"
    assert levenshtein_counts("abc", "adc")["substitutions"] == 1
    assert levenshtein_counts("abc", "ac")["deletions"] == 1
    assert levenshtein_counts("abc", "abxc")["insertions"] == 1
    assert percentile([0, 100], 0.95) == 95
    invalid = timeline_metrics(
        [
            {"startMs": 0, "endMs": 100, "text": "ok"},
            {"startMs": -1, "endMs": -1, "text": ""},
            {"startMs": 50, "endMs": 1100, "text": "late"},
        ],
        1000,
    )
    assert invalid == {
        "segmentCount": 3,
        "emptyTextCount": 1,
        "nonPositiveDurationCount": 1,
        "negativeStartCount": 1,
        "afterAudioEndCount": 1,
        "nonMonotonicCount": 1,
    }
    gaps = missing_speech_regions(
        [{"startMs": 0, "endMs": 4000, "text": "speech", "speech": True}],
        [{"startMs": 0, "endMs": 1000, "text": "a"}, {"startMs": 3000, "endMs": 4000, "text": "b"}],
    )
    assert gaps == [{"speechIntervalIndex": 0, "startMs": 1000, "endMs": 3000, "durationMs": 2000}]
    reference = parse_ass_reference(ASR_SERVICE_ROOT / "benchmarks" / "fixtures" / "synthetic-parser-fixture.ass")
    assert reference["text"] == "テスト\n一行" and reference["speechIntervals"] == [{"startMs": 100, "endMs": 900}]

    class Refresh:
        def __init__(self, segments: Sequence[Any]) -> None:
            self.segments = segments

    refreshed = reduce_segment_events(
        [
            {"startMs": 0, "endMs": 100, "text": "preview"},
            Refresh([{"startMs": 100, "endMs": 900, "text": "final"}]),
        ],
        Refresh,
    )
    assert refreshed == [{"startMs": 100, "endMs": 900, "text": "final"}]
    sample = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": RESULT_KIND,
        "candidateKind": "python-reference",
        "engine": "faster-whisper",
        "model": "large-v3",
        "device": "cpu",
        "cases": [
            {
                "caseId": "sample",
                "audioSha256": "0" * 64,
                "assSha256": "1" * 64,
                "dialogueCount": 1,
                "durationMs": 1000,
                "durationClass": "short",
                "tags": ["clear-japanese"],
                "status": "skipped",
                "error": {"classification": "dependency-unavailable", "message": "missing"},
                "dependencyAvailable": False,
                "modelCache": {"status": "missing"},
                "reproductionCommand": "python scripts/asr-benchmark.py run ...",
                "samples": [],
                "warmInferenceRtfMedian": None,
            }
        ],
    }
    assert render_markdown([sample]) == render_markdown([json.loads(json.dumps(sample))])
    print("self-check passed: ASS derivation, normalization, CER, P95, timeline, speech gaps, refresh, deterministic report")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    self_check = subparsers.add_parser("self-check", help="run dependency-free contract checks")
    self_check.set_defaults(func=command_self_check)

    validate = subparsers.add_parser("validate", help="validate corpus manifest, hashes, and WAV format")
    validate.add_argument("--manifest", required=True)
    validate.add_argument("--corpus-root")
    validate.set_defaults(func=command_validate)

    run = subparsers.add_parser("run", help="run one registry engine without downloading models")
    run.add_argument("--manifest", required=True)
    run.add_argument("--corpus-root")
    run.add_argument("--expected-interpreter", required=True)
    run.add_argument("--hf-home", required=True)
    run.add_argument("--case")
    run.add_argument("--engine", required=True, choices=REQUIRED_ENGINES)
    run.add_argument("--model", required=True)
    run.add_argument("--device", default="cpu", choices=("cpu", "cuda", "auto"))
    run.add_argument("--compute-type")
    run.add_argument("--language", default="ja")
    run.add_argument("--use-vad", action="store_true")
    run.add_argument("--warm-runs", type=int)
    run.add_argument("--output", required=True)
    run.set_defaults(func=command_run)

    report = subparsers.add_parser("report", help="render sanitized deterministic Markdown from result JSON")
    report.add_argument("--results", required=True)
    report.add_argument("--output", required=True)
    report.set_defaults(func=command_report)

    child = subparsers.add_parser("_engine-child", help=argparse.SUPPRESS)
    child.set_defaults(func=lambda _args: _child_main())
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except ContractError as exc:
        parser.error(str(exc))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
