#!/usr/bin/env python3
"""Prepare private T10 inputs and acquire one frozen native attempt per invocation."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

TASK_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = TASK_ROOT.parents[2]
LOCAL_ROOT = (TASK_ROOT / "research" / "local").resolve()
ARCHIVE_ROOT = REPO_ROOT / ".trellis" / "tasks" / "archive" / "2026-08"
SOURCE_MODELS = ARCHIVE_ROOT / "07-25-native-asr-crispasr-poc" / "research" / "local" / "models"
SOURCE_RUNTIME = ARCHIVE_ROOT / "08-07-native-asr-crispasr-backend" / "research" / "local" / "build" / "windows-x64-crispasr" / "bin"
BUILD_BIN = LOCAL_ROOT / "build" / "windows-x64-t10-worker" / "bin"
LOCK = TASK_ROOT / "research" / "t10-input-lock.md"
MODEL_FILES = {
    "parakeet": ("parakeet-tdt-0.6b-ja-q8_0.gguf", 673554880, "5a61e6c7d956c3c72a76fafcd798cac0c9ea66d0e29b3910cd04865a1e42cc17"),
    "reazonspeech-nemo": ("reazonspeech-nemo-v2-q8_0.gguf", 667147072, "20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2"),
}
CASES = {
    "short-v1": "short.wav",
    "medium-v1": "medium.wav",
    "long-v2": "long.wav",
}
RUNTIME_FILES = ("crispasr.dll", "ggml-base.dll", "ggml-cpu.dll", "ggml-cuda.dll", "ggml.dll", "cublas64_12.dll", "cublasLt64_12.dll", "cudart64_12.dll")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_identity(path: Path, size: int, digest: str) -> None:
    if not path.is_file() or path.stat().st_size != size or sha256(path) != digest:
        raise ValueError(f"identity drift: {path.name}")


def hardlink_or_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size == source.stat().st_size and sha256(target) == sha256(source):
            return
        target.unlink()
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def prepare() -> None:
    manifest = json.loads((REPO_ROOT / ".asr-benchmark" / "manifest.json").read_text(encoding="utf-8"))
    for name, size, digest in MODEL_FILES.values():
        source = SOURCE_MODELS / name
        ensure_identity(source, size, digest)
        target = LOCAL_ROOT / "models" / name
        hardlink_or_copy(source, target)
        ensure_identity(target, size, digest)
    for case_id, name in CASES.items():
        source = REPO_ROOT / ".asr-benchmark" / name
        target = LOCAL_ROOT / "audio" / name
        hardlink_or_copy(source, target)
        case = next(item for item in manifest["cases"] if item["id"] == case_id)
        ensure_identity(target, target.stat().st_size, case["audioSha256"])
    runtime = LOCAL_ROOT / "runtime"
    for name in RUNTIME_FILES:
        hardlink_or_copy(SOURCE_RUNTIME / name, runtime / name)
    runner = BUILD_BIN / "hikaru-asr-crispasr-development-runner.exe"
    worker = BUILD_BIN / "hikaru-asr-worker.exe"
    if not runner.is_file() or not worker.is_file():
        raise ValueError("T10 runner/worker build is missing")
    hardlink_or_copy(runner, runtime / runner.name)
    hardlink_or_copy(worker, runtime / worker.name)
    for dependency in ("ctranslate2.dll", "hikaru_asr_tokenizer.dll", "onnxruntime.dll", "onnxruntime_providers_shared.dll"):
        hardlink_or_copy(BUILD_BIN / dependency, runtime / dependency)
    print(json.dumps({"status": "prepared", "localRoot": LOCAL_ROOT.name}, sort_keys=True))


def acquire(args: argparse.Namespace) -> None:
    prepare()
    model_name = MODEL_FILES[args.engine][0]
    audio_name = CASES[args.case]
    runner = LOCAL_ROOT / "runtime" / "hikaru-asr-crispasr-development-runner.exe"
    worker = LOCAL_ROOT / "runtime" / "hikaru-asr-worker.exe"
    runtime = LOCAL_ROOT / "runtime" / "crispasr.dll"
    model = LOCAL_ROOT / "models" / model_name
    audio = LOCAL_ROOT / "audio" / audio_name
    output = LOCAL_ROOT / "raw" / args.engine / args.case / f"{args.run_kind}-{args.repeat_index}.json"
    stderr = LOCAL_ROOT / "stderr" / args.engine / args.case / f"{args.run_kind}-{args.repeat_index}.log"
    output.parent.mkdir(parents=True, exist_ok=True)
    stderr.parent.mkdir(parents=True, exist_ok=True)
    command = [
        str(runner), "--run-t10-evidence", "--engine", args.engine, "--case", args.case,
        "--device", args.device, "--run-kind", args.run_kind, "--repeat-index", str(args.repeat_index),
        "--input-lock", str(LOCK), "--library", str(runtime), "--worker", str(worker),
        "--model", str(model), "--audio", str(audio), "--output", str(output),
    ]
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join((str(LOCAL_ROOT / "runtime"), r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin", str(Path(os.environ["SystemRoot"]) / "System32")))
    completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=args.timeout, check=False)
    stderr.write_bytes(completed.stderr)
    if completed.stdout:
        sys.stdout.buffer.write(completed.stdout)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)
    row = json.loads(output.read_text(encoding="utf-8"))
    stderr_bytes = stderr.read_bytes()
    lower = stderr_bytes.lower()
    private_paths = tuple(str(path).encode("utf-8") for path in (model, audio, output, LOCK))
    privacy_pass = (
        all(secret not in lower for secret in (b"authorization:", b"bearer ", b"password=", b"begin private key"))
        and all(path not in stderr_bytes for path in private_paths)
    )
    row["stderr"] = {"sizeBytes": stderr.stat().st_size, "sha256": sha256(stderr), "privacyPass": privacy_pass}
    row["pathPolicy"] = {
        "orderedRoots": [str(LOCAL_ROOT / "runtime"), r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin", str(Path(os.environ["SystemRoot"]) / "System32")],
        "policy": "runtime-cuda12.8-system32-v1",
    }
    temporary = output.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(row, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, output)


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)
    sub.add_parser("prepare")
    run = sub.add_parser("acquire")
    run.add_argument("--engine", choices=tuple(MODEL_FILES), required=True)
    run.add_argument("--case", choices=tuple(CASES), required=True)
    run.add_argument("--device", choices=("cpu", "cuda"), default="cuda")
    run.add_argument("--run-kind", choices=("cold", "warm", "measured"), required=True)
    run.add_argument("--repeat-index", type=int, required=True)
    run.add_argument("--timeout", type=int, default=7200)
    args = parser.parse_args()
    try:
        if args.mode == "prepare":
            prepare()
        else:
            acquire(args)
        return 0
    except (ValueError, FileNotFoundError, subprocess.TimeoutExpired) as error:
        print(f"T10 acquisition rejected: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
