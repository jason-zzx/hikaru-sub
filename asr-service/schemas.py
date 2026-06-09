"""HTTP 请求/响应模型。前端以 camelCase 传参，故启用 alias。"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class TranscribeRequest(BaseModel):
    # protected_namespaces=() 以消除 `model` 字段与 pydantic 保留命名空间的告警
    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    audio_path: str = Field(..., alias="audioPath")
    engine: str = "faster-whisper"
    model: str = "large-v3"
    device: str = "auto"
    language: Optional[str] = None
    compute_type: Optional[str] = Field(default=None, alias="computeType")


class DownloadModelRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    engine: str = "faster-whisper"
    model: str = "large-v3"
