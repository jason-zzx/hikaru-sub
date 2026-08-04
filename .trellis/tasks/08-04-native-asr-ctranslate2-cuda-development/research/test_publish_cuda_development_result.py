from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

import publish_cuda_development_result as publisher

H = "1" * 64


class PublisherTests(unittest.TestCase):
    def setUp(self) -> None:
        publisher.LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=publisher.LOCAL_ROOT)
        self.root = Path(self.temp.name)
        self.module_lock = self.root / "module-lock.json"
        self.cpu_discovery = self._write("cpu-discovery.json", self._raw("short-v1", "cpu", True, 0.6))
        self.cuda_discovery = self._write("cuda-discovery.json", self._raw("short-v1", "cuda", True, 0.1))
        publisher.freeze_modules(self.cpu_discovery, self.cuda_discovery, self.module_lock)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _module(self, name: str, role: str) -> dict:
        roots = {
            "task-local-runtime-bin": r"C:\t07\runtime",
            "cuda-toolkit-12.8-bin": r"C:\cuda\bin",
            "windows-system32": r"C:\Windows\System32",
        }
        locked = publisher.EXPECTED_CUDA_MODULES.get(name.lower())
        return {
            "name": name,
            "rootRole": role,
            "canonicalPath": roots[role] + "\\" + name,
            "sizeBytes": locked[0] if locked else 100,
            "sha256": locked[1] if locked else H,
            "version": "1.0.0.0",
        }

    def _raw(self, case_id: str, device: str, discovery: bool, rtf: float) -> dict:
        duration, audio_hash = publisher.EXPECTED_CASES[case_id]
        roots = [
            {"role": "task-local-runtime-bin", "canonicalPath": r"C:\t07\runtime"},
            {"role": "cuda-toolkit-12.8-bin", "canonicalPath": r"C:\cuda\bin"},
            {"role": "windows-system32", "canonicalPath": r"C:\Windows\System32"},
        ]
        modules = [
            self._module("ctranslate2.dll", "task-local-runtime-bin"),
            self._module("hikaru-asr-ctranslate2-tests.exe", "task-local-runtime-bin"),
            self._module("hikaru_asr_tokenizer.dll", "task-local-runtime-bin"),
            self._module("vcomp140.dll", "windows-system32"),
        ]
        if device == "cuda":
            modules += [
                self._module("cublas64_12.dll", "cuda-toolkit-12.8-bin"),
                self._module("cublasLt64_12.dll", "cuda-toolkit-12.8-bin"),
                self._module("nvcuda.dll", "windows-system32"),
            ]
        count = 1 if discovery else 4
        samples = []
        for index in range(count):
            inference_ms = duration * rtf
            timings = {
                "loadMs": 10.0 if index == 0 else None,
                "sampleWallMs": inference_ms + 1.0,
                "featureMs": 1.0,
                "modelGenerateMs": inference_ms - 1.0,
                "inferenceMs": inference_ms,
                "inferenceRtf": rtf,
            }
            if index == 0:
                timings.update(processWallMs=inference_ms + 12.0, processWallRtf=(inference_ms + 12.0) / duration)
            samples.append({
                "status": "completed",
                "runKind": "module-discovery" if discovery else ("cold" if index == 0 else "warm"),
                "repeatIndex": index + 1,
                "generationCompleted": True,
                "generationCallCount": 1,
                "tokenTraces": [{"generationCallCount": 1, "sha256": H}],
                "timings": timings,
            })
        audio = {"sha256": audio_hash, "durationMs": duration, "source": None}
        if case_id == "medium-v1-first-120s":
            audio["source"] = {
                "sha256": "6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458",
                "pcmPrefixVerified": True,
            }
        return {
            "schemaVersion": 1,
            "kind": publisher.EXPECTED_KIND,
            "status": "completed",
            "qualificationEligible": False,
            "moduleDiscovery": discovery,
            "caseId": case_id,
            "engine": "faster-whisper",
            "model": {
                "id": publisher.EXPECTED_MODEL[0],
                "revision": publisher.EXPECTED_MODEL[1],
                "files": [
                    {"name": name, "sizeBytes": identity[0], "sha256": identity[1]}
                    for name, identity in publisher.EXPECTED_MODEL_FILES.items()
                ],
            },
            "audio": audio,
            "algorithm": "selected-timestamp-no-history-beam1",
            "config": copy.deepcopy(publisher.EXPECTED_CONFIG),
            "inputLockSha256": publisher.EXPECTED_INPUT_LOCK_SHA256,
            "runtime": {
                "measurementExecutable": {"sizeBytes": 100, "sha256": H},
                "productionWorker": {"sizeBytes": 10, "sha256": H},
                "requiredDlls": [
                    {"name": name, "sizeBytes": 100, "sha256": H}
                    for name in sorted(publisher.EXPECTED_RUNTIME_DLL_NAMES)
                ],
                "requestedDevice": device,
                "resolvedDevice": device,
                "computeType": "float16" if device == "cuda" else "int8",
                "deviceIndex": 0,
                "ctranslate2Version": "4.8.0",
                "cudaBuildEnabled": True,
                "cudaDynamicLoading": True,
                "withCudnn": False,
                "gpu": copy.deepcopy(publisher.EXPECTED_GPU) if device == "cuda" else None,
                "cpu": copy.deepcopy(publisher.EXPECTED_CPU),
                "pathPolicy": {
                    "name": "t07-windows-cuda-restricted-path-v1",
                    "restricted": True,
                    "entryCount": 3,
                    "orderedEntryRoles": [
                        "task-local-runtime-bin",
                        "cuda-toolkit-12.8-bin",
                        "windows-system32",
                    ],
                    "rootIdentitySha256": publisher.EXPECTED_PATH_ROOT_IDENTITY,
                    "resolvedRoots": roots,
                },
                "loadedModules": modules,
            },
            "samples": samples,
        }

    def _write(self, name: str, value: dict) -> Path:
        path = self.root / name
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def _measurement_paths(self, diagnostic_gpu_rtf: float = 0.1) -> tuple[Path, Path, Path, Path]:
        return (
            self._write("short-cpu.json", self._raw("short-v1", "cpu", False, 0.6)),
            self._write("short-cuda.json", self._raw("short-v1", "cuda", False, 0.1)),
            self._write("diagnostic-cpu.json", self._raw("medium-v1-first-120s", "cpu", False, 0.5)),
            self._write("diagnostic-cuda.json", self._raw("medium-v1-first-120s", "cuda", False, diagnostic_gpu_rtf)),
        )

    def test_ready_publication_is_byte_deterministic(self) -> None:
        paths = self._measurement_paths()
        evidence = self.root / "result.json"
        report = self.root / "report.md"
        result = publisher.publish_measurements(*paths, self.module_lock, evidence, report)
        self.assertEqual(result["developmentResult"], "development-gpu-ready")
        self.assertEqual(result["publisherSha256"], publisher._sha256(Path(publisher.__file__)))
        self.assertEqual(result["samples"]["short-v1"]["rawEvidenceSha256"]["cpu"], publisher._sha256(paths[0]))
        self.assertGreater(result["samples"]["short-v1"]["cpuColdProcessWallMs"], 0)
        first = (evidence.read_bytes(), report.read_bytes())
        publisher.publish_measurements(*paths, self.module_lock, evidence, report)
        self.assertEqual(first, (evidence.read_bytes(), report.read_bytes()))
        self.assertNotIn("segments", evidence.read_text(encoding="utf-8"))

    def test_valid_cuda_without_twenty_percent_speedup_is_no_speedup(self) -> None:
        paths = self._measurement_paths(diagnostic_gpu_rtf=0.45)
        result = publisher.publish_measurements(
            *paths,
            self.module_lock,
            self.root / "no-speedup.json",
            self.root / "no-speedup.md",
        )
        self.assertEqual(result["developmentResult"], "development-gpu-no-speedup")

    def test_measurement_identity_and_attestation_mutations_are_rejected(self) -> None:
        paths = list(self._measurement_paths())
        lock = publisher._load_json(self.module_lock)
        base = json.loads(paths[1].read_text(encoding="utf-8"))
        mutations = {
            "requested-device": lambda value: value["runtime"].update(requestedDevice="cpu"),
            "compute-type": lambda value: value["runtime"].update(computeType="int8"),
            "gpu": lambda value: value["runtime"]["gpu"].update(name="fake"),
            "shared-module": lambda value: value["runtime"]["loadedModules"][0].update(sha256="2" * 64),
            "device-module-set": lambda value: value["runtime"]["loadedModules"].pop(),
            "correlated-root": lambda value: (
                value["runtime"]["pathPolicy"].update(rootIdentitySha256="3" * 64),
                [root.update(canonicalPath="C:\\rewritten\\" + root["role"]) for root in value["runtime"]["pathPolicy"]["resolvedRoots"]],
                [module.update(canonicalPath="C:\\rewritten\\" + module["rootRole"] + "\\" + module["name"]) for module in value["runtime"]["loadedModules"]],
            ),
            "worker": lambda value: value["runtime"]["productionWorker"].update(sha256="2" * 64),
            "model": lambda value: value["model"].update(revision="drift"),
            "config": lambda value: value["config"].update(beamSize=5),
            "audio": lambda value: value["audio"].update(sha256="2" * 64),
            "repeats": lambda value: value["samples"].pop(),
            "timing": lambda value: value["samples"][1]["timings"].update(inferenceRtf=9.0),
            "cold-process-wall": lambda value: value["samples"][0]["timings"].update(processWallMs=1.0),
            "generation-trace": lambda value: value["samples"][0].update(tokenTraces=[]),
            "cudnn": lambda value: value["runtime"]["loadedModules"].append(self._module("cudnn64_9.dll", "cuda-toolkit-12.8-bin")),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                value = copy.deepcopy(base)
                mutate(value)
                path = self._write(f"mutation-{name}.json", value)
                with self.assertRaises(publisher.EvidenceError):
                    publisher._validate_measurement(path, "short-v1", "cuda", lock)

        lock_mutations = {
            "publisher": lambda value: value.update(publisherSha256="2" * 64),
            "gpu": lambda value: value["gpu"].update(name="fake"),
            "shared-module": lambda value: value["sharedModules"][0].update(sha256="2" * 64),
            "discovery": lambda value: value["discovery"].update(excludedFromMeasurement=False),
        }
        for name, mutate in lock_mutations.items():
            with self.subTest(module_lock=name):
                value = copy.deepcopy(lock)
                mutate(value)
                with self.assertRaises(publisher.EvidenceError):
                    publisher._validate_module_lock(value)

    def test_raw_path_outside_canonical_local_root_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as outside:
            path = Path(outside) / "raw.json"
            path.write_text("{}", encoding="utf-8")
            with self.assertRaises(publisher.EvidenceError):
                publisher._validate_raw(path, discovery=False)

    def test_unavailable_requires_an_eligible_failure_envelope(self) -> None:
        model = {
            "id": publisher.EXPECTED_MODEL[0],
            "revision": publisher.EXPECTED_MODEL[1],
            "files": [
                {"name": name, "sizeBytes": identity[0], "sha256": identity[1]}
                for name, identity in publisher.EXPECTED_MODEL_FILES.items()
            ],
        }
        valid = {
            "schemaVersion": 1,
            "kind": "hikaru-ct2-whisper-cuda-development-failure",
            "status": "failed",
            "failureStage": "pre-ready",
            "errorCode": "cuda_device_unavailable",
            "identity": {
                "command": publisher.FAILURE_COMMANDS["pre-ready"],
                "toolchain": publisher.EXPECTED_FAILURE_TOOLCHAIN,
                "runtime": publisher.EXPECTED_FAILURE_RUNTIME,
                "inputLockSha256": publisher.EXPECTED_INPUT_LOCK_SHA256,
            },
            "preReady": {
                "requestedDevice": "cuda",
                "readyEmitted": False,
                "structuredError": True,
                "worker": {"sizeBytes": 10, "sha256": H},
                "model": model,
            },
        }
        path = self._write("unavailable.json", valid)
        result = publisher.publish_unavailable(path, self.root / "unavailable-result.json", self.root / "unavailable.md")
        self.assertEqual(result["developmentResult"], "development-gpu-unavailable")
        mutations = {
            "ineligible-code": lambda value: value.update(errorCode="cuda_not_built"),
            "identity": lambda value: value["identity"].update(runtime="drift"),
            "ready-emitted": lambda value: value["preReady"].update(readyEmitted=True),
            "model": lambda value: value["preReady"]["model"].update(revision="drift"),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                invalid = copy.deepcopy(valid)
                mutate(invalid)
                with self.assertRaises(publisher.EvidenceError):
                    publisher.publish_unavailable(
                        self._write(f"invalid-unavailable-{name}.json", invalid),
                        self.root / f"invalid-{name}.json",
                        self.root / f"invalid-{name}.md",
                    )

        configure = copy.deepcopy(valid)
        configure.update(
            failureStage="configure",
            errorCode="cuda_configure_failed",
            identity={
                **valid["identity"],
                "command": publisher.FAILURE_COMMANDS["configure"],
            },
        )
        configure.pop("preReady")
        result = publisher.publish_unavailable(
            self._write("configure-unavailable.json", configure),
            self.root / "configure-result.json",
            self.root / "configure.md",
        )
        self.assertEqual(result["developmentResult"], "development-gpu-unavailable")


if __name__ == "__main__":
    unittest.main()
