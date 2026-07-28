"""Managed Silero VAD v4.0 asset and deterministic V4 inference.

The ONNX state contract and speech timestamp behavior follow Silero VAD v4.0
(commit 915dd3d639b8333a52e001af095f87c5b7f1e0ac), licensed under MIT.
Copyright (c) 2020-present Silero Team. Hikaru Sub adds managed download,
hash verification, cancellation, and session VAD option mapping.
"""

from __future__ import annotations

import hashlib
import math
import os
import uuid
from dataclasses import dataclass
from numbers import Integral, Real
from pathlib import Path
from typing import Callable, Optional
from urllib.request import urlopen

import numpy as np

SILERO_V4_COMMIT = "915dd3d639b8333a52e001af095f87c5b7f1e0ac"
SILERO_V4_SHA256 = "a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28"
SILERO_V4_WINDOW_SAMPLES = 1536
_SAMPLING_RATE = 16_000
_OFFICIAL_URL = (
    "https://raw.githubusercontent.com/snakers4/silero-vad/"
    f"{SILERO_V4_COMMIT}/files/silero_vad.onnx"
)
_CHINA_GITHUB_PROXY = "https://ghfast.top/"
_DOWNLOAD_TIMEOUT_SECONDS = 30.0


class SileroV4Cancelled(RuntimeError):
    """V4 processing stopped after the owning transcription was cancelled."""


@dataclass(frozen=True)
class SileroV4Options:
    threshold: float = 0.45
    min_speech_duration_ms: int = 250
    min_silence_duration_ms: int = 3000
    speech_pad_ms: int = 900
    max_speech_duration_s: float = float("inf")

    def __post_init__(self) -> None:
        if (
            isinstance(self.threshold, bool)
            or not isinstance(self.threshold, Real)
            or not math.isfinite(float(self.threshold))
            or not 0 <= self.threshold <= 1
        ):
            raise ValueError("Silero V4 threshold 必须是 [0, 1] 内的有限数值")
        for name in (
            "min_speech_duration_ms",
            "min_silence_duration_ms",
            "speech_pad_ms",
        ):
            value = getattr(self, name)
            if (
                isinstance(value, bool)
                or not isinstance(value, Integral)
                or value < 0
            ):
                raise ValueError(f"Silero V4 {name} 必须是非负整数")
        maximum = self.max_speech_duration_s
        if (
            isinstance(maximum, bool)
            or not isinstance(maximum, Real)
            or maximum <= 0
            or (
                not math.isfinite(float(maximum))
                and float(maximum) != float("inf")
            )
        ):
            raise ValueError(
                "Silero V4 max_speech_duration_s 必须是正有限数或正无穷"
            )


def silero_v4_asset_path() -> Path:
    root = os.environ.get("HF_HOME")
    if not root:
        try:
            from huggingface_hub.constants import HF_HOME

            root = str(HF_HOME)
        except ImportError:
            cache_root = os.environ.get("XDG_CACHE_HOME")
            root = str(
                Path(cache_root).expanduser() / "huggingface"
                if cache_root
                else Path.home() / ".cache" / "huggingface"
            )
    return Path(root) / "hikaru-sub" / "silero-vad-v4" / "silero_vad.onnx"


def silero_v4_url() -> str:
    endpoint = os.environ.get("HF_ENDPOINT", "").rstrip("/")
    if endpoint == "https://hf-mirror.com":
        return f"{_CHINA_GITHUB_PROXY}{_OFFICIAL_URL}"
    return _OFFICIAL_URL


def _sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def is_silero_v4_ready(path: Optional[Path] = None) -> bool:
    candidate = path or silero_v4_asset_path()
    try:
        return candidate.is_file() and _sha256(candidate) == SILERO_V4_SHA256
    except OSError:
        return False


