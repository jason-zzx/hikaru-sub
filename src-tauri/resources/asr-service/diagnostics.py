"""Lightweight JSONL diagnostics for the ASR sidecar.

Logging is enabled only when `HIKARU_ASR_DEBUG_LOG` is set by the Tauri host.
"""

from __future__ import annotations

import json
import os
import threading
import time
import traceback
from pathlib import Path
from typing import Any

_LOG_PATH = os.environ.get("HIKARU_ASR_DEBUG_LOG")
_DETAIL_ENV = os.environ.get("HIKARU_ASR_DEBUG_DETAIL")
_DEFAULT_TRACE_START_MS = 8_000
_DEFAULT_TRACE_END_MS = 14_000
_LOCK = threading.Lock()


def debug_enabled() -> bool:
    return bool(_LOG_PATH)


def debug_detail_enabled() -> bool:
    if not _LOG_PATH:
        return False
    if _DETAIL_ENV is None:
        return True
    return _DETAIL_ENV.strip().lower() not in ("0", "false", "no")


def trace_ms_range() -> tuple[int, int]:
    """关注的时间窗（毫秒），用于 `*_in_trace` 诊断事件。默认 8s–14s（打招呼区）。"""
    raw = (os.environ.get("HIKARU_ASR_TRACE_MS_RANGE") or "").strip()
    if raw and "-" in raw:
        left, right = raw.split("-", 1)
        try:
            return int(left.strip()), int(right.strip())
        except ValueError:
            pass
    return _DEFAULT_TRACE_START_MS, _DEFAULT_TRACE_END_MS


def segment_overlaps_range(segment: Any, range_start_ms: int, range_end_ms: int) -> bool:
    start_ms = getattr(segment, "start_ms", None)
    end_ms = getattr(segment, "end_ms", None)
    if start_ms is None or end_ms is None:
        return False
    return end_ms > range_start_ms and start_ms < range_end_ms


def segments_in_range(
    segments: Any,
    range_start_ms: int,
    range_end_ms: int,
) -> list[Any]:
    return [
        segment
        for segment in segments
        if segment_overlaps_range(segment, range_start_ms, range_end_ms)
    ]


def segment_snapshots(segments: Any) -> list[dict[str, Any]]:
    return [
        {
            "startMs": getattr(segment, "start_ms", None),
            "endMs": getattr(segment, "end_ms", None),
            "text": getattr(segment, "text", ""),
        }
        for segment in segments
    ]


def debug_segments_in_range(event: str, segments: Any, **fields: Any) -> None:
    if not debug_detail_enabled():
        return
    range_start_ms, range_end_ms = trace_ms_range()
    filtered = segments_in_range(segments, range_start_ms, range_end_ms)
    debug_log(
        event,
        traceStartMs=range_start_ms,
        traceEndMs=range_end_ms,
        segmentCount=len(filtered),
        segments=segment_snapshots(filtered),
        **fields,
    )


def debug_segment_range_diff(
    event: str,
    before: Any,
    after: Any,
    **fields: Any,
) -> None:
    if not debug_detail_enabled():
        return
    range_start_ms, range_end_ms = trace_ms_range()
    before_filtered = segments_in_range(before, range_start_ms, range_end_ms)
    after_filtered = segments_in_range(after, range_start_ms, range_end_ms)

    def _keys(items: Any) -> set[tuple[int, int, str]]:
        return {
            (
                getattr(item, "start_ms", -1),
                getattr(item, "end_ms", -1),
                getattr(item, "text", ""),
            )
            for item in items
        }

    before_keys = _keys(before_filtered)
    after_keys = _keys(after_filtered)
    removed = sorted(before_keys - after_keys)
    added = sorted(after_keys - before_keys)
    debug_log(
        event,
        traceStartMs=range_start_ms,
        traceEndMs=range_end_ms,
        beforeCount=len(before_filtered),
        afterCount=len(after_filtered),
        beforeSegments=segment_snapshots(before_filtered),
        afterSegments=segment_snapshots(after_filtered),
        removedSegments=[
            {"startMs": start, "endMs": end, "text": text}
            for start, end, text in removed
        ],
        addedSegments=[
            {"startMs": start, "endMs": end, "text": text}
            for start, end, text in added
        ],
        **fields,
    )


def debug_segments(event: str, segments, **fields: Any) -> None:
    if not debug_detail_enabled():
        return
    debug_log(
        event,
        segmentCount=len(segments),
        segments=[
            {
                "startMs": getattr(segment, "start_ms", None),
                "endMs": getattr(segment, "end_ms", None),
                "text": getattr(segment, "text", ""),
            }
            for segment in segments
        ],
        **fields,
    )


def debug_log(event: str, **fields: Any) -> None:
    if not _LOG_PATH:
        return
    payload = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "mono": round(time.monotonic(), 3),
        "pid": os.getpid(),
        "thread": threading.current_thread().name,
        "event": event,
        **fields,
    }
    try:
        line = json.dumps(payload, ensure_ascii=False, default=str)
        with _LOCK:
            with Path(_LOG_PATH).open("a", encoding="utf-8") as f:
                f.write(f"{line}\n")
    except Exception:
        # Diagnostics must never affect transcription.
        return


def debug_exception(event: str, exc: BaseException, **fields: Any) -> None:
    debug_log(
        event,
        error=repr(exc),
        traceback="".join(traceback.format_exception(type(exc), exc, exc.__traceback__)),
        **fields,
    )
