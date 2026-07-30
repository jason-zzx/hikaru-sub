# T03 Planning Evidence

## Confirmed Current Implementation Facts

- Qwen3 current Python may synthesize timing when alignment is absent; native results prohibit this.
- Parakeet current Python has long-audio gap/backfill and can emit final `TranscriptSegmentRefresh`.
- ReazonSpeech current Python uses 45s chunks with 2s overlap at `>=60s`; this is diagnostic regression evidence only.
- Parakeet, Qwen3 and ReazonSpeech may all final-refresh preview segments; refresh reduction is not Parakeet-only.
- These facts are diagnostics and regression inputs, not native algorithm authority or quality gates.

## Authority And Planning Decisions

- T01 user WAV+ASS ground truth is the only text/speech/timing authority; its per-case coverage and absolute CER/RTF/cold-wall/RSS/timeline budgets are user-reviewed and frozen.
- CrispASR official docs/pinned stable public ABI and model cards rank first, maintained community recommendations second, then ground-truth measurement selects candidates.
- Python results may be absent and cannot repair references or establish relative CER/RTF gates.
- Use task-local public-C-ABI harness only; lock SDK/toolchain/models before load.
- Test lifecycle/callback ownership before model quality; keep three route decisions independent.
- Reuse T01 metrics; no duplicate CER/gap/P95/time scorer.

## Manifest Handoff

Planning evidence remains as provenance, and both manifests now include T01 `research/benchmark-contract.md`. Add `research/python-reference-report.md` only if it exists, explicitly as non-gating current implementation reference.

## Required Handoff

- T08 consumes ABI/callback/ownership/final-refresh/runtime evidence.
- T09 consumes Parakeet/Reazon ground-truth CER/gaps/timeline/resources and algorithm-source evidence.
- T10 consumes Qwen aligner positive/negative/provenance/time-error evidence.
- Parent Gate 0 consumes per-route native feasibility, absolute measurements, size and license blockers, not Python parity.
