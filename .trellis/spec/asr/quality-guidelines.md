# ASR Quality Guidelines

## Verification

```bash
cd asr-service
python -m unittest discover tests
```

Representative tests:

- `tests/test_jobs.py` — job manager behavior
- `tests/test_faster_whisper_model_cache.py` — cache readiness
- `tests/test_kotoba_faster_whisper.py` — version gate + preprocessor requirement
- `tests/test_vad.py`, `tests/test_chunking.py`, `tests/test_diagnostics.py`
- Optional engine suites: `test_parakeet.py`, `test_qwen3_asr_engine.py` (may need deps)

When optional engines or models are absent, report that limitation instead of claiming full coverage.

## Standards

- Engines stay behind `AsrEngine` + registry
- HTTP aliases stay aligned with frontend types
- Diagnostics are opt-in via env; keep default runs quiet
- Prefer small, focused unittest modules mirroring engines/helpers

## Scenario: Ground-Truth ASR Comparison

### 1. Scope / Trigger

Use this contract whenever a Python or native ASR candidate is measured for migration feasibility. User-provided `.asr-benchmark` WAV+ASS pairs are the only text, speech-region, and timeline truth; current Python output is diagnostic only.

### 2. Signatures

```bash
python scripts/asr-benchmark.py validate --manifest <manifest> --corpus-root <root>
<development-python> scripts/asr-benchmark.py run --manifest <manifest> --corpus-root <root> --expected-interpreter <development-python> --hf-home <cache> --case <case-id> --engine <engine> --model <model> --device <cpu|cuda|auto> --output <ignored-json>
python scripts/asr-benchmark.py report --results <ignored-results> --output <markdown>
```

T02/T03 and later native harnesses consume or adapt the versioned `hikaru-asr-benchmark-result` envelope; they must not copy CER, P95, speech-gap, refresh, or report algorithms.

Pinned CrispASR CPU evidence uses the public session/alignment ABI:

```text
crispasr_session_open_with_params(..., use_gpu=0, n_gpu_layers=0, ...)
crispasr_session_set_progress_callback / set_segment_callback / set_token_callback
crispasr_session_transcribe*
crispasr_session_result_* / crispasr_align_words_abi
crispasr_session_result_free / crispasr_alignment_result_free / crispasr_session_close
```

Use the exact signatures and ABI version from the locked headers; the names above define the required proof surface, not a wrapper API.

### 3. Contracts

- Manifest case keys are safe relative WAV/ASS paths plus hashes, WAV shape, duration class, Dialogue count, positive per-case coverage tags, source/license/authorization, and `ass-dialogue-v1` derivation metadata. Inline reference text/segments are forbidden.
- Validation parses ASS locally and derives private reference text/segments/speech intervals in memory. Tracked reports contain only stable IDs, hashes, aggregate metrics, coverage, and limitations.
- `TranscriptSegmentRefresh` replaces the complete preview list before scoring for every engine.
- Native Whisper evidence distinguishes the supplied source slice from the padded model timestamp range. A 15-second seek slice may still use the model's 30-second timestamp-token range; record both `sourceWindowDurationMs` and `modelWindowDurationMs` per trace.
- A token-derived end inside the model range may be bounded to the verified WAV end only when raw evidence retains the original end, final end, token IDs, trace hash, and an explicit bound flag. A segment starting at/after WAV end still fails. Do not use bounding to repair missing speech.
- Native evidence records immutable model file sizes/SHA-256, input-lock SHA-256, executable SHA-256, environment, and ignored raw/result hashes. Raw transcripts/traces may be written only below the exact canonical task-local ignored root; substring path checks are insufficient.
- One shared native identity validator must cover every completed, failed, derived, and negative record before scoring or publication. It binds manifest/case/audio, lock, executable, required DLLs, route model/aligner, CPU/GPU params, loaded modules, and restricted-PATH policy. Never merge rows from different executable/DLL/lock identities into one evidence set.
- CrispASR CPU claims require public CPU-forced open params plus actual loaded-module inventory under a restricted PATH; DLL filenames alone do not prove which backend ran.
- CrispASR callback contexts are reset on every success/error exit before destruction. Result/alignment/session cleanup evidence records created/free/close counts and derives exact-once status from those counts; do not publish a hard-coded boolean.
- Qwen3 raw CJK character ranges are not subtitle segments. Preserve them, tokenize/group with the exact pinned upstream ranges and source-segment semantics, and accept only legal ForcedAligner-derived grouped segments. Session getter sentinel timing remains explicitly ineligible. A zero-duration final group fails closed; it is not repaired by synthetic expansion.
- Native top-level segments and nested word timing are separate capabilities. Report both distributions. One broad top-level segment can mathematically hide confirmed gaps but does not prove subtitle-scale segmentation readiness.
- Controlled failed evidence retains the failing trace and source/model bounds. Validators reject empty placeholder traces, and the benchmark adapter must refuse failed evidence.
- Frozen native gates: CER `<=0.35` per engine/case; CPU inference RTF `<=1.0`; accelerated GPU inference RTF `<=0.5`; short cold wall `<=120s`; peak RSS `<=6 GiB` for CTranslate2 or `<=12 GiB` for CrispASR; zero invalid/out-of-bounds segments; zero confirmed speech gaps `>=1500ms`; Qwen3 ForcedAligner median `<=150ms` and P95 `<=500ms`. No VRAM gate is defined.
- Python references never establish expected output, relative CER/RTF gates, or missing annotations.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| WAV/ASS hash or declared shape differs | Reject the manifest case |
| Absolute/escaping path or unsupported manifest field | Reject before reading candidate output |
| Inline reference or inferred speech interval | Reject; derive only from the local ASS |
| Raw result path inside Git tree is not ignored | Refuse to write |
| Python runner uses the wrong interpreter/cache | Reject as invalid evidence |
| Qwen3 provenance is synthetic/mixed/unknown/generic engine-native | Record timing as ineligible |
| Whisper trace uses a shorter source slice than its padded model tensor | Validate tokens against the model range; record both ranges |
| Token-derived end exceeds verified WAV end but stays inside model range | Preserve raw end and explicitly bound final end to WAV duration |
| Token-derived start is at/after WAV end | Fail the candidate sample |
| Raw output path is outside the canonical task-local ignored root | Reject before model/audio access |
| Input lock, model hashes, executable/DLL identity, CPU params, loaded modules, or PATH policy differs | Reject or classify as a separate evidence set |
| Derived or negative record bypasses the shared identity validator | Reject publication even when its status/timeline looks valid |
| CrispASR CPU run uses implicit/default GPU params | CPU gate is ineligible until rerun with explicit CPU params and module attestation |
| Qwen raw character range is zero-duration | Retain as raw provenance; validate only after exact pinned source-segment grouping |
| Qwen grouped final segment is zero-duration or session-native/synthetic | Fail closed with zero accepted timeline |
| Callback context exits without all registered callbacks reset | Reject lifecycle evidence |
| Created result/alignment/session count does not match free/close count | Reject exact-once claim |
| Failed envelope has no complete matching trace | Reject the evidence; do not summarize it as a blocker |
| Coverage tag is absent or unconfirmed | Leave it absent and report the corpus-wide gap |

