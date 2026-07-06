"""Qwen3-ASR 引擎适配器（日语 ASR + Qwen3-ForcedAligner 高精度时间轴）。

`Qwen/Qwen3-ASR-1.7B` 是 2026 年日语 ASR SOTA 模型，自带
`Qwen/Qwen3-ForcedAligner-0.6B` 产出字级时间戳。本引擎默认携带 aligner，
文本质量与时间轴精度均优于 Parakeet，作为其更优替代。

依赖通过惰性导入，未安装 qwen-asr 时服务仍可启动。
"""

from __future__ import annotations

import importlib.util
import os
from typing import Callable, Iterator, List, Optional, Tuple

from diagnostics import debug_exception, debug_log
from .base import AsrEngine, AsrError, AsrSegment, Transcription
from .chunking import (
    DEFAULT_MAX_CHARS,
    DEFAULT_MAX_DURATION_MS,
    DEFAULT_MIN_CHARS,
    DEFAULT_PAUSE_THRESHOLD_SEC,
    _duration_ms,
    _write_wav_chunk,
    build_segments_from_char_timestamps,
    build_segments_from_text,
    cuda_unavailable_reason,
    merge_chunk_segments,
    plan_audio_chunks,
)

MODEL_ID = "Qwen/Qwen3-ASR-1.7B"
ASR_MODEL_ID = MODEL_ID
ALIGNER_MODEL_ID = "Qwen/Qwen3-ForcedAligner-0.6B"

# Qwen3 引擎分块常量。qwen-asr 内部默认按 180s 切块，对 CPU 长音频 attention O(n²) 过重；
# 本引擎自行切更小的 45s 块（带 2s overlap）再逐块调 qwen-asr，减轻单块 attention 规模，
# 同时通过 ForcedAlignResult.items 解析 + chunk_start 偏移 + overlap 去重保证全局时间轴正确。
CHUNK_MS = 45_000
CHUNK_OVERLAP_MS = 2_000
DEFAULT_MAX_NEW_TOKENS = 4096
LANGUAGE_JA = "Japanese"


def _stamp_attr(stamp, *names):
    """从 qwen-asr 时间戳对象按多个候选属性名取值。"""
    for name in names:
        value = getattr(stamp, name, None)
        if value is not None:
            return value
    return None


def _normalize_qwen_stamp(stamp) -> Optional[Tuple[str, float, float]]:
    """把 qwen-asr 单个时间戳归一为 (char, start_sec, end_sec)。

    qwen-asr 时间戳元素可能为带 text/start_time/end_time 属性的对象，
    或 (text, start, end) 元组，或 dict。统一探测。
    """
    if isinstance(stamp, (list, tuple)) and len(stamp) == 3:
        text, start, end = stamp
        try:
            return str(text), float(start), float(end)
        except (TypeError, ValueError):
            return None
    if isinstance(stamp, dict):
        text = stamp.get("text") or stamp.get("char")
        start = stamp.get("start_time", stamp.get("start"))
        end = stamp.get("end_time", stamp.get("end"))
    else:
        text = _stamp_attr(stamp, "text", "char")
        start = _stamp_attr(stamp, "start_time", "start")
        end = _stamp_attr(stamp, "end_time", "end")
    if text is None or start is None or end is None:
        return None
    try:
        return str(text), float(start), float(end)
    except (TypeError, ValueError):
        return None


def _extract_char_timestamps(result) -> List[dict]:
    """从 qwen-asr transcribe 单个结果提取字/词级时间戳列表。

    qwen-asr `return_time_stamps=True` 时，`result.time_stamps` 是 ForcedAlignResult
    对象，含 `.items` 列表（每个 item 有 .text/.start_time/.end_time，单位秒，
    已是整段音频的全局绝对时间，内部已做分块+偏移+合并）。本函数把它归一为
    [{char, start, end}, ...] 供 chunking.build_segments_from_char_timestamps 使用。

    兼容多种返回形态（对象 .items / list[stamp] / list[list[stamp]] / dict），
    以应对上游版本差异。
    """
    time_stamps = getattr(result, "time_stamps", None)
    if time_stamps is None:
        return []

    # 形态 1：ForcedAlignResult 对象，含 .items
    items = getattr(time_stamps, "items", None)
    if items is None and isinstance(time_stamps, (list, tuple)) and len(time_stamps) > 0:
        # 形态 2：list[list[stamp]] —— 取第一层为 stamp 列表（旧文档示例）
        if isinstance(time_stamps[0], (list, tuple)):
            items = time_stamps[0]
        # 形态 3：list[stamp]
        else:
            items = time_stamps
    elif items is None:
        items = time_stamps

    chars: List[dict] = []
    for stamp in items:
        normalized = _normalize_qwen_stamp(stamp)
        if normalized is None:
            continue
        text, start, end = normalized
        if not str(text).strip():
            continue
        chars.append({"char": str(text), "start": start, "end": end})
    return chars


