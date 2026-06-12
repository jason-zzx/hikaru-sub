"""NVIDIA NeMo Parakeet 适配器。

`nvidia/parakeet-tdt_ctc-0.6b-ja` 是日语 ASR 模型，NeMo 可产出时间戳。
该模型的 word/segment 分割对日语字幕不够稳定，所以这里优先读取 char
timestamps，再按日语标点、长度和停顿重新组装字幕段。
"""

from __future__ import annotations

import os
import wave
import importlib.util
from typing import Callable, Iterable, Iterator, Optional

from diagnostics import debug_exception, debug_log
from .base import AsrEngine, AsrError, AsrSegment, Transcription

MODEL_ID = "nvidia/parakeet-tdt_ctc-0.6b-ja"
MODEL_FILE = "parakeet-tdt_ctc-0.6b-ja.nemo"
PUNCTUATION = set("。！？!?…")
SOFT_BREAK_PUNCTUATION = set("、，,；;：:")
DEFAULT_MAX_CHARS = 40
DEFAULT_MIN_CHARS = 8
DEFAULT_PAUSE_THRESHOLD_SEC = 0.1
DEFAULT_MAX_DURATION_MS = 5000
JAPANESE_SOFT_BREAK_SUFFIXES = (
    "ですけど",
    "ましたが",
    "ますけど",
    "ですが",
    "なので",
    "ので",
    "から",
    "けど",
    "では",
    "して",
    "って",
    "です",
    "ます",
    "ました",
    "ですね",
    "よね",
    "かな",
)
JAPANESE_PARTICLE_BREAK_CHARS = set("はがをにでとへもやねよか")


