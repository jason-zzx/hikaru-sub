"""Shared Hugging Face snapshot download helpers."""

from __future__ import annotations

import os
import threading
from typing import Any, Callable, Optional


def make_progress_tqdm(report: Callable[[int, int], None]):
    """Build a tqdm subclass that aggregates file-byte progress for report(done, total)."""
    from tqdm.auto import tqdm as _base_tqdm

    lock = threading.Lock()
    bars: dict = {}

    def _emit() -> None:
        total = sum(b["total"] for b in bars.values())
        done = sum(b["n"] for b in bars.values())
        report(done, total)

    class _ProgressTqdm(_base_tqdm):  # type: ignore[misc]
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            with lock:
                bars[id(self)] = {"total": self.total or 0, "n": self.n or 0}
                _emit()

        def update(self, n=1):
            ret = super().update(n)
            with lock:
                bar = bars.get(id(self))
                if bar is not None:
                    bar["n"] = self.n
                    bar["total"] = self.total or bar["total"]
                _emit()
            return ret

        def close(self):
            with lock:
                bar = bars.get(id(self))
                if bar is not None and self.total:
                    bar["n"] = self.total
                _emit()
            return super().close()

    return _ProgressTqdm


def snapshot_download_repo(
    repo_id: str,
    *,
    progress: Optional[Callable[[int, int], None]] = None,
    **kwargs: Any,
) -> str:
    """Download a snapshot with shared progress and Windows cache behavior."""
    import huggingface_hub

    if progress is not None:
        kwargs = {**kwargs, "tqdm_class": make_progress_tqdm(progress)}
    if os.name == "nt":
        kwargs = {**kwargs, "max_workers": 1}
    return huggingface_hub.snapshot_download(repo_id, **kwargs)
