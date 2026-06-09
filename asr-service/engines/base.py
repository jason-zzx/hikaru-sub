"""ASR 引擎抽象接口与共享数据模型。

所有引擎统一以 `AsrSegment`（毫秒时间轴 + 文本）作为输出单元，
`Transcription` 携带总时长与惰性产出的片段流，便于上层按片段计算进度。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Callable, Iterator, Optional


@dataclass
class AsrSegment:
    """单个转录片段，时间轴单位为毫秒。"""

    start_ms: int
    end_ms: int
    text: str


@dataclass
class Transcription:
    """一次转录的结果句柄。

    - `duration_ms`：音频总时长，开始转录时即已知，用于计算进度百分比。
    - `segments`：惰性迭代器，逐片段产出，迭代过程即转录推进过程。
    - `language`：引擎检测到的语言（若有）。
    """

    duration_ms: int
    segments: Iterator[AsrSegment]
    language: Optional[str] = None


class AsrError(RuntimeError):
    """引擎相关错误（依赖缺失、模型加载失败、推理异常等）。"""


class AsrEngine(ABC):
    """ASR 引擎抽象基类。新增引擎实现本接口并注册到 registry 即可。"""

    name: str = "base"

    def __init__(
        self,
        model: str,
        device: str = "auto",
        compute_type: Optional[str] = None,
    ) -> None:
        self.model = model
        self.device = device
        self.compute_type = compute_type

    @staticmethod
    def is_available() -> bool:
        """运行依赖是否就绪（如对应的 Python 包是否已安装）。"""
        return True

    @staticmethod
    def is_model_downloaded(model: str) -> bool:
        """模型是否已就绪。无需单独下载的引擎默认返回 True。"""
        return True

    @staticmethod
    def download_model(
        model: str,
        *,
        progress: Optional[Callable[[int, int], None]] = None,
    ) -> None:
        """下载模型到本地缓存。不支持下载的引擎应抛出 AsrError。"""
        raise AsrError("该引擎不支持模型下载")

    @abstractmethod
    def load(self) -> None:
        """加载模型。昂贵操作，应在首次转录前调用并可重复调用（幂等）。"""

    @abstractmethod
    def transcribe(
        self,
        audio_path: str,
        *,
        language: Optional[str] = None,
    ) -> Transcription:
        """开始转录，返回携带时长与片段迭代器的 `Transcription`。"""
