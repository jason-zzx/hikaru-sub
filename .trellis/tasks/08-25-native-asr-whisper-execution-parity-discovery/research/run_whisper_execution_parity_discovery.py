#!/usr/bin/env python3
"""Bounded, promotion-ineligible ordinary Whisper execution-parity discovery."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

TASK_ROOT = Path(__file__).resolve().parent
DEFAULT_LOCAL_ROOT = (TASK_ROOT / "local").resolve()
CELLS = {
    "A": ("python-runtime-python-mel", "python", "python-wheel"),
    "B": ("python-runtime-native-mel", "native", "python-wheel"),
    "C": ("native-runtime-python-mel", "python", "native-no-cudnn"),
    "D": ("native-runtime-native-mel", "native", "native-no-cudnn"),
}
PYTHON_ANCHOR = "4ae70515a50f3e7368655a021c94e5db7edaa05372a02d14c93bf77dc1837de0"
NATIVE_ANCHOR = "d5eb90a205337e242dbcfd2752f2173adbff50a5178219365b9c10894b82479c"
WAV_SHA256 = "4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211"
WAVEFORM_SHA256 = "2cbf22e7635a41cf751401525e4358c19f2d452ae99c0ced78f65b6e9327e1c2"
MODEL_SHA256 = "69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1"
PYTHON_VERSION = "3.11.15"
FASTER_WHISPER_VERSION = "1.2.1"
NUMPY_VERSION = "2.4.6"
FEATURE_EXTRACTOR_SHA256 = "e403966dbc592a53695eea2aea24fa60bab50ef6755e0076b311f907be7a397c"
TOKENIZER_SOURCE_SHA256 = "614a96b6a9660096e4f4e9fbe8860cd75ad250dce8e85a847998a3d6d48165d2"
TRANSCRIBE_SOURCE_SHA256 = "5d5ffb00018561d3d529b2c72e1d9f5fff055bea725f3cccc7c6c67f5cc8ffe4"
TOKENIZERS_INIT_SHA256 = "510d5e23458612433da9f1fe430b5009fb88ba90508ee4340d2397b32c319080"
TOKENIZERS_EXTENSION_SHA256 = "7acb83f5b89136597e0d14b788d82917bf2870df94575bf77e12731c4e49c4df"
RUNTIME_SHA256 = {
    "python-wheel": "60e536c0801432cde4a105aeebbca35fbf228aa3e901807b2310b02676c2f140",
    "native-no-cudnn": "e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2",
}
ALLOWED_DISPOSITIONS = {
    "feature-divergence", "runtime-divergence", "parser-divergence",
    "feature-runtime-interaction", "no-divergence", "baseline-runtime-unresolved",
    "native-harness-unresolved", "invalid-evidence",
}


class DiscoveryError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise DiscoveryError(message)


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode()


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_reparse(path: Path) -> bool:
    try:
        stat = path.lstat()
    except FileNotFoundError:
        return False
    return path.is_symlink() or bool(getattr(stat, "st_file_attributes", 0) & 0x400)


def local_path(root: Path, value: str | Path, *, exists: bool = True) -> Path:
    root = root.resolve()
    path = Path(value).resolve()
    require(path.is_relative_to(root), "path escaped the canonical T06D local root")
    if exists:
        require(path.exists(), "required task-local path is missing")
    current = path
    while current != root:
        require(not is_reparse(current), "symlink/junction/reparse input is forbidden")
        current = current.parent
    return path


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), "JSON artifact must be an object")
    return value


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(json.dumps(value, ensure_ascii=True, indent=2, sort_keys=True).encode() + b"\n")
    temporary.replace(path)


def python_runtime_identity() -> dict[str, Any]:
    import numpy as np
    import faster_whisper
    import faster_whisper.feature_extractor as feature_module
    import faster_whisper.tokenizer as tokenizer_module
    import faster_whisper.transcribe as transcribe_module
    import tokenizers as tokenizers_package
    import tokenizers.tokenizers as tokenizers_extension

    files = {
        "featureExtractorSha256": sha256_file(Path(feature_module.__file__)),
        "tokenizerSourceSha256": sha256_file(Path(tokenizer_module.__file__)),
        "transcribeSourceSha256": sha256_file(Path(transcribe_module.__file__)),
        "tokenizersInitSha256": sha256_file(Path(tokenizers_package.__file__)),
        "tokenizersExtensionSha256": sha256_file(Path(tokenizers_extension.__file__)),
    }
    require(
        sys.version.split()[0] == PYTHON_VERSION
        and faster_whisper.__version__ == FASTER_WHISPER_VERSION
        and np.__version__ == NUMPY_VERSION
        and files == {
            "featureExtractorSha256": FEATURE_EXTRACTOR_SHA256,
            "tokenizerSourceSha256": TOKENIZER_SOURCE_SHA256,
            "transcribeSourceSha256": TRANSCRIBE_SOURCE_SHA256,
            "tokenizersInitSha256": TOKENIZERS_INIT_SHA256,
            "tokenizersExtensionSha256": TOKENIZERS_EXTENSION_SHA256,
        },
        "Python/faster-whisper/NumPy producer identity drifted",
    )
    return {
        "pythonVersion": PYTHON_VERSION,
        "fasterWhisperVersion": FASTER_WHISPER_VERSION,
        "numpyVersion": NUMPY_VERSION,
        **files,
    }


def load_contract(root: Path, path: Path, role: str) -> tuple[dict[str, Any], str]:
    path = local_path(root, path)
    contract = load_json(path)
    require(
        contract.get("kind") == "hikaru-whisper-execution-parity-model-contract"
        and contract.get("status") == "completed"
        and contract.get("qualificationEligible") is False
        and contract.get("promotionEligible") is False
        and contract.get("modelConstructionReached") is True
        and contract.get("generationBoundaryReached") is False,
        "model contract envelope drifted",
    )
    require(contract.get("runtimeRole") == role, "model contract runtime role drifted")
    require(contract.get("nMels") == 128 and contract.get("shape") == [128, 3000],
            "large-v3 must expose exact 128 x 3000 features")
    model_files = contract.get("model", {}).get("files", [])
    model_bin = next((item for item in model_files if item.get("name") == "model.bin"), None)
    runtime = contract.get("runtime", {})
    require(model_bin and model_bin.get("sha256") == MODEL_SHA256, "large-v3 model identity drifted")
    require(
        runtime.get("ctranslate2", {}).get("sha256") == RUNTIME_SHA256[role]
        and runtime.get("requestedDevice") == "cuda"
        and runtime.get("resolvedDevice") == "cuda"
        and runtime.get("computeType") == "float16"
        and runtime.get("deviceIndex") == 0
        and runtime.get("pathPolicy", {}).get("restricted") is True
        and isinstance(runtime.get("runtimeFiles"), list)
        and isinstance(runtime.get("loadedModules"), list),
        "model contract runtime identity drifted",
    )
    return contract, sha256_file(path)


def generate_python_mel(root: Path, audio: Path, contract_path: Path, output: Path) -> dict[str, Any]:
    _, contract_hash = load_contract(root, contract_path, "python-wheel")
    audio = local_path(root, audio)
    output = local_path(root, output, exists=False)
    require(sha256_file(audio) == WAV_SHA256, "short-v1 WAV identity drifted")
    producer_runtime = python_runtime_identity()
    import numpy as np
    from faster_whisper.audio import decode_audio, pad_or_trim
    from faster_whisper.feature_extractor import FeatureExtractor

    waveform = np.asarray(decode_audio(str(audio)), dtype="<f4")
    require(waveform.shape == (385637,), "short-v1 waveform shape drifted")
    require(hashlib.sha256(waveform.tobytes()).hexdigest() == WAVEFORM_SHA256,
            "short-v1 waveform identity drifted")
    mel = np.asarray(
        pad_or_trim(FeatureExtractor(feature_size=128)(waveform)),
        dtype="<f4",
        order="C",
    )
    require(mel.shape == (128, 3000), "Python producer did not honor model-derived n_mels")
    output.parent.mkdir(parents=True, exist_ok=True)
    mel.tofile(output)
    return {
        "producer": "python",
        "shape": [128, 3000],
        "dtype": "float32-le",
        "sizeBytes": output.stat().st_size,
        "sha256": sha256_file(output),
        "modelContractSha256": contract_hash,
        "producerRuntime": producer_runtime,
    }


def restricted_environment(runtime: Path) -> dict[str, str]:
    runtime = runtime.resolve()
    cuda = (Path(os.environ["CUDA_PATH"]) / "bin").resolve()
    system32 = (Path(os.environ["SystemRoot"]) / "System32").resolve()
    env = os.environ.copy()
    env["PATH"] = os.pathsep.join((str(runtime), str(cuda), str(system32)))
    return env


def run_runner(runtime: Path, arguments: list[str]) -> dict[str, Any]:
    executable = runtime / "hikaru-asr-ctranslate2-tests.exe"
    require(executable.is_file(), "measurement executable is missing")
    completed = subprocess.run(
        [str(executable), *arguments],
        cwd=runtime,
        env=restricted_environment(runtime),
        text=True,
        capture_output=True,
        check=False,
    )
    require(completed.returncode == 0, f"runner failed: {completed.stderr.strip()}")
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    require(lines, "runner emitted no atomic status")
    return json.loads(lines[-1])


def tokenizer_for_model(model: Path):
    python_runtime_identity()
    from faster_whisper.tokenizer import Tokenizer
    from tokenizers import Tokenizer as HfTokenizer

    tokenizer = Tokenizer(
        HfTokenizer.from_file(str(model / "tokenizer.json")),
        multilingual=True,
        task="transcribe",
        language="ja",
    )
    require(tokenizer.timestamp_begin == 50365, "timestamp token identity drifted")
    return tokenizer


def python_parser_segments(tokens: list[int], tokenizer) -> list[dict[str, Any]]:
    timestamp_begin = tokenizer.timestamp_begin
    consecutive = [i for i in range(1, len(tokens))
                   if tokens[i] >= timestamp_begin and tokens[i - 1] >= timestamp_begin]
    single_ending = len(tokens) >= 2 and tokens[-2] < timestamp_begin <= tokens[-1]
    segments: list[dict[str, Any]] = []
    if consecutive:
        slices = list(consecutive) + ([len(tokens)] if single_ending else [])
        previous = 0
        for current in slices:
            value = tokens[previous:current]
            require(value, "empty Python timestamp slice")
            segment = {
                "startMs": (value[0] - timestamp_begin) * 20,
                "endMs": (value[-1] - timestamp_begin) * 20,
                "text": tokenizer.decode(value),
            }
            if segment["startMs"] != segment["endMs"] and segment["text"].strip():
                segments.append(segment)
            previous = current
    else:
        timestamps = [token for token in tokens if token >= timestamp_begin]
        end = (timestamps[-1] - timestamp_begin) * 20 if timestamps and timestamps[-1] != timestamp_begin else 24100
        text = tokenizer.decode(tokens)
        if end > 0 and text.strip():
            segments.append({"startMs": 0, "endMs": end, "text": text})
    return segments


def parser_aggregate(segments: list[dict[str, Any]]) -> dict[str, Any]:
    timeline = [{"startMs": int(item["startMs"]), "endMs": int(item["endMs"])} for item in segments]
    text = "".join(str(item["text"]) for item in segments)
    timeline_bytes = json.dumps(timeline, ensure_ascii=True, separators=(",", ":")).encode()
    return {
        "segmentCount": len(segments),
        "textSha256": hashlib.sha256(text.encode()).hexdigest(),
        "timelineSha256": hashlib.sha256(timeline_bytes).hexdigest(),
        "timelineErrorCount": sum(
            int(item["startMs"] < 0 or item["endMs"] <= item["startMs"] or item["endMs"] > 24102)
            for item in timeline
        ),
    }


def summarize_raw(
    raw: dict[str, Any], tokenizer, *, lane: str, repeat: int,
    contract_hash: str, mel_hash: str, raw_sha256: str,
) -> dict[str, Any]:
    cell, mel_role, runtime_role = CELLS[lane]
    require(
        raw.get("kind") == "hikaru-whisper-execution-parity-raw"
        and raw.get("status") == "completed"
        and raw.get("qualificationEligible") is False
        and raw.get("promotionEligible") is False
        and raw.get("cellId") == cell
        and raw.get("repeatIndex") == repeat
        and raw.get("caseId") == "short-v1"
        and raw.get("modelContractSha256") == contract_hash
        and raw.get("nMels") == 128
        and raw.get("mel", {}).get("producer") == mel_role
        and raw.get("mel", {}).get("shape") == [128, 3000]
        and raw.get("mel", {}).get("sizeBytes") == 1536000
        and raw.get("mel", {}).get("sha256") == mel_hash
        and raw.get("config", {}).get("beamSize") == 5
        and raw.get("config", {}).get("conditionOnPreviousText") is True
        and raw.get("config", {}).get("timestampDrivenSeek") is True
        and raw.get("config", {}).get("temperature") == 0.0
        and raw.get("config", {}).get("vad") is False
        and raw.get("decodeIdentity", {}).get("generation") == "temperature-0-first-attempt"
        and raw.get("runtime", {}).get("role") == runtime_role
        and raw.get("runtime", {}).get("ctranslate2", {}).get("sha256") == RUNTIME_SHA256[runtime_role]
        and raw.get("runtime", {}).get("generationBoundaryReached") is True
        and raw.get("selectedTemperature") == 0.0
        and raw.get("fallbackTriggerSequence") == []
        and raw.get("generationCallCount") == 1
        and raw.get("fallbackCallCount") == 0,
        "raw discovery envelope drifted",
    )
    traces = raw.get("tokenTraces")
    require(isinstance(traces, list) and len(traces) == 1, "raw token trace cardinality drifted")
    tokens = traces[0].get("tokenIds")
    require(isinstance(tokens, list) and tokens and all(type(token) is int for token in tokens),
            "raw token sequence is missing")
    python_parser = parser_aggregate(python_parser_segments(tokens, tokenizer))
    native_parser = raw.get("nativeParser")
    require(isinstance(native_parser, dict), "native parser aggregate is missing")
    return {
        "cellId": raw["cellId"],
        "repeatIndex": raw["repeatIndex"],
        "selectedTokenSha256": canonical_hash(tokens),
        "selectedTemperature": 0.0,
        "fallbackCallCount": 0,
        "pythonParser": python_parser,
        "nativeParser": native_parser,
        "rawSha256": raw_sha256,
    }


def artifact_set_summary(paths: list[Path]) -> dict[str, Any]:
    rows = [{"name": path.name, "sha256": sha256_file(path)} for path in sorted(paths)]
    return {"count": len(rows), "sha256": canonical_hash(rows)}


def record_harness_failure(
    root: Path, message: str, category: str = "harness-or-identity-failure",
) -> None:
    state_path = root / "state.json"
    state = load_json(state_path) if state_path.is_file() else {"harnessFailureCount": 0}
    count = int(state.get("harnessFailureCount", 0))
    require(count < 2 and state.get("disposition") != "invalid-evidence",
            "T06D is already closed as invalid-evidence")
    count += 1
    record_path = root / "harness-failures.json"
    record = load_json(record_path) if record_path.is_file() else {
        "schemaVersion": 1,
        "kind": "hikaru-whisper-execution-parity-harness-failures",
        "qualificationEligible": False,
        "promotionEligible": False,
        "correctionBudget": 1,
        "failures": [],
    }
    failures = record.get("failures")
    require(isinstance(failures, list) and len(failures) == count - 1,
            "harness failure lineage drifted")
    failures.append({
        "index": count,
        "category": category,
        "messageSha256": hashlib.sha256(message.encode()).hexdigest(),
        "scoringEligible": False,
    })
    record.update({
        "failureCount": count,
        "status": "correction-review-required" if count == 1 else "closed",
        "disposition": None if count == 1 else "invalid-evidence",
    })
    atomic_json(record_path, record)
    if count == 2:
        for key in ("lanes", "pythonMel", "nativeMel", "crossoversCompleted"):
            state.pop(key, None)
    state.update({
        "schemaVersion": 1,
        "kind": "hikaru-whisper-execution-parity-state",
        "qualificationEligible": False,
        "promotionEligible": False,
        "harnessFailureCount": count,
        "harnessFailureRecordSha256": sha256_file(record_path),
        "anchorsAccepted": bool(state.get("anchorsAccepted")) if count == 1 else False,
        "status": "correction-review-required" if count == 1 else "closed",
        "disposition": None if count == 1 else "invalid-evidence",
    })
    atomic_json(state_path, state)


def require_model_phase_allowed(root: Path, reviewed_correction: bool) -> tuple[dict[str, Any], int]:
    state_path = root / "state.json"
    state = load_json(state_path) if state_path.is_file() else {}
    count = int(state.get("harnessFailureCount", 0))
    require(count < 2 and state.get("disposition") != "invalid-evidence",
            "T06D is closed and no further model-backed process is allowed")
    if count == 1:
        require(reviewed_correction and state.get("status") == "correction-review-required",
                "the single harness correction requires explicit reviewed-correction authorization")
    else:
        require(not reviewed_correction, "reviewed-correction is invalid before the first failure")
        require(state.get("disposition") is None,
                "a published anchor disposition cannot be rerun in place")
    return state, count


def lane_paths(root: Path, lane: str, repeat: int) -> Path:
    return root / "raw" / f"{lane}-repeat-{repeat}.json"


def run_lane(root: Path, runtime: Path, model: Path, contract: Path,
             mel: Path, lane: str, repeat: int) -> tuple[dict[str, Any], str, str, str]:
    cell, _, _ = CELLS[lane]
    _, contract_hash = load_contract(root, contract, CELLS[lane][2])
    mel = local_path(root, mel)
    mel_hash = sha256_file(mel)
    output = lane_paths(root, lane, repeat)
    run_runner(runtime, [
        "--run-whisper-execution-parity", "--cell", cell,
        "--model", str(model), "--mel", str(mel), "--mel-sha256", mel_hash,
        "--model-contract", str(contract), "--model-contract-sha256", contract_hash,
        "--output", str(output), "--repeat-index", str(repeat),
    ])
    return load_json(output), contract_hash, mel_hash, sha256_file(output)


def validate_repeats(rows: list[dict[str, Any]]) -> None:
    require(len(rows) == 2 and [row["repeatIndex"] for row in rows] == [1, 2],
            "anchor repeat matrix drifted")
    stable = [{key: row[key] for key in (
        "selectedTokenSha256", "selectedTemperature", "fallbackCallCount",
        "pythonParser", "nativeParser")}
        for row in rows]
    require(stable[0] == stable[1], "anchor result is nondeterministic")


def anchors(args: argparse.Namespace, root: Path) -> None:
    prior_state, prior_failure_count = require_model_phase_allowed(root, args.reviewed_correction)
    audio = local_path(root, args.audio)
    model = local_path(root, args.model)
    python_runtime = local_path(root, args.python_runtime)
    native_runtime = local_path(root, args.native_runtime)
    require(sha256_file(audio) == WAV_SHA256 and sha256_file(model / "model.bin") == MODEL_SHA256,
            "task-local audio/model identity drifted")
    contracts = root / "contracts"
    python_contract = contracts / "python-wheel.json"
    native_contract = contracts / "native-no-cudnn.json"
    try:
        run_runner(python_runtime, ["--execution-parity-contract", "--runtime-role", "python-wheel",
                                    "--model", str(model), "--output", str(python_contract)])
        run_runner(native_runtime, ["--execution-parity-contract", "--runtime-role", "native-no-cudnn",
                                    "--model", str(model), "--output", str(native_contract)])
        load_contract(root, python_contract, "python-wheel")
        _, native_contract_hash = load_contract(root, native_contract, "native-no-cudnn")
        feature_root = root / "features"
        python_mel = feature_root / "python.f32"
        native_mel = feature_root / "native.f32"
        python_metadata = generate_python_mel(root, audio, python_contract, python_mel)
        native_status = run_runner(native_runtime, [
            "--execution-parity-native-mel", "--audio", str(audio), "--model", str(model),
            "--model-contract", str(native_contract),
            "--model-contract-sha256", native_contract_hash, "--output", str(native_mel),
        ])
        require(native_status.get("shape") == [128, 3000] and native_status.get("sizeBytes") == 1536000,
                "native feature producer did not honor model-derived n_mels")
        tokenizer = tokenizer_for_model(model)
        summaries: dict[str, list[dict[str, Any]]] = {}
        for lane, runtime, contract, mel in (
            ("A", python_runtime, python_contract, python_mel),
            ("D", native_runtime, native_contract, native_mel),
        ):
            summaries[lane] = []
            for repeat in (1, 2):
                raw, contract_hash, mel_hash, raw_sha = run_lane(
                    root, runtime, model, contract, mel, lane, repeat)
                summaries[lane].append(summarize_raw(
                    raw, tokenizer, lane=lane, repeat=repeat,
                    contract_hash=contract_hash, mel_hash=mel_hash, raw_sha256=raw_sha))
            validate_repeats(summaries[lane])
        a_hash = summaries["A"][0]["pythonParser"]["textSha256"]
        d_hash = summaries["D"][0]["nativeParser"]["textSha256"]
        disposition = None
        if a_hash != PYTHON_ANCHOR:
            disposition = "baseline-runtime-unresolved"
        elif d_hash != NATIVE_ANCHOR:
            disposition = "native-harness-unresolved"
        state = {
            "schemaVersion": 1,
            "kind": "hikaru-whisper-execution-parity-state",
            "qualificationEligible": False,
            "promotionEligible": False,
            "status": "completed-after-reviewed-correction" if prior_failure_count else "completed",
            "harnessFailureCount": prior_failure_count,
            "anchorsAccepted": disposition is None,
            "disposition": disposition,
            "modelContract": {
                "nMels": 128, "shape": [128, 3000], "dtype": "float32-le",
                "setSha256": canonical_hash(sorted((
                    sha256_file(python_contract), sha256_file(native_contract)))),
            },
            "pythonMel": python_metadata,
            "nativeMel": {key: native_status[key] for key in (
                "producer", "shape", "dtype", "sizeBytes", "sha256", "modelContractSha256")},
            "lanes": summaries,
        }
        if prior_failure_count:
            state["harnessFailureRecordSha256"] = prior_state["harnessFailureRecordSha256"]
        atomic_json(root / "state.json", state)
    except Exception as error:
        record_harness_failure(root, str(error))
        raise


def crossovers(args: argparse.Namespace, root: Path) -> None:
    state_path = root / "state.json"
    state, _ = require_model_phase_allowed(root, args.reviewed_correction)
    require(state.get("anchorsAccepted") is True and state.get("disposition") is None,
            "B/C crossovers require accepted A/D anchors")
    model = local_path(root, args.model)
    python_runtime = local_path(root, args.python_runtime)
    native_runtime = local_path(root, args.native_runtime)
    python_contract = root / "contracts" / "python-wheel.json"
    native_contract = root / "contracts" / "native-no-cudnn.json"
    python_mel = root / "features" / "python.f32"
    native_mel = root / "features" / "native.f32"
    tokenizer = tokenizer_for_model(model)
    try:
        for lane, runtime, contract, mel in (
            ("B", python_runtime, python_contract, native_mel),
            ("C", native_runtime, native_contract, python_mel),
        ):
            raw, contract_hash, mel_hash, raw_sha = run_lane(
                root, runtime, model, contract, mel, lane, 1)
            state["lanes"][lane] = [summarize_raw(
                raw, tokenizer, lane=lane, repeat=1,
                contract_hash=contract_hash, mel_hash=mel_hash, raw_sha256=raw_sha)]
        state["crossoversCompleted"] = True
        atomic_json(state_path, state)
    except Exception as error:
        record_harness_failure(root, str(error))
        raise


def select_disposition(lanes: dict[str, list[dict[str, Any]]]) -> str:
    rows = {lane: values[0] for lane, values in lanes.items()}
    require(set(rows) == set(CELLS), "complete A/B/C/D matrix is required")
    if any(row["pythonParser"] != row["nativeParser"] for row in rows.values()):
        return "parser-divergence"
    a, b, c, d = (rows[lane]["selectedTokenSha256"] for lane in "ABCD")
    if len({a, b, c, d}) == 1:
        return "no-divergence"
    if a == b and c == d and a != c:
        return "runtime-divergence"
    if a == c and b == d and a != b:
        return "feature-divergence"
    return "feature-runtime-interaction"


def validate_publication_state(root: Path, state: dict[str, Any]) -> None:
    require(
        state.get("kind") == "hikaru-whisper-execution-parity-state"
        and state.get("qualificationEligible") is False
        and state.get("promotionEligible") is False,
        "discovery state envelope drifted",
    )
    disposition = state.get("disposition")
    if disposition is None:
        require(state.get("crossoversCompleted") is True, "crossovers are incomplete")
        disposition = select_disposition(state["lanes"])
    require(disposition in ALLOWED_DISPOSITIONS, "discovery disposition drifted")
    model_contract = state.get("modelContract", {})
    require(model_contract.get("nMels") == 128 and model_contract.get("shape") == [128, 3000],
            "published model contract was not observed as exact 128 x 3000")
    causal = {
        "feature-divergence", "runtime-divergence", "parser-divergence",
        "feature-runtime-interaction", "no-divergence",
    }
    if disposition in causal:
        require(
            state.get("anchorsAccepted") is True
            and state.get("crossoversCompleted") is True
            and set(state.get("lanes", {})) == set(CELLS)
            and select_disposition(state["lanes"]) == disposition,
            "causal publication matrix drifted",
        )
    if disposition == "invalid-evidence":
        record_path = local_path(root, root / "harness-failures.json")
        require(
            state.get("status") == "closed"
            and state.get("harnessFailureCount") == 2
            and state.get("anchorsAccepted") is False
            and state.get("crossoversCompleted") is not True
            and state.get("crossoversStarted") is False
            and state.get("processRemaining") is False
            and state.get("scoringEligible") is False
            and state.get("harnessFailureRecordSha256") == sha256_file(record_path),
            "invalid-evidence closure identity drifted",
        )
        raw_paths = list((root / "raw").glob("*.json"))
        require(all(path.name.startswith(("A-", "D-")) for path in raw_paths),
                "B/C raw artifact exists after invalid A/D harness closure")
        raw_summary = artifact_set_summary(raw_paths)
        require(
            state.get("invalidatedRawArtifactCount") == raw_summary["count"]
            and state.get("invalidatedRawArtifactSetSha256") == raw_summary["sha256"],
            "invalidated raw artifact set drifted",
        )
    elif disposition in {"baseline-runtime-unresolved", "native-harness-unresolved"}:
        require(state.get("anchorsAccepted") is False and set(state.get("lanes", {})) == {"A", "D"},
                "unresolved anchor publication requires the complete A/D anchor set")


def sanitized_publication(state: dict[str, Any]) -> dict[str, Any]:
    disposition = state.get("disposition")
    if disposition is None:
        disposition = select_disposition(state["lanes"])
    rows = []
    if disposition != "invalid-evidence":
        for lane in "ABCD":
            if lane not in state.get("lanes", {}):
                continue
            row = state["lanes"][lane][0]
            rows.append({
                "lane": lane,
                "cellId": row["cellId"],
                "selectedTokenSha256": row["selectedTokenSha256"],
                "pythonParser": row["pythonParser"],
                "nativeParser": row["nativeParser"],
                "rawSha256": row["rawSha256"],
            })
    evidence = {
        "scoringEligible": disposition != "invalid-evidence",
        "harnessFailureCount": int(state.get("harnessFailureCount", 0)),
    }
    findings: list[str] = []
    if disposition == "invalid-evidence":
        evidence.update({
            "harnessFailureRecordSha256": state["harnessFailureRecordSha256"],
            "invalidatedRawArtifactCount": state["invalidatedRawArtifactCount"],
            "invalidatedRawArtifactSetSha256": state["invalidatedRawArtifactSetSha256"],
            "processRemaining": False,
            "crossoversStarted": False,
        })
        findings = [
            "the initial model-backed anchor command exceeded the outer 30000 ms executor while its child process remained",
            "the reviewed correction overlapped that still-running child, consuming the second harness failure",
            "all acquired A/D rows are invalidated and B/C never started",
        ]
    return {
        "schemaVersion": 1,
        "kind": "hikaru-whisper-execution-parity-discovery",
        "status": "completed",
        "qualificationEligible": False,
        "promotionEligible": False,
        "disposition": disposition,
        "modelContract": state["modelContract"],
        "evidence": evidence,
        "findings": findings,
        "rows": rows,
        "limitations": [
            "short-only execution-parity discovery",
            "fresh Python output is reproducibility evidence only",
            "no candidate acquisition or qualification evidence",
            "production/default remains Python legacy",
        ],
    }


def publish(root: Path) -> None:
    state_path = root / "state.json"
    state = load_json(state_path)
    validate_publication_state(root, state)
    if state.get("disposition") is None:
        state["disposition"] = select_disposition(state["lanes"])
        state["status"] = "closed"
        atomic_json(state_path, state)
    publication = sanitized_publication(state)
    json_path = TASK_ROOT / "whisper-execution-parity-discovery.json"
    md_path = TASK_ROOT / "whisper-execution-parity-discovery.md"
    atomic_json(json_path, publication)
    lines = [
        "# Native Whisper execution-parity discovery", "",
        f"**Disposition: `{publication['disposition']}`.**", "",
        "Promotion/qualification eligible: `false` / `false`.", "",
        "| Lane | Cell | Selected token SHA-256 | Python parser text SHA-256 | Native parser text SHA-256 |",
        "|---|---|---|---|---|",
    ]
    for row in publication["rows"]:
        lines.append(
            f"| `{row['lane']}` | `{row['cellId']}` | `{row['selectedTokenSha256']}` | "
            f"`{row['pythonParser']['textSha256']}` | `{row['nativeParser']['textSha256']}` |"
        )
    if publication["findings"]:
        lines += ["", "## Bounded findings", ""]
        lines += [f"- {finding}." for finding in publication["findings"]]
        lines += [
            "",
            f"Harness failures: `{publication['evidence']['harnessFailureCount']}`; "
            f"invalidated raw artifacts: `{publication['evidence']['invalidatedRawArtifactCount']}`; "
            "process remaining: `false`; scoring eligible: `false`.",
        ]
    lines += ["", "No candidate, qualification, route or CPU inheritance claim is emitted.", ""]
    md_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=("anchors", "crossovers", "publish"), required=True)
    parser.add_argument("--local-root", default=str(DEFAULT_LOCAL_ROOT))
    parser.add_argument("--audio")
    parser.add_argument("--model")
    parser.add_argument("--python-runtime")
    parser.add_argument("--native-runtime")
    parser.add_argument("--reviewed-correction", action="store_true")
    args = parser.parse_args()
    root = Path(args.local_root).resolve()
    require(root == DEFAULT_LOCAL_ROOT, "T06D local root identity drifted")
    root.mkdir(parents=True, exist_ok=True)
    if args.phase == "publish":
        publish(root)
    else:
        require(all((args.audio, args.model, args.python_runtime, args.native_runtime)),
                "model-backed phase arguments are incomplete")
        (anchors if args.phase == "anchors" else crossovers)(args, root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
