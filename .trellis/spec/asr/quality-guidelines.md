# ASR Quality Guidelines

## Current Native production checks

Native model/worker changes need direct CPU and CUDA functional verification with the
actual selected engine and device, legal non-empty ASS/protocol output, cancellation,
process-tree reap, recovery and preservation of existing subtitles on failure.
Keep trusted model/runtime distribution hashes, exact model identities, independent
backend DLL roots, mandatory CPU VAD where applicable, path containment and privacy.
A model-free CUDA probe or CTest is not a real-model inference run; report absent
models/devices rather than calling them verified. Do not infer actual GPU execution
from DLL names or PTX coverage. Only the hardware actually used is tested.

Qwen uses the full CLI with the exact Q4_K ASR/ForcedAligner pair, CPU Silero,
upstream LIS/interpolation and the approved adjacent display anomaly merge; see
[qwen-cli-output.md](./qwen-cli-output.md). Parakeet and ReazonSpeech use their
pinned full-CLI routes and required CPU Silero. These product routes are qualified
by CPU/CUDA functional, structural and lifecycle checks, **not** CER, semantic-gap,
Python parity, RTF thresholds or inherited-from-GPU quality scoring. Silence is
successful only after actual VAD completion; an error or partial output cannot be
recast as silence. No GPU task that has started silently retries on CPU.

Ordinary CTranslate2 Whisper derives the Mel size from the loaded model (80 or
128), supports its applicable `vocabulary.txt` or `vocabulary.json`, and never
inherits Kotoba-only preprocessor readiness. Kotoba requires its exact model,
non-empty `preprocessor_config.json`, 128 Mel, Japanese source and a
15-second source window against the 30-second model timestamp range. Its K2
bounded stride caps applied advance at 1000 frames, uses decoded-start ownership
and exact `(startMs, endMs, text)` dedup, and reports monotonic progress. Changes
to these algorithms require direct timing/text/ownership regression checks, not
per-token, tuple or intermediate trace hashes. K3 quality work follows its own
approved task and user-provided WAV+ASS truth: run every required short/medium/long
case even if an earlier quality case fails, and keep Python output diagnostic-only.
Do not repair subtitles by reference-matching, fuzzy dedup, backfilling, clipping
or synthesizing timestamps.

Optional CT2 CPU VAD uses the same ordinary/Kotoba decoder independently on each
original PCM speech span, with one original sample-origin offset and no frontend
short-cue merge across excluded gaps. Disabled VAD retains the full-audio baseline;
mandatory CrispASR routes must not receive an outer VAD pass. Keep the existing
CT2 `end_bounded_to_audio` normalization: it is not a new VAD rejection or permission
to change decoder endpoints, padding or thresholds. In the actual final PCM window,
the shared parser may retain a nonempty accepted prefix reaching EOF only when a
single-timestamp-ending generation has a fully consumed, complete, ordered suffix
whose timestamps are all at/after EOF and nondecreasing from the preceding raw
endpoint. Otherwise original parsing/error handling remains. Retain only accepted
prefix history and keep raw generation in the trace; excluded suffix text is not
retimed or claimed to be proven hallucination or semantically lossless. A failed
span stays a failed job, not silence or a no-VAD retry. Long-case and real GUI
acceptance must remain explicitly incomplete when only short/medium or mocked-IPC
checks pass.

After an interrupted model run, terminate and confirm reap of only task-owned
processes before an explicit retry; a killed run provides no success or timing
metrics. Do not require a matching historical binary, log or hash-bound recovery
sentinel. Compare behavior and outputs directly; keep raw transcripts, audio,
paths and traces ignored-local. Test artifacts and summaries must not publish raw
private data. Source/local test success is not adoption into a released runtime.

The long-form candidate-selection, benchmark-publisher and historical qualification
procedures belong to their archived task records under `.trellis/tasks/archive/`.
They are historical research, **not** current build, smoke, recovery or product
acceptance gates. Existing product manifests and released archive verification
remain authoritative for the artifacts they describe.

## Historical Python sidecar source

The Python sidecar is development/history only, not a Native fallback. If that
source changes, run `python -m unittest discover tests` from `asr-service/` and
report missing optional dependencies/models. Preserve its engine registry and
HTTP aliases; do not extend its permissive optional-VAD behavior to mandatory
Native VAD.
