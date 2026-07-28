"""faster-whisper 适配器（首个 ASR 引擎实现）。

依赖通过惰性导入，未安装 faster-whisper 时服务仍可启动，
仅在真正转录或查询可用性时反馈缺失。
"""

from __future__ import annotations

import math
import os
import traceback
import unicodedata
from numbers import Real
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Iterator, Optional

from .base import AsrEngine, AsrError, AsrSegment, Transcription
from .chunking import _duration_ms
from .hf_download import snapshot_download_repo
from .whisper_runtime import mark_long_runtime_seeded

if TYPE_CHECKING:
    from .silero_v4 import SileroV4Options

_HARD_GAP_SECONDS = 30.0
_LONG_RUNTIME_RANDOM_SEED = 0


def _set_long_runtime_seed() -> None:
    try:
        mark_long_runtime_seeded()
        import ctranslate2

        ctranslate2.set_random_seed(_LONG_RUNTIME_RANDOM_SEED)
    except Exception as exc:
        raise AsrError(f"初始化长音频确定性运行时失败：{exc}") from exc


def _normalized(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    return "".join(char for char in normalized if not char.isspace())


def _replace_hard_word_holes(
    segment,
    raw_parent: AsrSegment,
) -> Optional[list[AsrSegment]]:
    """Replace only source-timeline word holes of at least 30 seconds."""
    words = list(getattr(segment, "words", None) or [])
    if not words:
        return None

    groups: list[list[tuple[str, float, float]]] = [[]]
    aligned_text: list[str] = []
    previous_start: Optional[float] = None
    previous_end: Optional[float] = None

    for word in words:
        text = getattr(word, "word", None)
        start = getattr(word, "start", None)
        end = getattr(word, "end", None)
        if (
            not isinstance(text, str)
            or not isinstance(start, Real)
            or not isinstance(end, Real)
            or not math.isfinite(float(start))
            or not math.isfinite(float(end))
            or start > end
            or (previous_start is not None and start < previous_start)
            or (previous_end is not None and end < previous_end)
        ):
            return None

        if previous_end is not None and start - previous_end >= _HARD_GAP_SECONDS:
            groups.append([])
        groups[-1].append((text, float(start), float(end)))
        aligned_text.append(text)
        previous_start = float(start)
        previous_end = float(end)

    if _normalized("".join(aligned_text)) != _normalized(raw_parent.text):
        return None

    first_start = groups[0][0][1]
    last_end = groups[-1][-1][2]
    leading_hole = first_start - float(segment.start) >= _HARD_GAP_SECONDS
    trailing_hole = float(segment.end) - last_end >= _HARD_GAP_SECONDS
    if not leading_hole and not trailing_hole and len(groups) == 1:
        return None

    children = [
        AsrSegment(
            start_ms=int(round(group[0][1] * 1000)),
            end_ms=int(round(group[-1][2] * 1000)),
            text="".join(word[0] for word in group).strip(),
        )
        for group in groups
    ]
    if any(not _normalized(child.text) for child in children):
        return None

    if not leading_hole:
        children[0].start_ms = raw_parent.start_ms
    if not trailing_hole:
        children[-1].end_ms = raw_parent.end_ms
    if len(children) == 1:
        children[0].text = raw_parent.text

    if (
        _normalized("".join(child.text for child in children))
        != _normalized(raw_parent.text)
        or any(child.end_ms <= child.start_ms for child in children)
        or any(
            current.start_ms < previous.end_ms
            for previous, current in zip(children, children[1:])
        )
    ):
        return None
    return children


def _iter_bounded_long_segments(
    segments,
    *,
    duration_ms: int,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> Iterator[AsrSegment]:
    """Repair hard holes and bound every long-mode event with one lookahead."""
    previous_end_ms = 0
    try:
        if cancel_check and cancel_check():
            return
        iterator = iter(segments)
        try:
            current = next(iterator)
        except StopIteration:
            return

        while True:
            try:
                following = next(iterator)
            except StopIteration:
                following = None

            raw_parent = AsrSegment(
                start_ms=int(round(current.start * 1000)),
                end_ms=int(round(current.end * 1000)),
                text=(current.text or "").strip(),
            )
            next_start_ms = (
                int(round(following.start * 1000))
                if following is not None
                else None
            )

            if raw_parent.text:
                try:
                    replacement = _replace_hard_word_holes(current, raw_parent)
                except Exception:  # noqa: BLE001 malformed words fall back atomically
                    replacement = None
                candidates = replacement or [raw_parent]
                for candidate in candidates:
                    lower_bound = max(0, previous_end_ms)
                    upper_bound = duration_ms
                    if next_start_ms is not None and next_start_ms > lower_bound:
                        upper_bound = min(upper_bound, next_start_ms)
                    bounded_start_ms = max(candidate.start_ms, lower_bound)
                    bounded_end_ms = min(candidate.end_ms, upper_bound)
                    if (
                        bounded_end_ms <= bounded_start_ms
                        and bounded_end_ms > lower_bound
                    ):
                        bounded_start_ms = lower_bound
                    bounded = AsrSegment(
                        start_ms=bounded_start_ms,
                        end_ms=bounded_end_ms,
                        text=candidate.text,
                    )
                    if bounded.end_ms <= bounded.start_ms:
                        raise AsrError(
                            "长音频字幕无法保留有效时间范围："
                            f"start={candidate.start_ms}, end={candidate.end_ms}, "
                            f"previousEnd={previous_end_ms}, nextStart={next_start_ms}, "
                            f"duration={duration_ms}"
                        )
                    yield bounded
                    previous_end_ms = bounded.end_ms

            if following is None:
                return
            if cancel_check and cancel_check():
                return
            current = following
    except AsrError:
        raise
    except Exception as exc:
        raise AsrError(f"转录失败：{exc}") from exc


# faster-whisper 模型默认下载所需的文件（与官方 download_model 保持一致）。
_ALLOW_PATTERNS = [
    "config.json",
    "preprocessor_config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.*",
]


def _has_required_model_files(
    model_path: str,
    *,
    require_preprocessor_config: bool = False,
) -> bool:
    path = Path(model_path)
    return (
        path.is_dir()
        and (path / "config.json").is_file()
        and (path / "model.bin").is_file()
        and (path / "tokenizer.json").is_file()
        and any(candidate.is_file() for candidate in path.glob("vocabulary.*"))
        and (
            not require_preprocessor_config
            or (path / "preprocessor_config.json").is_file()
        )
    )


def _model_repo(model: str) -> str:
    """将模型尺寸名解析为 HuggingFace 仓库 id；本地路径/完整 id 原样返回。"""
    try:
        from faster_whisper.utils import _MODELS  # type: ignore

        if model in _MODELS:
            return _MODELS[model]
    except Exception:  # noqa: BLE001 版本差异或未安装时回退命名约定
        pass
    if "/" in model:
        return model
    return f"Systran/faster-whisper-{model}"


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


def _resolve_long_compute_type(device: str) -> str:
    return "int8" if device == "cpu" else "int8_float16"


class FasterWhisperEngine(AsrEngine):
    name = "faster-whisper"
    require_preprocessor_config = False

    def __init__(
        self,
        model: str = "large-v3",
        device: str = "auto",
        compute_type: Optional[str] = None,
        use_vad: bool = False,
        vad_config: Optional[dict] = None,
    ) -> None:
        super().__init__(
            model=model,
            device=device,
            compute_type=compute_type,
            use_vad=use_vad,
            vad_config=vad_config,
        )
        self._model = None
        self._loaded_long_mode: Optional[bool] = None
        self._loaded_compute_type: Optional[str] = None

    @staticmethod
    def is_available() -> bool:
        try:
            import faster_whisper  # noqa: F401

            return True
        except ImportError:
            return False

    @classmethod
    def is_model_downloaded(cls, model: str) -> bool:
        """本地缓存是否已具备该模型所需的全部文件（不触发网络）。"""
        if os.path.isdir(model):
            return _has_required_model_files(
                model,
                require_preprocessor_config=cls.require_preprocessor_config,
            )
        try:
            from faster_whisper import download_model
        except ImportError:
            return False
        try:
            model_path = download_model(model, local_files_only=True)
            model_ready = _has_required_model_files(
                model_path,
                require_preprocessor_config=cls.require_preprocessor_config,
            )
            if (
                model_ready
                and cls.name == "faster-whisper"
                and model == "large-v2"
            ):
                from .silero_v4 import is_silero_v4_ready

                return is_silero_v4_ready()
            return model_ready
        except Exception:  # noqa: BLE001 未缓存时抛出 LocalEntryNotFoundError 等
            return False

    @staticmethod
    def download_model(
        model: str,
        *,
        progress: Optional[Callable[[int, int], None]] = None,
    ) -> None:
        """从 HuggingFace 下载模型到本地缓存，progress(done, total) 上报字节进度。"""
        if os.path.isdir(model):
            return
        repo_id = _model_repo(model)
        try:
            snapshot_download_repo(
                repo_id,
                progress=progress,
                allow_patterns=_ALLOW_PATTERNS,
            )
            if model == "large-v2":
                from .silero_v4 import download_silero_v4

                download_silero_v4()
        except Exception as exc:  # noqa: BLE001 网络/鉴权/磁盘等多种失败
            raise AsrError(f"下载模型失败（{repo_id}）：{exc}") from exc

    @staticmethod
    def _actual_device(model) -> Optional[str]:
        """读取 CTranslate2 实际选用的设备（cuda/cpu）。"""
        try:
            return getattr(getattr(model, "model", None), "device", None)
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def _warmup(model) -> None:
        """以极短静音执行一次推理，逼出 CUDA 内核（cublas/cudnn）加载错误。

        CTranslate2 在构造时不会加载 cublas，真正加载发生在首次推理；
        故需主动预热，才能在加载阶段就捕获 GPU 运行库缺失并回退。
        """
        import numpy as np

        silent = np.zeros(16000, dtype=np.float32)
        segments, _ = model.transcribe(silent, beam_size=1)
        for _ in segments:  # 触发生成器执行（即真正的编码/解码）
            break

    def _transcribe_options(self) -> dict:
        """Return engine-specific upstream transcribe keyword arguments."""
        return {}

    def _vad_parameters(self) -> Optional[dict]:
        if not self.use_vad:
            return None
        parameters = {
            "threshold": self.vad_config.get("threshold", 0.5),
            "min_speech_duration_ms": self.vad_config.get(
                "min_speech_duration_ms",
                500,
            ),
            "min_silence_duration_ms": self.vad_config.get(
                "min_silence_duration_ms",
                300,
            ),
            "speech_pad_ms": self.vad_config.get("speech_pad_ms", 400),
        }
        max_segment_ms = self.vad_config.get("max_segment_duration_ms")
        if max_segment_ms is not None:
            parameters["max_speech_duration_s"] = max_segment_ms / 1000.0
        return parameters

    def _long_vad_options(self) -> SileroV4Options:
        from .silero_v4 import SileroV4Options

        values = self.vad_config if self.use_vad else {}
        max_segment_ms = values.get("max_segment_duration_ms")
        return SileroV4Options(
            threshold=values.get("threshold", 0.45),
            min_speech_duration_ms=values.get("min_speech_duration_ms", 250),
            min_silence_duration_ms=values.get("min_silence_duration_ms", 3000),
            speech_pad_ms=values.get("speech_pad_ms", 900),
            max_speech_duration_s=(
                max_segment_ms / 1000.0
                if max_segment_ms is not None
                else float("inf")
            ),
        )

    def load(self) -> None:
        if self._model is None:
            self._load_model(long_mode=False)

    def _short_compute_type(self, language: Optional[str]) -> str:
        compute = _resolve_compute_type(self.device, self.compute_type)
        if (
            self.name != "faster-whisper"
            or self.model != "large-v2"
            or language != "ja"
            or (
                self.compute_type
                and self.compute_type not in ("auto", "default")
            )
        ):
            return compute

        effective_device = self.device
        if self._model is not None and self._loaded_long_mode in (None, False):
            effective_device = self._actual_device(self._model) or effective_device
        return _resolve_long_compute_type(effective_device)

    def _load_model(
        self,
        *,
        long_mode: bool,
        compute_type: Optional[str] = None,
    ) -> None:
        compute = compute_type or (
            _resolve_long_compute_type(self.device)
            if long_mode
            else _resolve_compute_type(self.device, self.compute_type)
        )
        if self._model is not None:
            if (
                self._loaded_long_mode in (None, long_mode)
                and self._loaded_compute_type in (None, compute)
            ):
                return
            previous_model = self._model
            self._model = None
            self._loaded_long_mode = None
            self._loaded_compute_type = None
            del previous_model
        try:
            import faster_whisper
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise AsrError(
                "未安装 faster-whisper，请先 pip install -r requirements.txt"
            ) from exc

        model_class = WhisperModel
        if long_mode:
            from .faster_whisper_model import (
                FasterWhisper121Model,
                validate_faster_whisper_compatibility,
            )

            try:
                validate_faster_whisper_compatibility(
                    getattr(faster_whisper, "__version__", ""),
                    WhisperModel,
                )
            except RuntimeError as exc:
                raise AsrError(str(exc)) from exc
            model_class = FasterWhisper121Model

        model = None
        try:
            model = model_class(
                self.model,
                device=self.device,
                compute_type=compute,
            )
            actual = self._actual_device(model)
            if not long_mode and (
                actual == "cuda" or (actual is None and self.device != "cpu")
            ):
                self._warmup(model)
            self._model = model
            self._loaded_long_mode = long_mode
            self._loaded_compute_type = compute
            return
        except Exception as exc:
            # Warmup tracebacks retain their model argument; clear those frames
            # before constructing the CPU fallback so both models never coexist.
            model = None
            traceback.clear_frames(exc.__traceback__)
            if self.device == "auto":
                try:
                    self._model = model_class(
                        self.model,
                        device="cpu",
                        compute_type="int8",
                    )
                    self.device = "cpu"
                    self._loaded_long_mode = long_mode
                    self._loaded_compute_type = "int8"
                    return
                except Exception:  # noqa: BLE001 回退仍失败则抛原始错误
                    pass
            hint = ""
            if "cublas" in str(exc).lower() or "cudnn" in str(exc).lower():
                hint = (
                    "（缺少 CUDA 运行库。使用 GPU 请安装："
                    "pip install nvidia-cublas-cu12 nvidia-cudnn-cu12，"
                    "或将设备改为 CPU）"
                )
            raise AsrError(
                f"加载模型失败（model={self.model}, device={self.device}, "
                f"compute_type={compute}）：{exc}{hint}"
            ) from exc

    def _transcribe_direct(
        self,
        audio_path: str,
        *,
        language: Optional[str] = None,
        cancel_check: Optional[Callable[[], bool]] = None,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> Transcription:
        """保留 Kotoba 使用的 faster-whisper 原生 VAD 转录路径。"""
        self.load()
        assert self._model is not None

        lang = None if not language or language == "auto" else language
        try:
            segments, info = self._model.transcribe(
                audio_path,
                language=lang,
                vad_filter=True,
                vad_parameters=self._vad_parameters(),
                beam_size=5,
                **self._transcribe_options(),
            )
        except Exception as exc:
            raise AsrError(f"转录失败：{exc}") from exc

        duration_ms = int(round(getattr(info, "duration", 0.0) * 1000))
        detected = getattr(info, "language", None)

        def _iter() -> Iterator[AsrSegment]:
            try:
                for segment in segments:
                    if cancel_check and cancel_check():
                        return
                    text = (segment.text or "").strip()
                    if not text:
                        continue
                    yield AsrSegment(
                        start_ms=int(round(segment.start * 1000)),
                        end_ms=int(round(segment.end * 1000)),
                        text=text,
                    )
            except AsrError:
                raise
            except Exception as exc:
                raise AsrError(f"转录失败：{exc}") from exc

        return Transcription(
            duration_ms=duration_ms,
            segments=_iter(),
            language=detected,
        )

    def _transcribe_short(
        self,
        audio_path: str,
        *,
        language: Optional[str] = None,
        cancel_check: Optional[Callable[[], bool]] = None,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> Transcription:
        self._load_model(
            long_mode=False,
            compute_type=self._short_compute_type(language),
        )
        return self._transcribe_direct(
            audio_path,
            language=language,
            cancel_check=cancel_check,
            progress_callback=progress_callback,
        )

    def _transcribe_long(
        self,
        audio_path: str,
        *,
        language: Optional[str],
        duration_ms: int,
        cancel_check: Optional[Callable[[], bool]] = None,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> Transcription:
        if cancel_check and cancel_check():
            return Transcription(
                duration_ms=duration_ms,
                segments=iter(()),
                language=language,
            )
        try:
            import numpy as np

            from .silero_v4 import (
                SileroV4Cancelled,
                get_speech_timestamps_v4,
                is_silero_v4_ready,
            )
        except ImportError as exc:
            raise AsrError(f"长音频运行时依赖缺失：{exc}") from exc
        if not is_silero_v4_ready():
            raise AsrError(
                "Silero VAD v4.0 模型缺失或校验失败，"
                "请重新下载 large-v2 模型"
            )
        _set_long_runtime_seed()
        self._load_model(long_mode=True)
        assert self._model is not None

        try:
            from faster_whisper.audio import decode_audio
            from faster_whisper.transcribe import restore_speech_timestamps
            from faster_whisper.vad import collect_chunks

            audio = decode_audio(audio_path, sampling_rate=16_000)
            speech_chunks = get_speech_timestamps_v4(
                audio,
                options=self._long_vad_options(),
                cancel_check=cancel_check,
            )
            if cancel_check and cancel_check():
                return Transcription(
                    duration_ms=duration_ms,
                    segments=iter(()),
                    language=language,
                )
            if not speech_chunks:
                return Transcription(
                    duration_ms=duration_ms,
                    segments=iter(()),
                    language=language,
                )
            audio_chunks, _metadata = collect_chunks(
                audio,
                speech_chunks,
                sampling_rate=16_000,
            )
            compressed_audio = np.concatenate(audio_chunks, axis=0)
            segments, info = self._model.transcribe(
                compressed_audio,
                language=language,
                vad_filter=False,
                beam_size=5,
                condition_on_previous_text=True,
                word_timestamps=True,
            )
            restored_segments = restore_speech_timestamps(
                segments,
                speech_chunks,
                16_000,
            )
        except SileroV4Cancelled:
            return Transcription(
                duration_ms=duration_ms,
                segments=iter(()),
                language=language,
            )
        except AsrError:
            raise
        except Exception as exc:
            raise AsrError(f"长音频转录失败：{exc}") from exc

        return Transcription(
            duration_ms=duration_ms,
            segments=_iter_bounded_long_segments(
                restored_segments,
                duration_ms=duration_ms,
                cancel_check=cancel_check,
            ),
            language=getattr(info, "language", None),
        )

    def transcribe(
        self,
        audio_path: str,
        *,
        language: Optional[str] = None,
        cancel_check: Optional[Callable[[], bool]] = None,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> Transcription:
        duration_ms = _duration_ms(audio_path)
        long_mode = (
            self.name == "faster-whisper"
            and self.model == "large-v2"
            and language == "ja"
            and duration_ms >= 600_000
        )
        if long_mode:
            return self._transcribe_long(
                audio_path,
                language="ja",
                duration_ms=duration_ms,
                cancel_check=cancel_check,
                progress_callback=progress_callback,
            )
        return self._transcribe_short(
            audio_path,
            language=language,
            cancel_check=cancel_check,
            progress_callback=progress_callback,
        )