class Qwen3AsrEngine(AsrEngine):
    name = "qwen3-asr"

    def __init__(
        self,
        model: str = MODEL_ID,
        device: str = "auto",
        compute_type: Optional[str] = None,
        use_vad: bool = False,
        vad_config: Optional[dict] = None,
    ) -> None:
        super().__init__(
            model=model or MODEL_ID,
            device=device,
            compute_type=compute_type,
            use_vad=use_vad,
            vad_config=vad_config,
        )
        self._model = None

    @staticmethod
    def is_available() -> bool:
        # 惰性：不 import qwen_asr（昂贵初始化），仅探测 spec
        return importlib.util.find_spec("qwen_asr") is not None

    @staticmethod
    def is_model_downloaded(model: str) -> bool:
        try:
            from huggingface_hub import try_to_load_from_cache
        except ImportError:
            return False
        asr_repo = model or MODEL_ID
        asr_marker = try_to_load_from_cache(asr_repo, "config.json")
        aligner_marker = try_to_load_from_cache(ALIGNER_MODEL_ID, "config.json")
        return (
            isinstance(asr_marker, str)
            and os.path.exists(asr_marker)
            and isinstance(aligner_marker, str)
            and os.path.exists(aligner_marker)
        )

    @staticmethod
    def download_model(
        model: str,
        *,
        progress: Optional[Callable[[int, int], None]] = None,
    ) -> None:
        try:
            import huggingface_hub
        except ImportError as exc:
            raise AsrError("缺少 huggingface_hub，无法下载 Qwen3-ASR 模型") from exc

        asr_repo = model or MODEL_ID
        repos = [asr_repo, ALIGNER_MODEL_ID]
        try:
            total_done = 0
            total_total = 0
            for repo in repos:
                path = huggingface_hub.snapshot_download(repo)
                if progress is not None:
                    repo_size = 0
                    for root, _, files in os.walk(path):
                        for file in files:
                            try:
                                repo_size += os.path.getsize(os.path.join(root, file))
                            except OSError:
                                pass
                    total_total += repo_size
                    total_done += repo_size
                    progress(total_done, total_total)
            if progress is not None:
                progress(total_total, total_total)
        except Exception as exc:  # noqa: BLE001
            raise AsrError(f"下载 Qwen3-ASR 模型失败（{asr_repo} / {ALIGNER_MODEL_ID}）：{exc}") from exc

    def load(self) -> None:
        if self._model is not None:
            debug_log("qwen3_load_skip_cached", model=self.model, device=self.device)
            return
        try:
            debug_log("qwen3_import_start", model=self.model)
            from qwen_asr import Qwen3ASRModel
            import torch
            debug_log(
                "qwen3_import_done",
                torchVersion=getattr(torch, "__version__", None),
                torchCuda=getattr(getattr(torch, "version", None), "cuda", None),
                cudaAvailable=bool(torch.cuda.is_available()),
            )
        except ImportError as exc:
            debug_exception("qwen3_import_error", exc)
            raise AsrError(
                "未安装 Qwen3-ASR 引擎，请运行 ./scripts/setup-asr.sh qwen3 "
                "（或 qwen3-cpu / qwen3-cuda）"
            ) from exc

        try:
            cuda_available = bool(torch.cuda.is_available())
            if self.device == "cuda" and not cuda_available:
                raise AsrError(f"无法使用 CUDA 加速：{cuda_unavailable_reason(torch)}")

            use_cuda = self.device == "cuda" or (self.device == "auto" and cuda_available)
            self.device = "cuda" if use_cuda else "cpu"
            dtype = torch.bfloat16 if use_cuda else torch.float32
            device_map = "cuda:0" if use_cuda else "cpu"

            debug_log("qwen3_from_pretrained_start", model=self.model, device=self.device, dtype=str(dtype))
            model = Qwen3ASRModel.from_pretrained(
                self.model or MODEL_ID,
                dtype=dtype,
                device_map=device_map,
                max_new_tokens=DEFAULT_MAX_NEW_TOKENS,
                forced_aligner=ALIGNER_MODEL_ID,
                forced_aligner_kwargs=dict(dtype=dtype, device_map=device_map),
            )
            debug_log("qwen3_from_pretrained_done", model=self.model)
            self._model = model
        except AsrError:
            raise
        except Exception as exc:  # noqa: BLE001
            debug_exception("qwen3_load_error", exc, model=self.model)
            raise AsrError(f"加载 Qwen3-ASR 模型失败（{self.model}）：{exc}") from exc

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

        duration = _duration_ms(audio_path)
        chunks = self._plan_chunks(audio_path, duration)
        debug_log(
            "qwen3_transcribe_start",
            audioPath=audio_path, durationMs=duration, chunkCount=len(chunks), useVad=self.use_vad,
        )

        def _iter() -> Iterator[AsrSegment]:
            yield from self._iter_transcribe_chunks(
                audio_path, duration, chunks,
                cancel_check=cancel_check,
                progress_callback=progress_callback,
            )

        return Transcription(duration_ms=duration, segments=_iter(), language="ja")

    def _plan_chunks(self, audio_path: str, duration_ms: int) -> list[tuple[int, int]]:
        """规划分块。启用 VAD 时优先用 VAD 语音段（失败降级固定分块）；否则固定 45s 分块。"""
        if self.use_vad:
            chunks = self._plan_vad_chunks(audio_path, duration_ms)
            if chunks:
                return chunks
            debug_log("qwen3_vad_fallback_to_fixed", audioPath=audio_path)
        return plan_audio_chunks(
            duration_ms,
            chunk_ms=CHUNK_MS,
            overlap_ms=CHUNK_OVERLAP_MS,
            min_chunking_duration_ms=CHUNK_MS,
        )

    def _plan_vad_chunks(self, audio_path: str, duration_ms: int) -> list[tuple[int, int]]:
        try:
            from .vad import VadEngine, split_long_segments

            vad = VadEngine()
            speech_segments = vad.detect_speech_segments(
                audio_path,
                threshold=self.vad_config.get("threshold", 0.5),
                min_speech_duration_ms=self.vad_config.get("min_speech_duration_ms", 500),
                min_silence_duration_ms=self.vad_config.get("min_silence_duration_ms", 300),
                speech_pad_ms=self.vad_config.get("speech_pad_ms", 400),
            )
            chunks = split_long_segments(
                speech_segments,
                max_duration_ms=self.vad_config.get("max_segment_duration_ms", 25_000),
                overlap_ms=CHUNK_OVERLAP_MS,
            )
            debug_log(
                "qwen3_vad_chunking",
                durationMs=duration_ms,
                speechSegmentCount=len(speech_segments),
                chunkCount=len(chunks),
            )
            return chunks
        except Exception as exc:
            debug_exception("qwen3_vad_error", exc, audioPath=audio_path)
            return []

    def _segments_from_result(self, result, *, fallback_duration_ms: int) -> List[AsrSegment]:
        """从单个 qwen-asr 结果组装 AsrSegment（块内相对时间，不加偏移）。

        调用方传入的是子段音频，qwen-asr 不再内部分块，time_stamps 为该子段内
        的相对时间（0 ~ chunk_duration）。全局偏移由 _iter_transcribe_chunks 加 chunk_start_ms。
        """
        if result is None:
            return []
        chars = _extract_char_timestamps(result)
        text = getattr(result, "text", "") or ""
        # _extract_char_timestamps 产出 dict 列表，chunking._normalize_char_item 兼容 dict
        segments = build_segments_from_char_timestamps(
            chars,
            text,
            fallback_duration_ms=fallback_duration_ms,
        )
        if not segments:
            return build_segments_from_text(text, duration_ms=fallback_duration_ms) if text else []
        return segments

    def _iter_transcribe_chunks(
        self,
        audio_path: str,
        duration_ms: int,
        chunks: list[tuple[int, int]],
        *,
        cancel_check: Optional[Callable[[], bool]] = None,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> Iterator[AsrSegment]:
        """逐块转录：切 wav → 调 qwen-asr → 组装段 → 加 chunk_start 偏移 → overlap 去重合并 → 惰性产出。

        每块完成上报真实进度（processed_ms = 该块 end_ms），并惰性 yield 去重后的新段，
        使 jobs.py 边迭代边更新进度，实现真实渐进进度。
        """
        import tempfile
        from pathlib import Path
        from engines.base import yield_unseen_segments

        chunk_results: list[tuple[int, list[AsrSegment]]] = []
        yielded: set[tuple[int, int, str]] = set()

        with tempfile.TemporaryDirectory(prefix="hikaru_qwen3_") as tmp:
            tmp_dir = Path(tmp)
            for index, (start_ms, end_ms) in enumerate(chunks, start=1):
                if cancel_check and cancel_check():
                    debug_log("qwen3_chunk_cancelled", chunkIndex=index, chunkCount=len(chunks))
                    break
                chunk_path = tmp_dir / f"chunk_{index:04d}.wav"
                _write_wav_chunk(audio_path, chunk_path, start_ms, end_ms)
                debug_log(
                    "qwen3_chunk_transcribe_start",
                    chunkIndex=index, chunkCount=len(chunks), startMs=start_ms, endMs=end_ms,
                )
                try:
                    results = self._model.transcribe(
                        audio=str(chunk_path), language=LANGUAGE_JA, return_time_stamps=True,
                    )
                except Exception as exc:
                    debug_exception("qwen3_chunk_transcribe_error", exc, chunkIndex=index)
                    raise AsrError(f"Qwen3-ASR 分块转录失败（chunk {index}）：{exc}") from exc
                result = results[0] if results else None
                # 块内相对时间 → 加 chunk_start_ms 得全局时间
                segs = self._segments_from_result(
                    result, fallback_duration_ms=max(1, end_ms - start_ms),
                )
                chunk_results.append((start_ms, segs))
                merged = merge_chunk_segments(chunk_results, overlap_ms=CHUNK_OVERLAP_MS)
                yield from yield_unseen_segments(yielded, merged)
                if progress_callback is not None:
                    progress_callback(end_ms)

        if cancel_check and cancel_check():
            return
        merged = merge_chunk_segments(chunk_results, overlap_ms=CHUNK_OVERLAP_MS)
        yield from yield_unseen_segments(yielded, merged)
