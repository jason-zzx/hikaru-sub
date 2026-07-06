"""HTTP 请求/响应模型。前端以 camelCase 传参，故启用 alias。"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class VadConfig(BaseModel):
    """VAD 参数。前端以 camelCase 传入，model_dump() 输出 snake_case 供引擎使用。"""

    model_config = ConfigDict(populate_by_name=True)

    threshold: Optional[float] = None
    min_speech_duration_ms: Optional[int] = Field(default=None, alias="minSpeechDurationMs")
    min_silence_duration_ms: Optional[int] = Field(default=None, alias="minSilenceDurationMs")
    speech_pad_ms: Optional[int] = Field(default=None, alias="speechPadMs")
    max_segment_duration_ms: Optional[int] = Field(default=None, alias="maxSegmentDurationMs")


class TranscribeRequest(BaseModel):
    # protected_namespaces=() 以消除 `model` 字段与 pydantic 保留命名空间的告警
    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    audio_path: str = Field(..., alias="audioPath")
    engine: str = "faster-whisper"
    model: str = "large-v3"
    device: str = "auto"
    language: Optional[str] = None
    compute_type: Optional[str] = Field(default=None, alias="computeType")
    output_ass_path: Optional[str] = Field(default=None, alias="outputAssPath")
    use_vad: bool = Field(default=False, alias="useVad")
    vad_config: Optional[VadConfig] = Field(default=None, alias="vadConfig")


class DownloadModelRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, protected_namespaces=())

    engine: str = "faster-whisper"
    model: str = "large-v3"