def download_silero_v4(
    path: Optional[Path] = None,
    *,
    opener=urlopen,
) -> Path:
    """Download and hash-check V4 before atomically replacing the managed asset."""
    target = path or silero_v4_asset_path()
    if is_silero_v4_ready(target):
        return target

    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    digest = hashlib.sha256()
    try:
        with opener(
            silero_v4_url(),
            timeout=_DOWNLOAD_TIMEOUT_SECONDS,
        ) as response, temporary.open("wb") as output:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                output.write(block)
                digest.update(block)
            output.flush()
            os.fsync(output.fileno())

        actual_hash = digest.hexdigest()
        if actual_hash != SILERO_V4_SHA256:
            raise RuntimeError(
                "Silero VAD v4.0 SHA-256 校验失败："
                f"expected={SILERO_V4_SHA256}, actual={actual_hash}"
            )
        os.replace(temporary, target)
        return target
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def _create_v4_session(path: Path):
    try:
        import onnxruntime
    except ImportError as exc:
        raise RuntimeError("Silero VAD v4.0 需要 onnxruntime") from exc

    options = onnxruntime.SessionOptions()
    options.inter_op_num_threads = 1
    options.intra_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    options.log_severity_level = 4
    session = onnxruntime.InferenceSession(
        str(path),
        providers=["CPUExecutionProvider"],
        sess_options=options,
    )
    inputs = {item.name for item in session.get_inputs()}
    if not {"input", "h", "c", "sr"}.issubset(inputs):
        raise RuntimeError(
            "Silero VAD v4.0 ONNX 接口不受支持："
            f"inputs={sorted(inputs)}"
        )
    if len(session.get_outputs()) < 3:
        raise RuntimeError("Silero VAD v4.0 ONNX 输出接口不受支持")
    return session


