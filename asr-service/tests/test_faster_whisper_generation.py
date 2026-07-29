"""Parity and prompt-state tests for the project-owned generation loop."""

from __future__ import annotations

import inspect
import logging
import sys
import unittest
from pathlib import Path
from types import MethodType, ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch

try:
    import numpy as np
    from faster_whisper.transcribe import TranscriptionOptions, WhisperModel
except ModuleNotFoundError as exc:
    raise unittest.SkipTest("requires faster-whisper runtime dependencies") from exc

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engines.base import AsrError
from engines.faster_whisper import FasterWhisperEngine
from engines.faster_whisper_model import (
    FasterWhisper121Model,
    _JAPANESE_BLEND_PROMPT,
    validate_faster_whisper_compatibility,
)
from engines.kotoba_faster_whisper import (
    MODEL_ID,
    KotobaFasterWhisperEngine,
)


class _Tokenizer:
    sot_prev = 800
    sot_sequence = [801, 802]
    no_timestamps = 803
    timestamp_begin = 1_000
    eot = 900

    _encoded = {
        "！": [11],
        "？": [12],
        "、": [13],
        "。": [14],
        " " + _JAPANESE_BLEND_PROMPT: [15, 16],
    }
    _decoded = {
        101: "abcdef",
        102: "終わり。",
        103: "次",
        104: "甲",
        105: "乙",
        106: "。",
        107: "abc",
        108: "def",
    }
    _decoded_sequences = {
        (107, 108): "終わり。",
    }

    def __init__(self, language_code: str = "ja") -> None:
        self.language_code = language_code
        self.language = 1
        self.tokenizer = SimpleNamespace(
            token_to_id=lambda token: {"<|ja|>": 1, "<|en|>": 2}[token]
        )
        self.encode_calls: list[str] = []

    def encode(self, text: str) -> list[int]:
        self.encode_calls.append(text)
        return list(self._encoded.get(text, [700]))

    def decode(self, tokens: list[int]) -> str:
        sequence = tuple(tokens)
        if sequence in self._decoded_sequences:
            return self._decoded_sequences[sequence]
        return "".join(self._decoded.get(token, "") for token in tokens)


def _options(**overrides) -> TranscriptionOptions:
    values = {
        "beam_size": 5,
        "best_of": 5,
        "patience": 1.0,
        "length_penalty": 1.0,
        "repetition_penalty": 1.0,
        "no_repeat_ngram_size": 0,
        "log_prob_threshold": -1.0,
        "no_speech_threshold": None,
        "compression_ratio_threshold": 2.4,
        "condition_on_previous_text": True,
        "prompt_reset_on_temperature": 0.5,
        "temperatures": [0.0],
        "initial_prompt": None,
        "prefix": None,
        "suppress_blank": True,
        "suppress_tokens": [-1],
        "without_timestamps": False,
        "max_initial_timestamp": 1.0,
        "word_timestamps": False,
        "prepend_punctuations": "",
        "append_punctuations": "",
        "multilingual": False,
        "max_new_tokens": None,
        "clip_timestamps": [0.0],
        "hallucination_silence_threshold": None,
        "hotwords": None,
    }
    values.update(overrides)
    return TranscriptionOptions(**values)


