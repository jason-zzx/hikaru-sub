#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


TOOL_PATH = Path(__file__).resolve().with_name("whisper_short_vad_preflight.py")


def load_tool():
    spec = importlib.util.spec_from_file_location("whisper_short_vad_preflight_v5_test", TOOL_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("VAD preflight tool import spec is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class VadPreflightV5LockTests(unittest.TestCase):
    @staticmethod
    def model_modules() -> set[str]:
        return {
            name
            for name in sys.modules
            if name == "faster_whisper"
            or name.startswith("faster_whisper.")
            or name == "onnxruntime"
            or name.startswith("onnxruntime.")
        }

    @classmethod
    def setUpClass(cls) -> None:
        cls.model_modules_before = cls.model_modules()
        cls.tool = load_tool()
        cls.model_modules_after_tool_import = cls.model_modules()

    def test_tool_import_is_pre_model(self):
        self.assertEqual(
            self.model_modules_after_tool_import,
            self.model_modules_before,
        )

    def test_exact_v5_reaches_identity_load_boundary(self):
        expected = ({"candidateId": "short-input-runtime-parity-bisect-v1"}, "a" * 64)
        with mock.patch.object(self.tool, "load_identity", return_value=expected) as load_identity:
            self.assertEqual(
                self.tool.load_selected_identity(self.tool.V5_LOCK, self.tool.SHORT_AUDIO),
                expected,
            )
        load_identity.assert_called_once_with(self.tool.V5_LOCK)

    def test_old_unknown_cross_root_and_malformed_locks_fail_before_identity_load(self):
        old_locks = [
            self.tool.TASK_ROOT / "gpu-short-parity-bisect-lock.md",
            *(
                self.tool.TASK_ROOT / f"gpu-short-parity-bisect-lock-v{version}.md"
                for version in range(2, 5)
            ),
        ]
        with tempfile.TemporaryDirectory() as directory:
            rejected = [
                *old_locks,
                self.tool.TASK_ROOT / "gpu-short-parity-bisect-lock-v6.md",
                Path(directory).resolve() / self.tool.V5_LOCK.name,
                self.tool.V5_LOCK / "child",
            ]
            for lock_path in rejected:
                with self.subTest(lock_path=lock_path):
                    with mock.patch.object(self.tool, "load_identity") as load_identity:
                        with self.assertRaisesRegex(ValueError, "input path identity drifted"):
                            self.tool.load_selected_identity(lock_path, self.tool.SHORT_AUDIO)
                    load_identity.assert_not_called()

    def test_wrong_audio_fails_before_identity_load(self):
        with mock.patch.object(self.tool, "load_identity") as load_identity:
            with self.assertRaisesRegex(ValueError, "input path identity drifted"):
                self.tool.load_selected_identity(
                    self.tool.V5_LOCK,
                    self.tool.SHORT_AUDIO.with_name("medium.wav"),
                )
        load_identity.assert_not_called()

    def test_frozen_v5_identity_loads_without_model_imports(self):
        before = self.model_modules()
        identity, lock_sha256 = self.tool.load_selected_identity(
            self.tool.V5_LOCK, self.tool.SHORT_AUDIO
        )
        self.assertEqual(identity["candidateId"], "short-input-runtime-parity-bisect-v1")
        self.assertRegex(lock_sha256, r"^[0-9a-f]{64}$")
        self.assertEqual(self.model_modules(), before)


if __name__ == "__main__":
    unittest.main()
