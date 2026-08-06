from __future__ import annotations

import copy
import hashlib
import json
import ntpath
import tempfile
import unittest
from pathlib import Path

import kotoba_benchmark_adapter as adapter
import publish_kotoba_candidate as publisher

H2 = "2" * 64
ROOTS = [
    {"role": "task-local-runtime-bin", "canonicalPath": r"C:\t08\bin"},
    {"role": "cuda-toolkit-12.8-bin", "canonicalPath": r"C:\cuda\bin"},
    {"role": "windows-system32", "canonicalPath": r"C:\Windows\System32"},
]
ROOT_IDENTITY = hashlib.sha256(
    "\n".join(f"{item['role']}={item['canonicalPath']}" for item in ROOTS).encode()
).hexdigest()


class PublisherTests(unittest.TestCase):
    def setUp(self) -> None:
        adapter.LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=adapter.LOCAL_ROOT)
        self.root = Path(self.temp.name)
        self.lock = self.root / "lock.md"
        self.original_path_identity = adapter.EXPECTED_PATH_ROOT_IDENTITY
        adapter.EXPECTED_PATH_ROOT_IDENTITY = ROOT_IDENTITY
        frozen_hashes = {
            adapter.EXPECTED_MEASUREMENT_EXECUTABLE[1],
            adapter.EXPECTED_PRODUCTION_WORKER[1],
            *(identity[1] for identity in adapter.EXPECTED_RUNTIME_DLLS.values()),
            *(identity[2] for identity in adapter.EXPECTED_LOADED_MODULES.values()),
            adapter.sha256_file(Path(adapter.__file__)),
            adapter.sha256_file(Path(publisher.__file__)),
        }
        self.lock.write_text("\n".join(sorted(frozen_hashes)), encoding="utf-8")
        repo = Path(__file__).resolve().parents[4]
        self.correction_lock = self.root / "correction-lock.md"
        self.correction_lock.write_text(
            "\n".join(sorted({
                adapter.sha256_file(Path(adapter.__file__)),
                adapter.sha256_file(Path(publisher.__file__)),
                adapter.sha256_file(repo / "scripts" / "asr-benchmark.py"),
                adapter.sha256_file(repo / ".asr-benchmark" / "manifest.json"),
                adapter.sha256_file(self.lock),
            })),
            encoding="utf-8",
        )
        self.raw = self.root / "short.json"
        self.raw.write_text(json.dumps(self._raw()), encoding="utf-8")

    def tearDown(self) -> None:
        adapter.EXPECTED_PATH_ROOT_IDENTITY = self.original_path_identity
        self.temp.cleanup()

    @staticmethod
    def _trace(before: int, after: int, duration: int, token: int) -> dict:
        tokens = [50_365, token, 50_415]
        digest = hashlib.sha256(",".join(str(value) for value in tokens).encode()).hexdigest()
        return {
            "windowOffsetMs": before * 10,
            "sourceWindowDurationMs": duration,
            "modelWindowDurationMs": 30_000,
            "seekFramesBefore": before,
            "seekFramesAfter": after,
            "sourceOverlapMs": max(0, duration - (after - before) * 10),
            "sourceProgressBeforeMs": before * 10,
            "sourceProgressAfterMs": min(24_102, after * 10),
            "vadTimestampRestored": False,
            "promptTokenCount": 3,
            "historyTokenCountBefore": 0,
            "historyTokenCountAfter": 0,
            "prefixForwardTokenCount": 2,
            "generatedTokenCount": len(tokens),
            "featureMs": 10.0,
            "generateMs": 100.0,
            "generationCallCount": 1,
            "fallbackCallCount": 0,
            "noSpeechProbability": 0.0,
            "averageLogProbability": -0.1,
            "skippedAsNoSpeech": False,
            "parseStatus": "decoded-seek" if after < 2_411 else "source-window-end",
            "parseError": None,
            "sha256": digest,
            "tokenIds": tokens,
        }

    def _raw(self) -> dict:
        traces = [self._trace(0, 1_500, 15_000, 42), self._trace(1_500, 2_411, 9_102, 43)]
        samples = []
        for index in range(4):
            timings = {
                "loadMs": 100.0 if index == 0 else None,
                "sampleWallMs": 300.0,
                "featureMs": 20.0,
                "modelGenerateMs": 200.0,
                "inferenceMs": 250.0,
                "inferenceRtf": 250.0 / 24_102,
            }
            if index == 0:
                timings.update(processWallMs=500.0, processWallRtf=500.0 / 24_102)
            samples.append({
                "status": "completed",
                "runKind": "cold" if index == 0 else "warm",
                "repeatIndex": index + 1,
                "segments": [{
                    "startMs": 0,
                    "endMs": 1_000,
                    "text": "テスト",
                    "rawStartMs": 0,
                    "rawEndMs": 1_000,
                    "endBoundedToAudio": False,
                    "compressedStartMs": None,
                    "compressedEndMs": None,
                    "vadTimestampRestored": False,
                    "timestampStartToken": traces[0]["tokenIds"][0],
                    "timestampEndToken": traces[0]["tokenIds"][-1],
                    "tokenIds": copy.deepcopy(traces[0]["tokenIds"]),
                    "traceSha256": traces[0]["sha256"],
                }],
                "tokenTraces": copy.deepcopy(traces),
                "generationCompleted": True,
                "generationCallCount": 2,
                "failure": None,
                "timings": timings,
            })
        model_files = [
            {"name": name, "sizeBytes": size, "sha256": digest}
            for name, (size, digest) in adapter.EXPECTED_MODEL_FILES.items()
        ]
        roots = copy.deepcopy(ROOTS)
        root_paths = {item["role"]: item["canonicalPath"] for item in roots}
        modules = [
            {
                "name": name,
                "rootRole": role,
                "canonicalPath": ntpath.join(root_paths[role], name),
                "sizeBytes": size,
                "sha256": digest,
                "version": version,
            }
            for name, (role, size, digest, version) in adapter.EXPECTED_LOADED_MODULES.items()
        ]
        return {
            "schemaVersion": 1,
            "kind": adapter.EXPECTED_KIND,
            "status": "completed",
            "caseId": "short-v1",
            "engine": "kotoba-faster-whisper",
            "model": {
                "id": adapter.EXPECTED_MODEL[0],
                "revision": adapter.EXPECTED_MODEL[1],
                "files": model_files,
                "legacyCache": {
                    "layout": "huggingface-immutable-snapshot",
                    "revisionDirectoryVerified": True,
                    "usedInPlace": True,
                },
            },
            "audio": {
                "sha256": adapter.EXPECTED_CASES["short-v1"]["audioSha256"],
                "durationMs": 24_102,
                "sourceFrames": 2_411,
            },
            "candidate": "kotoba-k1",
            "config": copy.deepcopy(adapter.EXPECTED_CONFIG),
            "inputLockSha256": adapter.sha256_file(self.lock),
            "runtime": {
                "measurementExecutable": {
                    "sizeBytes": adapter.EXPECTED_MEASUREMENT_EXECUTABLE[0],
                    "sha256": adapter.EXPECTED_MEASUREMENT_EXECUTABLE[1],
                },
                "productionWorker": {
                    "sizeBytes": adapter.EXPECTED_PRODUCTION_WORKER[0],
                    "sha256": adapter.EXPECTED_PRODUCTION_WORKER[1],
                },
                "requiredDlls": [
                    {"name": name, "sizeBytes": size, "sha256": digest}
                    for name, (size, digest) in sorted(adapter.EXPECTED_RUNTIME_DLLS.items())
                ],
                "requestedDevice": "cuda",
                "resolvedDevice": "cuda",
                "computeType": "float16",
                "deviceIndex": 0,
                "ctranslate2Version": "4.8.0",
                "cudaBuildEnabled": True,
                "cudaDynamicLoading": True,
                "withCudnn": False,
                "gpu": copy.deepcopy(adapter.EXPECTED_GPU),
                "cpu": copy.deepcopy(adapter.EXPECTED_CPU),
                "pathPolicy": {
                    "name": "t07-windows-cuda-restricted-path-v1",
                    "restricted": True,
                    "orderedEntryRoles": [item["role"] for item in roots],
                    "rootIdentitySha256": ROOT_IDENTITY,
                    "resolvedRoots": roots,
                },
                "loadedModules": modules,
            },
            "samples": samples,
            "resources": {
                "peakProcessRssBytes": 1_000_000,
                "method": "GetProcessMemoryInfo.PeakWorkingSetSize",
            },
        }

    def _validate(self, value: dict) -> dict:
        benchmark = adapter.load_benchmark(Path(__file__).resolve().parents[4])
        return adapter.validate_raw_identity(benchmark, value, self.lock, "short-v1")

    def test_identity_and_metric_mutations_are_rejected(self) -> None:
        value = self._raw()
        value["runtime"]["productionWorker"]["sha256"] = H2
        with self.assertRaises(adapter.EvidenceError):
            self._validate(value)
        value = self._raw()
        value["runtime"]["productionWorker"] = copy.deepcopy(
            value["runtime"]["measurementExecutable"]
        )
        with self.assertRaises(adapter.EvidenceError):
            self._validate(value)
        value = self._raw()
        value["runtime"]["loadedModules"][0].update(
            sizeBytes=value["runtime"]["loadedModules"][1]["sizeBytes"],
            sha256=value["runtime"]["loadedModules"][1]["sha256"],
        )
        with self.assertRaises(adapter.EvidenceError):
            self._validate(value)
        value = self._raw()
        value["runtime"]["pathPolicy"]["resolvedRoots"][0]["canonicalPath"] = r"C:\other"
        with self.assertRaises(adapter.EvidenceError):
            self._validate(value)
        value = self._raw()
        value["samples"][1]["timings"]["inferenceRtf"] = 9.0
        with self.assertRaises(adapter.EvidenceError):
            self._validate(value)

    def test_partial_prefixes_keep_the_next_case_after_a_failure(self) -> None:
        fail = {"caseId": "short-v1", "allApplicableGatesPass": False}
        medium = {"caseId": "medium-v1", "allApplicableGatesPass": True}
        long_fail = {"caseId": "long-v2", "allApplicableGatesPass": False}
        self.assertEqual(
            publisher._candidate_state([fail]),
            ("short-v1-fail-next-gate", "medium-v1"),
        )
        self.assertEqual(
            publisher._candidate_state([fail, medium]),
            ("medium-v1-fail-next-gate", "long-v2"),
        )
        self.assertEqual(
            publisher._candidate_state([fail, medium, long_fail]),
            ("stop-revise", None),
        )

    def test_complete_passing_matrix_is_the_only_acceptance_state(self) -> None:
        passed = [
            {"caseId": "short-v1", "allApplicableGatesPass": True},
            {"caseId": "medium-v1", "allApplicableGatesPass": True},
            {"caseId": "long-v2", "allApplicableGatesPass": True},
        ]
        self.assertEqual(
            publisher._candidate_state(passed),
            ("accepted-kotoba-algorithm-input", None),
        )

    def test_raw_path_escape_is_rejected(self) -> None:
        class Benchmark:
            @staticmethod
            def _require_ignored_raw_output(path: Path) -> None:
                raise AssertionError(path)

        with tempfile.TemporaryDirectory() as outside:
            with self.assertRaises(adapter.EvidenceError):
                adapter.require_task_local(Benchmark(), Path(outside) / "raw.json", "raw")

    def test_publication_is_byte_deterministic(self) -> None:
        repo = Path(__file__).resolve().parents[4]
        evidence = self.root / "result.json"
        report = self.root / "report.md"
        args = (
            [self.raw],
            repo / ".asr-benchmark" / "manifest.json",
            repo / ".asr-benchmark",
            self.lock,
            self.correction_lock,
            evidence,
            report,
        )
        publisher.publish(*args)
        first = evidence.read_bytes(), report.read_bytes()
        publisher.publish(*args)
        self.assertEqual(first, (evidence.read_bytes(), report.read_bytes()))
        text = evidence.read_text(encoding="utf-8")
        self.assertNotIn("テスト", text)
        self.assertNotIn("canonicalPath", text)


if __name__ == "__main__":
    unittest.main()
