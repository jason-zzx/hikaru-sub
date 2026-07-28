"""Process-wide inference coordination for CTranslate2 Whisper engines."""

from __future__ import annotations

import secrets
import threading
from contextlib import contextmanager
from typing import Iterator

from .base import AsrError

_WHISPER_ENGINE_NAMES = frozenset({"faster-whisper", "kotoba-faster-whisper"})
# ponytail: process-global seed needs one lock; use separate sidecars for parallel Whisper jobs.
_WHISPER_INFERENCE_LOCK = threading.Lock()
_ACTIVE_SESSION = threading.local()
_WHISPER_RUNTIME_POISONED = False
_MAX_RANDOM_SEED = 2**31 - 1


def mark_long_runtime_seeded() -> None:
    """Claim seed-0 ownership for the active Whisper inference session."""
    if getattr(_ACTIVE_SESSION, "seeded_long_runtime", None) is None:
        raise AsrError(
            "长音频 Whisper 推理必须由 whisper_inference_session 管理"
        )
    _ACTIVE_SESSION.seeded_long_runtime = True


def _reset_runtime_seed() -> None:
    try:
        import ctranslate2

        seed = secrets.randbelow(_MAX_RANDOM_SEED) + 1
        ctranslate2.set_random_seed(seed)
    except Exception as exc:
        raise AsrError(
            f"恢复 Whisper 随机运行时失败，状态未知；请重启 ASR 服务：{exc}"
        ) from exc


@contextmanager
def whisper_inference_session(engine_name: str) -> Iterator[None]:
    """Serialize only Whisper-family handle creation and lazy inference.

    Long mode owns seed 0 for the complete decode. Before releasing the shared
    lock, replace it with a fresh nonzero system-random seed so later short and
    Kotoba jobs keep their normal nondeterministic fallback behavior. A failed
    reset poisons Whisper inference until the sidecar process restarts.
    """
    global _WHISPER_RUNTIME_POISONED

    if engine_name not in _WHISPER_ENGINE_NAMES:
        yield
        return

    with _WHISPER_INFERENCE_LOCK:
        if _WHISPER_RUNTIME_POISONED:
            raise AsrError(
                "Whisper 随机运行时状态未知；请重启 ASR 服务后重试"
            )
        _ACTIVE_SESSION.seeded_long_runtime = False
        try:
            yield
        finally:
            try:
                if _ACTIVE_SESSION.seeded_long_runtime:
                    try:
                        _reset_runtime_seed()
                    except BaseException:
                        _WHISPER_RUNTIME_POISONED = True
                        raise
            finally:
                del _ACTIVE_SESSION.seeded_long_runtime
