#!/usr/bin/env python3
"""Run the pinned faster-whisper 1.2.1 short timestamp parser over ignored tokens."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from faster_whisper import __version__ as faster_whisper_version
from faster_whisper.tokenizer import Tokenizer
import faster_whisper.tokenizer as tokenizer_module
import faster_whisper.transcribe as transcribe_module
import tokenizers as tokenizers_package
import tokenizers.tokenizers as tokenizers_extension
from tokenizers import Tokenizer as HfTokenizer

TASK_ROOT = Path(__file__).resolve().parent
LOCAL_ROOT = (TASK_ROOT / "local").resolve()
TOKENIZER_SHA256 = "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"
TOKENIZER_SOURCE_SHA256 = "614a96b6a9660096e4f4e9fbe8860cd75ad250dce8e85a847998a3d6d48165d2"
TRANSCRIBE_SOURCE_SHA256 = "5d5ffb00018561d3d529b2c72e1d9f5fff055bea725f3cccc7c6c67f5cc8ffe4"
TOKENIZERS_INIT_SHA256 = "510d5e23458612433da9f1fe430b5009fb88ba90508ee4340d2397b32c319080"
TOKENIZERS_EXTENSION_SHA256 = "7acb83f5b89136597e0d14b788d82917bf2870df94575bf77e12731c4e49c4df"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: Any) -> str:
    return sha256_bytes(json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode())


def local_path(value: str) -> Path:
    path = Path(value).resolve()
    if not path.is_relative_to(LOCAL_ROOT):
        raise ValueError("parser parity artifacts must stay below research/local")
    return path


def python_segments(tokens: list[int], tokenizer: Tokenizer) -> list[dict[str, Any]]:
    timestamp_begin = tokenizer.timestamp_begin
    single_timestamp_ending = len(tokens) >= 2 and tokens[-2] < timestamp_begin <= tokens[-1]
    consecutive = [
        index
        for index in range(1, len(tokens))
        if tokens[index] >= timestamp_begin and tokens[index - 1] >= timestamp_begin
    ]
    segments: list[dict[str, Any]] = []
    if consecutive:
        slices = list(consecutive)
        if single_timestamp_ending:
            slices.append(len(tokens))
        last_slice = 0
        for current_slice in slices:
            sliced = tokens[last_slice:current_slice]
            if not sliced:
                raise ValueError("empty upstream timestamp slice")
            segment = {
                "startMs": (sliced[0] - timestamp_begin) * 20,
                "endMs": (sliced[-1] - timestamp_begin) * 20,
                "text": tokenizer.decode(sliced),
            }
            if segment["startMs"] != segment["endMs"] and segment["text"].strip():
                segments.append(segment)
            last_slice = current_slice
    else:
        duration_ms = 24100
        timestamps = [token for token in tokens if token >= timestamp_begin]
        if timestamps and timestamps[-1] != timestamp_begin:
            duration_ms = (timestamps[-1] - timestamp_begin) * 20
        segment = {"startMs": 0, "endMs": duration_ms, "text": tokenizer.decode(tokens)}
        if segment["startMs"] != segment["endMs"] and segment["text"].strip():
            segments.append(segment)
    return segments


def native_segments(tokens: list[int], tokenizer: Tokenizer) -> list[dict[str, Any]]:
    timestamp_begin = tokenizer.timestamp_begin
    if not tokens or any(
        token > timestamp_begin + 1500
        for token in tokens
        if token >= timestamp_begin
    ):
        raise ValueError("native timestamp token is outside the model range")

    def parse_slice(value: list[int]) -> dict[str, Any]:
        if (
            len(value) < 2
            or value[0] < timestamp_begin
            or value[-1] < timestamp_begin
        ):
            raise ValueError("native timestamp slice is incomplete")
        raw_start = (value[0] - timestamp_begin) * 20
        raw_end = (value[-1] - timestamp_begin) * 20
        if raw_end <= raw_start or raw_start >= 24102:
            raise ValueError("native timestamp slice is outside short-v1")
        text_ids = [
            token
            for token in value[1:-1]
            if token < timestamp_begin and token != tokenizer.eot
        ]
        return {
            "startMs": raw_start,
            "endMs": min(raw_end, 24102),
            "text": tokenizer.decode(text_ids),
        }

    single_timestamp_ending = (
        len(tokens) >= 2 and tokens[-2] < timestamp_begin <= tokens[-1]
    )
    consecutive = [
        index
        for index in range(1, len(tokens))
        if tokens[index] >= timestamp_begin and tokens[index - 1] >= timestamp_begin
    ]
    segments: list[dict[str, Any]] = []
    if consecutive:
        slices = list(consecutive)
        if single_timestamp_ending:
            slices.append(len(tokens))
        last_slice = 0
        for current_slice in slices:
            segment = parse_slice(tokens[last_slice:current_slice])
            if segment["text"].strip():
                segments.append(segment)
            last_slice = current_slice
    else:
        timestamp_indices = [
            index for index, token in enumerate(tokens) if token >= timestamp_begin
        ]
        if len(timestamp_indices) < 2:
            raise ValueError("native timestamps do not form a complete pair")
        segment = parse_slice(
            tokens[timestamp_indices[0] : timestamp_indices[-1] + 1]
        )
        if segment["text"].strip():
            segments.append(segment)

    unique: list[dict[str, Any]] = []
    for segment in segments:
        if segment not in unique:
            unique.append(segment)
    return unique


def parser_aggregate(segments: list[dict[str, Any]]) -> dict[str, Any]:
    text = "".join(segment["text"] for segment in segments)
    timeline = [
        {"startMs": int(segment["startMs"]), "endMs": int(segment["endMs"])}
        for segment in segments
    ]
    return {
        "segmentCount": len(segments),
        "textSha256": sha256_bytes(text.encode("utf-8")),
        "timelineSha256": canonical_hash(timeline),
        "timelineErrorCount": sum(
            int(item["startMs"] < 0 or item["endMs"] <= item["startMs"] or item["endMs"] > 24102)
            for item in timeline
        ),
    }


def load_tokenizer(tokenizer_path: Path) -> Tokenizer:
    if (
        sys.version.split()[0] != "3.11.15"
        or faster_whisper_version != "1.2.1"
        or sha256_file(Path(tokenizer_module.__file__)) != TOKENIZER_SOURCE_SHA256
        or sha256_file(Path(transcribe_module.__file__)) != TRANSCRIBE_SOURCE_SHA256
        or sha256_file(Path(tokenizers_package.__file__)) != TOKENIZERS_INIT_SHA256
        or sha256_file(Path(tokenizers_extension.__file__))
            != TOKENIZERS_EXTENSION_SHA256
    ):
        raise ValueError("Python/faster-whisper parser source identity drifted")
    if sha256_file(tokenizer_path) != TOKENIZER_SHA256:
        raise ValueError("tokenizer identity drifted")
    tokenizer = Tokenizer(
        HfTokenizer.from_file(str(tokenizer_path)),
        multilingual=True,
        task="transcribe",
        language="ja",
    )
    if tokenizer.timestamp_begin != 50365:
        raise ValueError("timestamp token identity drifted")
    return tokenizer


def compute_rows(raw: dict[str, Any], tokenizer: Tokenizer) -> list[dict[str, Any]]:
    rows = []
    for sample in raw.get("samples", []):
        if sample.get("status") != "completed" or sample.get("failure") is not None:
            raise ValueError("short parity sample is not completed")
        traces = sample.get("tokenTraces")
        if not isinstance(traces, list) or len(traces) != 1:
            raise ValueError("short parity sample must contain one trace")
        tokens = traces[0].get("tokenIds")
        if not isinstance(tokens, list) or not tokens or not all(type(token) is int for token in tokens):
            raise ValueError("short parity token trace is missing")
        native_segments_from_raw = sample.get("segments")
        if not isinstance(native_segments_from_raw, list):
            raise ValueError("native parser segments are missing")
        recomputed_native = parser_aggregate(native_segments(tokens, tokenizer))
        if parser_aggregate(native_segments_from_raw) != recomputed_native:
            raise ValueError("native parser output does not match the token replay")
        rows.append(
            {
                "repeatIndex": sample.get("repeatIndex"),
                "selectedTokenSha256": canonical_hash(tokens),
                "pythonParser": parser_aggregate(python_segments(tokens, tokenizer)),
                "nativeParser": recomputed_native,
            }
        )
    if len(rows) != 2 or [row["repeatIndex"] for row in rows] != [1, 2]:
        raise ValueError("short parity repeat matrix drifted")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", required=True)
    parser.add_argument("--tokenizer", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    raw_path = local_path(args.raw)
    output_path = local_path(args.output)
    tokenizer_path = Path(args.tokenizer).resolve()
    tokenizer = load_tokenizer(tokenizer_path)

    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    if (
        raw.get("kind") != "hikaru-ct2-whisper-short-parity-raw"
        or raw.get("qualificationEligible") is not False
        or raw.get("promotionEligible") is not False
        or raw.get("candidateId") != "short-input-runtime-parity-bisect-v1"
        or raw.get("cellId") not in {
            "python-runtime-python-mel",
            "python-runtime-native-mel",
            "native-runtime-python-mel",
            "native-runtime-native-mel",
        }
        or raw.get("caseId") != "short-v1"
    ):
        raise ValueError("raw parity identity drifted")
    rows = compute_rows(raw, tokenizer)

    result = {
        "schemaVersion": 1,
        "kind": "hikaru-whisper-short-parity-parser-oracle",
        "status": "completed",
        "qualificationEligible": False,
        "cellId": raw.get("cellId"),
        "rawSha256": sha256_file(raw_path),
        "tokenizerSha256": TOKENIZER_SHA256,
        "tokenizerSourceSha256": TOKENIZER_SOURCE_SHA256,
        "transcribeSourceSha256": TRANSCRIBE_SOURCE_SHA256,
        "tokenizersInitSha256": TOKENIZERS_INIT_SHA256,
        "tokenizersExtensionSha256": TOKENIZERS_EXTENSION_SHA256,
        "rows": rows,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
