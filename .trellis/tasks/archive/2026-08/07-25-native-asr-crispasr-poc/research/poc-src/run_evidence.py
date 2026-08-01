#!/usr/bin/env python3
"""Run the final task-local CrispASR matrix under a restricted Windows PATH."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import wave
from pathlib import Path

TASK = Path(__file__).resolve().parents[1]
REPO = Path(__file__).resolve().parents[5]
LOCAL = TASK / "local"
BUILD = LOCAL / "build" / "windows-x64-cpu-poc"
EXE = BUILD / "hikaru-crispasr-poc.exe"
LOCK = TASK / "crispasr-input-lock.json"
MODELS = LOCAL / "models"
RUNS = LOCAL / "runs"
RESULTS = LOCAL / "results"
LOGS = LOCAL / "logs"
DERIVED = LOCAL / "derived"
NEGATIVE = LOCAL / "negative"
MANIFEST = REPO / ".asr-benchmark" / "manifest.json"
CORPUS = REPO / ".asr-benchmark"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_environment() -> dict[str, str]:
    system_root = os.environ.get("SystemRoot", "C:\\Windows")
    env = {
        "PATH": f"{BUILD};{Path(system_root) / 'System32'}",
        "SystemRoot": system_root,
        "TEMP": os.environ.get("TEMP", str(LOCAL / "tmp")),
        "TMP": os.environ.get("TMP", str(LOCAL / "tmp")),
    }
    Path(env["TEMP"]).mkdir(parents=True, exist_ok=True)
    return env


def execute(name: str, command: list[str], *, expect_success: bool = True,
            restricted_path: bool = True) -> subprocess.CompletedProcess[str]:
    LOGS.mkdir(parents=True, exist_ok=True)
    completed = subprocess.run(
        command, cwd=REPO, env=clean_environment() if restricted_path else None,
        text=True, capture_output=True,
    )
    (LOGS / f"{name}.stdout.txt").write_text(completed.stdout, encoding="utf-8")
    (LOGS / f"{name}.stderr.txt").write_text(completed.stderr, encoding="utf-8")
    if expect_success and completed.returncode != 0:
        raise RuntimeError(f"{name} failed with exit code {completed.returncode}; see ignored local/logs")
    print(f"{name}: exit={completed.returncode}")
    return completed


def derive_obligation_audio() -> dict[str, tuple[Path, str]]:
    source = CORPUS / "short.wav"
    DERIVED.mkdir(parents=True, exist_ok=True)
    with wave.open(str(source), "rb") as reader:
        params = reader.getparams()
        frames = reader.readframes(reader.getnframes())
    silence_2s = b"\0" * (params.framerate * 2 * params.sampwidth * params.nchannels)
    silence_1s = b"\0" * (params.framerate * params.sampwidth * params.nchannels)
    outputs = {
        "qwen-leading-silence-v1": (
            DERIVED / "qwen-leading-silence.wav", silence_2s + frames, "prepend-2000ms-zero-pcm16"
        ),
        "qwen-boundary-v1": (
            DERIVED / "qwen-boundary.wav", frames + silence_1s + frames, "concat-source-1000ms-zero-source"
        ),
    }
    result = {}
    for case_id, (path, data, derivation) in outputs.items():
        with wave.open(str(path), "wb") as writer:
            writer.setparams(params)
            writer.writeframes(data)
        result[case_id] = (path, derivation)
    return result


def harness_run(engine: str, case_id: str, audio: Path, output: Path, repeats: int = 1,
                case_source: str = "t01-authoritative", allow_controlled_failure: bool = False,
                source_audio: Path | None = None, derivation: str | None = None) -> dict:
    lock_sha = sha256(MANIFEST)
    model_names = {
        "parakeet-ja": "parakeet-tdt-0.6b-ja-q8_0.gguf",
        "reazonspeech": "reazonspeech-nemo-v2-q8_0.gguf",
        "qwen3-asr": "qwen3-asr-1.7b-q4_k.gguf",
    }
    command = [
        str(EXE), "--run", "--engine", engine, "--model", str(MODELS / model_names[engine]),
        "--audio", str(audio), "--case-id", case_id, "--case-source", case_source,
        "--manifest-sha256", lock_sha, "--lock", str(LOCK), "--output", str(output),
        "--repeats", str(repeats),
    ]
    aligner = MODELS / "qwen3-forced-aligner-0.6b-q4_k.gguf" if engine == "qwen3-asr" else None
    if aligner is not None:
        command[command.index("--audio"):command.index("--audio")] = ["--aligner", str(aligner)]
    if source_audio is not None and derivation is not None:
        command.extend(["--source-audio", str(source_audio), "--derivation", derivation])
    execute(output.stem, command, expect_success=not allow_controlled_failure)
    validate = [
        str(EXE), "--validate-evidence", str(output), "--manifest", str(MANIFEST),
        "--manifest-sha256", lock_sha, "--lock", str(LOCK), "--model", str(MODELS / model_names[engine]),
        "--audio", str(audio), "--case-id", case_id, "--case-source", case_source,
    ]
    if aligner is not None:
        validate.extend(["--aligner", str(aligner)])
    if source_audio is not None and derivation is not None:
        validate.extend(["--source-audio", str(source_audio), "--derivation", derivation])
    execute(output.stem + "-validate", validate)
    raw = json.loads(output.read_text(encoding="utf-8"))
    if not allow_controlled_failure and raw["status"] != "completed":
        raise RuntimeError(f"{output.stem} did not produce completed evidence")
    return raw


def adapt(engine: str, case: str) -> None:
    short = {"parakeet-ja": "parakeet", "reazonspeech": "reazonspeech", "qwen3-asr": "qwen3"}[engine]
    raw = RUNS / f"{short}-{case}.json"
    output = RESULTS / f"{short}-{case}-benchmark.json"
    model = {
        "parakeet-ja": MODELS / "parakeet-tdt-0.6b-ja-q8_0.gguf",
        "reazonspeech": MODELS / "reazonspeech-nemo-v2-q8_0.gguf",
        "qwen3-asr": MODELS / "qwen3-asr-1.7b-q4_k.gguf",
    }[engine]
    command = [
        sys.executable, str(TASK / "poc-src" / "benchmark_adapter.py"),
        "--raw", str(raw), "--manifest", str(MANIFEST), "--corpus-root", str(CORPUS),
        "--case", f"{case}-v1", "--lock", str(LOCK), "--executable", str(EXE),
        "--runtime-dir", str(BUILD), "--model", str(model), "--output", str(output),
    ]
    if engine == "qwen3-asr":
        command.extend(["--aligner", str(MODELS / "qwen3-forced-aligner-0.6b-q4_k.gguf")])
    execute(f"adapt-{short}-{case}", command, restricted_path=False)


def negative_matrix() -> None:
    NEGATIVE.mkdir(parents=True, exist_ok=True)
    corrupt = NEGATIVE / "corrupt-aligner.gguf"
    unloadable = NEGATIVE / "qwen3-forced-aligner-unloadable.gguf"
    corrupt.write_bytes(b"corrupt")
    unloadable.write_bytes(b"GGUF-invalid")
    output = NEGATIVE / "matrix.json"
    command = [
        str(EXE), "--negative-matrix",
        "--model", str(MODELS / "qwen3-asr-1.7b-q4_k.gguf"),
        "--aligner", str(MODELS / "qwen3-forced-aligner-0.6b-q4_k.gguf"),
        "--corrupt-aligner", str(corrupt), "--unloadable-aligner", str(unloadable),
        "--audio", str(CORPUS / "short.wav"), "--case-id", "short-v1",
        "--manifest-sha256", sha256(MANIFEST), "--lock", str(LOCK),
        "--output", str(output),
    ]
    execute("qwen-negative-matrix", command)
    execute("qwen-negative-matrix-validate", [
        str(EXE), "--validate-evidence", str(output), "--manifest", str(MANIFEST),
        "--manifest-sha256", sha256(MANIFEST), "--lock", str(LOCK),
        "--model", str(MODELS / "qwen3-asr-1.7b-q4_k.gguf"),
        "--aligner", str(MODELS / "qwen3-forced-aligner-0.6b-q4_k.gguf"),
        "--audio", str(CORPUS / "short.wav"), "--case-id", "short-v1",
        "--case-source", "negative-obligation", "--corrupt-aligner", str(corrupt),
        "--unloadable-aligner", str(unloadable),
    ])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-long", action="store_true")
    args = parser.parse_args()
    # Never merge evidence from an older executable identity.
    for path in (RUNS, RESULTS, LOGS, DERIVED, NEGATIVE):
        shutil.rmtree(path, ignore_errors=True)
        path.mkdir(parents=True, exist_ok=True)
    if not EXE.is_file():
        raise RuntimeError("Release harness binary is missing; build it first")

    cases = ("short", "medium") if args.skip_long else ("short", "medium", "long")
    for engine, prefix in (("parakeet-ja", "parakeet"), ("reazonspeech", "reazonspeech")):
        for case in cases:
            harness_run(engine, f"{case}-v1", CORPUS / f"{case}.wav", RUNS / f"{prefix}-{case}.json",
                        repeats=4 if case == "short" else 1)
            adapt(engine, case)

    # Qwen short is the route gate. Only proceed to longer/derived cases after
    # the grouped ForcedAligner timeline is legal and within the RSS budget.
    short = harness_run("qwen3-asr", "short-v1", CORPUS / "short.wav", RUNS / "qwen3-short.json", repeats=4)
    if short["status"] != "completed" or short["resources"]["peakProcessRssBytes"] > 12 * 1024**3:
        raise RuntimeError("Qwen short route gate failed; longer obligations were not run")
    adapt("qwen3-asr", "short")
    for case in cases[1:]:
        raw = harness_run("qwen3-asr", f"{case}-v1", CORPUS / f"{case}.wav", RUNS / f"qwen3-{case}.json",
                          allow_controlled_failure=True)
        if raw["status"] == "completed":
            adapt("qwen3-asr", case)
    for case_id, (audio, derivation) in derive_obligation_audio().items():
        harness_run(
            "qwen3-asr", case_id, audio, RUNS / f"{case_id}.json", case_source="derived-obligation",
            allow_controlled_failure=True, source_audio=CORPUS / "short.wav", derivation=derivation,
        )
    negative_matrix()
    print("final immutable evidence matrix completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