def _duration_ms(audio_path: str) -> int:
    """读取 WAV 时长。项目提取的 audio.wav 是 16kHz 单声道 WAV。"""
    try:
        with wave.open(audio_path, "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            if rate <= 0:
                return 0
            return int(round(frames / rate * 1000))
    except Exception:
        return 0


def _token_to_text(value) -> str:
    """把 NeMo timestamp token 归一成可写入字幕的文本。"""
    if value is None:
        return ""
    if isinstance(value, dict):
        for key in ("char", "text", "token", "word"):
            if key in value:
                return _token_to_text(value[key])
        return ""
    if isinstance(value, (list, tuple)):
        return "".join(_token_to_text(item) for item in value)
    if not isinstance(value, (str, bytes)) and hasattr(value, "tolist"):
        try:
            return _token_to_text(value.tolist())
        except Exception:  # noqa: BLE001
            pass
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    return str(value)


def _normalize_char_item(item) -> Optional[tuple[str, float, float]]:
    """兼容 NeMo 返回的 dict 或带属性对象。时间单位按秒处理。"""
    if isinstance(item, dict):
        char = item.get("char") or item.get("text") or item.get("token") or item.get("word")
        start = item.get("start")
        end = item.get("end")
        if start is None:
            start = item.get("start_offset")
        if end is None:
            end = item.get("end_offset")
    else:
        char = (
            getattr(item, "char", None)
            or getattr(item, "text", None)
            or getattr(item, "token", None)
            or getattr(item, "word", None)
        )
        start = getattr(item, "start", None)
        end = getattr(item, "end", None)
        if start is None:
            start = getattr(item, "start_offset", None)
        if end is None:
            end = getattr(item, "end_offset", None)

    if char is None or start is None or end is None:
        return None
    char = _token_to_text(char)
    if not char.strip():
        return None
    try:
        return char, float(start), float(end)
    except (TypeError, ValueError):
        return None


def _flush_buffer(buffer: list[tuple[str, float, float]]) -> Optional[AsrSegment]:
    while buffer and not buffer[0][0].strip():
        buffer.pop(0)
    while buffer and not buffer[-1][0].strip():
        buffer.pop()
    if not buffer:
        return None
    text = "".join(ch for ch, _, _ in buffer).strip()
    if not text:
        return None
    start = int(round(buffer[0][1] * 1000))
    end = int(round(buffer[-1][2] * 1000))
    if end <= start:
        end = start + 100
    return AsrSegment(start_ms=start, end_ms=end, text=text)


def _buffer_text(buffer: list[tuple[str, float, float]]) -> str:
    return "".join(ch for ch, _, _ in buffer).strip()


def _buffer_duration_ms(buffer: list[tuple[str, float, float]]) -> int:
    if not buffer:
        return 0
    return int(round((buffer[-1][2] - buffer[0][1]) * 1000))


def _japanese_soft_boundary_score(text: str, char: str) -> int:
    if char in SOFT_BREAK_PUNCTUATION:
        return 2
    if any(text.endswith(suffix) for suffix in JAPANESE_SOFT_BREAK_SUFFIXES):
        return 2
    if char in JAPANESE_PARTICLE_BREAK_CHARS:
        return 1
    return 0


def _find_japanese_soft_break(
    buffer: list[tuple[str, float, float]],
    *,
    min_chars: int,
) -> int:
    best_strong = -1
    best_weak = -1
    text = ""
    for index, (char, _, _) in enumerate(buffer):
        text = f"{text}{char}"
        if len(text.strip()) < min_chars:
            continue
        score = _japanese_soft_boundary_score(text.strip(), char)
        if score >= 2:
            best_strong = index
        elif score == 1:
            best_weak = index
    return best_strong if best_strong >= 0 else best_weak


def build_segments_from_char_timestamps(
    timestamps: Iterable,
    fallback_text: str,
    *,
    max_chars: int = DEFAULT_MAX_CHARS,
    min_chars: int = DEFAULT_MIN_CHARS,
    pause_threshold_sec: float = DEFAULT_PAUSE_THRESHOLD_SEC,
    max_duration_ms: int = DEFAULT_MAX_DURATION_MS,
    fallback_duration_ms: int = 0,
) -> list[AsrSegment]:
    """把 char timestamps 组装成适合字幕编辑的日语片段。

    分割优先级：
    1. 明显停顿。
    2. 句末标点（。！？等）。
    3. 超过最大字符数或最大时长时，优先在日语软边界处分割，否则硬切。
    """
    normalized = [x for item in timestamps if (x := _normalize_char_item(item))]
    if not normalized:
        return build_segments_from_text(fallback_text, duration_ms=fallback_duration_ms)

    segments: list[AsrSegment] = []
    buffer: list[tuple[str, float, float]] = []
    previous_end: Optional[float] = None

    for char, start, end in normalized:
        if previous_end is not None and start - previous_end >= pause_threshold_sec:
            seg = _flush_buffer(buffer)
            if seg is not None:
                segments.append(seg)
            buffer = []

        buffer.append((char, start, end))

        length = len(_buffer_text(buffer))
        duration_ms = _buffer_duration_ms(buffer)
        break_index: Optional[int] = None
        if char in PUNCTUATION and length > 0:
            break_index = len(buffer) - 1
        elif length >= max_chars or duration_ms >= max_duration_ms:
            soft_break = _find_japanese_soft_break(buffer, min_chars=min_chars)
            break_index = soft_break if soft_break >= 0 else len(buffer) - 1

        if break_index is not None:
            if 0 <= break_index < len(buffer) - 1:
                head = buffer[: break_index + 1]
                tail = buffer[break_index + 1 :]
                seg = _flush_buffer(head)
                if seg is not None:
                    segments.append(seg)
                buffer = tail
            else:
                seg = _flush_buffer(buffer)
                if seg is not None:
                    segments.append(seg)
                buffer = []

        previous_end = end

    tail = _flush_buffer(buffer)
    if tail is not None:
        segments.append(tail)

    return segments or build_segments_from_text(
        fallback_text,
        duration_ms=fallback_duration_ms,
    )


def build_segments_from_text(
    text: str,
    *,
    duration_ms: int,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> list[AsrSegment]:
    """没有可用时间戳时的兜底：按文本长度粗略分配时间。"""
    clean = text.strip()
    if not clean:
        return []

    chunks: list[str] = []
    current = ""
    for char in clean:
        current += char
        if char in PUNCTUATION or len(current) >= max_chars:
            chunks.append(current.strip())
            current = ""
    if current.strip():
        chunks.append(current.strip())

    chunks = [c for c in chunks if c]
    if not chunks:
        return []
    if duration_ms <= 0:
        duration_ms = max(1000, len(clean) * 180)

    total_chars = sum(len(c) for c in chunks)
    cursor = 0
    segments: list[AsrSegment] = []
    for index, chunk in enumerate(chunks):
        if index == len(chunks) - 1:
            end = duration_ms
        else:
            share = len(chunk) / total_chars if total_chars else 1 / len(chunks)
            end = min(duration_ms, cursor + int(round(duration_ms * share)))
        if end <= cursor:
            end = cursor + 100
        segments.append(AsrSegment(start_ms=cursor, end_ms=end, text=chunk))
        cursor = end
    return segments


def _extract_text(output) -> str:
    if output is None:
        return ""
    if isinstance(output, str):
        return output
    text = getattr(output, "text", None)
    if text is not None:
        return str(text)
    if isinstance(output, dict):
        text = output.get("text")
        return "" if text is None else str(text)
    return str(output)


def _extract_timestamps(output) -> list:
    """从 NeMo Hypothesis 里读取 char timestamps。"""
    candidates = []
    if isinstance(output, dict):
        candidates.extend([
            output.get("timestamp"),
            output.get("timestamps"),
            output.get("timestep"),
        ])
    else:
        candidates.extend([
            getattr(output, "timestamp", None),
            getattr(output, "timestamps", None),
            getattr(output, "timestep", None),
        ])

    for candidate in candidates:
        if not candidate:
            continue
        if isinstance(candidate, dict):
            for key in ("char", "chars", "character"):
                value = candidate.get(key)
                if value:
                    return list(value)
        elif isinstance(candidate, list):
            return candidate
    return []


def _transcribe_with_optional_timestamps(model, audio_path: str):
    """调用 NeMo transcribe，按新旧版本能力逐级降级。

    README 只承诺 `transcribe(['speech.wav'])` 可用；timestamps 是尽力启用。
    """
    attempts = [
        {
            "timestamps": True,
            "return_hypotheses": True,
            "batch_size": 1,
        },
        {
            "return_hypotheses": True,
            "batch_size": 1,
            "override_config": {"timestamps": True},
        },
        None,
    ]
    last_type_error: Optional[TypeError] = None
    for index, kwargs in enumerate(attempts, start=1):
        try:
            if kwargs is None:
                debug_log("parakeet_model_transcribe_attempt", attempt=index, kwargs="readme")
                return model.transcribe([audio_path])
            debug_log("parakeet_model_transcribe_attempt", attempt=index, kwargs=kwargs)
            return model.transcribe([audio_path], **kwargs)
        except TypeError as exc:
            debug_exception("parakeet_model_transcribe_type_error", exc, attempt=index)
            last_type_error = exc
    if last_type_error is not None:
        raise last_type_error
    return []


def _cuda_unavailable_reason(torch_module) -> str:
    """解释 torch.cuda.is_available() 为 False 的常见原因。"""
    try:
        cuda_built = bool(torch_module.backends.cuda.is_built())
    except Exception:  # noqa: BLE001
        cuda_built = bool(getattr(getattr(torch_module, "version", None), "cuda", None))

    torch_cuda_version = getattr(getattr(torch_module, "version", None), "cuda", None)
    if not cuda_built or not torch_cuda_version:
        return (
            "当前安装的是 CPU 版 PyTorch，CUDA 不可用。"
            "请安装与显卡驱动匹配的 CUDA 版 torch，例如："
            "pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126"
        )

    try:
        device_count = int(torch_module.cuda.device_count())
    except Exception:  # noqa: BLE001
        device_count = 0
    if device_count <= 0:
        return (
            f"PyTorch 已包含 CUDA {torch_cuda_version}，但未检测到可用 NVIDIA GPU。"
            "请检查显卡驱动、CUDA 运行环境，以及当前 Python 进程是否能访问 GPU。"
        )

    return (
        f"PyTorch 已包含 CUDA {torch_cuda_version} 且检测到 {device_count} 个 GPU，"
        "但 torch.cuda.is_available() 返回 False。请检查驱动版本与 torch CUDA 版本是否匹配。"
    )


class ParakeetEngine(AsrEngine):
    name = "parakeet"

    def __init__(
        self,
        model: str = MODEL_ID,
        device: str = "auto",
        compute_type: Optional[str] = None,
    ) -> None:
        super().__init__(model=model or MODEL_ID, device=device, compute_type=compute_type)
        self._model = None

    @staticmethod
    def is_available() -> bool:
        # Avoid importing NeMo here. Importing nemo.collections.asr is expensive and
        # can initialize CUDA/telemetry before the first transcription job starts.
        return (
            importlib.util.find_spec("nemo") is not None
            and importlib.util.find_spec("torch") is not None
        )

    @staticmethod
    def is_model_downloaded(model: str) -> bool:
        try:
            from huggingface_hub import try_to_load_from_cache
        except ImportError:
            return False
        repo = model or MODEL_ID
        marker = try_to_load_from_cache(repo, MODEL_FILE)
        return isinstance(marker, str) and os.path.exists(marker)

    @staticmethod
    def download_model(
        model: str,
        *,
        progress: Optional[Callable[[int, int], None]] = None,
    ) -> None:
        try:
            import huggingface_hub
        except ImportError as exc:
            raise AsrError("缺少 huggingface_hub，无法下载 Parakeet 模型") from exc

        repo = model or MODEL_ID
        try:
            path = huggingface_hub.snapshot_download(repo)
            if progress is not None:
                total = 0
                for root, _, files in os.walk(path):
                    for file in files:
                        try:
                            total += os.path.getsize(os.path.join(root, file))
                        except OSError:
                            pass
                progress(total, total)
        except Exception as exc:  # noqa: BLE001
            raise AsrError(f"下载 Parakeet 模型失败（{repo}）：{exc}") from exc

    def load(self) -> None:
        if self._model is not None:
            debug_log("parakeet_load_skip_cached", model=self.model, device=self.device)
            return
        try:
            debug_log("parakeet_import_start", model=self.model)
            import nemo.collections.asr as nemo_asr
            import torch
            debug_log(
                "parakeet_import_done",
                torchVersion=getattr(torch, "__version__", None),
                torchCuda=getattr(getattr(torch, "version", None), "cuda", None),
                cudaAvailable=bool(torch.cuda.is_available()),
                cudaDeviceCount=int(torch.cuda.device_count()),
            )
        except ImportError as exc:
            debug_exception("parakeet_import_error", exc)
            raise AsrError(
                "未安装 Parakeet 依赖，请安装 asr-service/requirements-parakeet.txt"
            ) from exc

        try:
            cuda_available = bool(torch.cuda.is_available())
            if self.device == "cuda" and not cuda_available:
                raise AsrError(f"无法使用 CUDA 加速：{_cuda_unavailable_reason(torch)}")

            debug_log("parakeet_from_pretrained_start", model=self.model or MODEL_ID)
            model = nemo_asr.models.ASRModel.from_pretrained(model_name=self.model or MODEL_ID)
            debug_log("parakeet_from_pretrained_done", model=self.model or MODEL_ID)
            if self.device == "cuda" or (self.device == "auto" and cuda_available):
                debug_log("parakeet_move_cuda_start")
                model = model.cuda()
                self.device = "cuda"
                debug_log("parakeet_move_cuda_done")
            else:
                debug_log("parakeet_move_cpu_start")
                model = model.cpu()
                self.device = "cpu"
                debug_log("parakeet_move_cpu_done")
            debug_log("parakeet_eval_start", device=self.device)
            model.eval()
            debug_log("parakeet_eval_done", device=self.device)
            self._model = model
        except AsrError:
            raise
        except Exception as exc:  # noqa: BLE001
            debug_exception("parakeet_load_error", exc, model=self.model)
            raise AsrError(f"加载 Parakeet 模型失败（{self.model}）：{exc}") from exc

    def transcribe(
        self,
        audio_path: str,
        *,
        language: Optional[str] = None,
    ) -> Transcription:
        self.load()
        assert self._model is not None

        duration = _duration_ms(audio_path)
        try:
            debug_log("parakeet_transcribe_start", audioPath=audio_path, durationMs=duration)
            outputs = _transcribe_with_optional_timestamps(self._model, audio_path)
            debug_log("parakeet_transcribe_done", outputCount=len(outputs) if outputs else 0)
        except Exception as exc:
            debug_exception("parakeet_transcribe_error", exc, audioPath=audio_path)
            raise AsrError(f"Parakeet 转录失败：{exc}") from exc

        first = outputs[0] if outputs else None
        text = _extract_text(first)
        timestamps = _extract_timestamps(first)
        debug_log(
            "parakeet_output_extracted",
            textLength=len(text),
            timestampCount=len(timestamps),
        )
        segments = build_segments_from_char_timestamps(
            timestamps,
            text,
            fallback_duration_ms=duration,
        )
        if not segments:
            segments = build_segments_from_text(text, duration_ms=duration)
        debug_log("parakeet_segments_built", segmentCount=len(segments))

        def _iter() -> Iterator[AsrSegment]:
            yield from segments

        return Transcription(
            duration_ms=duration or (segments[-1].end_ms if segments else 0),
            segments=_iter(),
            language="ja",
        )