def _run_loop(
    model_class,
    window_tokens: list[list[int]],
    *,
    extension_enabled: bool,
    language: str = "ja",
    window_languages: list[str] | None = None,
    temperatures: list[float] | None = None,
    no_speech_probabilities: list[float] | None = None,
    word_timestamp_ends: list[float] | None = None,
    grouped_window_tokens: list[list[list[int]]] | None = None,
    zero_duration_groups: set[tuple[int, int]] | None = None,
    word_timestamp_seek_refinement_enabled: bool = False,
    options: TranscriptionOptions | None = None,
    max_length: int = 12,
    content_frames: int | None = None,
):
    model = model_class.__new__(model_class)
    model._japanese_prompt_extension_enabled = extension_enabled
    model._word_timestamp_seek_refinement_enabled = (
        word_timestamp_seek_refinement_enabled
    )
    model.feature_extractor = SimpleNamespace(
        time_per_frame=0.01,
        nb_max_frames=4,
    )
    model.frames_per_second = 100
    model.max_length = max_length
    model.logger = logging.getLogger("faster-whisper-generation-test")

    prompts: list[list[int]] = []
    seek_calls: list[tuple[int, int, list[int]]] = []
    encode_calls: list[tuple[int, ...]] = []
    language_calls: list[str] = []
    word_timestamp_calls: list[tuple[int, str, str, float]] = []
    temperatures = temperatures or [0.0] * len(window_tokens)
    no_speech_probabilities = no_speech_probabilities or [
        0.0
    ] * len(window_tokens)

    def detect_language(_encoder_output):
        detected = (window_languages or [])[len(language_calls)]
        language_calls.append(detected)
        return [[(f"<|{detected}|>", 0.9)]]

    model.model = SimpleNamespace(detect_language=detect_language)

    def encode(_self, segment):
        encode_calls.append(segment.shape)
        return len(encode_calls)

    def generate(_self, encoder_output, prompt, tokenizer, generation_options):
        index = len(prompts)
        prompts.append(list(prompt))
        result = SimpleNamespace(
            sequences_ids=[list(window_tokens[index])],
            no_speech_prob=no_speech_probabilities[index],
        )
        return result, -2.0, temperatures[index], 1.0

    def split(
        _self,
        tokenizer,
        tokens,
        time_offset,
        segment_size,
        segment_duration,
        seek,
    ):
        window_index = len(seek_calls)
        seek_calls.append((seek, segment_size, list(tokens)))
        groups = (
            grouped_window_tokens[window_index]
            if grouped_window_tokens is not None
            else [tokens]
        )
        current_segments = []
        for group_index, group_tokens in enumerate(groups):
            group_start = time_offset + (
                segment_duration * group_index / len(groups)
            )
            group_end = time_offset + (
                segment_duration * (group_index + 1) / len(groups)
            )
            if (window_index, group_index) in (zero_duration_groups or set()):
                group_end = group_start
            current_segments.append(
                {
                    "seek": seek,
                    "start": group_start,
                    "end": group_end,
                    "tokens": list(group_tokens),
                }
            )
        return current_segments, seek + segment_size, False

    def add_word_timestamps(
        _self,
        segments,
        tokenizer,
        encoder_output,
        num_frames,
        prepend_punctuations,
        append_punctuations,
        last_speech_timestamp,
    ):
        index = len(word_timestamp_calls)
        word_timestamp_calls.append(
            (
                num_frames,
                prepend_punctuations,
                append_punctuations,
                last_speech_timestamp,
            )
        )
        for segment in segments[0]:
            word_end = (
                word_timestamp_ends[index]
                if word_timestamp_ends is not None
                else segment["end"]
            )
            segment["words"] = [
                {
                    "word": tokenizer.decode(segment["tokens"]),
                    "start": segment["start"],
                    "end": word_end,
                    "probability": 0.9,
                }
            ]

    model.encode = MethodType(encode, model)
    model.generate_with_fallback = MethodType(generate, model)
    model._split_segments_by_timestamps = MethodType(split, model)
    model.add_word_timestamps = MethodType(add_word_timestamps, model)

    tokenizer = _Tokenizer(language)
    content_frames = content_frames or len(window_tokens) * 4
    features = np.zeros((2, content_frames + 1), dtype=np.float32)
    segments = list(
        model.generate_segments(
            features,
            tokenizer,
            options or _options(),
            False,
        )
    )
    return SimpleNamespace(
        segments=segments,
        prompts=prompts,
        seek_calls=seek_calls,
        encode_calls=encode_calls,
        language_calls=language_calls,
        word_timestamp_calls=word_timestamp_calls,
        tokenizer=tokenizer,
    )


