#!/usr/bin/env python3
"""Deterministically validate and publish indexed T09 family evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import statistics
import sys

TASK_ROOT = Path(__file__).resolve().parents[1]
LOCAL_ROOT = (TASK_ROOT / "research" / "local").resolve()
FAMILIES = ("parakeet-family", "qwen3-family")
SAMPLES = ("short-v1", "medium-v1-first-120s")
DEVICES = ("cpu", "cuda")
RESULTS = {"development-gpu-ready", "development-gpu-no-speedup", "development-gpu-unavailable"}
FORBIDDEN_KEYS = {"text", "transcript", "segments", "token", "absolutePath"}
PRE_RUNNER_STAGES = {"prepare-runtime", "prepare-worker"}
DISCOVERY_UNAVAILABLE_CODES = {
    "crispasr_library_load_failed", "crispasr_abi_mismatch", "crispasr_backend_unavailable",
    "crispasr_model_load_failed", "crispasr_alignment_failed", "crispasr_device_unavailable",
}
REQUIRED_CPU_MODULES = {"hikaru-asr-crispasr-development-runner.exe"}
REQUIRED_CUDA_MODULES = REQUIRED_CPU_MODULES | {"nvcuda.dll", "ggml-cuda.dll", "cublas64_12.dll", "cudart64_12.dll"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8", newline="\n")
    temporary.replace(path)


def reject_private(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if any(forbidden.lower() in key.lower() for forbidden in FORBIDDEN_KEYS):
                raise ValueError(f"private field is not publishable: {key}")
            reject_private(child)
    elif isinstance(value, list):
        for child in value:
            reject_private(child)
    elif isinstance(value, str):
        if ":\\" in value or value.startswith("/") or ".." in value:
            raise ValueError("absolute/private path is not publishable")


FROZEN_INDEX_OVERRIDE: str | None = None


def frozen_lock_value(marker: str) -> str:
    lock = (TASK_ROOT / "research" / "crispasr-development-lock.md").read_text(encoding="utf-8")
    values = [line[len(marker):].strip() for line in lock.splitlines() if line.startswith(marker)]
    if len(values) != 1 or len(values[0]) != 64:
        raise ValueError(f"missing independently frozen {marker.strip(': ')}")
    return values[0]


def frozen_index_hash() -> str:
    if FROZEN_INDEX_OVERRIDE is not None:
        return FROZEN_INDEX_OVERRIDE
    return frozen_lock_value("rawIndexSha256: ")


def frozen_path_hash() -> str:
    if FROZEN_INDEX_OVERRIDE is not None:
        return "7" * 64
    return frozen_lock_value("restrictedPathSha256: ")


def indexed_rows(index_path: Path) -> tuple[str, list[dict[str, object]]]:
    index_hash = sha256(index_path)
    if index_hash != frozen_index_hash():
        raise ValueError("raw index differs from the independently frozen hash")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    if index.get("schema") != "hikaru-crispasr-development-raw-index-v1" or index.get("frozen") is not True:
        raise ValueError("raw index is not independently frozen")
    identifiers: set[str] = set()
    rows = []
    for entry in index.get("entries", []):
        identifier = entry["relativeRawIdentifier"]
        if identifier in identifiers:
            raise ValueError("duplicate raw identifier")
        identifiers.add(identifier)
        path = (LOCAL_ROOT / identifier).resolve()
        try:
            path.relative_to(LOCAL_ROOT)
        except ValueError as error:
            raise ValueError("raw identifier escapes local root") from error
        if path.is_symlink() or not path.is_file():
            raise ValueError("indexed raw file is missing or reparse/symlinked")
        if path.stat().st_size != entry["sizeBytes"] or sha256(path) != entry["sha256"]:
            raise ValueError("indexed raw bytes drifted")
        row = json.loads(path.read_text(encoding="utf-8"))
        for field in ("rowRole", "family", "phase", "device", "sample", "stage", "attemptId"):
            if field in entry and field in row and entry[field] != row[field]:
                raise ValueError(f"raw index {field} does not match the bound row")
        rows.append({"entry": entry, "row": row})
    actual = {
        path.resolve().relative_to(LOCAL_ROOT).as_posix()
        for path in LOCAL_ROOT.rglob("*.json")
        if "raw/" in path.resolve().relative_to(LOCAL_ROOT).as_posix()
        and path.name not in {"prepared-runtime.json", "prepared-worker.json"}
    }
    if actual != identifiers:
        raise ValueError("raw root contains missing, extra, or renamed JSON inputs")
    return index_hash, rows


def validate_identity(value: object, role: str) -> None:
    if not isinstance(value, dict) or set(value) != {"sizeBytes", "sha256"}:
        raise ValueError(f"{role} identity shape is invalid")
    if not isinstance(value["sizeBytes"], int) or value["sizeBytes"] < 0:
        raise ValueError(f"{role} size is invalid")
    if not isinstance(value["sha256"], str) or len(value["sha256"]) != 64:
        raise ValueError(f"{role} SHA-256 is invalid")
    try:
        int(value["sha256"], 16)
    except ValueError as error:
        raise ValueError(f"{role} SHA-256 is invalid") from error


def validate_pre_runner(row: dict[str, object]) -> None:
    required = {
        "schema", "family", "stage", "attemptId", "inputLockSha256",
        "commandRoleSha256", "exitCode", "logs", "privacyPass",
    }
    if set(row) != required or row["schema"] != "hikaru-crispasr-development-pre-runner-failure-v1":
        raise ValueError("pre-runner failure shape is invalid")
    if row["family"] not in FAMILIES or row["stage"] not in PRE_RUNNER_STAGES:
        raise ValueError("pre-runner family/stage is invalid")
    for key in ("attemptId", "inputLockSha256", "commandRoleSha256"):
        if not isinstance(row[key], str) or not row[key]:
            raise ValueError(f"pre-runner {key} is invalid")
    if len(row["inputLockSha256"]) != 64 or len(row["commandRoleSha256"]) != 64:
        raise ValueError("pre-runner hash identity is invalid")
    if not isinstance(row["exitCode"], int) or row["exitCode"] == 0 or row["exitCode"] == -1:
        raise ValueError("pre-runner exit category is invalid")
    if row["privacyPass"] is not True or not isinstance(row["logs"], list) or not row["logs"]:
        raise ValueError("pre-runner logs/privacy are invalid")
    roles = []
    for log in row["logs"]:
        if not isinstance(log, dict) or set(log) != {
            "role", "relativePath", "sizeBytes", "sha256", "durationMs", "exitCode", "privacyPass"
        }:
            raise ValueError("pre-runner log shape is invalid")
        roles.append(log["role"])
        if log["role"] not in {"configure", "build"} or log["privacyPass"] is not True:
            raise ValueError("pre-runner log role/privacy is invalid")
        if not isinstance(log["relativePath"], str) or log["relativePath"].startswith(("/", "\\")) or ".." in log["relativePath"]:
            raise ValueError("pre-runner log path is invalid")
        validate_identity({"sizeBytes": log["sizeBytes"], "sha256": log["sha256"]}, "pre-runner log")
        if not isinstance(log["durationMs"], (int, float)) or log["durationMs"] < 0:
            raise ValueError("pre-runner log duration is invalid")
        if not isinstance(log["exitCode"], int):
            raise ValueError("pre-runner log exit is invalid")
    if roles not in (["configure"], ["configure", "build"]):
        raise ValueError("pre-runner log order is invalid")
    if row["logs"][-1]["exitCode"] != row["exitCode"]:
        raise ValueError("pre-runner exit/log mismatch")


def validate_modules(row: dict[str, object]) -> None:
    checkpoints = row.get("moduleCheckpoints")
    expected_stages = (["failure"] if row.get("status") == "unavailable" else
                       ["post-session-open", "post-alignment" if row["family"] == "qwen3-family" else "post-transcribe"])
    if not isinstance(checkpoints, list) or [item.get("stage") for item in checkpoints] != expected_stages:
        raise ValueError("module checkpoint stages are invalid")
    required = REQUIRED_CUDA_MODULES if row["device"] == "cuda" else REQUIRED_CPU_MODULES
    for checkpoint in checkpoints:
        modules = checkpoint.get("modules")
        if not isinstance(modules, list) or not modules:
            raise ValueError("module checkpoint inventory is missing")
        names = set()
        for module in modules:
            if not isinstance(module, dict) or set(module) != {"name", "rootRole", "relativePath", "identity"}:
                raise ValueError("module identity shape is invalid")
            if module["rootRole"] not in {"runtime-bin", "system32", "cuda-bin"}:
                raise ValueError("module root role is invalid")
            name_lower = module["name"].lower()
            expected_role = "system32" if name_lower == "nvcuda.dll" else "runtime-bin"
            if name_lower in {"hikaru-asr-crispasr-development-runner.exe", "nvcuda.dll", "ggml-cuda.dll", "cublas64_12.dll", "cudart64_12.dll"} and module["rootRole"] != expected_role:
                raise ValueError("required module root role drifted")
            if not isinstance(module["relativePath"], str) or ":\\" in module["relativePath"] or module["relativePath"].startswith(("/", "\\")) or ".." in module["relativePath"]:
                raise ValueError("module relative path is invalid")
            validate_identity(module["identity"], "loaded module")
            if module["name"].lower() != Path(module["relativePath"]).name.lower():
                raise ValueError("module name/path role drifted")
            names.add(module["name"].lower())
        if not {name.lower() for name in required}.issubset(names):
            raise ValueError("required runtime modules are missing")
    path_policy = row.get("restrictedPath")
    if not isinstance(path_policy, dict) or path_policy.get("roles") != ["runtime-bin", "cuda-bin", "system32"]:
        raise ValueError("restricted PATH policy is invalid")
    if path_policy.get("sha256") != frozen_path_hash():
        raise ValueError("restricted PATH identity is invalid")


def stderr_privacy_passes(payload: bytes) -> bool:
    lower = payload.lower()
    secrets = (b"authorization:", b"bearer ", b"password=", b"begin private key")
    sentinels = ("字幕", "转录", "私密", "日本語テスト")
    return (all(secret not in lower for secret in secrets)
            and all(sentinel.encode("utf-8") not in payload for sentinel in sentinels)
            and all(sentinel.encode("unicode_escape") not in payload for sentinel in sentinels))


def validate_runner_row(row: dict[str, object]) -> None:
    if row.get("schema") != "hikaru-crispasr-development-row-v1":
        raise ValueError("runner row schema is invalid")
    if row.get("family") not in FAMILIES or row.get("device") not in DEVICES:
        raise ValueError("runner family/device is invalid")
    if row.get("phase") not in {"discovery", "formal"} or row.get("sample") not in SAMPLES:
        raise ValueError("runner phase/sample is invalid")
    for role in ("inputLock", "runner", "worker", "library", "model", "audio"):
        validate_identity(row.get(role), role)
    qwen = row["family"] == "qwen3-family"
    if qwen:
        validate_identity(row.get("aligner"), "aligner")
    elif "aligner" in row:
        raise ValueError("parakeet family carried an aligner")
    expected_params = {
        "abiVersion": 2, "threads": 16, "useGpu": 1 if row["device"] == "cuda" else 0,
        "verbosity": 0, "flashAttn": 0, "gpuLayers": -1 if row["device"] == "cuda" else 0,
        "preference": "cuda" if row["device"] == "cuda" else "none",
    }
    if row.get("openParams") != expected_params or row.get("resolvedComputeDeviceAvailable") is not False:
        raise ValueError("runner open-parameter/device identity drifted")
    validate_modules(row)
    stderr = row.get("stderr")
    if not isinstance(stderr, dict) or stderr.get("privacyPass") is not True:
        raise ValueError("stderr privacy evidence is missing")
    if not isinstance(stderr.get("relativePath"), str) or stderr["relativePath"].startswith(("/", "\\")) or ".." in stderr["relativePath"]:
        raise ValueError("stderr path is invalid")
    validate_identity({"sizeBytes": stderr.get("sizeBytes"), "sha256": stderr.get("sha256")}, "stderr")
    stderr_path = (LOCAL_ROOT / stderr["relativePath"]).resolve()
    try:
        stderr_path.relative_to(LOCAL_ROOT)
    except ValueError as error:
        raise ValueError("stderr path escapes local root") from error
    if not stderr_path.is_file() or stderr_path.stat().st_size != stderr["sizeBytes"] or sha256(stderr_path) != stderr["sha256"]:
        raise ValueError("stderr bytes drifted")
    if not stderr_privacy_passes(stderr_path.read_bytes()):
        raise ValueError("stderr privacy scan failed")
    if row["device"] == "cuda":
        cuda = row.get("cudaDevice")
        if (not isinstance(cuda, dict) or set(cuda) != {"index", "name", "computeCapability", "driverApiVersion"}
                or cuda.get("index") != 0 or cuda.get("name") != "NVIDIA GeForce RTX 3070"
                or cuda.get("computeCapability") != "8.6" or cuda.get("driverApiVersion") != 13020):
            raise ValueError("CUDA device identity is invalid")
    if row.get("status") == "completed":
        expected_count = 1 if row["phase"] == "discovery" else 4
        if len(row.get("generations", [])) != expected_count:
            raise ValueError("runner generation count is invalid")
    elif row.get("status") == "unavailable":
        if row["phase"] != "discovery" or row.get("errorCode") not in DISCOVERY_UNAVAILABLE_CODES or row.get("generations") != []:
            raise ValueError("runner unavailable envelope is invalid")
    else:
        raise ValueError("runner status is invalid")


def publish(index_path: Path, json_output: Path, report_output: Path) -> None:
    index_hash, indexed = indexed_rows(index_path)
    allowed_roles = {"pre-runner-failure", "discovery", "formal"}
    if any(item["entry"].get("rowRole") not in allowed_roles for item in indexed):
        raise ValueError("raw index contains an unknown row role")
    pre_runner = [item for item in indexed if item["entry"].get("rowRole") == "pre-runner-failure"]
    if pre_runner and len(pre_runner) != len(indexed):
        raise ValueError("pre-runner and runner evidence cannot be mixed")
    results: dict[str, dict[str, object]] = {}
    if pre_runner:
        for item in pre_runner:
            validate_pre_runner(item["row"])
        if len(pre_runner) != 2 or {item["row"]["family"] for item in pre_runner} != set(FAMILIES):
            raise ValueError("shared pre-runner failure must contain both families")
        attempts = {item["row"]["attemptId"] for item in pre_runner}
        stages = {item["row"]["stage"] for item in pre_runner}
        commands = {item["row"]["commandRoleSha256"] for item in pre_runner}
        if len(attempts) != 1 or len(stages) != 1 or len(commands) != 1:
            raise ValueError("pre-runner family pairing drifted")
        for item in pre_runner:
            row = item["row"]
            results[row["family"]] = {"result": "development-gpu-unavailable", "stage": row["stage"]}
    else:
        checkpoint_identities: dict[tuple[str, str, str], set[str]] = {}
        for item in indexed:
            row = item["row"]
            if row.get("status") != "completed":
                continue
            for checkpoint in row.get("moduleCheckpoints", []):
                key = (row["family"], row["device"], checkpoint["stage"])
                checkpoint_identities.setdefault(key, set()).add(
                    json.dumps(checkpoint["modules"], sort_keys=True, separators=(",", ":")))
        if any(len(identities) != 1 for identities in checkpoint_identities.values()):
            raise ValueError("exact module checkpoint inventory drifted")
        for family in FAMILIES:
            family_rows = [item["row"] for item in indexed if item["row"].get("family") == family]
            for row in family_rows:
                validate_runner_row(row)
            discoveries = [row for row in family_rows if row.get("phase") == "discovery"]
            if len(discoveries) != 2 or {row["device"] for row in discoveries} != set(DEVICES):
                raise ValueError("family discovery matrix is incomplete")
            unavailable = [row for row in discoveries if row.get("status") == "unavailable"]
            formal = [row for row in family_rows if row.get("phase") == "formal"]
            if unavailable:
                if formal:
                    raise ValueError("unavailable discovery must not coexist with formal rows")
                if any(row.get("errorCode") not in DISCOVERY_UNAVAILABLE_CODES for row in unavailable):
                    raise ValueError("discovery unavailable category is invalid")
                results[family] = {"result": "development-gpu-unavailable", "stage": "discovery"}
                continue
            if len(formal) != 4 or {(row["device"], row["sample"]) for row in formal} != {
                (device, sample) for device in DEVICES for sample in SAMPLES
            }:
                raise ValueError("family formal matrix is incomplete")
            medians: dict[str, float] = {}
            max_alignment_tail_overrun_ms = 0
            for row in formal:
                generations = row.get("generations", [])
                if len(generations) != 4 or [(g["repeatIndex"], g["temperature"]) for g in generations] != [
                    (0, "cold"), (1, "warm"), (2, "warm"), (3, "warm")
                ]:
                    raise ValueError("formal repeat sequence drifted")
                qwen = family == "qwen3-family"
                for generation in generations:
                    if "lifecycle" in generation:
                        raise ValueError("runner published unsupported lifecycle claims")
                    if qwen and (generation["terminalCode"] != "qwen_timeline_policy_not_implemented"
                                 or generation["acceptedSegmentCount"] != 0
                                 or generation["alignmentEntryCount"] <= 0
                                 or not isinstance(generation.get("alignmentRanges"), list)
                                 or len(generation["alignmentRanges"]) != generation["alignmentEntryCount"]
                                 or not isinstance(generation.get("maxAlignmentTailOverrunMs"), int)
                                 or generation["maxAlignmentTailOverrunMs"] < 0):
                        raise ValueError("Qwen strict policy row drifted")
                    if qwen:
                        derived_overrun = 0
                        duration_ms = 24102 if row["sample"] == "short-v1" else 120000
                        for alignment_range in generation["alignmentRanges"]:
                            if (not isinstance(alignment_range, list) or len(alignment_range) != 2
                                    or not all(isinstance(value, int) for value in alignment_range)
                                    or alignment_range[0] < 0 or alignment_range[1] < alignment_range[0]):
                                raise ValueError("Qwen raw alignment range drifted")
                            derived_overrun = max(derived_overrun, max(0, alignment_range[1] - duration_ms))
                        if generation["maxAlignmentTailOverrunMs"] != derived_overrun:
                            raise ValueError("Qwen maximum alignment tail overrun drifted")
                        max_alignment_tail_overrun_ms = max(max_alignment_tail_overrun_ms, derived_overrun)
                    if not qwen and (generation["terminalCode"] != "completed"
                                     or generation.get("alignmentRanges") is not None
                                     or generation.get("maxAlignmentTailOverrunMs") is not None):
                        raise ValueError("Parakeet family terminal drifted")
                key = f'{row["device"]}:{row["sample"]}'
                medians[key] = statistics.median(float(g["rtf"]) for g in generations[1:])
            ratios = {
                sample: medians[f"cuda:{sample}"] / medians[f"cpu:{sample}"]
                for sample in SAMPLES
            }
            result = "development-gpu-ready" if all(value <= 0.8 for value in ratios.values()) else "development-gpu-no-speedup"
            results[family] = {"result": result, "warmMedianRtf": medians, "gpuCpuRatio": ratios}
            if family == "qwen3-family":
                results[family]["maxAlignmentTailOverrunMs"] = max_alignment_tail_overrun_ms

    if set(results) != set(FAMILIES) or any(value["result"] not in RESULTS for value in results.values()):
        raise ValueError("each family must publish exactly one result")
    common_identity: dict[str, object] = {}
    runner_rows = [item["row"] for item in indexed if item["entry"].get("rowRole") in {"discovery", "formal"}]
    if runner_rows:
        for role in ("inputLock", "runner", "worker", "library"):
            identities = {json.dumps(row[role], sort_keys=True) for row in runner_rows}
            if len(identities) != 1:
                raise ValueError(f"shared {role} identity drifted across families/rows")
            common_identity[role] = runner_rows[0][role]
        model_by_family = {
            family: runner_rows[next(index for index, row in enumerate(runner_rows) if row["family"] == family)]["model"]
            for family in FAMILIES
        }
        common_identity["modelByFamily"] = model_by_family
    publication = {
        "schema": "hikaru-crispasr-development-publication-v1",
        "rawIndexSha256": index_hash,
        "resolvedComputeDeviceAvailable": False,
        "identity": common_identity,
        "results": results,
        "limitations": [
            "Ignored-local development evidence only; not a runtime pack or Release qualification.",
            "CrispASR v0.8.22 has no public resolved-compute-device getter.",
            "Qwen raw alignment tail overruns are retained unchanged and reported diagnostically; they are never accepted timing.",
            "Qwen timeline grouping remains T11-owned and zero accepted timed output is required here.",
        ],
    }
    reject_private(publication)
    json_text = json.dumps(publication, ensure_ascii=True, sort_keys=True, indent=2) + "\n"
    lines = ["# T09 CrispASR Development Report", "", f"Raw index SHA-256: `{index_hash}`", ""]
    for family in FAMILIES:
        value = results[family]
        lines += [f"## {family}", "", f"Result: `{value['result']}`", ""]
        for sample, ratio in value.get("gpuCpuRatio", {}).items():
            lines.append(f"- {sample} GPU/CPU warmed-median ratio: `{ratio:.6f}`")
        if "maxAlignmentTailOverrunMs" in value:
            lines.append(f"- Maximum raw alignment tail overrun: `{value['maxAlignmentTailOverrunMs']}ms`")
        if value.get("gpuCpuRatio"): lines.append("")
    lines += ["## Boundary", "", "Development-only external attestation; no production/default route, package, downloader, or UI change.", ""]
    atomic(json_output, json_text)
    atomic(report_output, "\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-index", required=True)
    parser.add_argument("--json-output", required=True)
    parser.add_argument("--report-output", required=True)
    arguments = parser.parse_args()
    try:
        publish(Path(arguments.raw_index), Path(arguments.json_output), Path(arguments.report_output))
        return 0
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"T09 publication rejected: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
