from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

import publish_corrected_ct2_reassessment as publisher


class CorrectedReassessmentPublisherTests(unittest.TestCase):
    def test_preview_mutation_is_rejected(self) -> None:
        rows = [
            {
                "candidateId": candidate_id,
                "caseId": case_id,
                "measurements": {
                    "cer": expected[0],
                    "semanticSpeechGapsAtLeast1500Ms": expected[1],
                    "excludedNonSemanticVocalizationGapsAtLeast1500Ms": expected[2],
                },
            }
            for (candidate_id, case_id), expected in publisher.EXPECTED_PREVIEW.items()
        ]
        publisher.require_preview(rows)
        mutated = copy.deepcopy(rows)
        mutated[-1]["measurements"]["semanticSpeechGapsAtLeast1500Ms"] = 6
        with self.assertRaises(publisher.EvidenceError):
            publisher.require_preview(mutated)

    def test_hash_and_raw_path_drift_fail_closed(self) -> None:
        repo = Path(__file__).resolve().parents[4]
        benchmark = publisher._load_module(
            "t08_corrected_test_benchmark",
            repo / "scripts" / "asr-benchmark.py",
        )
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "value.json"
            path.write_text("{}", encoding="utf-8")
            with self.assertRaises(publisher.EvidenceError):
                publisher.require_hash(benchmark, path, "0" * 64, "fixture")
            with self.assertRaises(publisher.EvidenceError):
                publisher.require_ignored_local(benchmark, path, "fixture")

    def test_publication_privacy_and_report_are_deterministic(self) -> None:
        evidence = {
            "rows": [
                {
                    "candidateId": "candidate",
                    "caseId": "long-v2",
                    "measurements": {
                        "cer": 0.1,
                        "inferenceRtf": 0.2,
                        "semanticSpeechGapsAtLeast1500Ms": 0,
                        "excludedNonSemanticVocalizationGapsAtLeast1500Ms": 1,
                        "timelineErrors": 0,
                    },
                    "allApplicableGatesPass": True,
                }
            ],
            "candidateDispositions": [
                {"candidateId": "candidate", "disposition": "pass", "reason": "fixture"}
            ],
        }
        first = publisher.render_report(evidence)
        self.assertEqual(first, publisher.render_report(copy.deepcopy(evidence)))
        publisher.assert_public(evidence)
        with self.assertRaises(publisher.EvidenceError):
            publisher.assert_public({"canonicalPath": "C:" + r"\Users\private\raw.json"})


if __name__ == "__main__":
    unittest.main()
