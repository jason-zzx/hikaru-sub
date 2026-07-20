import unittest
from unittest.mock import patch
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engines.qwen3_asr import Qwen3AsrEngine, ASR_MODEL_ID, ALIGNER_MODEL_ID, MODEL_ID, _extract_char_timestamps
from engines.base import AsrError


class IsAvailableTests(unittest.TestCase):
    def test_returns_true_when_qwen_asr_spec_found(self):
        with patch("importlib.util.find_spec") as mock_find:
            mock_find.return_value = object()  # 非 None 表示找到
            self.assertTrue(Qwen3AsrEngine.is_available())

    def test_returns_false_when_qwen_asr_spec_missing(self):
        with patch("importlib.util.find_spec") as mock_find:
            mock_find.return_value = None
            self.assertFalse(Qwen3AsrEngine.is_available())


class IsModelDownloadedTests(unittest.TestCase):
    def test_returns_false_when_hub_missing(self):
        with patch.dict("sys.modules", {"huggingface_hub": None}):
            # import 会失败 → except ImportError → False
            self.assertFalse(Qwen3AsrEngine.is_model_downloaded(MODEL_ID))

    def test_returns_true_only_when_both_repos_cached(self):
        with patch("huggingface_hub.try_to_load_from_cache") as mock_cache:
            def fake_cache(repo, filename):
                if repo in (MODEL_ID, ALIGNER_MODEL_ID) and filename == "config.json":
                    return f"/fake/cache/{repo}/config.json"
                return None
            mock_cache.side_effect = fake_cache
            with patch("os.path.exists", return_value=True):
                self.assertTrue(Qwen3AsrEngine.is_model_downloaded(MODEL_ID))

    def test_returns_false_when_only_asr_cached(self):
        with patch("huggingface_hub.try_to_load_from_cache") as mock_cache:
            def fake_cache(repo, filename):
                if repo == MODEL_ID and filename == "config.json":
                    return f"/fake/cache/{repo}/config.json"
                return None
            mock_cache.side_effect = fake_cache
            with patch("os.path.exists", return_value=True):
                self.assertFalse(Qwen3AsrEngine.is_model_downloaded(MODEL_ID))


class DownloadModelTests(unittest.TestCase):
    def test_downloads_both_repos_and_reports_progress(self):
        seen_repos = []
        def fake_snapshot(repo):
            seen_repos.append(repo)
            return f"/fake/{repo}"
        progress_calls = []
        def track(done, total):
            progress_calls.append((done, total))

        with patch(
            "engines.hf_download.snapshot_download_repo",
            side_effect=fake_snapshot,
        ):
            with patch("os.walk", return_value=[("/fake", [], ["f.bin"])]):
                with patch("os.path.getsize", return_value=100):
                    Qwen3AsrEngine.download_model(MODEL_ID, progress=track)

        self.assertEqual(seen_repos, [MODEL_ID, ALIGNER_MODEL_ID])
        # 至少有一次进度上报，末次 total>0
        self.assertTrue(len(progress_calls) >= 1)
        self.assertGreater(progress_calls[-1][1], 0)

    def test_raises_asr_error_on_download_failure(self):
        with patch(
            "engines.hf_download.snapshot_download_repo",
            side_effect=RuntimeError("network"),
        ):
            with self.assertRaises(AsrError):
                Qwen3AsrEngine.download_model(MODEL_ID)


class ExtractTimestampsTests(unittest.TestCase):
    def test_extracts_char_timestamps_from_result(self):
        # 模拟 qwen-asr transcribe 返回结构：results[0].time_stamps[0] 是字级列表
        fake_stamp = lambda text, s, e: type("Stamp", (), {"text": text, "start_time": s, "end_time": e})()
        fake_result = type("R", (), {
            "language": "Japanese",
            "text": "こんにちは",
            "time_stamps": [[
                fake_stamp("こ", 0.0, 0.1),
                fake_stamp("ん", 0.1, 0.2),
                fake_stamp("に", 0.2, 0.3),
                fake_stamp("ち", 0.3, 0.4),
                fake_stamp("は", 0.4, 0.5),
            ]],
        })()
        chars = _extract_char_timestamps(fake_result)
        self.assertEqual(len(chars), 5)
        self.assertEqual(chars[0]["char"], "こ")
        self.assertAlmostEqual(chars[0]["start"], 0.0)

    def test_extracts_char_timestamps_from_forced_align_result(self):
        # 真实 qwen-asr 形态：time_stamps 是 ForcedAlignResult 对象，含 .items 列表
        fake_item = lambda text, s, e: type("Item", (), {"text": text, "start_time": s, "end_time": e})()
        align_result = type("ForcedAlignResult", (), {"items": [
            fake_item("こ", 0.0, 0.1),
            fake_item("ん", 0.1, 0.2),
            fake_item("に", 0.2, 0.3),
            fake_item("ち", 0.3, 0.4),
            fake_item("は", 0.4, 0.5),
        ]})()
        fake_result = type("R", (), {
            "language": "Japanese",
            "text": "こんにちは",
            "time_stamps": align_result,
        })()
        chars = _extract_char_timestamps(fake_result)
        self.assertEqual(len(chars), 5)
        self.assertEqual(chars[0]["char"], "こ")
        self.assertAlmostEqual(chars[0]["start"], 0.0)
        self.assertAlmostEqual(chars[-1]["end"], 0.5)

    def test_returns_empty_when_no_time_stamps(self):
        fake_result = type("R", (), {"language": "Japanese", "text": "x", "time_stamps": None})()
        self.assertEqual(_extract_char_timestamps(fake_result), [])


