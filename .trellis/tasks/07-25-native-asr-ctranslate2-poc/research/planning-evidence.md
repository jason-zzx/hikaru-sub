# T02 Planning Evidence

## Confirmed Current Behavior

- `FasterWhisperEngine` supplies the Python comparison behavior: CPU int8, beam size 5, language handling, and VAD mapping.
- `KotobaFasterWhisperEngine` fixes `kotoba-tech/kotoba-whisper-v2.0-faster`, `chunk_length=15`, `condition_on_previous_text=false`, Japanese and a Kotoba-only `preprocessor_config.json` cache rule.
- Current `requirements.txt` uses an unbounded `faster-whisper>=1.1.1`; T02 therefore must create an immutable lock rather than treating the installed environment as sufficient provenance.
- The parent design requires CTranslate2 C++ plus native audio/tokenizer/timestamp functionality; it does not authorize a production CMake project before T04.
- T01 is the source of corpus/reference/metric truth. T02 only needs a short fixture and a >30s boundary fixture for feasibility, not a new benchmark suite.

## Planning Decisions

- Put C++ sources under the child task `research/poc-src/`, with ignored local model/build data, so Gate 0 can discard them without shaping production architecture.
- Test tokenizer, features and timestamps as separate lower-level gates; a plausible transcript does not prove a viable native pipeline.
- Record but do not implement VAD restoration, 30-second production windowing, fallback/no-speech, overlap merge or cache compatibility.
- Use a documented runtime inventory and clean-PATH launch to prove test-machine CPU-only feasibility; T12 remains responsible for distributable package proof.

## Risks To Carry Forward

- Exact CTranslate2 API, tokenizer library and FFT selection must be proven against immutable inputs before model inference.
- Numerical feature tolerances must be selected before inspecting real transcript results.
- T02 can demonstrate only the recorded hardware/Windows environment; compatibility policy is reserved for T12.
