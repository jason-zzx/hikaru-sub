"""引擎无关的音频分块、片段合并去重与字幕组装工具。

从 parakeet.py 提取，供 Parakeet、Qwen3-ASR 等引擎复用。
所有函数不依赖任何引擎类，纯输入输出。
"""

from __future__ import annotations

import os
import wave
from difflib import SequenceMatcher
from pathlib import Path
from typing import Callable, Iterable, Iterator, Optional

from .base import AsrSegment

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
# 无条件强边界：不依赖后续字符（按长度降序匹配）
JAPANESE_SOFT_BREAK_SUFFIXES = (
    "ですけど",
    "ましたが",
    "ますけど",
    "ですが",
    "なので",
    "ので",
    "から",
    "ですね",
    "ました",
    "です",
    "ます",
    "よね",
    "かな",
)
# 需结合后续文本判定的强边界（易与复合词/接续形混淆）
JAPANESE_CONTEXTUAL_SOFT_BREAK_SUFFIXES: tuple[tuple[str, str], ...] = (
    ("けど", "contextual_kedo"),
    ("では", "contextual_dewa"),
    ("して", "contextual_shite"),
    ("って", "contextual_tte"),
)
JAPANESE_PARTICLE_BREAK_CHARS = set("はがをにでとへもやねよか")
# 助词弱边界：当前字符为助词且后续字符构成固定搭配时不切分
JAPANESE_PARTICLE_CONTINUATIONS: dict[str, tuple[str, ...]] = {
    "で": (
        "も",
        "す",
        "き",
        "きま",
        "は",
        "しょ",
        "しょう",
        # て形「〜んで」接续（飲んでしまう、食べないでいた 等）
        "し",
        "い",
        "あ",
        "お",
        "み",
        "く",
        "も",
        "ほ",
        "か",
        "な",
    ),
    "と": ("い", "こ", "き", "は", "も", "う", "か", "っ"),
    "に": ("は", "も", "ち", "く", "な", "し", "て", "ゃ", "ょ", "っ"),
    "は": ("い", "あ", "ず", "め", "ん"),
    "が": ("ら", "っ", "く", "き"),
    "か": ("な", "ら", "も", "わ", "り"),
    "も": ("う", "ち", "の", "っ"),
    "や": ("っ", "つ", "す", "は"),
    "ね": ("え",),
    "よ": ("う", "り", "っ"),
}
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
    merge_observer: Optional[Callable[[str, AsrSegment, AsrSegment, AsrSegment], None]] = None,
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
        else:
            existing = merged[duplicate_index]
            combined = _merge_duplicate_segments(existing, shifted)
            if merge_observer is not None:
                merge_observer("chunk_overlap", existing, shifted, combined)
            merged[duplicate_index] = combined
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


DEFAULT_GAP_FRAGMENT_DEDUP_LEN = 10
GAP_ASSEMBLE_SHORT_MAX_LEN = 4
SPURIOUS_GAP_FRAGMENT_CORES = frozenset({
    "それ",
    "こちら",
    "それこちら",
})


def _interval_overlap_ms(
    start_a_ms: int,
    end_a_ms: int,
    start_b_ms: int,
    end_b_ms: int,
) -> int:
    return max(0, min(end_a_ms, end_b_ms) - max(start_a_ms, start_b_ms))


def _is_gap_spurious_fragment(text_core: str) -> bool:
    return text_core in SPURIOUS_GAP_FRAGMENT_CORES


def _suffix_after_text_overlap(prefix_core: str, longer_core: str) -> str:
    if not prefix_core or not longer_core:
        return longer_core
    if longer_core in prefix_core:
        return ""
    if prefix_core in longer_core:
        return longer_core[len(prefix_core) :]
    max_overlap = min(len(prefix_core), len(longer_core))
    for size in range(max_overlap, 0, -1):
        if prefix_core[-size:] == longer_core[:size]:
            return longer_core[size:]
    return longer_core


def _merge_overlapping_text(left: str, right: str) -> str:
    left_core = _dedup_text(left)
    right_core = _dedup_text(right)
    if not left_core:
        return right
    if not right_core:
        return left
    if left_core in right_core:
        return right
    if right_core in left_core:
        return left
    max_overlap = min(len(left_core), len(right_core))
    for size in range(max_overlap, 0, -1):
        if left_core[-size:] == right_core[:size]:
            return left_core[:-size] + right
    return left + right


def _merge_duplicate_segments(existing: AsrSegment, candidate: AsrSegment) -> AsrSegment:
    return AsrSegment(
        min(existing.start_ms, candidate.start_ms),
        max(existing.end_ms, candidate.end_ms),
        _merge_overlapping_text(existing.text, candidate.text),
    )


