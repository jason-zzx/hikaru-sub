"""Tests for shared Hugging Face download helpers."""

from __future__ import annotations

import unittest
from types import ModuleType
from unittest.mock import MagicMock, patch

from engines.hf_download import make_progress_tqdm, snapshot_download_repo


class _FakeTqdm:
    def __init__(self, *args, **kwargs):
        self.total = kwargs.get("total")
        self.n = kwargs.get("initial", 0)
        self.disable = kwargs.get("disable", False)

    def update(self, n=1):
        if not self.disable:
            self.n += n


def _fake_hub_modules():
    original_tqdm = object()
    original_xet = MagicMock(return_value=True)
    hub = ModuleType("huggingface_hub")
    hub.__path__ = []
    file_download = ModuleType("huggingface_hub.file_download")
    file_download.tqdm = original_tqdm
    file_download.is_xet_available = original_xet
    file_download.constants = ModuleType("huggingface_hub.constants")
    file_download.constants.HF_HUB_DISABLE_XET = False
    utils = ModuleType("huggingface_hub.utils")
    utils.__path__ = []
    utils_tqdm = ModuleType("huggingface_hub.utils.tqdm")
    utils_tqdm.tqdm = original_tqdm
    modules = {
        "huggingface_hub": hub,
        "huggingface_hub.file_download": file_download,
        "huggingface_hub.utils": utils,
        "huggingface_hub.utils.tqdm": utils_tqdm,
    }
    return modules, hub, file_download, utils_tqdm, original_tqdm, original_xet


class HfDownloadTests(unittest.TestCase):
    def test_progress_tqdm_reports_bytes_and_ignores_file_counter(self):
        auto = ModuleType("tqdm.auto")
        auto.tqdm = _FakeTqdm
        tqdm = ModuleType("tqdm")
        tqdm.auto = auto
        reports = []

        with patch.dict("sys.modules", {"tqdm": tqdm, "tqdm.auto": auto}):
            progress_tqdm = make_progress_tqdm(
                lambda done, total: reports.append((done, total))
            )
            counter = progress_tqdm(total=5, unit="it")
            counter.update(1)
            download = progress_tqdm(
                total=100,
                initial=10,
                unit="B",
                desc="weights.bin",
                name="huggingface_hub.http_get",
            )
            download.update(25)
            retry = progress_tqdm(
                total=100,
                initial=35,
                unit="B",
                desc="weights.bin",
                name="huggingface_hub.http_get",
                disable=True,
            )
            retry.update(65)

        self.assertEqual(
            reports,
            [(10, 100), (35, 100), (35, 100), (100, 100)],
        )

    def test_progress_tqdm_keeps_independent_files_with_same_description(self):
        auto = ModuleType("tqdm.auto")
        auto.tqdm = _FakeTqdm
        tqdm = ModuleType("tqdm")
        tqdm.auto = auto
        reports = []

        with patch.dict("sys.modules", {"tqdm": tqdm, "tqdm.auto": auto}):
            progress_tqdm = make_progress_tqdm(
                lambda done, total: reports.append((done, total))
            )
            first = progress_tqdm(
                total=100,
                unit="B",
                desc="weights.bin",
                name="huggingface_hub.http_get",
                disable=True,
            )
            first.update(100)
            second = progress_tqdm(
                total=100,
                unit="B",
                desc="weights.bin",
                name="huggingface_hub.http_get",
                disable=True,
            )
            second.update(100)

        self.assertEqual(
            reports,
            [(0, 100), (100, 100), (100, 200), (200, 200)],
        )

    def test_snapshot_download_patches_and_restores_http_progress_tqdm(self):
        modules, hub, file_download, utils_tqdm, original, original_xet = (
            _fake_hub_modules()
        )
        marker = object()

        def fake_snapshot(repo_id, **kwargs):
            self.assertEqual(repo_id, "owner/model")
            self.assertFalse(file_download.is_xet_available())
            self.assertTrue(file_download.constants.HF_HUB_DISABLE_XET)
            self.assertIs(kwargs["tqdm_class"], marker)
            self.assertIs(file_download.tqdm, marker)
            self.assertIs(utils_tqdm.tqdm, marker)
            return "/cache/path"

        hub.snapshot_download = fake_snapshot
        with patch.dict("sys.modules", modules), patch(
            "engines.hf_download.make_progress_tqdm", return_value=marker
        ):
            path = snapshot_download_repo("owner/model", progress=MagicMock())

            self.assertEqual(path, "/cache/path")
            self.assertIs(file_download.is_xet_available, original_xet)
            self.assertFalse(file_download.constants.HF_HUB_DISABLE_XET)
            self.assertIs(file_download.tqdm, original)
            self.assertIs(utils_tqdm.tqdm, original)

    def test_snapshot_download_restores_progress_state_after_error(self):
        modules, hub, file_download, _, original, original_xet = (
            _fake_hub_modules()
        )
        hub.snapshot_download = MagicMock(side_effect=RuntimeError("network"))

        with patch.dict("sys.modules", modules), patch(
            "engines.hf_download.make_progress_tqdm", return_value=object()
        ):
            with self.assertRaisesRegex(RuntimeError, "network"):
                snapshot_download_repo("owner/model", progress=MagicMock())

            self.assertIs(file_download.is_xet_available, original_xet)
            self.assertFalse(file_download.constants.HF_HUB_DISABLE_XET)
            self.assertIs(file_download.tqdm, original)

    def test_snapshot_download_without_progress_preserves_xet(self):
        modules, hub, file_download, _, _, original_xet = _fake_hub_modules()

        def fake_snapshot(repo_id, **kwargs):
            self.assertEqual(repo_id, "owner/model")
            self.assertIs(file_download.is_xet_available, original_xet)
            self.assertTrue(file_download.is_xet_available())
            self.assertFalse(file_download.constants.HF_HUB_DISABLE_XET)
            self.assertNotIn("tqdm_class", kwargs)
            return "/cache/path"

        hub.snapshot_download = fake_snapshot
        with patch.dict("sys.modules", modules):
            path = snapshot_download_repo("owner/model")

        self.assertEqual(path, "/cache/path")

    def test_snapshot_download_uses_one_worker_on_windows(self):
        progress = MagicMock()
        hub = MagicMock()
        hub.snapshot_download.return_value = "/cache/path"
        with patch.dict("sys.modules", {"huggingface_hub": hub}), patch(
            "engines.hf_download.make_progress_tqdm", return_value=object()
        ), patch("engines.hf_download.os.name", "nt"):
            path = snapshot_download_repo(
                "owner/model",
                progress=progress,
                allow_patterns=["weights.bin"],
            )

        self.assertEqual(path, "/cache/path")
        kwargs = hub.snapshot_download.call_args.kwargs
        self.assertEqual(kwargs["max_workers"], 1)
        self.assertEqual(kwargs["allow_patterns"], ["weights.bin"])
        self.assertIn("tqdm_class", kwargs)

    def test_snapshot_download_keeps_default_workers_off_windows(self):
        hub = MagicMock()
        hub.snapshot_download.return_value = "/cache/path"
        with patch.dict("sys.modules", {"huggingface_hub": hub}), patch(
            "engines.hf_download.os.name", "posix"
        ):
            snapshot_download_repo("owner/model")

        self.assertNotIn("max_workers", hub.snapshot_download.call_args.kwargs)


if __name__ == "__main__":
    unittest.main()
