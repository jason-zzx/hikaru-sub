"""NVIDIA NeMo Parakeet 适配器。

`nvidia/parakeet-tdt_ctc-0.6b-ja` 是日语 ASR 模型，NeMo 可产出时间戳。
该模型的 word/segment 分割对日语字幕不够稳定，所以这里优先读取 char
timestamps，再按日语标点、长度和停顿重新组装字幕段。
"""

from __future__ import annotations

from array import array
import math
import os
import wave
import tempfile
import importlib.util
from difflib import SequenceMatcher
from pathlib import Path
import sys
from typing import Callable, Iterable, Iterator, Optional

from diagnostics import debug_exception, debug_log
from .base import AsrEngine, AsrError, AsrSegment, Transcription, yield_unseen_segments

MODEL_ID = "nvidia/parakeet-tdt_ctc-0.6b-ja"
MODEL_FILE = "parakeet-tdt_ctc-0.6b-ja.nemo"
PUNCTUATION = set("。！？!?…")
SOFT_BREAK_PUNCTUATION = set("、，,；;：:")
DEFAULT_MAX_CHARS = 40
DEFAULT_MIN_CHARS = 8
DEFAULT_PAUSE_THRESHOLD_SEC = 0.1
DEFAULT_MAX_DURATION_MS = 5000
DEFAULT_CHUNK_MS = 45_000
DEFAULT_CHUNK_OVERLAP_MS = 2_000
CHUNKING_MIN_DURATION_MS = 60_000
DEFAULT_CLEAR_PAUSE_THRESHOLD_SEC = 0.45
DEFAULT_BACKFILL_MIN_GAP_MS = 6_000
DEFAULT_BACKFILL_PADDING_MS = 0
DEFAULT_BACKFILL_CONTEXT_PADDING_MS = 5_000
DEFAULT_BACKFILL_MAX_WINDOW_MS = 30_000
DEFAULT_BACKFILL_ACTIVITY_FRAME_MS = 100
DEFAULT_BACKFILL_RMS_THRESHOLD = 0.002
DEFAULT_BACKFILL_MIN_ACTIVE_MS = 250
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
DEDUP_PUNCTUATION = PUNCTUATION | SOFT_BREAK_PUNCTUATION | set(" \t\r\n　")


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


def plan_audio_chunks(
    duration_ms: int,
    *,
    chunk_ms: int = DEFAULT_CHUNK_MS,
    overlap_ms: int = DEFAULT_CHUNK_OVERLAP_MS,
    min_chunking_duration_ms: int = CHUNKING_MIN_DURATION_MS,
) -> list[tuple[int, int]]:
    if duration_ms <= 0:
        return [(0, 0)]
    if chunk_ms <= 0 or duration_ms < min_chunking_duration_ms or duration_ms <= chunk_ms:
        return [(0, duration_ms)]
    overlap_ms = max(0, min(overlap_ms, chunk_ms - 1))
    step_ms = chunk_ms - overlap_ms
    chunks: list[tuple[int, int]] = []
    start = 0
    while start < duration_ms:
        end = min(duration_ms, start + chunk_ms)
        chunks.append((start, end))
        if end >= duration_ms:
            break
        start += step_ms
    return chunks


