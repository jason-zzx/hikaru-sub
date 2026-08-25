#!/usr/bin/env python3
"""Generate the frozen short-v1 Python Mel and sanitized comparison metadata."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from faster_whisper import __version__ as faster_whisper_version
from faster_whisper.audio import decode_audio, pad_or_trim
from faster_whisper.feature_extractor import FeatureExtractor
import faster_whisper.audio as audio_module
import faster_whisper.feature_extractor as feature_module

TASK_ROOT = Path(__file__).resolve().parent
LOCAL_ROOT = (TASK_ROOT / "local").resolve()
WAV_SHA256 = "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211"
WAVEFORM_SHA256 = "2cbf22e7635a41cf751401525e4358c19f2d452ae99c0ced78f65b6e9327e1c2"
PYTHON_MEL_SHA256 = "51209b71c3450718055dfad8a3d5923283dd95d702d606b0bdf56aac53218aa9"
NATIVE_MEL_SHA256 = "c2fc425ae691a4b1f9acd92580061ad97df82e01165747d761653f87634b9e08"
AUDIO_SOURCE_SHA256 = "60a1d8638f718cbf6d245aed3e5a5aa61c1f822a0b0fe9b48a7c928d47c23909"
FEATURE_SOURCE_SHA256 = "e403966dbc592a53695eea2aea24fa60bab50ef6755e0076b311f907be7a397c"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def local_path(value: str) -> Path:
    path = Path(value).resolve()
    if not path.is_relative_to(LOCAL_ROOT):
        raise ValueError("generated parity artifacts must stay below research/local")
    return path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--python-mel", required=True)
    parser.add_argument("--native-mel", required=True)
    parser.add_argument("--metadata-output", required=True)
    args = parser.parse_args()

    if sys.version.split()[0] != "3.11.15" or faster_whisper_version != "1.2.1":
        raise ValueError("Python/faster-whisper version drifted")
    if (
        sha256_file(Path(audio_module.__file__)) != AUDIO_SOURCE_SHA256
        or sha256_file(Path(feature_module.__file__)) != FEATURE_SOURCE_SHA256
    ):
        raise ValueError("faster-whisper feature source identity drifted")
    audio_path = Path(args.audio).resolve()
    python_mel_path = local_path(args.python_mel)
    native_mel_path = local_path(args.native_mel)
    metadata_path = local_path(args.metadata_output)
    if sha256_file(audio_path) != WAV_SHA256:
        raise ValueError("short-v1 WAV identity drifted")

    waveform = np.asarray(decode_audio(str(audio_path)), dtype="<f4")
    if waveform.shape != (385637,) or sha256_bytes(waveform.tobytes()) != WAVEFORM_SHA256:
        raise ValueError("decoded short-v1 waveform identity drifted")

    python_mel = np.asarray(
        pad_or_trim(FeatureExtractor()(waveform)),
        dtype="<f4",
        order="C",
    )
    if python_mel.shape != (80, 3000):
        raise ValueError("Python Mel shape drifted")
    python_mel_path.parent.mkdir(parents=True, exist_ok=True)
    python_mel.tofile(python_mel_path)
    if sha256_file(python_mel_path) != PYTHON_MEL_SHA256:
        raise ValueError("Python Mel identity drifted")

    if native_mel_path.stat().st_size != 80 * 3000 * 4 or sha256_file(native_mel_path) != NATIVE_MEL_SHA256:
        raise ValueError("native Mel identity drifted")
    native_mel = np.fromfile(native_mel_path, dtype="<f4").reshape(80, 3000)
    difference = np.abs(python_mel - native_mel)
    metadata = {
        "schemaVersion": 1,
        "kind": "hikaru-whisper-short-parity-inputs",
        "status": "completed",
        "qualificationEligible": False,
        "audio": {
            "wavSha256": WAV_SHA256,
            "waveformSha256": WAVEFORM_SHA256,
            "sampleCount": int(waveform.size),
            "dtype": "float32-le",
        },
        "mels": {
            "python": {"sha256": PYTHON_MEL_SHA256, "shape": [80, 3000], "dtype": "float32-le"},
            "native": {"sha256": NATIVE_MEL_SHA256, "shape": [80, 3000], "dtype": "float32-le"},
            "difference": {
                "differentValueCount": int(np.count_nonzero(difference)),
                "maximumAbsolute": float(difference.max()),
                "meanAbsolute": float(difference.mean()),
            },
        },
        "producer": {
            "pythonVersion": sys.version.split()[0],
            "fasterWhisperVersion": faster_whisper_version,
            "audioSourceSha256": AUDIO_SOURCE_SHA256,
            "featureExtractorSourceSha256": FEATURE_SOURCE_SHA256,
        },
    }
    if metadata["mels"]["difference"]["differentValueCount"] != 89425:
        raise ValueError("Mel difference count drifted")
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
