"""Shared Hugging Face snapshot download helpers."""

from __future__ import annotations

import importlib
import os
import threading
from contextlib import contextmanager
from typing import Any, Callable, Optional


# ponytail: older huggingface_hub versions expose byte progress through module-level
# tqdm hooks, so progress-enabled helper downloads are serialized while patched.
_PROGRESS_PATCH_LOCK = threading.Lock()


def make_progress_tqdm(report: Callable[[int, int], None]):
    """Build a tqdm subclass that aggregates actual downloaded bytes."""
    from tqdm.auto import tqdm as _base_tqdm

    lock = threading.Lock()
    bars: dict = {}

    def _emit() -> None:
        total = sum(bar["total"] for bar in bars.values())
        done = sum(bar["n"] for bar in bars.values())
        report(min(done, total) if total > 0 else done, total)

    def _progress_key(desc: str, total: int, initial: int):
        if initial > 0:
            with lock:
                for key, bar in reversed(tuple(bars.items())):
                    if (
                        bar["desc"] == desc
                        and bar["total"] == total
                        and bar["n"] == initial
                    ):
                        return key
        return object()

    def _sync(bar) -> None:
        if not bar._hikaru_track_bytes:
            return
        with lock:
            current = bars.get(bar._hikaru_progress_key)
            total = int(bar.total or 0)
            done = int(bar.n or 0)
            if current is None:
                bars[bar._hikaru_progress_key] = {
                    "desc": bar._hikaru_desc,
                    "total": total,
                    "n": done,
                }
            else:
                current["total"] = max(current["total"], total)
                current["n"] = max(current["n"], done)
            _emit()

    class _ProgressTqdm(_base_tqdm):  # type: ignore[misc]
        def __init__(self, *args, **kwargs):
            name = kwargs.pop("name", None)
            unit = kwargs.get("unit")
            desc = str(kwargs.get("desc") or "").strip()
            self._hikaru_track_bytes = False
            self._hikaru_progress_key = object()
            self._hikaru_desc = desc
            super().__init__(*args, **kwargs)
            self._hikaru_track_bytes = (
                unit == "B" and name == "huggingface_hub.http_get"
            )
            if self._hikaru_track_bytes:
                self._hikaru_progress_key = _progress_key(
                    desc,
                    int(self.total or 0),
                    int(self.n or 0),
                )
            _sync(self)

        def update(self, n=1):
            before = self.n
            result = super().update(n)
            if self.n == before and n:
                self.n += n
            _sync(self)
            return result

    return _ProgressTqdm


@contextmanager
def _patched_hf_download(tqdm_class):
    tqdm_targets = []
    xet_state = None
    try:
        for module_name in (
            "huggingface_hub.file_download",
            "huggingface_hub.utils.tqdm",
        ):
            try:
                module = importlib.import_module(module_name)
            except ImportError:
                continue
            if module_name.endswith("file_download"):
                original_xet = getattr(module, "is_xet_available", None)
                constants = getattr(module, "constants", None)
                previous_disabled = getattr(constants, "HF_HUB_DISABLE_XET", None)
                if original_xet is not None:
                    module.is_xet_available = lambda: False
                    if previous_disabled is not None:
                        constants.HF_HUB_DISABLE_XET = True
                    xet_state = (module, original_xet, constants, previous_disabled)
            original_tqdm = getattr(module, "tqdm", None)
            if original_tqdm is not None:
                tqdm_targets.append((module, original_tqdm))
                module.tqdm = tqdm_class
        yield
    finally:
        for module, original_tqdm in reversed(tqdm_targets):
            module.tqdm = original_tqdm
        if xet_state is not None:
            module, original_xet, constants, previous_disabled = xet_state
            if previous_disabled is not None:
                constants.HF_HUB_DISABLE_XET = previous_disabled
            module.is_xet_available = original_xet


def snapshot_download_repo(
    repo_id: str,
    *,
    progress: Optional[Callable[[int, int], None]] = None,
    **kwargs: Any,
) -> str:
    """Download a snapshot with shared progress and Windows cache behavior."""
    import huggingface_hub

    if os.name == "nt":
        kwargs = {**kwargs, "max_workers": 1}
    if progress is None:
        return huggingface_hub.snapshot_download(repo_id, **kwargs)

    tqdm_class = make_progress_tqdm(progress)
    kwargs = {**kwargs, "tqdm_class": tqdm_class}
    with _PROGRESS_PATCH_LOCK, _patched_hf_download(tqdm_class):
        return huggingface_hub.snapshot_download(repo_id, **kwargs)
