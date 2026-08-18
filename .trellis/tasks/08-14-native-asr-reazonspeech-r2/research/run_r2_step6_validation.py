#!/usr/bin/env python3
"""Run the reviewed Reazon R2 Rust-host Step 6 matrix without benchmark inference."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[4]
TASK = Path(__file__).resolve().parent.parent
LOCAL = TASK / "research" / "local"
MANIFEST = LOCAL / "r2-step6-manifest.json"
OUTPUT_ROOT = LOCAL / "validation" / "step6"
INDEX = OUTPUT_ROOT / "validation-index.json"
MANIFEST_SHA256 = "aa28e40c65c029c2c7c651121606f9334daddf21ee839c59954455d3bb5bb33c"
CANDIDATE = "R2-vad12-pad30-overlap-top-level-v1"
LANES = (
    "success",
    "pre-ready-negative",
    "post-ready-vad",
    "post-ready-protocol",
    "post-ready-policy",
    "cancellation",
)
TEST_NAME = "asr_worker::tests::r2_step6_real_worker_lane"
HEADER_PREFIX = "R2_STEP6_HEADER "
OBSERVED_PREFIX = "R2_STEP6_OBSERVED "


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def relative(path: Path) -> str:
    return path.resolve().relative_to(REPO.resolve()).as_posix()


def atomic_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def atomic_json(path: Path, value: object) -> None:
    atomic_bytes(
        path,
        (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )


def load_manifest() -> dict:
    raw = MANIFEST.read_bytes()
    if sha256_bytes(raw) != MANIFEST_SHA256:
        raise RuntimeError("Step 6 manifest SHA-256 drift")
    manifest = json.loads(raw)
    if manifest.get("schemaVersion") != 1 or manifest.get("candidateId") != CANDIDATE:
        raise RuntimeError("Step 6 manifest identity drift")
    if tuple(sorted(manifest.get("lanes", {}))) != tuple(sorted(LANES)):
        raise RuntimeError("Step 6 lane set drift")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict) or not artifacts:
        raise RuntimeError("Step 6 artifacts are missing")
    repo = REPO.resolve()
    for role, identity in artifacts.items():
        raw_path = Path(identity["path"])
        if raw_path.is_absolute() or ".." in raw_path.parts:
            raise RuntimeError(f"unsafe Step 6 artifact path: {role}")
        path = (REPO / raw_path).resolve()
        if not path.is_relative_to(repo) or not path.is_file():
            raise RuntimeError(f"missing Step 6 artifact: {role}")
        if path.stat().st_size != identity["sizeBytes"]:
            raise RuntimeError(f"Step 6 artifact size drift: {role}")
        if sha256_file(path) != identity["sha256"]:
            raise RuntimeError(f"Step 6 artifact hash drift: {role}")
    return manifest


def clean_environment() -> dict[str, str]:
    env = os.environ.copy()
    for key in tuple(env):
        if key.startswith(("HIKARU_ASR_CRISPASR_", "HIKARU_ASR_R2_STEP6_")):
            env.pop(key)
    return env


def lane_command() -> list[str]:
    return [
        "cargo",
        "test",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        TEST_NAME,
        "--",
        "--exact",
        "--nocapture",
        "--test-threads=1",
    ]


def lane_environment(lane: str) -> dict[str, str]:
    return {
        "HIKARU_ASR_R2_STEP6_MANIFEST": str(MANIFEST.resolve()),
        "HIKARU_ASR_R2_STEP6_REQUIRED": "1",
        "HIKARU_ASR_R2_STEP6_LANE": lane,
    }


def lane_header(lane: str, manifest: dict) -> dict:
    manifest_lane = manifest["lanes"][lane]
    payload = {
        "schemaVersion": 1,
        "candidateId": CANDIDATE,
        "laneId": lane,
        "label": f"lane-{lane}",
        "command": lane_command(),
        "testFilter": TEST_NAME,
        "requiredEnvironment": lane_environment(lane),
        "manifestSha256": MANIFEST_SHA256,
        "scenario": {
            key: manifest_lane[key]
            for key in ("kind", "worker", "device", "engine", "stageVad")
        },
        "expectedOutcomeContract": manifest_lane["expected"],
    }
    return {"payload": payload, "sha256": sha256_bytes(canonical_json(payload).encode("utf-8"))}


def parse_observed(output: bytes, lane: str) -> dict:
    lines = output.decode("utf-8").splitlines()
    records = [json.loads(line.split(OBSERVED_PREFIX, 1)[1]) for line in lines if OBSERVED_PREFIX in line]
    if len(records) != 1:
        raise RuntimeError(f"Step 6 lane {lane} emitted {len(records)} observed records")
    observed = records[0]
    if observed.get("schemaVersion") != 1 or observed.get("lane") != lane:
        raise RuntimeError(f"Step 6 lane {lane} observed record identity drift")
    return observed


def log_identity(path: Path) -> dict:
    return {
        "path": relative(path),
        "sizeBytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def run_lane(lane: str, manifest: dict) -> dict:
    label = f"lane-{lane}"
    command = lane_command()
    required_environment = lane_environment(lane)
    env = clean_environment()
    env.update(required_environment)
    header = lane_header(lane, manifest)
    header_bytes = (HEADER_PREFIX + canonical_json(header) + "\n").encode("utf-8")

    started = time.monotonic()
    result = subprocess.run(
        command,
        cwd=REPO,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    elapsed_ms = round((time.monotonic() - started) * 1000)
    log_path = OUTPUT_ROOT / f"{label}.log"
    atomic_bytes(log_path, header_bytes + result.stdout)
    observed = parse_observed(result.stdout, lane) if result.returncode == 0 else None
    return {
        "label": label,
        "lane": lane,
        "command": command,
        "testFilter": TEST_NAME,
        "environment": required_environment,
        "manifestSha256": MANIFEST_SHA256,
        "expectedOutcomeContract": manifest["lanes"][lane]["expected"],
        "laneIdentity": header,
        "observed": observed,
        "returnCode": result.returncode,
        "elapsedMs": elapsed_ms,
        "log": log_identity(log_path),
    }


def run_command(label: str, command: list[str], env: dict[str, str] | None = None) -> dict:
    log_path = OUTPUT_ROOT / f"{label}.log"
    started = time.monotonic()
    result = subprocess.run(
        command,
        cwd=REPO,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    elapsed_ms = round((time.monotonic() - started) * 1000)
    atomic_bytes(log_path, result.stdout)
    return {
        "label": label,
        "command": command,
        "returnCode": result.returncode,
        "elapsedMs": elapsed_ms,
        "log": log_identity(log_path),
    }


def run_privacy_check() -> dict:
    label = "privacy-scan"
    log_path = OUTPUT_ROOT / f"{label}.log"
    tracked = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "--", relative(TASK)],
        cwd=REPO,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    failures: list[str] = []
    text = tracked.stdout.decode("utf-8", errors="replace")
    if tracked.returncode:
        failures.append("git ls-files inventory failed")
    paths = [REPO / line for line in text.splitlines() if line]
    if any("research/local/" in path.as_posix() for path in paths):
        failures.append("tracked research/local artifact")
    forbidden = (
        b"C:" + b"\\Users\\",
        b"C:/" + b"Users/",
        b"/" + b"Users/",
        str(REPO.resolve()).encode(),
    )
    for path in paths + [REPO / "src-tauri/src/asr_worker.rs"]:
        data = path.read_bytes()
        if any(marker in data for marker in forbidden):
            failures.append(f"absolute path in {path.relative_to(REPO).as_posix()}")
    output = (
        "trackedFiles=" + str(len(paths)) + "\n"
        + ("status=pass\n" if not failures else "status=fail\n" + "\n".join(failures) + "\n")
    ).encode()
    atomic_bytes(log_path, output)
    return {
        "label": label,
        "command": ["internal", "tracked-privacy-scan"],
        "returnCode": 0 if not failures else 1,
        "elapsedMs": 0,
        "log": log_identity(log_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--matrix-only", action="store_true")
    args = parser.parse_args()

    manifest = load_manifest()
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    entries = [run_lane(lane, manifest) for lane in LANES]

    if not args.matrix_only:
        clean = clean_environment()
        commands = (
            (
                "targeted-cargo-tests",
                [
                    "cargo",
                    "test",
                    "--manifest-path",
                    "src-tauri/Cargo.toml",
                    "asr_worker::tests",
                    "--",
                    "--test-threads=1",
                ],
            ),
            ("full-cargo-tests", ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml"]),
            (
                "release-cargo-check",
                ["cargo", "check", "--release", "--manifest-path", "src-tauri/Cargo.toml"],
            ),
            (
                "task-validation",
                [
                    sys.executable,
                    "./.trellis/scripts/task.py",
                    "validate",
                    ".trellis/tasks/08-14-native-asr-reazonspeech-r2",
                ],
            ),
            ("diff-check", ["git", "diff", "--check"]),
            (
                "ignore-check",
                [
                    "git",
                    "check-ignore",
                    relative(MANIFEST),
                    relative(LOCAL / ".ignore-sentinel"),
                ],
            ),
        )
        entries.extend(run_command(label, command, clean) for label, command in commands)
        entries.append(run_privacy_check())

    index = {
        "schemaVersion": 2,
        "candidateId": CANDIDATE,
        "manifest": {
            "path": relative(MANIFEST),
            "sizeBytes": MANIFEST.stat().st_size,
            "sha256": sha256_file(MANIFEST),
        },
        "entries": entries,
    }
    atomic_json(INDEX, index)
    failed = [entry["label"] for entry in entries if entry["returnCode"] != 0]
    if failed:
        print("Step 6 validation failed: " + ", ".join(failed), file=sys.stderr)
        return 1
    print(relative(INDEX))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
