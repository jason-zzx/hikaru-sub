#!/usr/bin/env python3
from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

import publish_whisper_short_parity_bisect as publisher


class ShortParityPublisherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.lock_hash = "1" * 64
        self.identity = {
            "lockSha256": self.lock_hash,
            "candidateId": "short-input-runtime-parity-bisect-v1",
            "cells": list(publisher.CELLS),
            "audio": {
                "wavSha256": "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211",
                "waveformSha256": "2cbf22e7635a41cf751401525e4358c19f2d452ae99c0ced78f65b6e9327e1c2",
                "sampleCount": 385637,
                "durationMs": 24102,
                "vadExpectedInterval": [0, 385637],
            },
            "model": {"id": "Systran/faster-whisper-large-v3", "revision": "edaa", "files": []},
            "vadModel": copy.deepcopy(publisher.VAD_MODEL),
            "config": {"beamSize": 5, "upstreamGenerationFallback": True, "vad": False},
            "decodeIdentity": {
                "promptTokenIds": [50258, 50266, 50360],
                "promptSha256": "908b1562c473b2889d6ac86c6e011ec4c681f6e78c971f0d8e73424057a42ba0",
                "suppressedTokenCount": 88,
                "suppressedTokenIdsSha256": "f726" + "0" * 60,
                "beginSuppressedTokenIds": [220, 50257],
                "beginSuppressedTokenIdsSha256": "5361" + "0" * 60,
                "parser": "native-timestamp-parser-v1",
                "fallback": "faster-whisper-1.2.1-exact",
            },
            "runtimes": {},
            "vadPreflight": {
                "onnxRuntimeVersion": "1.26.0",
                "options": {
                    "threshold": 0.5,
                    "negThreshold": None,
                    "minSpeechDurationMs": 0,
                    "maxSpeechDurationS": "infinity",
                    "minSilenceDurationMs": 2000,
                    "speechPadMs": 400,
                    "windowSizeSamples": 512,
                    "contextSizeSamples": 64,
                    "providers": ["CPUExecutionProvider"],
                },
                "files": [
                    {"name": "faster_whisper/assets/silero_vad_v6.onnx", "sizeBytes": 1, "sha256": "a" * 64},
                    {"name": "faster_whisper/audio.py", "sizeBytes": 1, "sha256": "b" * 64},
                    {"name": "faster_whisper/vad.py", "sizeBytes": 1, "sha256": "c" * 64},
                    {"name": "onnxruntime/__init__.py", "sizeBytes": 1, "sha256": "d" * 64},
                    {"name": "onnxruntime/capi/onnxruntime.dll", "sizeBytes": 1, "sha256": "e" * 64},
                    {"name": "onnxruntime/capi/onnxruntime_providers_shared.dll", "sizeBytes": 1, "sha256": "f" * 64},
                    {"name": "onnxruntime/capi/onnxruntime_pybind11_state.pyd", "sizeBytes": 1, "sha256": "0" * 64},
                    {"name": "python.exe", "sizeBytes": 1, "sha256": "1" * 64},
                ],
                "loadedModules": [
                    {
                        "name": "onnxruntime_providers_shared.dll",
                        "sizeBytes": 1,
                        "sha256": "f" * 64,
                        "rootRole": "python-site-packages-onnxruntime-capi",
                    },
                    {
                        "name": "onnxruntime_pybind11_state.pyd",
                        "sizeBytes": 1,
                        "sha256": "0" * 64,
                        "rootRole": "python-site-packages-onnxruntime-capi",
                    },
                ],
                "notLoadedModules": [
                    {
                        "name": "onnxruntime.dll",
                        "sizeBytes": 1,
                        "sha256": "e" * 64,
                        "rootRole": "python-site-packages-onnxruntime-capi",
                    }
                ],
            },
        }
        self.roots = {}
        for role, token in (("python-wheel", "p"), ("native-no-cudnn", "n")):
            runtime_root = str((Path.cwd() / ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research/local" / f"fake-{role}").resolve())
            cuda_root = str((Path.cwd() / ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research/local/fake-cuda").resolve())
            system_root = str((Path.cwd() / ".trellis/tasks/08-20-native-asr-whisper-quality-revision/research/local/fake-system32").resolve())
            roots = {
                "task-local-runtime-bin": runtime_root,
                "cuda-toolkit-12.8-bin": cuda_root,
                "windows-system32": system_root,
            }
            self.roots[role] = roots
            root_hash = publisher.sha256_bytes("\n".join(
                f"{name}={roots[name]}" for name in (
                    "task-local-runtime-bin", "cuda-toolkit-12.8-bin", "windows-system32"
                )
            ).encode())
            module = {"name": f"{token}.dll", "sizeBytes": 1, "sha256": token * 64, "rootRole": "task-local-runtime-bin", "version": "1"}
            runtime_files = [
                {"name": "hikaru-asr-ctranslate2-tests.exe", "sizeBytes": 1, "sha256": "e" * 64},
                {"name": "ctranslate2.dll", "sizeBytes": 1, "sha256": token * 64},
                {
                    "name": publisher.VAD_MODEL["name"],
                    "sizeBytes": publisher.VAD_MODEL["sizeBytes"],
                    "sha256": publisher.VAD_MODEL["sha256"],
                },
            ]
            self.identity["runtimes"][role] = {
                "measurementExecutable": {"sizeBytes": 1, "sha256": "e" * 64},
                "productionWorker": {"sizeBytes": 1, "sha256": "w" * 64},
                "ctranslate2": {"sizeBytes": 1, "sha256": token * 64},
                "runtimeFiles": runtime_files,
                "requestedDevice": "cuda",
                "resolvedDevice": "cuda",
                "computeType": "float16",
                "deviceIndex": 0,
                "ctranslate2Version": "4.8.0",
                "gpu": {"name": "NVIDIA GeForce RTX 3070"},
                "pathRootIdentitySha256": root_hash,
                "loadedModules": [module],
            }

    @staticmethod
    def aggregate(text_hash: str) -> dict:
        return {
            "segmentCount": 4,
            "textSha256": text_hash,
            "timelineSha256": hashlib.sha256(b"timeline").hexdigest(),
            "timelineErrorCount": 0,
        }

    def pair(self, cell: str, tokens: list[int], python_hash: str = "a" * 64, native_hash: str = "b" * 64):
        mel_role, runtime_role = publisher.CELL_IDENTITY[cell]
        decoded_text = "x"
        score = 0.0
        average = 0.0
        ratio = len(decoded_text.encode()) / len(zlib.compress(decoded_text.encode()))
        attempt = {
            "temperature": 0.0,
            "decodeMode": "beam",
            "beamSize": 5,
            "patience": 1.0,
            "numHypotheses": 1,
            "samplingTopK": None,
            "samplingTemperature": None,
            "tokenIds": tokens,
            "score": score,
            "averageLogProbability": average,
            "noSpeechProbability": 0.0,
            "decodedText": decoded_text,
            "compressionRatio": ratio,
            "compressionTriggered": False,
            "logProbabilityTriggered": False,
            "silenceOverride": False,
            "aggregateSha256": "",
        }
        attempt["aggregateSha256"] = publisher.quality_publisher.fallback_attempt_aggregate(attempt)
        trace = {
            "windowOffsetMs": 0,
            "sourceWindowDurationMs": 24102,
            "modelWindowDurationMs": 30000,
            "seekFramesBefore": 0,
            "seekFramesAfter": 2411,
            "sourceOverlapMs": 0,
            "sourceProgressBeforeMs": 0,
            "sourceProgressAfterMs": 24102,
            "vadTimestampRestored": False,
            "promptTokenCount": 3,
            "historyTokenCountBefore": 0,
            "historyTokenCountAfter": 0,
            "prefixForwardTokenCount": 2,
            "generatedTokenCount": len(tokens),
            "featureMs": 0.0,
            "generateMs": 1.0,
            "generationCallCount": 1,
            "fallbackCallCount": 0,
            "noSpeechProbability": 0.0,
            "averageLogProbability": average,
            "skippedAsNoSpeech": False,
            "parseStatus": "source-window-end",
            "parseError": None,
            "sha256": hashlib.sha256(",".join(str(token) for token in tokens).encode()).hexdigest(),
            "tokenIds": tokens,
            "generationFallbackEnabled": True,
            "selectedAttemptIndex": 0,
            "selectedTemperature": 0.0,
            "compressionRatio": ratio,
            "fallbackAttempts": [attempt],
        }
        samples = []
        parser_rows = []
        selected_hash = publisher.canonical_hash(tokens)
        for repeat in (1, 2):
            samples.append({
                "status": "completed",
                "runKind": "short-parity",
                "repeatIndex": repeat,
                "segments": [],
                "tokenTraces": [copy.deepcopy(trace)],
                "generationCallCount": 1,
                "failure": None,
                "timings": {
                    "loadMs": 1.0 if repeat == 1 else None,
                    "sampleWallMs": 1.0,
                    "modelGenerateMs": 1.0,
                    "inferenceMs": 1.0,
                },
            })
            parser_rows.append({
                "repeatIndex": repeat,
                "selectedTokenSha256": selected_hash,
                "pythonParser": self.aggregate(python_hash),
                "nativeParser": self.aggregate(native_hash),
            })
        runtime_identity = self.identity["runtimes"][runtime_role]
        runtime = {key: copy.deepcopy(runtime_identity[key]) for key in (
            "measurementExecutable", "productionWorker", "ctranslate2", "runtimeFiles",
            "requestedDevice", "resolvedDevice", "computeType", "deviceIndex",
            "ctranslate2Version", "gpu")}
        runtime["vadModel"] = copy.deepcopy(self.identity["vadModel"])
        roots = self.roots[runtime_role]
        modules = copy.deepcopy(runtime_identity["loadedModules"])
        for module in modules:
            module["canonicalPath"] = str(Path(roots[module["rootRole"]]) / module["name"])
        runtime.update({
            "role": runtime_role,
            "pathPolicy": {
                "name": "t07-windows-cuda-restricted-path-v1",
                "restricted": True,
                "entryCount": 3,
                "orderedEntryRoles": ["task-local-runtime-bin", "cuda-toolkit-12.8-bin", "windows-system32"],
                "rootIdentitySha256": runtime_identity["pathRootIdentitySha256"],
                "resolvedRoots": [
                    {"role": role, "canonicalPath": roots[role]}
                    for role in ("task-local-runtime-bin", "cuda-toolkit-12.8-bin", "windows-system32")
                ],
            },
            "loadedModules": modules,
        })
        raw = {
            "schemaVersion": 1, "kind": "hikaru-ct2-whisper-short-parity-raw",
            "status": "completed", "qualificationEligible": False, "promotionEligible": False,
            "candidateId": "short-input-runtime-parity-bisect-v1", "cellId": cell,
            "caseId": "short-v1",
            "mel": {"producer": mel_role, "shape": [80, 3000], "dtype": "float32-le", "sizeBytes": 960000, "sha256": publisher.MEL_HASHES[mel_role]},
            "audio": copy.deepcopy(self.identity["audio"]), "model": copy.deepcopy(self.identity["model"]),
            "config": copy.deepcopy(self.identity["config"]), "decodeIdentity": copy.deepcopy(self.identity["decodeIdentity"]),
            "anchors": {"pythonParserTextSha256": publisher.PYTHON_ANCHOR, "nativeParserTextSha256": publisher.NATIVE_ANCHOR},
            "inputLockSha256": self.lock_hash, "runtime": runtime, "samples": samples, "resources": {},
        }
        parser = {
            "schemaVersion": 1,
            "kind": "hikaru-whisper-short-parity-parser-oracle",
            "status": "completed",
            "qualificationEligible": False,
            "cellId": cell,
            "rawSha256": "r" * 64,
            "tokenizerSha256": "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca",
            "tokenizerSourceSha256": "614a96b6a9660096e4f4e9fbe8860cd75ad250dce8e85a847998a3d6d48165d2",
            "transcribeSourceSha256": "5d5ffb00018561d3d529b2c72e1d9f5fff055bea725f3cccc7c6c67f5cc8ffe4",
            "tokenizersInitSha256": "510d5e23458612433da9f1fe430b5009fb88ba90508ee4340d2397b32c319080",
            "tokenizersExtensionSha256": "7acb83f5b89136597e0d14b788d82917bf2870df94575bf77e12731c4e49c4df",
            "rows": parser_rows,
        }
        return raw, parser

    def validate(self, cell: str, tokens: list[int], **kwargs):
        raw, parser = self.pair(cell, tokens, **kwargs)
        return publisher.validate_row(
            raw,
            parser,
            self.identity,
            "r" * 64,
            "o" * 64,
            copy.deepcopy(parser["rows"]),
            verify_disk=False,
        )

    def validate_pair(self, raw, parser, expected_parser_rows=None):
        if expected_parser_rows is None:
            expected_parser_rows = copy.deepcopy(parser["rows"])
        return publisher.validate_row(
            raw,
            parser,
            self.identity,
            "r" * 64,
            "o" * 64,
            expected_parser_rows,
            verify_disk=False,
        )

    def matrix(self, token_sets: list[list[int]], parser_equal: bool = False):
        rows = []
        for index, cell in enumerate(publisher.CELLS):
            python_hash = (
                publisher.PYTHON_ANCHOR
                if index == 0
                else hashlib.sha256(f"python-{index}".encode()).hexdigest()
            )
            native_hash = (
                publisher.NATIVE_ANCHOR
                if index == 3
                else hashlib.sha256(f"native-{index}".encode()).hexdigest()
            )
            if parser_equal:
                native_hash = python_hash
            rows.append(self.validate(cell, token_sets[index], python_hash=python_hash, native_hash=native_hash))
        return rows

    def vad_artifact(self) -> dict:
        expected = self.identity["vadPreflight"]
        return {
            "schemaVersion": 1,
            "kind": "hikaru-whisper-short-vad-preflight",
            "status": "completed",
            "qualificationEligible": False,
            "promotionEligible": False,
            "candidateId": "short-input-runtime-parity-bisect-v1",
            "inputLockSha256": self.lock_hash,
            "audio": {
                "wavSha256": self.identity["audio"]["wavSha256"],
                "sampleCount": 385637,
                "waveformSha256": self.identity["audio"]["waveformSha256"],
                "postVadWaveformSha256": self.identity["audio"]["waveformSha256"],
                "intervals": [{"start": 0, "end": 385637}],
            },
            "vad": {
                "algorithm": "faster-whisper-1.2.1-silero-v6-exact",
                "options": copy.deepcopy(expected["options"]),
                "files": copy.deepcopy(expected["files"]),
            },
            "runtime": {
                "pythonVersion": "3.11.15",
                "onnxRuntimeVersion": "1.26.0",
                "providers": ["CPUExecutionProvider"],
                "loadedModules": copy.deepcopy(expected["loadedModules"]),
                "notLoadedModules": copy.deepcopy(expected["notLoadedModules"]),
            },
        }

    def vad_summary(self) -> dict:
        return {
            "sha256": "v" * 64,
            "interval": [0, 385637],
            "postVadWaveformSha256": self.identity["audio"]["waveformSha256"],
            "onnxRuntimeVersion": "1.26.0",
        }

    def publication(self, rows):
        return publisher.build_publication(rows, self.lock_hash, self.vad_summary())

    def test_runtime_divergence(self):
        publication = self.publication(self.matrix([[1], [1], [2], [2]]))
        self.assertEqual(publication["disposition"], "runtime-divergence")

    def test_feature_divergence(self):
        publication = self.publication(self.matrix([[1], [2], [1], [2]]))
        self.assertEqual(publication["disposition"], "feature-divergence")

    def test_interaction_and_parser_decisions(self):
        self.assertEqual(self.publication(self.matrix([[1], [2], [3], [4]]))["disposition"], "feature-runtime-interaction")
        rows = self.matrix([[1], [1], [1], [1]])
        self.assertEqual(self.publication(rows)["disposition"], "parser-divergence")
        rows[2]["generationFingerprint"] = "f" * 64
        self.assertEqual(
            self.publication(rows)["disposition"],
            "parser-divergence",
        )

    def test_anchor_fail_closed(self):
        rows = self.matrix([[1], [1], [2], [2]])
        rows[0]["pythonParser"]["textSha256"] = "x" * 64
        self.assertEqual(self.publication(rows)["disposition"], "baseline-runtime-unresolved")
        rows = self.matrix([[1], [1], [2], [2]])
        rows[3]["nativeParser"]["textSha256"] = "x" * 64
        self.assertEqual(self.publication(rows)["disposition"], "invalid-evidence")

    def test_rejects_swapped_mel_prompt_and_vad_model_drift(self):
        raw, parser = self.pair(publisher.CELLS[0], [1])
        raw["mel"]["producer"] = "native"
        with self.assertRaises(publisher.EvidenceError):
            self.validate_pair(raw, parser)
        raw, parser = self.pair(publisher.CELLS[0], [1])
        raw["decodeIdentity"]["promptTokenIds"] = [1]
        with self.assertRaises(publisher.EvidenceError):
            self.validate_pair(raw, parser)
        for mutation in ("missing", "hash", "root"):
            raw, parser = self.pair(publisher.CELLS[0], [1])
            if mutation == "missing":
                raw["runtime"].pop("vadModel")
            elif mutation == "hash":
                raw["runtime"]["vadModel"]["sha256"] = "x" * 64
            else:
                raw["runtime"]["vadModel"]["rootRole"] = "windows-system32"
            with self.assertRaises(publisher.EvidenceError, msg=mutation):
                self.validate_pair(raw, parser)

    def test_rejects_module_set_and_root_drift(self):
        for mutation in ("missing", "additional", "hash", "version", "root"):
            raw, parser = self.pair(publisher.CELLS[0], [1])
            modules = raw["runtime"]["loadedModules"]
            if mutation == "missing": modules.clear()
            elif mutation == "additional": modules.append(copy.deepcopy(modules[0]))
            elif mutation == "hash": modules[0]["sha256"] = "x" * 64
            elif mutation == "version": modules[0]["version"] = "2"
            else: modules[0]["rootRole"] = "windows-system32"
            with self.assertRaises(publisher.EvidenceError, msg=mutation):
                self.validate_pair(raw, parser)

    def test_rejects_runtime_file_and_correlated_root_drift(self):
        raw, parser = self.pair(publisher.CELLS[0], [1])
        raw["runtime"]["runtimeFiles"].pop()
        with self.assertRaises(publisher.EvidenceError):
            self.validate_pair(raw, parser)
        raw, parser = self.pair(publisher.CELLS[0], [1])
        for root in raw["runtime"]["pathPolicy"]["resolvedRoots"]:
            root["canonicalPath"] += "-drift"
        with self.assertRaises(publisher.EvidenceError):
            self.validate_pair(raw, parser)

    def test_rejects_repeat_nondeterminism_and_parser_drift(self):
        raw, parser = self.pair(publisher.CELLS[0], [1])
        raw["samples"][1]["tokenTraces"][0]["tokenIds"] = [2]
        with self.assertRaises(publisher.EvidenceError):
            self.validate_pair(raw, parser)
        raw, parser = self.pair(publisher.CELLS[0], [1])
        expected = copy.deepcopy(parser["rows"])
        parser["rows"][1]["nativeParser"]["segmentCount"] = 9
        with self.assertRaises(publisher.EvidenceError):
            self.validate_pair(raw, parser, expected)

        raw, parser = self.pair(publisher.CELLS[0], [1])
        expected = copy.deepcopy(parser["rows"])
        parser["tokenizersExtensionSha256"] = "f" * 64
        with self.assertRaises(publisher.EvidenceError):
            self.validate_pair(raw, parser, expected)

    def test_rejects_mutable_fallback_aggregate(self):
        raw, parser = self.pair(publisher.CELLS[0], [1])
        raw["samples"][0]["tokenTraces"][0]["fallbackAttempts"][0]["aggregateSha256"] = "f" * 64
        with self.assertRaises(publisher.EvidenceError):
            self.validate_pair(raw, parser)

    def test_rejects_promotion_and_unknown_fields(self):
        raw, parser = self.pair(publisher.CELLS[0], [1])
        raw["qualificationEligible"] = True
        with self.assertRaises(publisher.EvidenceError):
            self.validate_pair(raw, parser)
        raw, parser = self.pair(publisher.CELLS[0], [1])
        raw["cer"] = 0
        with self.assertRaises(publisher.EvidenceError):
            self.validate_pair(raw, parser)

    def test_only_v5_task_lock_is_accepted(self):
        for name in (
            "gpu-short-parity-bisect-lock.md",
            "gpu-short-parity-bisect-lock-v2.md",
            "gpu-short-parity-bisect-lock-v3.md",
            "gpu-short-parity-bisect-lock-v4.md",
            "gpu-short-parity-bisect-lock-v6.md",
        ):
            with self.assertRaises(publisher.EvidenceError):
                publisher.tracked_lock(str(publisher.TASK_ROOT / name))
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(publisher.EvidenceError):
                publisher.tracked_lock(
                    str(Path(directory) / "gpu-short-parity-bisect-lock-v5.md")
                )
        self.assertEqual(
            publisher.tracked_lock(
                str(publisher.TASK_ROOT / "gpu-short-parity-bisect-lock-v5.md")
            ),
            publisher.TASK_ROOT / "gpu-short-parity-bisect-lock-v5.md",
        )

    def test_v5_lock_binds_superseded_failure_and_vad_contract(self):
        identity = {
            "candidateId": "short-input-runtime-parity-bisect-v1",
            "cells": list(publisher.CELLS),
            "supersedesLockSha256": publisher.V3_LOCK_SHA256,
            "acquisitionSupersedesLockSha256": publisher.V4_LOCK_SHA256,
            "predecessorLocks": {
                "v1": publisher.V1_LOCK_SHA256,
                "v2": publisher.V2_LOCK_SHA256,
                "v3": publisher.V3_LOCK_SHA256,
                "v4": publisher.V4_LOCK_SHA256,
            },
            "invalidPreflight": {
                "ignoredRecordSha256": publisher.V2_INVALID_RECORD_SHA256,
                "trackedReportSha256": publisher.V2_INVALID_REPORT_SHA256,
            },
            "invalidV3": {
                "ignoredRecordSha256": publisher.V3_INVALID_RECORD_SHA256,
                "trackedReportSha256": publisher.V3_INVALID_REPORT_SHA256,
            },
            "preservedV3": {
                "ortImportSmokeSha256": publisher.V3_ORT_IMPORT_SMOKE_SHA256,
                "preModelReattestationSha256": publisher.V3_REATTESTATION_SHA256,
                "completedVadPreflightSha256": publisher.V3_COMPLETED_VAD_SHA256,
            },
            "invalidV4": {
                "ignoredRecordSha256": publisher.V4_INVALID_RECORD_SHA256,
                "trackedReportSha256": publisher.V4_INVALID_REPORT_SHA256,
            },
            "preservedV4": {
                "preModelReattestationSha256": publisher.V4_REATTESTATION_SHA256,
                "noModelPreflightSha256": copy.deepcopy(
                    publisher.V4_NO_MODEL_PREFLIGHTS
                ),
            },
            "vadModel": copy.deepcopy(publisher.VAD_MODEL),
            "contracts": copy.deepcopy(publisher.V5_CONTRACTS),
        }
        with tempfile.TemporaryDirectory(dir=publisher.LOCAL_ROOT) as directory:
            path = Path(directory) / "lock.md"
            def write(value):
                path.write_text(
                    "does not authorize acquisition\n"
                    f"{publisher.LOCK_BEGIN}\n{json.dumps(value)}\n{publisher.LOCK_END}\n",
                    encoding="utf-8",
                )
            write(identity)
            self.assertEqual(publisher.load_lock(path), identity)
            for mutation in (
                "runner-supersedes", "acquisition-supersedes", "predecessor",
                "v2-invalid", "v3-invalid", "completed-vad", "v4-invalid",
                "v4-reattestation", "v4-preflight", "vad", "contract",
            ):
                value = copy.deepcopy(identity)
                if mutation == "runner-supersedes":
                    value["supersedesLockSha256"] = "x" * 64
                elif mutation == "acquisition-supersedes":
                    value["acquisitionSupersedesLockSha256"] = "x" * 64
                elif mutation == "predecessor":
                    value["predecessorLocks"]["v4"] = "x" * 64
                elif mutation == "v2-invalid":
                    value["invalidPreflight"]["ignoredRecordSha256"] = "x" * 64
                elif mutation == "v3-invalid":
                    value["invalidV3"]["ignoredRecordSha256"] = "x" * 64
                elif mutation == "completed-vad":
                    value["preservedV3"]["completedVadPreflightSha256"] = "x" * 64
                elif mutation == "v4-invalid":
                    value["invalidV4"]["ignoredRecordSha256"] = "x" * 64
                elif mutation == "v4-reattestation":
                    value["preservedV4"]["preModelReattestationSha256"] = "x" * 64
                elif mutation == "v4-preflight":
                    value["preservedV4"]["noModelPreflightSha256"][
                        "python-runtime-python-mel"
                    ] = "x" * 64
                elif mutation == "vad":
                    value["vadModel"]["sha256"] = "x" * 64
                else:
                    value["contracts"]["promotionEligible"] = True
                write(value)
                with self.assertRaises(publisher.EvidenceError, msg=mutation):
                    publisher.load_lock(path)

    def test_vad_preflight_mutations_are_rejected(self):
        base = self.vad_artifact()
        mutations = {
            "asset": lambda value: value["vad"]["files"][0].update(sha256="x" * 64),
            "source": lambda value: value["vad"]["files"][1].update(sha256="x" * 64),
            "runtime-file": lambda value: value["vad"]["files"][4].update(sha256="x" * 64),
            "interval": lambda value: value["audio"].update(intervals=[{"start": 1, "end": 385637}]),
            "waveform": lambda value: value["audio"].update(postVadWaveformSha256="x" * 64),
            "provider": lambda value: value["runtime"].update(providers=["CUDAExecutionProvider"]),
            "missing-loaded": lambda value: value["runtime"]["loadedModules"].pop(),
            "additional-loaded": lambda value: value["runtime"]["loadedModules"].append(copy.deepcopy(value["runtime"]["loadedModules"][0])),
            "loaded-hash": lambda value: value["runtime"]["loadedModules"][0].update(sha256="x" * 64),
            "loaded-root": lambda value: value["runtime"]["loadedModules"][0].update(rootRole="windows-system32"),
            "missing-not-loaded": lambda value: value["runtime"]["notLoadedModules"].clear(),
            "additional-not-loaded": lambda value: value["runtime"]["notLoadedModules"].append(copy.deepcopy(value["runtime"]["notLoadedModules"][0])),
            "not-loaded-hash": lambda value: value["runtime"]["notLoadedModules"][0].update(sha256="x" * 64),
            "not-loaded-root": lambda value: value["runtime"]["notLoadedModules"][0].update(rootRole="windows-system32"),
            "loaded-status": lambda value: value["runtime"]["notLoadedModules"].append(value["runtime"]["loadedModules"].pop()),
            "lock": lambda value: value.update(inputLockSha256="x" * 64),
            "unknown": lambda value: value.update(path="private"),
        }
        with tempfile.TemporaryDirectory(dir=publisher.LOCAL_ROOT) as directory:
            path = Path(directory) / "vad-preflight.json"
            path.write_text(json.dumps(base), encoding="utf-8")
            summary = publisher.validate_vad_preflight(path, self.identity, self.lock_hash)
            self.assertEqual(summary["interval"], [0, 385637])
            for name, mutate in mutations.items():
                value = copy.deepcopy(base)
                mutate(value)
                path.write_text(json.dumps(value), encoding="utf-8")
                with self.assertRaises(publisher.EvidenceError, msg=name):
                    publisher.validate_vad_preflight(path, self.identity, self.lock_hash)

    def test_model_and_mel_disk_identities_are_recomputed(self):
        with tempfile.TemporaryDirectory(dir=publisher.LOCAL_ROOT) as directory:
            root = Path(directory)
            model = root / "model"
            model.mkdir()
            files = []
            for name in (
                "config.json", "model.bin", "preprocessor_config.json",
                "tokenizer.json", "vocabulary.json",
            ):
                path = model / name
                path.write_bytes(name.encode())
                files.append({
                    "name": name,
                    "sizeBytes": path.stat().st_size,
                    "sha256": publisher.sha256_file(path),
                })
            python_mel = root / "python.f32"
            native_mel = root / "native.f32"
            python_mel.write_bytes(b"p" * 960000)
            native_mel.write_bytes(b"n" * 960000)
            with mock.patch.dict(publisher.MEL_HASHES, {
                "python": publisher.sha256_file(python_mel),
                "native": publisher.sha256_file(native_mel),
            }):
                tokenizer = publisher.validate_model_and_mels(
                    {"model": {"files": files}},
                    model,
                    python_mel,
                    native_mel,
                )
                self.assertEqual(tokenizer, model / "tokenizer.json")
                (model / "unexpected.txt").write_text("drift", encoding="ascii")
                with self.assertRaises(publisher.EvidenceError):
                    publisher.validate_model_and_mels(
                        {"model": {"files": files}},
                        model,
                        python_mel,
                        native_mel,
                    )

    def test_publication_is_deterministic_and_private(self):
        publication = self.publication(self.matrix([[1], [1], [2], [2]]))
        first = json.dumps(publication, ensure_ascii=True, indent=2, sort_keys=True).encode() + b"\n"
        second = json.dumps(publication, ensure_ascii=True, indent=2, sort_keys=True).encode() + b"\n"
        self.assertEqual(first, second)
        lowered = first.lower()
        for forbidden in (b'"tokenids":', b'"decodedtext":', b"c:\\", b"qualificationsource"):
            self.assertNotIn(forbidden, lowered)

        def keys(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    yield key.lower()
                    yield from keys(child)
            elif isinstance(value, list):
                for child in value:
                    yield from keys(child)

        self.assertNotIn("cer", set(keys(publication)))


if __name__ == "__main__":
    unittest.main()
