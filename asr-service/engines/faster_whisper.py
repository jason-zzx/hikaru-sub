"""faster-whisper 适配器（首个 ASR 引擎实现）。

依赖通过惰性导入，未安装 faster-whisper 时服务仍可启动，
仅在真正转录或查询可用性时反馈缺失。
"""

from __future__ import annotations

from typing import Iterator, Optional

from .base import AsrEngine, AsrError, AsrSegment, Transcription


def _resolve_compute_type(device: str, compute_type: Optional[str]) -> str:
    """未显式指定时按设备推导 CTranslate2 计算精度。"""
    if compute_type and compute_type not in ("auto", "default"):
        return compute_type
    if device == "cpu":
        return "int8"
    if device == "cuda":
        return "float16"
    # device == "auto"：交给 CTranslate2 自行决定
    return "default"


class FasterWhisperEngine(AsrEngine):
    name = "faster-whisper"

    def __init__(
        self,
        model: str = "large-v3",
        device: str = "auto",
        compute_type: Optional[str] = None,
    ) -> None:
        super().__init__(model=model, device=device, compute_type=compute_type)
        self._model = None

    @staticmethod
    def is_available() -> bool:
        try:
            import faster_whisper  # noqa: F401

            return True
        except ImportError:
            return False

    def load(self) -> None:
        if self._model is not None:
            return
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise AsrError(
                "未安装 faster-whisper，请先 pip install -r requirements.txt"
            ) from exc

        compute = _resolve_compute_type(self.device, self.compute_type)
        try:
            self._model = WhisperModel(
                self.model,
                device=self.device,
                compute_type=compute,
            )
        except Exception as exc:  # 模型下载/加载/显存等多种失败
            raise AsrError(
                f"加载模型失败（model={self.model}, device={self.device}, "
                f"compute_type={compute}）：{exc}"
            ) from exc

    def transcribe(
        self,
        audio_path: str,
        *,
        language: Optional[str] = None,
    ) -> Transcription:
        self.load()
        assert self._model is not None

        lang = None if not language or language == "auto" else language
        try:
            segments, info = self._model.transcribe(
                audio_path,
                language=lang,
                vad_filter=True,
                beam_size=5,
            )
        except Exception as exc:
            raise AsrError(f"转录失败：{exc}") from exc

        duration_ms = int(round(getattr(info, "duration", 0.0) * 1000))
        detected = getattr(info, "language", None)

        def _iter() -> Iterator[AsrSegment]:
            for seg in segments:
                text = (seg.text or "").strip()
                if not text:
                    continue
                yield AsrSegment(
                    start_ms=int(round(seg.start * 1000)),
                    end_ms=int(round(seg.end * 1000)),
                    text=text,
                )

        return Transcription(
            duration_ms=duration_ms,
            segments=_iter(),
            language=detected,
        )
