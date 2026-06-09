"""ASR 引擎注册表：名称 → 引擎类，供 UI 列举与按需实例化。"""

from __future__ import annotations

from typing import Dict, List, Optional, Type

from .base import AsrEngine
from .faster_whisper import FasterWhisperEngine

_REGISTRY: Dict[str, Type[AsrEngine]] = {
    FasterWhisperEngine.name: FasterWhisperEngine,
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
) -> AsrEngine:
    cls = _REGISTRY.get(name)
    if cls is None:
        known = ", ".join(_REGISTRY) or "(无)"
        raise KeyError(f"未知 ASR 引擎: {name}（已注册: {known}）")
    return cls(model=model, device=device, compute_type=compute_type)
