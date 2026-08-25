import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

SCRIPT = Path(__file__).with_name("run_whisper_execution_parity_discovery.py")
SPEC = importlib.util.spec_from_file_location("t06d", SCRIPT)
t06d = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(t06d)


def aggregate(value: str) -> dict:
    return {
        "segmentCount": 1,
        "textSha256": value * 64,
        "timelineSha256": ("f" if value != "f" else "e") * 64,
        "timelineErrorCount": 0,
    }


def row(token: str, *, parser_same: bool = True) -> dict:
    python = aggregate(token[0])
    native = python if parser_same else aggregate("9")
    return {
        "cellId": "cell",
        "repeatIndex": 1,
        "selectedTokenSha256": token * 64,
        "selectedTemperature": 0.0,
        "fallbackCallCount": 0,
        "pythonParser": python,
        "nativeParser": native,
        "rawSha256": "a" * 64,
    }


def contract_payload(n_mels: int = 128, role: str = "python-wheel") -> dict:
    return {
        "kind": "hikaru-whisper-execution-parity-model-contract",
        "status": "completed",
        "qualificationEligible": False,
        "promotionEligible": False,
        "runtimeRole": role,
        "nMels": n_mels,
        "shape": [n_mels, 3000],
        "modelConstructionReached": True,
        "generationBoundaryReached": False,
        "model": {"files": [{"name": "model.bin", "sha256": t06d.MODEL_SHA256}]},
        "runtime": {
            "ctranslate2": {"sha256": t06d.RUNTIME_SHA256[role]},
            "requestedDevice": "cuda",
            "resolvedDevice": "cuda",
            "computeType": "float16",
            "deviceIndex": 0,
            "pathPolicy": {"restricted": True},
            "runtimeFiles": [],
            "loadedModules": [],
        },
    }


