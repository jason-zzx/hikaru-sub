"""NVIDIA NeMo Parakeet 适配器。

`nvidia/parakeet-tdt_ctc-0.6b-ja` 是日语 ASR 模型，NeMo 可产出时间戳。
该模型的 word/segment 分割对日语字幕不够稳定，所以这里优先读取 char
timestamps，再按日语标点、长度和停顿重新组装字幕段。

引擎无关的分块/合并/组装逻辑已提取到 `engines.chunking`，此处 re-export
以保持外部 import 兼容；backfill 相关私有逻辑保留在本模块。
"""

from __future__ import annotations

from array import array
import math
import os
import wave
import tempfile
import importlib.util
from pathlib import Path
import sys
from typing import Any, Callable, Iterable, Iterator, Optional

from diagnostics import (
    debug_detail_enabled,
    debug_exception,
    debug_log,
    debug_segment_range_diff,
    debug_segments,
    debug_segments_in_range,
    segment_overlaps_range,
    segment_snapshots,
    trace_ms_range,
)
from .base import (
    AsrEngine,
    AsrError,
    AsrSegment,
    TranscriptSegmentRefresh,
    Transcription,
    yield_unseen_segments,
)
from .chunking import (
    CHUNKING_MIN_DURATION_MS,
    DEFAULT_CHUNK_MS,
    DEFAULT_CHUNK_OVERLAP_MS,
    DEFAULT_CLEAR_PAUSE_THRESHOLD_SEC,
    DEFAULT_MAX_CHARS,
    DEFAULT_MAX_DURATION_MS,
    DEFAULT_MIN_CHARS,
    DEFAULT_PAUSE_THRESHOLD_SEC,
    DEDUP_PUNCTUATION,
    JAPANESE_PARTICLE_BREAK_CHARS,
    JAPANESE_SOFT_BREAK_SUFFIXES,
    PUNCTUATION,
    SOFT_BREAK_PUNCTUATION,
    _buffer_duration_ms,
    _buffer_text,
    _dedup_text,
    _duration_ms,
    _find_duplicate_index,
    _find_japanese_soft_break,
    _flush_buffer,
    _is_chunk_overlap_duplicate,
    _japanese_soft_boundary_score,
    _longest_common_text_len,
    _merge_duplicate_segments,
    _merge_overlapping_text,
    _normalize_char_item,
    _overlap_ms,
    _shift_valid_segments,
    _should_split_on_pause,
    _token_to_text,
    _write_wav_chunk,
    build_segments_from_char_timestamps,
    build_segments_from_text,
    apply_gap_backfill,
    dedupe_transcript_segments,
    cuda_unavailable_reason,
    merge_chunk_segments,
    plan_audio_chunks,
)

# 向后兼容：测试与外部代码通过 parakeet._cuda_unavailable_reason 访问。
_cuda_unavailable_reason = cuda_unavailable_reason

MODEL_ID = "nvidia/parakeet-tdt_ctc-0.6b-ja"
MODEL_FILE = "parakeet-tdt_ctc-0.6b-ja.nemo"
DEFAULT_BACKFILL_MIN_GAP_MS = 2_500
DEFAULT_BACKFILL_MIN_UNCOVERED_MS = 1_500
DEFAULT_BACKFILL_PADDING_MS = 0
DEFAULT_BACKFILL_CONTEXT_PADDING_MS = 5_000
DEFAULT_BACKFILL_CONTEXT_PADDING_MAX_MS = 5_000
DEFAULT_BACKFILL_CONTEXT_PADDING_MIN_MS = 400
DEFAULT_BACKFILL_MAX_WINDOW_MS = 30_000
DEFAULT_BACKFILL_ACTIVITY_MAX_COVERAGE_RATIO = 0.85
DEFAULT_BACKFILL_ACTIVITY_FRAME_MS = 100
DEFAULT_BACKFILL_RMS_THRESHOLD = 0.002
DEFAULT_BACKFILL_MIN_ACTIVE_MS = 250


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


