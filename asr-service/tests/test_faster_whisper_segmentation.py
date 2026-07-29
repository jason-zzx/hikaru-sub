"""Routing, decode-path, hard-hole, and timestamp-bound tests."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

try:
    import faster_whisper  # noqa: F401
    import numpy as np
except ModuleNotFoundError as exc:
    raise unittest.SkipTest("requires faster-whisper runtime dependencies") from exc

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import engines.faster_whisper as faster_whisper_module
from engines.base import AsrError, AsrSegment, Transcription
from engines.faster_whisper import FasterWhisperEngine
from engines.kotoba_faster_whisper import MODEL_ID, KotobaFasterWhisperEngine
from engines.whisper_runtime import whisper_inference_session


def _word(text, start, end):
    return SimpleNamespace(word=text, start=start, end=end, probability=1.0)


def _segment(text, start, end, words=None):
    return SimpleNamespace(text=text, start=start, end=end, words=words)


def _items(output):
    return [(item.start_ms, item.end_ms, item.text) for item in output]


def _empty_transcription(duration_ms=0):
    return Transcription(duration_ms=duration_ms, segments=iter(()), language="ja")


class RoutingTests(unittest.TestCase):
    def _route(self, *, duration_ms, model="large-v2", language="ja"):
        engine = FasterWhisperEngine(model=model)
        short = MagicMock(return_value=_empty_transcription(duration_ms))
        long = MagicMock(return_value=_empty_transcription(duration_ms))
        engine._transcribe_short = short
        engine._transcribe_long = long

        with patch(
            "engines.faster_whisper._duration_ms",
            return_value=duration_ms,
        ) as duration:
            result = engine.transcribe("source.wav", language=language)

        duration.assert_called_once_with("source.wav")
        return result, short, long

    def test_duration_threshold_routes_only_600000_and_above_to_long_mode(self):
        for duration_ms, expected_long in ((599_999, False), (600_000, True)):
            with self.subTest(duration_ms=duration_ms):
                _result, short, long = self._route(duration_ms=duration_ms)
                self.assertEqual(long.called, expected_long)
                self.assertEqual(short.called, not expected_long)

    def test_other_model_or_language_stays_on_short_upstream_path(self):
        cases = (("base", "ja"), ("large-v2", "en"), ("large-v2", None))
        for model, language in cases:
            with self.subTest(model=model, language=language):
                _result, short, long = self._route(
                    duration_ms=600_000,
                    model=model,
                    language=language,
                )
                short.assert_called_once()
                long.assert_not_called()

    def test_long_compute_contract_is_fixed_without_changing_short_resolution(self):
        self.assertEqual(
            faster_whisper_module._resolve_compute_type("cuda", None),
            "float16",
        )
        self.assertEqual(
            faster_whisper_module._resolve_compute_type("auto", None),
            "default",
        )
        self.assertEqual(
            faster_whisper_module._resolve_long_compute_type("cuda"),
            "int8_float16",
        )
        self.assertEqual(
            faster_whisper_module._resolve_long_compute_type("auto"),
            "int8_float16",
        )
        self.assertEqual(
            faster_whisper_module._resolve_long_compute_type("cpu"),
            "int8",
        )


class ShortDecodeTests(unittest.TestCase):
    def test_short_path_uses_upstream_v6_without_long_prompt_or_words(self):
        engine = FasterWhisperEngine(model="large-v2")
        model = MagicMock()
        model.transcribe.return_value = (
            iter([_segment("通常", 1.0, 2.0)]),
            SimpleNamespace(duration=3.0, language="ja"),
        )
        engine._model = model
        engine._loaded_long_mode = False

        transcription = engine._transcribe_short("dummy.wav", language="ja")
        output = list(transcription.segments)

        self.assertEqual(_items(output), [(1_000, 2_000, "通常")])
        model.transcribe.assert_called_once_with(
            "dummy.wav",
            language="ja",
            vad_filter=True,
            vad_parameters=None,
            beam_size=5,
        )

    def test_short_path_does_not_set_long_runtime_seed(self):
        engine = FasterWhisperEngine(model="large-v2")
        model = MagicMock()
        model.transcribe.return_value = (
            iter(()),
            SimpleNamespace(duration=3.0, language="ja"),
        )
        engine._model = model
        engine._loaded_long_mode = False

        with patch("ctranslate2.set_random_seed") as set_random_seed:
            engine._transcribe_short("dummy.wav", language="ja")

        set_random_seed.assert_not_called()

    def test_short_path_keeps_custom_v6_vad_meaning(self):
        engine = FasterWhisperEngine(
            model="large-v2",
            use_vad=True,
            vad_config={
                "threshold": 0.6,
                "min_speech_duration_ms": 1_000,
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 250,
                "max_segment_duration_ms": 30_000,
            },
        )
        model = MagicMock()
        model.transcribe.return_value = (
            iter(()),
            SimpleNamespace(duration=3.0, language="ja"),
        )
        engine._model = model
        engine._loaded_long_mode = False

        engine._transcribe_short("dummy.wav", language="ja")

        self.assertEqual(
            model.transcribe.call_args.kwargs["vad_parameters"],
            {
                "threshold": 0.6,
                "min_speech_duration_ms": 1_000,
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 250,
                "max_speech_duration_s": 30.0,
            },
        )

    def test_wraps_lazy_short_inference_errors_as_asr_errors(self):
        def broken_segments():
            raise RuntimeError("lazy inference failed")
            yield

        engine = FasterWhisperEngine(model="base")
        model = MagicMock()
        model.transcribe.return_value = (
            broken_segments(),
            SimpleNamespace(duration=10.0, language="ja"),
        )
        engine._model = model
        engine._loaded_long_mode = False

        transcription = engine._transcribe_short("dummy.wav", language="ja")

        with self.assertRaisesRegex(AsrError, "转录失败"):
            list(transcription.segments)


class LongDecodeTests(unittest.TestCase):
    def test_long_path_sets_seed_zero_before_model_load(self):
        engine = FasterWhisperEngine(model="large-v2")
        events = []

        def load_model(*, long_mode):
            events.append(("load", long_mode))
            engine._model = MagicMock()
            engine._loaded_long_mode = long_mode

        with (
            patch(
                "engines.silero_v4.is_silero_v4_ready",
                return_value=True,
            ),
            patch(
                "ctranslate2.set_random_seed",
                side_effect=lambda seed: events.append(("seed", seed)),
            ),
            patch(
                "engines.whisper_runtime.secrets.randbelow",
                return_value=40,
            ),
            patch.object(engine, "_load_model", side_effect=load_model),
            patch(
                "faster_whisper.audio.decode_audio",
                return_value=np.zeros(1, dtype=np.float32),
            ),
            patch(
                "engines.silero_v4.get_speech_timestamps_v4",
                return_value=[],
            ),
        ):
            with whisper_inference_session("faster-whisper"):
                transcription = engine._transcribe_long(
                    "source.wav",
                    language="ja",
                    duration_ms=600_000,
                )
                self.assertEqual(list(transcription.segments), [])

        self.assertEqual(
            events,
            [("seed", 0), ("load", True), ("seed", 41)],
        )

    def test_direct_long_transcribe_requires_inference_session_before_seed_zero(self):
        engine = FasterWhisperEngine(model="large-v2")
        with (
            patch(
                "engines.faster_whisper._duration_ms",
                return_value=600_000,
            ),
            patch(
                "engines.silero_v4.is_silero_v4_ready",
                return_value=True,
            ),
            patch("ctranslate2.set_random_seed") as set_random_seed,
            patch.object(engine, "_load_model") as load_model,
        ):
            with self.assertRaisesRegex(AsrError, "whisper_inference_session"):
                engine.transcribe("source.wav", language="ja")

        set_random_seed.assert_not_called()
        load_model.assert_not_called()

    def test_public_short_preload_reloads_for_qualifying_long_transcribe(self):
        engine = FasterWhisperEngine(model="large-v2", device="cpu")
        short_model = MagicMock()
        long_model = MagicMock()
        long_model.transcribe.return_value = (
            iter([_segment("長音声", 1.0, 2.0, [_word("長音声", 1.0, 2.0)])]),
            SimpleNamespace(duration=1.0, language="ja"),
        )
        short_class = MagicMock(return_value=short_model)
        long_class = MagicMock(return_value=long_model)
        audio = np.arange(12, dtype=np.float32)
        compressed = np.arange(8, dtype=np.float32)
        speech_chunks = [{"start": 0, "end": 8}]

        with patch("faster_whisper.WhisperModel", short_class):
            engine.load()
            engine.load()
        self.assertIs(engine._model, short_model)

        with (
            patch(
                "engines.faster_whisper_model.FasterWhisper121Model",
                long_class,
            ),
            patch(
                "engines.faster_whisper._duration_ms",
                return_value=600_000,
            ),
            patch(
                "engines.silero_v4.is_silero_v4_ready",
                return_value=True,
            ),
            patch("ctranslate2.set_random_seed"),
            patch("faster_whisper.audio.decode_audio", return_value=audio),
            patch(
                "engines.silero_v4.get_speech_timestamps_v4",
                return_value=speech_chunks,
            ),
            patch(
                "faster_whisper.vad.collect_chunks",
                return_value=([compressed], [MagicMock()]),
            ),
            patch(
                "faster_whisper.transcribe.restore_speech_timestamps",
                side_effect=lambda segments, _chunks, _rate: segments,
            ),
        ):
            with whisper_inference_session("faster-whisper"):
                transcription = engine.transcribe("source.wav", language="ja")
                output = list(transcription.segments)

        short_class.assert_called_once()
        long_class.assert_called_once()
        self.assertIs(engine._model, long_model)
        self.assertTrue(engine._loaded_long_mode)
        self.assertEqual(_items(output), [(1_000, 2_000, "長音声")])

    def test_long_path_runs_one_v4_compression_decode_and_restoration(self):
        engine = FasterWhisperEngine(model="large-v2")
        model = MagicMock()
        raw_segment = _segment("長音声", 1.0, 2.0, [_word("長音声", 1.0, 2.0)])
        model.transcribe.return_value = (
            iter([raw_segment]),
            SimpleNamespace(duration=1.0, language="ja"),
        )
        engine._model = model
        engine._loaded_long_mode = True
        audio = np.arange(12, dtype=np.float32)
        compressed = np.arange(8, dtype=np.float32)
        speech_chunks = [{"start": 0, "end": 8}]

        with (
            patch(
                "engines.silero_v4.is_silero_v4_ready",
                return_value=True,
            ),
            patch("ctranslate2.set_random_seed"),
            patch("faster_whisper.audio.decode_audio", return_value=audio) as decode,
            patch(
                "engines.silero_v4.get_speech_timestamps_v4",
                return_value=speech_chunks,
            ) as vad,
            patch(
                "faster_whisper.vad.collect_chunks",
                return_value=([compressed], [MagicMock()]),
            ) as collect,
            patch(
                "faster_whisper.transcribe.restore_speech_timestamps",
                side_effect=lambda segments, _chunks, _rate: segments,
            ) as restore,
        ):
            with whisper_inference_session("faster-whisper"):
                transcription = engine._transcribe_long(
                    "source.wav",
                    language="ja",
                    duration_ms=600_000,
                )
                output = list(transcription.segments)

        decode.assert_called_once_with("source.wav", sampling_rate=16_000)
        vad.assert_called_once()
        collect.assert_called_once_with(audio, speech_chunks, sampling_rate=16_000)
        model.transcribe.assert_called_once()
        call_audio = model.transcribe.call_args.args[0]
        self.assertTrue(np.array_equal(call_audio, compressed))
        self.assertEqual(
            model.transcribe.call_args.kwargs,
            {
                "language": "ja",
                "vad_filter": False,
                "beam_size": 5,
                "condition_on_previous_text": True,
                "word_timestamps": True,
            },
        )
        restore.assert_called_once()
        self.assertEqual(transcription.duration_ms, 600_000)
        self.assertEqual(_items(output), [(1_000, 2_000, "長音声")])

    def test_missing_or_corrupt_v4_fails_before_model_load(self):
        engine = FasterWhisperEngine(model="large-v2")
        with (
            patch(
                "engines.silero_v4.is_silero_v4_ready",
                return_value=False,
            ),
            patch.object(engine, "_load_model") as load,
        ):
            with self.assertRaisesRegex(AsrError, "Silero VAD v4.0"):
                engine._transcribe_long(
                    "source.wav",
                    language="ja",
                    duration_ms=600_000,
                )
        load.assert_not_called()

    def test_long_v4_defaults_and_session_overrides(self):
        default = FasterWhisperEngine(model="large-v2")._long_vad_options()
        custom = FasterWhisperEngine(
            model="large-v2",
            use_vad=True,
            vad_config={
                "threshold": 0.6,
                "min_speech_duration_ms": 1_000,
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 250,
                "max_segment_duration_ms": 30_000,
            },
        )._long_vad_options()

        self.assertEqual(
            (
                default.threshold,
                default.min_speech_duration_ms,
                default.min_silence_duration_ms,
                default.speech_pad_ms,
                default.max_speech_duration_s,
            ),
            (0.45, 250, 3_000, 900, float("inf")),
        )
        self.assertEqual(
            (
                custom.threshold,
                custom.min_speech_duration_ms,
                custom.min_silence_duration_ms,
                custom.speech_pad_ms,
                custom.max_speech_duration_s,
            ),
            (0.6, 1_000, 500, 250, 30.0),
        )


class HardWordHoleAndBoundsTests(unittest.TestCase):
    def _run(self, segments, *, duration_ms=120_000):
        return list(
            faster_whisper_module._iter_bounded_long_segments(
                iter(segments),
                duration_ms=duration_ms,
            )
        )

    def test_no_hard_hole_preserves_text_and_semantic_group(self):
        output = self._run(
            [
                _segment(
                    " 前文 後文 ",
                    0.0,
                    20.0,
                    [_word("前文", 1.0, 4.0), _word(" 後文", 8.0, 12.0)],
                )
            ]
        )
        self.assertEqual(_items(output), [(0, 20_000, "前文 後文")])

    def test_internal_threshold_is_inclusive_at_30_seconds(self):
        cases = (
            (31.999, [(0, 35_000, "前後")]),
            (32.0, [(0, 2_000, "前"), (32_000, 35_000, "後")]),
        )
        for second_start, expected in cases:
            with self.subTest(second_start=second_start):
                output = self._run(
                    [
                        _segment(
                            "前後",
                            0.0,
                            35.0,
                            [
                                _word("前", 1.0, 2.0),
                                _word("後", second_start, 34.0),
                            ],
                        )
                    ]
                )
                self.assertEqual(_items(output), expected)

    def test_hard_hole_replacement_preserves_nfkc_normalized_text(self):
        output = self._run(
            [
                _segment(
                    " Ａ B ",
                    0.0,
                    35.0,
                    [_word("A", 0.0, 1.0), _word("B", 31.0, 35.0)],
                )
            ]
        )
        self.assertEqual([item.text for item in output], ["A", "B"])

    def test_malformed_or_mismatched_words_fall_back_atomically(self):
        cases = (
            None,
            [_word("前", float("nan"), 1.0), _word("後", 31.0, 32.0)],
            [_word("前", 2.0, 3.0), _word("後", 1.0, 40.0)],
            [_word("別", 0.0, 1.0), _word("文", 31.0, 32.0)],
        )
        for words in cases:
            with self.subTest(words=words):
                output = self._run([_segment("前後", 0.0, 40.0, words)])
                self.assertEqual(_items(output), [(0, 40_000, "前後")])

    def test_every_parent_is_clamped_to_source_previous_and_next(self):
        output = self._run(
            [
                _segment("前段", -1.0, 40.0),
                _segment("中段", 39.0, 101.0),
                _segment("後段", 100.0, 130.0),
            ],
            duration_ms=120_000,
        )

        self.assertEqual(
            _items(output),
            [
                (0, 39_000, "前段"),
                (39_000, 100_000, "中段"),
                (100_000, 120_000, "後段"),
            ],
        )

    def test_next_raw_start_before_current_start_uses_available_interval(self):
        output = self._run(
            [
                _segment("前段", 2_800.0, 2_813.210),
                _segment("乱序段", 2_820.230, 2_825.670),
                _segment("後段", 2_819.690, 2_830.0),
            ],
            duration_ms=4_144_256,
        )

        self.assertEqual(
            _items(output),
            [
                (2_800_000, 2_813_210, "前段"),
                (2_813_210, 2_819_690, "乱序段"),
                (2_819_690, 2_830_000, "後段"),
            ],
        )

    def test_impossible_positive_nonoverlap_fails_instead_of_dropping_text(self):
        with self.assertRaisesRegex(AsrError, "有效时间范围"):
            self._run(
                [
                    _segment("前段", 0.0, 10.0),
                    _segment("无空间", 5.0, 5.0),
                    _segment("後段", 5.0, 8.0),
                ],
                duration_ms=10_000,
            )


class StreamingTests(unittest.TestCase):
    def test_iteration_uses_at_most_one_raw_segment_lookahead(self):
        consumed = []

        def source():
            for segment in (
                _segment("一", 0.0, 1.0),
                _segment("二", 1.0, 2.0),
                _segment("三", 2.0, 3.0),
            ):
                consumed.append(segment.text)
                yield segment

        output = faster_whisper_module._iter_bounded_long_segments(
            source(),
            duration_ms=3_000,
        )
        first = next(output)

        self.assertEqual(first.text, "一")
        self.assertEqual(consumed, ["一", "二"])
        self.assertEqual([item.text for item in output], ["二", "三"])

    def test_cancellation_before_first_item_does_not_consume_segments(self):
        consumed = []

        def source():
            consumed.append(True)
            yield _segment("一", 0.0, 1.0)

        output = list(
            faster_whisper_module._iter_bounded_long_segments(
                source(),
                duration_ms=1_000,
                cancel_check=lambda: True,
            )
        )
        self.assertEqual(output, [])
        self.assertEqual(consumed, [])


class KotobaIsolationTests(unittest.TestCase):
    def test_kotoba_keeps_upstream_model_options_and_no_long_transform(self):
        engine = KotobaFasterWhisperEngine(model=MODEL_ID)
        model = MagicMock()
        model.transcribe.return_value = (
            iter([_segment("通常", 1.0, 2.0)]),
            SimpleNamespace(duration=3.0, language="ja"),
        )
        engine._model = model

        with (
            patch("engines.faster_whisper._duration_ms") as duration,
            patch("ctranslate2.set_random_seed") as set_random_seed,
            patch.object(
                faster_whisper_module,
                "_iter_bounded_long_segments",
                create=True,
            ) as bounds,
        ):
            output = list(engine.transcribe("dummy.wav", language="ja").segments)

        duration.assert_not_called()
        set_random_seed.assert_not_called()
        bounds.assert_not_called()
        self.assertEqual(_items(output), [(1_000, 2_000, "通常")])
        kwargs = model.transcribe.call_args.kwargs
        self.assertTrue(kwargs["vad_filter"])
        self.assertFalse(kwargs["condition_on_previous_text"])
        self.assertEqual(kwargs["chunk_length"], 15)
        self.assertNotIn("word_timestamps", kwargs)


if __name__ == "__main__":
    unittest.main()