class UpstreamParityTests(unittest.TestCase):
    def test_disabled_extension_matches_upstream_loop(self):
        fixture = {
            "extension_enabled": False,
            "temperatures": [0.0, 0.8],
            "word_timestamp_seek_refinement_enabled": True,
            "options": _options(initial_prompt=[701]),
        }
        upstream = _run_loop(WhisperModel, [[104, 106], [105]], **fixture)
        fork = _run_loop(
            FasterWhisper121Model,
            [[104, 106], [105]],
            **fixture,
        )

        self.assertEqual(fork.segments, upstream.segments)
        self.assertEqual(fork.prompts, upstream.prompts)
        self.assertEqual(fork.seek_calls, upstream.seek_calls)
        self.assertEqual(fork.encode_calls, upstream.encode_calls)

    def test_disabled_extension_matches_word_timestamp_seek_refinement(self):
        options = _options(
            word_timestamps=True,
            prepend_punctuations="(",
            append_punctuations=".",
        )
        fixture = {
            "extension_enabled": False,
            "options": options,
            "word_timestamp_ends": [0.03, 0.07],
            "word_timestamp_seek_refinement_enabled": True,
            "content_frames": 7,
        }
        upstream = _run_loop(WhisperModel, [[104], [105]], **fixture)
        fork = _run_loop(FasterWhisper121Model, [[104], [105]], **fixture)

        self.assertEqual(fork.segments, upstream.segments)
        self.assertEqual(fork.prompts, upstream.prompts)
        self.assertEqual(fork.seek_calls, upstream.seek_calls)
        self.assertEqual(fork.encode_calls, upstream.encode_calls)
        self.assertEqual(
            fork.word_timestamp_calls,
            upstream.word_timestamp_calls,
        )
        self.assertEqual(len(upstream.word_timestamp_calls), 2)
        self.assertNotEqual(
            upstream.seek_calls[1][0],
            upstream.seek_calls[0][0] + upstream.seek_calls[0][1],
        )

    def test_enabled_extension_bypasses_non_japanese_tokenizer(self):
        upstream = _run_loop(
            WhisperModel,
            [[101], [103]],
            extension_enabled=False,
            language="en",
        )
        fork = _run_loop(
            FasterWhisper121Model,
            [[101], [103]],
            extension_enabled=True,
            language="en",
        )

        self.assertEqual(fork.segments, upstream.segments)
        self.assertEqual(fork.prompts, upstream.prompts)
        self.assertEqual(fork.seek_calls, upstream.seek_calls)
        self.assertEqual(fork.tokenizer.encode_calls, [])


class WordTimestampSeekTests(unittest.TestCase):
    def test_production_default_keeps_words_without_seek_refinement(self):
        default = inspect.signature(FasterWhisper121Model.__init__).parameters[
            "word_timestamp_seek_refinement_enabled"
        ].default
        run = _run_loop(
            FasterWhisper121Model,
            [[104], [105]],
            extension_enabled=True,
            options=_options(word_timestamps=True),
            word_timestamp_ends=[0.03, 0.07],
            content_frames=7,
            max_length=16,
        )

        self.assertFalse(default)
        self.assertEqual(len(run.word_timestamp_calls), 2)
        self.assertTrue(all(segment.words for segment in run.segments))
        self.assertEqual(run.seek_calls[1][0], 4)
        self.assertEqual(run.word_timestamp_calls[1][-1], 0.03)