def _scan_audio_activity_regions(
    audio_path: str,
    duration_ms: int,
    *,
    frame_ms: int = DEFAULT_BACKFILL_ACTIVITY_FRAME_MS,
    rms_threshold: float = DEFAULT_BACKFILL_RMS_THRESHOLD,
    min_region_ms: int = DEFAULT_BACKFILL_MIN_ACTIVE_MS,
    bridge_gap_ms: int = 300,
) -> list[tuple[int, int]]:
    """扫描整段音频，返回连续有语音能量的时间区间。"""
    if duration_ms <= 0:
        return []
    regions: list[tuple[int, int]] = []
    active_start: Optional[int] = None
    last_active_end = 0
    try:
        with wave.open(audio_path, "rb") as wav:
            rate = wav.getframerate()
            if rate <= 0:
                return []
            sampwidth = wav.getsampwidth()
            frames_per_block = max(1, int(round(rate * frame_ms / 1000)))
            total_frames = wav.getnframes()
            frame_index = 0
            while frame_index < total_frames:
                frame_count = min(frames_per_block, total_frames - frame_index)
                data = wav.readframes(frame_count)
                if not data:
                    break
                time_ms = int(round(frame_index * 1000 / rate))
                frame_end_ms = int(round((frame_index + frame_count) * 1000 / rate))
                frame_index += frame_count
                if _pcm_rms(data, sampwidth) >= rms_threshold:
                    if active_start is None:
                        active_start = time_ms
                    last_active_end = frame_end_ms
                elif active_start is not None and time_ms - last_active_end >= bridge_gap_ms:
                    if last_active_end - active_start >= min_region_ms:
                        regions.append((active_start, last_active_end))
                    active_start = None
            if active_start is not None and last_active_end - active_start >= min_region_ms:
                regions.append((active_start, min(duration_ms, last_active_end)))
    except Exception as exc:  # noqa: BLE001
        debug_exception(
            "parakeet_activity_scan_error",
            exc,
            audioPath=audio_path,
            durationMs=duration_ms,
        )
    return regions


def _subtract_segment_coverage(
    start_ms: int,
    end_ms: int,
    segments: Iterable[AsrSegment],
    *,
    min_remainder_ms: int,
) -> list[tuple[int, int]]:
    """从时间区间内减去已有字幕覆盖部分，返回仍空缺的时间段。"""
    intervals = [(start_ms, end_ms)]
    for seg in sorted(segments, key=lambda item: (item.start_ms, item.end_ms)):
        if seg.end_ms <= seg.start_ms:
            continue
        next_intervals: list[tuple[int, int]] = []
        for interval_start, interval_end in intervals:
            if seg.end_ms <= interval_start or seg.start_ms >= interval_end:
                next_intervals.append((interval_start, interval_end))
                continue
            if interval_start < seg.start_ms:
                next_intervals.append((interval_start, seg.start_ms))
            if seg.end_ms < interval_end:
                next_intervals.append((seg.end_ms, interval_end))
        intervals = next_intervals
    return [
        (interval_start, interval_end)
        for interval_start, interval_end in intervals
        if interval_end - interval_start >= min_remainder_ms
    ]


def _context_padding_ms_for_gap(gap_start_ms: int, gap_end_ms: int) -> int:
    """窄 gap 用紧窗口补转，避免大 padding 把邻句吸进模型注意力。"""
    gap_ms = max(0, gap_end_ms - gap_start_ms)
    if gap_ms <= 0:
        return 0
    adaptive = max(
        DEFAULT_BACKFILL_CONTEXT_PADDING_MIN_MS,
        min(gap_ms // 2 + DEFAULT_BACKFILL_CONTEXT_PADDING_MIN_MS, gap_ms),
    )
    return min(DEFAULT_BACKFILL_CONTEXT_PADDING_MAX_MS, adaptive)


def _filter_backfill_activity_regions(
    regions: Iterable[tuple[int, int]],
    duration_ms: int,
    *,
    max_coverage_ratio: float = DEFAULT_BACKFILL_ACTIVITY_MAX_COVERAGE_RATIO,
) -> list[tuple[int, int]]:
    """过滤几乎覆盖整段的 RMS 活动区（播客底噪会让覆盖率补转失效）。"""
    if duration_ms <= 0:
        return []
    filtered: list[tuple[int, int]] = []
    for start_ms, end_ms in regions:
        if end_ms <= start_ms:
            continue
        if (end_ms - start_ms) / duration_ms >= max_coverage_ratio:
            continue
        filtered.append((start_ms, end_ms))
    return filtered


def _merge_time_intervals(
    intervals: Iterable[tuple[int, int]],
    *,
    bridge_ms: int = 500,
) -> list[tuple[int, int]]:
    ordered = sorted((start, end) for start, end in intervals if end > start)
    if not ordered:
        return []
    merged: list[tuple[int, int]] = [ordered[0]]
    for start, end in ordered[1:]:
        prev_start, prev_end = merged[-1]
        if start <= prev_end + bridge_ms:
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))
    return merged