def _write_wav_chunk(source_path: str, output_path: Path, start_ms: int, end_ms: int) -> None:
    with wave.open(source_path, "rb") as src:
        rate = src.getframerate()
        channels = src.getnchannels()
        sampwidth = src.getsampwidth()
        start_frame = max(0, int(round(start_ms * rate / 1000)))
        end_frame = max(start_frame, int(round(end_ms * rate / 1000)))
        src.setpos(min(start_frame, src.getnframes()))
        data = src.readframes(max(0, min(end_frame, src.getnframes()) - start_frame))
    with wave.open(str(output_path), "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(sampwidth)
        out.setframerate(rate)
        out.writeframes(data)


def _pcm_rms(data: bytes, sampwidth: int) -> float:
    if not data or sampwidth <= 0:
        return 0.0
    if sampwidth == 2:
        sample_count = len(data) // 2
        if sample_count <= 0:
            return 0.0
        samples = array("h")
        samples.frombytes(data[: sample_count * 2])
        if sys.byteorder != "little":
            samples.byteswap()
        total = sum(sample * sample for sample in samples)
        return math.sqrt(total / len(samples)) / 32768.0

    sample_count = len(data) // sampwidth
    if sample_count <= 0:
        return 0.0
    total = 0
    signed = sampwidth > 1
    midpoint = 128 if sampwidth == 1 else 0
    max_value = 128.0 if sampwidth == 1 else float(1 << (sampwidth * 8 - 1))
    for offset in range(0, sample_count * sampwidth, sampwidth):
        sample = int.from_bytes(data[offset : offset + sampwidth], "little", signed=signed)
        total += (sample - midpoint) * (sample - midpoint)
    return math.sqrt(total / sample_count) / max_value


def _has_audio_activity(
    audio_path: str,
    start_ms: int,
    end_ms: int,
    *,
    frame_ms: int = DEFAULT_BACKFILL_ACTIVITY_FRAME_MS,
    rms_threshold: float = DEFAULT_BACKFILL_RMS_THRESHOLD,
    min_active_ms: int = DEFAULT_BACKFILL_MIN_ACTIVE_MS,
) -> bool:
    if end_ms <= start_ms:
        return False
    try:
        with wave.open(audio_path, "rb") as wav:
            rate = wav.getframerate()
            if rate <= 0:
                return False
            sampwidth = wav.getsampwidth()
            start_frame = max(0, int(round(start_ms * rate / 1000)))
            end_frame = min(wav.getnframes(), int(round(end_ms * rate / 1000)))
            if end_frame <= start_frame:
                return False
            frames_per_block = max(1, int(round(rate * frame_ms / 1000)))
            wav.setpos(start_frame)
            remaining = end_frame - start_frame
            active_ms = 0
            while remaining > 0:
                frame_count = min(frames_per_block, remaining)
                data = wav.readframes(frame_count)
                if not data:
                    break
                if _pcm_rms(data, sampwidth) >= rms_threshold:
                    active_ms += int(round(frame_count * 1000 / rate))
                    if active_ms >= min_active_ms:
                        return True
                remaining -= frame_count
    except Exception as exc:  # noqa: BLE001
        debug_exception(
            "parakeet_backfill_activity_check_error",
            exc,
            audioPath=audio_path,
            startMs=start_ms,
            endMs=end_ms,
        )
    return False


def _iter_backfill_gaps(
    segments: Iterable[AsrSegment],
    duration_ms: int,
    *,
    min_gap_ms: int = DEFAULT_BACKFILL_MIN_GAP_MS,
) -> Iterator[tuple[int, int]]:
    if duration_ms <= 0:
        return
    cursor = 0
    ordered = sorted(
        (seg for seg in segments if seg.end_ms > seg.start_ms),
        key=lambda seg: (seg.start_ms, seg.end_ms),
    )
    for seg in ordered:
        start = max(0, min(seg.start_ms, duration_ms))
        if start - cursor >= min_gap_ms:
            yield cursor, start
        cursor = max(cursor, min(seg.end_ms, duration_ms))
    if duration_ms - cursor >= min_gap_ms:
        yield cursor, duration_ms


def _plan_backfill_windows(
    audio_path: str,
    segments: list[AsrSegment],
    duration_ms: int,
    *,
    min_gap_ms: int = DEFAULT_BACKFILL_MIN_GAP_MS,
    padding_ms: int = DEFAULT_BACKFILL_PADDING_MS,
    max_window_ms: int = DEFAULT_BACKFILL_MAX_WINDOW_MS,
    activity_checker: Callable[[str, int, int], bool] = _has_audio_activity,
) -> list[tuple[int, int, int, int]]:
    if duration_ms <= 0:
        return []
    inner_window_ms = max(1000, max_window_ms - padding_ms * 2)
    windows: list[tuple[int, int, int, int]] = []
    for gap_start_ms, gap_end_ms in _iter_backfill_gaps(
        segments,
        duration_ms,
        min_gap_ms=min_gap_ms,
    ):
        cursor = gap_start_ms
        while cursor < gap_end_ms:
            inner_end_ms = min(gap_end_ms, cursor + inner_window_ms)
            if activity_checker(audio_path, cursor, inner_end_ms):
                windows.append((
                    max(0, cursor - padding_ms),
                    min(duration_ms, inner_end_ms + padding_ms),
                    cursor,
                    inner_end_ms,
                ))
            if inner_end_ms >= gap_end_ms:
                break
            cursor = inner_end_ms
    return windows


def _clip_backfill_segments_to_gap(
    segments: list[AsrSegment],
    *,
    window_start_ms: int,
    gap_start_ms: int,
    gap_end_ms: int,
) -> list[AsrSegment]:
    local_gap_start_ms = max(0, gap_start_ms - window_start_ms)
    local_gap_end_ms = max(local_gap_start_ms, gap_end_ms - window_start_ms)
    clipped: list[AsrSegment] = []
    for seg in segments:
        if seg.end_ms <= seg.start_ms or not seg.text.strip():
            continue
        start_ms = seg.start_ms
        end_ms = seg.end_ms
        if end_ms <= local_gap_start_ms:
            if local_gap_start_ms - end_ms > DEFAULT_BACKFILL_PADDING_MS:
                continue
            duration_ms = max(100, end_ms - start_ms)
            start_ms = local_gap_start_ms
            end_ms = min(local_gap_end_ms, start_ms + duration_ms)
        elif start_ms >= local_gap_end_ms:
            continue
        else:
            start_ms = max(start_ms, local_gap_start_ms)
            end_ms = min(end_ms, local_gap_end_ms)

        if end_ms <= start_ms:
            end_ms = min(local_gap_end_ms, start_ms + 100)
        if end_ms > start_ms:
            clipped.append(AsrSegment(start_ms=start_ms, end_ms=end_ms, text=seg.text))
    return clipped


def _dedup_text(text: str) -> str:
    return "".join(ch for ch in text.strip() if ch not in DEDUP_PUNCTUATION)


def _overlap_ms(left: AsrSegment, right: AsrSegment) -> int:
    return max(0, min(left.end_ms, right.end_ms) - max(left.start_ms, right.start_ms))


def _longest_common_text_len(left: str, right: str) -> int:
    matcher = SequenceMatcher(None, left, right)
    return max((block.size for block in matcher.get_matching_blocks()), default=0)


def _is_chunk_overlap_duplicate(
    existing: AsrSegment,
    shifted: AsrSegment,
    *,
    overlap_ms: int,
) -> bool:
    existing_text = _dedup_text(existing.text)
    shifted_text = _dedup_text(shifted.text)
    if not existing_text or not shifted_text:
        return False

    overlap = _overlap_ms(existing, shifted)
    near_start = abs(existing.start_ms - shifted.start_ms) <= overlap_ms
    if existing_text == shifted_text:
        return overlap > 0 or near_start

    if overlap <= 0:
        return False

    shorter_len = min(len(existing_text), len(shifted_text))
    if shorter_len < 6:
        return False

    if existing_text in shifted_text or shifted_text in existing_text:
        return True

    ratio = SequenceMatcher(None, existing_text, shifted_text).ratio()
    if ratio >= 0.82:
        return True

    common_len = _longest_common_text_len(existing_text, shifted_text)
    return common_len >= 6 and common_len / shorter_len >= 0.7


def _prefer_shifted_duplicate(existing: AsrSegment, shifted: AsrSegment) -> bool:
    return len(_dedup_text(shifted.text)) > len(_dedup_text(existing.text))


def merge_chunk_segments(
    chunk_segments: Iterable[tuple[int, list[AsrSegment]]],
    *,
    overlap_ms: int = DEFAULT_CHUNK_OVERLAP_MS,
) -> list[AsrSegment]:
    shifted_segments: list[AsrSegment] = []
    for chunk_start_ms, segments in chunk_segments:
        for seg in segments:
            shifted = AsrSegment(
                start_ms=seg.start_ms + chunk_start_ms,
                end_ms=seg.end_ms + chunk_start_ms,
                text=seg.text,
            )
            if shifted.end_ms > shifted.start_ms and shifted.text.strip():
                shifted_segments.append(shifted)
    shifted_segments.sort(key=lambda s: (s.start_ms, s.end_ms))

    merged: list[AsrSegment] = []
    for shifted in shifted_segments:
        duplicate_index: Optional[int] = None
        replace_duplicate = False
        first_recent_index = max(0, len(merged) - 8)
        for index in range(len(merged) - 1, first_recent_index - 1, -1):
            existing = merged[index]
            if _is_chunk_overlap_duplicate(
                existing,
                shifted,
                overlap_ms=overlap_ms,
            ):
                duplicate_index = index
                replace_duplicate = _prefer_shifted_duplicate(existing, shifted)
                break
        if duplicate_index is None:
            merged.append(shifted)
        elif replace_duplicate:
            merged[duplicate_index] = shifted
    merged.sort(key=lambda s: (s.start_ms, s.end_ms))
    return merged


def _shift_valid_segments(
    chunk_start_ms: int,
    segments: Iterable[AsrSegment],
) -> Iterator[AsrSegment]:
    for seg in segments:
        shifted = AsrSegment(
            start_ms=seg.start_ms + chunk_start_ms,
            end_ms=seg.end_ms + chunk_start_ms,
            text=seg.text,
        )
        if shifted.end_ms > shifted.start_ms and shifted.text.strip():
            yield shifted


def _find_duplicate_index(
    segments: list[AsrSegment],
    candidate: AsrSegment,
    *,
    overlap_ms: int,
) -> Optional[int]:
    for index, existing in enumerate(segments):
        if existing.end_ms < candidate.start_ms - overlap_ms:
            continue
        if existing.start_ms > candidate.end_ms + overlap_ms:
            break
        if _is_chunk_overlap_duplicate(existing, candidate, overlap_ms=overlap_ms):
            return index
    return None


def _merge_supplemental_segments(
    base_segments: list[AsrSegment],
    supplemental_segments: Iterable[tuple[int, list[AsrSegment]]],
    *,
    overlap_ms: int,
) -> list[AsrSegment]:
    merged = sorted(base_segments, key=lambda s: (s.start_ms, s.end_ms))
    for chunk_start_ms, segments in supplemental_segments:
        for shifted in _shift_valid_segments(chunk_start_ms, segments):
            duplicate_index = _find_duplicate_index(
                merged,
                shifted,
                overlap_ms=overlap_ms,
            )
            if duplicate_index is None:
                merged.append(shifted)
                merged.sort(key=lambda s: (s.start_ms, s.end_ms))
            elif _prefer_shifted_duplicate(merged[duplicate_index], shifted):
                merged[duplicate_index] = shifted
                merged.sort(key=lambda s: (s.start_ms, s.end_ms))
    return merged


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


def _should_split_on_pause(
    buffer: list[tuple[str, float, float]],
    gap_sec: float,
    *,
    pause_threshold_sec: float,
) -> bool:
    if gap_sec < pause_threshold_sec:
        return False
    if gap_sec >= max(pause_threshold_sec, DEFAULT_CLEAR_PAUSE_THRESHOLD_SEC):
        return True
    text = _buffer_text(buffer)
    if not text:
        return False
    return _japanese_soft_boundary_score(text, text[-1]) >= 2


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
        if previous_end is not None and _should_split_on_pause(
            buffer,
            start - previous_end,
            pause_threshold_sec=pause_threshold_sec,
        ):
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
        use_vad: bool = False,
        vad_config: Optional[dict] = None,
    ) -> None:
        super().__init__(
            model=model or MODEL_ID,
            device=device,
            compute_type=compute_type,
            use_vad=use_vad,
            vad_config=vad_config,
        )
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
        cancel_check: Optional[Callable[[], bool]] = None,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> Transcription:
        self.load()
        assert self._model is not None

        duration = _duration_ms(audio_path)
        if duration >= CHUNKING_MIN_DURATION_MS or self.use_vad:
            debug_log("parakeet_chunked_transcribe_start", audioPath=audio_path, durationMs=duration)

            def _iter_chunked() -> Iterator[AsrSegment]:
                yield from self._iter_transcribe_chunks(
                    audio_path,
                    duration,
                    cancel_check=cancel_check,
                    progress_callback=progress_callback,
                )

            return Transcription(
                duration_ms=duration,
                segments=_iter_chunked(),
                language="ja",
            )

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
            for seg in segments:
                if cancel_check and cancel_check():
                    return
                yield seg

        return Transcription(
            duration_ms=duration or (segments[-1].end_ms if segments else 0),
            segments=_iter(),
            language="ja",
        )

    def _transcribe_one_audio(self, audio_path: str, duration_ms: int) -> list[AsrSegment]:
        outputs = _transcribe_with_optional_timestamps(self._model, audio_path)
        first = outputs[0] if outputs else None
        text = _extract_text(first)
        timestamps = _extract_timestamps(first)
        debug_log(
            "parakeet_chunk_output_extracted",
            audioPath=audio_path,
            textLength=len(text),
            timestampCount=len(timestamps),
        )
        segments = build_segments_from_char_timestamps(
            timestamps,
            text,
            fallback_duration_ms=duration_ms,
        )
        if not segments:
            segments = build_segments_from_text(text, duration_ms=duration_ms)
        return segments

    def _transcribe_chunks(self, audio_path: str, duration_ms: int) -> list[AsrSegment]:
        return list(self._iter_transcribe_chunks(audio_path, duration_ms))

    def _iter_transcribe_chunks(
        self,
        audio_path: str,
        duration_ms: int,
        *,
        cancel_check: Optional[Callable[[], bool]] = None,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> Iterator[AsrSegment]:
        chunks = self._plan_transcribe_chunks(audio_path, duration_ms)
        chunk_results: list[tuple[int, list[AsrSegment]]] = []
        yielded: set[tuple[int, int, str]] = set()

        with tempfile.TemporaryDirectory(prefix="hikaru_parakeet_") as tmp:
            tmp_dir = Path(tmp)
            for index, (start_ms, end_ms) in enumerate(chunks, start=1):
                if cancel_check and cancel_check():
                    debug_log(
                        "parakeet_chunk_cancelled",
                        chunkIndex=index,
                        chunkCount=len(chunks),
                    )
                    break
                chunk_path = tmp_dir / f"chunk_{index:04d}.wav"
                _write_wav_chunk(audio_path, chunk_path, start_ms, end_ms)
                debug_log(
                    "parakeet_chunk_transcribe_start",
                    chunkIndex=index,
                    chunkCount=len(chunks),
                    startMs=start_ms,
                    endMs=end_ms,
                    path=str(chunk_path),
                )
                try:
                    segments = self._transcribe_one_audio(
                        str(chunk_path),
                        end_ms - start_ms,
                    )
                except Exception as exc:
                    debug_exception(
                        "parakeet_chunk_transcribe_error",
                        exc,
                        chunkIndex=index,
                        startMs=start_ms,
                        endMs=end_ms,
                    )
                    raise
                debug_log(
                    "parakeet_chunk_transcribe_done",
                    chunkIndex=index,
                    startMs=start_ms,
                    endMs=end_ms,
                    segmentCount=len(segments),
                )
                chunk_results.append((start_ms, segments))
                merged = merge_chunk_segments(chunk_results)
                yield from yield_unseen_segments(yielded, merged)
                if progress_callback:
                    progress_callback(end_ms)

        if cancel_check and cancel_check():
            debug_log(
                "parakeet_chunking_cancelled",
                chunkCount=len(chunks),
                segmentCount=len(yielded),
            )
            return

        merged = merge_chunk_segments(chunk_results)
        final = self._backfill_missing_segments(
            audio_path,
            duration_ms,
            merged,
            cancel_check=cancel_check,
        )
        debug_log(
            "parakeet_chunking_done",
            chunkCount=len(chunks),
            segmentCount=len(final),
        )
        yield from yield_unseen_segments(yielded, final)

    def _plan_transcribe_chunks(
        self,
        audio_path: str,
        duration_ms: int,
    ) -> list[tuple[int, int]]:
        if self.use_vad:
            try:
                from .vad import VadEngine, split_long_segments

                vad = VadEngine()
                speech_segments = vad.detect_speech_segments(
                    audio_path,
                    threshold=self.vad_config.get('threshold', 0.5),
                    min_speech_duration_ms=self.vad_config.get('min_speech_duration_ms', 500),
                    min_silence_duration_ms=self.vad_config.get('min_silence_duration_ms', 300),
                    speech_pad_ms=self.vad_config.get('speech_pad_ms', 400),
                )

                chunks = split_long_segments(
                    speech_segments,
                    max_duration_ms=self.vad_config.get('max_segment_duration_ms', 25_000),
                    overlap_ms=DEFAULT_CHUNK_OVERLAP_MS,
                )

                debug_log(
                    "parakeet_vad_chunking",
                    audioPath=audio_path,
                    durationMs=duration_ms,
                    speechSegmentCount=len(speech_segments),
                    chunkCount=len(chunks),
                )
                return chunks
            except Exception as exc:
                debug_exception("parakeet_vad_error", exc, audioPath=audio_path)
                chunks = plan_audio_chunks(duration_ms)
                debug_log(
                    "parakeet_vad_fallback_to_fixed",
                    audioPath=audio_path,
                    durationMs=duration_ms,
                    chunkCount=len(chunks),
                )
                return chunks

        chunks = plan_audio_chunks(duration_ms)
        debug_log(
            "parakeet_chunking_start",
            audioPath=audio_path,
            durationMs=duration_ms,
            chunkCount=len(chunks),
            chunkMs=DEFAULT_CHUNK_MS,
            overlapMs=DEFAULT_CHUNK_OVERLAP_MS,
        )
        return chunks

    def _transcribe_backfill_windows(
        self,
        audio_path: str,
        windows: list[tuple[int, int, int, int]],
        *,
        temp_prefix: str,
        log_prefix: str,
        cancel_check: Optional[Callable[[], bool]] = None,
    ) -> list[tuple[int, list[AsrSegment]]]:
        backfill_results: list[tuple[int, list[AsrSegment]]] = []
        with tempfile.TemporaryDirectory(prefix=temp_prefix) as tmp:
            tmp_dir = Path(tmp)
            for index, (start_ms, end_ms, gap_start_ms, gap_end_ms) in enumerate(
                windows,
                start=1,
            ):
                if cancel_check and cancel_check():
                    debug_log(
                        f"{log_prefix}_cancelled",
                        windowIndex=index,
                        windowCount=len(windows),
                    )
                    break
                chunk_path = tmp_dir / f"backfill_{index:04d}.wav"
                _write_wav_chunk(audio_path, chunk_path, start_ms, end_ms)
                debug_log(
                    f"{log_prefix}_transcribe_start",
                    windowIndex=index,
                    windowCount=len(windows),
                    startMs=start_ms,
                    endMs=end_ms,
                    gapStartMs=gap_start_ms,
                    gapEndMs=gap_end_ms,
                    path=str(chunk_path),
                )
                try:
                    backfilled = self._transcribe_one_audio(
                        str(chunk_path),
                        end_ms - start_ms,
                    )
                except Exception as exc:
                    debug_exception(
                        f"{log_prefix}_transcribe_error",
                        exc,
                        windowIndex=index,
                        startMs=start_ms,
                        endMs=end_ms,
                    )
                    continue
                debug_log(
                    f"{log_prefix}_transcribe_done",
                    windowIndex=index,
                    startMs=start_ms,
                    endMs=end_ms,
                    segmentCount=len(backfilled),
                )
                backfilled = _clip_backfill_segments_to_gap(
                    backfilled,
                    window_start_ms=start_ms,
                    gap_start_ms=gap_start_ms,
                    gap_end_ms=gap_end_ms,
                )
                if backfilled:
                    backfill_results.append((start_ms, backfilled))
        return backfill_results

    def _backfill_missing_segments(
        self,
        audio_path: str,
        duration_ms: int,
        segments: list[AsrSegment],
        *,
        cancel_check: Optional[Callable[[], bool]] = None,
    ) -> list[AsrSegment]:
        windows = _plan_backfill_windows(audio_path, segments, duration_ms)
        if not windows:
            debug_log(
                "parakeet_backfill_skip",
                audioPath=audio_path,
                durationMs=duration_ms,
                segmentCount=len(segments),
            )
            return segments

        debug_log(
            "parakeet_backfill_start",
            audioPath=audio_path,
            durationMs=duration_ms,
            windowCount=len(windows),
        )
        backfill_results = self._transcribe_backfill_windows(
            audio_path,
            windows,
            temp_prefix="hikaru_parakeet_backfill_",
            log_prefix="parakeet_backfill",
            cancel_check=cancel_check,
        )

        merged = _merge_supplemental_segments(
            segments,
            backfill_results,
            overlap_ms=max(DEFAULT_CHUNK_OVERLAP_MS, DEFAULT_BACKFILL_PADDING_MS),
        )
        context_windows = _plan_backfill_windows(
            audio_path,
            merged,
            duration_ms,
            padding_ms=DEFAULT_BACKFILL_CONTEXT_PADDING_MS,
        )
        if context_windows:
            debug_log(
                "parakeet_backfill_context_start",
                audioPath=audio_path,
                durationMs=duration_ms,
                windowCount=len(context_windows),
                paddingMs=DEFAULT_BACKFILL_CONTEXT_PADDING_MS,
            )
            context_results = self._transcribe_backfill_windows(
                audio_path,
                context_windows,
                temp_prefix="hikaru_parakeet_backfill_context_",
                log_prefix="parakeet_backfill_context",
                cancel_check=cancel_check,
            )
            merged = _merge_supplemental_segments(
                merged,
                context_results,
                overlap_ms=DEFAULT_CHUNK_OVERLAP_MS,
            )
        debug_log(
            "parakeet_backfill_done",
            windowCount=len(windows),
            beforeSegmentCount=len(segments),
            afterSegmentCount=len(merged),
        )
        return merged
