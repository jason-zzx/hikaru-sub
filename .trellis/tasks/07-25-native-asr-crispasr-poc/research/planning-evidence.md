# T03 Planning Evidence

## Confirmed Repository Facts

- The parent fixes Parakeet/Reazon/Qwen3 to CrispASR and requires Qwen3 ForcedAligner timestamps; text-only Qwen3 success is insufficient.
- `asr-service/engines/qwen3_asr.py` can call `build_segments_from_text` when alignment is absent. This is a current Python fallback and is prohibited for native results.
- `asr-service/engines/parakeet.py` contains multiple long-audio gap/backfill stages and emits a final `TranscriptSegmentRefresh`; native upstream output must be measured before copying any compensation.
- `asr-service/engines/reazonspeech_nemo.py` is whole-audio. Callback/progress behavior in the native ABI needs direct evidence rather than product assumptions.
- Current Python engine tests cover local mocked/behavioral paths; they do not prove native CrispASR ABI behavior or model quality.
- Parent technical research names CrispASR public C ABI as the intended boundary, but exact pinned header signatures and ownership rules remain execution-time evidence requirements.

## Planning Decisions

- Use a child-task-local C++ harness and public C ABI only; no CLI scraping and no production worker skeleton.
- Lock SDK/toolchain/models before first load; retain only small metadata/evidence in Git.
- Test lifecycle and callback ownership separately before model quality/coverage runs.
- Keep decisions independent for Parakeet, ReazonSpeech and Qwen3.
- Reuse T01 metric/comparison logic; do not duplicate CER/gap/timing tools.

## Required Handoff

- T08 consumes `abi-contract.md`, callback/ownership results and runtime inventory.
- T09 consumes Parakeet/Reazon legal timeline, speech gap and subtitle-length evidence.
- T10 consumes Qwen3 aligner success/negative cases, provenance and time-error evidence.
- Parent Gate 0 consumes all per-route decisions and unresolved size/license blockers.
