import copy
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "asr-legacy-baseline.py"
SPEC = importlib.util.spec_from_file_location("asr_legacy_baseline", SCRIPT)
legacy = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = legacy
SPEC.loader.exec_module(legacy)


class LegacyBaselineComparisonTests(unittest.TestCase):
    def setUp(self):
        self.model = {
            "logicalModelIdentity": "faster-whisper/large-v3",
            "family": "whisper",
            "qualityGate": "whisper-anchor",
            "comparisonProfile": legacy.PROFILE,
            "python": {"engine": "faster-whisper", "model": "large-v3"},
            "native": {
                "engine": "ctranslate2",
                "artifact": {"repository": "Systran/faster-whisper-large-v3", "revision": "rev", "format": "ctranslate2"},
                "companion": None,
            },
        }
        self.manifest = {"models": [self.model]}
        self.quality = {
            "cer": 0.1,
            "substitutions": 1,
            "deletions": 2,
            "insertions": 3,
            "emptyTextCount": 0,
            "semanticGapCount": 0,
            "semanticGapDurationMs": 0,
        }
        self.baseline = {
            "models": [{"logicalModelIdentity": self.model["logicalModelIdentity"], "cases": [
                {"caseId": case, "quality": copy.deepcopy(self.quality)} for case in legacy.REQUIRED_CASES
            ]}]
        }
        self.result = {
            "schemaVersion": legacy.BENCHMARK.SCHEMA_VERSION,
            "kind": legacy.BENCHMARK.RESULT_KIND,
            "candidateKind": "native-candidate",
            "engine": "faster-whisper",
            "model": "native-large-v3",
            "device": "cuda",
            "language": "ja",
            "manifest": {"corpusId": "corpus", "sha256": "a" * 64},
            "cases": [
                {
                    "caseId": case,
                    "status": "completed",
                    "audioSha256": case + "-wav",
                    "assSha256": case + "-ass",
                    "durationMs": 1000,
                    "samples": [],
                }
                for case in legacy.REQUIRED_CASES
            ],
        }
        self.identity = {
            "logicalModelIdentity": self.model["logicalModelIdentity"],
            "comparisonProfile": legacy.PROFILE,
            "artifact": copy.deepcopy(self.model["native"]["artifact"]),
            "companion": None,
            "result": {field: self.result[field] for field in ("engine", "model", "device", "language")},
        }
        self.validation = {"manifestSha256": "a" * 64, "manifest": {"corpusId": "corpus"}}

    def _runner_identity(self, sha="a" * 64):
        return {
            "schemaVersion": legacy.BENCHMARK.RUNNER_IDENTITY_SCHEMA_VERSION,
            "kind": legacy.BENCHMARK.RUNNER_IDENTITY_KIND,
            "sourcePath": legacy.BENCHMARK.RUNNER_SOURCE_PATH,
            "sha256": sha,
        }

    def test_missing_acquisition_runner_identity_is_rejected(self):
        with self.assertRaisesRegex(legacy.ContractError, "missing acquisition-time"):
            legacy._validate_acquisition_tool({}, {"benchmarkRunnerSha256": "a" * 64})

    def test_mutated_acquisition_runner_identity_is_rejected(self):
        profile = {"benchmarkRunnerSha256": "a" * 64}
        for field, value in (("schemaVersion", 2), ("kind", "other"), ("sourcePath", "other.py")):
            identity = self._runner_identity()
            identity[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(legacy.ContractError, "identity drift"):
                legacy._validate_acquisition_tool({"acquisitionTool": identity}, profile)

    def test_acquisition_runner_sha_mismatch_is_rejected(self):
        with self.assertRaisesRegex(legacy.ContractError, "identity drift"):
            legacy._validate_acquisition_tool(
                {"acquisitionTool": self._runner_identity("b" * 64)},
                {"benchmarkRunnerSha256": "a" * 64},
            )

    def _reference(self, _validation, case_id):
        return {"audioSha256": case_id + "-wav", "assSha256": case_id + "-ass", "durationMs": 1000}, {}

    def _metrics(self, _result, case, _reference):
        quality = copy.deepcopy(self.quality)
        if case.get("regress"):
            quality["insertions"] += 1
        return {
            "cer": {
                "cer": quality["cer"],
                "substitutions": quality["substitutions"],
                "deletions": quality["deletions"],
                "insertions": quality["insertions"],
            },
            "timeline": {"emptyTextCount": quality["emptyTextCount"]},
            "missingSpeechRegions": ([{"durationMs": quality["semanticGapDurationMs"]}] * quality["semanticGapCount"]),
            "excludedNonSemanticVocalizationRegions": [],
            "timestampProvenance": case.get("provenance", "engine-native"),
            "timingAccuracy": case.get("timing", {"eligible": True, "medianStartErrorMs": 1, "p95StartErrorMs": 2}),
        }

    def _compare(self, model_id=None, result=None, identity=None):
        with mock.patch.object(legacy, "_case_reference", side_effect=self._reference), mock.patch.object(
            legacy, "_recomputed_metrics", side_effect=self._metrics
        ):
            return legacy.compare_native_result(
                self.baseline,
                self.manifest,
                self.validation,
                model_id or self.model["logicalModelIdentity"],
                result or self.result,
                identity or self.identity,
            )

    def test_same_identity_same_case_per_metric_comparison_qualifies(self):
        compared = self._compare()
        self.assertEqual(compared["subtitleQualityDisposition"], "qualified")
        self.assertEqual(len(compared["cases"]), 3)
        self.assertEqual({metric["disposition"] for row in compared["cases"] for metric in row["metrics"]}, {"qualified"})
        self.assertEqual(compared["releaseEligibility"], "not-decided-by-this-comparison")
        self.assertIn("short cold process wall <= 120s", compared["independentAbsoluteGates"])

    def test_one_case_metric_regression_cannot_be_averaged_away(self):
        result = copy.deepcopy(self.result)
        result["cases"][1]["regress"] = True
        compared = self._compare(result=result)
        self.assertEqual(compared["subtitleQualityDisposition"], "stop-revise")
        medium = next(row for row in compared["cases"] if row["caseId"] == "medium-v1")
        insertion = next(metric for metric in medium["metrics"] if metric["metric"] == "insertions")
        self.assertEqual(insertion["delta"], 1)
        self.assertEqual(insertion["disposition"], "stop-revise")

    def test_identity_case_profile_and_artifact_mutations_are_rejected(self):
        mutations = []
        identity = copy.deepcopy(self.identity)
        identity["logicalModelIdentity"] = "faster-whisper/large-v2"
        mutations.append((self.model["logicalModelIdentity"], self.result, identity))
        identity = copy.deepcopy(self.identity)
        identity["comparisonProfile"] = "python-legacy-cpu-v1"
        mutations.append((self.model["logicalModelIdentity"], self.result, identity))
        identity = copy.deepcopy(self.identity)
        identity["artifact"]["revision"] = "other"
        mutations.append((self.model["logicalModelIdentity"], self.result, identity))
        result = copy.deepcopy(self.result)
        result["cases"] = result["cases"][:-1]
        mutations.append((self.model["logicalModelIdentity"], result, self.identity))
        result = copy.deepcopy(self.result)
        result["cases"].append(copy.deepcopy(result["cases"][0]))
        mutations.append((self.model["logicalModelIdentity"], result, self.identity))
        result = copy.deepcopy(self.result)
        result["model"] = "other-native-model"
        mutations.append((self.model["logicalModelIdentity"], result, self.identity))
        for model_id, result, identity in mutations:
            with self.subTest(identity=identity, cases=len(result["cases"])):
                with self.assertRaises(legacy.ContractError):
                    self._compare(model_id=model_id, result=result, identity=identity)

    def test_qwen_companion_mutation_rejected_and_ineligible_timing_blocks(self):
        qwen = copy.deepcopy(self.model)
        qwen.update({
            "logicalModelIdentity": "qwen3-asr/qwen3-asr-1.7b",
            "family": "qwen3",
            "python": {"engine": "qwen3-asr", "model": "Qwen/Qwen3-ASR-1.7B"},
            "native": {
                "engine": "crispasr",
                "artifact": {"repository": "cstr/qwen", "fileName": "qwen.gguf", "revision": "rev", "format": "gguf"},
                "companion": {"identity": "aligner", "fileName": "aligner.gguf", "revision": "align-rev", "format": "gguf"},
            },
        })
        self.manifest = {"models": [qwen]}
        self.baseline = {"models": [{"logicalModelIdentity": qwen["logicalModelIdentity"], "cases": [
            {"caseId": case, "quality": {**copy.deepcopy(self.quality), "qwenForcedAlignerTiming": {
                "eligible": case != "long-v2", "provenance": "forced-aligner" if case != "long-v2" else "mixed",
                "medianStartErrorMs": 1 if case != "long-v2" else None,
                "p95StartErrorMs": 2 if case != "long-v2" else None,
            }}} for case in legacy.REQUIRED_CASES
        ]}]}
        self.result["engine"] = "qwen3-asr"
        self.result["model"] = "native-qwen3"
        for case in self.result["cases"]:
            case["provenance"] = "forced-aligner"
        identity = {
            "logicalModelIdentity": qwen["logicalModelIdentity"], "comparisonProfile": legacy.PROFILE,
            "artifact": copy.deepcopy(qwen["native"]["artifact"]), "companion": copy.deepcopy(qwen["native"]["companion"]),
            "result": {field: self.result[field] for field in ("engine", "model", "device", "language")},
        }
        compared = self._compare(model_id=qwen["logicalModelIdentity"], identity=identity)
        self.assertEqual(compared["subtitleQualityDisposition"], "baseline-incomplete")
        bad = copy.deepcopy(identity)
        bad["companion"]["revision"] = "other"
        with self.assertRaises(legacy.ContractError):
            self._compare(model_id=qwen["logicalModelIdentity"], identity=bad)

    def test_markdown_is_deterministic_and_contains_no_runtime_paths(self):
        baseline = {
            "comparisonProfile": legacy.PROFILE,
            "authority": {"corpusId": "corpus", "benchmarkManifestSha256": "a" * 64, "supersedes": ["tracked/history.md"]},
            "models": [
                {
                    "logicalModelIdentity": "faster-whisper/base",
                    "baselineDisposition": "family-gated-no-baseline",
                    "cases": [],
                },
                {
                    "logicalModelIdentity": self.model["logicalModelIdentity"],
                    "baselineDisposition": "complete",
                    "cases": [{
                        "caseId": "short-v1", "status": "completed", "rawResultSha256": "b" * 64,
                        "quality": copy.deepcopy(self.quality),
                        "structuralDiagnostics": {"timeline": {"emptyTextCount": 0, "nonPositiveDurationCount": 0, "negativeStartCount": 0, "afterAudioEndCount": 0, "nonMonotonicCount": 0}, "timestampProvenance": "engine-native"},
                        "performanceDiagnostics": {"coldInferenceRtf": 0.1, "warmInferenceRtfMedian": 0.09, "coldProcessWallMs": 1000, "peakProcessRssBytes": 10},
                    }],
                },
            ],
            "qualityComparisonContract": {"metrics": [{"id": "cer", "direction": "lower-or-equal"}], "independentAbsoluteGates": ["path containment"]},
            "limitations": ["tracked output stores no private path"],
        }
        first = legacy.render_baseline_markdown(baseline)
        second = legacy.render_baseline_markdown(copy.deepcopy(baseline))
        self.assertEqual(first, second)
        self.assertIn("family-gated-no-baseline", first)
        self.assertIn("lower-or-equal", first)
        self.assertNotIn("runtime\\cache", first)


if __name__ == "__main__":
    unittest.main()