class TranscribeAssembleTests(unittest.TestCase):
    def _make_engine_with_fake_model(self, fake_transcribe_result):
        engine = Qwen3AsrEngine(model=ASR_MODEL_ID, device="cpu")
        engine._model = type("M", (), {"transcribe": lambda self, audio, **kw: [fake_transcribe_result]})()
        return engine

    def test_short_audio_builds_segments_from_time_stamps(self):
        import tempfile, wave
        tmp = Path(tempfile.mkdtemp())
        wav_path = tmp / "a.wav"
        # 写 1s 静音 wav
        with wave.open(str(wav_path), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
            w.writeframes(b"\0\0" * 16000)

        fake_stamp = lambda text, s, e: type("S", (), {"text": text, "start_time": s, "end_time": e})()
        result = type("R", (), {
            "language": "Japanese",
            "text": "こんにちは",
            "time_stamps": [[
                fake_stamp("こ", 0.0, 0.1), fake_stamp("ん", 0.1, 0.2),
                fake_stamp("に", 0.2, 0.3), fake_stamp("ち", 0.3, 0.4),
                fake_stamp("は", 0.4, 0.5),
            ]],
        })()
        engine = self._make_engine_with_fake_model(result)
        # 不开 VAD：短音频走一次性整段路径，直接用 qwen-asr 返回的全局时间戳
        transcription = engine.transcribe(str(wav_path), language="ja")
        segments = list(transcription.segments)
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].text, "こんにちは")
        self.assertEqual(transcription.language, "ja")


