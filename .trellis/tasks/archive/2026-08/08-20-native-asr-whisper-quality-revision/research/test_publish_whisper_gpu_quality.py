from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).with_name("publish_whisper_gpu_quality.py")
SPEC = importlib.util.spec_from_file_location("publish_whisper_gpu_quality", SCRIPT)
publisher = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = publisher
SPEC.loader.exec_module(publisher)
H = "1" * 64


class WhisperGpuQualityPublisherTests(unittest.TestCase):
    def setUp(self) -> None:
        publisher.LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=publisher.LOCAL_ROOT)
        self.root = Path(self.temp.name)
        self.research_root = self.root / "research"
        self.local_root = self.research_root / "local"
        self.raw_dir = self.local_root / "diagnostic"
        self.raw_dir.mkdir(parents=True)
        self.lock = self.research_root / "gpu-diagnostic-lock.md"
        self.lock.parent.mkdir(parents=True, exist_ok=True)
        locked_hashes = [H, publisher.VAD_MODEL[1]]
        locked_hashes.extend(
            item["sha256"] for item in publisher.FALLBACK_LOADED_MODULES.values()
        )
        for model in publisher.MODELS.values():
            locked_hashes.extend(sha256 for _size, sha256 in model["files"].values())
        self.lock.write_text("\n".join(locked_hashes) + "\n", encoding="utf-8")
        self.lock_sha256 = publisher.sha256_file(self.lock)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _module(self, name: str, role: str) -> dict:
        roots = {
            "task-local-runtime-bin": r"C:\t06r\runtime",
            "cuda-toolkit-12.8-bin": r"C:\cuda\bin",
            "windows-system32": r"C:\Windows\System32",
        }
        identity = publisher.FALLBACK_LOADED_MODULES.get(name.lower(), {
            "name": name,
            "rootRole": role,
            "sizeBytes": 100,
            "sha256": H,
            "version": "1.0.0.0",
        })
        return {**identity, "canonicalPath": roots[role] + "\\" + name}


    def _raw(self, cell_id: str) -> dict:
        case_id, beam_size, history = publisher.DIAGNOSTIC_CELLS[cell_id]
        case = publisher.CASES[case_id]
        model = publisher.MODELS["large-v3"]
        duration = case["durationMs"]
        inference_ms = duration * 0.1
        trace_tokens = [1, 2]
        trace_hash = hashlib.sha256(b"1,2").hexdigest()
        roots = [
            {"role": "task-local-runtime-bin", "canonicalPath": r"C:\t06r\runtime"},
            {"role": "cuda-toolkit-12.8-bin", "canonicalPath": r"C:\cuda\bin"},
            {"role": "windows-system32", "canonicalPath": r"C:\Windows\System32"},
        ]
        modules = [
            self._module("hikaru-asr-ctranslate2-tests.exe", "task-local-runtime-bin"),
            self._module("ctranslate2.dll", "task-local-runtime-bin"),
            self._module("hikaru_asr_tokenizer.dll", "task-local-runtime-bin"),
            self._module("nvcuda.dll", "windows-system32"),
            self._module("cublas64_12.dll", "cuda-toolkit-12.8-bin"),
            self._module("cublasLt64_12.dll", "cuda-toolkit-12.8-bin"),
        ]
        return {
            "schemaVersion": 1,
            "kind": publisher.DIAGNOSTIC_KIND,
            "status": "completed",
            "qualificationEligible": False,
            "comparisonProfile": publisher.PROFILE,
            "candidateId": cell_id,
            "diagnosticCell": cell_id,
            "caseId": case_id,
            "engine": "faster-whisper",
            "model": {
                "id": model["id"],
                "revision": model["revision"],
                "files": [
                    {"name": name, "sizeBytes": size, "sha256": sha256}
                    for name, (size, sha256) in model["files"].items()
                ],
            },
            "audio": {"sha256": case["audioSha256"], "durationMs": duration},
            "algorithm": "ordinary-whisper-timestamp-driven",
            "config": publisher.expected_config(beam_size, history),
            "inputLockSha256": self.lock_sha256,
            "runtime": {
                "measurementExecutable": {"sizeBytes": 100, "sha256": H},
                "productionWorker": {"sizeBytes": 100, "sha256": H},
                "requiredDlls": [
                    {"name": name, "sizeBytes": 100, "sha256": H}
                    for name in (
                        "ctranslate2.dll",
                        "hikaru_asr_tokenizer.dll",
                        "onnxruntime.dll",
                        "onnxruntime_providers_shared.dll",
                    )
                ],
                "requestedDevice": "cuda",
                "resolvedDevice": "cuda",
                "computeType": "float16",
                "deviceIndex": 0,
                "ctranslate2Version": "4.8.0",
                "cudaBuildEnabled": True,
                "cudaDynamicLoading": True,
                "withCudnn": False,
                "gpu": copy.deepcopy(publisher.EXPECTED_GPU),
                "cpu": {},
                "pathPolicy": {
                    "name": "t07-windows-cuda-restricted-path-v1",
                    "restricted": True,
                    "entryCount": 3,
                    "orderedEntryRoles": [item["role"] for item in roots],
                    "rootIdentitySha256": H,
                    "resolvedRoots": roots,
                },
                "loadedModules": modules,
            },
            "samples": [{
                "status": "completed",
                "runKind": "diagnostic",
                "repeatIndex": 1,
                "segments": [{"startMs": 0, "endMs": 1000, "text": "PRIVATE_TRANSCRIPT_SENTINEL_9F04"}],
                "tokenTraces": [{
                    "windowOffsetMs": 0,
                    "sourceWindowDurationMs": min(duration, 30_000),
                    "modelWindowDurationMs": 30_000,
                    "seekFramesBefore": 0,
                    "seekFramesAfter": 1,
                    "sourceOverlapMs": 0,
                    "sourceProgressBeforeMs": 0,
                    "sourceProgressAfterMs": duration,
                    "vadTimestampRestored": False,
                    "promptTokenCount": 3,
                    "historyTokenCountBefore": 0,
                    "historyTokenCountAfter": 0,
                    "prefixForwardTokenCount": 2,
                    "generatedTokenCount": len(trace_tokens),
                    "featureMs": 1.0,
                    "generateMs": inference_ms - 1.0,
                    "generationCallCount": 1,
                    "fallbackCallCount": 0,
                    "noSpeechProbability": 0.0,
                    "averageLogProbability": 0.0,
                    "skippedAsNoSpeech": False,
                    "parseStatus": "source-window-end",
                    "parseError": None,
                    "sha256": trace_hash,
                    "tokenIds": trace_tokens,
                }],
                "generationCompleted": True,
                "generationCallCount": 1,
                "failure": None,
                "timings": {
                    "loadMs": 10.0,
                    "sampleWallMs": inference_ms + 1.0,
                    "featureMs": 1.0,
                    "modelGenerateMs": inference_ms - 1.0,
                    "inferenceMs": inference_ms,
                    "inferenceRtf": 0.1,
                    "processWallMs": inference_ms + 12.0,
                    "processWallRtf": (inference_ms + 12.0) / duration,
                },
            }],
            "resources": {
                "peakProcessRssBytes": 1024**3,
                "method": "GetProcessMemoryInfo.PeakWorkingSetSize",
            },
        }

    def _vad_raw(self, cell_id: str) -> dict:
        case_id, beam_size, history = publisher.VAD_DIAGNOSTIC_CELLS[cell_id]
        source_cell = "short-b5-off" if case_id == "short-v1" else "medium-b5-on"
        value = self._raw(source_cell)
        value.update({
            "kind": publisher.VAD_DIAGNOSTIC_KIND,
            "candidateId": cell_id,
            "diagnosticCell": cell_id,
            "caseId": case_id,
            "algorithm": "ordinary-whisper-timestamp-driven-silero-v6",
            "config": publisher.expected_vad_config(beam_size, history),
        })
        value["runtime"].update({
            "onnxRuntimeVersion": "1.28.0",
            "vadModel": {
                "sizeBytes": publisher.VAD_MODEL[0],
                "sha256": publisher.VAD_MODEL[1],
            },
        })
        value["runtime"]["loadedModules"].append(
            self._module("onnxruntime.dll", "task-local-runtime-bin")
        )
        sample = value["samples"][0]
        sample["runKind"] = "vad-diagnostic"
        sample["tokenTraces"][0]["vadTimestampRestored"] = True
        trace = sample["tokenTraces"][0]
        sample["segments"][0].update({
            "compressedStartMs": 0,
            "compressedEndMs": 1000,
            "rawStartMs": 0,
            "rawEndMs": 1000,
            "endBoundedToAudio": False,
            "vadTimestampRestored": True,
            "timestampStartToken": trace["tokenIds"][0],
            "timestampEndToken": trace["tokenIds"][-1],
            "tokenIds": list(trace["tokenIds"]),
            "traceSha256": trace["sha256"],
        })
        sample["timings"]["vadMs"] = 1.0
        original = publisher.CASES[case_id]["sampleCount"]
        sample["progressMs"] = [publisher.CASES[case_id]["durationMs"]]
        sample["vad"] = {
            "inferenceMs": 1.0,
            "originalSampleCount": original,
            "compressedSampleCount": original,
            "rowCount": original // 512 + 1,
            "batchCount": (original // 512 + 10_000) // 10_000,
            "intervals": [{
                "startSample": 0,
                "endSample": original,
                "compressedEndSample": original,
                "silenceBeforeSamples": 0,
            }],
        }
        return value

    def _fallback_raw(self, cell_id: str) -> dict:
        case_id, _beam_size, _history = publisher.FALLBACK_DIAGNOSTIC_CELLS[cell_id]
        source_cell = "short-b5-vad" if case_id == "short-v1" else "medium-b5-on-vad"
        value = self._vad_raw(source_cell)
        value.update({
            "kind": publisher.FALLBACK_DIAGNOSTIC_KIND,
            "candidateId": cell_id,
            "diagnosticCell": cell_id,
            "algorithm": "upstream-generation-fallback-parity-v1",
            "config": publisher.expected_fallback_config(),
        })
        value["runtime"]["loadedModules"].append(
            self._module("vcomp140.dll", "windows-system32")
        )
        attempt = {
            "temperature": 0.0,
            "decodeMode": "beam",
            "beamSize": 5,
            "patience": 1.0,
            "numHypotheses": 1,
            "samplingTopK": None,
            "samplingTemperature": None,
            "tokenIds": [1, 2],
            "score": 0.0,
            "averageLogProbability": 0.0,
            "noSpeechProbability": 0.0,
            "decodedText": "hello",
            "compressionRatio": len(b"hello") / len(publisher.zlib.compress(b"hello")),
            "compressionTriggered": False,
            "logProbabilityTriggered": False,
            "silenceOverride": False,
        }
        attempt["aggregateSha256"] = publisher.fallback_attempt_aggregate(attempt)
        trace = value["samples"][0]["tokenTraces"][0]
        trace.update({
            "generationCallCount": 1,
            "fallbackCallCount": 0,
            "generationFallbackEnabled": True,
            "selectedAttemptIndex": 0,
            "selectedTemperature": 0.0,
            "averageLogProbability": 0.0,
            "noSpeechProbability": 0.0,
            "compressionRatio": attempt["compressionRatio"],
            "fallbackAttempts": [attempt],
        })
        value["samples"][0]["runKind"] = "fallback-diagnostic"
        return value

    def _write_raws(self) -> None:
        for cell_id in publisher.DIAGNOSTIC_CELLS:
            (self.raw_dir / f"{cell_id}.json").write_text(
                json.dumps(self._raw(cell_id)), encoding="utf-8"
            )

    def _write_vad_raws(self, raw_dir: Path) -> None:
        raw_dir.mkdir(parents=True, exist_ok=True)
        for cell_id in publisher.VAD_DIAGNOSTIC_CELLS:
            (raw_dir / f"{cell_id}.json").write_text(
                json.dumps(self._vad_raw(cell_id)), encoding="utf-8"
            )

    def test_closed_inventory_and_selection_rule(self) -> None:
        rows = []
        for cell_id, (case_id, beam_size, history) in publisher.DIAGNOSTIC_CELLS.items():
            rows.append({
                "cellId": cell_id,
                "caseId": case_id,
                "beamSize": beam_size,
                "conditionOnPreviousText": history,
                "disposition": "qualified",
                "engineering": {"gpuInferenceRtf": 0.2},
            })
        by_id = {row["cellId"]: row for row in rows}
        by_id["medium-b5-off"]["engineering"]["gpuInferenceRtf"] = 0.1
        selected = publisher.select_diagnostic_candidate(rows)
        self.assertEqual(selected["status"], "selected")
        self.assertEqual(selected["selected"]["beamSize"], 5)
        self.assertFalse(selected["selected"]["conditionOnPreviousText"])
        for row in rows:
            row["disposition"] = "stop-revise"
        self.assertEqual(publisher.select_diagnostic_candidate(rows)["status"], "no-candidate-selected")

    def test_vad_closed_inventory_and_selection_rule(self) -> None:
        rows = [
            {
                "cellId": cell_id,
                "disposition": "qualified",
                "engineering": {"gpuInferenceRtf": 0.1},
            }
            for cell_id in publisher.VAD_DIAGNOSTIC_CELLS
        ]
        selected = publisher.select_vad_diagnostic_candidate(rows)
        self.assertEqual(selected["status"], "selected")
        self.assertEqual(selected["selected"]["beamSize"], 5)
        self.assertTrue(selected["selected"]["conditionOnPreviousText"])
        rows[0]["disposition"] = "stop-revise"
        self.assertEqual(
            publisher.select_vad_diagnostic_candidate(rows)["status"],
            "no-candidate-selected",
        )

    def test_fallback_closed_inventory_and_selection_rule(self) -> None:
        rows = [
            {
                "cellId": cell_id,
                "disposition": "qualified",
                "engineering": {"gpuInferenceRtf": 0.1},
            }
            for cell_id in publisher.FALLBACK_DIAGNOSTIC_CELLS
        ]
        selected = publisher.select_fallback_diagnostic_candidate(rows)
        self.assertEqual(selected["status"], "selected")
        self.assertEqual(
            selected["selected"]["candidateId"],
            "upstream-generation-fallback-parity-v1",
        )
        rows[0]["disposition"] = "stop-revise"
        self.assertEqual(
            publisher.select_fallback_diagnostic_candidate(rows)["status"],
            "no-candidate-selected",
        )

    def test_corrected_fallback_lock_freezes_actual_module_inventory(self) -> None:
        research = SCRIPT.parent
        superseded_lock = research / "gpu-fallback-diagnostic-lock.md"
        reviewed_lock = research / "gpu-fallback-diagnostic-lock-v2.md"
        corrected_lock = research / "gpu-fallback-diagnostic-lock-v3.md"
        invalid_json = research / "whisper-gpu-fallback-acquisition-preflight.json"
        invalid_report = research / "whisper-gpu-fallback-acquisition-preflight.md"
        reviewed_json = research / "whisper-gpu-fallback-corrected-lock-preflight.json"
        reviewed_report = research / "whisper-gpu-fallback-corrected-lock-preflight.md"
        self.assertEqual(
            publisher.sha256_file(superseded_lock),
            "5fcfe845451f418a1e21fe8711ba9f367fdc2e13f8c2e02dd598683dde4e073a",
        )
        self.assertEqual(
            publisher.sha256_file(reviewed_lock),
            "823630f08ab15ed7dadf4f80f0e5a320c89e3e2171cd55b8ac86cc6463235b82",
        )
        self.assertEqual(
            publisher.sha256_file(invalid_json),
            "29b8767342bb9f1ac57c630285c1481b58877c57b92c775e38f9dfb9d4b6a212",
        )
        self.assertEqual(
            publisher.sha256_file(invalid_report),
            "27054915dc39d7e2e58535e0a62dfb6fbaf55aac47caf5bd0f66017f539b2f6f",
        )
        self.assertEqual(
            publisher.sha256_file(reviewed_json),
            "5fa4f06f4caea4cb38e7bbbc36b5024b2ab5400efefdb513cd579ab2df282ac4",
        )
        self.assertEqual(
            publisher.sha256_file(reviewed_report),
            "0509d242a5fb9b12988d8fb1510b4ebb53e207f1066b6bf7dd0b2b039d7dd1bb",
        )
        preflight = json.loads(invalid_json.read_text(encoding="utf-8"))
        self.assertFalse(preflight["modelLoaded"])
        self.assertEqual(preflight["acquisitionRows"], [])
        expected_preflight = [
            ("vcomp140.dll", 213_064, "31af29c03643f8396a6f26bcd601c6369d26493d7d78b714827ab2801bd284c7", "windows-system32"),
            ("nvcuda.dll", 4_466_920, "ec9942ff94bcf2a6714531932720d0d36bd1f362df768af9ae21f2388c08ef7c", "windows-system32"),
            ("cublas64_12.dll", 113_716_224, "9513540e4ec4c51ee9e7304138c2cc255c29a8c181f9e80c38efa25738becd99", "cuda-toolkit-12.8-bin"),
            ("cublasLt64_12.dll", 674_667_520, "b199d1ff892a81b7fd3d57ba1781549609b41500b36008fef326038393ad46c7", "cuda-toolkit-12.8-bin"),
        ]
        self.assertEqual(
            [
                (item["name"], item["sizeBytes"], item["sha256"], role)
                for item, (*_identity, role) in zip(preflight["modulePreflight"], expected_preflight)
            ],
            expected_preflight,
        )
        runtime_bin = research / "local" / "build" / "windows-x64-ct2-cuda" / "bin"
        system32 = Path(os.environ["SystemRoot"]) / "System32"
        cuda_bin = Path(os.environ["CUDA_PATH"]) / "bin"
        roots = {
            "task-local-runtime-bin": runtime_bin,
            "windows-system32": system32,
            "cuda-toolkit-12.8-bin": cuda_bin,
        }
        lock_text = corrected_lock.read_text(encoding="utf-8")
        old_hashes = set(re.findall(r"[0-9a-f]{64}", superseded_lock.read_text(encoding="utf-8")))
        self.assertTrue(old_hashes.issubset(set(re.findall(r"[0-9a-f]{64}", lock_text))))
        for item in publisher.FALLBACK_LOADED_MODULES.values():
            with self.subTest(module=item["name"]):
                path = roots[item["rootRole"]] / item["name"]
                self.assertEqual(path.stat().st_size, item["sizeBytes"])
                self.assertEqual(publisher.sha256_file(path), item["sha256"])
                version = '""' if item["version"] == "" else item["version"]
                self.assertIn(
                    f"| `{item['name']}` | {item['sizeBytes']:,} | `{item['sha256']}` | "
                    f"`{item['rootRole']}` | `{version}` |",
                    lock_text,
                )
        for required in (
            "fresh explicit model-backed acquisition approval",
            "short-b5-on-vad-fallback",
            "medium-b5-on-vad-fallback",
            "qualificationEligible=false",
            "No model was loaded",
            "exact fallback-only set",
        ):
            self.assertIn(required, lock_text)

    def test_fallback_loaded_module_inventory_is_exact(self) -> None:
        raw = self._fallback_raw("medium-b5-on-vad-fallback")
        path = self.raw_dir / "medium-b5-on-vad-fallback.json"
        mutations = {
            "missing-vcomp": lambda value: value["runtime"]["loadedModules"].remove(
                next(item for item in value["runtime"]["loadedModules"] if item["name"].lower() == "vcomp140.dll")
            ),
            "additional-provider": lambda value: value["runtime"]["loadedModules"].append(
                self._module("onnxruntime_providers_shared.dll", "task-local-runtime-bin")
            ),
            "identity": lambda value: next(
                item for item in value["runtime"]["loadedModules"] if item["name"].lower() == "vcomp140.dll"
            ).update(sizeBytes=100, sha256=H),
            "version": lambda value: next(
                item for item in value["runtime"]["loadedModules"] if item["name"].lower() == "vcomp140.dll"
            ).update(version="drift"),
        }
        with mock.patch.object(publisher, "LOCAL_ROOT", self.local_root):
            path.write_text(json.dumps(raw), encoding="utf-8")
            publisher.validate_fallback_diagnostic_raw(
                path, "medium-b5-on-vad-fallback", self.lock
            )
            for name, mutate in mutations.items():
                with self.subTest(name=name):
                    value = copy.deepcopy(raw)
                    mutate(value)
                    path.write_text(json.dumps(value), encoding="utf-8")
                    with self.assertRaises(publisher.EvidenceError):
                        publisher.validate_fallback_diagnostic_raw(
                            path, "medium-b5-on-vad-fallback", self.lock
                        )

    def test_fallback_identity_and_trace_mutations_are_rejected(self) -> None:
        raw = self._fallback_raw("medium-b5-on-vad-fallback")

        def change_selected_output(value: dict) -> None:
            attempt = value["samples"][0]["tokenTraces"][0]["fallbackAttempts"][0]
            attempt["tokenIds"] = [1, 3]
            attempt["aggregateSha256"] = publisher.fallback_attempt_aggregate(attempt)

        def change_average_with_hash(value: dict) -> None:
            attempt = value["samples"][0]["tokenTraces"][0]["fallbackAttempts"][0]
            attempt["averageLogProbability"] = 5e-8
            attempt["aggregateSha256"] = publisher.fallback_attempt_aggregate(attempt)

        mutations = {
            "promotion": lambda value: value.update(qualificationEligible=True),
            "wrong-kind": lambda value: value.update(kind=publisher.VAD_DIAGNOSTIC_KIND),
            "short-parity-kind": lambda value: value.update(kind="hikaru-ct2-whisper-short-parity-raw"),
            "history": lambda value: value["config"].update(conditionOnPreviousText=False),
            "temperature-grid": lambda value: value["config"].update(fallbackTemperatures=[0.0]),
            "attempt-option": lambda value: value["samples"][0]["tokenTraces"][0]["fallbackAttempts"][0].update(beamSize=1),
            "sampling-temperature": lambda value: value["samples"][0]["tokenTraces"][0]["fallbackAttempts"][0].update(samplingTemperature=0.0),
            "attempt-hash": lambda value: value["samples"][0]["tokenTraces"][0]["fallbackAttempts"][0].update(aggregateSha256=H),
            "attempt-token": lambda value: value["samples"][0]["tokenTraces"][0]["fallbackAttempts"][0].update(tokenIds=[1, 3]),
            "selected-output-link": change_selected_output,
            "attempt-text": lambda value: value["samples"][0]["tokenTraces"][0]["fallbackAttempts"][0].update(decodedText="changed"),
            "attempt-score": lambda value: value["samples"][0]["tokenTraces"][0]["fallbackAttempts"][0].update(score=0.5),
            "attempt-average-source": change_average_with_hash,
            "selected-index": lambda value: value["samples"][0]["tokenTraces"][0].update(selectedAttemptIndex=1),
            "silence-override": lambda value: value["samples"][0]["tokenTraces"][0]["fallbackAttempts"][0].update(silenceOverride=True),
            "unknown-trace-field": lambda value: value["samples"][0]["tokenTraces"][0].update(privateLeak="x"),
        }
        path = self.raw_dir / "medium-b5-on-vad-fallback.json"
        with mock.patch.object(publisher, "LOCAL_ROOT", self.local_root):
            for name, mutate in mutations.items():
                with self.subTest(name=name):
                    value = copy.deepcopy(raw)
                    mutate(value)
                    path.write_text(json.dumps(value), encoding="utf-8")
                    with self.assertRaises(publisher.EvidenceError):
                        publisher.validate_fallback_diagnostic_raw(
                            path, "medium-b5-on-vad-fallback", self.lock
                        )

    def test_fallback_all_failed_tie_selects_first_maximum(self) -> None:
        raw = self._fallback_raw("medium-b5-on-vad-fallback")
        averages = (-1.5, -1.4, -1.1, -1.2, -1.1, -1.25)
        attempts = []
        ratio = len(b"hello") / len(publisher.zlib.compress(b"hello"))
        for index, average in enumerate(averages):
            sampling = index > 0
            score = average * 1.5
            recomputed_average = score * 2 / 3
            attempt = {
                "temperature": publisher.FALLBACK_TEMPERATURES[index],
                "decodeMode": "sampling" if sampling else "beam",
                "beamSize": 1 if sampling else 5,
                "patience": None if sampling else 1.0,
                "numHypotheses": 5 if sampling else 1,
                "samplingTopK": 0 if sampling else None,
                "samplingTemperature": publisher.FALLBACK_TEMPERATURES[index] if sampling else None,
                "tokenIds": [100 + index * 2, 101 + index * 2],
                "score": score,
                "averageLogProbability": recomputed_average,
                "noSpeechProbability": 0.0,
                "decodedText": "hello",
                "compressionRatio": ratio,
                "compressionTriggered": False,
                "logProbabilityTriggered": True,
                "silenceOverride": False,
            }
            attempt["aggregateSha256"] = publisher.fallback_attempt_aggregate(attempt)
            attempts.append(attempt)
        trace = raw["samples"][0]["tokenTraces"][0]
        selected = attempts[2]
        trace.update({
            "tokenIds": selected["tokenIds"],
            "sha256": hashlib.sha256(
                ",".join(str(token) for token in selected["tokenIds"]).encode()
            ).hexdigest(),
            "generationCallCount": 6,
            "fallbackCallCount": 5,
            "selectedAttemptIndex": 2,
            "selectedTemperature": 1.0,
            "averageLogProbability": selected["averageLogProbability"],
            "noSpeechProbability": selected["noSpeechProbability"],
            "compressionRatio": selected["compressionRatio"],
            "fallbackAttempts": attempts,
        })
        raw["samples"][0]["generationCallCount"] = 6
        raw["samples"][0]["segments"][0]["traceSha256"] = trace["sha256"]
        path = self.raw_dir / "medium-b5-on-vad-fallback.json"
        path.write_text(json.dumps(raw), encoding="utf-8")
        with mock.patch.object(publisher, "LOCAL_ROOT", self.local_root):
            validated = publisher.validate_fallback_diagnostic_raw(
                path, "medium-b5-on-vad-fallback", self.lock
            )
        self.assertEqual(validated["fallback"]["selectedTemperatureCounts"], {"1.0": 1})

        trace["selectedAttemptIndex"] = 4
        path.write_text(json.dumps(raw), encoding="utf-8")
        with mock.patch.object(publisher, "LOCAL_ROOT", self.local_root), self.assertRaises(
            publisher.EvidenceError
        ):
            publisher.validate_fallback_diagnostic_raw(
                path, "medium-b5-on-vad-fallback", self.lock
            )

    def test_diagnostic_identity_mutations_are_rejected(self) -> None:
        raw = self._raw("short-b1-off")
        mutations = {
            "promotion": lambda value: value.update(qualificationEligible=True),
            "device": lambda value: value["runtime"].update(resolvedDevice="cpu"),
            "config": lambda value: value["config"].update(beamSize=5),
            "model": lambda value: value["model"].update(revision="drift"),
            "module": lambda value: value["runtime"]["loadedModules"].pop(),
            "cudnn": lambda value: value["runtime"]["loadedModules"].append(
                self._module("cudnn64_9.dll", "cuda-toolkit-12.8-bin")
            ),
            "trace": lambda value: value["samples"][0]["tokenTraces"][0].update(sha256=H),
        }
        with mock.patch.object(publisher, "LOCAL_ROOT", self.local_root):
            for name, mutate in mutations.items():
                with self.subTest(name=name):
                    value = copy.deepcopy(raw)
                    mutate(value)
                    path = self.raw_dir / f"mutation-{name}.json"
                    path.write_text(json.dumps(value), encoding="utf-8")
                    with self.assertRaises(publisher.EvidenceError):
                        publisher.validate_diagnostic_raw(path, "short-b1-off", self.lock)

    def test_vad_diagnostic_identity_mutations_are_rejected(self) -> None:
        raw = self._vad_raw("medium-b5-on-vad")
        mutations = {
            "promotion": lambda value: value.update(qualificationEligible=True),
            "wrong-kind": lambda value: value.update(kind=publisher.DIAGNOSTIC_KIND),
            "formal-kind": lambda value: value.update(kind=publisher.FORMAL_KIND),
            "unknown-envelope": lambda value: value.update(unexpected=True),
            "unknown-sample": lambda value: value["samples"][0].update(unexpected=True),
            "beam": lambda value: value["config"].update(beamSize=1),
            "vad-model": lambda value: value["runtime"]["vadModel"].update(sha256=H),
            "missing-ort": lambda value: value["runtime"]["loadedModules"].pop(),
            "progress": lambda value: value["samples"][0].update(progressMs=[]),
            "restoration": lambda value: value["samples"][0]["tokenTraces"][0].update(
                vadTimestampRestored=False
            ),
            "restored-time": lambda value: value["samples"][0]["segments"][0].update(
                rawStartMs=10, startMs=10
            ),
            "trace-link": lambda value: value["samples"][0]["segments"][0].update(
                traceSha256=H
            ),
        }
        with mock.patch.object(publisher, "LOCAL_ROOT", self.local_root):
            for name, mutate in mutations.items():
                with self.subTest(name=name):
                    value = copy.deepcopy(raw)
                    mutate(value)
                    path = self.raw_dir / f"vad-mutation-{name}.json"
                    path.write_text(json.dumps(value), encoding="utf-8")
                    with self.assertRaises(publisher.EvidenceError):
                        publisher.validate_vad_diagnostic_raw(
                            path, "medium-b5-on-vad", self.lock
                        )

    def test_structured_vad_diagnostic_failure_is_valid_and_ineligible(self) -> None:
        raw = self._vad_raw("medium-b5-on-vad")
        raw["status"] = "failed"
        sample = raw["samples"][0]
        sample["status"] = "failed"
        sample["failure"] = {"code": "timestamp_after_audio"}
        sample["generationCompleted"] = False
        sample["tokenTraces"][-1]["parseStatus"] = "failed"
        sample["tokenTraces"][-1]["parseError"] = "timestamp_after_audio"
        path = self.raw_dir / "medium-b5-on-vad.json"
        path.write_text(json.dumps(raw), encoding="utf-8")
        with mock.patch.object(publisher, "LOCAL_ROOT", self.local_root):
            validated = publisher.validate_vad_diagnostic_raw(
                path, "medium-b5-on-vad", self.lock
            )
        self.assertEqual(validated["status"], "failed")
        self.assertEqual(validated["failureCode"], "timestamp_after_audio")

    def test_structured_diagnostic_failure_is_valid_and_ineligible(self) -> None:
        raw = self._raw("medium-b1-on")
        raw["status"] = "failed"
        sample = raw["samples"][0]
        sample["status"] = "failed"
        sample["failure"] = {"code": "timestamp_after_audio"}
        sample["generationCompleted"] = False
        sample["tokenTraces"][-1]["parseStatus"] = "failed"
        sample["tokenTraces"][-1]["parseError"] = "timestamp_after_audio"
        path = self.raw_dir / "medium-b1-on.json"
        path.write_text(json.dumps(raw), encoding="utf-8")
        with mock.patch.object(publisher, "LOCAL_ROOT", self.local_root):
            validated = publisher.validate_diagnostic_raw(path, "medium-b1-on", self.lock)
        self.assertEqual(validated["status"], "failed")
        self.assertEqual(validated["failureCode"], "timestamp_after_audio")

    def test_publication_is_private_and_byte_deterministic(self) -> None:
        self._write_raws()
        output = self.research_root / "diagnostic.json"
        report = self.research_root / "diagnostic.md"
        manifest = publisher.REPO_ROOT / ".asr-benchmark" / "manifest.json"
        baseline = publisher.REPO_ROOT / ".trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json"
        with mock.patch.object(publisher, "RESEARCH_ROOT", self.research_root), mock.patch.object(
            publisher, "LOCAL_ROOT", self.local_root
        ):
            result = publisher.publish_diagnostic(
                self.raw_dir,
                self.lock,
                manifest,
                manifest.parent,
                baseline,
                output,
                report,
            )
            first = (output.read_bytes(), report.read_bytes())
            publisher.publish_diagnostic(
                self.raw_dir,
                self.lock,
                manifest,
                manifest.parent,
                baseline,
                output,
                report,
            )
        self.assertEqual(first, (output.read_bytes(), report.read_bytes()))
        self.assertEqual(result["selection"]["status"], "no-candidate-selected")
        self.assertNotIn("PRIVATE_TRANSCRIPT_SENTINEL_9F04", output.read_text(encoding="utf-8"))
        publisher.privacy_scan(result)

    def test_vad_publication_is_private_and_byte_deterministic(self) -> None:
        raw_dir = self.local_root / "vad-diagnostic"
        self._write_vad_raws(raw_dir)
        output = self.research_root / "vad-diagnostic.json"
        report = self.research_root / "vad-diagnostic.md"
        manifest = publisher.REPO_ROOT / ".asr-benchmark" / "manifest.json"
        baseline = publisher.REPO_ROOT / ".trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json"
        with mock.patch.object(publisher, "RESEARCH_ROOT", self.research_root), mock.patch.object(
            publisher, "LOCAL_ROOT", self.local_root
        ):
            result = publisher.publish_vad_diagnostic(
                raw_dir,
                self.lock,
                manifest,
                manifest.parent,
                baseline,
                output,
                report,
            )
            first = (output.read_bytes(), report.read_bytes())
            publisher.publish_vad_diagnostic(
                raw_dir,
                self.lock,
                manifest,
                manifest.parent,
                baseline,
                output,
                report,
            )
        self.assertEqual(first, (output.read_bytes(), report.read_bytes()))
        self.assertEqual(result["kind"], "hikaru-native-whisper-gpu-quality-vad-diagnostic")
        self.assertEqual(result["selection"]["status"], "no-candidate-selected")
        self.assertNotIn("PRIVATE_TRANSCRIPT_SENTINEL_9F04", output.read_text(encoding="utf-8"))
        publisher.privacy_scan(result)

    def test_fallback_publication_is_private_and_byte_deterministic(self) -> None:
        raw_dir = self.local_root / "fallback-diagnostic"
        raw_dir.mkdir(parents=True)
        for cell_id in publisher.FALLBACK_DIAGNOSTIC_CELLS:
            (raw_dir / f"{cell_id}.json").write_text(
                json.dumps(self._fallback_raw(cell_id)), encoding="utf-8"
            )
        output = self.research_root / "fallback-diagnostic.json"
        report = self.research_root / "fallback-diagnostic.md"
        manifest = publisher.REPO_ROOT / ".asr-benchmark" / "manifest.json"
        baseline = publisher.REPO_ROOT / ".trellis/tasks/archive/2026-08/08-18-native-asr-python-legacy-baseline/research/python-legacy-baseline.json"
        with mock.patch.object(publisher, "RESEARCH_ROOT", self.research_root), mock.patch.object(
            publisher, "LOCAL_ROOT", self.local_root
        ):
            result = publisher.publish_fallback_diagnostic(
                raw_dir, self.lock, manifest, manifest.parent, baseline, output, report
            )
            first = (output.read_bytes(), report.read_bytes())
            publisher.publish_fallback_diagnostic(
                raw_dir, self.lock, manifest, manifest.parent, baseline, output, report
            )
        self.assertEqual(first, (output.read_bytes(), report.read_bytes()))
        self.assertEqual(
            result["kind"], "hikaru-native-whisper-gpu-quality-fallback-diagnostic"
        )
        self.assertNotIn("PRIVATE_TRANSCRIPT_SENTINEL_9F04", output.read_text(encoding="utf-8"))
        publisher.privacy_scan(result)

    def test_privacy_scan_rejects_private_payloads(self) -> None:
        for value in ({"text": "private"}, {"value": r"C:\private\raw.json"}, {"value": "research/local/raw.json"}):
            with self.subTest(value=value), self.assertRaises(publisher.EvidenceError):
                publisher.privacy_scan(value)


if __name__ == "__main__":
    unittest.main()
