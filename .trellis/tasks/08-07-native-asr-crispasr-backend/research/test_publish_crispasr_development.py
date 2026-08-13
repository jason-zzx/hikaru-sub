#!/usr/bin/env python3

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE_PATH = Path(__file__).with_name("publish_crispasr_development.py")
SPEC = importlib.util.spec_from_file_location("publisher", MODULE_PATH)
publisher = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(publisher)


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_root = publisher.LOCAL_ROOT
        publisher.LOCAL_ROOT = self.root

    def tearDown(self):
        publisher.LOCAL_ROOT = self.old_root
        publisher.FROZEN_INDEX_OVERRIDE = None
        self.temp.cleanup()

    def write(self, relative, value):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
        return {
            "relativeRawIdentifier": relative,
            "sizeBytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }

    def identity(self, byte=1):
        return {"sizeBytes": byte, "sha256": f"{byte:064x}"[-64:]}

    def runner_row(self, phase, family, device, sample, status="completed"):
        qwen = family == "qwen3-family"
        stderr_path = self.root / "raw" / f"stderr-{family}-{device}-{phase}-{sample}.log"
        stderr_path.parent.mkdir(parents=True, exist_ok=True)
        stderr_path.write_bytes(b"")
        row = {
            "schema": "hikaru-crispasr-development-row-v1",
            "phase": phase,
            "family": family,
            "device": device,
            "sample": sample,
            "attemptId": "attempt",
            "inputLock": self.identity(1),
            "runner": self.identity(2),
            "worker": self.identity(7),
            "library": self.identity(3),
            "model": self.identity(4),
            "audio": self.identity(5),
            "openParams": {
                "abiVersion": 2, "threads": 16, "useGpu": 1 if device == "cuda" else 0,
                "verbosity": 0, "flashAttn": 0, "gpuLayers": -1 if device == "cuda" else 0,
                "preference": "cuda" if device == "cuda" else "none",
            },
            "resolvedComputeDeviceAvailable": False,
            "moduleCheckpoints": [
                {"stage": "post-session-open", "modules": self.modules(device)},
                {"stage": "post-alignment" if qwen else "post-transcribe", "modules": self.modules(device)},
            ],
            "restrictedPath": {"roles": ["runtime-bin", "cuda-bin", "system32"], "sha256": "7" * 64},
            "stderr": {"relativePath": stderr_path.relative_to(self.root).as_posix(), "sizeBytes": 0, "sha256": hashlib.sha256(b"").hexdigest(), "privacyPass": True},
            "generations": [],
            "status": status,
        }
        if qwen:
            row["aligner"] = self.identity(6)
        if device == "cuda":
            row["cudaDevice"] = {"index": 0, "name": "NVIDIA GeForce RTX 3070", "computeCapability": "8.6", "driverApiVersion": 13020}
        return row

    def modules(self, device):
        names = [("hikaru-asr-crispasr-development-runner.exe", "runtime-bin")]
        if device == "cuda":
            names += [("nvcuda.dll", "system32"), ("ggml-cuda.dll", "runtime-bin"),
                      ("cublas64_12.dll", "runtime-bin"), ("cudart64_12.dll", "runtime-bin")]
        return [{"name": name, "rootRole": role, "relativePath": name, "identity": self.identity(i + 10)}
                for i, (name, role) in enumerate(names)]

    def generation(self, qwen, repeat, rtf, sample="short-v1"):
        duration_ms = 24102 if sample == "short-v1" else 120000
        return {
            "repeatIndex": repeat,
            "temperature": "cold" if repeat == 0 else "warm",
            "rtf": rtf,
            "terminalCode": "qwen_timeline_policy_not_implemented" if qwen else "completed",
            "acceptedSegmentCount": 0 if qwen else 1,
            "alignmentEntryCount": 2 if qwen else 0,
            "alignmentRanges": [[0, 10], [20, duration_ms + 1360]] if qwen else None,
            "maxAlignmentTailOverrunMs": 1360 if qwen else None,
        }

    def matrix(self):
        entries = []
        for family in publisher.FAMILIES:
            for device in publisher.DEVICES:
                row = self.runner_row("discovery", family, device, "short-v1")
                row["generations"] = [self.generation(family == "qwen3-family", 0, 1.0, "short-v1")]
                entries.append({**self.write(f"raw/discovery-{family}-{device}.json", row), "rowRole": "discovery", "family": family})
            for sample in publisher.SAMPLES:
                for device in publisher.DEVICES:
                    base = 1.0 if device == "cpu" else 0.5
                    row = self.runner_row("formal", family, device, sample)
                    row["generations"] = [
                        self.generation(family == "qwen3-family", repeat, base + repeat * 0.01, sample)
                        for repeat in range(4)
                    ]
                    entries.append({**self.write(f"raw/formal-{family}-{device}-{sample}.json", row),
                                    "rowRole": "formal", "family": family})
        index = self.root / "index.json"
        index.write_text(json.dumps({"schema": "hikaru-crispasr-development-raw-index-v1", "frozen": True, "entries": entries}), encoding="utf-8")
        publisher.FROZEN_INDEX_OVERRIDE = hashlib.sha256(index.read_bytes()).hexdigest()
        return index

    def test_complete_matrix_publishes_two_independent_ready_results_deterministically(self):
        index = self.matrix()
        json_out = self.root / "out.json"
        md_out = self.root / "out.md"
        publisher.publish(index, json_out, md_out)
        first = (json_out.read_bytes(), md_out.read_bytes())
        publisher.publish(index, json_out, md_out)
        self.assertEqual(first, (json_out.read_bytes(), md_out.read_bytes()))
        result = json.loads(json_out.read_text())
        self.assertEqual({v["result"] for v in result["results"].values()}, {"development-gpu-ready"})
        self.assertEqual(result["results"]["qwen3-family"]["maxAlignmentTailOverrunMs"], 1360)

    def test_qwen_tail_overrun_must_match_bound_raw_ranges(self):
        index = self.matrix()
        value = json.loads(index.read_text())
        entry = next(item for item in value["entries"] if "qwen3-family-cuda-short" in item["relativeRawIdentifier"])
        path = self.root / entry["relativeRawIdentifier"]
        row = json.loads(path.read_text())
        row["generations"][0]["maxAlignmentTailOverrunMs"] += 1
        path.write_text(json.dumps(row, sort_keys=True), encoding="utf-8")
        entry["sizeBytes"] = path.stat().st_size
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        index.write_text(json.dumps(value), encoding="utf-8")
        publisher.FROZEN_INDEX_OVERRIDE = hashlib.sha256(index.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "maximum alignment tail"):
            publisher.publish(index, self.root / "out.json", self.root / "out.md")

    def test_raw_mutation_with_recomputed_row_content_still_fails_frozen_index(self):
        index = self.matrix()
        target = next(self.root.glob("raw/formal-parakeet-family-cuda-*.json"))
        value = json.loads(target.read_text())
        value["generations"][2]["rtf"] = 100
        target.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "indexed raw bytes drifted"):
            publisher.publish(index, self.root / "out.json", self.root / "out.md")

    def test_repeat_and_qwen_policy_mutations_fail(self):
        index = self.matrix()
        value = json.loads(index.read_text())
        entry = next(item for item in value["entries"] if "qwen3-family-cuda-short" in item["relativeRawIdentifier"])
        path = self.root / entry["relativeRawIdentifier"]
        row = json.loads(path.read_text())
        row["generations"][1]["repeatIndex"] = 3
        path.write_text(json.dumps(row, sort_keys=True), encoding="utf-8")
        entry["sizeBytes"] = path.stat().st_size
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        index.write_text(json.dumps(value), encoding="utf-8")
        publisher.FROZEN_INDEX_OVERRIDE = hashlib.sha256(index.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "repeat sequence"):
            publisher.publish(index, self.root / "out.json", self.root / "out.md")

    def test_shared_prepare_failure_requires_both_families_one_attempt(self):
        entries = []
        for family, attempt in [("parakeet-family", "a"), ("qwen3-family", "b")]:
            row = {
                "schema": "hikaru-crispasr-development-pre-runner-failure-v1",
                "family": family, "attemptId": attempt, "stage": "prepare-runtime",
                "inputLockSha256": "1" * 64, "commandRoleSha256": "2" * 64,
                "exitCode": 1, "privacyPass": True,
                "logs": [{"role": "configure", "relativePath": "raw/configure.log", "sizeBytes": 1,
                          "sha256": "3" * 64, "durationMs": 1.0, "exitCode": 1, "privacyPass": True}],
            }
            entries.append({**self.write(f"raw/{family}.json", row), "rowRole": "pre-runner-failure", "family": family})
        index = self.root / "index.json"
        index.write_text(json.dumps({"schema": "hikaru-crispasr-development-raw-index-v1", "frozen": True, "entries": entries}), encoding="utf-8")
        publisher.FROZEN_INDEX_OVERRIDE = hashlib.sha256(index.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "pairing"):
            publisher.publish(index, self.root / "out.json", self.root / "out.md")

    def test_coordinated_open_params_mutation_is_rejected(self):
        index = self.matrix()
        value = json.loads(index.read_text())
        entry = next(item for item in value["entries"] if "parakeet-family-cuda-short" in item["relativeRawIdentifier"])
        path = self.root / entry["relativeRawIdentifier"]
        row = json.loads(path.read_text())
        row["openParams"]["useGpu"] = 0
        path.write_text(json.dumps(row, sort_keys=True), encoding="utf-8")
        entry["sizeBytes"] = path.stat().st_size
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        index.write_text(json.dumps(value), encoding="utf-8")
        publisher.FROZEN_INDEX_OVERRIDE = hashlib.sha256(index.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "open-parameter"):
            publisher.publish(index, self.root / "out.json", self.root / "out.md")

    def test_pre_runner_log_and_exit_mutations_are_rejected(self):
        row = {
            "schema": "hikaru-crispasr-development-pre-runner-failure-v1",
            "family": "parakeet-family", "attemptId": "a", "stage": "prepare-runtime",
            "inputLockSha256": "1" * 64, "commandRoleSha256": "2" * 64,
            "exitCode": 1, "privacyPass": True,
            "logs": [{"role": "configure", "relativePath": "raw/configure.log", "sizeBytes": 1,
                      "sha256": "3" * 64, "durationMs": 1.0, "exitCode": 2, "privacyPass": True}],
        }
        with self.assertRaisesRegex(ValueError, "exit/log mismatch"):
            publisher.validate_pre_runner(row)

    def test_cross_row_module_inventory_drift_is_rejected(self):
        index = self.matrix()
        value = json.loads(index.read_text())
        entry = next(item for item in value["entries"] if "parakeet-family-cuda-short" in item["relativeRawIdentifier"])
        path = self.root / entry["relativeRawIdentifier"]
        row = json.loads(path.read_text())
        row["moduleCheckpoints"][0]["modules"].append({
            "name": "extra.dll", "rootRole": "runtime-bin", "relativePath": "extra.dll", "identity": self.identity(99)
        })
        path.write_text(json.dumps(row, sort_keys=True), encoding="utf-8")
        entry["sizeBytes"] = path.stat().st_size
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        index.write_text(json.dumps(value), encoding="utf-8")
        publisher.FROZEN_INDEX_OVERRIDE = hashlib.sha256(index.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "exact module checkpoint"):
            publisher.publish(index, self.root / "out.json", self.root / "out.md")

    def test_module_path_and_stderr_mutations_are_rejected(self):
        index = self.matrix()
        value = json.loads(index.read_text())
        entry = next(item for item in value["entries"] if "parakeet-family-cuda-short" in item["relativeRawIdentifier"])
        path = self.root / entry["relativeRawIdentifier"]
        row = json.loads(path.read_text())
        row["moduleCheckpoints"][0]["modules"][0]["rootRole"] = "system32"
        path.write_text(json.dumps(row, sort_keys=True), encoding="utf-8")
        entry["sizeBytes"] = path.stat().st_size
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        index.write_text(json.dumps(value), encoding="utf-8")
        publisher.FROZEN_INDEX_OVERRIDE = hashlib.sha256(index.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "module"):
            publisher.publish(index, self.root / "out.json", self.root / "out.md")

        index = self.matrix()
        value = json.loads(index.read_text())
        entry = next(item for item in value["entries"] if "parakeet-family-cuda-short" in item["relativeRawIdentifier"])
        path = self.root / entry["relativeRawIdentifier"]
        row = json.loads(path.read_text())
        row["moduleCheckpoints"][0]["modules"][1]["relativePath"] = "renamed.dll"
        path.write_text(json.dumps(row, sort_keys=True), encoding="utf-8")
        entry["sizeBytes"] = path.stat().st_size
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        index.write_text(json.dumps(value), encoding="utf-8")
        publisher.FROZEN_INDEX_OVERRIDE = hashlib.sha256(index.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "module"):
            publisher.publish(index, self.root / "out.json", self.root / "out.md")

        index = self.matrix()
        value = json.loads(index.read_text())
        entry = next(item for item in value["entries"] if "parakeet-family-cuda-short" in item["relativeRawIdentifier"])
        path = self.root / entry["relativeRawIdentifier"]
        row = json.loads(path.read_text())
        row["restrictedPath"]["sha256"] = "8" * 64
        path.write_text(json.dumps(row, sort_keys=True), encoding="utf-8")
        entry["sizeBytes"] = path.stat().st_size
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        index.write_text(json.dumps(value), encoding="utf-8")
        publisher.FROZEN_INDEX_OVERRIDE = hashlib.sha256(index.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "PATH identity"):
            publisher.publish(index, self.root / "out.json", self.root / "out.md")

        index = self.matrix()
        stderr = next(self.root.glob("raw/stderr-parakeet-family-cuda-formal-short-v1.log"))
        stderr.write_bytes(b"private drift")
        with self.assertRaisesRegex(ValueError, "stderr bytes drifted"):
            publisher.publish(index, self.root / "out.json", self.root / "out.md")

    def test_cuda_identity_and_escaped_private_stderr_are_rejected(self):
        index = self.matrix()
        value = json.loads(index.read_text())
        entry = next(item for item in value["entries"] if "qwen3-family-cuda-short" in item["relativeRawIdentifier"])
        path = self.root / entry["relativeRawIdentifier"]
        row = json.loads(path.read_text())
        row["cudaDevice"]["driverApiVersion"] += 1
        path.write_text(json.dumps(row, sort_keys=True), encoding="utf-8")
        entry["sizeBytes"] = path.stat().st_size
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        index.write_text(json.dumps(value), encoding="utf-8")
        publisher.FROZEN_INDEX_OVERRIDE = hashlib.sha256(index.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "CUDA device"):
            publisher.publish(index, self.root / "out.json", self.root / "out.md")

        index = self.matrix()
        stderr = next(self.root.glob("raw/stderr-qwen3-family-cuda-formal-short-v1.log"))
        stderr.write_bytes("\\u65e5\\u672c\\u8a9e\\u30c6\\u30b9\\u30c8".encode())
        value = json.loads(index.read_text())
        entry = next(item for item in value["entries"] if "qwen3-family-cuda-short" in item["relativeRawIdentifier"])
        path = self.root / entry["relativeRawIdentifier"]
        row = json.loads(path.read_text())
        row["stderr"]["sizeBytes"] = stderr.stat().st_size
        row["stderr"]["sha256"] = hashlib.sha256(stderr.read_bytes()).hexdigest()
        path.write_text(json.dumps(row, sort_keys=True), encoding="utf-8")
        entry["sizeBytes"] = path.stat().st_size
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        index.write_text(json.dumps(value), encoding="utf-8")
        publisher.FROZEN_INDEX_OVERRIDE = hashlib.sha256(index.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "privacy"):
            publisher.publish(index, self.root / "out.json", self.root / "out.md")

    def test_private_path_field_is_rejected(self):
        with self.assertRaises(ValueError):
            publisher.reject_private({"absolutePath": r"C:\private\audio.wav"})


if __name__ == "__main__":
    unittest.main()
