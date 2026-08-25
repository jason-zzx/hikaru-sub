#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from faster_whisper.tokenizer import Tokenizer
from tokenizers import Tokenizer as HfTokenizer

import generate_whisper_short_parity_inputs as inputs
import whisper_short_parser_oracle as oracle
import whisper_short_vad_preflight as vad_preflight


class ShortParityOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        tokenizer_path = Path(
            ".trellis/tasks/archive/2026-08/08-02-native-asr-ctranslate2-whisper/"
            "research/local/models/large-v3/tokenizer.json"
        ).resolve()
        if not tokenizer_path.is_file():
            raise unittest.SkipTest("pinned ignored-local tokenizer is unavailable")
        cls.tokenizer = Tokenizer(
            HfTokenizer.from_file(str(tokenizer_path)),
            multilingual=True,
            task="transcribe",
            language="ja",
        )

    def test_timestamp_split_matches_upstream_short_semantics(self):
        text_tokens = self.tokenizer.encode("\u30c6\u30b9\u30c8")
        tokens = [
            self.tokenizer.timestamp_begin,
            *text_tokens,
            self.tokenizer.timestamp_begin + 10,
            self.tokenizer.timestamp_begin + 10,
        ]
        segments = oracle.python_segments(tokens, self.tokenizer)
        native_segments = oracle.native_segments(tokens, self.tokenizer)
        self.assertEqual(len(segments), 1)
        self.assertEqual((segments[0]["startMs"], segments[0]["endMs"]), (0, 200))
        self.assertEqual(segments[0]["text"], "\u30c6\u30b9\u30c8")
        self.assertEqual(native_segments, segments)

    def test_zero_duration_timestamp_slice_is_not_emitted(self):
        self.assertEqual(
            oracle.python_segments(
                [self.tokenizer.timestamp_begin, self.tokenizer.timestamp_begin],
                self.tokenizer,
            ),
            [],
        )

    def test_native_parser_rejects_missing_timestamp_pair(self):
        with self.assertRaises(ValueError):
            oracle.native_segments(
                self.tokenizer.encode("\u30c6\u30b9\u30c8"),
                self.tokenizer,
            )

    def test_no_timestamp_uses_frozen_short_duration(self):
        segments = oracle.python_segments(
            self.tokenizer.encode("\u30c6\u30b9\u30c8"),
            self.tokenizer,
        )
        self.assertEqual((segments[0]["startMs"], segments[0]["endMs"]), (0, 24100))

    def test_input_constants_bind_known_mels(self):
        self.assertEqual(inputs.PYTHON_MEL_SHA256, "51209b71c3450718055dfad8a3d5923283dd95d702d606b0bdf56aac53218aa9")
        self.assertEqual(inputs.NATIVE_MEL_SHA256, "c2fc425ae691a4b1f9acd92580061ad97df82e01165747d761653f87634b9e08")

    def test_vad_output_requires_canonical_local_containment(self):
        with tempfile.TemporaryDirectory(dir=vad_preflight.LOCAL_ROOT) as directory:
            path = Path(directory) / "result.json"
            self.assertEqual(vad_preflight.require_local_output(path), path.resolve())
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                vad_preflight.require_local_output(Path(directory) / "result.json")

    def test_ort_import_smoke_matches_frozen_module_shape(self):
        import onnxruntime
        import onnxruntime.capi.onnxruntime_pybind11_state

        capi_root = Path(onnxruntime.__file__).resolve().parent / "capi"
        loaded = vad_preflight.exact_ort_module_paths(
            vad_preflight.loaded_process_module_paths(), capi_root
        )
        self.assertEqual(
            [path.name for path in loaded],
            ["onnxruntime_providers_shared.dll", "onnxruntime_pybind11_state.pyd"],
        )
        self.assertNotIn("onnxruntime.dll", [path.name for path in loaded])

    def test_module_path_lookup_failure_is_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "path is unavailable"):
            vad_preflight.resolved_module_path(0, "")

    def test_ort_module_inventory_rejects_cross_root_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            capi_root = (root / "capi").resolve()
            other_root = (root / "other").resolve()
            capi_root.mkdir()
            other_root.mkdir()
            with self.assertRaisesRegex(ValueError, "root drifted"):
                vad_preflight.exact_ort_module_paths(
                    [
                        capi_root / "onnxruntime_pybind11_state.pyd",
                        capi_root / "onnxruntime_providers_shared.dll",
                        other_root / "onnxruntime.dll",
                    ],
                    capi_root,
                )

    def test_vad_preflight_result_is_sanitized_and_deterministic(self):
        identity = {
            "audio": {"wavSha256": "a" * 64},
            "vadPreflight": {
                "onnxRuntimeVersion": "1.26.0",
                "options": {"threshold": 0.5},
            },
        }
        arguments = (
            identity,
            "b" * 64,
            [{"name": "vad.py", "sizeBytes": 1, "sha256": "c" * 64}],
            [
                {"name": "onnxruntime_providers_shared.dll", "sizeBytes": 1, "sha256": "d" * 64},
                {"name": "onnxruntime_pybind11_state.pyd", "sizeBytes": 1, "sha256": "f" * 64},
            ],
            [{"name": "onnxruntime.dll", "sizeBytes": 1, "sha256": "7" * 64}],
            ["CPUExecutionProvider"],
            [{"start": 0, "end": 385637}],
            "e" * 64,
            "e" * 64,
            385637,
        )
        first = vad_preflight.build_result(*arguments)
        second = vad_preflight.build_result(*arguments)
        self.assertEqual(first, second)
        self.assertNotIn("path", str(first).lower())
        self.assertFalse(first["qualificationEligible"])
        self.assertFalse(first["promotionEligible"])


if __name__ == "__main__":
    unittest.main()