def _is_exact_text_duplicate(left: AsrSegment, right: AsrSegment) -> bool:
    return _dedup_text(left.text) == _dedup_text(right.text)


def _is_suffix_substring_duplicate(earlier: AsrSegment, later: AsrSegment) -> bool:
    earlier_core = _dedup_text(earlier.text)
    later_core = _dedup_text(later.text)
    if not earlier_core or not later_core:
        return False
    if later_core in earlier_core:
        return True
    return (
        len(later_core) <= DEFAULT_GAP_FRAGMENT_DEDUP_LEN
        and earlier_core.endswith(later_core)
    )


def dedupe_transcript_segments(
    segments: list[AsrSegment],
    *,
    overlap_ms: int = DEFAULT_CHUNK_OVERLAP_MS,
) -> list[AsrSegment]:
    ordered = sorted(segments, key=lambda seg: (seg.start_ms, seg.end_ms))
    deduped: list[AsrSegment] = []
    for candidate in ordered:
        if not candidate.text.strip():
            continue
        duplicate_index = _find_duplicate_index(
            deduped,
            candidate,
            overlap_ms=overlap_ms,
        )
        if duplicate_index is None:
            if deduped and _is_suffix_substring_duplicate(deduped[-1], candidate):
                continue
            deduped.append(candidate)
            continue
        existing = deduped[duplicate_index]
        if _is_exact_text_duplicate(existing, candidate) or _is_suffix_substring_duplicate(
            existing,
            candidate,
        ):
            deduped[duplicate_index] = _merge_duplicate_segments(existing, candidate)
            continue
        if _is_suffix_substring_duplicate(candidate, existing):
            continue
        deduped.append(candidate)
    return deduped


def _gap_supersede_zone(
    gap_start_ms: int,
    gap_end_ms: int,
    incoming: list[AsrSegment],
    *,
    nearby_ms: int,
) -> tuple[int, int]:
    if not incoming:
        return gap_start_ms, gap_end_ms
    zone_start_ms = min(gap_start_ms, min(seg.start_ms for seg in incoming))
    zone_end_ms = max(gap_end_ms, max(seg.end_ms for seg in incoming)) + nearby_ms
    return zone_start_ms, zone_end_ms


def _incoming_matches_segment(
    incoming: list[AsrSegment],
    segment: AsrSegment,
) -> bool:
    return any(
        item.start_ms == segment.start_ms
        and item.end_ms == segment.end_ms
        and item.text == segment.text
        for item in incoming
    )


def _incoming_redundant_with_existing(
    segments: list[AsrSegment],
    incoming: list[AsrSegment],
    *,
    overlap_ms: int,
) -> bool:
    incoming_core = "".join(
        _dedup_text(seg.text)
        for seg in sorted(incoming, key=lambda item: item.start_ms)
    )
    if not incoming_core:
        return True
    for segment in segments:
        segment_core = _dedup_text(segment.text)
        if not segment_core:
            continue
        if incoming_core in segment_core:
            if any(_overlap_ms(segment, item) > 0 for item in incoming):
                return True
            gap_ms = min(
                abs(segment.start_ms - incoming[-1].end_ms),
                abs(incoming[0].start_ms - segment.end_ms),
            )
            if gap_ms <= overlap_ms:
                return True
    return False


def _should_supersede_stale_segment(
    segment: AsrSegment,
    *,
    zone_start_ms: int,
    zone_end_ms: int,
    incoming: list[AsrSegment],
    overlap_ms: int,
) -> bool:
    if _incoming_matches_segment(incoming, segment):
        return False

    text_core = _dedup_text(segment.text)
    zone_overlap_ms = _interval_overlap_ms(
        segment.start_ms,
        segment.end_ms,
        zone_start_ms,
        zone_end_ms,
    )
    if zone_overlap_ms > 0:
        if _is_gap_spurious_fragment(text_core):
            return True
        incoming_start_ms = min(seg.start_ms for seg in incoming)
        if segment.start_ms < incoming_start_ms:
            for item in incoming:
                item_core = _dedup_text(item.text)
                if not item_core:
                    continue
                if item_core in text_core or text_core in item_core:
                    return True
                if len(item_core) >= 4 and item_core[: min(4, len(item_core))] in text_core:
                    return True
        return False

    if _is_gap_spurious_fragment(text_core):
        gap_after_ms = segment.start_ms - zone_end_ms
        if 0 <= gap_after_ms <= overlap_ms:
            return True
    return False


