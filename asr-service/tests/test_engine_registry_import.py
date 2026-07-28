from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


class EngineRegistryImportTests(unittest.TestCase):
    def test_service_import_does_not_require_faster_whisper_or_numpy(self):
        sidecar = Path(__file__).resolve().parents[1]
        script = """
import builtins

original_import = builtins.__import__


def import_without_optional_runtime(
    name, globals=None, locals=None, fromlist=(), level=0
):
    if level == 0 and (
        name in {"faster_whisper", "numpy"}
        or name.startswith(("faster_whisper.", "numpy."))
    ):
        raise ModuleNotFoundError(f"{name} intentionally unavailable")
    return original_import(name, globals, locals, fromlist, level)


builtins.__import__ = import_without_optional_runtime
import engines.registry
import server
"""
        completed = subprocess.run(
            [sys.executable, "-c", script],
            cwd=sidecar,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )

        self.assertEqual(
            completed.returncode,
            0,
            completed.stderr or completed.stdout,
        )


if __name__ == "__main__":
    unittest.main()