class DiscoveryTests(unittest.TestCase):
    def test_large_v3_contract_rejects_80_mels(self):
        with tempfile.TemporaryDirectory(dir=t06d.TASK_ROOT) as directory:
            root = Path(directory).resolve()
            contract = root / "contract.json"
            contract.write_text(json.dumps(contract_payload(80)), encoding="utf-8")
            with self.assertRaisesRegex(t06d.DiscoveryError, "128 x 3000"):
                t06d.load_contract(root, contract, "python-wheel")

    def test_cross_root_and_reparse_are_rejected(self):
        with tempfile.TemporaryDirectory(dir=t06d.TASK_ROOT) as directory, tempfile.TemporaryDirectory() as other:
            root = Path(directory).resolve()
            outside = Path(other) / "value.json"
            outside.write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(t06d.DiscoveryError, "escaped"):
                t06d.local_path(root, outside)
            link = root / "link.json"
            try:
                link.symlink_to(outside)
            except OSError:
                return
            with self.assertRaisesRegex(t06d.DiscoveryError, "reparse"):
                t06d.local_path(root, link)

    def test_anchor_disposition_refuses_crossovers_and_rerun(self):
        with tempfile.TemporaryDirectory(dir=t06d.TASK_ROOT) as directory:
            root = Path(directory).resolve()
            t06d.atomic_json(root / "state.json", {
                "anchorsAccepted": False,
                "harnessFailureCount": 0,
                "disposition": "baseline-runtime-unresolved",
            })
            args = SimpleNamespace(
                model="x", python_runtime="y", native_runtime="z", reviewed_correction=False)
            with self.assertRaisesRegex(t06d.DiscoveryError, "published anchor disposition"):
                t06d.crossovers(args, root)
            with self.assertRaisesRegex(t06d.DiscoveryError, "published anchor disposition"):
                t06d.require_model_phase_allowed(root, False)

    def test_parser_timeline_hash_matches_native_field_order(self):
        value = t06d.parser_aggregate([{"startMs": 0, "endMs": 20, "text": "x"}])
        expected = hashlib.sha256(b'[{"startMs":0,"endMs":20}]').hexdigest()
        self.assertEqual(value["timelineSha256"], expected)

    def test_decision_vectors(self):
        same = aggregate("1")

        def lane(token: str, python=same, native=same):
            value = row(token)
            value["pythonParser"] = python
            value["nativeParser"] = native
            return [value]

        self.assertEqual(t06d.select_disposition({k: lane("a") for k in "ABCD"}), "no-divergence")
        self.assertEqual(t06d.select_disposition({
            "A": lane("a"), "B": lane("a"), "C": lane("b"), "D": lane("b")}),
            "runtime-divergence")
        self.assertEqual(t06d.select_disposition({
            "A": lane("a"), "B": lane("b"), "C": lane("a"), "D": lane("b")}),
            "feature-divergence")
        self.assertEqual(t06d.select_disposition({
            "A": lane("a"), "B": lane("b"), "C": lane("c"), "D": lane("d")}),
            "feature-runtime-interaction")
        divergent = row("a", parser_same=False)
        self.assertEqual(t06d.select_disposition({k: [divergent] for k in "ABCD"}), "parser-divergence")

    def test_one_correction_budget_is_preserved_and_closed(self):
        with tempfile.TemporaryDirectory(dir=t06d.TASK_ROOT) as directory:
            root = Path(directory).resolve()
            t06d.record_harness_failure(root, "first", "outer-executor-timeout")
            first = t06d.load_json(root / "state.json")
            self.assertEqual(first["status"], "correction-review-required")
            self.assertIsNone(first["disposition"])
            with self.assertRaisesRegex(t06d.DiscoveryError, "reviewed-correction"):
                t06d.require_model_phase_allowed(root, False)
            _, count = t06d.require_model_phase_allowed(root, True)
            self.assertEqual(count, 1)
            t06d.record_harness_failure(root, "second", "overlapping-correction-process")
            second = t06d.load_json(root / "state.json")
            self.assertEqual(second["harnessFailureCount"], 2)
            self.assertEqual(second["disposition"], "invalid-evidence")
            record = t06d.load_json(root / "harness-failures.json")
            self.assertEqual([item["category"] for item in record["failures"]], [
                "outer-executor-timeout", "overlapping-correction-process"])
            with self.assertRaisesRegex(t06d.DiscoveryError, "closed"):
                t06d.require_model_phase_allowed(root, True)

    def test_invalid_publication_binds_failure_and_invalidated_raw_sets(self):
        with tempfile.TemporaryDirectory(dir=t06d.TASK_ROOT) as directory:
            root = Path(directory).resolve()
            (root / "raw").mkdir()
            (root / "raw" / "A-repeat-1.json").write_text("{}\n", encoding="utf-8")
            t06d.record_harness_failure(root, "first", "outer-executor-timeout")
            t06d.record_harness_failure(root, "second", "overlapping-correction-process")
            state = t06d.load_json(root / "state.json")
            raw_summary = t06d.artifact_set_summary(list((root / "raw").glob("*.json")))
            state.update({
                "modelContract": {"nMels": 128, "shape": [128, 3000], "dtype": "float32-le",
                                  "setSha256": "c" * 64},
                "invalidatedRawArtifactCount": raw_summary["count"],
                "invalidatedRawArtifactSetSha256": raw_summary["sha256"],
                "processRemaining": False,
                "crossoversStarted": False,
                "scoringEligible": False,
            })
            t06d.atomic_json(root / "state.json", state)
            t06d.validate_publication_state(root, state)
            publication = t06d.sanitized_publication(state)
            self.assertEqual(publication["disposition"], "invalid-evidence")
            self.assertEqual(publication["rows"], [])
            self.assertEqual(publication["evidence"]["harnessFailureCount"], 2)
            payload = json.dumps(publication)
            for forbidden in ("tokenIds", "segments", "canonicalPath", "decodedText"):
                self.assertNotIn(forbidden, payload)
            state["harnessFailureRecordSha256"] = "0" * 64
            with self.assertRaisesRegex(t06d.DiscoveryError, "closure identity"):
                t06d.validate_publication_state(root, state)

    def test_publication_is_deterministic(self):
        state = {
            "disposition": "baseline-runtime-unresolved",
            "harnessFailureCount": 0,
            "modelContract": {"nMels": 128, "shape": [128, 3000], "dtype": "float32-le"},
            "lanes": {"A": [row("a")]},
        }
        first = t06d.sanitized_publication(state)
        second = t06d.sanitized_publication(state)
        self.assertEqual(t06d.canonical_bytes(first), t06d.canonical_bytes(second))
        self.assertFalse(first["qualificationEligible"])
        self.assertFalse(first["promotionEligible"])

    def test_successful_publication_closes_model_backed_state(self):
        with tempfile.TemporaryDirectory(dir=t06d.TASK_ROOT) as directory:
            root = Path(directory).resolve()
            state = {
                "schemaVersion": 1,
                "kind": "hikaru-whisper-execution-parity-state",
                "qualificationEligible": False,
                "promotionEligible": False,
                "status": "completed",
                "harnessFailureCount": 0,
                "anchorsAccepted": True,
                "crossoversCompleted": True,
                "disposition": None,
                "modelContract": {"nMels": 128, "shape": [128, 3000], "dtype": "float32-le"},
                "lanes": {lane: [row("a")] for lane in "ABCD"},
            }
            t06d.atomic_json(root / "state.json", state)
            task_root = t06d.TASK_ROOT
            try:
                t06d.TASK_ROOT = root
                t06d.publish(root)
            finally:
                t06d.TASK_ROOT = task_root
            closed = t06d.load_json(root / "state.json")
            self.assertEqual(closed["status"], "closed")
            self.assertEqual(closed["disposition"], "no-divergence")
            with self.assertRaisesRegex(t06d.DiscoveryError, "published anchor disposition"):
                t06d.require_model_phase_allowed(root, False)

    def test_python_feature_producer_consumes_exact_contract(self):
        with tempfile.TemporaryDirectory(dir=t06d.TASK_ROOT) as directory:
            root = Path(directory).resolve()
            contract = root / "contract.json"
            contract.write_text(json.dumps(contract_payload()), encoding="utf-8")
            loaded, _ = t06d.load_contract(root, contract, "python-wheel")
            self.assertEqual(loaded["nMels"], 128)


if __name__ == "__main__":
    unittest.main()