def _assemble_incoming_gap_segments(incoming: list[AsrSegment]) -> list[AsrSegment]:
    ordered = sorted(incoming, key=lambda seg: (seg.start_ms, seg.end_ms))
    if not ordered:
        return []
    if len(ordered) == 1:
        return ordered

    short_segments = [
        seg
        for seg in ordered
        if len(_dedup_text(seg.text)) <= DEFAULT_GAP_FRAGMENT_DEDUP_LEN
    ]
    long_segments = [seg for seg in ordered if seg not in short_segments]

    if short_segments and long_segments:
        fragment_start_ms = min(seg.start_ms for seg in short_segments)
        fragment_text = "".join(
            seg.text.strip()
            for seg in sorted(short_segments, key=lambda seg: seg.start_ms)
        )
        anchor = max(long_segments, key=lambda seg: len(_dedup_text(seg.text)))
        anchor_text = anchor.text.strip()
        fragment_core = _dedup_text(fragment_text)
        anchor_core = _dedup_text(anchor_text)
        if anchor.start_ms < fragment_start_ms and "こんばんは" in anchor_core:
            if "こんばんは" not in fragment_core:
                combined_text = fragment_text + anchor_text
            else:
                combined_text = fragment_text + _suffix_after_text_overlap(
                    fragment_core,
                    anchor_core,
                )
        else:
            combined_text = fragment_text + _suffix_after_text_overlap(
                fragment_core,
                anchor_core,
            )
        end_ms = max(seg.end_ms for seg in ordered)
        return [AsrSegment(fragment_start_ms, end_ms, combined_text)]

    if len(short_segments) > 1:
        return [
            AsrSegment(
                min(seg.start_ms for seg in short_segments),
                max(seg.end_ms for seg in short_segments),
                "".join(
                    seg.text.strip()
                    for seg in sorted(short_segments, key=lambda seg: seg.start_ms)
                ),
            ),
        ]

    return ordered


def _should_assemble_gap_incoming(
    incoming: list[AsrSegment],
    *,
    gap_start_ms: int,
    gap_end_ms: int,
    overlap_ms: int,
) -> bool:
    if len(incoming) <= 1:
        return False

    ordered = sorted(incoming, key=lambda seg: (seg.start_ms, seg.end_ms))
    shorts = [
        seg
        for seg in ordered
        if len(_dedup_text(seg.text)) <= GAP_ASSEMBLE_SHORT_MAX_LEN
    ]
    longs = [
        seg
        for seg in ordered
        if len(_dedup_text(seg.text)) > GAP_ASSEMBLE_SHORT_MAX_LEN
    ]

    if shorts and longs:
        earliest_short_ms = min(seg.start_ms for seg in shorts)
        for long_seg in longs:
            if (
                long_seg.start_ms < earliest_short_ms - 100
                and len(_dedup_text(long_seg.text)) >= 4
            ):
                return True
        ordered_shorts = sorted(shorts, key=lambda seg: seg.start_ms)
        for index in range(len(ordered_shorts) - 1):
            left = ordered_shorts[index]
            right = ordered_shorts[index + 1]
            spans_long = any(
                _interval_overlap_ms(
                    long_seg.start_ms,
                    long_seg.end_ms,
                    left.start_ms,
                    right.end_ms,
                )
                > 0
                for long_seg in longs
            )
            if spans_long:
                return False
            has_long_between = any(
                left.end_ms <= long_seg.start_ms and long_seg.end_ms <= right.start_ms
                for long_seg in longs
            )
            if not has_long_between:
                return True
        return False

    return False


def _append_absolute_segments(
    segments: list[AsrSegment],
    incoming: list[AsrSegment],
    *,
    overlap_ms: int,
    merge_observer: Optional[Callable[[str, AsrSegment, AsrSegment, AsrSegment], None]] = None,
    append_observer: Optional[Callable[[AsrSegment], None]] = None,
) -> list[AsrSegment]:
    merged = sorted(segments, key=lambda seg: (seg.start_ms, seg.end_ms))
    for candidate in incoming:
        duplicate_index = _find_duplicate_index(
            merged,
            candidate,
            overlap_ms=overlap_ms,
        )
        if duplicate_index is None:
            merged.append(candidate)
            merged.sort(key=lambda seg: (seg.start_ms, seg.end_ms))
            if append_observer is not None:
                append_observer(candidate)
        else:
            existing = merged[duplicate_index]
            combined = _merge_duplicate_segments(existing, candidate)
            if merge_observer is not None:
                merge_observer("gap_backfill_overlap", existing, candidate, combined)
            merged[duplicate_index] = combined
            merged.sort(key=lambda seg: (seg.start_ms, seg.end_ms))
    return merged


