"""ReazonSpeech NeMo v2 engine（固定分块 + 原生 RNN-T 整块解码）。

模型内置的 ALSD beam search 解码开销随音频时长按 O(T²) 增长，且整段推理的
激活显存随时长线性上涨（8GB 显卡约 20 分钟即溢出）。因此 ≥60s 的音频切
45s 块（2s 重叠）逐块解码，块间上报进度并响应取消；短音频为单块整段。

Timestamp/segment decoding adapted from ReazonSpeech nemo-asr (Apache-2.0):
https://github.com/reazon-research/reazonspeech/blob/master/pkg/nemo-asr/src/decode.py
"""

from __future__ import annotations

import importlib.util
import os
import wave
from array import array
from dataclasses import dataclass
from typing import Any, Callable, Iterator, List, Optional

from diagnostics import debug_log
from .base import (
    AsrEngine,
    AsrError,
    AsrSegment,
    Transcription,
    TranscriptSegmentRefresh,
    yield_unseen_segments,
)
from .chunking import (
    CHUNKING_MIN_DURATION_MS,
    DEFAULT_CHUNK_MS,
    DEFAULT_CHUNK_OVERLAP_MS,
    _duration_ms,
    _write_wav_chunk,
    cuda_unavailable_reason,
    merge_chunk_segments,
    plan_audio_chunks,
)
from .hf_download import snapshot_download_repo

MODEL_ID = "reazon-research/reazonspeech-nemo-v2"
MODEL_FILE = "reazonspeech-nemo-v2.nemo"
EXPECTED_SAMPLE_RATE = 16000
EXPECTED_SAMPWIDTH = 2
PAD_SECONDS = 0.5
SECONDS_PER_STEP = 0.08
SUBWORDS_PER_SEGMENTS = 10
PHONEMIC_BREAK = 0.5
TOKEN_EOS = {"。", "?", "!"}
TOKEN_COMMA = {"、", ","}
TOKEN_PUNC = TOKEN_EOS | TOKEN_COMMA


@dataclass
class _Subword:
    token: str
    seconds: float


def _require_model_id(model: Optional[str]) -> str:
    model_id = (model or "").strip() or MODEL_ID
    if model_id != MODEL_ID:
        raise AsrError(
            f"ReazonSpeech 仅支持模型 {MODEL_ID}，收到: {model_id}"
        )
    return model_id


def _starts_with_sp_whitespace(tokenizer, token_id) -> bool:
    sep_id = getattr(tokenizer, "spm_separator_id", None)
    return sep_id is not None and int(token_id) == int(sep_id)


def find_end_of_segment(subwords: List[_Subword], start: int) -> int:
    length = len(subwords)
    idx = start
    for idx in range(start, length):
        if idx < length - 1:
            cur = subwords[idx]
            nex = subwords[idx + 1]
            if nex.token not in TOKEN_PUNC:
                if cur.token in TOKEN_EOS:
                    break
                if idx - start >= SUBWORDS_PER_SEGMENTS:
                    if cur.token in TOKEN_COMMA or nex.seconds - cur.seconds > PHONEMIC_BREAK:
                        break
    return idx


def decode_hypothesis_to_segments(
    tokenizer,
    hyp,
    *,
    duration_ms: int,
) -> list[AsrSegment]:
    """Convert ReazonSpeech RNN-T hypothesis into validated AsrSegment list."""
    try:
        y_sequence = hyp.y_sequence.tolist()
    except Exception as exc:  # noqa: BLE001
        raise AsrError(f"ReazonSpeech 假设缺少 y_sequence：{exc}") from exc
    try:
        timestamps = (
            hyp.timestamp.tolist()
            if hasattr(hyp.timestamp, "tolist")
            else list(hyp.timestamp)
        )
    except Exception as exc:  # noqa: BLE001
        raise AsrError(f"ReazonSpeech 假设缺少 timestamp：{exc}") from exc

    if len(y_sequence) != len(timestamps):
        raise AsrError(
            "ReazonSpeech 时间戳与 token 数量不一致："
            f"tokens={len(y_sequence)} timestamps={len(timestamps)}"
        )

    if y_sequence and _starts_with_sp_whitespace(tokenizer, y_sequence[0]):
        y_sequence = y_sequence[1:]
        timestamps = timestamps[1:]

    subwords: list[_Subword] = []
    for idx, (token_id, step) in enumerate(zip(y_sequence, timestamps)):
        try:
            token = tokenizer.ids_to_text([token_id])
            step_value = float(step)
        except Exception as exc:  # noqa: BLE001
            raise AsrError(f"ReazonSpeech token/时间戳解码失败：{exc}") from exc
        subwords.append(
            _Subword(
                token=token,
                seconds=max(SECONDS_PER_STEP * (step_value - idx - 1) - PAD_SECONDS, 0.0),
            )
        )

    subwords = [item for item in subwords if item.token and item.token.strip()]
    if not subwords:
        return []

    segments: list[AsrSegment] = []
    start = 0
    max_end_ms = max(0, duration_ms)
    while start < len(subwords):
        end = find_end_of_segment(subwords, start)
        text = "".join(item.token for item in subwords[start : end + 1]).strip()
        start_ms = int(round(subwords[start].seconds * 1000))
        end_ms = int(round((subwords[end].seconds + SECONDS_PER_STEP) * 1000))
        start_ms = max(0, min(start_ms, max_end_ms))
        end_ms = max(0, min(end_ms, max_end_ms if max_end_ms > 0 else end_ms))
        # 末尾 token 的时间戳可能越过音频末尾，钳制后 start==end；丢弃该段而非整体失败
        if text and end_ms > start_ms:
            segments.append(AsrSegment(start_ms=start_ms, end_ms=end_ms, text=text))
        start = end + 1
    return segments


