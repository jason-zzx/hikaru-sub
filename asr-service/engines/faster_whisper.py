"""faster-whisper 适配器（首个 ASR 引擎实现）。

依赖通过惰性导入，未安装 faster-whisper 时服务仍可启动，
仅在真正转录或查询可用性时反馈缺失。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Callable, Iterator, Optional

from .base import AsrEngine, AsrError, AsrSegment, Transcription
from .hf_download import snapshot_download_repo

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
            return _has_required_model_files(
                model_path,
                require_preprocessor_config=cls.require_preprocessor_config,
            )
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
        """Return engine-specific faster-whisper transcribe keyword arguments."""
        return {}

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
            model = WhisperModel(
                self.model,
                device=self.device,
                compute_type=compute,
            )
            actual = self._actual_device(model)
            # 实际选用 GPU 时预热，提前暴露 cublas/cudnn 缺失
            if actual == "cuda" or (actual is None and self.device != "cpu"):
                self._warmup(model)
            self._model = model
            return
        except Exception as exc:  # 模型加载或 GPU 预热失败
            # 设备为 auto 时，GPU 不可用（缺 CUDA 库/无显卡）则自动回退 CPU
            if self.device == "auto":
                try:
                    self._model = WhisperModel(
                        self.model,
                        device="cpu",
                        compute_type="int8",
                    )
                    self.device = "cpu"
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

        lang = None if not language or language == "auto" else language

        # VAD 配置：始终启用内置 VAD；use_vad=True 时透传用户自定义参数
        vad_filter = True
        vad_parameters = None
        if self.use_vad:
            vad_parameters = {
                'threshold': self.vad_config.get('threshold', 0.5),
                'min_speech_duration_ms': self.vad_config.get('min_speech_duration_ms', 500),
                'min_silence_duration_ms': self.vad_config.get('min_silence_duration_ms', 300),
                'speech_pad_ms': self.vad_config.get('speech_pad_ms', 400),
            }
            max_seg_ms = self.vad_config.get('max_segment_duration_ms')
            if max_seg_ms is not None:
                vad_parameters['max_speech_duration_s'] = max_seg_ms / 1000.0

        transcribe_options = self._transcribe_options()

        try:
            segments, info = self._model.transcribe(
                audio_path,
                language=lang,
                vad_filter=vad_filter,
                vad_parameters=vad_parameters,
                beam_size=5,
                **transcribe_options,
            )
        except Exception as exc:
            raise AsrError(f"转录失败：{exc}") from exc

        duration_ms = int(round(getattr(info, "duration", 0.0) * 1000))
        detected = getattr(info, "language", None)

        def _iter() -> Iterator[AsrSegment]:
            try:
                for seg in segments:
                    if cancel_check and cancel_check():
                        return
                    text = (seg.text or "").strip()
                    if not text:
                        continue
                    yield AsrSegment(
                        start_ms=int(round(seg.start * 1000)),
                        end_ms=int(round(seg.end * 1000)),
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
