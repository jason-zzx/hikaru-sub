# T10 Parakeet / ReazonSpeech Handoff

## Result

T10 completed the frozen 15-second no-overlap candidate matrix under one final native binary/runtime identity for each engine. Both candidates are independently `stop-revise`:

- `reazonspeech-nemo` / `R1-window15s-top-level-v1`: `stop-revise`.
  - short-v1 completed: CER `0.2250`, CUDA inference RTF median `0.058460`, timeline errors `0`, semantic confirmed-speech gaps `1`.
  - medium-v1 completed: CER `0.377143`, CUDA inference RTF `0.035689`, timeline errors `0`, semantic confirmed-speech gaps `22`.
  - long-v2 is an identity-valid structured failure: `crispasr_result_invalid` at window `[345000,360000]ms`; the native top-level segment was zero-duration (`14800..14800ms`). No synthetic duration or clamp was applied.
- `parakeet` / `P1-window15s-native-word-v1`: `stop-revise`.
  - short-v1 completed and passed applicable gates: CER `0.166667`, CUDA inference RTF median `0.022136`, timeline errors/gaps `0/0`.
  - medium-v1 completed: CER `0.392527`, CUDA inference RTF `0.017027`, timeline errors `0`, semantic confirmed-speech gaps `17`.
  - long-v2 completed native inference but the pure policy failed closed with `parakeet_family_text_conservation`; no partial output was accepted.

No result authorizes Release/default routing. Both native routes remain disabled; Python legacy remains authoritative.

## Frozen evidence

- raw index: `research/t10-raw-index.json`, SHA-256 `ef1b0a811fc9544f0b7b1358f663db65690c99e7fadd4d604a5e22d8eefa4d3b`
- publication: `research/evidence/t10-parakeet-reazon.json`, `10349` bytes, SHA-256 `ca7512e91b8b69197ff22acbcb5f5b45434c4b5c9b92c1307e479d6a50d246af`
- report: `research/t10-parakeet-reazon-report.md`, `1057` bytes, SHA-256 `9dd31d236db65fc14cefc0bbf435dc3d066ef10c7ed996c5f92364781c023bd7`
- publisher/tests: `research/publish_t10_evidence.py`, `research/test_publish_t10_evidence.py`
- final validation: `research/t10-validation.md`
- manifest: `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea`
- shared comparator: `b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822`
- final runner: `307712` bytes, SHA-256 `845dc2e5f93f73a851789b0643d2e4e29aa6e29ea0835e037cfad047c58660c6`
- final worker: `571904` bytes, SHA-256 `57e8d02c17c5a7a268b6a0c391beecbd0356bbcd03c3f361540606223efdba5d`
- CrispASR runtime: `11414528` bytes, SHA-256 `824b5d89fd38eac5f04a5fd65927bb11a0060ab8a001cc57766bf6c914ec334e`

Tracked artifacts contain no transcript text, private media/model paths, stderr, or binaries. Raw text, models, audio, logs, builds, and host fixtures remain under ignored `research/local/`.

## Product contracts established

- Parakeet-family inference uses sequential real PCM windows on one pinned session; returned timing is translated once from window-local to audio-absolute and rejected rather than clamped when invalid.
- Raw upstream previews are never accepted into recovery. The worker emits monotonic progress and exactly one policy-approved `segmentsReplace` before `completed`, or a structured error with zero accepted output.
- Reazon R1 uses only legal top-level window timing. Parakeet P1 uses positive-duration native-word anchors and permits zero-duration text only through deterministic attachment without synthetic timing.
- Final cues preserve bytes and obey `96` Unicode code points / `15000ms`; canonical replacement limits remain enforced by protocol v1's existing `Emitter`.
- Real Rust-host tests cover successful atomic replacement/recovery, post-ready policy failure with zero accepted output, and hard cancellation/process reap.

## Downstream boundary

- T14/T15 receive no accepted Parakeet-family algorithm input from T10.
- A future R2/P2 must be a separately reviewed identity that addresses the complete observed short/medium/long-v2 failure distribution; it cannot silently add overlap, reference repair, synthetic timing, VAD, or a model/runtime change.
- T11 Qwen, model downloader, settings, frontend, installer, portable packaging, runtime packs, and Release/default routing remain unchanged.
