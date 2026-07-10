"""Kotoba Whisper v2.0 adapter backed by faster-whisper/CTranslate2."""

from __future__ import annotations

import re
from typing import Callable, Optional

from .base import AsrError
from .faster_whisper import FasterWhisperEngine

MODEL_ID = "kotoba-tech/kotoba-whisper-v2.0-faster"
_MIN_FASTER_WHISPER_VERSION = (1, 1, 1)


def _supports_faster_whisper_version(version: str) -> bool:
    match = re.match(r"^(\d+)\.(\d+)\.(\d+)(.*)$", version)
    if match is None:
        return False
    release = tuple(int(part) for part in match.groups()[:3])
    if release != _MIN_FASTER_WHISPER_VERSION:
        return release > _MIN_FASTER_WHISPER_VERSION
    suffix = match.group(4).lower()
    return not re.search(r"(?:^|[.-])(?:a|b|rc|dev)\d*", suffix)


def _validate_model(model: str) -> str:
    if model != MODEL_ID:
        raise AsrError(
            "kotoba-faster-whisper 首期仅支持模型："
            f"{MODEL_ID}（收到：{model}）"
        )
    return model


class KotobaFasterWhisperEngine(FasterWhisperEngine):
    """Japanese Kotoba model using the shared faster-whisper runtime."""

    name = "kotoba-faster-whisper"
    require_preprocessor_config = True

    @staticmethod
    def is_available() -> bool:
        if not FasterWhisperEngine.is_available():
            return False
        try:
            import faster_whisper
        except ImportError:
            return False
        return _supports_faster_whisper_version(
            getattr(faster_whisper, "__version__", "")
        )

    def __init__(
        self,
        model: str = MODEL_ID,
        device: str = "auto",
        compute_type: Optional[str] = None,
        use_vad: bool = False,
        vad_config: Optional[dict] = None,
    ) -> None:
        super().__init__(
            model=_validate_model(model),
            device=device,
            compute_type=compute_type,
            use_vad=use_vad,
            vad_config=vad_config,
        )

    def load(self) -> None:
        if self._model is not None:
            return
        if not self.is_available():
            raise AsrError(
                "kotoba-faster-whisper 需要 faster-whisper>=1.1.1，"
                "请重新配置当前引擎依赖"
            )
        super().load()

    @classmethod
    def is_model_downloaded(cls, model: str) -> bool:
        if model != MODEL_ID:
            return False
        return super().is_model_downloaded(model)

    @staticmethod
    def download_model(
        model: str,
        *,
        progress: Optional[Callable[[int, int], None]] = None,
    ) -> None:
        FasterWhisperEngine.download_model(
            _validate_model(model),
            progress=progress,
        )

    def _transcribe_options(self) -> dict:
        return {
            "chunk_length": 15,
            "condition_on_previous_text": False,
        }
