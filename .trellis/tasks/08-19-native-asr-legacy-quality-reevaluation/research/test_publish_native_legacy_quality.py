#!/usr/bin/env python3
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).with_name("publish_native_legacy_quality.py")
SPEC = importlib.util.spec_from_file_location("publish_native_legacy_quality", SCRIPT)
publisher = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = publisher
SPEC.loader.exec_module(publisher)
LOCK = Path(__file__).with_name("native-evidence-lock.json")


class NativeLegacyQualityTests(unittest.TestCase):
    def setUp(self):
        self.lock = json.loads(LOCK.read_text(encoding="utf-8"))
        self.candidates = {row["adapterKind"]: row for row in self.lock["candidates"]}
        self.segment = {"startMs": 0, "endMs": 1000, "text": "abc"}
        self.truth = {
            "id": "short-v1",
            "audioSha256": "a" * 64,
            "assSha256": "b" * 64,
            "durationMs": 1000,
            "reference": {
                "text": "abc",
                "segments": [{**self.segment, "speech": True}],
                "speechIntervals": [{"startMs": 0, "endMs": 1000}],
            },
            "_manifestSha256": "c" * 64,
        }

    def _metrics(self, engine="faster-whisper", provenance="engine-native"):
        return publisher.BENCHMARK._sample_metrics(
            self.truth["reference"]["text"],
            self.truth["reference"]["segments"],
            self.truth["reference"]["speechIntervals"],
            [copy.deepcopy(self.segment)],
            self.truth["durationMs"],
            provenance,
            engine,
        )

    def test_lock_requires_exact_five_by_three_inventory_and_rejects_mutations(self):
        good = "a" * 64
        lock = copy.deepcopy(self.lock)
        for item in lock["authorities"].values():
            item["sha256"] = good
        for candidate in lock["candidates"]:
            for item in candidate["publications"]:
                item["sha256"] = good
            for case in candidate["cases"]:
                for item in case["sources"]:
                    item["sha256"] = good

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            roots = {candidate["ignoredRoot"]: root / candidate["adapterKind"] for candidate in lock["candidates"]}

            def fake_repo_path(value, _label):
                for source_root, target in roots.items():
                    if value == source_root:
                        return target
                    if value.startswith(source_root + "/"):
                        return target / value.removeprefix(source_root + "/")
                return root / "tracked" / hashlib.sha256(value.encode()).hexdigest()

            def fake_identity(item, label):
                if item.get("sha256") != good:
                    raise publisher.EvidenceError(f"{label} hash drift")
                return fake_repo_path(item["path"], label)

            patches = (
                mock.patch.object(publisher, "repo_path", side_effect=fake_repo_path),
                mock.patch.object(publisher, "_require_identity", side_effect=fake_identity),
                mock.patch.object(publisher, "_is_ignored", return_value=True),
            )
            with patches[0], patches[1], patches[2]:
                validated = publisher.validate_lock(lock, verify_files=True)
                self.assertEqual(set(validated), set(publisher.EXPECTED_CANDIDATES))
                self.assertEqual(sum(len(row["cases"]) for row in validated.values()), 15)

                mutations = []
                value = copy.deepcopy(lock); value["comparisonProfile"] = "other"; mutations.append(value)
                value = copy.deepcopy(lock); value["candidates"][0]["candidateId"] = "other"; mutations.append(value)
                value = copy.deepcopy(lock); value["candidates"][0]["logicalModelIdentity"] = "faster-whisper/large-v2"; mutations.append(value)
                value = copy.deepcopy(lock); value["candidates"][0]["oldDisposition"] = "qualified"; mutations.append(value)
                value = copy.deepcopy(lock); value["candidates"][2]["independentGateDisposition"] = "pass"; mutations.append(value)
                value = copy.deepcopy(lock); value["candidates"][0]["ignoredRoot"] = lock["candidates"][1]["ignoredRoot"]; mutations.append(value)
                value = copy.deepcopy(lock); value["candidates"][0]["publications"].append(copy.deepcopy(value["candidates"][0]["publications"][0])); mutations.append(value)
                value = copy.deepcopy(lock); value["candidates"][0]["cases"][0]["caseId"] = "medium-v1"; mutations.append(value)
                value = copy.deepcopy(lock); value["candidates"][2]["cases"][2]["expectedStatus"] = "completed"; mutations.append(value)
                value = copy.deepcopy(lock); value["candidates"][0]["publications"][0]["sha256"] = "b" * 64; mutations.append(value)
                value = copy.deepcopy(lock); value["candidates"][0]["cases"][0]["sources"][0]["sha256"] = "b" * 64; mutations.append(value)
                value = copy.deepcopy(lock); value["candidates"][0]["cases"][0]["sources"][0]["path"] = "tracked/substitute.json"; mutations.append(value)
                for mutated in mutations:
                    with self.subTest(mutation=mutations.index(mutated)), self.assertRaises(publisher.EvidenceError):
                        publisher.validate_lock(mutated, verify_files=True)

    def test_all_five_explicit_adapters_accept_synthetic_completed_rows(self):
        # large-v3 Candidate A
        candidate = copy.deepcopy(self.candidates["large-v3-candidate-a"])
        case = copy.deepcopy(candidate["cases"][0])
        identity = candidate["identity"]
        model, revision = identity["model"].rsplit("@", 1)
        metrics = self._metrics()
        raw = {
            "kind": identity["rawKind"], "candidate": candidate["candidateId"], "caseId": case["sourceCaseId"],
            "engine": identity["engine"], "status": "completed", "candidateLockSha256": identity["candidateLockSha256"],
            "runtime": {"device": identity["device"], "computeType": "int8"}, "model": {"id": model, "revision": revision},
            "audio": {"sha256": self.truth["audioSha256"], "durationMs": self.truth["durationMs"]},
            "samples": [
                {"status": "completed", "runKind": run_kind, "segments": [self.segment]}
                for run_kind in ("cold", "warm", "warm", "warm")
            ],
        }
        adapted_sample = {"segments": [self.segment], **{key: metrics[key] for key in ("cer", "timeline", "missingSpeechRegions", "timingAccuracy")}}
        adapted = {
            "kind": publisher.BENCHMARK.RESULT_KIND, "candidateKind": "native-candidate", "engine": identity["engine"],
            "model": identity["model"], "device": identity["device"], "runtime": {"candidateLockSha256": identity["candidateLockSha256"]},
            "cases": [{"caseId": case["sourceCaseId"], "audioSha256": self.truth["audioSha256"], "samples": [adapted_sample] * 4}],
        }
        with mock.patch.object(publisher, "_source", side_effect=lambda _c, _case, role: Path(role)), mock.patch.object(
            publisher, "read_json", side_effect=lambda path: raw if path.name == "raw" else adapted
        ):
            self.assertEqual(publisher._large_v3(candidate, case, self.truth)["status"], "completed")
            adapted["cases"][0]["samples"][0]["cer"]["cer"] = 1
            with self.assertRaises(publisher.EvidenceError):
                publisher._large_v3(candidate, case, self.truth)
            adapted["cases"][0]["samples"][0]["cer"]["cer"] = metrics["cer"]["cer"]
            raw["samples"][0]["runKind"] = "warm"
            with self.assertRaises(publisher.EvidenceError):
                publisher._large_v3(candidate, case, self.truth)

        # Kotoba K2
        candidate = copy.deepcopy(self.candidates["kotoba-k2"])
        case = copy.deepcopy(candidate["cases"][0])
        identity = candidate["identity"]
        model, revision = identity["model"].rsplit("@", 1)
        metrics = self._metrics("kotoba-faster-whisper")
        summary = {
            "cer": metrics["cer"]["cer"], "timelineErrors": 0,
            "semanticGapCount": len(metrics["missingSpeechRegions"]),
            "excludedVocalizationGapCount": len(metrics["excludedNonSemanticVocalizationRegions"]),
        }
        raw = {
            "kind": identity["rawKind"], "candidate": candidate["candidateId"], "caseId": case["sourceCaseId"],
            "engine": identity["engine"], "status": "completed", "inputLockSha256": identity["inputLockSha256"],
            "runtime": {"resolvedDevice": identity["device"], "computeType": "float16"}, "model": {"id": model, "revision": revision},
            "audio": {"sha256": self.truth["audioSha256"], "durationMs": self.truth["durationMs"]},
            "samples": [
                {"status": "completed", "runKind": run_kind, "segments": [self.segment]}
                for run_kind in ("cold", "warm", "warm", "warm")
            ],
        }
        adapted = {
            "kind": identity["adaptedKind"], "candidateId": candidate["candidateId"], "engine": identity["engine"],
            "model": identity["model"], "device": identity["device"], "manifest": {"sha256": self.truth["_manifestSha256"]},
            "case": {"caseId": case["caseId"], "audioSha256": self.truth["audioSha256"], "assSha256": self.truth["assSha256"],
                     "durationMs": self.truth["durationMs"], "samples": [{"metrics": summary}] * 4},
        }
        with mock.patch.object(publisher, "_source", side_effect=lambda _c, _case, role: Path(role)), mock.patch.object(
            publisher, "read_json", side_effect=lambda path: raw if path.name == "raw" else adapted
        ), mock.patch.object(publisher, "_publication", return_value={"candidateId": candidate["candidateId"], "disposition": candidate["oldDisposition"]}):
            self.assertEqual(publisher._kotoba(candidate, case, self.truth)["status"], "completed")
            adapted["case"]["samples"][0]["metrics"]["cer"] = 1
            with self.assertRaises(publisher.EvidenceError):
                publisher._kotoba(candidate, case, self.truth)

        # Parakeet P1
        candidate = copy.deepcopy(self.candidates["parakeet-p1"]); case = copy.deepcopy(candidate["cases"][0]); identity = candidate["identity"]
        raw = {
            "schema": identity["schema"], "candidateId": candidate["candidateId"], "caseId": case["caseId"], "engine": identity["engine"],
            "device": identity["device"], "status": "completed", "runKind": case["runKind"], "repeatIndex": 0,
            "resolvedBackend": "parakeet", "model": identity["model"],
            "worker": {"sha256": identity["workerSha256"]}, "runner": {"sha256": identity["runnerSha256"]},
            "library": {"sha256": identity["librarySha256"]}, "inputLock": {"sha256": identity["inputLockSha256"]},
            "audio": {"sha256": self.truth["audioSha256"]}, "finalSegments": [self.segment], "errorCode": None,
        }
        publication = {"results": {"parakeet": {"identity": {"candidateId": candidate["candidateId"], "model": identity["model"]}, "cases": [{"caseId": case["caseId"], "status": "completed"}]}}}
        with mock.patch.object(publisher, "_source", return_value=Path("raw")), mock.patch.object(publisher, "read_json", return_value=raw), mock.patch.object(publisher, "_publication", return_value=publication):
            self.assertEqual(publisher._parakeet(candidate, case, self.truth)["status"], "completed")
            raw["runKind"] = "warm"
            with self.assertRaises(publisher.EvidenceError):
                publisher._parakeet(candidate, case, self.truth)

        # ReazonSpeech R2
        candidate = copy.deepcopy(self.candidates["reazonspeech-r2"]); case = copy.deepcopy(candidate["cases"][0]); identity = candidate["identity"]
        raw = {
            "schema": identity["schema"], "candidateId": candidate["candidateId"], "caseId": case["caseId"], "status": "completed",
            "runKind": case["runKind"], "repeatIndex": 0,
            "request": {"backend": "crispasr", "engine": identity["engine"], "device": identity["device"]},
            "algorithm": {"candidateId": candidate["candidateId"]},
            "durationMs": self.truth["durationMs"], "identity": {"device": {"index": 0}, "model": identity["model"],
                "worker": {"sha256": identity["workerSha256"]}, "runner": {"sha256": identity["runnerSha256"]},
                "inputLock": {"sha256": identity["inputLockSha256"]}, "manifest": {"sha256": self.truth["_manifestSha256"]},
                "audio": {"sha256": self.truth["audioSha256"]}}, "error": None, "finalSegments": [self.segment],
        }
        publication = {"candidateId": candidate["candidateId"], "identity": {"model": identity["model"]}, "cases": [{"caseId": case["caseId"], "status": "completed"}]}
        with mock.patch.object(publisher, "_source", return_value=Path("raw")), mock.patch.object(publisher, "read_json", return_value=raw), mock.patch.object(publisher, "_publication", return_value=publication):
            self.assertEqual(publisher._reazon(candidate, case, self.truth)["status"], "completed")
            raw["request"]["engine"] = "parakeet"
            with self.assertRaises(publisher.EvidenceError):
                publisher._reazon(candidate, case, self.truth)

        # Qwen T03C with required companion
        candidate = copy.deepcopy(self.candidates["qwen-t03c"]); case = copy.deepcopy(candidate["cases"][0]); identity = candidate["identity"]
        raw_sha = case["sources"][0]["sha256"]
        raw = {
            "kind": identity["rawKind"], "engine": identity["engine"], "device": identity["device"], "status": "completed", "durationMs": self.truth["durationMs"],
            "identities": {"case": {"caseId": case["sourceCaseId"], "audio": {"sha256": self.truth["audioSha256"]}},
                "inputLock": {"sha256": identity["inputLockSha256"]}, "primaryModel": {"engine": "qwen3-asr", "sha256": "d" * 64},
                "alignerModel": {"role": "aligner", "sha256": "e" * 64}},
            "samples": [
                {"status": "completed", "runKind": run_kind, "timestampProvenance": "forced-aligner", "segments": [self.segment]}
                for run_kind in ("cold", "warm", "warm", "warm")
            ],
        }
        correction = {"rows": [{"rowId": case["correctionRow"]["rowId"], "status": case["correctionRow"]["status"], "rawSha256": raw_sha}],
                      "identity": {"models": [{"engine": "qwen3-asr", "role": "primary", "sha256": "d" * 64}, {"engine": "qwen3-asr", "role": "aligner", "sha256": "e" * 64}]}}
        with mock.patch.object(publisher, "_source", return_value=Path("raw")), mock.patch.object(publisher, "read_json", return_value=raw), mock.patch.object(publisher, "_publication", return_value=correction):
            self.assertEqual(publisher._qwen(candidate, case, self.truth)["status"], "completed")
            mutated = copy.deepcopy(raw); mutated["identities"]["alignerModel"]["sha256"] = "f" * 64
            with mock.patch.object(publisher, "read_json", return_value=mutated), self.assertRaises(publisher.EvidenceError):
                publisher._qwen(candidate, case, self.truth)

    def test_structured_failures_remain_unscored_and_fingerprint_bound(self):
        candidate = copy.deepcopy(self.candidates["parakeet-p1"]); case = copy.deepcopy(candidate["cases"][2]); identity = candidate["identity"]
        raw = {
            "schema": identity["schema"], "candidateId": candidate["candidateId"], "caseId": case["caseId"], "engine": identity["engine"],
            "device": identity["device"], "status": "validated-failed", "runKind": case["runKind"], "repeatIndex": 0,
            "resolvedBackend": "parakeet", "model": identity["model"],
            "worker": {"sha256": identity["workerSha256"]}, "runner": {"sha256": identity["runnerSha256"]},
            "library": {"sha256": identity["librarySha256"]}, "inputLock": {"sha256": identity["inputLockSha256"]},
            "audio": {"sha256": self.truth["audioSha256"]}, "errorCode": case["failure"]["errorCode"], "finalSegments": [], "sourceSegments": [{}],
        }
        publication = {"results": {"parakeet": {"identity": {"candidateId": candidate["candidateId"], "model": identity["model"]}, "cases": [{"caseId": case["caseId"], "status": "validated-failed"}]}}}
        with mock.patch.object(publisher, "_source", return_value=Path("raw")), mock.patch.object(publisher, "read_json", return_value=raw), mock.patch.object(publisher, "_publication", return_value=publication):
            result = publisher._parakeet(candidate, case, self.truth)
            self.assertEqual(result["status"], "validated-failed")
            self.assertNotIn("segments", result)

        candidate = copy.deepcopy(self.candidates["reazonspeech-r2"]); case = copy.deepcopy(candidate["cases"][2]); identity = candidate["identity"]
        expected = case["failure"]
        windows = [{"startMs": 0, "endMs": 1}] * expected["attemptedWindowCount"]
        windows[expected["completedWindowCount"]] = {"startMs": expected["resultFailure"]["windowStartMs"], "endMs": expected["resultFailure"]["windowEndMs"]}
        raw = {
            "schema": identity["schema"], "candidateId": candidate["candidateId"], "caseId": case["caseId"], "status": "validated-failed",
            "runKind": case["runKind"], "repeatIndex": 0,
            "request": {"backend": "crispasr", "engine": identity["engine"], "device": identity["device"]},
            "algorithm": {"candidateId": candidate["candidateId"]},
            "durationMs": self.truth["durationMs"], "identity": {"device": {"index": 0}, "model": identity["model"],
                "worker": {"sha256": identity["workerSha256"]}, "runner": {"sha256": identity["runnerSha256"]},
                "inputLock": {"sha256": identity["inputLockSha256"]}, "manifest": {"sha256": self.truth["_manifestSha256"]},
                "audio": {"sha256": self.truth["audioSha256"]}},
            "error": {"code": expected["errorCode"], "taxonomy": expected["failureClass"], "message": expected["error"]["message"]},
            "finalSegments": [], "vadWindows": windows,
            "shape": {"attemptedTranscribeCalls": expected["attemptedWindowCount"], "completedTranscribeCalls": expected["completedWindowCount"]},
            "timings": {"attemptedThroughMs": expected["attemptedThroughMs"]},
        }
        publication = {"candidateId": candidate["candidateId"], "identity": {"model": identity["model"]}, "cases": [{"caseId": case["caseId"], "status": "validated-failed"}]}
        with mock.patch.object(publisher, "_source", return_value=Path("raw")), mock.patch.object(publisher, "read_json", return_value=raw), mock.patch.object(publisher, "_publication", return_value=publication):
            self.assertEqual(publisher._reazon(candidate, case, self.truth)["status"], "validated-failed")
            mutated = copy.deepcopy(case); mutated["failure"]["resultFailure"]["fingerprintSha256"] = "0" * 64
            with self.assertRaises(publisher.EvidenceError):
                publisher._reazon(candidate, mutated, self.truth)

        candidate = copy.deepcopy(self.candidates["qwen-t03c"]); case = copy.deepcopy(candidate["cases"][1]); identity = candidate["identity"]
        raw = {
            "kind": identity["rawKind"], "engine": identity["engine"], "device": identity["device"], "status": "failed", "durationMs": self.truth["durationMs"],
            "failure": {"code": case["failure"]["errorCode"], "acceptedTimedSegmentCount": 0},
            "identities": {"case": {"caseId": case["sourceCaseId"], "audio": {"sha256": self.truth["audioSha256"]}},
                "inputLock": {"sha256": identity["inputLockSha256"]}, "primaryModel": {"engine": "qwen3-asr", "sha256": "d" * 64},
                "alignerModel": {"role": "aligner", "sha256": "e" * 64}},
            "samples": [{"status": "failed", "runKind": "cold", "timestampProvenance": "forced-aligner", "segments": []}],
        }
        correction = {"rows": [{"rowId": case["correctionRow"]["rowId"], "status": case["correctionRow"]["status"], "rawSha256": case["sources"][0]["sha256"]}],
                      "identity": {"models": [{"engine": "qwen3-asr", "role": "primary", "sha256": "d" * 64}, {"engine": "qwen3-asr", "role": "aligner", "sha256": "e" * 64}]}}
        with mock.patch.object(publisher, "_source", return_value=Path("raw")), mock.patch.object(publisher, "read_json", return_value=raw), mock.patch.object(publisher, "_publication", return_value=correction):
            result = publisher._qwen(candidate, case, self.truth)
            self.assertEqual(result["status"], "validated-failed")
            self.assertNotIn("segments", result)
            mutated = copy.deepcopy(raw); mutated["samples"][0]["status"] = "completed"
            with mock.patch.object(publisher, "read_json", return_value=mutated), self.assertRaises(publisher.EvidenceError):
                publisher._qwen(candidate, case, self.truth)

    def test_shared_t01_recomputation_ignores_mutable_precomputed_metrics(self):
        validation = {"cases": [{key: value for key, value in self.truth.items() if key != "_manifestSha256"}]}
        adapted = {"segments": [self.segment], "timestampProvenance": "engine-native", "precomputedMetrics": {"cer": 999}}
        quality, diagnostics = publisher.recompute_quality(validation, "faster-whisper/large-v3", "short-v1", adapted)
        self.assertEqual(quality["cer"], 0)
        self.assertEqual(quality["substitutions"], 0)
        self.assertEqual(diagnostics["timeline"]["segmentCount"], 1)

    def test_pairing_is_exact_and_per_metric_regressions_are_not_averaged(self):
        rows = {("model-a", "short-v1"): {"caseId": "short-v1", "status": "completed", "quality": {}}}
        self.assertIs(publisher.matching_baseline(rows, "model-a", "short-v1"), rows[("model-a", "short-v1")])
        for logical_id, case_id in (("model-b", "short-v1"), ("model-a", "medium-v1")):
            with self.assertRaises(publisher.EvidenceError):
                publisher.matching_baseline(rows, logical_id, case_id)
        baseline = {metric: 1 for metric, _ in publisher.LEGACY.QUALITY_METRICS}
        native = copy.deepcopy(baseline); native["insertions"] = 2; native["deletions"] = 0
        metrics = publisher.compare_quality(baseline, native, qwen=False)
        insertion = next(row for row in metrics if row["metric"] == "insertions")
        self.assertEqual((insertion["delta"], insertion["disposition"]), (1, "stop-revise"))
        cases = [{"slotStatus": "completed-comparison", "metrics": metrics}]
        self.assertEqual(publisher._observed_disposition(cases), "stop-revise")

    def test_qwen_timing_requires_eligible_forced_aligner_on_both_sides(self):
        quality = {metric: 0 for metric, _ in publisher.LEGACY.QUALITY_METRICS}
        baseline = {**quality, "qwenForcedAlignerTiming": {"eligible": True, "provenance": "forced-aligner", "medianStartErrorMs": 10, "p95StartErrorMs": 20}}
        native = {**quality, "qwenForcedAlignerTiming": {"eligible": True, "provenance": "forced-aligner", "medianStartErrorMs": 11, "p95StartErrorMs": 19}}
        timing = publisher.compare_quality(baseline, native, qwen=True)[-2:]
        self.assertEqual([row["disposition"] for row in timing], ["stop-revise", "qualified"])
        baseline["qwenForcedAlignerTiming"] = {"eligible": False, "provenance": "mixed", "medianStartErrorMs": None, "p95StartErrorMs": None}
        timing = publisher.compare_quality(baseline, native, qwen=True)[-2:]
        self.assertEqual({row["disposition"] for row in timing}, {"unscored"})

    def test_pending_mapping_family_and_independent_gate_boundaries_are_preserved(self):
        rows = [{"slotStatus": "completed-comparison", "metrics": [{"disposition": "qualified"}]}]
        pending = copy.deepcopy(self.candidates["parakeet-p1"])
        result = publisher.summarize_model(pending, rows, mapping_complete=False)
        self.assertEqual(result["observedMetricDisposition"], "qualified")
        self.assertEqual(result["subtitleQualityDisposition"], "baseline-incomplete")
        self.assertEqual(result["independentGateDisposition"], "stop-revise")
        self.assertEqual(result["releaseEligibility"], "not-decided-by-this-task")
        large = publisher.summarize_model(self.candidates["large-v3-candidate-a"], rows, mapping_complete=True)
        self.assertEqual(large["whisperFamilyDisposition"], "blocked-pending-large-v2-anchor")

    def test_deterministic_render_atomic_generation_and_privacy_scan(self):
        publication = {
            "comparisonProfile": publisher.PROFILE,
            "authority": {"benchmarkManifestSha256": "a" * 64, "nativeEvidenceLockSha256": "b" * 64},
            "models": [{
                "logicalModelIdentity": "model/a", "candidateId": "candidate", "oldDisposition": "old",
                "observedMetricDisposition": "qualified", "subtitleQualityDisposition": "qualified",
                "nativeEvidenceDisposition": "complete", "independentGateDisposition": "pass",
                "cases": [{"caseId": "short-v1", "slotStatus": "completed-comparison", "observedMetricDisposition": "qualified",
                           "subtitleQualityDisposition": "qualified", "metrics": [{"metric": "cer", "baseline": .1, "native": .1, "delta": 0, "direction": "lower-or-equal",
                                        "disposition": "qualified", "provenance": {"baseline": "python", "native": "native"}}]}],
            }],
            "limitations": ["No private data."],
        }
        first = publisher.render_markdown(publication)
        self.assertEqual(first, publisher.render_markdown(copy.deepcopy(publication)))
        self.assertIn("not production qualification", first)
        publisher.privacy_scan(publication)
        for bad in ({"text": "private"}, {"value": "C:/Users/private/cache"}, {"value": "research/local/raw.json"}):
            with self.assertRaises(publisher.EvidenceError):
                publisher.privacy_scan(bad)
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(publisher, "build_publication", return_value=publication):
            root = Path(directory)
            outputs = [root / "one.json", root / "one.md", root / "one-handoff.md"]
            publisher.publish(Path("lock"), *outputs)
            first_bytes = [path.read_bytes() for path in outputs]
            publisher.publish(Path("lock"), *outputs)
            self.assertEqual(first_bytes, [path.read_bytes() for path in outputs])


if __name__ == "__main__":
    unittest.main()
