import os
import unittest
from unittest.mock import patch

from engines.base import AsrSegment
from diagnostics import (
    segment_overlaps_range,
    segments_in_range,
    trace_ms_range,
)


class DiagnosticsTraceTests(unittest.TestCase):
    def test_trace_ms_range_defaults_to_greeting_window(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("HIKARU_ASR_TRACE_MS_RANGE", None)
            self.assertEqual(trace_ms_range(), (8000, 14000))

    def test_trace_ms_range_reads_env(self):
        with patch.dict(os.environ, {"HIKARU_ASR_TRACE_MS_RANGE": "9000-13000"}):
            self.assertEqual(trace_ms_range(), (9000, 13000))

    def test_segments_in_range_filters_overlapping_segments(self):
        segments = [
            AsrSegment(0, 1000, "a"),
            AsrSegment(9000, 11000, "b"),
            AsrSegment(15000, 16000, "c"),
        ]
        filtered = segments_in_range(segments, 8000, 14000)
        self.assertEqual([seg.text for seg in filtered], ["b"])
        self.assertTrue(segment_overlaps_range(segments[1], 8000, 14000))


if __name__ == "__main__":
    unittest.main()