class TranscribeChunkedTests(unittest.TestCase):
    def test_long_audio_chunks_with_offset_and_dedup(self):
        """不开 VAD 时，长音频按 45s 分块逐块调 qwen-asr，加 chunk_start 偏移并 overlap 去重。

        关键验证：每块返回的是块内相对时间，本引擎加 chunk_start_ms 得全局时间，
        不会像旧 bug 那样把时间轴翻倍；overlap 区重复文本被去重。
        """
        import tempfile, wave
        from unittest.mock import MagicMock
        tmp = Path(tempfile.mkdtemp())
        wav_path = tmp / "long.wav"
        # 写 70s 静音：plan_audio_chunks(70s, chunk=45s, overlap=2s) → 块1[0,45s] 块2[43s,70s]
        rate = 16000
        with wave.open(str(wav_path), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
            w.writeframes(b"\0\0" * (rate * 70))

        # 每块返回块内相对时间 0~0.3s 的 "テスト"（模拟两块 overlap 区都识别到同一段语音）
        def fake_transcribe(audio, **kw):
            stamp = lambda t, s, e: type("S", (), {"text": t, "start_time": s, "end_time": e})()
            return [type("R", (), {
                "language": "Japanese", "text": "テスト",
                "time_stamps": [[stamp("テ", 0.0, 0.1), stamp("ス", 0.1, 0.2), stamp("ト", 0.2, 0.3)]],
            })()]

        engine = Qwen3AsrEngine(model=ASR_MODEL_ID, device="cpu")
        engine._model = MagicMock()
        engine._model.transcribe.side_effect = fake_transcribe

        progresses: list[int] = []
        transcription = engine.transcribe(
            str(wav_path), language="ja", progress_callback=progresses.append,
        )
        segments = list(transcription.segments)
        # 70s 按 45s 分块应调用 2 次（块1 + 块2）
        self.assertEqual(engine._model.transcribe.call_count, 2)
        # 每块完成上报真实进度（块1 end=45000，块2 end=70000）
        self.assertEqual(progresses, [45_000, 70_000])
        # overlap 去重：两块都返回 "テスト"，但块2[43s,45s] 与块1[0,0.3s] 经偏移后
        # 块1→0~300ms、块2→43000~43300ms，位置不同不去重，故应有 2 段
        self.assertEqual(len(segments), 2)
        # 时间轴未被翻倍：块1 在 0~300ms，块2 在 43000~43300ms（加偏移后）
        self.assertAlmostEqual(segments[0].start_ms, 0.0, places=0)
        self.assertAlmostEqual(segments[0].end_ms, 300.0, places=0)
        self.assertAlmostEqual(segments[1].start_ms, 43_000.0, places=0)
        self.assertAlmostEqual(segments[1].end_ms, 43_300.0, places=0)
        self.assertTrue(all(s.text == "テスト" for s in segments))

    def test_short_audio_single_chunk_no_offset(self):
        """短音频（<45s）只分 1 块整段，无偏移，时间轴即 qwen-asr 返回值。"""
        import tempfile, wave
        from unittest.mock import MagicMock
        tmp = Path(tempfile.mkdtemp())
        wav_path = tmp / "short.wav"
        rate = 16000
        with wave.open(str(wav_path), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
            w.writeframes(b"\0\0" * (rate * 10))  # 10s

        def fake_transcribe(audio, **kw):
            stamp = lambda t, s, e: type("S", (), {"text": t, "start_time": s, "end_time": e})()
            return [type("R", (), {
                "language": "Japanese", "text": "テスト",
                "time_stamps": [[stamp("テ", 0.0, 0.1), stamp("ス", 0.1, 0.2), stamp("ト", 0.2, 0.3)]],
            })()]

        engine = Qwen3AsrEngine(model=ASR_MODEL_ID, device="cpu")
        engine._model = MagicMock()
        engine._model.transcribe.side_effect = fake_transcribe

        transcription = engine.transcribe(str(wav_path), language="ja")
        segments = list(transcription.segments)
        # 短音频单块，仅 1 次调用
        self.assertEqual(engine._model.transcribe.call_count, 1)
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].text, "テスト")
        # 无偏移，时间即 fake 返回的 0~0.3s
        self.assertAlmostEqual(segments[0].start_ms, 0.0, places=0)
        self.assertAlmostEqual(segments[0].end_ms, 300.0, places=0)


class TranscribeFallbackTests(unittest.TestCase):
    def test_vad_failure_falls_back_to_fixed_chunks(self):
        import tempfile, wave
        from unittest.mock import MagicMock, patch
        tmp = Path(tempfile.mkdtemp())
        wav_path = tmp / "vad.wav"
        rate = 16000
        with wave.open(str(wav_path), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
            w.writeframes(b"\0\0" * (rate * 70))

        engine = Qwen3AsrEngine(model=ASR_MODEL_ID, device="cpu", use_vad=True)
        engine._model = MagicMock()
        engine._model.transcribe.return_value = [type("R", (), {
            "language": "Japanese", "text": "", "time_stamps": [],
        })()]

        with patch("engines.vad.VadEngine") as mock_vad:
            mock_vad.return_value.detect_speech_segments.side_effect = RuntimeError("vad load fail")
            # 不应抛错，降级到固定 45s 分块
            transcription = engine.transcribe(str(wav_path), language="ja")
            list(transcription.segments)  # 触发迭代
        # VAD 失败后降级为固定分块：70s → 2 块，model.transcribe 调用 2 次
        self.assertEqual(engine._model.transcribe.call_count, 2)
        call_args = engine._model.transcribe.call_args
        self.assertEqual(call_args.kwargs.get("language"), "Japanese")
        self.assertTrue(call_args.kwargs.get("return_time_stamps") is True)


try:
    import torch  # noqa: F401
    _HAS_TORCH = True
except ImportError:
    _HAS_TORCH = False

try:
    import importlib.util as _importlib_util
    _HAS_QWEN_ASR = _importlib_util.find_spec("qwen_asr") is not None
except ImportError:
    _HAS_QWEN_ASR = False


@unittest.skipUnless(_HAS_TORCH and _HAS_QWEN_ASR, "需要 torch 与 qwen_asr 已安装")
class CudaUnavailableTests(unittest.TestCase):
    def test_cuda_device_unavailable_raises_asr_error(self):
        import torch
        engine = Qwen3AsrEngine(model=ASR_MODEL_ID, device="cuda")
        with patch("torch.cuda.is_available", return_value=False):
            with self.assertRaises(AsrError) as ctx:
                engine.load()
            self.assertIn("CUDA", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
