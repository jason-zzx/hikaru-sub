import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engines.faster_whisper import FasterWhisperEngine


class FasterWhisperVadTests(unittest.TestCase):
    def test_uses_shared_defaults_when_vad_config_empty(self):
        engine = FasterWhisperEngine(model="base", use_vad=True, vad_config={})

        self.assertEqual(
            engine._vad_parameters(),
            {
                "threshold": 0.5,
                "min_speech_duration_ms": 500,
                "min_silence_duration_ms": 300,
                "speech_pad_ms": 400,
            },
        )


if __name__ == "__main__":
    unittest.main()
