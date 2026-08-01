#!/usr/bin/env python3
"""Shared invocation and audit helpers for the native evidence identity validator."""

from __future__ import annotations

import argparse
import copy
import json
import subprocess
import tempfile
from pathlib import Path


def validator_command(
    *, executable: Path, evidence: Path, manifest: Path, manifest_sha256: str,
    lock: Path, model: Path, audio: Path, case_id: str,
    case_source: str = "t01-authoritative", aligner: Path | None = None,
    source_audio: Path | None = None, derivation: str | None = None,
    corrupt_aligner: Path | None = None, unloadable_aligner: Path | None = None,
) -> list[str]:
    command = [
        str(executable), "--validate-evidence", str(evidence),
        "--manifest", str(manifest), "--manifest-sha256", manifest_sha256,
        "--lock", str(lock), "--model", str(model), "--audio", str(audio),
        "--case-id", case_id, "--case-source", case_source,
    ]
    for flag, value in (
        ("--aligner", aligner), ("--source-audio", source_audio),
        ("--derivation", derivation), ("--corrupt-aligner", corrupt_aligner),
        ("--unloadable-aligner", unloadable_aligner),
    ):
        if value is not None:
            command.extend((flag, str(value)))
    return command


def validate_evidence(**kwargs) -> subprocess.CompletedProcess[str]:
    return subprocess.run(validator_command(**kwargs), text=True, capture_output=True, check=True)


def row_identity(raw: dict) -> dict:
    ids = raw["identities"]
    return {
        "case": ids["case"],
        "inputLock": ids["inputLock"],
        "executable": ids["executable"],
        "requiredDlls": ids["requiredDlls"],
        "primaryModel": ids["primaryModel"],
        "alignerModel": ids["alignerModel"],
        "cpuOpenParams": raw["runtime"]["openParams"],
        "loadedLocalModules": raw["runtime"]["loadedLocalModules"],
        "restrictedPath": raw["environment"]["pathPolicy"],
    }


def _expect_rejected(base: dict, mutation, validator_kwargs: dict, label: str, root: Path) -> None:
    changed = copy.deepcopy(base)
    mutation(changed)
    path = root / f"{label}.json"
    path.write_text(json.dumps(changed, ensure_ascii=False), encoding="utf-8")
    try:
        validate_evidence(evidence=path, **validator_kwargs)
    except subprocess.CalledProcessError:
        return
    raise AssertionError(f"shared validator accepted mutation: {label}")