def _infer_speech_probabilities(
    audio: np.ndarray,
    session,
    *,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> list[float]:
    waveform = np.asarray(audio, dtype=np.float32)
    if waveform.ndim != 1:
        raise RuntimeError("Silero VAD v4.0 仅支持单声道音频")

    hidden = np.zeros((2, 1, 64), dtype=np.float32)
    cell = np.zeros((2, 1, 64), dtype=np.float32)
    probabilities: list[float] = []
    for offset in range(0, waveform.shape[0], SILERO_V4_WINDOW_SAMPLES):
        if cancel_check and cancel_check():
            raise SileroV4Cancelled()
        window = waveform[offset : offset + SILERO_V4_WINDOW_SAMPLES]
        if window.shape[0] < SILERO_V4_WINDOW_SAMPLES:
            window = np.pad(
                window,
                (0, SILERO_V4_WINDOW_SAMPLES - window.shape[0]),
            )
        outputs = session.run(
            None,
            {
                "input": window.reshape(1, -1),
                "h": hidden,
                "c": cell,
                "sr": np.array(_SAMPLING_RATE, dtype=np.int64),
            },
        )
        if len(outputs) < 3:
            raise RuntimeError("Silero VAD v4.0 ONNX 推理输出不完整")
        probability, hidden, cell = outputs[:3]
        hidden = np.asarray(hidden, dtype=np.float32)
        cell = np.asarray(cell, dtype=np.float32)
        if hidden.shape != (2, 1, 64) or cell.shape != (2, 1, 64):
            raise RuntimeError("Silero VAD v4.0 ONNX 状态形状不受支持")
        value = float(np.asarray(probability).reshape(-1)[0])
        if not math.isfinite(value) or not 0 <= value <= 1:
            raise RuntimeError("Silero VAD v4.0 返回了超出 [0, 1] 的无效语音概率")
        probabilities.append(value)
    return probabilities


def _validate_sample_count(name: str, value: int, *, positive: bool) -> None:
    if (
        isinstance(value, bool)
        or not isinstance(value, Integral)
        or value < (1 if positive else 0)
    ):
        qualifier = "正整数" if positive else "非负整数"
        raise ValueError(f"Silero V4 {name} 必须是{qualifier}")


def _validate_probability(value: float) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise ValueError("Silero V4 probability 必须是 [0, 1] 内的有限数值")
    probability = float(value)
    if not math.isfinite(probability) or not 0 <= probability <= 1:
        raise ValueError("Silero V4 probability 必须是 [0, 1] 内的有限数值")
    return probability


def _validate_speech_chunks(
    chunks: list[dict[str, int]],
    *,
    audio_length_samples: int,
) -> None:
    _validate_sample_count(
        "audio_length_samples",
        audio_length_samples,
        positive=False,
    )
    previous_end = 0
    for index, chunk in enumerate(chunks):
        try:
            start = chunk["start"]
            end = chunk["end"]
        except (KeyError, TypeError) as exc:
            raise ValueError(f"Silero V4 chunk[{index}] 缺少有效边界") from exc
        if (
            isinstance(start, bool)
            or isinstance(end, bool)
            or not isinstance(start, Integral)
            or not isinstance(end, Integral)
            or start < 0
            or end > audio_length_samples
            or end <= start
            or start < previous_end
        ):
            raise ValueError(
                "Silero V4 chunk 边界必须为正时长、顺序、非重叠且位于源范围内："
                f"index={index}, start={start}, end={end}, "
                f"previousEnd={previous_end}, sourceEnd={audio_length_samples}"
            )
        previous_end = end


def _speech_timestamps_from_probabilities(
    probabilities: list[float],
    *,
    audio_length_samples: int,
    options: SileroV4Options,
    sampling_rate: int = _SAMPLING_RATE,
    window_size_samples: int = SILERO_V4_WINDOW_SAMPLES,
) -> list[dict[str, int]]:
    _validate_sample_count(
        "audio_length_samples",
        audio_length_samples,
        positive=False,
    )
    _validate_sample_count("sampling_rate", sampling_rate, positive=True)
    _validate_sample_count(
        "window_size_samples",
        window_size_samples,
        positive=True,
    )
    probabilities = [_validate_probability(value) for value in probabilities]

    threshold = options.threshold
    negative_threshold = threshold - 0.15
    min_speech_samples = sampling_rate * options.min_speech_duration_ms / 1000
    min_silence_samples = sampling_rate * options.min_silence_duration_ms / 1000
    speech_pad_samples = sampling_rate * options.speech_pad_ms / 1000
    max_speech_samples = (
        sampling_rate * options.max_speech_duration_s
        - window_size_samples
        - 2 * speech_pad_samples
        if math.isfinite(options.max_speech_duration_s)
        else float("inf")
    )
    min_silence_at_max_speech = sampling_rate * 98 / 1000

    triggered = False
    speeches: list[dict[str, int]] = []
    current_speech: dict[str, int] = {}
    temporary_end = 0
    previous_end = 0
    next_start = 0

    for index, probability in enumerate(probabilities):
        current_sample = window_size_samples * index
        if probability >= threshold and temporary_end:
            temporary_end = 0
            if next_start < previous_end:
                next_start = current_sample

        if probability >= threshold and not triggered:
            triggered = True
            current_speech["start"] = current_sample
            continue

        if (
            triggered
            and current_sample - current_speech["start"] > max_speech_samples
        ):
            if previous_end:
                current_speech["end"] = previous_end
                speeches.append(current_speech)
                current_speech = {}
                if next_start < previous_end:
                    triggered = False
                else:
                    current_speech["start"] = next_start
                previous_end = next_start = temporary_end = 0
            else:
                current_speech["end"] = current_sample
                speeches.append(current_speech)
                current_speech = {}
                previous_end = next_start = temporary_end = 0
                triggered = False
                continue

        if probability < negative_threshold and triggered:
            if not temporary_end:
                temporary_end = current_sample
            if current_sample - temporary_end > min_silence_at_max_speech:
                previous_end = temporary_end
            if current_sample - temporary_end < min_silence_samples:
                continue
            current_speech["end"] = temporary_end
            if current_speech["end"] - current_speech["start"] > min_speech_samples:
                speeches.append(current_speech)
            current_speech = {}
            previous_end = next_start = temporary_end = 0
            triggered = False

    if (
        current_speech
        and audio_length_samples - current_speech["start"] > min_speech_samples
    ):
        current_speech["end"] = audio_length_samples
        speeches.append(current_speech)

    for index, speech in enumerate(speeches):
        if index == 0:
            speech["start"] = int(max(0, speech["start"] - speech_pad_samples))
        if index == len(speeches) - 1:
            speech["end"] = int(
                min(audio_length_samples, speech["end"] + speech_pad_samples)
            )
            continue
        silence = speeches[index + 1]["start"] - speech["end"]
        if silence < 2 * speech_pad_samples:
            speech["end"] += int(silence // 2)
            speeches[index + 1]["start"] = int(
                max(0, speeches[index + 1]["start"] - silence // 2)
            )
        else:
            speech["end"] = int(
                min(audio_length_samples, speech["end"] + speech_pad_samples)
            )
            speeches[index + 1]["start"] = int(
                max(0, speeches[index + 1]["start"] - speech_pad_samples)
            )
    _validate_speech_chunks(
        speeches,
        audio_length_samples=audio_length_samples,
    )
    return speeches


def get_speech_timestamps_v4(
    audio: np.ndarray,
    *,
    options: SileroV4Options,
    cancel_check: Optional[Callable[[], bool]] = None,
    path: Optional[Path] = None,
) -> list[dict[str, int]]:
    asset = path or silero_v4_asset_path()
    if not is_silero_v4_ready(asset):
        raise RuntimeError(
            "Silero VAD v4.0 模型缺失或校验失败，请重新下载 large-v2 模型"
        )
    session = _create_v4_session(asset)
    probabilities = _infer_speech_probabilities(
        audio,
        session,
        cancel_check=cancel_check,
    )
    return _speech_timestamps_from_probabilities(
        probabilities,
        audio_length_samples=int(audio.shape[0]),
        options=options,
    )
