#!/usr/bin/env python3
"""Run focused Candidate B adapter/publisher mutation rejection probes."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

import candidate_b_adapter as adapter
import publish_candidate_b as publisher


def expect_rejected(label: str, base: dict, mutation, validator, errors: tuple[type[Exception], ...]) -> str:
    changed = copy.deepcopy(base)
    mutation(changed)
    try:
        validator(changed)
    except errors:
        return label
    raise AssertionError(f"Candidate B validator accepted mutation: {label}")


def _mutate_correlated_module_root(value: dict) -> None:
    runtime = value["runtime"]
    roots = runtime["pathPolicy"]["resolvedRoots"]
    roots[0]["canonicalPath"] = r"C:\candidate-b-fake\bin"
    roots[1]["canonicalPath"] = r"C:\candidate-b-fake\system32"
    for module in runtime["loadedModules"]:
        root = roots[1]["canonicalPath"] if module["name"].lower().startswith("vcomp") else roots[0]["canonicalPath"]
        module["canonicalPath"] = root + "\\" + module["name"]
    payload = (
        f"measurement-executable-directory={roots[0]['canonicalPath']}\n"
        f"windows-system32={roots[1]['canonicalPath']}"
    )
    runtime["pathPolicy"]["rootIdentitySha256"] = hashlib.sha256(payload.encode()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--short-raw", type=Path, required=True)
    parser.add_argument("--short-result", type=Path, required=True)
    parser.add_argument("--medium-raw", type=Path, required=True)
    parser.add_argument("--medium-result", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--candidate-b-lock", type=Path, required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[4]
    benchmark = adapter.load_benchmark(repo_root)
    validation = benchmark.validate_manifest(args.manifest, args.corpus_root)
    cases = adapter.validate_authoritative_manifest(benchmark, validation)
    lock_text = args.candidate_b_lock.read_text(encoding="utf-8")
    lock_sha = adapter.sha256_file(args.candidate_b_lock)
    adapter.require_locked_tool(benchmark, Path(__file__), lock_text, "Candidate B mutation matrix")

    short_raw = json.loads(args.short_raw.read_text(encoding="utf-8"))
    short_result = json.loads(args.short_result.read_text(encoding="utf-8"))
    medium_raw = json.loads(args.medium_raw.read_text(encoding="utf-8"))
    medium_result = json.loads(args.medium_result.read_text(encoding="utf-8"))
    config_sha = adapter.validate_raw_identity(benchmark, short_raw, lock_text, lock_sha, "short-v1")
    medium_config_sha = adapter.validate_raw_identity(
        benchmark, medium_raw, lock_text, lock_sha, "medium-v1"
    )
    if config_sha != medium_config_sha:
        raise AssertionError("Candidate B base short/medium config identity differs")
    publisher.validate_adapted(
        benchmark, short_raw, short_result, cases["short-v1"], lock_sha, config_sha, lock_text
    )
    publisher.validate_adapted(
        benchmark, medium_raw, medium_result, cases["medium-v1"], lock_sha,
        medium_config_sha, lock_text
    )
    if any(short_raw[key] != medium_raw[key] for key in ("config", "runtime", "model")):
        raise AssertionError("Candidate B base short/medium identity differs")

    errors = (benchmark.ContractError, ValueError)
    raw_validator = lambda value: adapter.validate_raw_identity(
        benchmark, value, lock_text, lock_sha, "short-v1"
    )
    passed = []
    raw_mutations = (
        ("case", lambda value: value.update(caseId="medium-v1")),
        ("audio", lambda value: value["audio"].update(sha256="0" * 64)),
        ("model", lambda value: value["model"].update(revision="0" * 40)),
        ("model-file", lambda value: value["model"]["files"][1].update(sha256="0" * 64)),
        ("final-lock", lambda value: value.update(candidateBLockSha256="0" * 64)),
        ("config", lambda value: value["config"].update(beamSize=5)),
        ("runner", lambda value: value["runtime"]["measurementExecutable"].update(sha256="0" * 64)),
        ("worker", lambda value: value["runtime"]["productionWorker"].update(sha256="0" * 64)),
        ("required-dll", lambda value: value["runtime"]["requiredDlls"][0].update(sha256="0" * 64)),
        ("required-dll-set", lambda value: value["runtime"]["requiredDlls"].pop()),
        ("vad", lambda value: value["runtime"]["vadModel"].update(sha256="0" * 64)),
        ("loaded-module", lambda value: value["runtime"]["loadedModules"][0].update(sha256="0" * 64)),
        ("loaded-module-set", lambda value: value["runtime"]["loadedModules"].pop()),
        ("correlated-module-root", lambda value: _mutate_correlated_module_root(value)),
        ("cpu", lambda value: value["runtime"]["cpu"].update(logicalCores=1)),
        ("path-policy", lambda value: value["runtime"]["pathPolicy"].update(restricted=False)),
        ("timeout", lambda value: value.update(status="timed-out")),
        ("failure", lambda value: value["samples"][0].update(status="failed", failure={"code": "runtime_failed"})),
    )
    for label, mutation in raw_mutations:
        passed.append(expect_rejected(label, short_raw, mutation, raw_validator, errors))

    changed_validation = copy.deepcopy(validation)
    changed_validation["manifestSha256"] = "0" * 64
    try:
        adapter.validate_authoritative_manifest(benchmark, changed_validation)
    except errors:
        passed.append("manifest")
    else:
        raise AssertionError("Candidate B validator accepted mutation: manifest")

    passed.append(expect_rejected(
        "metrics",
        short_result,
        lambda value: value["cases"][0]["samples"][0]["cer"].update(cer=0.0),
        lambda value: publisher.validate_adapted(
            benchmark, short_raw, value, cases["short-v1"], lock_sha, config_sha, lock_text
        ),
        errors,
    ))
    passed.append(expect_rejected(
        "adapted-environment",
        short_result,
        lambda value: value["environment"]["pathPolicy"].update(entryCount=3),
        lambda value: publisher.validate_adapted(
            benchmark, short_raw, value, cases["short-v1"], lock_sha, config_sha, lock_text
        ),
        errors,
    ))

    expected = {
        "manifest", "case", "audio", "model", "model-file", "final-lock", "config",
        "runner", "worker", "required-dll", "required-dll-set", "vad", "loaded-module",
        "loaded-module-set", "correlated-module-root", "cpu", "path-policy", "metrics", "timeout", "failure",
        "adapted-environment",
    }
    if set(passed) != expected:
        raise AssertionError("Candidate B mutation matrix coverage drift")
    print(f"Candidate B mutation matrix passed ({len(passed)} cases): {','.join(sorted(passed))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
