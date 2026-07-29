from __future__ import annotations

import hashlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import numpy as np
    import engines.silero_v4 as silero_v4_module
    from engines.silero_v4 import (
        SILERO_V4_SHA256,
        SILERO_V4_WINDOW_SAMPLES,
        SileroV4Cancelled,
        SileroV4Options,
        _infer_speech_probabilities,
        _speech_timestamps_from_probabilities,
        download_silero_v4,
        is_silero_v4_ready,
        silero_v4_asset_path,
        silero_v4_url,
    )
except ModuleNotFoundError as exc:
    raise unittest.SkipTest("requires Silero V4 runtime dependencies") from exc


class SileroV4AssetTests(unittest.TestCase):
    def test_uses_managed_hf_home_cache_path(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"HF_HOME": directory}, clear=False):
                self.assertEqual(
                    silero_v4_asset_path(),
                    Path(directory)
                    / "hikaru-sub"
                    / "silero-vad-v4"
                    / "silero_vad.onnx",
                )

    def test_selects_official_or_china_proxy_url(self):
        with patch.dict(os.environ, {}, clear=True):
            official = silero_v4_url()
        with patch.dict(
            os.environ,
            {"HF_ENDPOINT": "https://hf-mirror.com"},
            clear=True,
        ):
            china = silero_v4_url()

        self.assertIn("snakers4/silero-vad", official)
        self.assertIn("915dd3d639b8333a52e001af095f87c5b7f1e0ac", official)
        self.assertEqual(china, f"https://ghfast.top/{official}")

    def test_source_and_packaged_template_contain_no_v4_weights(self):
        repository = Path(__file__).resolve().parents[2]
        candidates = [
            *(
                repository / "asr-service" / "engines"
            ).rglob("*.onnx"),
            *(
                repository
                / "src-tauri"
                / "resources"
                / "asr-service"
            ).rglob("*.onnx"),
        ]
        self.assertEqual(candidates, [])

    def test_readiness_requires_the_fixed_sha256(self):
        payload = b"verified-v4"
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "silero_vad.onnx"
            target.write_bytes(payload)
            with patch(
                "engines.silero_v4.SILERO_V4_SHA256",
                hashlib.sha256(payload).hexdigest(),
            ):
                self.assertTrue(is_silero_v4_ready(target))
            self.assertFalse(is_silero_v4_ready(target))
        self.assertEqual(
            SILERO_V4_SHA256,
            "a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28",
        )

    def test_download_verifies_hash_and_replaces_atomically(self):
        payload = b"official-silero-v4"
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "silero_vad.onnx"
            with patch(
                "engines.silero_v4.SILERO_V4_SHA256",
                hashlib.sha256(payload).hexdigest(),
            ):
                result = download_silero_v4(
                    target,
                    opener=lambda _url, **_kwargs: io.BytesIO(payload),
                )

            self.assertEqual(result, target)
            self.assertEqual(target.read_bytes(), payload)
            self.assertEqual(list(target.parent.glob("*.tmp")), [])

    def test_download_uses_a_bounded_http_timeout(self):
        payload = b"official-silero-v4"
        observed = {}

        def opener(url, *, timeout):
            observed["url"] = url
            observed["timeout"] = timeout
            return io.BytesIO(payload)

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "silero_vad.onnx"
            with patch(
                "engines.silero_v4.SILERO_V4_SHA256",
                hashlib.sha256(payload).hexdigest(),
            ):
                download_silero_v4(target, opener=opener)

        self.assertIn("silero_vad.onnx", observed["url"])
        self.assertGreater(observed["timeout"], 0)
        self.assertTrue(np.isfinite(observed["timeout"]))

    def test_corrupt_download_keeps_no_asset_or_partial_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "silero_vad.onnx"
            with self.assertRaisesRegex(RuntimeError, "SHA-256"):
                download_silero_v4(
                    target,
                    opener=lambda _url, **_kwargs: io.BytesIO(b"corrupt"),
                )

            self.assertFalse(target.exists())
            self.assertEqual(list(target.parent.glob("*.tmp")), [])


