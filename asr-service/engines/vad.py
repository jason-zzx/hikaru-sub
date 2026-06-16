"""Silero VAD 封装，用于不自带 VAD 的引擎（如 Parakeet）。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# Silero VAD 期望 16kHz 采样率，与 FFmpeg extract_audio 输出一致。
VAD_SAMPLE_RATE = 16000


def _read_wav_as_tensor(audio_path: str):
    """读取 16kHz 单声道 WAV 为归一化 float32 张量。

    Silero 自带的 read_audio 依赖 torchaudio/torchcodec，部署较重；
    我们的音频管线统一产出 16kHz WAV，直接用标准库读取更可靠。
    多声道时下混为单声道。
    """
    import wave

    import torch

    with wave.open(audio_path, "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        frame_count = wav.getnframes()
        raw = wav.readframes(frame_count)

    if sample_width != 2:
        raise RuntimeError(f"仅支持 16-bit PCM WAV，当前位宽：{sample_width * 8} bit")

    samples = torch.frombuffer(bytearray(raw), dtype=torch.int16).float() / 32768.0
    if channels > 1:
        samples = samples.view(-1, channels).mean(dim=1)
    return samples


@dataclass
class SpeechSegment:
    """语音段时间戳（毫秒）"""
    start_ms: int
    end_ms: int


class VadEngine:
    """Silero VAD 封装类"""

    def __init__(self):
        self._model = None
        self._utils = None

    def load(self) -> None:
        """延迟加载 Silero VAD 模型（通过 torch.hub）"""
        if self._model is not None:
            return

        try:
            import torch
            model, utils = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                trust_repo=True,
            )
            self._model = model
            self._utils = utils
        except Exception as exc:
            raise RuntimeError(f"加载 Silero VAD 失败：{exc}") from exc

    def detect_speech_segments(
        self,
        audio_path: str,
        *,
        threshold: float = 0.5,
        min_speech_duration_ms: int = 500,
        min_silence_duration_ms: int = 300,
        speech_pad_ms: int = 400,
    ) -> list[SpeechSegment]:
        """检测语音时间戳

        参数对应 faster-whisper VadOptions：
        - threshold: 语音阈值 (默认 0.5)
        - min_speech_duration_ms: 最小语音段长度 (默认 500)
        - min_silence_duration_ms: 最小静音间隔 (默认 300)
        - speech_pad_ms: 语音段边缘填充 (默认 400)
        """
        self.load()
        get_speech_timestamps, *_ = self._utils

        wav = _read_wav_as_tensor(audio_path)
        speech_timestamps = get_speech_timestamps(
            wav,
            self._model,
            threshold=threshold,
            min_speech_duration_ms=min_speech_duration_ms,
            min_silence_duration_ms=min_silence_duration_ms,
            speech_pad_ms=speech_pad_ms,
        )

        return [
            SpeechSegment(
                start_ms=int(ts['start'] / 16),  # Silero 输出采样点，16kHz = 16样本/ms
                end_ms=int(ts['end'] / 16),
            )
            for ts in speech_timestamps
        ]


def split_long_segments(
    segments: list[SpeechSegment],
    *,
    max_duration_ms: int = 25_000,
    overlap_ms: int = 2_000,
) -> list[tuple[int, int]]:
    """将超长语音段切分为更短的窗口（带重叠）

    返回 (start_ms, end_ms) 元组列表，兼容现有 plan_audio_chunks 的返回格式
    """
    chunks = []
    for seg in segments:
        duration = seg.end_ms - seg.start_ms
        if duration <= max_duration_ms:
            chunks.append((seg.start_ms, seg.end_ms))
        else:
            # 长段切分为重叠窗口
            step_ms = max_duration_ms - overlap_ms
            if step_ms <= 0:
                chunks.append((seg.start_ms, seg.end_ms))
                continue
            cursor = seg.start_ms
            while cursor < seg.end_ms:
                end = min(seg.end_ms, cursor + max_duration_ms)
                chunks.append((cursor, end))
                if end >= seg.end_ms:
                    break
                cursor += step_ms

    return chunks