def apply_gap_backfill(
    segments: list[AsrSegment],
    gap_start_ms: int,
    gap_end_ms: int,
    chunk_start_ms: int,
    window_segments: list[AsrSegment],
    *,
    overlap_ms: int,
    assemble: bool = False,
    merge_observer: Optional[Callable[[str, AsrSegment, AsrSegment, AsrSegment], None]] = None,
    append_observer: Optional[Callable[[AsrSegment], None]] = None,
) -> list[AsrSegment]:
    """在 gap 内用 backfill 结果替换主路径残留，context 模式可组装为单条。"""
    incoming = list(_shift_valid_segments(chunk_start_ms, window_segments))
    if not incoming:
        return segments
    if _incoming_redundant_with_existing(segments, incoming, overlap_ms=overlap_ms):
        return segments

    zone_start_ms, zone_end_ms = _gap_supersede_zone(
        gap_start_ms,
        gap_end_ms,
        incoming,
        nearby_ms=overlap_ms,
    )
    kept = [
        segment
        for segment in segments
        if not _should_supersede_stale_segment(
            segment,
            zone_start_ms=zone_start_ms,
            zone_end_ms=zone_end_ms,
            incoming=incoming,
            overlap_ms=overlap_ms,
        )
    ]
    to_add = incoming
    if assemble and _should_assemble_gap_incoming(
        incoming,
        gap_start_ms=gap_start_ms,
        gap_end_ms=gap_end_ms,
        overlap_ms=overlap_ms,
    ):
        to_add = _assemble_incoming_gap_segments(incoming)
    return _append_absolute_segments(
        kept,
        to_add,
        overlap_ms=overlap_ms,
        merge_observer=merge_observer,
        append_observer=append_observer,
    )


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


def _following_buffer_text(
    buffer: list[tuple[str, float, float]],
    index: int,
) -> str:
    return "".join(ch for ch, _, _ in buffer[index + 1 :]).strip()


def _valid_break_after_tte(following: str) -> bool:
    """「って」：引用助词或促音便て形，后续多为いう/も/は等，不宜单独成界。"""
    if not following:
        return False
    if following[0] in "もはい言思感こなあやみっ":
        return False
    blocked = ("いう", "いる", "いえ", "いや", "いっ", "こと", "など", "って")
    return not any(following.startswith(prefix) for prefix in blocked)


def _valid_break_after_shite(following: str) -> bool:
    """「して」：て形接续，需排除している/してしまう等复合，保留紹介して|いきます。"""
    if not following:
        return True
    blocked = (
        "しま",
        "しち",
        "しょ",
        "しゃ",
        "いる",
        "いて",
        "いた",
        "いろ",
        "いれ",
        "いま",
        "ある",
        "あり",
        "あっ",
        "おく",
        "おき",
        "みる",
        "みて",
        "みた",
        "くる",
        "くれ",
        "くれま",
        "もら",
        "もっ",
        "はいけ",
        "はい",
        "はね",
        "はま",
        "しい",
        "から",
        "かわ",
    )
    return not any(following.startswith(prefix) for prefix in blocked)


def _valid_break_after_kedo(following: str) -> bool:
    return not following.startswith("も")


def _valid_break_after_dewa(following: str) -> bool:
    return not following.startswith(("な", "り"))


_CONTEXTUAL_BREAK_VALIDATORS = {
    "contextual_tte": _valid_break_after_tte,
    "contextual_shite": _valid_break_after_shite,
    "contextual_kedo": _valid_break_after_kedo,
    "contextual_dewa": _valid_break_after_dewa,
}


def _matches_contextual_soft_break(text: str, following: str) -> bool:
    for suffix, validator_key in JAPANESE_CONTEXTUAL_SOFT_BREAK_SUFFIXES:
        if text.endswith(suffix):
            return _CONTEXTUAL_BREAK_VALIDATORS[validator_key](following)
    return False


def _is_valid_particle_weak_break(char: str, following: str) -> bool:
    if char not in JAPANESE_PARTICLE_BREAK_CHARS:
        return False
    if not following:
        return True
    blocked = JAPANESE_PARTICLE_CONTINUATIONS.get(char)
    if not blocked:
        return True
    return not any(following.startswith(prefix) for prefix in blocked)


def _japanese_soft_boundary_score(
    text: str,
    char: str,
    *,
    following: str = "",
    allow_contextual: bool = True,
) -> int:
    if char in SOFT_BREAK_PUNCTUATION:
        return 2
    if any(text.endswith(suffix) for suffix in JAPANESE_SOFT_BREAK_SUFFIXES):
        return 2
    if allow_contextual and _matches_contextual_soft_break(text, following):
        return 2
    if _is_valid_particle_weak_break(char, following):
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
        following = _following_buffer_text(buffer, index)
        score = _japanese_soft_boundary_score(
            text.strip(),
            char,
            following=following,
        )
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
    # 短停顿时尚未读入后续字符，仅信任无条件强边界，避免「とって|」类误判
    return _japanese_soft_boundary_score(
        text,
        text[-1],
        following="",
        allow_contextual=False,
    ) >= 2


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


def cuda_unavailable_reason(torch_module) -> str:
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
