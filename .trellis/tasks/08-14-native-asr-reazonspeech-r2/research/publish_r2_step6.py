#!/usr/bin/env python3
"""Publish sanitized Reazon R2 Rust-host Step 6 validation evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
TASK = Path(__file__).resolve().parent.parent
RESEARCH = TASK / "research"
LOCAL = RESEARCH / "local"
MANIFEST = LOCAL / "r2-step6-manifest.json"
INDEX = LOCAL / "validation" / "step6" / "validation-index.json"
REPORT = RESEARCH / "r2-step6-report.md"
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
VALIDATIONS = (
    "targeted-cargo-tests",
    "full-cargo-tests",
    "release-cargo-check",
    "task-validation",
    "diff-check",
    "ignore-check",
    "privacy-scan",
)
TEST_NAME = "asr_worker::tests::r2_step6_real_worker_lane"
HEADER_PREFIX = "R2_STEP6_HEADER "
OBSERVED_PREFIX = "R2_STEP6_OBSERVED "
OBSERVED_KEYS = {
    "schemaVersion",
    "lane",
    "status",
    "errorCode",
    "durationMs",
    "readyDurationMs",
    "eventKinds",
    "progressMs",
    "processedMs",
    "segmentEvents",
    "replacementEvents",
    "segmentCount",
    "recoverySegmentCount",
    "outputExists",
    "recoveryMatchesSnapshot",
    "assMatchesReplacement",
    "zeroAcceptedOutput",
    "reaped",
    "gateReleased",
    "cancellationElapsedMs",
}


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


def safe_local(path_text: str) -> Path:
    path = (REPO / path_text).resolve()
    local = LOCAL.resolve()
    if not path.is_relative_to(local) or not path.is_file():
        raise RuntimeError("validation log escaped the ignored local root")
    return path


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


def expected_lane_header(lane: str, manifest: dict) -> dict:
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


def assert_sequence(actual: list, expected: list, mode: str, label: str) -> None:
    if mode == "exact" and actual != expected:
        raise RuntimeError(f"Step 6 observed {label} exact contract drift")
    if mode == "prefix" and actual[: len(expected)] != expected:
        raise RuntimeError(f"Step 6 observed {label} prefix contract drift")


def validate_observed(lane: str, observed: dict, expected: dict) -> None:
    if set(observed) != OBSERVED_KEYS:
        raise RuntimeError(f"Step 6 observed record shape drift: {lane}")
    if observed["schemaVersion"] != 1 or observed["lane"] != lane:
        raise RuntimeError(f"Step 6 observed lane identity drift: {lane}")
    if observed["status"] != expected["status"]:
        raise RuntimeError(f"Step 6 observed status drift: {lane}")
    if observed["errorCode"] != expected["errorCode"]:
        raise RuntimeError(f"Step 6 observed error drift: {lane}")
    if observed["durationMs"] != expected["durationMs"]:
        raise RuntimeError(f"Step 6 observed duration drift: {lane}")
    ready_duration = expected["durationMs"] if expected["ready"] else None
    if observed["readyDurationMs"] != ready_duration:
        raise RuntimeError(f"Step 6 observed ready contract drift: {lane}")
    assert_sequence(
        observed["eventKinds"], expected["eventKinds"], expected["eventKindsMode"], "eventKinds"
    )
    assert_sequence(
        observed["progressMs"], expected["progressMs"], expected["progressMode"], "progressMs"
    )
    if observed["segmentEvents"] != 0:
        raise RuntimeError(f"Step 6 raw preview reached the host: {lane}")
    if not observed["reaped"] or not observed["gateReleased"]:
        raise RuntimeError(f"Step 6 lifecycle cleanup drift: {lane}")
    if not observed["recoveryMatchesSnapshot"]:
        raise RuntimeError(f"Step 6 recovery snapshot drift: {lane}")

    if lane == "success":
        if not (
            observed["replacementEvents"] == 1
            and observed["segmentCount"] > 0
            and observed["recoverySegmentCount"] == observed["segmentCount"]
            and observed["processedMs"] == expected["durationMs"]
            and observed["outputExists"]
            and observed["assMatchesReplacement"] is True
            and not observed["zeroAcceptedOutput"]
            and observed["cancellationElapsedMs"] is None
        ):
            raise RuntimeError("Step 6 observed success outcome drift")
    else:
        if not (
            observed["replacementEvents"] == 0
            and observed["segmentCount"] == 0
            and observed["recoverySegmentCount"] == 0
            and not observed["outputExists"]
            and observed["assMatchesReplacement"] is None
            and observed["zeroAcceptedOutput"]
        ):
            raise RuntimeError(f"Step 6 observed zero-output contract drift: {lane}")
        elapsed = observed["cancellationElapsedMs"]
        if lane == "cancellation":
            if not isinstance(elapsed, int) or not 0 <= elapsed <= 2_000:
                raise RuntimeError("Step 6 observed cancellation bound drift")
        elif elapsed is not None:
            raise RuntimeError(f"Step 6 unexpected cancellation timing: {lane}")


def parse_lane_log(path: Path) -> tuple[dict, dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or not lines[0].startswith(HEADER_PREFIX):
        raise RuntimeError("Step 6 lane log is missing its canonical header")
    header = json.loads(lines[0].removeprefix(HEADER_PREFIX))
    if set(header) != {"payload", "sha256"}:
        raise RuntimeError("Step 6 lane header shape drift")
    if sha256_bytes(canonical_json(header["payload"]).encode("utf-8")) != header["sha256"]:
        raise RuntimeError("Step 6 lane header digest mismatch")
    observed = [
        json.loads(line.split(OBSERVED_PREFIX, 1)[1])
        for line in lines[1:]
        if OBSERVED_PREFIX in line
    ]
    if len(observed) != 1:
        raise RuntimeError("Step 6 lane log must contain one observed outcome record")
    return header, observed[0]


def load(index_path: Path = INDEX) -> tuple[dict, dict, dict[str, dict], dict[str, dict]]:
    if sha256_file(MANIFEST) != MANIFEST_SHA256:
        raise RuntimeError("Step 6 manifest identity drift")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    index = json.loads(index_path.read_text(encoding="utf-8"))
    if manifest.get("candidateId") != CANDIDATE or index.get("candidateId") != CANDIDATE:
        raise RuntimeError("Step 6 candidate identity drift")
    if index.get("schemaVersion") != 2:
        raise RuntimeError("Step 6 validation index schema drift")
    if index.get("manifest") != {
        "path": relative(MANIFEST),
        "sizeBytes": MANIFEST.stat().st_size,
        "sha256": MANIFEST_SHA256,
    }:
        raise RuntimeError("Step 6 index manifest identity drift")

    raw_entries = index.get("entries", [])
    labels = [entry.get("label") for entry in raw_entries]
    expected_labels = {*(f"lane-{lane}" for lane in LANES), *VALIDATIONS}
    if len(labels) != len(expected_labels) or len(set(labels)) != len(labels) or set(labels) != expected_labels:
        raise RuntimeError("Step 6 validation entry set drift")
    entries = {entry["label"]: entry for entry in raw_entries}
    for label, entry in entries.items():
        if entry.get("returnCode") != 0:
            raise RuntimeError(f"Step 6 validation failed: {label}")
        log = entry.get("log", {})
        path = safe_local(log.get("path", ""))
        if path.stat().st_size != log.get("sizeBytes") or sha256_file(path) != log.get("sha256"):
            raise RuntimeError(f"Step 6 validation log identity drift: {label}")

    lane_entries = [entries[f"lane-{lane}"] for lane in LANES]
    if len({entry["log"]["path"] for entry in lane_entries}) != len(LANES):
        raise RuntimeError("Step 6 lane logs were duplicated or relabelled")
    if len({entry["log"]["sha256"] for entry in lane_entries}) != len(LANES):
        raise RuntimeError("Step 6 lane log hashes were duplicated or relabelled")
    if len({entry["laneIdentity"]["sha256"] for entry in lane_entries}) != len(LANES):
        raise RuntimeError("Step 6 lane header digests were duplicated or relabelled")

    observed_by_lane: dict[str, dict] = {}
    for lane in LANES:
        label = f"lane-{lane}"
        entry = entries[label]
        expected_header = expected_lane_header(lane, manifest)
        if entry.get("lane") != lane:
            raise RuntimeError(f"Step 6 lane entry identity drift: {lane}")
        if entry.get("command") != lane_command() or entry.get("testFilter") != TEST_NAME:
            raise RuntimeError(f"Step 6 lane command/test filter drift: {lane}")
        if entry.get("environment") != lane_environment(lane):
            raise RuntimeError(f"Step 6 lane required environment drift: {lane}")
        if entry.get("manifestSha256") != MANIFEST_SHA256:
            raise RuntimeError(f"Step 6 lane manifest binding drift: {lane}")
        if entry.get("expectedOutcomeContract") != manifest["lanes"][lane]["expected"]:
            raise RuntimeError(f"Step 6 lane expected outcome contract drift: {lane}")
        if entry.get("laneIdentity") != expected_header:
            raise RuntimeError(f"Step 6 lane index header drift: {lane}")
        expected_log_path = relative(LOCAL / "validation" / "step6" / f"{label}.log")
        if entry["log"]["path"] != expected_log_path:
            raise RuntimeError(f"Step 6 lane log path drift: {lane}")

        header, observed = parse_lane_log(safe_local(entry["log"]["path"]))
        if header != expected_header:
            raise RuntimeError(f"Step 6 lane log header drift: {lane}")
        if entry.get("observed") != observed:
            raise RuntimeError(f"Step 6 lane entry/log outcome mismatch: {lane}")
        validate_observed(lane, observed, manifest["lanes"][lane]["expected"])
        observed_by_lane[lane] = observed

    source = (REPO / "src-tauri/src/asr_worker.rs").read_text(encoding="utf-8")
    if MANIFEST_SHA256 not in source or OBSERVED_PREFIX.strip() not in source:
        raise RuntimeError("Rust test source no longer binds the manifest or observed record")
    return manifest, index, entries, observed_by_lane


def observed_summary(observed: dict, progress_mode: str) -> tuple[str, str, str]:
    ready = "no" if observed["readyDurationMs"] is None else f"yes / {observed['readyDurationMs']}ms"
    progress = "none" if not observed["progressMs"] else ", ".join(map(str, observed["progressMs"]))
    if progress_mode == "prefix":
        progress += " (observed prefix)"
    return ready, progress, observed["errorCode"] or "none"


def render(
    manifest: dict, entries: dict[str, dict], observed_by_lane: dict[str, dict]
) -> str:
    cancellation_ms = observed_by_lane["cancellation"]["cancellationElapsedMs"]
    lines = [
        "# ReazonSpeech R2 Step 6 Rust-host validation",
        "",
        "## Scope and result",
        "",
        f"- Candidate: `{CANDIDATE}`.",
        "- Result: `validated` for the reviewed Step 6 host/lifecycle lanes.",
        "- This run performed no short-v1 / medium-v1 / long-v2 benchmark acquisition and publishes no quality disposition or relative selection.",
        f"- Ignored manifest: {MANIFEST.stat().st_size:,} bytes, SHA-256 `{MANIFEST_SHA256}`; the exact hash is bound in the Rust test source and this tracked report/lock.",
        "- Every lane row below is recomputed from one Rust-emitted observed record inside a lane-specific, digest-verified log header; manifest expectations are validation contracts, not reported outcomes.",
        "- Release/default routing and production commands remain unchanged; all input decoding and event tracing seams are test-only.",
        "",
        "## Explicit lane matrix",
        "",
        "| Lane | Worker role | Device | Observed status | Observed ready / duration | Observed progress | Observed error | Header SHA-256 | Log SHA-256 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for lane in LANES:
        manifest_lane = manifest["lanes"][lane]
        observed = observed_by_lane[lane]
        ready, progress, error = observed_summary(observed, manifest_lane["expected"]["progressMode"])
        entry = entries[f"lane-{lane}"]
        lines.append(
            f"| `{lane}` | `{manifest_lane['worker']}` | `{manifest_lane['device']}` | `{observed['status']}` | {ready} | {progress} | `{error}` | `{entry['laneIdentity']['sha256']}` | `{entry['log']['sha256']}` |"
        )
    lines += [
        "",
        "The observed success record contains the exact event order `ready -> progress* -> segmentsReplace -> completed`, one replacement, zero preview events, matching recovery segments, and a verified ASS/replacement vector. Each observed failure/cancellation record contains zero replacement/segments/recovery output. The cancellation record also reports process reap, gate release, and cancellation completion in "
        + f"`{cancellation_ms}ms` (within the existing two-second bound).",
        "",
        "All six lane log paths, log hashes and header digests are distinct. The publisher rejects duplicate labels, lane swaps, command/test-filter or required-environment mutation, manifest/expectation drift, duplicated protocol-as-policy evidence, and log/header digest mismatch.",
        "",
        "## Validation logs",
        "",
        "| Check | Result | Ignored log bytes | Log SHA-256 |",
        "|---|---|---:|---|",
    ]
    for label in VALIDATIONS:
        entry = entries[label]
        lines.append(
            f"| `{label}` | pass | {entry['log']['sizeBytes']:,} | `{entry['log']['sha256']}` |"
        )
    lines += [
        "",
        "## Reproduction",
        "",
        "```bash",
        "python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/run_r2_step6_validation.py",
        "python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/test_publish_r2_step6.py",
        "python .trellis/tasks/08-14-native-asr-reazonspeech-r2/research/publish_r2_step6.py",
        "```",
        "",
        "The runner invokes every lane separately with `HIKARU_ASR_R2_STEP6_REQUIRED=1`, the exact ignored manifest path, one explicit `HIKARU_ASR_R2_STEP6_LANE`, and the exact Rust test filter. The pre-existing generic `HIKARU_ASR_CRISPASR_INPUTS` decoder remains separate for T09/T10 Parakeet/Qwen/Reazon tests. It writes the canonical lane/command/environment/scenario/manifest/expectation header before command output.",
        "",
        "## Evidence boundary",
        "",
        "The ignored manifest contains repository-relative paths only and locks every worker, runtime DLL, model, VAD and audio role by byte size and SHA-256. Tracked output contains no transcript text, user-absolute path, model/audio/VAD bytes, stderr, binary or build output. Missing generic optional inputs still skip ordinary developer real-worker tests; `HIKARU_ASR_R2_STEP6_REQUIRED=1` plus an explicit R2 lane is fail-closed and cannot cross-authorize the generic decoder.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=REPORT)
    args = parser.parse_args()
    manifest, _, entries, observed_by_lane = load()
    text = render(manifest, entries, observed_by_lane)
    forbidden = (
        "C:" + "\\Users\\",
        "C:/" + "Users/",
        "/" + "Users/",
        str(REPO.resolve()),
    )
    if any(marker in text for marker in forbidden):
        raise RuntimeError("sanitized Step 6 report contains an absolute path")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text, encoding="utf-8", newline="\n")
    print(relative(args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
