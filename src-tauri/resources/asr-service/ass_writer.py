"""Minimal ASS writer used as a sidecar-side recovery output."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

from engines.base import AsrSegment

STYLE_FORMAT = (
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
    "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, "
    "ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
    "MarginL, MarginR, MarginV, Encoding"
)
EVENT_FORMAT = (
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
)

PRIMARY_STYLE = (
    "Style: Primary,Noto Sans SC,54,&H00FFFFFF,&H000000FF,&H00000000,"
    "&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,40,1"
)
SECONDARY_STYLE = (
    "Style: Secondary,Noto Sans SC,44,&H0000F5F5,&H000000FF,&H00000000,"
    "&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,95,1"
)


def _format_ass_time(total_ms: int) -> str:
    clamped = max(0, round(total_ms))
    centiseconds = round(clamped / 10)
    hours = centiseconds // 360000
    minutes = (centiseconds % 360000) // 6000
    seconds = (centiseconds % 6000) // 100
    cs = centiseconds % 100
    return f"{hours}:{minutes:02d}:{seconds:02d}.{cs:02d}"


def _to_ass_text(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", r"\N")


def serialize_segments_to_ass(
    segments: Iterable[AsrSegment],
    *,
    title: str = "Hikaru-Sub",
    res_x: int = 1920,
    res_y: int = 1080,
) -> str:
    lines = [
        "[Script Info]",
        f"Title: {title}",
        "ScriptType: v4.00+",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        f"PlayResX: {res_x}",
        f"PlayResY: {res_y}",
        "",
        "[V4+ Styles]",
        STYLE_FORMAT,
        PRIMARY_STYLE,
        SECONDARY_STYLE,
        "",
        "[Events]",
        EVENT_FORMAT,
    ]
    for seg in segments:
        text = _to_ass_text(seg.text.strip())
        if not text:
            continue
        start = _format_ass_time(seg.start_ms)
        end = _format_ass_time(seg.end_ms)
        lines.append(f"Dialogue: 0,{start},{end},Primary,,0,0,0,,{text}")
    return "\n".join(lines) + "\n"


def write_ass_file(path: str | Path, segments: Iterable[AsrSegment]) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    text = serialize_segments_to_ass(segments)
    tmp = output.with_name(f"{output.name}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(output)