def _collect_backfill_targets(
    audio_path: str,
    segments: list[AsrSegment],
    duration_ms: int,
    *,
    min_gap_ms: int = DEFAULT_BACKFILL_MIN_GAP_MS,
    min_uncovered_ms: int = DEFAULT_BACKFILL_MIN_UNCOVERED_MS,
) -> list[tuple[int, int]]:
    targets = list(
        _iter_backfill_gaps(
            segments,
            duration_ms,
            min_gap_ms=min_gap_ms,
        )
    )
    for region_start, region_end in _filter_backfill_activity_regions(
        _scan_audio_activity_regions(audio_path, duration_ms),
        duration_ms,
    ):
        targets.extend(
            _subtract_segment_coverage(
                region_start,
                region_end,
                segments,
                min_remainder_ms=min_uncovered_ms,
            )
        )
    # 不桥接相邻空隙：合并后的大窗口会让 Parakeet 在长段里跳过中间短句。
    return _merge_time_intervals(targets, bridge_ms=0)


def _parakeet_merge_observer(
    reason: str,
    existing: AsrSegment,
    shifted: AsrSegment,
    combined: AsrSegment,
) -> None:
    trace_start_ms, trace_end_ms = trace_ms_range()
    debug_log(
        "parakeet_merge_duplicate",
        reason=reason,
        existingStartMs=existing.start_ms,
        existingEndMs=existing.end_ms,
        existingText=existing.text,
        shiftedStartMs=shifted.start_ms,
        shiftedEndMs=shifted.end_ms,
        shiftedText=shifted.text,
        mergedStartMs=combined.start_ms,
        mergedEndMs=combined.end_ms,
        mergedText=combined.text,
        inTraceRange=any(
            segment_overlaps_range(seg, trace_start_ms, trace_end_ms)
            for seg in (existing, shifted, combined)
        ),
    )


def _parakeet_supplemental_append_observer(segment: AsrSegment) -> None:
    trace_start_ms, trace_end_ms = trace_ms_range()
    debug_log(
        "parakeet_supplemental_append",
        startMs=segment.start_ms,
        endMs=segment.end_ms,
        text=segment.text,
        inTraceRange=segment_overlaps_range(segment, trace_start_ms, trace_end_ms),
    )


def _log_trace_intervals(event: str, intervals: Iterable[tuple[int, int]], **fields: Any) -> None:
    if not debug_detail_enabled():
        return
    trace_start_ms, trace_end_ms = trace_ms_range()
    overlapping = [
        {"startMs": start_ms, "endMs": end_ms}
        for start_ms, end_ms in intervals
        if end_ms > trace_start_ms and start_ms < trace_end_ms
    ]
    if not overlapping:
        return
    debug_log(
        event,
        traceStartMs=trace_start_ms,
        traceEndMs=trace_end_ms,
        intervals=overlapping,
        **fields,
    )


def _log_trace_backfill_windows(
    event: str,
    windows: Iterable[tuple[int, int, int, int]],
    **fields: Any,
) -> None:
    if not debug_detail_enabled():
        return
    trace_start_ms, trace_end_ms = trace_ms_range()
    overlapping = [
        {
            "windowStartMs": start_ms,
            "windowEndMs": end_ms,
            "gapStartMs": gap_start_ms,
            "gapEndMs": gap_end_ms,
        }
        for start_ms, end_ms, gap_start_ms, gap_end_ms in windows
        if end_ms > trace_start_ms and start_ms < trace_end_ms
    ]
    if not overlapping:
        return
    debug_log(
        event,
        traceStartMs=trace_start_ms,
        traceEndMs=trace_end_ms,
        windows=overlapping,
        **fields,
    )


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
    targets: Optional[list[tuple[int, int]]] = None,
    min_gap_ms: int = DEFAULT_BACKFILL_MIN_GAP_MS,
    padding_ms: int = DEFAULT_BACKFILL_PADDING_MS,
    max_window_ms: int = DEFAULT_BACKFILL_MAX_WINDOW_MS,
    activity_checker: Callable[[str, int, int], bool] = _has_audio_activity,
) -> list[tuple[int, int, int, int]]:
    if duration_ms <= 0:
        return []
    inner_window_ms = max(1000, max_window_ms - padding_ms * 2)
    windows: list[tuple[int, int, int, int]] = []
    gap_targets = (
        targets
        if targets is not None
        else list(
            _iter_backfill_gaps(
                segments,
                duration_ms,
                min_gap_ms=min_gap_ms,
            )
        )
    )
    for gap_start_ms, gap_end_ms in gap_targets:
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


