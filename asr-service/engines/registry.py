"""ASR 引擎注册表：名称 → 引擎类，供 UI 列举与按需实例化。"""

from __future__ import annotations

from typing import Callable, Dict, List, Optional, Type

from .base import AsrEngine
from .faster_whisper import FasterWhisperEngine
from .parakeet import ParakeetEngine
from .qwen3_asr import Qwen3AsrEngine

_REGISTRY: Dict[str, Type[AsrEngine]] = {
    FasterWhisperEngine.name: FasterWhisperEngine,
    ParakeetEngine.name: ParakeetEngine,
    Qwen3AsrEngine.name: Qwen3AsrEngine,
}


def list_engines() -> List[dict]:
    """列出已注册引擎及其依赖可用性，供前端下拉与提示使用。"""
    return [
        {"name": name, "available": cls.is_available()}
        for name, cls in _REGISTRY.items()
    ]


def create_engine(
    name: str,
    model: str,
    device: str = "auto",
    compute_type: Optional[str] = None,
    use_vad: bool = False,
    vad_config: Optional[dict] = None,
) -> AsrEngine:
    cls = _REGISTRY.get(name)
    if cls is None:
        known = ", ".join(_REGISTRY) or "(无)"
        raise KeyError(f"未知 ASR 引擎: {name}（已注册: {known}）")
    return cls(
        model=model,
        device=device,
        compute_type=compute_type,
        use_vad=use_vad,
        vad_config=vad_config,
    )


def _require(name: str) -> Type[AsrEngine]:
    cls = _REGISTRY.get(name)
    if cls is None:
        known = ", ".join(_REGISTRY) or "(无)"
        raise KeyError(f"未知 ASR 引擎: {name}（已注册: {known}）")
    return cls


def is_model_downloaded(name: str, model: str) -> bool:
    """查询指定引擎的模型是否已在本地缓存就绪。"""
    cls = _REGISTRY.get(name)
    if cls is None:
        return False
    return cls.is_model_downloaded(model)


def download_model(
    name: str,
    model: str,
    progress: Optional[Callable[[int, int], None]] = None,
) -> None:
    """触发指定引擎的模型下载（阻塞）。"""
    _require(name).download_model(model, progress=progress)
