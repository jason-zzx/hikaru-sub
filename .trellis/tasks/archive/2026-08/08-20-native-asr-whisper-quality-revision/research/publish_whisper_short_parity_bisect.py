#!/usr/bin/env python3
"""Validate and publish the promotion-ineligible short Mel/runtime parity bisect."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import publish_whisper_gpu_quality as quality_publisher

TASK_ROOT = Path(__file__).resolve().parent
LOCAL_ROOT = (TASK_ROOT / "local").resolve()
LOCK_BEGIN = "<!-- SHORT-PARITY-IDENTITY:BEGIN -->"
LOCK_END = "<!-- SHORT-PARITY-IDENTITY:END -->"
CELLS = (
    "python-runtime-python-mel",
    "python-runtime-native-mel",
    "native-runtime-python-mel",
    "native-runtime-native-mel",
)
CELL_IDENTITY = {
    "python-runtime-python-mel": ("python", "python-wheel"),
    "python-runtime-native-mel": ("native", "python-wheel"),
    "native-runtime-python-mel": ("python", "native-no-cudnn"),
    "native-runtime-native-mel": ("native", "native-no-cudnn"),
}
MEL_HASHES = {
    "python": "51209b71c3450718055dfad8a3d5923283dd95d702d606b0bdf56aac53218aa9",
    "native": "c2fc425ae691a4b1f9acd92580061ad97df82e01165747d761653f87634b9e08",
}
PYTHON_ANCHOR = "4ae70515a50f3e7368655a021c94e5db7edaa05372a02d14c93bf77dc1837de0"
NATIVE_ANCHOR = "d5eb90a205337e242dbcfd2752f2173adbff50a5178219365b9c10894b82479c"
FALLBACK_TEMPERATURES = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)
V1_LOCK_SHA256 = "470f9e0fba8cb0bc837660eae4173635bcc86212bea83324a02c0953d9c36793"
V2_LOCK_SHA256 = "481c17cc99d84071bfaf6aaad10222d2848e09416f0b29552e97fa7d42819543"
V3_LOCK_SHA256 = "62ef486a9f54d62d3f78504fc293a1917e59746d85cf09a73422edc2c384e42f"
V4_LOCK_SHA256 = "e38e23f5fc28405ffb2554324b2967c077d6eeda46b010ec51aac5bece378ff8"
V2_INVALID_RECORD_SHA256 = "5c287a6b7b252284466379873bb4e2a237fda1dc0a1babc551583757ff3fc118"
V2_INVALID_REPORT_SHA256 = "86b7cfcde55d46848ec4003feadfff9b61c7e72e5cbca8eb0bd6658fe137b78d"
V3_INVALID_RECORD_SHA256 = "808dd23c1f69e395bd759aad183e04e6b32e8c354a54f151b64c001e22882132"
V3_INVALID_REPORT_SHA256 = "1571773487cfe39fbf33daa149e030b29c257b3dca2760c0056604a46f79509d"
V3_ORT_IMPORT_SMOKE_SHA256 = "3e3bbbff2aa438a662fb2a2380d6efe688072aebf7dc43a4f07a7d8ca25623e4"
V3_REATTESTATION_SHA256 = "ad48d75a8a85d4cdf6090cde10b4280653362d91b9876d4b754fb6e9478b38e8"
V3_COMPLETED_VAD_SHA256 = "f7201eef4c0e912eb181291038f66942d218ef7fb5e14ff86a0783f62a447246"
V4_INVALID_RECORD_SHA256 = "47299ae4a7d52b818dae72afa4e69f429e8ddd4e8a8a561ff5a96d0d894013c0"
V4_INVALID_REPORT_SHA256 = "01d1279f18d8794bf814bffa8620ac1ec3efc0b975b8a4b44a7086a24d0a3de4"
V4_REATTESTATION_SHA256 = "385353870ebba5d20c894daf595e80f735ff95d0e629992a7dc52c2fde46b5ef"
V4_NO_MODEL_PREFLIGHTS = {
    "python-runtime-python-mel": "e8b888fbaad6e3350867110a5b0d06f6844279cce11d05d0225952513c4a15a2",
    "python-runtime-native-mel": "9363ba44922fcefce3a537f4121a3831da14bab80f0fb3f8606da79bdc281cda",
    "native-runtime-python-mel": "c9eb1e3656ee6b662e82f71ed2da7c36118fecb167e82823d11290e8f9e74fc7",
    "native-runtime-native-mel": "03942aad9960e4945979a1c77128d07d8a43b295c3b17e02ec38573bcf44b7c7",
}
V5_CONTRACTS = {
    "qualificationEligible": False,
    "promotionEligible": False,
    "privacy": "aggregate-identities-only-no-text-tokens-absolute-paths-or-model-bytes",
    "decisionDispositions": [
        "runtime-divergence",
        "feature-divergence",
        "feature-runtime-interaction",
        "parser-divergence",
        "no-divergence",
        "baseline-runtime-unresolved",
        "invalid-evidence",
    ],
    "noModelStopBoundary": {
        "vadInference": False,
        "asrModelConstruction": False,
        "encode": False,
        "generate": False,
        "parityCells": 0,
        "parserPublication": False,
    },
}
VAD_MODEL = {
    "name": "silero_vad_v6.onnx",
    "sizeBytes": 1245151,
    "sha256": "4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2",
    "rootRole": "task-local-runtime-bin",
}
RAW_KEYS = {
    "schemaVersion", "kind", "status", "qualificationEligible", "promotionEligible",
    "candidateId", "cellId", "caseId", "mel", "audio", "model", "config",
    "decodeIdentity", "anchors", "inputLockSha256", "runtime", "samples", "resources",
}


class EvidenceError(ValueError):
    pass


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode()


def canonical_hash(value: Any) -> str:
    return sha256_bytes(canonical_bytes(value))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvidenceError(message)


def require_disk_identity(
    path: Path,
    expected: dict[str, Any],
    label: str,
) -> None:
    require(
        path.is_file()
        and set(expected) == {"sizeBytes", "sha256"}
        and path.stat().st_size == expected["sizeBytes"]
        and sha256_file(path) == expected["sha256"],
        f"{label} identity drifted",
    )


def validate_tool_identity(identity: dict[str, Any]) -> None:
    tools = identity.get("tools")
    require(isinstance(tools, dict), "tool identity set is missing")
    require_disk_identity(
        Path(__file__).resolve(), tools.get("publisher", {}), "parity publisher"
    )
    require_disk_identity(
        Path(quality_publisher.__file__).resolve(),
        tools.get("qualityPublisher", {}),
        "quality publisher",
    )
    require_disk_identity(
        (TASK_ROOT / "whisper_short_parser_oracle.py").resolve(),
        tools.get("parserOracle", {}),
        "parser oracle",
    )
    require_disk_identity(
        (TASK_ROOT / "whisper_short_vad_preflight.py").resolve(),
        tools.get("vadPreflightTool", {}),
        "VAD preflight tool",
    )
    require_disk_identity(
        (TASK_ROOT / "test_whisper_short_vad_preflight_lock.py").resolve(),
        tools.get("vadPreflightLockTests", {}),
        "VAD preflight lock tests",
    )
    require_disk_identity(
        Path(sys.executable).resolve(),
        tools.get("pythonExecutable", {}),
        "oracle interpreter",
    )
    site_packages = (
        Path(sys.executable).resolve().parent.parent / "Lib" / "site-packages"
    )
    require_disk_identity(
        site_packages / "tokenizers" / "__init__.py",
        tools.get("tokenizersInit", {}),
        "tokenizers package",
    )
    require_disk_identity(
        site_packages / "tokenizers" / "tokenizers.pyd",
        tools.get("tokenizersExtension", {}),
        "tokenizers native extension",
    )


def validate_vad_disk_identity(identity: dict[str, Any]) -> None:
    expected = identity.get("vadPreflight", {}).get("files")
    require(isinstance(expected, list), "VAD disk identity set is missing")
    site_packages = Path(sys.executable).resolve().parent.parent / "Lib" / "site-packages"
    paths = {
        "python.exe": Path(sys.executable).resolve(),
        "faster_whisper/audio.py": site_packages / "faster_whisper" / "audio.py",
        "faster_whisper/vad.py": site_packages / "faster_whisper" / "vad.py",
        "faster_whisper/assets/silero_vad_v6.onnx": site_packages / "faster_whisper" / "assets" / "silero_vad_v6.onnx",
        "onnxruntime/__init__.py": site_packages / "onnxruntime" / "__init__.py",
        "onnxruntime/capi/onnxruntime_pybind11_state.pyd": site_packages / "onnxruntime" / "capi" / "onnxruntime_pybind11_state.pyd",
        "onnxruntime/capi/onnxruntime.dll": site_packages / "onnxruntime" / "capi" / "onnxruntime.dll",
        "onnxruntime/capi/onnxruntime_providers_shared.dll": site_packages / "onnxruntime" / "capi" / "onnxruntime_providers_shared.dll",
    }
    expected_by_name = {item.get("name"): item for item in expected}
    require(set(expected_by_name) == set(paths), "VAD disk file set drifted")
    asset = expected_by_name["faster_whisper/assets/silero_vad_v6.onnx"]
    require(
        asset.get("sizeBytes") == VAD_MODEL["sizeBytes"]
        and asset.get("sha256") == VAD_MODEL["sha256"]
        and identity.get("vadModel") == VAD_MODEL,
        "VAD model lock/disk identity drifted",
    )
    for name, path in paths.items():
        require_disk_identity(
            path,
            {key: expected_by_name[name].get(key) for key in ("sizeBytes", "sha256")},
            name,
        )


def validate_model_and_mels(
    identity: dict[str, Any],
    model_root: Path,
    python_mel: Path,
    native_mel: Path,
) -> Path:
    require(model_root.is_dir(), "model root is missing")
    expected_files = identity.get("model", {}).get("files")
    require(isinstance(expected_files, list), "model file identity set is missing")
    expected_names = {item.get("name") for item in expected_files}
    require(
        expected_names
        == {"config.json", "model.bin", "preprocessor_config.json", "tokenizer.json", "vocabulary.json"}
        and {path.name for path in model_root.iterdir() if path.is_file()} == expected_names,
        "model root file set drifted",
    )
    for expected in expected_files:
        require_disk_identity(
            model_root / expected["name"],
            {key: expected[key] for key in ("sizeBytes", "sha256")},
            f"model file {expected['name']}",
        )
    for role, path in (("python", python_mel), ("native", native_mel)):
        require(
            path.resolve().is_relative_to(LOCAL_ROOT)
            and path.is_file()
            and path.stat().st_size == 960000
            and sha256_file(path) == MEL_HASHES[role],
            f"{role} Mel disk identity drifted",
        )
    return model_root / "tokenizer.json"


def validate_vad_preflight(
    path: Path,
    identity: dict[str, Any],
    lock_sha256: str,
) -> dict[str, Any]:
    require(path.is_relative_to(LOCAL_ROOT) and path.is_file(), "VAD preflight must stay below research/local")
    value = json.loads(path.read_text(encoding="utf-8"))
    expected = identity.get("vadPreflight")
    require(isinstance(expected, dict), "VAD preflight lock identity is missing")
    require(set(value) == {
        "schemaVersion", "kind", "status", "qualificationEligible",
        "promotionEligible", "candidateId", "inputLockSha256", "audio",
        "vad", "runtime",
    }, "VAD preflight top-level fields drifted")
    require(
        value.get("schemaVersion") == 1
        and value.get("kind") == "hikaru-whisper-short-vad-preflight"
        and value.get("status") == "completed"
        and value.get("qualificationEligible") is False
        and value.get("promotionEligible") is False
        and value.get("candidateId") == "short-input-runtime-parity-bisect-v1"
        and value.get("inputLockSha256") == lock_sha256,
        "VAD preflight envelope drifted",
    )
    audio = value.get("audio")
    require(isinstance(audio, dict) and set(audio) == {
        "wavSha256", "sampleCount", "waveformSha256",
        "postVadWaveformSha256", "intervals",
    }, "VAD preflight audio fields drifted")
    expected_audio = identity["audio"]
    require(
        audio.get("wavSha256") == expected_audio["wavSha256"]
        and audio.get("sampleCount") == expected_audio["sampleCount"]
        and audio.get("waveformSha256") == expected_audio["waveformSha256"]
        and audio.get("postVadWaveformSha256") == expected_audio["waveformSha256"]
        and audio.get("intervals") == [{
            "start": expected_audio["vadExpectedInterval"][0],
            "end": expected_audio["vadExpectedInterval"][1],
        }],
        "VAD preflight waveform/interval drifted",
    )
    vad = value.get("vad")
    require(isinstance(vad, dict) and set(vad) == {"algorithm", "options", "files"}, "VAD preflight identity fields drifted")
    require(
        vad.get("algorithm") == "faster-whisper-1.2.1-silero-v6-exact"
        and vad.get("options") == expected.get("options")
        and vad.get("files") == expected.get("files"),
        "VAD preflight asset/source identity drifted",
    )
    runtime = value.get("runtime")
    require(isinstance(runtime, dict) and set(runtime) == {
        "pythonVersion", "onnxRuntimeVersion", "providers", "loadedModules",
        "notLoadedModules",
    }, "VAD preflight runtime fields drifted")
    require(
        runtime.get("pythonVersion") == "3.11.15"
        and runtime.get("onnxRuntimeVersion") == expected.get("onnxRuntimeVersion")
        and runtime.get("providers") == ["CPUExecutionProvider"]
        and runtime.get("loadedModules") == expected.get("loadedModules")
        and runtime.get("notLoadedModules") == expected.get("notLoadedModules"),
        "VAD preflight runtime identity drifted",
    )
    return {
        "sha256": sha256_file(path),
        "interval": expected_audio["vadExpectedInterval"],
        "postVadWaveformSha256": audio["postVadWaveformSha256"],
        "onnxRuntimeVersion": runtime["onnxRuntimeVersion"],
    }


def local_file(value: str) -> Path:
    path = Path(value).resolve()
    require(path.is_relative_to(LOCAL_ROOT) and path.is_file(), "raw inputs must be files below research/local")
    return path


def tracked_lock(value: str) -> Path:
    path = Path(value).resolve()
    require(
        path == TASK_ROOT / "gpu-short-parity-bisect-lock-v5.md" and path.is_file(),
        "input lock must be the exact reviewed v5 task research file",
    )
    return path


def output_file(value: str, expected_name: str) -> Path:
    path = Path(value).resolve()
    require(
        path.parent == TASK_ROOT and path.name == expected_name,
        "publication path/name drifted",
    )
    return path


def load_lock(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    require("does not authorize acquisition" in text, "lock lacks the model-load stop boundary")
    match = re.search(re.escape(LOCK_BEGIN) + r"\s*(\{.*?\})\s*" + re.escape(LOCK_END), text, re.S)
    require(match is not None, "lock identity block is missing")
    identity = json.loads(match.group(1))
    require(identity.get("candidateId") == "short-input-runtime-parity-bisect-v1", "lock candidate drifted")
    require(tuple(identity.get("cells", [])) == CELLS, "lock cell matrix drifted")
    require(
        identity.get("supersedesLockSha256") == V3_LOCK_SHA256
        and identity.get("acquisitionSupersedesLockSha256") == V4_LOCK_SHA256
        and identity.get("predecessorLocks") == {
            "v1": V1_LOCK_SHA256,
            "v2": V2_LOCK_SHA256,
            "v3": V3_LOCK_SHA256,
            "v4": V4_LOCK_SHA256,
        }
        and identity.get("invalidPreflight") == {
            "ignoredRecordSha256": V2_INVALID_RECORD_SHA256,
            "trackedReportSha256": V2_INVALID_REPORT_SHA256,
        }
        and identity.get("invalidV3") == {
            "ignoredRecordSha256": V3_INVALID_RECORD_SHA256,
            "trackedReportSha256": V3_INVALID_REPORT_SHA256,
        }
        and identity.get("preservedV3") == {
            "ortImportSmokeSha256": V3_ORT_IMPORT_SMOKE_SHA256,
            "preModelReattestationSha256": V3_REATTESTATION_SHA256,
            "completedVadPreflightSha256": V3_COMPLETED_VAD_SHA256,
        }
        and identity.get("invalidV4") == {
            "ignoredRecordSha256": V4_INVALID_RECORD_SHA256,
            "trackedReportSha256": V4_INVALID_REPORT_SHA256,
        }
        and identity.get("preservedV4") == {
            "preModelReattestationSha256": V4_REATTESTATION_SHA256,
            "noModelPreflightSha256": V4_NO_MODEL_PREFLIGHTS,
        },
        "v5 predecessor/evidence identity drifted",
    )
    require(identity.get("vadModel") == VAD_MODEL, "v5 VAD model contract drifted")
    require(identity.get("contracts") == V5_CONTRACTS, "v5 stop/privacy/promotion contract drifted")
    return identity


def module_key(module: dict[str, Any]) -> tuple[Any, ...]:
    return (
        module.get("name", "").lower(),
        module.get("sizeBytes"),
        module.get("sha256"),
        module.get("rootRole"),
        module.get("version", ""),
    )


def disk_file_identity(path: Path) -> dict[str, Any]:
    require(path.is_file(), f"runtime file is missing: {path.name}")
    return {
        "name": path.name,
        "sizeBytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def validate_path_policy(
    policy: Any,
    expected_root_hash: str,
    runtime_role: str,
    *,
    verify_disk: bool = True,
) -> dict[str, Path]:
    require(isinstance(policy, dict), "PATH policy is missing")
    require(set(policy) == {
        "name", "restricted", "entryCount", "orderedEntryRoles",
        "rootIdentitySha256", "resolvedRoots",
    }, "PATH policy fields drifted")
    roles = ["task-local-runtime-bin", "cuda-toolkit-12.8-bin", "windows-system32"]
    require(
        policy.get("name") == "t07-windows-cuda-restricted-path-v1"
        and policy.get("restricted") is True
        and policy.get("entryCount") == 3
        and policy.get("orderedEntryRoles") == roles,
        "PATH policy contract drifted",
    )
    resolved = policy.get("resolvedRoots")
    require(isinstance(resolved, list) and len(resolved) == 3, "PATH root matrix drifted")
    roots: dict[str, Path] = {}
    for expected_role, root in zip(roles, resolved, strict=True):
        require(
            isinstance(root, dict)
            and set(root) == {"role", "canonicalPath"}
            and root.get("role") == expected_role
            and isinstance(root.get("canonicalPath"), str)
            and Path(root["canonicalPath"]).is_absolute(),
            "PATH resolved root drifted",
        )
        roots[expected_role] = Path(root["canonicalPath"]).resolve()
    expected_runtime = (
        LOCAL_ROOT
        / "parity"
        / ("runtime-python" if runtime_role == "python-wheel" else "runtime-native")
        / "bin"
    ).resolve()
    expected_cuda = (Path(os.environ.get("CUDA_PATH", "")) / "bin").resolve()
    expected_system = (Path(os.environ.get("SystemRoot", "")) / "System32").resolve()
    if verify_disk:
        require(
            roots["task-local-runtime-bin"] == expected_runtime
            and roots["cuda-toolkit-12.8-bin"] == expected_cuda
            and roots["windows-system32"] == expected_system
            and all(root.is_dir() for root in roots.values()),
            "PATH resolved root does not match the frozen local layout",
        )
    identity = "\n".join(f"{role}={roots[role]}" for role in roles)
    require(
        policy.get("rootIdentitySha256") == expected_root_hash
        and sha256_bytes(identity.encode()) == expected_root_hash,
        "PATH root identity drifted",
    )
    return roots


def validate_runtime_files(
    actual: Any,
    expected: list[dict[str, Any]],
    runtime_root: Path,
    *,
    verify_disk: bool = True,
) -> None:
    require(isinstance(actual, list) and all(isinstance(item, dict) for item in actual), "runtime file inventory is invalid")
    key = lambda item: (item.get("name", "").lower(), item.get("sizeBytes"), item.get("sha256"))
    require(len(actual) == len(expected) and sorted(map(key, actual)) == sorted(map(key, expected)), "runtime file exact set drifted")
    require(all(set(item) == {"name", "sizeBytes", "sha256"} for item in actual), "runtime file fields drifted")
    if verify_disk:
        disk_entries = list(runtime_root.iterdir())
        disk_files = sorted(
            (disk_file_identity(path) for path in disk_entries),
            key=lambda item: item["name"].lower(),
        )
        require(
            all(path.is_file() for path in disk_entries)
            and sorted(map(key, disk_files)) == sorted(map(key, expected)),
            "runtime root disk file set drifted",
        )


def validate_modules(
    actual: Any,
    expected: list[dict[str, Any]],
    roots: dict[str, Path],
    *,
    verify_disk: bool = True,
) -> None:
    require(isinstance(actual, list) and all(isinstance(item, dict) for item in actual), "loaded module inventory is invalid")
    require(len(actual) == len(expected), "loaded module cardinality drifted")
    require(sorted(map(module_key, actual)) == sorted(map(module_key, expected)), "loaded module exact set drifted")
    for module in actual:
        require(set(module) == {
            "name", "sizeBytes", "sha256", "version", "rootRole", "canonicalPath",
        }, "loaded module fields drifted")
        role = module.get("rootRole")
        path = Path(module.get("canonicalPath", "")).resolve()
        require(
            role in roots
            and path.is_absolute()
            and path.name.lower() == module.get("name", "").lower()
            and path.parent == roots[role],
            "loaded module escaped its frozen root",
        )
        if verify_disk:
            require(
                path.is_file()
                and path.stat().st_size == module.get("sizeBytes")
                and sha256_file(path) == module.get("sha256"),
                "loaded module disk identity drifted",
            )


def generation_fingerprint(trace: dict[str, Any]) -> dict[str, Any]:
    try:
        _, failed, fallback_summary = quality_publisher._validate_trace(
            trace, None, fallback=True
        )
    except quality_publisher.EvidenceError as error:
        raise EvidenceError(f"fallback trace invalid: {error}") from error
    require(not failed and fallback_summary is not None, "fallback trace is incomplete")
    attempts = trace["fallbackAttempts"]
    selected_index = trace["selectedAttemptIndex"]
    selected_tokens = trace["tokenIds"]
    first = attempts[0]
    vector = [{
        "temperature": attempt["temperature"],
        "decodeMode": attempt["decodeMode"],
        "beamSize": attempt["beamSize"],
        "patience": attempt["patience"],
        "numHypotheses": attempt["numHypotheses"],
        "samplingTopK": attempt["samplingTopK"],
        "samplingTemperature": attempt["samplingTemperature"],
        "tokenSha256": canonical_hash(attempt["tokenIds"]),
        "aggregateSha256": attempt["aggregateSha256"],
        "compressionTriggered": attempt["compressionTriggered"],
        "logProbabilityTriggered": attempt["logProbabilityTriggered"],
        "silenceOverride": attempt["silenceOverride"],
    } for attempt in attempts]
    selected_hash = canonical_hash(selected_tokens)
    fingerprint = canonical_hash({
        "firstAttemptTokenSha256": canonical_hash(first["tokenIds"]),
        "orderedFallbackDecisionVector": vector,
        "selectedAttemptIndex": selected_index,
        "selectedTemperature": trace["selectedTemperature"],
        "selectedTokenSha256": selected_hash,
    })
    return {
        "generationFingerprint": fingerprint,
        "selectedTokenSha256": selected_hash,
        "firstAttempt": {
            "tokenCount": len(first["tokenIds"]),
            "tokenSha256": canonical_hash(first["tokenIds"]),
            "averageLogProbability": first["averageLogProbability"],
            "noSpeechProbability": first["noSpeechProbability"],
            "decodedTextSha256": sha256_bytes(first["decodedText"].encode("utf-8")),
            "aggregateSha256": first["aggregateSha256"],
        },
        "fallback": fallback_summary,
    }


def validate_parser(
    parser: dict[str, Any],
    raw_hash: str,
    cell: str,
    expected_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    require(set(parser) == {
        "schemaVersion", "kind", "status", "qualificationEligible", "cellId",
        "rawSha256", "tokenizerSha256", "tokenizerSourceSha256",
        "transcribeSourceSha256", "tokenizersInitSha256",
        "tokenizersExtensionSha256", "rows",
    }, "parser top-level fields drifted")
    require(
        parser.get("schemaVersion") == 1
        and parser.get("kind") == "hikaru-whisper-short-parity-parser-oracle",
        "parser schema drifted",
    )
    require(parser.get("status") == "completed" and parser.get("qualificationEligible") is False, "parser eligibility drifted")
    require(parser.get("cellId") == cell and parser.get("rawSha256") == raw_hash, "parser/raw identity drifted")
    require(
        parser.get("tokenizerSha256") == "6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca"
        and parser.get("tokenizerSourceSha256") == "614a96b6a9660096e4f4e9fbe8860cd75ad250dce8e85a847998a3d6d48165d2"
        and parser.get("transcribeSourceSha256") == "5d5ffb00018561d3d529b2c72e1d9f5fff055bea725f3cccc7c6c67f5cc8ffe4"
        and parser.get("tokenizersInitSha256") == "510d5e23458612433da9f1fe430b5009fb88ba90508ee4340d2397b32c319080"
        and parser.get("tokenizersExtensionSha256") == "7acb83f5b89136597e0d14b788d82917bf2870df94575bf77e12731c4e49c4df",
        "parser source identity drifted",
    )
    rows = parser.get("rows")
    require(rows == expected_rows, "parser aggregates do not recompute from raw evidence")
    require(isinstance(rows, list) and len(rows) == 2, "parser repeat matrix drifted")
    require([row.get("repeatIndex") for row in rows] == [1, 2], "parser repeat roles drifted")
    for row in rows:
        require(set(row) == {
            "repeatIndex", "selectedTokenSha256", "pythonParser", "nativeParser",
        }, "parser row fields drifted")
        for parser_name in ("pythonParser", "nativeParser"):
            aggregate = row.get(parser_name)
            require(isinstance(aggregate, dict), "parser aggregate is missing")
            require(set(aggregate) == {"segmentCount", "textSha256", "timelineSha256", "timelineErrorCount"}, "parser aggregate fields drifted")
            require(
                type(aggregate["segmentCount"]) is int
                and aggregate["segmentCount"] >= 0
                and type(aggregate["timelineErrorCount"]) is int
                and aggregate["timelineErrorCount"] >= 0
                and re.fullmatch(r"[0-9a-f]{64}", aggregate["textSha256"] or "")
                and re.fullmatch(r"[0-9a-f]{64}", aggregate["timelineSha256"] or ""),
                "parser aggregate value drifted",
            )
    return rows


def validate_row(
    raw: dict[str, Any],
    parser: dict[str, Any],
    identity: dict[str, Any],
    raw_hash: str,
    parser_hash: str,
    expected_parser_rows: list[dict[str, Any]],
    *,
    verify_disk: bool = True,
) -> dict[str, Any]:
    require(set(raw) == RAW_KEYS, "raw top-level fields drifted")
    cell = raw.get("cellId")
    require(cell in CELL_IDENTITY, "unknown parity cell")
    mel_role, runtime_role = CELL_IDENTITY[cell]
    require(raw.get("schemaVersion") == 1 and raw.get("kind") == "hikaru-ct2-whisper-short-parity-raw", "raw schema drifted")
    require(raw.get("status") == "completed", "failed/incomplete parity row is unscored")
    require(raw.get("qualificationEligible") is False and raw.get("promotionEligible") is False, "parity row became promotion eligible")
    require(raw.get("candidateId") == "short-input-runtime-parity-bisect-v1" and raw.get("caseId") == "short-v1", "candidate/case drifted")
    require(raw.get("inputLockSha256") == identity["lockSha256"], "row lock identity drifted")

    mel = raw.get("mel", {})
    require(mel == {"producer": mel_role, "shape": [80, 3000], "dtype": "float32-le", "sizeBytes": 960000, "sha256": MEL_HASHES[mel_role]}, "cell/Mel mapping drifted")
    require(raw.get("audio") == identity["audio"], "waveform/VAD identity drifted")
    require(raw.get("model") == identity["model"], "model identity drifted")
    require(raw.get("config") == identity["config"], "decode config drifted")
    require(raw.get("decodeIdentity") == identity["decodeIdentity"], "prompt/suppression/parser identity drifted")
    require(raw.get("anchors") == {"pythonParserTextSha256": PYTHON_ANCHOR, "nativeParserTextSha256": NATIVE_ANCHOR}, "anchor role drifted")

    runtime = raw.get("runtime", {})
    expected_runtime = identity["runtimes"][runtime_role]
    require(set(runtime) == {
        "role", "measurementExecutable", "productionWorker", "ctranslate2",
        "runtimeFiles", "vadModel", "requestedDevice", "resolvedDevice",
        "computeType", "deviceIndex", "ctranslate2Version", "gpu",
        "pathPolicy", "loadedModules",
    }, "runtime fields drifted")
    require(runtime.get("role") == runtime_role, "cell/runtime mapping drifted")
    require(runtime.get("vadModel") == identity["vadModel"], "runtime VAD model identity drifted")
    for key in ("measurementExecutable", "productionWorker", "ctranslate2", "requestedDevice", "resolvedDevice", "computeType", "deviceIndex", "ctranslate2Version", "gpu"):
        require(runtime.get(key) == expected_runtime[key], f"runtime {key} drifted")
    roots = validate_path_policy(
        runtime.get("pathPolicy"),
        expected_runtime["pathRootIdentitySha256"],
        runtime_role,
        verify_disk=verify_disk,
    )
    validate_runtime_files(
        runtime.get("runtimeFiles"),
        expected_runtime["runtimeFiles"],
        roots["task-local-runtime-bin"],
        verify_disk=verify_disk,
    )
    validate_modules(
        runtime.get("loadedModules"),
        expected_runtime["loadedModules"],
        roots,
        verify_disk=verify_disk,
    )

    samples = raw.get("samples")
    require(isinstance(samples, list) and len(samples) == 2, "two-repeat parity matrix drifted")
    require([sample.get("repeatIndex") for sample in samples] == [1, 2], "repeat roles drifted")
    parser_rows = validate_parser(
        parser, raw_hash, cell, expected_parser_rows
    )
    generations = []
    for sample, parser_row in zip(samples, parser_rows, strict=True):
        require(set(sample) == {
            "status", "runKind", "repeatIndex", "segments", "tokenTraces",
            "generationCallCount", "failure", "timings",
        }, "sample fields drifted")
        require(
            sample.get("status") == "completed"
            and sample.get("runKind") == "short-parity"
            and sample.get("failure") is None,
            "failed or mislabelled parity sample is unscored",
        )
        traces = sample.get("tokenTraces")
        require(isinstance(traces, list) and len(traces) == 1, "short parity trace cardinality drifted")
        generation = generation_fingerprint(traces[0])
        require(
            sample.get("generationCallCount") == traces[0].get("generationCallCount"),
            "sample generation-call summary drifted",
        )
        require(parser_row.get("selectedTokenSha256") == generation["selectedTokenSha256"], "parser selected token identity drifted")
        generations.append(generation)
    require(generations[0] == generations[1], "same-cell generation is nondeterministic")
    require(parser_rows[0]["pythonParser"] == parser_rows[1]["pythonParser"] and parser_rows[0]["nativeParser"] == parser_rows[1]["nativeParser"], "same-cell parser result is nondeterministic")
    require(
        parser_rows[0]["nativeParser"]["timelineErrorCount"] == 0,
        "native parser violates the absolute timeline gate",
    )
    return {
        "cellId": cell,
        "melProducer": mel_role,
        "runtimeRole": runtime_role,
        "generationFingerprint": generations[0]["generationFingerprint"],
        "selectedTokenSha256": generations[0]["selectedTokenSha256"],
        "firstAttempt": generations[0]["firstAttempt"],
        "fallback": generations[0]["fallback"],
        "pythonParser": parser_rows[0]["pythonParser"],
        "nativeParser": parser_rows[0]["nativeParser"],
        "rawSha256": raw_hash,
        "parserSha256": parser_hash,
    }


def select(rows: dict[str, dict[str, Any]]) -> str:
    a, b, c, d = (rows[cell] for cell in CELLS)
    if a["pythonParser"]["textSha256"] != PYTHON_ANCHOR:
        return "baseline-runtime-unresolved"
    if d["nativeParser"]["textSha256"] != NATIVE_ANCHOR:
        return "invalid-evidence"
    selected_hashes = {
        row["selectedTokenSha256"] for row in rows.values()
    }
    if len(selected_hashes) == 1 and any(
        row["pythonParser"] != row["nativeParser"] for row in rows.values()
    ):
        return "parser-divergence"
    af, bf, cf, df = (row["generationFingerprint"] for row in (a, b, c, d))
    if af == bf and cf == df and af != cf:
        return "runtime-divergence"
    if af == cf and bf == df and af != bf:
        return "feature-divergence"
    if len({af, bf, cf, df}) == 1:
        return "no-divergence"
    return "feature-runtime-interaction"


def build_publication(
    validated: list[dict[str, Any]],
    lock_sha256: str,
    vad_preflight: dict[str, Any],
) -> dict[str, Any]:
    require(set(vad_preflight) == {
        "sha256", "interval", "postVadWaveformSha256", "onnxRuntimeVersion",
    }, "normalized VAD preflight fields drifted")
    rows = {row["cellId"]: row for row in validated}
    require(tuple(rows) == CELLS, "published cell order drifted")
    return {
        "schemaVersion": 1,
        "kind": "hikaru-whisper-short-parity-bisect",
        "status": "completed",
        "qualificationEligible": False,
        "promotionEligible": False,
        "candidateId": "short-input-runtime-parity-bisect-v1",
        "inputLockSha256": lock_sha256,
        "vadPreflight": vad_preflight,
        "disposition": select(rows),
        "rows": validated,
        "limitations": [
            "short-only stage-localization evidence",
            "no CER or qualification conclusion",
            "production/default remains Python legacy",
        ],
    }


def markdown(publication: dict[str, Any]) -> str:
    lines = [
        "# Whisper short input/runtime parity bisect",
        "",
        f"**Disposition: `{publication['disposition']}`.**",
        "",
        "This is promotion-ineligible short-only stage-localization evidence. It is not quality or release evidence.",
        "",
        "| Cell | Mel | Runtime | Generation fingerprint | Python parser text | Native parser text |",
        "|---|---|---|---|---|---|",
    ]
    for row in publication["rows"]:
        lines.append(
            f"| `{row['cellId']}` | `{row['melProducer']}` | `{row['runtimeRole']}` | "
            f"`{row['generationFingerprint']}` | `{row['pythonParser']['textSha256']}` | `{row['nativeParser']['textSha256']}` |"
        )
    lines += ["", "No CER, CPU inheritance, candidate acceptance, or production recommendation is emitted.", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    for cell in CELLS:
        key = cell.replace("-", "_")
        parser.add_argument(f"--{cell}-raw", required=True, dest=f"{key}_raw")
        parser.add_argument(f"--{cell}-parser", required=True, dest=f"{key}_parser")
    parser.add_argument("--input-lock", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--python-mel", required=True)
    parser.add_argument("--native-mel", required=True)
    parser.add_argument("--vad-preflight", required=True)
    parser.add_argument("--json-output", required=True)
    parser.add_argument("--markdown-output", required=True)
    args = parser.parse_args()

    lock_path = tracked_lock(args.input_lock)
    lock_sha = sha256_file(lock_path)
    identity = load_lock(lock_path)
    identity["lockSha256"] = lock_sha
    validate_tool_identity(identity)
    validate_vad_disk_identity(identity)
    vad_preflight = validate_vad_preflight(
        local_file(args.vad_preflight), identity, lock_sha
    )
    tokenizer_path = validate_model_and_mels(
        identity,
        Path(args.model).resolve(),
        Path(args.python_mel).resolve(),
        Path(args.native_mel).resolve(),
    )
    from whisper_short_parser_oracle import compute_rows, load_tokenizer
    tokenizer = load_tokenizer(tokenizer_path)
    validated = []
    for cell in CELLS:
        key = cell.replace("-", "_")
        raw_path = local_file(getattr(args, f"{key}_raw"))
        parser_path = local_file(getattr(args, f"{key}_parser"))
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        parsed = json.loads(parser_path.read_text(encoding="utf-8"))
        validated.append(validate_row(
            raw,
            parsed,
            identity,
            sha256_file(raw_path),
            sha256_file(parser_path),
            compute_rows(raw, tokenizer),
        ))
    publication = build_publication(validated, lock_sha, vad_preflight)
    json_path = output_file(args.json_output, "whisper-short-parity-bisect.json")
    md_path = output_file(args.markdown_output, "whisper-short-parity-bisect.md")
    json_path.write_bytes(json.dumps(publication, ensure_ascii=True, indent=2, sort_keys=True).encode() + b"\n")
    md_path.write_text(markdown(publication), encoding="utf-8")
    print(json.dumps({"status": "completed", "disposition": publication["disposition"]}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
