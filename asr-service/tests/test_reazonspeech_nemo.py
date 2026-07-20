import sys
import tempfile
import unittest
import wave
from array import array
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engines.base import AsrError, AsrSegment
from engines.reazonspeech_nemo import (
    MODEL_FILE,
    MODEL_ID,
    ReazonSpeechNemoEngine,
    decode_hypothesis_to_segments,
    find_end_of_segment,
    _read_pcm16_mono_wav,
    _Subword,
)


def _write_silence_wav(path: Path, duration_ms: int = 1000) -> None:
    rate = 16000
    frames = int(rate * duration_ms / 1000)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b"\0\0" * frames)


class _FakeTokenizer:
    spm_separator_id = 0

    def ids_to_text(self, ids):
        mapping = {
            0: " ",
            1: "こん",
            2: "にち",
            3: "は",
            4: "。",
            5: "次",
            6: "です",
            7: "、",
            8: "ね",
        }
        return "".join(mapping.get(int(i), f"<{i}>") for i in ids)


class _FakeHyp:
    def __init__(self, y_sequence, timestamp):
        self.y_sequence = y_sequence
        self.timestamp = timestamp


class _ListTensor(list):
    def tolist(self):
        return list(self)


class ReazonSpeechDecodeTests(unittest.TestCase):
    def test_find_end_of_segment_breaks_on_eos(self):
        subwords = [
            _Subword("あ", 0.0),
            _Subword("。", 0.2),
            _Subword("い", 0.4),
        ]
        self.assertEqual(find_end_of_segment(subwords, 0), 1)

    def test_decode_strips_leading_sp_and_builds_segments(self):
        hyp = _FakeHyp(
            y_sequence=_ListTensor([0, 1, 2, 3, 4, 5, 6]),
            timestamp=_ListTensor([1, 2, 3, 4, 5, 8, 9]),
        )
        segments = decode_hypothesis_to_segments(
            _FakeTokenizer(),
            hyp,
            duration_ms=10_000,
        )
        self.assertGreaterEqual(len(segments), 1)
        self.assertTrue(all(seg.end_ms > seg.start_ms for seg in segments))
        self.assertTrue(all(seg.text.strip() for seg in segments))
        self.assertIn("こんにちは", "".join(seg.text for seg in segments))

    def test_mismatched_timestamp_raises(self):
        hyp = _FakeHyp(y_sequence=_ListTensor([1, 2]), timestamp=_ListTensor([1]))
        with self.assertRaises(AsrError):
            decode_hypothesis_to_segments(_FakeTokenizer(), hyp, duration_ms=1000)