class JapanesePromptStateTests(unittest.TestCase):
    seed = [11, 12, 13, 14, 15, 16]

    def test_seed_is_tokenized_independently_carried_and_budgeted(self):
        run = _run_loop(
            FasterWhisper121Model,
            [[104, 105, 106], [103]],
            extension_enabled=True,
            max_length=16,
        )

        self.assertEqual(
            run.tokenizer.encode_calls,
            ["！", "？", "、", "。", " " + _JAPANESE_BLEND_PROMPT],
        )
        self.assertEqual(run.prompts[0], [800, *self.seed, 801, 802])
        self.assertEqual(run.prompts[1], [800, *self.seed, 106, 801, 802])
        self.assertLessEqual(len(run.prompts[1][1:-2]), 16 // 2 - 1)

    def test_no_end_window_resets_only_future_history(self):
        run = _run_loop(
            FasterWhisper121Model,
            [[101], [102], [103]],
            extension_enabled=True,
            max_length=20,
        )

        self.assertEqual(
            [segment.text for segment in run.segments],
            ["abcdef", "終わり。", "次"],
        )
        self.assertEqual(run.prompts[1], [800, *self.seed, 801, 802])
        self.assertEqual(run.prompts[2], [800, *self.seed, 102, 801, 802])

    def test_no_end_uses_grouped_text_before_skips_when_raw_disagrees(self):
        run = _run_loop(
            FasterWhisper121Model,
            [[107, 108], [103]],
            extension_enabled=True,
            grouped_window_tokens=[[[107], [108]], [[103]]],
            zero_duration_groups={(0, 1)},
            max_length=20,
        )

        self.assertEqual(
            [segment.text for segment in run.segments],
            ["abc", "次"],
        )
        self.assertEqual(run.tokenizer.decode([107, 108]), "終わり。")
        self.assertEqual(
            run.tokenizer.decode([107]) + run.tokenizer.decode([108]),
            "abcdef",
        )
        self.assertEqual(run.prompts[1], [800, *self.seed, 801, 802])

    def test_sentence_punctuation_keeps_accumulated_history(self):
        run = _run_loop(
            FasterWhisper121Model,
            [[104, 105, 106], [103]],
            extension_enabled=True,
            max_length=20,
        )

        self.assertEqual(
            run.prompts[1],
            [800, *self.seed, 104, 105, 106, 801, 802],
        )

    def test_temperature_reset_uses_the_same_history_boundary(self):
        run = _run_loop(
            FasterWhisper121Model,
            [[104, 105, 106], [103]],
            extension_enabled=True,
            temperatures=[0.8, 0.0],
            max_length=20,
        )

        self.assertEqual(run.prompts[1], [800, *self.seed, 801, 802])

    def test_empty_window_does_not_reset_history(self):
        run = _run_loop(
            FasterWhisper121Model,
            [[104, 105, 106], [], [103]],
            extension_enabled=True,
            max_length=20,
        )

        self.assertEqual(
            run.prompts[2],
            [800, *self.seed, 104, 105, 106, 801, 802],
        )

    def test_skipped_silence_does_not_reset_history(self):
        run = _run_loop(
            FasterWhisper121Model,
            [[104, 105, 106], [101], [103]],
            extension_enabled=True,
            no_speech_probabilities=[0.0, 0.9, 0.0],
            options=_options(no_speech_threshold=0.5),
            max_length=20,
        )

        self.assertEqual(
            run.prompts[2],
            [800, *self.seed, 104, 105, 106, 801, 802],
        )

    def test_multilingual_japanese_to_english_deactivates_seed(self):
        run = _run_loop(
            FasterWhisper121Model,
            [[104, 105, 106], [103]],
            extension_enabled=True,
            language="ja",
            window_languages=["ja", "en"],
            options=_options(multilingual=True),
            max_length=20,
        )

        self.assertEqual(run.language_calls, ["ja", "en"])
        self.assertEqual(run.prompts[0], [800, *self.seed, 801, 802])
        self.assertEqual(
            run.prompts[1],
            [800, 104, 105, 106, 801, 802],
        )

    def test_multilingual_english_to_japanese_activates_seed(self):
        run = _run_loop(
            FasterWhisper121Model,
            [[104, 105], [103]],
            extension_enabled=True,
            language="en",
            window_languages=["en", "ja"],
            options=_options(multilingual=True),
            max_length=20,
        )

        self.assertEqual(run.language_calls, ["en", "ja"])
        self.assertEqual(run.prompts[0], [801, 802])
        self.assertEqual(
            run.prompts[1],
            [800, *self.seed, 104, 105, 801, 802],
        )
        self.assertEqual(
            run.tokenizer.encode_calls,
            ["！", "？", "、", "。", " " + _JAPANESE_BLEND_PROMPT],
        )


class CompatibilityAndIsolationTests(unittest.TestCase):
    def _transcribe_short_with_fake_model(
        self,
        *,
        model: str = "large-v2",
        device: str = "cuda",
        compute_type=None,
        language: str = "ja",
        engine_class=FasterWhisperEngine,
    ):
        model_instance = SimpleNamespace(
            model=SimpleNamespace(device=device),
            transcribe=MagicMock(
                return_value=(
                    iter(()),
                    SimpleNamespace(duration=1.0, language=language),
                )
            ),
        )
        model_class = MagicMock(return_value=model_instance)
        module = ModuleType("faster_whisper")
        module.__version__ = "1.2.1"
        module.WhisperModel = model_class
        engine = engine_class(
            model=model,
            device=device,
            compute_type=compute_type,
        )

        with (
            patch.dict(sys.modules, {"faster_whisper": module}),
            patch("engines.faster_whisper._duration_ms", return_value=599_999),
            patch.object(engine, "_warmup"),
        ):
            transcription = engine.transcribe("short.wav", language=language)

        return engine, model_class, model_instance, transcription

    def test_default_short_japanese_large_v2_cuda_uses_int8_float16(self):
        for compute_type in (None, "auto", "default"):
            with self.subTest(compute_type=compute_type):
                _engine, model_class, _model, _transcription = (
                    self._transcribe_short_with_fake_model(
                        compute_type=compute_type,
                    )
                )
                model_class.assert_called_once_with(
                    "large-v2",
                    device="cuda",
                    compute_type="int8_float16",
                )

    def test_target_short_explicit_compute_override_is_honored(self):
        _engine, model_class, _model, _transcription = (
            self._transcribe_short_with_fake_model(compute_type="float32")
        )

        model_class.assert_called_once_with(
            "large-v2",
            device="cuda",
            compute_type="float32",
        )

    def test_target_short_cpu_keeps_int8(self):
        _engine, model_class, _model, _transcription = (
            self._transcribe_short_with_fake_model(device="cpu")
        )

        model_class.assert_called_once_with(
            "large-v2",
            device="cpu",
            compute_type="int8",
        )

    def test_short_compute_baseline_does_not_widen_to_other_scope(self):
        cases = (
            {"model": "large-v2", "language": "en"},
            {"model": "base", "language": "ja"},
        )
        for values in cases:
            with self.subTest(**values):
                _engine, model_class, _model, _transcription = (
                    self._transcribe_short_with_fake_model(**values)
                )
                model_class.assert_called_once_with(
                    values["model"],
                    device="cuda",
                    compute_type="float16",
                )

    def test_kotoba_default_cuda_compute_remains_float16(self):
        _engine, model_class, _model, _transcription = (
            self._transcribe_short_with_fake_model(
                model=MODEL_ID,
                engine_class=KotobaFasterWhisperEngine,
            )
        )

        model_class.assert_called_once_with(
            MODEL_ID,
            device="cuda",
            compute_type="float16",
        )

    def test_public_load_reloads_target_short_compute_only_once(self):
        preload_model = SimpleNamespace(
            model=SimpleNamespace(device="cuda"),
            transcribe=MagicMock(
                return_value=(
                    iter(()),
                    SimpleNamespace(duration=1.0, language="ja"),
                )
            ),
        )
        target_model = SimpleNamespace(
            model=SimpleNamespace(device="cuda"),
            transcribe=MagicMock(
                return_value=(
                    iter(()),
                    SimpleNamespace(duration=1.0, language="ja"),
                )
            ),
        )
        module = ModuleType("faster_whisper")
        module.__version__ = "1.2.1"
        engine = FasterWhisperEngine(model="large-v2", device="auto")
        model_state_during_load = []

        def construct_model(*_args, **_kwargs):
            model_state_during_load.append(engine._model)
            return (preload_model, target_model)[len(model_state_during_load) - 1]

        module.WhisperModel = MagicMock(side_effect=construct_model)
        with (
            patch.dict(sys.modules, {"faster_whisper": module}),
            patch("engines.faster_whisper._duration_ms", return_value=599_999),
            patch.object(engine, "_warmup"),
        ):
            engine.load()
            first = engine.transcribe("short.wav", language="ja")
            second = engine.transcribe("short.wav", language="ja")

        self.assertEqual(
            [
                call.kwargs["compute_type"]
                for call in module.WhisperModel.call_args_list
            ],
            ["default", "int8_float16"],
        )
        self.assertEqual(model_state_during_load, [None, None])
        self.assertIs(engine._model, target_model)
        self.assertEqual(list(first.segments), [])
        self.assertEqual(list(second.segments), [])

    def test_compatibility_guard_rejects_version_and_internal_shape(self):
        with self.assertRaisesRegex(RuntimeError, "1.2.1"):
            validate_faster_whisper_compatibility("1.2.2", WhisperModel)

        class IncompleteModel:
            pass

        with self.assertRaisesRegex(RuntimeError, "generate_segments"):
            validate_faster_whisper_compatibility("1.2.1", IncompleteModel)

    def test_only_long_load_reports_compatibility_failure_as_asr_error(self):
        module = ModuleType("faster_whisper")
        module.__version__ = "1.2.2"
        module.WhisperModel = WhisperModel
        engine = FasterWhisperEngine(model="large-v2", device="cpu")

        with patch.dict(sys.modules, {"faster_whisper": module}):
            with self.assertRaisesRegex(AsrError, "faster-whisper 1.2.1"):
                engine._load_model(long_mode=True)

    def test_short_and_long_load_construct_only_the_selected_model_class(self):
        module = ModuleType("faster_whisper")
        module.__version__ = "1.2.1"
        upstream_instance = MagicMock()
        upstream_class = MagicMock(return_value=upstream_instance)
        module.WhisperModel = upstream_class
        short = FasterWhisperEngine(model="large-v2", device="cpu")

        with patch.dict(sys.modules, {"faster_whisper": module}):
            short._load_model(long_mode=False)

        upstream_class.assert_called_once_with(
            "large-v2",
            device="cpu",
            compute_type="int8",
        )
        self.assertIs(short._model, upstream_instance)

        module.WhisperModel = WhisperModel
        long_instance = MagicMock()
        long = FasterWhisperEngine(model="large-v2", device="cuda")
        with (
            patch.dict(sys.modules, {"faster_whisper": module}),
            patch(
                "engines.faster_whisper_model.FasterWhisper121Model",
                return_value=long_instance,
            ) as fork_class,
            patch.object(long, "_warmup"),
        ):
            long._load_model(long_mode=True)

        fork_class.assert_called_once_with(
            "large-v2",
            device="cuda",
            compute_type="int8_float16",
        )
        self.assertIs(long._model, long_instance)
        self.assertIsNot(short._model, long._model)

    def test_long_cuda_load_skips_warmup_while_short_cuda_keeps_it(self):
        module = ModuleType("faster_whisper")
        module.__version__ = "1.2.1"
        module.WhisperModel = WhisperModel

        long_instance = SimpleNamespace(model=SimpleNamespace(device="cuda"))
        long = FasterWhisperEngine(model="large-v2", device="cuda")
        with (
            patch.dict(sys.modules, {"faster_whisper": module}),
            patch(
                "engines.faster_whisper_model.FasterWhisper121Model",
                return_value=long_instance,
            ),
            patch.object(long, "_warmup") as long_warmup,
        ):
            long._load_model(long_mode=True)
        long_warmup.assert_not_called()

        short_instance = SimpleNamespace(model=SimpleNamespace(device="cuda"))
        short_class = MagicMock(return_value=short_instance)
        module.WhisperModel = short_class
        short = FasterWhisperEngine(model="large-v2", device="cuda")
        with (
            patch.dict(sys.modules, {"faster_whisper": module}),
            patch.object(short, "_warmup") as short_warmup,
        ):
            short._load_model(long_mode=False)
        short_warmup.assert_called_once_with(short_instance)

    def test_short_auto_warmup_failure_releases_gpu_before_cpu_fallback(self):
        events = []

        class ObservedModel:
            def __init__(self, device):
                self.device_name = device
                actual_device = "cuda" if device == "auto" else device
                self.model = SimpleNamespace(device=actual_device)

            def __del__(self):
                events.append(("destroy", self.device_name))

        def model_class(_model, *, device, compute_type):
            events.append(("construct", device, compute_type))
            return ObservedModel(device)

        def warmup(model):
            events.append(("warmup", model.device_name))
            raise RuntimeError("warmup failed")

        module = ModuleType("faster_whisper")
        module.__version__ = "1.2.1"
        module.WhisperModel = model_class
        engine = FasterWhisperEngine(model="large-v2", device="auto")
        engine._warmup = warmup

        with patch.dict(sys.modules, {"faster_whisper": module}):
            engine._load_model(long_mode=False)

        self.assertEqual(
            events[:4],
            [
                ("construct", "auto", "default"),
                ("warmup", "auto"),
                ("destroy", "auto"),
                ("construct", "cpu", "int8"),
            ],
        )
        self.assertEqual(engine.device, "cpu")
        self.assertEqual(engine._model.device_name, "cpu")

    def test_long_auto_load_failure_falls_back_to_cpu_int8(self):
        module = ModuleType("faster_whisper")
        module.__version__ = "1.2.1"
        module.WhisperModel = WhisperModel
        cpu_instance = MagicMock()
        engine = FasterWhisperEngine(model="large-v2", device="auto")

        with (
            patch.dict(sys.modules, {"faster_whisper": module}),
            patch(
                "engines.faster_whisper_model.FasterWhisper121Model",
                side_effect=[RuntimeError("CUDA unavailable"), cpu_instance],
            ) as fork_class,
        ):
            engine._load_model(long_mode=True)

        self.assertEqual(
            fork_class.call_args_list[0].kwargs,
            {"device": "auto", "compute_type": "int8_float16"},
        )
        self.assertEqual(
            fork_class.call_args_list[1].kwargs,
            {"device": "cpu", "compute_type": "int8"},
        )
        self.assertIs(engine._model, cpu_instance)
        self.assertEqual(engine.device, "cpu")


if __name__ == "__main__":
    unittest.main()