### 5. Good / Base / Bad Cases

- **Good:** native candidate uses the validated manifest identity, one exact lock/binary/DLL/model evidence set, shared metrics, and frozen absolute gates; source/model windows, CPU modules, Qwen raw-to-grouped provenance, and any WAV-end bound remain auditable. Python data is shown only as supplemental diagnostics.
- **Base:** Python medium/long diagnostics are missing, or an engine returns one broad legal segment; native comparison proceeds but explicitly reports the diagnostic or subtitle-segmentation limitation.
- **Bad:** regenerate reference text from a Python transcript, compare only against Python parity, average cases to hide one failing case, treat runtime feasibility or one broad segment as subtitle readiness, publish derived/negative records without identity validation, treat Qwen character ranges as final cues, use a source-slice duration as the model timestamp range, or commit private media/raw results.

### 6. Tests Required

```bash
python scripts/asr-benchmark.py self-check
python scripts/asr-benchmark.py validate --manifest asr-service/benchmarks/corpus.example.json
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
cd asr-service && python -m unittest discover tests
```

Assert ASS fail-closed parsing, exact S/D/I CER counts, timing provenance, per-case coverage union, refresh replacement, deterministic sanitized Markdown, ignored raw outputs, and path/privacy rejection. Native Whisper harnesses additionally assert distinct source/model windows, verified-WAV end bounding with raw provenance, start-after-audio failure, exact model/lock/binary identity, canonical output containment, and complete failed-trace validation.

Native CrispASR harnesses additionally assert:

- mutation rejection for case/audio/manifest/lock/executable/DLL/model/aligner/CPU params/modules/PATH across completed, failed, derived, and negative records;
- exact pinned CJK punctuation/mixed-script token counts and source-segment grouping;
- Qwen session getter timing is ineligible and all accepted timing is ForcedAligner-derived;
- real missing/corrupt/unloadable/empty/malformed/invalid-audio negatives accept zero timed output;
- callback reset on success and error, plus created/free/close count-derived exact-once cleanup;
- short cold + three warm samples, medium/long attempts or complete failed evidence, single final evidence identity, and byte-identical sanitized publication.

### 7. Wrong vs Correct

```text
Wrong: native passes because it differs from Python by less than 1%, because the runtime can execute all models, or because one broad segment covers the whole speech interval.
Correct: native passes only when each route/case meets the frozen absolute gates against validated WAV+ASS ground truth, with one enforced lock/binary/DLL/model identity, auditable native timing, and separately reported subtitle-scale segmentation risks.

Wrong: use every Qwen aligner character range as a cue, expand zero-duration ranges, or publish session getter sentinel timing.
Correct: retain raw ranges, reproduce the exact pinned upstream source grouping, accept only legal ForcedAligner-derived final segments, and fail closed otherwise.
```

## Anti-Patterns

- Committing model weights or venv contents
- Silent Kotoba cache “ready” without `preprocessor_config.json`
- Changing job snapshot shape without cross-layer type updates
- Adding GPU-only code paths without documenting CPU/optional install reality
- Reimplementing benchmark metrics or using Python parity as native quality truth
- Publishing native derived/negative evidence outside the same identity validator used for authoritative results
- Treating raw Qwen character ranges, session sentinel timing, or one giant top-level segment as subtitle-ready output
- Hard-coding exact-once cleanup or CPU-backend claims instead of deriving them from counts, params, and loaded modules