def _plan_context_backfill_windows(
    audio_path: str,
    segments: list[AsrSegment],
    duration_ms: int,
    *,
    targets: Optional[list[tuple[int, int]]] = None,
    min_gap_ms: int = DEFAULT_BACKFILL_MIN_UNCOVERED_MS,
    max_window_ms: int = DEFAULT_BACKFILL_MAX_WINDOW_MS,
    activity_checker: Callable[[str, int, int], bool] = _has_audio_activity,
) -> list[tuple[int, int, int, int]]:
    """第二轮补转：按 gap 自适应 padding，避免宽窗口吸走邻句。"""
    gap_targets = (
        targets
        if targets is not None
        else list(
            _iter_backfill_gaps(
                segments,
                duration_ms,
                min_gap_ms=min_gap_ms,
            )
        )
    )
    windows: list[tuple[int, int, int, int]] = []
    for gap_start_ms, gap_end_ms in gap_targets:
        padding_ms = _context_padding_ms_for_gap(gap_start_ms, gap_end_ms)
        windows.extend(
            _plan_backfill_windows(
                audio_path,
                segments,
                duration_ms,
                targets=[(gap_start_ms, gap_end_ms)],
                min_gap_ms=0,
                padding_ms=padding_ms,
                max_window_ms=max_window_ms,
                activity_checker=activity_checker,
            )
        )
    return windows


