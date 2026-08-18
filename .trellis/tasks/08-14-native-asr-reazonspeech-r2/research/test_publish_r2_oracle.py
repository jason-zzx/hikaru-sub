#!/usr/bin/env python3
"""Focused mutation checks for the ReazonSpeech R2 source-only oracle."""

from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import publish_r2_oracle as publisher
import run_r2_oracle as runner


RESEARCH_ROOT = Path(__file__).resolve().parent
CONFIG = RESEARCH_ROOT / "local" / "oracle-input.json"
RAW_ROOT = RESEARCH_ROOT / "local" / "oracle"


def completed_fixture() -> dict[str, object]:
    first = {"text": "あ", "startMs": 0, "endMs": 1000}
    second = {"text": "い", "startMs": 940, "endMs": 1940}
    return {
        "status": "completed",
        "algorithm": publisher.expected_algorithm(),
        "durationMs": 2000,
        "vadWindowCount": 2,
        "maximumWindowDurationMs": 1000,
        "maximumAdjacentOverlapMs": 60,
        "windows": [
            {"index": 0, "startSample": 0, "endSample": 16000,
             "startMs": 0, "endMs": 1000, "durationMs": 1000, "overlapWithPreviousMs": 0},
            {"index": 1, "startSample": 15040, "endSample": 31040,
             "startMs": 940, "endMs": 1940, "durationMs": 1000, "overlapWithPreviousMs": 60},
        ],
        "transcribeCallCount": 2,
        "calls": [
            {"index": 0, "windowStartMs": 0, "windowEndMs": 1000,
             "sourceSegmentCount": 1, "result": first},
            {"index": 1, "windowStartMs": 940, "windowEndMs": 1940,
             "sourceSegmentCount": 1, "result": second},
        ],
        "finalSegments": [dict(first), dict(second)],
        "timings": {"vadMs": 1.0, "inferenceMs": 1.0},
    }


class OraclePublisherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.protocol_limits = publisher.load_protocol_limits()

    def test_config_binds_candidate_window_and_single_pass_identity(self) -> None:
        config = runner.load_config(CONFIG)
        self.assertEqual(config["candidateId"], runner.CANDIDATE_ID)
        self.assertEqual(config["windowPolicy"], runner.WINDOW_POLICY)
        self.assertEqual(config["strategyPolicy"], runner.PARAKEET_STRATEGY_POLICY)

    def test_completed_path_accepts_only_bounded_native_padding_overlap(self) -> None:
        valid = completed_fixture()
        publisher.validate_raw_trace(valid, 32000, self.protocol_limits, "synthetic-v1")

        mutations = []
        changed_algorithm = deepcopy(valid)
        changed_algorithm["algorithm"]["ownershipRewrite"] = True
        mutations.append(changed_algorithm)
        changed_overlap_policy = deepcopy(valid)
        changed_overlap_policy["algorithm"]["windowPolicy"]["maximumAdjacentPaddingOverlapMs"] = 61
        mutations.append(changed_overlap_policy)
        changed_padded_cap = deepcopy(valid)
        changed_padded_cap["algorithm"]["windowPolicy"]["paddedMaxInferenceWindowMs"] = 12000
        mutations.append(changed_padded_cap)
        changed_strategy = deepcopy(valid)
        changed_strategy["algorithm"]["strategyPolicy"]["setEnvironment"]["CRISPASR_PARAKEET_STREAM_THRESHOLD"] = "12"
        mutations.append(changed_strategy)
        forged_overlap = deepcopy(valid)
        forged_overlap["windows"][1]["overlapWithPreviousMs"] = 59
        mutations.append(forged_overlap)
        overlap_too_large = deepcopy(valid)
        overlap_too_large["windows"][0]["endSample"] = 16016
        overlap_too_large["windows"][0]["endMs"] = 1001
        overlap_too_large["windows"][0]["durationMs"] = 1001
        overlap_too_large["maximumWindowDurationMs"] = 1001
        mutations.append(overlap_too_large)
        end_regression = deepcopy(valid)
        end_regression["windows"][1]["endSample"] = 15000
        mutations.append(end_regression)
        for mutated in mutations:
            with self.subTest(algorithm=mutated.get("algorithm")):
                with self.assertRaises(RuntimeError):
                    publisher.validate_raw_trace(mutated, 32000, self.protocol_limits, "synthetic-v1")

        padded_too_long = deepcopy(valid)
        audio_sample_count = runner.PADDED_MAX_WINDOW_SAMPLES + 1
        padded_too_long["durationMs"] = publisher.sample_to_ms(audio_sample_count)
        padded_too_long["windows"] = [padded_too_long["windows"][0]]
        padded_too_long["windows"][0]["endSample"] = audio_sample_count
        padded_too_long["windows"][0]["endMs"] = runner.PADDED_MAX_WINDOW_MS
        padded_too_long["windows"][0]["durationMs"] = runner.PADDED_MAX_WINDOW_MS
        padded_too_long["vadWindowCount"] = 1
        padded_too_long["maximumWindowDurationMs"] = runner.PADDED_MAX_WINDOW_MS
        padded_too_long["maximumAdjacentOverlapMs"] = 0
        padded_too_long["calls"] = [padded_too_long["calls"][0]]
        padded_too_long["calls"][0]["windowEndMs"] = runner.PADDED_MAX_WINDOW_MS
        padded_too_long["transcribeCallCount"] = 1
        padded_too_long["finalSegments"] = [padded_too_long["finalSegments"][0]]
        with self.assertRaisesRegex(RuntimeError, "padded inference cap"):
            publisher.validate_raw_trace(
                padded_too_long, audio_sample_count, self.protocol_limits, "synthetic-v1")

    def test_completed_path_rejects_cue_text_timeline_and_protocol_mutations(self) -> None:
        valid = completed_fixture()
        mutations = []
        too_long = deepcopy(valid)
        too_long["calls"][0]["result"]["text"] = "あ" * 97
        too_long["finalSegments"][0]["text"] = "あ" * 97
        mutations.append(too_long)
        decreasing_start = deepcopy(valid)
        decreasing_start["calls"][1]["result"]["startMs"] = -10
        decreasing_start["finalSegments"][1]["startMs"] = -10
        mutations.append(decreasing_start)
        missing_call = deepcopy(valid)
        missing_call["calls"] = missing_call["calls"][:1]
        missing_call["transcribeCallCount"] = 1
        mutations.append(missing_call)
        boolean_count = deepcopy(valid)
        boolean_count["calls"][0]["sourceSegmentCount"] = True
        mutations.append(boolean_count)
        changed_final = deepcopy(valid)
        changed_final["finalSegments"][0]["text"] = "う"
        mutations.append(changed_final)
        control_text = deepcopy(valid)
        control_text["calls"][0]["result"]["text"] = "あ\n"
        control_text["finalSegments"][0]["text"] = "あ\n"
        mutations.append(control_text)

        for mutated in mutations:
            with self.assertRaises((RuntimeError, UnicodeError)):
                publisher.validate_raw_trace(mutated, 32000, self.protocol_limits, "synthetic-v1")

        with self.assertRaises(RuntimeError):
            publisher.validate_raw_trace(valid, 32000, dict(self.protocol_limits, maxEventLineBytes=1), "synthetic-v1")

    def test_both_cases_and_a_real_improvement_are_required_for_promising(self) -> None:
        shape = {"maximumWindowDurationMs": 12060, "maximumAdjacentOverlapMs": 60,
                 "maximumCueCodePoints": 96, "maximumCueDurationMs": 15000,
                 "vadWindows": 1, "transcribeCalls": 1, "cueCount": 1, "overlappedBoundaries": 1}
        base = {"status": "completed", "primaryLimitsPass": True, "timelineErrors": 0,
                "cer": 0.2, "semanticGaps": 1, "excludedGaps": 0,
                "deltaVsR1": {"cer": 0.0, "semanticGaps": 0}, "shape": shape}
        _, classification = publisher.render([dict(base, caseId="short-v1"),
                                               dict(base, caseId="medium-v1")])
        self.assertEqual(classification, "not-promising")
        improved = deepcopy(base)
        improved["deltaVsR1"]["cer"] = -0.01
        _, classification = publisher.render([dict(improved, caseId="short-v1"),
                                               dict(base, caseId="medium-v1")])
        self.assertEqual(classification, "promising")
        unsafe = deepcopy(improved)
        unsafe["shape"]["maximumAdjacentOverlapMs"] = 61
        _, classification = publisher.render([dict(unsafe, caseId="short-v1"),
                                               dict(base, caseId="medium-v1")])
        self.assertEqual(classification, "not-promising")

    def test_runner_clears_inherited_strategy_knobs_and_allows_only_padded_cap(self) -> None:
        with patch.dict(os.environ, {"CRISPASR_PARAKEET_STREAM_CHUNK": "2",
                                    "CRISPASR_PARAKEET_MEM_POLICY": "streamed",
                                    "CRISPASR_SESSION_UNIFIED_DISPATCH": "1"}, clear=True):
            self.assertEqual(runner.configure_parakeet_strategy_environment(), runner.PARAKEET_STRATEGY_POLICY)
            actual = {name: value for name, value in os.environ.items() if name.startswith("CRISPASR_PARAKEET_")}
            self.assertEqual(actual, {"CRISPASR_PARAKEET_STREAM_THRESHOLD": "13"})
            self.assertEqual(os.environ["CRISPASR_SESSION_UNIFIED_DISPATCH"], "0")
            runner.require_parakeet_single_pass_environment(runner.PADDED_MAX_WINDOW_SAMPLES)
            os.environ["CRISPASR_SESSION_UNIFIED_DISPATCH"] = "1"
            with self.assertRaisesRegex(RuntimeError, "strategy environment drifted"):
                runner.require_parakeet_single_pass_environment(runner.PADDED_MAX_WINDOW_SAMPLES)
            os.environ["CRISPASR_SESSION_UNIFIED_DISPATCH"] = "0"
            with self.assertRaises(RuntimeError):
                runner.require_parakeet_single_pass_environment(runner.PADDED_MAX_WINDOW_SAMPLES + 1)

    def test_frozen_raw_hashes_and_identity_are_rechecked(self) -> None:
        config = runner.load_config(CONFIG)
        for case_id in publisher.CASE_ORDER:
            path = RAW_ROOT / f"{case_id}.json"
            if not path.is_file() or publisher.EXPECTED_RAW_SHA256[case_id].startswith("TO_BE_"):
                self.skipTest("oracle raws are not frozen yet")
            raw, raw_hash = publisher.load_raw(RAW_ROOT, case_id, config)
            self.assertEqual(raw_hash, publisher.EXPECTED_RAW_SHA256[case_id])
            self.assertEqual(raw["candidateId"], runner.CANDIDATE_ID)
            with tempfile.TemporaryDirectory(dir=runner.ORACLE_ROOT) as temporary:
                mutated = Path(temporary) / f"{case_id}.json"
                mutated.write_bytes(path.read_bytes() + b" ")
                with self.assertRaisesRegex(RuntimeError, "raw SHA-256"):
                    publisher.load_raw(Path(temporary), case_id, config)


if __name__ == "__main__":
    unittest.main()
