#!/usr/bin/env python3
"""T09 stdlib-only two-phase preparation and native acquisition orchestrator."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

TASK_ROOT = Path(__file__).resolve().parents[1]
LOCAL_ROOT = (TASK_ROOT / "research" / "local").resolve()
FAMILIES = ("parakeet-family", "qwen3-family")
CMAKE = Path(r"C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe")
NINJA = Path(r"C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe")
CL = Path(r"C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\cl.exe")
VCVARS = Path(r"C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat")
NVCC = Path(r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin\nvcc.exe")
TOOL_IDENTITIES = {
    CMAKE: (13395024, "537f551032fec66f9a1ad629257ff8348577376cf044ea436c9413f69d6fea20"),
    NINJA: (3466696, "5020138b3757035df9dca9a2243624d5810ffa6ae24444bd95f752cbd1b89123"),
    CL: (677968, "6cadddca8c19e76991bbb44dff2eab5cab6807f9145e8bce9a800235a5975e51"),
    NVCC: (17741312, "07565c215cc96e3b3609a931eb6eaffb1ecca24339442603f92832494c656727"),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def identity(path: Path) -> dict[str, object]:
    return {"sizeBytes": path.stat().st_size, "sha256": sha256(path)}


def canonical_local(path: str, *, create: bool = False) -> Path:
    value = Path(path)
    if create:
        value.mkdir(parents=True, exist_ok=True)
    resolved = value.resolve()
    try:
        resolved.relative_to(LOCAL_ROOT)
    except ValueError as error:
        raise ValueError("path must stay below the canonical task research/local root") from error
    return resolved


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def command_hash(argv: list[str]) -> str:
    return hashlib.sha256(json.dumps(argv, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()


def validate_lock(path: Path) -> str:
    if path.resolve() != (TASK_ROOT / "research" / "crispasr-development-lock.md").resolve():
        raise ValueError("input lock path is not the tracked T09 lock")
    text = path.read_text(encoding="utf-8")
    for required in ("cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45", "evidence-frozen", "formalPairedRuntime"):
        if required not in text:
            raise ValueError("input lock is incomplete")
    return sha256(path)


def validate_tools() -> None:
    for path, expected in TOOL_IDENTITIES.items():
        if not path.is_file() or (path.stat().st_size, sha256(path)) != expected:
            raise FileNotFoundError("locked toolchain input is missing or drifted")


def run_logged(argv: list[str], cwd: Path, log_root: Path, timeout: int) -> tuple[int, list[dict[str, object]], bool]:
    logs: list[dict[str, object]] = []
    timed_out = False
    for index, command in enumerate(argv):
        role = "configure" if index == 0 else "build"
        output = log_root / f"{role}.log"
        started = time.monotonic()
        try:
            command_text = subprocess.list2cmdline(command)
            completed = subprocess.run(
                f'call "{VCVARS}" -vcvars_ver=14.44 >nul && {command_text}',
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=timeout,
                check=False,
                shell=True,
            )
            payload = completed.stdout
            exit_code = completed.returncode
        except subprocess.TimeoutExpired as error:
            payload = (error.stdout or b"") + (error.stderr or b"")
            exit_code = -1
            timed_out = True
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(payload)
        logs.append({
            "role": role,
            "relativePath": output.resolve().relative_to(LOCAL_ROOT).as_posix(),
            **identity(output),
            "durationMs": round((time.monotonic() - started) * 1000, 3),
            "exitCode": exit_code,
            "privacyPass": b"BEGIN PRIVATE KEY" not in payload and b"password=" not in payload.lower(),
        })
        if exit_code != 0:
            return exit_code, logs, timed_out
    return 0, logs, timed_out


def write_pre_runner_failure(raw_root: Path, index_path: Path, lock_hash: str, stage: str,
                             attempt: str, argv: list[list[str]], exit_code: int,
                             logs: list[dict[str, object]]) -> int:
    command_identity = command_hash([item for command in argv for item in command])
    entries = []
    for family in FAMILIES:
        path = raw_root / "pre-runner" / f"{attempt}-{family}.json"
        envelope = {
            "schema": "hikaru-crispasr-development-pre-runner-failure-v1",
            "family": family,
            "stage": stage,
            "attemptId": attempt,
            "inputLockSha256": lock_hash,
            "commandRoleSha256": command_identity,
            "exitCode": exit_code,
            "logs": logs,
            "privacyPass": all(item["privacyPass"] for item in logs),
        }
        atomic_json(path, envelope)
        entries.append({
            "rowRole": "pre-runner-failure",
            "family": family,
            "stage": stage,
            "attemptId": attempt,
            "relativeRawIdentifier": path.resolve().relative_to(LOCAL_ROOT).as_posix(),
            **identity(path),
        })
    atomic_json(index_path, {"schema": "hikaru-crispasr-development-raw-index-v1", "frozen": False, "entries": entries})
    return 20


def prepare_runtime(args: argparse.Namespace) -> int:
    lock = Path(args.input_lock).resolve()
    lock_hash = validate_lock(lock)
    source = canonical_local(args.source_root)
    build = canonical_local(args.runtime_build_root, create=True)
    raw_root = canonical_local(args.raw_root, create=True)
    index_path = Path(args.raw_index).resolve()
    if index_path.parent != (TASK_ROOT / "research").resolve():
        raise ValueError("raw index must be the tracked task research path")
    source_header = source / "include" / "crispasr_session.h"
    if not source_header.is_file() or sha256(source_header) != "cdefd19f6f208ed3f77f31c1cc8df19224c1c81ed5e0e6064650a827000c68df":
        raise FileNotFoundError("pinned CrispASR source is missing or drifted")
    validate_tools()
    attempt = uuid.uuid4().hex
    commands = [
        [str(CMAKE), "-S", str(source), "-B", str(build), "-G", "Ninja",
         "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=ON",
         "-DCRISPASR_BUILD_TESTS=OFF", "-DCRISPASR_BUILD_EXAMPLES=OFF",
         "-DCRISPASR_BUILD_SERVER=OFF", "-DCRISPASR_CURL=OFF", "-DGGML_CUDA=ON",
         "-DGGML_CUDA_FA_ALL_QUANTS=OFF", "-DGGML_CUDA_FORCE_CUBLAS=ON",
         "-DCMAKE_CUDA_ARCHITECTURES=86", f"-DCMAKE_MAKE_PROGRAM={NINJA}",
         f"-DCMAKE_CXX_COMPILER={CL}", f"-DCMAKE_CUDA_COMPILER={NVCC}"],
        [str(CMAKE), "--build", str(build), "--target", "crispasr-lib"],
    ]
    exit_code, logs, timed_out = run_logged(commands, TASK_ROOT.parents[2], raw_root / "prepare-runtime" / attempt, 7200)
    if exit_code != 0:
        if timed_out or not all(item["privacyPass"] for item in logs):
            return 2
        return write_pre_runner_failure(raw_root, index_path, lock_hash, "prepare-runtime", attempt, commands, exit_code, logs)
    candidates = sorted(build.rglob("crispasr.dll"))
    if len(candidates) != 1:
        return 2
    runtime = candidates[0]
    prepared = {
        "schema": "hikaru-crispasr-prepared-runtime-v1",
        "attemptId": attempt,
        "inputLockSha256": lock_hash,
        "sourceHeader": identity(source_header),
        "runtime": {"relativePath": runtime.resolve().relative_to(LOCAL_ROOT).as_posix(), **identity(runtime)},
        "logs": logs,
    }
    atomic_json(raw_root / "prepared-runtime.json", prepared)
    return 0


def reviewed_runtime(lock_text: str) -> tuple[str, int, str] | None:
    import re
    match = re.search(r"preparedRuntime:\s+([^\s]+)\s+(\d+)\s+([0-9a-f]{64})", lock_text)
    return (match.group(1), int(match.group(2)), match.group(3)) if match else None


def prepare_worker(args: argparse.Namespace) -> int:
    lock = Path(args.input_lock).resolve()
    lock_hash = validate_lock(lock)
    reviewed = reviewed_runtime(lock.read_text(encoding="utf-8"))
    if not reviewed:
        raise ValueError("prepared runtime has not been independently reviewed/frozen")
    runtime = canonical_local(str(LOCAL_ROOT / reviewed[0]))
    if identity(runtime) != {"sizeBytes": reviewed[1], "sha256": reviewed[2]}:
        raise ValueError("reviewed runtime identity drifted")
    validate_tools()
    build = canonical_local(args.worker_build_root, create=True)
    raw_root = canonical_local(args.raw_root, create=True)
    index_path = Path(args.raw_index).resolve()
    if index_path.parent != (TASK_ROOT / "research").resolve():
        raise ValueError("raw index must be the tracked task research path")
    attempt = uuid.uuid4().hex
    commands = [
        [str(CMAKE), "-S", str(TASK_ROOT.parents[2] / "native-asr"), "-B", str(build), "-G", "Ninja",
         "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
         "-DBUILD_TESTING=ON", "-DHIKARU_ASR_BUILD_CT2_WORKER=ON",
         "-DHIKARU_ASR_ENABLE_CRISPASR_DEVELOPMENT=ON",
         f"-DHIKARU_ASR_CRISPASR_RUNTIME_FILE:FILEPATH={runtime}",
         f"-DHIKARU_ASR_CRISPASR_RUNTIME_SIZE:STRING={reviewed[1]}",
         f"-DHIKARU_ASR_CRISPASR_RUNTIME_SHA256:STRING={reviewed[2]}",
         f"-DCMAKE_MAKE_PROGRAM={NINJA}", f"-DCMAKE_CXX_COMPILER={CL}"],
        [str(CMAKE), "--build", str(build)],
    ]
    exit_code, logs, timed_out = run_logged(commands, TASK_ROOT.parents[2], raw_root / "prepare-worker" / attempt, 7200)
    if exit_code != 0:
        if timed_out or not all(item["privacyPass"] for item in logs):
            return 2
        return write_pre_runner_failure(raw_root, index_path, lock_hash, "prepare-worker", attempt, commands, exit_code, logs)
    worker = build / "bin" / "hikaru-asr-worker.exe"
    runner = build / "bin" / "hikaru-asr-crispasr-development-runner.exe"
    if not worker.is_file() or not runner.is_file():
        return 2
    atomic_json(raw_root / "prepared-worker.json", {
        "schema": "hikaru-crispasr-prepared-worker-v1",
        "attemptId": attempt,
        "inputLockSha256": lock_hash,
        "runtime": {"relativePath": runtime.relative_to(LOCAL_ROOT).as_posix(), **identity(runtime)},
        "worker": {"relativePath": worker.resolve().relative_to(LOCAL_ROOT).as_posix(), **identity(worker)},
        "runner": {"relativePath": runner.resolve().relative_to(LOCAL_ROOT).as_posix(), **identity(runner)},
        "logs": logs,
    })
    return 0


def acquire(args: argparse.Namespace) -> int:
    validate_lock(Path(args.input_lock).resolve())
    lock_text = Path(args.input_lock).read_text(encoding="utf-8")
    if "formalPairedRuntime: unset" in lock_text or "preparedWorker: unset" in lock_text:
        raise ValueError("runtime/worker identities are not reviewed/frozen")
    runner = canonical_local(args.runner)
    library = canonical_local(args.library)
    raw_root = canonical_local(args.raw_root, create=True)
    rows: list[dict[str, object]] = []
    inputs = {
        "parakeet-family": (args.reazon_model, None),
        "qwen3-family": (args.qwen_model, args.qwen_aligner),
    }
    audio = {"short-v1": args.short_audio, "medium-v1-first-120s": args.medium_audio}
    eligible: dict[str, bool] = {family: True for family in FAMILIES}
    runtime_bin = runner.parent.resolve()
    cuda_bin = Path(r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin").resolve()
    system32 = (Path(os.environ["SystemRoot"]) / "System32").resolve()
    restricted_path = os.pathsep.join(map(str, (runtime_bin, cuda_bin, system32)))

    def invoke(command: list[str], output_path: Path, stderr_path: Path, timeout: int) -> subprocess.CompletedProcess[bytes]:
        stderr_path.parent.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ)
        env["PATH"] = restricted_path
        completed = subprocess.run(
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout, check=False, env=env)
        stderr_path.write_bytes(completed.stderr)
        if output_path.is_file():
            row = json.loads(output_path.read_text(encoding="utf-8"))
            payload = completed.stderr
            lower = payload.lower()
            private_values = [str(value).encode("utf-8") for value in (inputs[row["family"]][0], inputs[row["family"]][1], audio[row["sample"]]) if value]
            privacy_pass = all(secret not in lower for secret in (b"authorization:", b"bearer ", b"password=", b"begin private key")) and all(value not in payload for value in private_values)
            row["stderr"] = {
                "relativePath": stderr_path.resolve().relative_to(LOCAL_ROOT).as_posix(),
                **identity(stderr_path),
                "privacyPass": privacy_pass,
            }
            atomic_json(output_path, row)
        if completed.stdout:
            sys.stdout.buffer.write(completed.stdout)
        return completed

    for family in FAMILIES:
        for device in ("cpu", "cuda"):
            output = raw_root / "discovery" / family / device / "short-v1.json"
            stderr_path = output.with_suffix(".stderr.log")
            command = [str(runner), "--run-development-evidence", "--phase", "discovery", "--family", family,
                       "--device", device, "--sample", "short-v1", "--input-lock", args.input_lock,
                       "--library", str(library), "--model", inputs[family][0], "--audio", audio["short-v1"],
                       "--stderr-log", str(stderr_path), "--output", str(output)]
            if inputs[family][1]: command += ["--aligner", inputs[family][1]]
            completed = invoke(command, output, stderr_path, 600)
            if completed.returncode not in (0, 20): return 2
            if completed.returncode == 20:
                eligible[family] = False
            rows.append({"family": family, "phase": "discovery", "device": device, "sample": "short-v1", "path": output})
    for family in FAMILIES:
        if not eligible[family]:
            continue
        for sample in ("short-v1", "medium-v1-first-120s"):
            for device in ("cpu", "cuda"):
                output = raw_root / "formal" / family / device / f"{sample}.json"
                stderr_path = output.with_suffix(".stderr.log")
                command = [str(runner), "--run-development-evidence", "--phase", "formal", "--family", family,
                           "--device", device, "--sample", sample, "--input-lock", args.input_lock,
                           "--library", str(library), "--model", inputs[family][0], "--audio", audio[sample],
                           "--stderr-log", str(stderr_path), "--output", str(output)]
                if inputs[family][1]: command += ["--aligner", inputs[family][1]]
                completed = invoke(command, output, stderr_path, 300 if sample == "short-v1" else 1800)
                if completed.returncode != 0: return 2
                rows.append({"family": family, "phase": "formal", "device": device, "sample": sample, "path": output})
    entries = []
    for source_row in rows:
        row = dict(source_row)
        path = row.pop("path")
        entries.append({**row, "rowRole": row["phase"], "relativeRawIdentifier": path.resolve().relative_to(LOCAL_ROOT).as_posix(), **identity(path)})
    index_path = Path(args.raw_index).resolve()
    if index_path.parent != (TASK_ROOT / "research").resolve():
        raise ValueError("raw index must be the tracked task research path")
    atomic_json(index_path, {"schema": "hikaru-crispasr-development-raw-index-v1", "frozen": False, "entries": entries})
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    sub = result.add_subparsers(dest="mode", required=True)
    runtime = sub.add_parser("prepare-runtime")
    runtime.add_argument("--input-lock", required=True); runtime.add_argument("--source-root", required=True)
    runtime.add_argument("--runtime-build-root", required=True); runtime.add_argument("--raw-root", required=True)
    runtime.add_argument("--raw-index", required=True); runtime.set_defaults(action=prepare_runtime)
    worker = sub.add_parser("prepare-worker")
    worker.add_argument("--input-lock", required=True); worker.add_argument("--worker-build-root", required=True)
    worker.add_argument("--raw-root", required=True); worker.add_argument("--raw-index", required=True)
    worker.set_defaults(action=prepare_worker)
    acquisition = sub.add_parser("acquire")
    for name in ("runner", "input-lock", "library", "reazon-model", "qwen-model", "qwen-aligner", "short-audio", "medium-audio", "raw-root", "raw-index"):
        acquisition.add_argument(f"--{name}", required=True)
    acquisition.set_defaults(action=acquire)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        return args.action(args)
    except (ValueError, FileNotFoundError, subprocess.TimeoutExpired) as error:
        print(f"t09 acquisition rejected: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