def _clip_backfill_segments_to_gap(
    segments: list[AsrSegment],
    *,
    window_start_ms: int,
    gap_start_ms: int,
    gap_end_ms: int,
    neighbor_ms: int = DEFAULT_BACKFILL_PADDING_MS,
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
            if local_gap_start_ms - end_ms > neighbor_ms:
                continue
            duration_ms = max(100, end_ms - start_ms)
            start_ms = local_gap_start_ms
            end_ms = min(local_gap_end_ms, start_ms + duration_ms)
        elif start_ms >= local_gap_end_ms:
            if start_ms - local_gap_end_ms > neighbor_ms:
                continue
            duration_ms = max(100, end_ms - start_ms)
            end_ms = local_gap_end_ms
            start_ms = max(local_gap_start_ms, end_ms - duration_ms)
        else:
            start_ms = max(start_ms, local_gap_start_ms)
            end_ms = min(end_ms, local_gap_end_ms)

        if end_ms <= start_ms:
            end_ms = min(local_gap_end_ms, start_ms + 100)
        if end_ms > start_ms:
            clipped.append(AsrSegment(start_ms=start_ms, end_ms=end_ms, text=seg.text))
    return clipped


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
        from .hf_download import snapshot_download_repo

        repo = model or MODEL_ID
        try:
            path = snapshot_download_repo(repo)
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
                "未安装 Parakeet 引擎，请运行 ./scripts/setup-asr.sh parakeet "
                "（或 parakeet-cpu / parakeet-cuda）"
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
        merge_observer = _parakeet_merge_observer if debug_detail_enabled() else None

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
                debug_segments(
                    "parakeet_chunk_segments_raw",
                    segments,
                    chunkIndex=index,
                    startMs=start_ms,
                    endMs=end_ms,
                )
                if debug_detail_enabled():
                    trace_start_ms, trace_end_ms = trace_ms_range()
                    if end_ms > trace_start_ms and start_ms < trace_end_ms:
                        absolute_segments = [
                            AsrSegment(
                                start_ms=seg.start_ms + start_ms,
                                end_ms=seg.end_ms + start_ms,
                                text=seg.text,
                            )
                            for seg in segments
                            if seg.end_ms > seg.start_ms and seg.text.strip()
                        ]
                        debug_log(
                            "parakeet_chunk_raw_in_trace",
                            chunkIndex=index,
                            chunkStartMs=start_ms,
                            chunkEndMs=end_ms,
                            traceStartMs=trace_start_ms,
                            traceEndMs=trace_end_ms,
                            segments=segment_snapshots(absolute_segments),
                        )
                chunk_results.append((start_ms, segments))
                merged = merge_chunk_segments(
                    chunk_results,
                    merge_observer=merge_observer,
                )
                debug_segments(
                    "parakeet_chunk_segments_merged",
                    merged,
                    chunkIndex=index,
                    chunkCount=len(chunks),
                )
                debug_segments_in_range(
                    "parakeet_chunk_merged_in_trace",
                    merged,
                    chunkIndex=index,
                    chunkCount=len(chunks),
                )
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

        merged = merge_chunk_segments(
            chunk_results,
            merge_observer=merge_observer,
        )
        debug_segments("parakeet_chunk_segments_final", merged, chunkCount=len(chunks))
        debug_segments_in_range(
            "parakeet_chunk_final_in_trace",
            merged,
            chunkCount=len(chunks),
        )
        backfilled = self._backfill_missing_segments(
            audio_path,
            duration_ms,
            merged,
            cancel_check=cancel_check,
        )
        final = dedupe_transcript_segments(backfilled)
        debug_segment_range_diff(
            "parakeet_dedupe_in_trace",
            backfilled,
            final,
            chunkCount=len(chunks),
        )
        debug_log(
            "parakeet_chunking_done",
            chunkCount=len(chunks),
            segmentCount=len(final),
        )
        debug_segments("parakeet_chunk_segments_after_backfill", final, chunkCount=len(chunks))
        debug_segments_in_range(
            "parakeet_refresh_payload_in_trace",
            final,
            chunkCount=len(chunks),
        )
        yield TranscriptSegmentRefresh(tuple(final))

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
                    neighbor_ms=max(
                        0,
                        gap_start_ms - start_ms,
                        end_ms - gap_end_ms,
                    ),
                )
                if backfilled:
                    if debug_detail_enabled():
                        trace_start_ms, trace_end_ms = trace_ms_range()
                        if end_ms > trace_start_ms and start_ms < trace_end_ms:
                            absolute_segments = [
                                AsrSegment(
                                    start_ms=seg.start_ms + start_ms,
                                    end_ms=seg.end_ms + start_ms,
                                    text=seg.text,
                                )
                                for seg in backfilled
                            ]
                            debug_log(
                                f"{log_prefix}_clipped_in_trace",
                                windowIndex=index,
                                windowStartMs=start_ms,
                                windowEndMs=end_ms,
                                gapStartMs=gap_start_ms,
                                gapEndMs=gap_end_ms,
                                traceStartMs=trace_start_ms,
                                traceEndMs=trace_end_ms,
                                segments=segment_snapshots(absolute_segments),
                            )
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
        merge_observer = _parakeet_merge_observer if debug_detail_enabled() else None
        backfill_targets = _collect_backfill_targets(audio_path, segments, duration_ms)
        gap_windows = _plan_backfill_windows(
            audio_path,
            segments,
            duration_ms,
            targets=backfill_targets,
        )
        activity_regions = _scan_audio_activity_regions(audio_path, duration_ms)
        windows = gap_windows
        if not windows:
            debug_log(
                "parakeet_backfill_skip",
                audioPath=audio_path,
                durationMs=duration_ms,
                segmentCount=len(segments),
                gapWindowCount=len(gap_windows),
                coverageTargetCount=len(backfill_targets),
            )
            return segments

        debug_log(
            "parakeet_backfill_start",
            audioPath=audio_path,
            durationMs=duration_ms,
            windowCount=len(windows),
            coverageTargetCount=len(backfill_targets),
            activityRegionCount=len(activity_regions),
        )
        debug_log(
            "parakeet_backfill_windows",
            windows=[
                {
                    "startMs": start_ms,
                    "endMs": end_ms,
                    "gapStartMs": gap_start_ms,
                    "gapEndMs": gap_end_ms,
                }
                for start_ms, end_ms, gap_start_ms, gap_end_ms in windows
            ],
        )
        debug_segments("parakeet_backfill_input_segments", segments, durationMs=duration_ms)
        debug_segments_in_range(
            "parakeet_backfill_input_in_trace",
            segments,
            durationMs=duration_ms,
        )
        _log_trace_intervals(
            "parakeet_backfill_targets_in_trace",
            backfill_targets,
            durationMs=duration_ms,
        )
        _log_trace_backfill_windows(
            "parakeet_backfill_windows_in_trace",
            windows,
            stage="primary",
        )
        backfill_results = self._transcribe_backfill_windows(
            audio_path,
            windows,
            temp_prefix="hikaru_parakeet_backfill_",
            log_prefix="parakeet_backfill",
            cancel_check=cancel_check,
        )

        append_observer = (
            _parakeet_supplemental_append_observer if debug_detail_enabled() else None
        )
        debug_segments_in_range(
            "parakeet_backfill_before_primary_merge_in_trace",
            segments,
            stage="primary",
        )
        merged = list(segments)
        for (_window_start_ms, _window_end_ms, gap_start_ms, gap_end_ms), (
            chunk_start_ms,
            window_segments,
        ) in zip(windows, backfill_results):
            before_merge = list(merged)
            merged = apply_gap_backfill(
                merged,
                gap_start_ms,
                gap_end_ms,
                chunk_start_ms,
                window_segments,
                overlap_ms=max(DEFAULT_CHUNK_OVERLAP_MS, DEFAULT_BACKFILL_PADDING_MS),
                assemble=False,
                merge_observer=merge_observer,
                append_observer=append_observer,
            )
            if debug_detail_enabled():
                debug_segment_range_diff(
                    "parakeet_primary_gap_merge_in_trace",
                    before_merge,
                    merged,
                    stage="primary",
                    gapStartMs=gap_start_ms,
                    gapEndMs=gap_end_ms,
                )
        debug_segment_range_diff(
            "parakeet_backfill_primary_merge_in_trace",
            segments,
            merged,
            stage="primary",
        )
        debug_segments("parakeet_backfill_after_primary", merged, durationMs=duration_ms)
        context_windows = _plan_context_backfill_windows(
            audio_path,
            merged,
            duration_ms,
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
            _log_trace_backfill_windows(
                "parakeet_backfill_windows_in_trace",
                context_windows,
                stage="context",
            )
            for (window_start_ms, window_end_ms, gap_start_ms, gap_end_ms), (
                chunk_start_ms,
                window_segments,
            ) in zip(context_windows, context_results):
                if debug_detail_enabled():
                    debug_segments_in_range(
                        "parakeet_context_before_merge_in_trace",
                        merged,
                        stage="context",
                        windowStartMs=window_start_ms,
                        windowEndMs=window_end_ms,
                        gapStartMs=gap_start_ms,
                        gapEndMs=gap_end_ms,
                    )
                before_merge = list(merged)
                merged = apply_gap_backfill(
                    merged,
                    gap_start_ms,
                    gap_end_ms,
                    chunk_start_ms,
                    window_segments,
                    overlap_ms=DEFAULT_CHUNK_OVERLAP_MS,
                    assemble=True,
                    merge_observer=merge_observer,
                    append_observer=append_observer,
                )
                if debug_detail_enabled():
                    debug_segment_range_diff(
                        "parakeet_context_merge_in_trace",
                        before_merge,
                        merged,
                        stage="context",
                        windowStartMs=window_start_ms,
                        windowEndMs=window_end_ms,
                        gapStartMs=gap_start_ms,
                        gapEndMs=gap_end_ms,
                        incomingSegments=segment_snapshots(
                            [
                                AsrSegment(
                                    start_ms=seg.start_ms + chunk_start_ms,
                                    end_ms=seg.end_ms + chunk_start_ms,
                                    text=seg.text,
                                )
                                for seg in window_segments
                            ]
                        ),
                    )
            debug_segments("parakeet_backfill_after_context", merged, durationMs=duration_ms)
            debug_segments_in_range(
                "parakeet_backfill_after_context_in_trace",
                merged,
                durationMs=duration_ms,
            )
        debug_log(
            "parakeet_backfill_done",
            windowCount=len(windows),
            beforeSegmentCount=len(segments),
            afterSegmentCount=len(merged),
        )
        debug_segments("parakeet_backfill_output_segments", merged, durationMs=duration_ms)
        return merged
