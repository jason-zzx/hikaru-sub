#!/usr/bin/env python3
"""Compare native fallback decisions with installed faster-whisper 1.2.1."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import os
import struct
import subprocess
import sys
import tempfile
import zlib
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

import faster_whisper
from faster_whisper.transcribe import TranscriptionOptions, WhisperModel

import publish_whisper_gpu_quality as publisher

EXPECTED_SOURCE_SHA256 = "5d5ffb00018561d3d529b2c72e1d9f5fff055bea725f3cccc7c6c67f5cc8ffe4"
TEMPERATURES = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]


@dataclass
class FakeResult:
    index: int
    sequences_ids: list[list[int]]
    scores: list[float]
    no_speech_prob: float


class FakeModel:
    def __init__(self, attempts: list[dict]) -> None:
        self.attempts = attempts
        self.calls: list[dict] = []

    def generate(self, _encoder, _prompts, **kwargs):
        index = len(self.calls)
        if index >= len(self.attempts):
            raise AssertionError("Python oracle exceeded six attempts")
        self.calls.append(kwargs)
        attempt = self.attempts[index]
        return [FakeResult(
            index,
            [attempt["tokenIds"]],
            [attempt["score"]],
            attempt["noSpeechProbability"],
        )]


class FakeTokenizer:
    def __init__(self, attempts: list[dict]) -> None:
        self.text_by_tokens = {tuple(item["tokenIds"]): item["text"] for item in attempts}

    def decode(self, tokens):
        return self.text_by_tokens[tuple(tokens)]


def options() -> TranscriptionOptions:
    return TranscriptionOptions(
        beam_size=5,
        best_of=5,
        patience=1.0,
        length_penalty=1.0,
        repetition_penalty=1.0,
        no_repeat_ngram_size=0,
        log_prob_threshold=-1.0,
        no_speech_threshold=0.6,
        compression_ratio_threshold=2.4,
        condition_on_previous_text=True,
        prompt_reset_on_temperature=0.5,
        temperatures=TEMPERATURES,
        initial_prompt=None,
        prefix=None,
        suppress_blank=True,
        suppress_tokens=[-1],
        without_timestamps=False,
        max_initial_timestamp=1.0,
        word_timestamps=False,
        prepend_punctuations="",
        append_punctuations="",
        multilingual=False,
        max_new_tokens=None,
        clip_timestamps="0",
        hallucination_silence_threshold=None,
        hotwords=None,
    )


def float32(value: float) -> float:
    return struct.unpack("<f", struct.pack("<f", value))[0]


def attempt(
    index: int,
    text: str,
    average: float,
    no_speech: float = 0.0,
    *,
    token_count: int = 2,
    score: float | None = None,
) -> dict:
    token_ids = list(range(100 + index * 4, 100 + index * 4 + token_count))
    return {
        "tokenIds": token_ids,
        "score": float32(score if score is not None else average * (token_count + 1) / token_count),
        "noSpeechProbability": float32(no_speech),
        "text": text,
    }


def padded(values: list[dict]) -> list[dict]:
    return values + [attempt(index, "unused", 0.0) for index in range(len(values), 6)]


def python_oracle(attempts: list[dict]) -> tuple[dict, list[dict]]:
    model = FakeModel(attempts)
    owner = SimpleNamespace(
        model=model,
        time_precision=0.02,
        max_length=448,
        logger=logging.getLogger("fallback-oracle"),
    )
    result, average, temperature, ratio = WhisperModel.generate_with_fallback(
        owner, None, [1, 2, 3], FakeTokenizer(attempts), options()
    )
    return {
        "attemptCount": len(model.calls),
        "selectedAttemptIndex": result.index,
        "selectedTemperature": temperature,
        "promptReset": temperature > 0.5,
        "averageLogProbability": average,
        "compressionRatio": ratio,
    }, model.calls


def native_oracle(runner: Path, root: Path, name: str, attempts: list[dict]) -> tuple[dict, bytes]:
    input_path = root / f"{name}.input.json"
    output_path = root / f"{name}.output.json"
    input_path.write_text(json.dumps({"attempts": attempts}), encoding="utf-8")
    env = os.environ.copy()
    cuda_path = Path(env["CUDA_PATH"])
    env["PATH"] = os.pathsep.join((str(runner.parent), str(cuda_path / "bin"), os.environ["SystemRoot"] + r"\System32"))
    subprocess.run(
        [str(runner), "--run-whisper-fallback-oracle", "--input", str(input_path), "--output", str(output_path)],
        check=True,
        env=env,
        capture_output=True,
        text=True,
    )
    data = output_path.read_bytes()
    return json.loads(data), data


def check_case(runner: Path, root: Path, name: str, attempts: list[dict]) -> None:
    expected, calls = python_oracle(attempts)
    actual, first_bytes = native_oracle(runner, root, name, attempts)
    repeated, second_bytes = native_oracle(runner, root, name + "-repeat", attempts)
    assert first_bytes == second_bytes
    assert actual == repeated
    assert actual["zlibVersion"] == "1.3.1"
    for key in ("attemptCount", "selectedAttemptIndex", "selectedTemperature", "promptReset"):
        assert actual[key] == expected[key], (name, key, actual[key], expected[key])
    selected = actual["attempts"][actual["selectedAttemptIndex"]]
    assert math.isclose(selected["averageLogProbability"], expected["averageLogProbability"], rel_tol=1e-6)
    assert math.isclose(selected["compressionRatio"], expected["compressionRatio"], rel_tol=1e-12)
    assert len(actual["attempts"]) == len(calls) <= 6
    for index, (native, call) in enumerate(zip(actual["attempts"], calls)):
        temperature = TEMPERATURES[index]
        assert native["temperature"] == temperature
        if temperature == 0:
            assert native["decodeMode"] == "beam"
            assert native["beamSize"] == call["beam_size"] == 5
            assert native["patience"] == call["patience"] == 1.0
            assert native["numHypotheses"] == 1
            assert native["samplingTopK"] is None
            assert native["samplingTemperature"] is None
            assert "sampling_topk" not in call
            assert "sampling_temperature" not in call
        else:
            assert native["decodeMode"] == "sampling"
            assert native["beamSize"] == call["beam_size"] == 1
            assert native["patience"] is None
            assert native["numHypotheses"] == call["num_hypotheses"] == 5
            assert native["samplingTopK"] == call["sampling_topk"] == 0
            assert native["samplingTemperature"] == call["sampling_temperature"] == temperature
        source = attempts[index]
        average = source["score"] * len(source["tokenIds"]) / (len(source["tokenIds"]) + 1)
        ratio = len(source["text"].strip().encode("utf-8")) / len(zlib.compress(source["text"].strip().encode("utf-8")))
        assert native["tokenIds"] == source["tokenIds"]
        assert native["decodedText"] == source["text"]
        assert math.isclose(native["score"], source["score"], rel_tol=1e-7)
        assert math.isclose(native["noSpeechProbability"], source["noSpeechProbability"], rel_tol=1e-7)
        assert native["compressionTriggered"] == (ratio > 2.4)
        assert native["logProbabilityTriggered"] == (average < -1.0)
        assert native["silenceOverride"] == (
            source["noSpeechProbability"] > 0.6 and average < -1.0
        )
        assert native["aggregateSha256"] == publisher.fallback_attempt_aggregate(native)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runner", type=Path, required=True)
    parser.add_argument("--local-root", type=Path, required=True)
    args = parser.parse_args()
    source = Path(__import__("faster_whisper.transcribe", fromlist=["x"]).__file__)
    assert faster_whisper.__version__ == "1.2.1"
    assert hashlib.sha256(source.read_bytes()).hexdigest() == EXPECTED_SOURCE_SHA256
    assert zlib.ZLIB_VERSION == zlib.ZLIB_RUNTIME_VERSION == "1.3.1"
    assert args.runner.is_file()
    args.local_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.local_root) as directory:
        root = Path(directory)
        repetitive = "a" * 1000
        unicode_whitespace = "".join(
            chr(code_point)
            for code_point in range(sys.maxunicode + 1)
            if chr(code_point).isspace()
        )
        cases = {
            "no-retry": padded([attempt(0, "hello", 0.0)]),
            "unicode-strip": padded([attempt(0, unicode_whitespace + "hello" + unicode_whitespace[::-1], 0.0)]),
            "compression-retry": padded([attempt(0, repetitive, 0.0), attempt(1, "hello", 0.0)]),
            "logprob-retry": padded([attempt(0, "hello", -1.1), attempt(1, "hello", 0.0)]),
            "float-logprob-boundary": padded([
                attempt(0, "hello", 0.0, token_count=3, score=-1.3333333730697632),
                attempt(1, "hello", 0.0),
            ]),
            "silence-override": padded([attempt(0, "hello", -1.1, 0.7)]),
            "silence-overrides-compression": padded([attempt(0, repetitive, -1.1, 0.7)]),
            "ct2-float-no-speech-boundary": padded([attempt(0, "hello", -1.1, 0.6)]),
            "below-no-speech-threshold": padded([
                attempt(0, "hello", -1.1, 0.5999999),
                attempt(1, "hello", 0.0),
            ]),
            "logprob-threshold-boundary": padded([attempt(0, "hello", -1.0, 0.7)]),
            "first-passing": padded([attempt(0, repetitive, 0.0), attempt(1, "hello", -1.1), attempt(2, "hello", 0.0)]),
            "prompt-reset": padded([attempt(0, repetitive, 0.0), attempt(1, repetitive, 0.0), attempt(2, repetitive, 0.0), attempt(3, "hello", 0.0)]),
            "all-failed": [attempt(i, "hello", value) for i, value in enumerate((-1.5, -1.4, -1.3, -1.2, -1.1, -1.25))],
            "all-failed-first-max-tie": [attempt(i, "hello", value) for i, value in enumerate((-1.5, -1.4, -1.1, -1.2, -1.1, -1.25))],
            "below-compression-preference": [
                attempt(0, repetitive, 0.0),
                attempt(1, "hello", -1.5),
                *[attempt(i, repetitive, -0.1) for i in range(2, 6)],
            ],
            "max-six": [attempt(i, repetitive, 0.0) for i in range(6)],
        }
        for name, values in cases.items():
            check_case(args.runner.resolve(), root, name, values)
    print(f"fallback oracle parity passed: {len(cases)} vectors")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
