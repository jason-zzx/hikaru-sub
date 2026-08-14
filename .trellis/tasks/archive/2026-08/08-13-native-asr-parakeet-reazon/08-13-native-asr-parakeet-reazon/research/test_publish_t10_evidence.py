#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("publish_t10", HERE / "publish_t10_evidence.py")
publisher = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(publisher)
INDEX = HERE / "t10-raw-index.json"
TEST_ROOT = HERE / "local" / "publisher-tests"


class PublisherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        TEST_ROOT.mkdir(parents=True, exist_ok=True)

    def setUp(self) -> None:
        self.root = TEST_ROOT / self._testMethodName
        shutil.rmtree(self.root, ignore_errors=True)
        self.root.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def index(self) -> dict:
        return json.loads(INDEX.read_text(encoding="utf-8"))

    def write_index(self, value: dict) -> Path:
        path = self.root / "index.json"
        path.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        return path

    def mutate_row(self, index: dict, mutate, *, engine: str | None = None, case_id: str | None = None) -> None:
        entry = next(
            item for item in index["entries"]
            if (engine is None or item["engine"] == engine)
            and (case_id is None or item["caseId"] == case_id)
        )
        source = publisher.LOCAL_ROOT / entry["relativeRawIdentifier"]
        value = json.loads(source.read_text(encoding="utf-8"))
        mutate(value)
        target = self.root / "row.json"
        target.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        entry["relativeRawIdentifier"] = target.relative_to(publisher.LOCAL_ROOT).as_posix()
        entry["sizeBytes"] = target.stat().st_size
        entry["sha256"] = publisher.sha256(target)

    def test_publication_is_byte_identical_and_private(self) -> None:
        evidence = self.root / "evidence.json"; report = self.root / "report.md"
        publisher.publish(INDEX, evidence, report)
        first = (evidence.read_bytes(), report.read_bytes())
        publisher.publish(INDEX, evidence, report)
        self.assertEqual(first, (evidence.read_bytes(), report.read_bytes()))
        combined = b"".join(first)
        self.assertNotIn(str(publisher.LOCAL_ROOT).encode(), combined)
        self.assertNotIn(b'"text"', first[0])

    def test_rejects_index_hash_drift(self) -> None:
        value = self.index(); value["entries"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "raw bytes drifted"):
            publisher.publish(self.write_index(value), self.root / "e.json", self.root / "r.md")

    def test_rejects_candidate_identity_mutation(self) -> None:
        value = self.index(); self.mutate_row(value, lambda row: row.__setitem__("candidateId", "forged"))
        with self.assertRaisesRegex(ValueError, "candidate/model identity drifted"):
            publisher.publish(self.write_index(value), self.root / "e.json", self.root / "r.md")

    def test_rejects_text_mutation(self) -> None:
        def mutate(row: dict) -> None:
            row["finalSegments"][0]["text"] += "x"
            row["replacementBytes"] = publisher.replacement_size(row["finalSegments"])
        value = self.index(); self.mutate_row(value, mutate)
        with self.assertRaisesRegex(ValueError, "text conservation"):
            publisher.publish(self.write_index(value), self.root / "e.json", self.root / "r.md")

    def test_rejects_result_promotion(self) -> None:
        value = self.index(); self.mutate_row(value, lambda row: row.__setitem__("status", "validated-failed"))
        with self.assertRaisesRegex(ValueError, "result promotion/status"):
            publisher.publish(self.write_index(value), self.root / "e.json", self.root / "r.md")

    def test_rejects_config_and_privacy_mutation(self) -> None:
        for field, new_value, message in (("windowDurationMs", 14999, "configuration"), ("stderr", {"privacyPass": False}, "privacy")):
            with self.subTest(field=field):
                value = self.index(); self.mutate_row(value, lambda row, f=field, v=new_value: row.__setitem__(f, v))
                with self.assertRaisesRegex(ValueError, message):
                    publisher.publish(self.write_index(value), self.root / "e.json", self.root / "r.md")

    def test_rejects_path_module_and_failed_trace_mutation(self) -> None:
        mutations = (
            (lambda row: row["pathPolicy"].__setitem__("policy", "forged"), None, None, "PATH policy"),
            (lambda row: row["moduleCheckpoints"][0]["modules"].clear(), None, None, "module inventory"),
            (lambda row: row.__setitem__("replacementBytes", row["replacementBytes"] + 1), None, None, "replacement size"),
            (lambda row: row.__setitem__("errorMessage", ""), "reazonspeech-nemo", "long-v2", "failure detail"),
        )
        for mutate, engine, case_id, message in mutations:
            with self.subTest(message=message):
                value = self.index()
                self.mutate_row(value, mutate, engine=engine, case_id=case_id)
                with self.assertRaisesRegex(ValueError, message):
                    publisher.publish(self.write_index(value), self.root / "e.json", self.root / "r.md")

    def test_partial_backend_failure_is_not_reported_as_full_case_rtf(self) -> None:
        evidence = self.root / "evidence.json"
        result = publisher.publish(INDEX, evidence, self.root / "report.md")
        reazon_long = result["results"]["reazonspeech-nemo"]["cases"][2]
        parakeet_long = result["results"]["parakeet"]["cases"][2]
        self.assertNotIn("fullCaseInferenceRtf", reazon_long)
        self.assertEqual(reazon_long["attemptedThroughMs"], 360000)
        self.assertIn("fullCaseInferenceRtf", parakeet_long)

    def test_rejects_frozen_comparator_identity_drift(self) -> None:
        original = publisher.EXPECTED["comparatorSha256"]
        publisher.EXPECTED["comparatorSha256"] = "0" * 64
        try:
            with self.assertRaisesRegex(ValueError, "comparator identity"):
                publisher.publish(INDEX, self.root / "e.json", self.root / "r.md")
        finally:
            publisher.EXPECTED["comparatorSha256"] = original


if __name__ == "__main__":
    unittest.main()