def _read_pcm16_mono_wav(audio_path: str) -> array:
    """Read project-standard 16 kHz 16-bit mono PCM WAV as compact PCM samples."""
    try:
        with wave.open(audio_path, "rb") as wav:
            channels = wav.getnchannels()
            sampwidth = wav.getsampwidth()
            rate = wav.getframerate()
            nframes = wav.getnframes()
            if channels != 1 or sampwidth != EXPECTED_SAMPWIDTH or rate != EXPECTED_SAMPLE_RATE:
                raise AsrError(
                    "ReazonSpeech 仅接受 16 kHz、16-bit、单声道 PCM WAV "
                    f"（实际 channels={channels}, sampwidth={sampwidth}, rate={rate}）"
                )
            raw = wav.readframes(nframes)
    except AsrError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise AsrError(f"读取音频失败：{exc}") from exc

    samples = array("h")
    samples.frombytes(raw)
    if not samples:
        raise AsrError("ReazonSpeech 音频为空")
    return samples


class ReazonSpeechNemoEngine(AsrEngine):
    name = "reazonspeech-nemo"

    def __init__(
        self,
        model: str = MODEL_ID,
        device: str = "auto",
        compute_type: Optional[str] = None,
        use_vad: bool = False,
        vad_config: Optional[dict] = None,
    ) -> None:
        super().__init__(
            model=_require_model_id(model),
            device=device,
            compute_type=compute_type,
            use_vad=use_vad,
            vad_config=vad_config,
        )
        self._model = None

    @staticmethod
    def is_available() -> bool:
        return (
            importlib.util.find_spec("nemo") is not None
            and importlib.util.find_spec("torch") is not None
        )

    @staticmethod
    def is_model_downloaded(model: str) -> bool:
        try:
            model_id = _require_model_id(model)
        except AsrError:
            return False
        try:
            from huggingface_hub import try_to_load_from_cache
        except ImportError:
            return False
        marker = try_to_load_from_cache(model_id, MODEL_FILE)
        return isinstance(marker, str) and os.path.exists(marker)

    @staticmethod
    def download_model(
        model: str,
        *,
        progress: Optional[Callable[[int, int], None]] = None,
    ) -> None:
        model_id = _require_model_id(model)
        try:
            snapshot_download_repo(
                model_id,
                progress=progress,
                allow_patterns=[MODEL_FILE],
            )
        except Exception as exc:  # noqa: BLE001
            raise AsrError(f"下载 ReazonSpeech 模型失败（{model_id}）：{exc}") from exc

    def load(self) -> None:
        if self._model is not None:
            return
        try:
            import torch
            from nemo.collections.asr.models import EncDecRNNTBPEModel
        except ImportError as exc:
            raise AsrError(
                "未安装 ReazonSpeech 引擎，请运行 ./scripts/setup-asr.sh reazonspeech "
                "（或 reazonspeech-cpu / reazonspeech-cuda）"
            ) from exc

        try:
            cuda_available = bool(torch.cuda.is_available())
            if self.device == "cuda" and not cuda_available:
                raise AsrError(f"无法使用 CUDA 加速：{cuda_unavailable_reason(torch)}")

            if self.device == "cuda" or (self.device == "auto" and cuda_available):
                map_location = "cuda"
                self.device = "cuda"
            else:
                map_location = "cpu"
                self.device = "cpu"

            model = EncDecRNNTBPEModel.from_pretrained(
                self.model,
                map_location=map_location,
            )
            model.eval()
            self._model = model
        except AsrError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise AsrError(f"加载 ReazonSpeech 模型失败（{self.model}）：{exc}") from exc

    def transcribe(
        self,
        audio_path: str,
        *,
        language: Optional[str] = None,
        cancel_check: Optional[Callable[[], bool]] = None,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> Transcription:
        # use_vad / vad_config intentionally ignored: fixed-size chunking only.
        del language  # fixed ja
        self.load()
        assert self._model is not None

        duration_ms = _duration_ms(audio_path)
        return Transcription(
            duration_ms=duration_ms,
            segments=self._iter_transcribe_chunks(
                audio_path,
                duration_ms,
                cancel_check=cancel_check,
                progress_callback=progress_callback,
            ),
            language="ja",
        )

    def _transcribe_wav_native(self, audio_path: str, duration_ms: int) -> list[AsrSegment]:
        """整段原生 RNN-T 解码：读 PCM → padding → NeMo transcribe → 分段（相对本段音频）。"""
        assert self._model is not None
        samples = _read_pcm16_mono_wav(audio_path)

        try:
            import torch

            pad = int(round(PAD_SECONDS * EXPECTED_SAMPLE_RATE))
            tensor = torch.zeros(len(samples) + pad * 2, dtype=torch.float32)
            tensor[pad : pad + len(samples)].copy_(
                torch.frombuffer(samples, dtype=torch.int16)
            )
            tensor.div_(32768.0)
            result = self._model.transcribe(
                [tensor],
                batch_size=1,
                return_hypotheses=True,
            )
        except Exception as exc:  # noqa: BLE001
            raise AsrError(f"ReazonSpeech 转录失败：{exc}") from exc

        hyp = result[0] if isinstance(result, (list, tuple)) else result
        if isinstance(hyp, (list, tuple)) and hyp:
            hyp = hyp[0]
        return decode_hypothesis_to_segments(
            self._model.tokenizer,
            hyp,
            duration_ms=duration_ms,
        )

    def _iter_transcribe_chunks(
        self,
        audio_path: str,
        duration_ms: int,
        *,
        cancel_check: Optional[Callable[[], bool]] = None,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> Iterator[AsrSegment]:
        """逐块转录：切 wav → 原生解码 → 加 chunk_start 偏移 → overlap 去重合并 → 惰性产出。

        45s 块使 ALSD beam search 的单块开销与显存占用有界（短音频即单块整段）；
        每块完成后上报 progress_callback 并检查取消，与 parakeet / qwen3 一致。
        """
        import tempfile
        from pathlib import Path

        chunks = plan_audio_chunks(
            duration_ms,
            chunk_ms=DEFAULT_CHUNK_MS,
            overlap_ms=DEFAULT_CHUNK_OVERLAP_MS,
            min_chunking_duration_ms=CHUNKING_MIN_DURATION_MS,
        )
        debug_log(
            "reazonspeech_chunked_transcribe_start",
            audioPath=audio_path,
            durationMs=duration_ms,
            chunkCount=len(chunks),
        )
        chunk_results: list[tuple[int, list[AsrSegment]]] = []
        yielded: set[tuple[int, int, str]] = set()

        with tempfile.TemporaryDirectory(prefix="hikaru_reazon_") as tmp:
            tmp_dir = Path(tmp)
            for index, (start_ms, end_ms) in enumerate(chunks, start=1):
                if cancel_check and cancel_check():
                    break
                chunk_path = tmp_dir / f"chunk_{index:04d}.wav"
                _write_wav_chunk(audio_path, chunk_path, start_ms, end_ms)
                segs = self._transcribe_wav_native(str(chunk_path), end_ms - start_ms)
                # 取消可能恰在本块推理期间触发：该块结果不再产出
                if cancel_check and cancel_check():
                    break
                chunk_results.append((start_ms, segs))
                merged = merge_chunk_segments(chunk_results, overlap_ms=DEFAULT_CHUNK_OVERLAP_MS)
                yield from yield_unseen_segments(yielded, merged)
                if progress_callback is not None:
                    progress_callback(end_ms)

        if cancel_check and cancel_check():
            debug_log("reazonspeech_chunking_cancelled", chunkCount=len(chunks))
            return
        # 后块可能把前块已产出的 overlap 片段合并成新 key，增量流里会同时存在新旧两版；
        # 收尾以最终合并列表整体替换预览片段（jobs.py 的 TranscriptSegmentRefresh 语义）
        merged = merge_chunk_segments(chunk_results, overlap_ms=DEFAULT_CHUNK_OVERLAP_MS)
        yield TranscriptSegmentRefresh(tuple(merged))
