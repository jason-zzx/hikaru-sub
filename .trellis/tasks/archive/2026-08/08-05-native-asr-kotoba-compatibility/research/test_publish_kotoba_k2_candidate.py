from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import ntpath
import tempfile
import unittest
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {filename}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

adapter = _load("kotoba_k2_benchmark_adapter", "kotoba_k2_benchmark_adapter.py")
publisher = _load("publish_kotoba_k2_candidate_test", "publish_kotoba_k2_candidate.py")

ROOTS = [
    {"role": "task-local-runtime-bin", "canonicalPath": r"C:\t08\bin"},
    {"role": "cuda-toolkit-12.8-bin", "canonicalPath": r"C:\cuda\bin"},
    {"role": "windows-system32", "canonicalPath": r"C:\Windows\System32"},
]
ROOT_IDENTITY = hashlib.sha256("\n".join(f"{item['role']}={item['canonicalPath']}" for item in ROOTS).encode()).hexdigest()


class K2PublisherTests(unittest.TestCase):
    def setUp(self) -> None:
        adapter.LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=adapter.LOCAL_ROOT)
        self.root = Path(self.temp.name)
        self.lock = self.root / "k2-lock.md"
        self.old_root_identity = adapter.EXPECTED_PATH_ROOT_IDENTITY
        self.old_executable = adapter.EXPECTED_MEASUREMENT_EXECUTABLE
        self.old_worker = adapter.EXPECTED_PRODUCTION_WORKER
        adapter.EXPECTED_PATH_ROOT_IDENTITY = ROOT_IDENTITY
        adapter.EXPECTED_MEASUREMENT_EXECUTABLE = adapter.EXPECTED_LOADED_MODULES["hikaru-asr-ctranslate2-tests.exe"][1:3]
        adapter.EXPECTED_PRODUCTION_WORKER = (500224, "b" * 64)
        self.lock.write_text("\n".join(sorted({
            adapter.EXPECTED_MEASUREMENT_EXECUTABLE[1], adapter.EXPECTED_PRODUCTION_WORKER[1],
            *(identity[1] for identity in adapter.EXPECTED_RUNTIME_DLLS.values()),
            *(identity[2] for identity in adapter.EXPECTED_LOADED_MODULES.values()),
        })), encoding="utf-8")

    def tearDown(self) -> None:
        adapter.EXPECTED_PATH_ROOT_IDENTITY = self.old_root_identity
        adapter.EXPECTED_MEASUREMENT_EXECUTABLE = self.old_executable
        adapter.EXPECTED_PRODUCTION_WORKER = self.old_worker
        self.temp.cleanup()

    @staticmethod
    def _trace(before: int, after: int, duration: int, index: int, final: bool, source_frames: int, audio_duration: int, segment: dict | None) -> dict:
        tokens = [50_365, 42 + index, 50_415]
        trace = {
            "windowOffsetMs": before * 10, "sourceWindowDurationMs": min(15_000, audio_duration - before * 10), "modelWindowDurationMs": 30_000,
            "seekFramesBefore": before, "seekFramesAfter": after, "sourceOverlapMs": max(0, min(1_500, source_frames - before) - (after - before)) * 10,
            "sourceProgressBeforeMs": min(audio_duration, before * 10), "sourceProgressAfterMs": min(audio_duration, after * 10),
            "vadTimestampRestored": False, "promptTokenCount": 3, "historyTokenCountBefore": 0, "historyTokenCountAfter": 0,
            "prefixForwardTokenCount": 2, "generatedTokenCount": len(tokens), "featureMs": 1.0, "generateMs": 2.0,
            "generationCallCount": 1, "fallbackCallCount": 0, "noSpeechProbability": 0.0, "averageLogProbability": -0.1,
            "skippedAsNoSpeech": False, "parseStatus": "source-window-end" if final else "decoded-seek", "parseError": None,
            "sha256": hashlib.sha256(",".join(str(token) for token in tokens).encode()).hexdigest(), "tokenIds": tokens,
            "candidateId": adapter.CANDIDATE_ID, "ownershipRule": adapter.OWNERSHIP_RULE, "windowIndex": index,
            "parsedSeekAdvanceFrames": min(1_500, source_frames - before), "proposedAdvanceFrames": min(1_500, source_frames - before),
            "appliedSeekAdvanceFrames": after - before, "nextWindowStartMs": min(audio_duration, after * 10),
            "actualSourceOverlapFrames": max(0, min(1_500, source_frames - before) - (after - before)),
            "actualSourceOverlapMs": max(0, min(1_500, source_frames - before) - (after - before)) * 10,
            "singleTimestampEnding": False, "usedDecodedSeek": not final, "ownershipStartMs": before * 10,
            "ownershipEndMs": audio_duration if final else min(audio_duration, after * 10), "ownershipEndExclusive": not final,
            "finalWindow": final, "parsedSegmentCount": 0, "ownedBeforeDedupCount": 0, "nonOwnerDiscardedCount": 0,
            "exactDuplicateDiscardedCount": 0, "emittedSegmentCount": 0, "lastEmittedStartBeforeMs": -1, "lastEmittedStartAfterMs": -1,
            "segmentDispositions": [],
        }
        if segment is not None:
            text = segment["text"]; start = segment["startMs"]; end = segment["endMs"]
            segment_tokens = [50_365, 100 + index, 50_415]
            trace_hash = trace["sha256"]
            tuple_sha = hashlib.sha256(f"{start}\n{end}\n{text}".encode()).hexdigest()
            trace["tokenIds"] = segment_tokens
            trace["generatedTokenCount"] = len(segment_tokens)
            trace["sha256"] = hashlib.sha256(",".join(str(token) for token in segment_tokens).encode()).hexdigest()
            trace["parsedSegmentCount"] = trace["ownedBeforeDedupCount"] = trace["emittedSegmentCount"] = 1
            trace["lastEmittedStartAfterMs"] = start
            trace["segmentDispositions"] = [{"startMs": start, "endMs": end, "text": text, "tokenIds": segment_tokens, "traceSha256": trace["sha256"], "tupleSha256": tuple_sha, "ownerWindowIndex": index, "ownershipAnchor": "startMs", "disposition": "emitted", "duplicateTargetSha256": None}]
        return trace

    def _raw(self, case_id: str) -> dict:
        expected = adapter.EXPECTED_CASES[case_id]
        frames = expected["sourceFrames"]; duration = expected["durationMs"]
        traces = []; segments = []; before = 0; index = 0
        while before < frames:
            source = min(1_500, frames - before); advance = min(source, 1_000); after = min(frames, before + advance); final = after == frames
            segment = None
            if case_id == "short-v1":
                segment = {"startMs": before * 10, "endMs": min(duration, before * 10 + 500), "text": "PRIVATE_TRANSCRIPT_MARKER"}
            trace = self._trace(before, after, source, index, final, frames, duration, segment)
            trace["lastEmittedStartBeforeMs"] = segments[-1]["startMs"] if segments else -1
            traces.append(trace)
            if segment is not None:
                disposition = trace["segmentDispositions"][0]
                token_ids = disposition["tokenIds"]
                segments.append({
                    "startMs": segment["startMs"], "endMs": segment["endMs"], "text": segment["text"],
                    "rawStartMs": segment["startMs"], "rawEndMs": segment["endMs"],
                    "endBoundedToAudio": False, "compressedStartMs": None, "compressedEndMs": None,
                    "vadTimestampRestored": False, "timestampStartToken": token_ids[0],
                    "timestampEndToken": token_ids[-1], "tokenIds": copy.deepcopy(token_ids),
                    "traceSha256": disposition["traceSha256"],
                })
            trace["lastEmittedStartAfterMs"] = segments[-1]["startMs"] if segments else -1
            before, index = after, index + 1
        samples = []
        sample_count = expected["sampleCount"]
        for repeat in range(sample_count):
            sample_traces = copy.deepcopy(traces)
            timings = {"loadMs": 10.0 if repeat == 0 else None, "sampleWallMs": 100.0, "featureMs": float(len(sample_traces)), "modelGenerateMs": float(len(sample_traces) * 2), "inferenceMs": float(duration) * 0.1, "inferenceRtf": 0.1}
            if repeat == 0: timings.update(processWallMs=200.0, processWallRtf=200.0 / duration)
            samples.append({"status": "completed", "runKind": "cold" if repeat == 0 else "warm", "repeatIndex": repeat + 1, "segments": copy.deepcopy(segments), "tokenTraces": sample_traces, "generationCompleted": True, "generationCallCount": len(sample_traces), "failure": None, "progressMs": [trace["sourceProgressAfterMs"] for trace in sample_traces], "timings": timings})
        roots = copy.deepcopy(ROOTS); root_paths = {item["role"]: item["canonicalPath"] for item in roots}
        modules = [{"name": name, "rootRole": role, "canonicalPath": ntpath.join(root_paths[role], name), "sizeBytes": size, "sha256": digest, "version": version} for name, (role, size, digest, version) in adapter.EXPECTED_LOADED_MODULES.items()]
        files = [{"name": name, "sizeBytes": size, "sha256": digest} for name, (size, digest) in adapter.EXPECTED_MODEL_FILES.items()]
        return {"schemaVersion": 1, "kind": adapter.EXPECTED_KIND, "status": "completed", "caseId": case_id, "engine": "kotoba-faster-whisper", "model": {"id": adapter.EXPECTED_MODEL[0], "revision": adapter.EXPECTED_MODEL[1], "files": files, "legacyCache": {"layout": "huggingface-immutable-snapshot", "revisionDirectoryVerified": True, "usedInPlace": True}}, "audio": {"sha256": expected["audioSha256"], "durationMs": duration, "sourceFrames": frames}, "candidate": adapter.CANDIDATE_ID, "config": copy.deepcopy(adapter.EXPECTED_CONFIG), "inputLockSha256": adapter.sha256_file(self.lock), "runtime": {"measurementExecutable": {"sizeBytes": adapter.EXPECTED_MEASUREMENT_EXECUTABLE[0], "sha256": adapter.EXPECTED_MEASUREMENT_EXECUTABLE[1]}, "productionWorker": {"sizeBytes": adapter.EXPECTED_PRODUCTION_WORKER[0], "sha256": adapter.EXPECTED_PRODUCTION_WORKER[1]}, "requiredDlls": [{"name": name, "sizeBytes": size, "sha256": digest} for name, (size, digest) in sorted(adapter.EXPECTED_RUNTIME_DLLS.items())], "requestedDevice": "cuda", "resolvedDevice": "cuda", "computeType": "float16", "deviceIndex": 0, "ctranslate2Version": "4.8.0", "cudaBuildEnabled": True, "cudaDynamicLoading": True, "withCudnn": False, "gpu": copy.deepcopy(adapter.EXPECTED_GPU), "cpu": copy.deepcopy(adapter.EXPECTED_CPU), "pathPolicy": {"name": "t07-windows-cuda-restricted-path-v1", "restricted": True, "orderedEntryRoles": [item["role"] for item in roots], "rootIdentitySha256": ROOT_IDENTITY, "resolvedRoots": roots}, "loadedModules": modules}, "samples": samples, "resources": {"peakProcessRssBytes": 1_000_000, "method": "GetProcessMemoryInfo.PeakWorkingSetSize"}}

    def test_strict_identity_config_and_private_mutations(self) -> None:
        raw = self._raw("short-v1")
        benchmark = adapter.load_benchmark(Path(__file__).resolve().parents[4])
        adapter.validate_raw_identity(benchmark, raw, self.lock, "short-v1")
        for mutate in (lambda item: item["config"].__setitem__("maxAppliedSeekFrames", 999), lambda item: item["candidate"].__setitem__(0, "bad") if False else item.__setitem__("candidate", "kotoba-k1"), lambda item: item["samples"][0]["tokenTraces"][0].__setitem__("appliedSeekAdvanceFrames", 999)):
            changed = copy.deepcopy(raw); mutate(changed)
            with self.assertRaises(adapter.EvidenceError): adapter.validate_raw_identity(benchmark, changed, self.lock, "short-v1")

    def test_stride_overlap_ownership_progress_and_count_mutations_fail(self) -> None:
        raw = self._raw("short-v1"); trace = raw["samples"][0]["tokenTraces"][0]
        benchmark = adapter.load_benchmark(Path(__file__).resolve().parents[4])
        for key, value in (("actualSourceOverlapFrames", 499), ("ownershipEndExclusive", False), ("sourceProgressAfterMs", 9999), ("emittedSegmentCount", 0)):
            changed = copy.deepcopy(raw); changed["samples"][0]["tokenTraces"][0][key] = value
            with self.assertRaises(adapter.EvidenceError): adapter.validate_raw_identity(benchmark, changed, self.lock, "short-v1")
        coordinated = copy.deepcopy(raw)
        first = coordinated["samples"][0]["tokenTraces"][0]
        first.update(appliedSeekAdvanceFrames=900, seekFramesAfter=900, nextWindowStartMs=9000,
                     actualSourceOverlapFrames=600, actualSourceOverlapMs=6000,
                     ownershipEndMs=9000, sourceOverlapMs=6000, sourceProgressAfterMs=9000)
        coordinated["samples"][0]["progressMs"][0] = 9000
        with self.assertRaises(adapter.EvidenceError):
            adapter.validate_raw_identity(benchmark, coordinated, self.lock, "short-v1")
        midpoint = copy.deepcopy(raw); midpoint["samples"][0]["tokenTraces"][0]["ownershipEndMs"] = 5000
        with self.assertRaises(adapter.EvidenceError): adapter.validate_raw_identity(benchmark, midpoint, self.lock, "short-v1")
        forged = copy.deepcopy(raw)
        forged_trace = forged["samples"][0]["tokenTraces"][0]
        forged_trace["segmentDispositions"][0]["disposition"] = "non-owner"
        forged_trace.update(ownedBeforeDedupCount=0, nonOwnerDiscardedCount=1, emittedSegmentCount=0,
                            lastEmittedStartAfterMs=-1)
        forged["samples"][0]["segments"].pop(0)
        with self.assertRaises(adapter.EvidenceError):
            adapter.validate_raw_identity(benchmark, forged, self.lock, "short-v1")
        fake_duplicate = copy.deepcopy(raw)
        duplicate_trace = fake_duplicate["samples"][0]["tokenTraces"][0]
        duplicate_trace["segmentDispositions"][0].update(
            disposition="exact-duplicate", duplicateTargetSha256="f" * 64)
        duplicate_trace.update(exactDuplicateDiscardedCount=1, emittedSegmentCount=0,
                               lastEmittedStartAfterMs=-1)
        fake_duplicate["samples"][0]["segments"].pop(0)
        with self.assertRaises(adapter.EvidenceError):
            adapter.validate_raw_identity(benchmark, fake_duplicate, self.lock, "short-v1")
        self.assertEqual(trace["ownershipRule"], "latest-start-half-open-v1")

    def test_runtime_corpus_and_path_mutations_fail(self) -> None:
        raw = self._raw("short-v1"); benchmark = adapter.load_benchmark(Path(__file__).resolve().parents[4])
        for change in (("runtime", "requestedDevice", "cpu"), ("runtime", "loadedModules", []), ("audio", "durationMs", 1)):
            changed = copy.deepcopy(raw); changed[change[0]][change[1]] = change[2]
            with self.assertRaises(adapter.EvidenceError): adapter.validate_raw_identity(benchmark, changed, self.lock, "short-v1")
        changed = copy.deepcopy(raw); changed["runtime"]["pathPolicy"]["resolvedRoots"][0]["canonicalPath"] = r"C:\escape"
        with self.assertRaises(adapter.EvidenceError): adapter.validate_raw_identity(benchmark, changed, self.lock, "short-v1")

    def test_full_matrix_is_only_acceptance_and_gap_hash_is_stable(self) -> None:
        self.assertNotEqual(publisher._candidate_state([{"caseId": "short-v1", "allApplicableGatesPass": True}])[0], "accepted-kotoba-algorithm-input")
        passed = [{"caseId": case, "allApplicableGatesPass": True} for case in publisher.CASE_ORDER]
        self.assertEqual(publisher._candidate_state(passed), ("accepted-kotoba-algorithm-input", None))
        failed = copy.deepcopy(passed); failed[-1]["allApplicableGatesPass"] = False
        self.assertEqual(publisher._candidate_state(failed), ("stop-revise", None))
        self.assertEqual(adapter.coordinate_set_hash(), adapter.coordinate_set_hash())
        changed = list(adapter.K1_LONG_V2_GAP_COORDINATES); changed[2] = (1289541, 1291540)
        self.assertNotEqual(adapter.coordinate_set_hash(), adapter.coordinate_set_hash(changed))

    def test_raw_path_escape_and_privacy_boundary(self) -> None:
        class Benchmark:
            @staticmethod
            def _require_ignored_raw_output(path: Path) -> None:
                raise AssertionError(path)
        with tempfile.TemporaryDirectory() as outside:
            with self.assertRaises(adapter.EvidenceError): adapter.require_task_local(Benchmark(), Path(outside) / "raw.json", "raw")
        raw = self._raw("short-v1")
        encoded = json.dumps(raw, ensure_ascii=False)
        self.assertIn("PRIVATE_TRANSCRIPT_MARKER", encoded)
        # Raw evidence is private by contract; publisher output is the sanitized boundary.
        self.assertNotIn("referenceText", encoded)

    def test_publication_is_byte_identical_sanitized_and_raw_hash_bound(self) -> None:
        repo = Path(__file__).resolve().parents[4]
        raw_paths = []
        for case in publisher.CASE_ORDER:
            path = self.root / f"{case}.json"
            path.write_text(json.dumps(self._raw(case), ensure_ascii=False), encoding="utf-8")
            raw_paths.append(path)
        correction = self.root / "correction-lock.md"
        correction.write_text("\n".join(sorted({
            adapter.sha256_file(Path(adapter.__file__)),
            adapter.sha256_file(Path(publisher.__file__)),
            adapter.sha256_file(repo / "scripts" / "asr-benchmark.py"),
            adapter.sha256_file(repo / ".asr-benchmark" / "manifest.json"),
            adapter.sha256_file(self.lock),
        })), encoding="utf-8")
        evidence = self.root / "evidence.json"; report = self.root / "report.md"
        args = (raw_paths, repo / ".asr-benchmark" / "manifest.json", repo / ".asr-benchmark",
                self.lock, correction, evidence, report)
        first_result = publisher.publish(*args)
        first = evidence.read_bytes(), report.read_bytes()
        second_result = publisher.publish(*args)
        self.assertEqual(first, (evidence.read_bytes(), report.read_bytes()))
        self.assertEqual(first_result, second_result)
        self.assertEqual(
            [row["ignoredRawSha256"] for row in first_result["cases"]],
            [adapter.sha256_file(path) for path in raw_paths],
        )
        public = evidence.read_text(encoding="utf-8") + report.read_text(encoding="utf-8")
        for private in ("\"text\"", "tokenIds", "canonicalPath", r"C:\\", "PRIVATE_TRANSCRIPT_MARKER"):
            self.assertNotIn(private, public)
        self.assertEqual(len(first_result["k1LongV2GapDiagnostics"]), 7)


if __name__ == "__main__":
    unittest.main()
