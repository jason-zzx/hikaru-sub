"""ASR 引擎抽象与适配器。"""

from .base import AsrEngine, AsrError, AsrSegment, Transcription
from .registry import create_engine, list_engines

__all__ = [
    "AsrEngine",
    "AsrError",
    "AsrSegment",
    "Transcription",
    "create_engine",
    "list_engines",
]
