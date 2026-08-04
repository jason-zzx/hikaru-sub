#!/usr/bin/env python3
"""Add the reviewed long-v1 identity to the frozen selected CPU adapter."""

from __future__ import annotations

import selected_cpu_adapter as adapter

LONG_CASE = {
    "audioSha256": "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e",
    "assSha256": "7954ce24af05dca37b2930136c83ee722e80fd637ef298cc7eeb47f29cf8c6f3",
    "durationMs": 4_144_235,
    "sourceFrames": 414_424,
    "sampleCount": 1,
}


def main() -> int:
    adapter.EXPECTED_CASES["long-v1"] = LONG_CASE
    return adapter.main()


if __name__ == "__main__":
    raise SystemExit(main())
