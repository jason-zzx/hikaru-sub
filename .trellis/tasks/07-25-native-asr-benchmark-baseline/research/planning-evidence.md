# T01 Planning Evidence

## Confirmed Repository Facts

- `asr-service/engines/base.py` defines the stable `AsrSegment`, `Transcription`, and `TranscriptSegmentRefresh` contracts.
- `asr-service/engines/registry.py` already exposes all five required engines through `create_engine`; a benchmark-only registry would duplicate product truth.
- `asr-service/jobs.py` replaces accumulated preview segments when it receives `TranscriptSegmentRefresh`; Parakeet uses this for final corrected output.
- Faster Whisper fixes beam size 5 and maps CPU to int8; Kotoba adds 15-second chunks, `condition_on_previous_text=false`, and a Kotoba-only `preprocessor_config.json` requirement.
- Parakeet contains gap/backfill logic, Qwen3 can fall back to synthetic text timing when alignment is absent, and ReazonSpeech is a whole-audio path. The baseline must record these behaviors without treating all timestamps as equivalent.
- Existing tests provide mocked/synthetic behavior checks, not a model-backed Japanese quality corpus.
- No benchmark framework or CER dependency exists in `package.json`; standard-library Python is sufficient for the first contract.
- Current ignore rules do not protect a benchmark corpus/results directory, so ignore policy must land before local private/model runs.

## Planning Decisions

- Use one Python CLI plus one focused unittest module unless testability proves a small helper module necessary.
- Use JSON as the source of truth and derive Markdown.
- Keep punctuation in CER; apply NFKC and remove Unicode whitespace.
- Use fresh subprocesses for cold measurements and separate load/inference/total RTF.
- Measure confirmed speech gaps from reference annotations, not spacing between candidate subtitles.
- Commit only redistributable small fixtures and sanitized reports; keep large/private corpus and raw results ignored.

## Evidence Consumers

- T02 consumes large-v3/Kotoba fixture IDs, hashes, Python segments, environment and comparison commands.
- T03 consumes Parakeet/Reazon/Qwen3 fixture IDs, speech regions, Python segments, timestamp provenance and comparison commands.
- Parent Gate 0 consumes per-engine status and the resulting feasibility comparison reports.
