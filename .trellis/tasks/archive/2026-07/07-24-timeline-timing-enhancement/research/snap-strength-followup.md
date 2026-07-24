# Snap Strength Follow-up

## Symptom

Manual testing found snapping visually present but behaviorally weak. The original resolver gave playhead, cue boundaries, and frame starts one 8 CSS px threshold, then selected the closest candidate. At 25/30 FPS a frame start is almost always closer than a semantic target, so frames repeatedly won before playhead/cue priority could matter.

## Contract

- Playhead and other-cue boundaries: 12 CSS px strong threshold.
- Frame starts: 4 CSS px fallback threshold.
- Resolve legal strong candidates first; choose nearest, with playhead winning exact ties.
- Resolve a frame only when no strong candidate matches.
- Whole-cue start/end anchors preserve the same strong-before-frame tier before comparing correction distance.
- Convert both thresholds through the gesture-snapshotted `msPerPixel` so screen-space feel stays stable across zoom.

## Regression Coverage

- Strong playhead beats a closer frame.
- Strong cue boundary beats a closer frame.
- Illegal strong candidate falls back to a legal frame.
- Beyond 12px, boundary drag uses the 4px frame candidate.
- Body drag and waveform range selection preserve strong-target priority.
- Full suite after review follow-ups: 100 files / 751 tests passed; build and diff check passed.
