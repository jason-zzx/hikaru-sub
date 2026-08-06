#!/usr/bin/env python3
"""Focused mutation, determinism, privacy, and archive-integrity checks for T03C."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("t03c_publisher", HERE / "publish_crispasr_long_v2_correction.py")
assert SPEC and SPEC.loader
publisher = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = publisher
SPEC.loader.exec_module(publisher)


def tracked_archive_hashes() -> dict[str, str]:
    roots = [
        ".trellis/tasks/archive/2026-07/07-25-native-asr-benchmark-baseline",
        ".trellis/tasks/archive/2026-08/07-25-native-asr-crispasr-poc",
    ]
    files = []
    for root in roots:
        files.extend(subprocess.check_output(["git", "ls-files", root], cwd=publisher.REPO, text=True).splitlines())
    return {name: hashlib.sha256((publisher.REPO / name).read_bytes()).hexdigest() for name in sorted(files)}


class CorrectionPublisherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = tracked_archive_hashes()
        cls.root = publisher.LOCAL / "publisher-tests"
        shutil.rmtree(cls.root, ignore_errors=True)
        cls.root.mkdir(parents=True)
        cls.base = publisher.load_json(publisher.TASK / "research/evidence/crispasr-long-v2-correction.json")
        publisher.validate_publication_data(cls.base, require_compiled=True)

    @classmethod
    def tearDownClass(cls):
        after = tracked_archive_hashes()
        if cls.before != after:
            raise AssertionError("archived T01/T03 tracked bytes changed")
        shutil.rmtree(cls.root, ignore_errors=True)

    def rejected(self, value, message="mutation was accepted"):
        with self.assertRaises(publisher.CorrectionError, msg=message):
            publisher.validate_publication_data(value, require_compiled=True)

    def test_compiled_validation_cannot_be_disabled(self):
        with self.assertRaises(publisher.CorrectionError):
            publisher.build_publication(validate_compiled=False)
        with self.assertRaises(publisher.CorrectionError):
            publisher.validate_publication_data(self.base, require_compiled=False)
        changed = copy.deepcopy(self.base)
        changed["identity"]["compiledValidationRows"] = []
        self.rejected(changed)

    def test_manifest_and_mapping_drift_rejected(self):
        for attribute, source in (("OLD_MANIFEST", publisher.OLD_MANIFEST), ("CURRENT_MANIFEST", publisher.CURRENT_MANIFEST)):
            changed = self.root / f"mutated-{source.name}"
            changed.write_bytes(source.read_bytes() + b" ")
            original = getattr(publisher, attribute)
            setattr(publisher, attribute, changed)
            try:
                with self.assertRaises(publisher.CorrectionError):
                    benchmark = publisher.load_module(f"benchmark_{attribute}", publisher.COMPARATOR)
                    publisher.validate_manifest_identities(benchmark)
            finally:
                setattr(publisher, attribute, original)

        for mutate in (
            lambda value: value["identity"]["longAudio"].update(sha256="0" * 64),
            lambda value: value["identity"]["t03Executable"].update(sha256="0" * 64),
            lambda value: value["identity"]["requiredDlls"][0].update(sha256="0" * 64),
            lambda value: value["identity"]["models"][0].update(sha256="0" * 64),
            lambda value: value["identity"]["cpuOpenParams"].update(useGpu=1),
            lambda value: value["identity"]["restrictedPath"].update(restricted=False),
        ):
            changed = copy.deepcopy(self.base)
            mutate(changed)
            self.rejected(changed)

    def test_raw_hash_role_status_and_matrix_mutations_rejected(self):
        paths = {key: publisher.raw_path(key) for key in publisher.RAW_HASHES}
        mutated = self.root / "parakeet-short.json"
        mutated.write_bytes(paths["parakeet-short"].read_bytes() + b" ")
        paths["parakeet-short"] = mutated
        with self.assertRaises(publisher.CorrectionError):
            publisher.validate_raw_inventory(paths)

        paths = {key: publisher.raw_path(key) for key in publisher.RAW_HASHES}
        paths["parakeet-short"] = paths["reazonspeech-short"]
        with self.assertRaises(publisher.CorrectionError):
            publisher.validate_raw_inventory(paths)

        changed = copy.deepcopy(self.base)
        changed["rows"].pop()
        self.rejected(changed)

        changed = copy.deepcopy(self.base)
        changed["rows"][7]["status"] = "measured"
        changed["rows"][7]["cer"] = {"cer": 0.1}
        self.rejected(changed)

    def test_metric_gate_disposition_and_lock_mutations_rejected(self):
        for mutate in (
            lambda value: value["rows"][2]["cer"].update(cer=0.5),
            lambda value: value["budgets"].update(cerMax=0.36),
            lambda value: value["routeDispositions"].update(reazonspeech="qualified"),
        ):
            changed = copy.deepcopy(self.base)
            mutate(changed)
            self.rejected(changed)

        changed_lock = self.root / "lock.md"
        changed_lock.write_text(publisher.LOCK.read_text(encoding="utf-8").replace(publisher.CURRENT_MANIFEST_SHA, "0" * 64, 1), encoding="utf-8")
        original = publisher.LOCK
        publisher.LOCK = changed_lock
        try:
            with self.assertRaises(publisher.CorrectionError):
                publisher.validate_correction_lock()
        finally:
            publisher.LOCK = original

    def test_complete_canonical_binding_rejects_coordinated_mutations(self):
        mutations = (
            lambda value: value["rows"][0].update(rawSha256="0" * 64),
            lambda value: value["rows"][0].update(status="diagnostic"),
            lambda value: (value["rows"][0]["gates"].update(cer="pass", semanticGaps="pass"), value["rows"][0].update(result="pass")),
            lambda value: value["rows"][0]["cer"].update(errors=0, substitutions=0, deletions=0, insertions=0),
            lambda value: value["identity"]["loadedLocalModules"][0].update(sha256="0" * 64),
            lambda value: value["identity"]["t03Executable"].update(sizeBytes=1),
            lambda value: value["identity"]["requiredDlls"][0].update(sizeBytes=1),
            lambda value: value["identity"]["models"][0].update(sizeBytes=1),
            lambda value: value["rows"][7].update(rawSha256="0" * 64),
            lambda value: value["rows"][7].update(attempted=False),
            lambda value: (value["rows"][7]["gates"].update(cer="pass"), value["rows"][7].update(result="pass")),
            lambda value: value["rows"][7].update(alignmentUnitCount=0, rawAlignerEntryCount=0),
            lambda value: value["rows"][7].update(inferenceRtf=0.0, peakProcessRssBytes=0),
        )
        for mutate in mutations:
            changed = copy.deepcopy(self.base)
            mutate(changed)
            self.rejected(changed)

    def test_privacy_mutations_rejected(self):
        for key, value in (
            ("text", "private transcript"),
            ("tokens", [1, 2]),
            ("rawAlignmentEntries", [{"startMs": 0}]),
            ("debug", str(publisher.REPO)),
            ("privatePath", ".asr-benchmark/long-v2.ass"),
        ):
            changed = copy.deepcopy(self.base)
            changed[key] = value
            self.rejected(changed)

        benchmark = publisher.load_module("t03c_privacy_benchmark", publisher.COMPARATOR)
        _, current = publisher.validate_manifest_identities(benchmark)
        private_reference = publisher.current_case(current, "short-v1")["reference"]["text"]
        harmless = copy.deepcopy(self.base)
        harmless["namedRisks"]["parakeet"][0] = "harmless reviewer probe"
        publisher.validate_publication_privacy(harmless)
        changed = copy.deepcopy(self.base)
        changed["namedRisks"]["parakeet"][0] = private_reference
        with self.assertRaises(publisher.CorrectionError, msg="actual private reference text was not detected by content"):
            publisher.validate_publication_privacy(changed)

    def test_actual_double_publication_is_byte_identical(self):
        first = self.root / "first"
        second = self.root / "second"
        publisher.write_publication(first / "evidence.json", first / "report.md", validate_compiled=True)
        publisher.write_publication(second / "evidence.json", second / "report.md", validate_compiled=True)
        self.assertEqual((first / "evidence.json").read_bytes(), (second / "evidence.json").read_bytes())
        self.assertEqual((first / "report.md").read_bytes(), (second / "report.md").read_bytes())
        data = json.loads((first / "evidence.json").read_text(encoding="utf-8"))
        publisher.validate_publication_data(data, require_compiled=True)

    def test_local_root_is_ignored_for_active_and_archive_shapes(self):
        active = ".trellis/tasks/08-06-crispasr-long-v2-correction/research/local/probe.json"
        archived = ".trellis/tasks/archive/2099-01/08-06-crispasr-long-v2-correction/research/local/probe.json"
        for path in (active, archived):
            result = subprocess.run(["git", "check-ignore", "-q", path], cwd=publisher.REPO)
            self.assertEqual(result.returncode, 0, path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