class ReazonSpeechEngineTests(unittest.TestCase):
    def test_pcm_wav_uses_compact_array(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            _write_silence_wav(audio, 100)
            samples = _read_pcm16_mono_wav(str(audio))

        self.assertIsInstance(samples, array)
        self.assertEqual(len(samples), 1600)

    def test_empty_wav_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "empty.wav"
            _write_silence_wav(audio, 0)
            with self.assertRaisesRegex(AsrError, "音频为空"):
                _read_pcm16_mono_wav(str(audio))

    def test_rejects_unknown_model_id(self):
        with self.assertRaises(AsrError):
            ReazonSpeechNemoEngine(model="someone/else")

    def test_is_available_checks_specs_only(self):
        with patch("importlib.util.find_spec", side_effect=lambda name: object() if name in ("nemo", "torch") else None):
            self.assertTrue(ReazonSpeechNemoEngine.is_available())
        with patch("importlib.util.find_spec", return_value=None):
            self.assertFalse(ReazonSpeechNemoEngine.is_available())

    def test_is_model_downloaded_uses_marker_file(self):
        hub = MagicMock()
        hub.try_to_load_from_cache.return_value = "/cache/" + MODEL_FILE
        with patch.dict(sys.modules, {"huggingface_hub": hub}), patch(
            "os.path.exists", return_value=True
        ):
            self.assertTrue(ReazonSpeechNemoEngine.is_model_downloaded(MODEL_ID))

        hub.try_to_load_from_cache.return_value = None
        with patch.dict(sys.modules, {"huggingface_hub": hub}):
            self.assertFalse(ReazonSpeechNemoEngine.is_model_downloaded(MODEL_ID))
        self.assertFalse(ReazonSpeechNemoEngine.is_model_downloaded("bad/model"))

    def test_download_model_uses_snapshot_and_progress_adapter(self):
        progress = MagicMock()
        with patch(
            "engines.reazonspeech_nemo.snapshot_download_repo",
            return_value="/cache",
        ) as snapshot:
            ReazonSpeechNemoEngine.download_model(MODEL_ID, progress=progress)
            snapshot.assert_called_once()
            args, kwargs = snapshot.call_args
            self.assertEqual(args[0], MODEL_ID)
            self.assertIs(kwargs["progress"], progress)
            self.assertEqual(kwargs["allow_patterns"], [MODEL_FILE])

    def _patch_load_modules(self, torch_mod, models_mod):
        return patch.dict(
            sys.modules,
            {
                "torch": torch_mod,
                "nemo": MagicMock(),
                "nemo.collections": MagicMock(),
                "nemo.collections.asr": MagicMock(),
                "nemo.collections.asr.models": models_mod,
            },
        )

    def test_load_cuda_unavailable_raises(self):
        engine = ReazonSpeechNemoEngine(device="cuda")
        torch_mod = MagicMock()
        torch_mod.cuda.is_available.return_value = False
        models_mod = MagicMock()
        with self._patch_load_modules(torch_mod, models_mod), patch(
            "engines.reazonspeech_nemo.cuda_unavailable_reason",
            return_value="no cuda",
        ):
            with self.assertRaises(AsrError) as ctx:
                engine.load()
        self.assertIn("CUDA", str(ctx.exception))
        models_mod.EncDecRNNTBPEModel.from_pretrained.assert_not_called()

    def test_load_auto_selects_cpu_when_no_cuda(self):
        engine = ReazonSpeechNemoEngine(device="auto")
        fake_model = MagicMock()
        torch_mod = MagicMock()
        torch_mod.cuda.is_available.return_value = False

        models_mod = MagicMock()
        models_mod.EncDecRNNTBPEModel.from_pretrained.return_value = fake_model

        with self._patch_load_modules(torch_mod, models_mod):
            engine.load()
        self.assertEqual(engine.device, "cpu")
        models_mod.EncDecRNNTBPEModel.from_pretrained.assert_called_once_with(
            MODEL_ID,
            map_location="cpu",
        )
        fake_model.eval.assert_called_once()

    def test_load_explicit_cuda_when_available(self):
        engine = ReazonSpeechNemoEngine(device="cuda")
        fake_model = MagicMock()
        torch_mod = MagicMock()
        torch_mod.cuda.is_available.return_value = True
        models_mod = MagicMock()
        models_mod.EncDecRNNTBPEModel.from_pretrained.return_value = fake_model

        with self._patch_load_modules(torch_mod, models_mod):
            engine.load()
        self.assertEqual(engine.device, "cuda")
        models_mod.EncDecRNNTBPEModel.from_pretrained.assert_called_once_with(
            MODEL_ID,
            map_location="cuda",
        )
        fake_model.eval.assert_called_once()

    def test_transcribe_native_ignores_vad_and_supports_deferred_cancel(self):
        engine = ReazonSpeechNemoEngine(model=MODEL_ID, device="cpu", use_vad=True, vad_config={"threshold": 0.9})
        fake_model = MagicMock()
        fake_model.tokenizer = _FakeTokenizer()
        hyp = _FakeHyp(
            y_sequence=_ListTensor([1, 2, 3, 4]),
            timestamp=_ListTensor([2, 3, 4, 5]),
        )
        fake_model.transcribe.return_value = [hyp]
        engine._model = fake_model
        torch_mod = MagicMock()
        torch_mod.int16 = "int16"
        torch_mod.float32 = "float32"

        with patch.dict(sys.modules, {"torch": torch_mod}), tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            _write_silence_wav(audio, 1500)
            cancelled = {"value": False}

            def cancel_check():
                return cancelled["value"]

            # First call: cancel before NeMo runs
            cancelled["value"] = True
            transcription = engine.transcribe(str(audio), cancel_check=cancel_check)
            self.assertEqual(list(transcription.segments), [])
            self.assertEqual(transcription.language, "ja")

            cancelled["value"] = False
            transcription = engine.transcribe(str(audio), cancel_check=cancel_check)
            segs = list(transcription.segments)
            self.assertGreaterEqual(len(segs), 1)
            self.assertEqual(transcription.language, "ja")
            self.assertTrue(all(isinstance(s, AsrSegment) for s in segs))
            self.assertGreaterEqual(fake_model.transcribe.call_count, 1)
            kwargs = fake_model.transcribe.call_args.kwargs
            self.assertTrue(kwargs.get("return_hypotheses"))

    def test_transcribe_cancel_after_blocking_call_discards_results(self):
        engine = ReazonSpeechNemoEngine()
        fake_model = MagicMock()
        fake_model.tokenizer = _FakeTokenizer()
        hyp = _FakeHyp(
            y_sequence=_ListTensor([1, 2, 3, 4]),
            timestamp=_ListTensor([2, 3, 4, 5]),
        )
        state = {"cancelled": False}

        def fake_transcribe(*_args, **_kwargs):
            state["cancelled"] = True
            return [hyp]

        fake_model.transcribe.side_effect = fake_transcribe
        engine._model = fake_model
        torch_mod = MagicMock()
        torch_mod.int16 = "int16"
        torch_mod.float32 = "float32"

        with patch.dict(sys.modules, {"torch": torch_mod}), tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            _write_silence_wav(audio, 1200)
            transcription = engine.transcribe(
                str(audio),
                cancel_check=lambda: state["cancelled"],
            )
            self.assertEqual(list(transcription.segments), [])

    def test_bad_wav_contract_raises(self):
        engine = ReazonSpeechNemoEngine()
        engine._model = MagicMock()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.wav"
            with wave.open(str(path), "wb") as wav:
                wav.setnchannels(2)
                wav.setsampwidth(2)
                wav.setframerate(44100)
                wav.writeframes(b"\0\0\0\0" * 100)
            with self.assertRaises(AsrError):
                engine.transcribe(str(path))


class RegistryTests(unittest.TestCase):
    def test_registry_lists_reazonspeech(self):
        from engines.registry import list_engines

        names = {item["name"] for item in list_engines()}
        self.assertIn("reazonspeech-nemo", names)


if __name__ == "__main__":
    unittest.main()
