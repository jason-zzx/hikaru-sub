"""Tests for shared Hugging Face download helpers."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from engines.hf_download import snapshot_download_repo


class HfDownloadTests(unittest.TestCase):
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