class SileroV4InferenceTests(unittest.TestCase):
    def test_options_reject_invalid_threshold_duration_padding_and_max(self):
        invalid = (
            {"threshold": float("nan")},
            {"threshold": 2.0},
            {"threshold": -0.1},
            {"min_speech_duration_ms": -1},
            {"min_silence_duration_ms": 1.5},
            {"speech_pad_ms": -1},
            {"max_speech_duration_s": 0},
            {"max_speech_duration_s": float("nan")},
            {"max_speech_duration_s": float("-inf")},
        )

        for values in invalid:
            with self.subTest(values=values):
                with self.assertRaises((TypeError, ValueError)):
                    SileroV4Options(**values)

    def test_state_machine_rejects_invalid_rates_audio_length_and_probabilities(self):
        options = SileroV4Options()
        cases = (
            {"probabilities": [float("nan")]},
            {"probabilities": [1.5]},
            {"probabilities": [-0.1]},
            {"audio_length_samples": -1},
            {"sampling_rate": 0},
            {"window_size_samples": 0},
        )
        base = {
            "probabilities": [0.5],
            "audio_length_samples": 100,
            "sampling_rate": 1_000,
            "window_size_samples": 100,
            "options": options,
        }

        for override in cases:
            with self.subTest(override=override):
                with self.assertRaises((TypeError, ValueError)):
                    _speech_timestamps_from_probabilities(
                        **{**base, **override},
                    )

    def test_pinned_v4_hysteresis_does_not_clamp_low_threshold(self):
        chunks = _speech_timestamps_from_probabilities(
            [0.2, 0.0, 0.0],
            audio_length_samples=300,
            sampling_rate=1_000,
            window_size_samples=100,
            options=SileroV4Options(
                threshold=0.1,
                min_speech_duration_ms=0,
                min_silence_duration_ms=0,
                speech_pad_ms=0,
            ),
        )

        self.assertEqual(chunks, [{"start": 0, "end": 300}])

    def test_final_chunk_validation_rejects_invalid_bounds_and_order(self):
        invalid = (
            [{"start": 0, "end": 0}],
            [{"start": -1, "end": 1}],
            [{"start": 0, "end": 101}],
            [{"start": 10, "end": 20}, {"start": 19, "end": 30}],
        )
        for chunks in invalid:
            with self.subTest(chunks=chunks):
                with self.assertRaises(ValueError):
                    silero_v4_module._validate_speech_chunks(
                        chunks,
                        audio_length_samples=100,
                    )

    def test_onnx_probability_must_be_finite_and_in_unit_interval(self):
        for probability in (float("nan"), -0.1, 1.5):
            with self.subTest(probability=probability):
                session = MagicMock()
                session.run.return_value = (
                    np.array([[probability]], dtype=np.float32),
                    np.zeros((2, 1, 64), dtype=np.float32),
                    np.zeros((2, 1, 64), dtype=np.float32),
                )
                with self.assertRaises(RuntimeError):
                    _infer_speech_probabilities(
                        np.zeros(SILERO_V4_WINDOW_SAMPLES, dtype=np.float32),
                        session,
                    )

    def test_onnx_state_is_initialized_carried_and_final_window_is_padded(self):
        session = MagicMock()
        first_h = np.ones((2, 1, 64), dtype=np.float32)
        first_c = np.full((2, 1, 64), 2, dtype=np.float32)
        session.run.side_effect = [
            (np.array([[0.2]], dtype=np.float32), first_h, first_c),
            (
                np.array([[0.8]], dtype=np.float32),
                np.full((2, 1, 64), 3, dtype=np.float32),
                np.full((2, 1, 64), 4, dtype=np.float32),
            ),
        ]
        audio = np.ones(SILERO_V4_WINDOW_SAMPLES + 7, dtype=np.float32)

        probabilities = _infer_speech_probabilities(audio, session)

        np.testing.assert_allclose(probabilities, [0.2, 0.8])
        first_inputs = session.run.call_args_list[0].args[1]
        second_inputs = session.run.call_args_list[1].args[1]
        self.assertEqual(first_inputs["input"].shape, (1, SILERO_V4_WINDOW_SAMPLES))
        self.assertEqual(second_inputs["input"].shape, (1, SILERO_V4_WINDOW_SAMPLES))
        self.assertTrue(np.all(second_inputs["input"][0, 7:] == 0))
        self.assertTrue(np.array_equal(second_inputs["h"], first_h))
        self.assertTrue(np.array_equal(second_inputs["c"], first_c))
        self.assertEqual(int(first_inputs["sr"]), 16_000)

    def test_cancellation_stops_before_another_onnx_window(self):
        session = MagicMock()
        session.run.return_value = (
            np.array([[0.1]], dtype=np.float32),
            np.zeros((2, 1, 64), dtype=np.float32),
            np.zeros((2, 1, 64), dtype=np.float32),
        )
        cancel = MagicMock(side_effect=[False, True])

        with self.assertRaises(SileroV4Cancelled):
            _infer_speech_probabilities(
                np.zeros(SILERO_V4_WINDOW_SAMPLES * 2, dtype=np.float32),
                session,
                cancel_check=cancel,
            )
        session.run.assert_called_once()

    def test_threshold_silence_speech_length_and_padding_state_machine(self):
        chunks = _speech_timestamps_from_probabilities(
            [0.1, 0.8, 0.8, 0.1, 0.1, 0.1, 0.1],
            audio_length_samples=700,
            sampling_rate=1_000,
            window_size_samples=100,
            options=SileroV4Options(
                threshold=0.45,
                min_speech_duration_ms=100,
                min_silence_duration_ms=200,
                speech_pad_ms=50,
            ),
        )

        self.assertEqual(chunks, [{"start": 50, "end": 350}])

    def test_short_speech_is_discarded_and_custom_max_speech_splits(self):
        short = _speech_timestamps_from_probabilities(
            [0.8, 0.1, 0.1],
            audio_length_samples=300,
            sampling_rate=1_000,
            window_size_samples=100,
            options=SileroV4Options(
                min_speech_duration_ms=150,
                min_silence_duration_ms=100,
                speech_pad_ms=0,
            ),
        )
        limited = _speech_timestamps_from_probabilities(
            [0.8] * 8,
            audio_length_samples=800,
            sampling_rate=1_000,
            window_size_samples=100,
            options=SileroV4Options(
                min_speech_duration_ms=0,
                min_silence_duration_ms=100,
                speech_pad_ms=0,
                max_speech_duration_s=0.35,
            ),
        )

        self.assertEqual(short, [])
        self.assertGreaterEqual(len(limited), 2)
        self.assertTrue(all(chunk["end"] > chunk["start"] for chunk in limited))


if __name__ == "__main__":
    unittest.main()