def mutation_test(args: argparse.Namespace) -> int:
    common = {
        "executable": args.executable, "manifest": args.manifest,
        "manifest_sha256": args.manifest_sha256, "lock": args.lock,
        "model": args.model, "aligner": args.aligner, "audio": args.audio,
        "case_id": "short-v1", "case_source": "t01-authoritative",
    }
    raw = json.loads(args.raw.read_text(encoding="utf-8"))
    validate_evidence(evidence=args.raw, **common)
    mutations = (
        ("case-id", lambda value: value["identities"]["case"].update(caseId="medium-v1")),
        ("audio-size", lambda value: value["identities"]["case"]["audio"].update(sizeBytes=1)),
        ("audio-sha", lambda value: value["identities"]["case"]["audio"].update(sha256="0" * 64)),
        ("manifest", lambda value: value["identities"]["case"].update(manifestSha256="0" * 64)),
        ("input-lock", lambda value: value["identities"]["inputLock"].update(sha256="0" * 64)),
        ("executable", lambda value: value["identities"]["executable"].update(sha256="0" * 64)),
        ("required-dll", lambda value: value["identities"]["requiredDlls"][0].update(sha256="0" * 64)),
        ("required-dll-set", lambda value: value["identities"]["requiredDlls"].pop()),
        ("primary-model", lambda value: value["identities"]["primaryModel"].update(sha256="0" * 64)),
        ("aligner-role", lambda value: value["identities"]["alignerModel"].update(role="primary")),
        ("cpu-open", lambda value: value["runtime"]["openParams"].update(useGpu=1)),
        ("loaded-module", lambda value: value["runtime"]["loadedLocalModules"][0].update(sha256="0" * 64)),
        ("loaded-module-set", lambda value: value["runtime"]["loadedLocalModules"].pop()),
        ("restricted-path", lambda value: value["environment"]["pathPolicy"].update(restricted=False)),
        ("qwen-session-getter-eligibility", lambda value: value["samples"][0]["sessionGetterWordTiming"].update(eligibleForAcceptedTimeline=True)),
        ("qwen-grouping-count", lambda value: value["samples"][0].update(alignmentUnitCount=value["samples"][0]["alignmentUnitCount"] - 1)),
        ("raw-align-free-count", lambda value: value["samples"][0]["cleanup"].update(alignResultFreeCount=0)),
        ("raw-align-exact-once", lambda value: value["samples"][0]["cleanup"].update(alignResultExactOnce=False)),
    )
    with tempfile.TemporaryDirectory(dir=args.temp_root) as tmp:
        root = Path(tmp)
        for label, mutation in mutations:
            _expect_rejected(raw, mutation, common, label, root)

        derived_common = dict(common, evidence=args.derived, audio=args.derived_audio,
                              case_id="qwen-leading-silence-v1", case_source="derived-obligation",
                              source_audio=args.audio, derivation="prepend-2000ms-zero-pcm16")
        derived = json.loads(args.derived.read_text(encoding="utf-8"))
        validate_evidence(**derived_common)
        derived_kwargs = {key: value for key, value in derived_common.items() if key != "evidence"}
        for label, mutation in (
            ("derived-source-audio", lambda value: value["identities"]["case"]["derivation"]["sourceAudio"].update(sha256="0" * 64)),
            ("derived-audio-size", lambda value: value["identities"]["case"]["audio"].update(sizeBytes=1)),
            ("derived-audio-sha", lambda value: value["identities"]["case"]["audio"].update(sha256="0" * 64)),
            ("derived-id", lambda value: value["identities"]["case"]["derivation"].update(id="other")),
            ("derived-source-case", lambda value: value["identities"]["case"]["derivation"].update(sourceCaseId="medium-v1")),
        ):
            _expect_rejected(derived, mutation, derived_kwargs, label, root)

        long_common = dict(common, evidence=args.long, audio=args.long_audio,
                           case_id="long-v1", case_source="t01-authoritative")
        long_raw = json.loads(args.long.read_text(encoding="utf-8"))
        validate_evidence(**long_common)
        sample = long_raw["samples"][0]
        if sample["alignmentUnitCount"] != 20915 or len(sample["rawAlignmentEntries"]) != 20915:
            raise AssertionError("actual Qwen long source/alignment unit count is not the expected 20,915")
        _expect_rejected(
            long_raw, lambda value: value["samples"][0].update(alignmentUnitCount=20914),
            {key: value for key, value in long_common.items() if key != "evidence"},
            "long-alignment-unit-count", root,
        )

        negative_common = dict(
            executable=args.executable, manifest=args.manifest, manifest_sha256=args.manifest_sha256,
            lock=args.lock, model=args.model, aligner=args.aligner, audio=args.audio,
            case_id="short-v1", case_source="negative-obligation",
            corrupt_aligner=args.corrupt_aligner, unloadable_aligner=args.unloadable_aligner,
        )
        negative = json.loads(args.negative.read_text(encoding="utf-8"))
        validate_evidence(evidence=args.negative, **negative_common)
        for label, mutation in (
            ("negative-top-level-identity", lambda value: value["identities"]["primaryModel"].update(sha256="0" * 64)),
            ("negative-base-identity-first", lambda value: value["cases"][0]["identity"]["baseEvidenceIdentity"]["executable"].update(sha256="0" * 64)),
            ("negative-base-identity-last", lambda value: value["cases"][-1]["identity"]["baseEvidenceIdentity"]["inputLock"].update(sha256="0" * 64)),
            ("negative-created-count", lambda value: value["cases"][0]["lifecycle"].update(alignResultCreated=True)),
            ("negative-free-count", lambda value: value["cases"][4]["lifecycle"].update(alignResultFreeCount=0)),
            ("negative-exact-once", lambda value: value["cases"][0]["lifecycle"].update(exactOnce=False)),
            ("negative-baseline-created", lambda value: value["baseline"]["lifecycle"].update(alignResultCreated=False)),
            ("negative-baseline-free", lambda value: value["baseline"]["lifecycle"].update(alignResultFreeCount=0)),
            ("negative-observed-fixture", lambda value: value["cases"][1]["identity"]["observedAligner"].update(sha256="0" * 64)),
        ):
            _expect_rejected(negative, mutation, negative_common, label, root)
    print("shared evidence validator mutation probes passed (raw, deterministic-derived, exact-upstream-long-count, all-negative lifecycle/identity)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mutation-test", action="store_true")
    for name in ("executable", "manifest", "lock", "model", "aligner", "audio", "raw", "derived",
                 "derived-audio", "long", "long-audio", "negative", "corrupt-aligner",
                 "unloadable-aligner", "temp-root"):
        parser.add_argument(f"--{name}", type=Path)
    parser.add_argument("--manifest-sha256")
    args = parser.parse_args()
    if args.mutation_test:
        return mutation_test(args)
    parser.error("mode required")


if __name__ == "__main__":
    raise SystemExit(main())
