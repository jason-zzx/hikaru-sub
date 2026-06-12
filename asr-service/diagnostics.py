"""Lightweight JSONL diagnostics for the ASR sidecar.

Logging is enabled only when `HIKARU_ASR_DEBUG_LOG` is set by the Tauri host.
"""

from __future__ import annotations

import json
import os
import threading
import time
import traceback
from pathlib import Path
from typing import Any

_LOG_PATH = os.environ.get("HIKARU_ASR_DEBUG_LOG")
_LOCK = threading.Lock()


def debug_log(event: str, **fields: Any) -> None:
    if not _LOG_PATH:
        return
    payload = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "mono": round(time.monotonic(), 3),
        "pid": os.getpid(),
        "thread": threading.current_thread().name,
        "event": event,
        **fields,
    }
    try:
        line = json.dumps(payload, ensure_ascii=False, default=str)
        with _LOCK:
            with Path(_LOG_PATH).open("a", encoding="utf-8") as f:
                f.write(f"{line}\n")
    except Exception:
        # Diagnostics must never affect transcription.
        return


def debug_exception(event: str, exc: BaseException, **fields: Any) -> None:
    debug_log(
        event,
        error=repr(exc),
        traceback="".join(traceback.format_exception(type(exc), exc, exc.__traceback__)),
        **fields,
    )
