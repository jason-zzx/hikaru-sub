# Hikaru Sub Native ASR Worker Protocol v1

Protocol v1 is the process boundary between the Tauri host and one single-request Native ASR worker. The original T04 validator/fake-worker scope is retained for compatibility; runtime/model readiness and production route selection belong to the host and model manager, not this wire protocol.

## Transport

- The host writes exactly one UTF-8 JSON line without BOM to stdin, then closes stdin.
- The worker writes one UTF-8 JSON object per stdout line. Every line contains `protocolVersion: 1` and `event`.
- stdout is protocol-only. Bounded diagnostics use stderr and are never mixed into JSONL.
- Request and event lines are bounded before JSON parsing. NUL, BOM, embedded CR/LF, malformed JSON, invalid UTF-8, and unsupported versions fail closed.
- Protocol v1 has no stdin cancellation message. The host cancels by terminating the worker process tree.

Unknown additive object fields are ignored. Unknown engines, backends, model roles, devices, event names, or protocol versions are rejected.

## Request

```json
{
  "protocolVersion": 1,
  "jobId": "job-123",
  "engine": "qwen3-asr",
  "backend": "crispasr",
  "modelPaths": [
    {"role": "model", "path": "C:\\managed\\models\\qwen.gguf"},
    {"role": "aligner", "path": "C:\\managed\\models\\aligner.gguf"},
    {"role": "vad", "path": "C:\\managed\\models\\silero.bin"}
  ],
  "audioPath": "C:\\workspace\\audio.wav",
  "device": "cpu",
  "language": "ja",
  "useVad": true
}
```

Required fields:

| Field | Contract |
|---|---|
| `protocolVersion` | Integer `1`. |
| `jobId` | Non-empty bounded string with no control characters. |
| `engine` / `backend` | Exact fixed route from the matrix below. |
| `modelPaths` | Non-empty bounded array of unique `{role,path}` entries. |
| `audioPath` | Absolute local Windows path. |
| `device` | Host-resolved `cpu`, `cuda`, or `vulkan`; `auto` is invalid. |
| `language` | Exact product source language `ja`. |
| `useVad` | Boolean. |
| `vadConfig` | Optional object. Parsed only when `useVad=true`; ignored when VAD is disabled. Omit rather than send null when enabled. |
| `vadCliPath` | Internal optional absolute local Windows executable path; required only for CT2 + `useVad=true`, rejected on other combinations. Not a frontend argument. |

Protocol path validation is syntax-only. Drive-rooted, UNC, and extended Windows file paths are accepted. Relative paths, URI schemes, Windows device namespaces, alternate data streams/wildcards, NUL/control characters, empty paths, and over-limit paths are rejected. The host remains responsible for canonical managed roots, hashes, readiness, permissions, and runtime choice.

### Fixed route matrix

| Engine | Backend | Required roles | Allowed devices |
|---|---|---|---|
| `faster-whisper` | `ctranslate2` | `model`; exactly `model` + `vad` when enabled | `cpu`, `cuda` |
| `kotoba-faster-whisper` | `ctranslate2` | `model`; exactly `model` + `vad` when enabled | `cpu`, `cuda` |
| `parakeet` (generic historical protocol) | `crispasr` | `model`; additive `vad` permitted | `cpu`, `cuda`, `vulkan` |
| `parakeet` (full-CLI application worker, availability gated) | `crispasr` | `model`, `vad` | `cpu`, `cuda` |
| `reazonspeech-nemo` (generic historical protocol) | `crispasr` | `model` | `cpu`, `cuda`, `vulkan` |
| `reazonspeech-nemo` (full-CLI application worker, availability gated) | `crispasr` | `model`, `vad` | `cpu`, `cuda` |
| `qwen3-asr` (generic historical protocol) | `crispasr` | `model`, `aligner`; additive `vad` permitted | `cpu`, `cuda`, `vulkan` |
| `qwen3-asr` (full-CLI application worker) | `crispasr` | `model`, `aligner`, `vad` | `cpu`, `cuda` |

Generic historical Qwen fixtures retain their two-role syntax; this is **not** a
full-CLI readiness contract. The custom timeline unit is retired; the
DEVELOPMENT Qwen worker keeps the original backend/ForcedAligner capability
call followed by `qwen_timeline_policy_not_implemented` / exit20, with no segment,
replacement or completed event; shared ABI and sibling worker tests remain.
Qwen, Parakeet, and ReazonSpeech full-CLI worker routes reject a missing explicit `vad`,
`useVad=false`, any `vadConfig`, or Vulkan before `ready`/inference. It uses the
pinned upstream default CPU VAD configuration. There is no guessed dependency
path and no silent VAD disablement. Historical Parakeet/ReazonSpeech model-only
syntax remains valid only at the generic protocol/development seam, not the full-CLI
launch boundary. Neither route has an aligner role. CT2 with VAD disabled still
accepts only `model` and does not consult a CLI or VAD dependency.
Duplicate, unknown, or route-extra roles are rejected; array order has no meaning.

### VAD ranges

All VAD fields are optional within `vadConfig`; unknown additive fields are ignored.

| Field | Accepted range |
|---|---:|
| `threshold` | finite number in `[0, 1]` |
| `minSpeechDurationMs` | integer `[0, 60000]` |
| `minSilenceDurationMs` | integer `[0, 60000]` |
| `speechPadMs` | integer `[0, 10000]` |
| `maxSegmentDurationMs` | integer `[1000, 600000]`, and not below supplied `minSpeechDurationMs` |

### CT2 optional CPU VAD

The host requires an explicit `vad` role and internally resolves `vadCliPath`
from a separately verified **CPU** CrispASR runtime with `capabilities.vadExport`.
The selected CT2 worker must advertise `capabilities.vad`; engine names or the
mandatory CLI's `vad:true` alone do not authorize standalone VAD. Main `device`
remains the CT2 CPU/CUDA choice; it never selects VAD's device. No VAD fields or
outer pass are added to Qwen, Parakeet or ReazonSpeech's mandatory pipelines.

Current local authority is CT2 CPU v5 / CUDA v3 plus CrispASR CPU
`shared-vad-local`. CT2 CUDA v3 is unpublished: an exact verified local install is
usable, but old remote source rows cannot offer this candidate. CrispASR CUDA
bytes and publication authority are unchanged. Source/local packages do not
establish application publication or completion of the long/GUI acceptance gates.

Only `threshold` (default 0.5) and `minSilenceDurationMs` (default 100) are accepted
known configuration fields. Supplying `minSpeechDurationMs`, `speechPadMs`, or
`maxSegmentDurationMs` is rejected as `unsupported_vad_config`; pinned upstream
min-speech 250ms and pad 30ms remain fixed. Disabled configuration is ignored.

The worker runs the full CPU CLI with `HIKARU_VAD_ONLY=1`,
`CRISPASR_VAD_FAILOVER=0`, raw export, strict required VAD and explicit local VAD
path, without ASR/aligner arguments. Only this branch disables offline post-merge.
Integer PCM `[start,end)` slices are bounded, ordered and non-overlapping; `t0_cs`
and `t1_cs` are not execution inputs. Exit0, actual CPU VAD completion and complete
bounded JSON are all required, including for empty success. VAD progress is
monotonic completed chunks on stderr (120-second no-progress watchdog); source
ASR progress stays at zero until decoding. Empty detection skips CT2 model loading.

Nonempty spans use one CT2 backend and fresh per-span decoder state. Local times
are offset once using the original sample origin, never concatenated speech.
The existing CT2 parser's local audio boundary normalization is retained, including
results marked `end_bounded_to_audio`; this diagnostic flag is not a VAD rejection.
No decoder, padding or timestamp policy is changed by this integration. Invalid
span decoding still fails rather than repairing timestamps or retrying without
VAD. On completed CT2+VAD jobs the frontend preserves Native rows without short-cue
merging across excluded gaps; truthful empty success, error and cancellation
preserve the prior document, recovery snapshot and ASS save target.

## Events

All fields shown below are required for that event. Unknown additive fields are ignored.

```jsonl
{"backend":"crispasr","device":"cpu","durationMs":120000,"event":"ready","protocolVersion":1}
{"durationMs":120000,"event":"progress","processedMs":30000,"protocolVersion":1}
{"endMs":3000,"event":"segment","protocolVersion":1,"startMs":1000,"text":"synthetic text"}
{"event":"segmentsReplace","protocolVersion":1,"segments":[{"endMs":3100,"startMs":1100,"text":"replacement"}]}
{"detectedLanguage":"ja","durationMs":120000,"event":"completed","protocolVersion":1}
{"code":"model_runtime_failed","event":"error","message":"safe bounded message","protocolVersion":1}
```

| Event | Fields and rules |
|---|---|
| `ready` | `backend`, `device`, positive integer `durationMs`. Must be first on a successful route, exact once, and match the request. Full-CLI ready means bridge/audio readiness, **not model loading or graph execution**. |
| `progress` | Non-negative integer `processedMs`, positive integer `durationMs`. Processed time is non-decreasing and at most duration. Duration exactly matches ready. |
| `segment` | Integer `startMs`, `endMs`, bounded non-empty `text`. Appends one segment. |
| `segmentsReplace` | Complete `segments` array. The full candidate is validated before state changes. Empty replacement is legal. |
| `completed` | Ready-matching `durationMs`, `detectedLanguage: "ja"`. Unique success terminal. |
| `error` | Lowercase machine `code` (`[a-z0-9_]+`) and bounded, non-empty, control-free `message`. Unique failure terminal; it may occur before ready for request/startup validation. |

A segment is legal only when `0 <= startMs < endMs <= ready.durationMs`, text is valid and bounded, and segment order is non-decreasing by `startMs`. Replacement lists obey the same rules. The generic layer never clamps, expands, sorts, synthesizes, or partially applies invalid segments.

## Engine-specific full-CLI output and progress

- Parakeet consumes the pinned upstream Japanese TDT pipeline, required CPU Silero,
  12-second VAD slicing and actual-audio gap retranscription. Native word timestamps
  are centiseconds; final upstream `displaySegments` use integer milliseconds.
  After strict byte/UTF-8/text/timeline/device validation, emit one atomic
  `segmentsReplace`, then `completed`. Neither adapter nor frontend sorts, merges,
  clips or regroups these rows; equal starts and overlaps retain upstream order
  through document installation and ASS serialization. Explicit truthful silence
  is empty success: no ASS write, document/metadata/active path/dirty state change
  or unsaved-recovery discard.
- ReazonSpeech uses the same pinned Japanese FastConformer/RNN-T CLI orchestration
  with an explicit exact model path and required CPU Silero, while retaining its own
  model identity and RNNT execution proof. Pure-RNNT nonblank tokens use the
  authoritative NeMo half-open encoder cell `[t,t+1)`. Before display grouping, each
  token/word/segment end is intersected only with the exact PCM sample support passed
  to that parent or gap decode call; starts are unchanged, and an outside or
  non-positive intersection fails closed. This removes only convolution-padding
  extent beyond supplied PCM: it is not a next-cue, display-row, VAD-boundary or
  slice-end guess and does not sort, merge or relax protocol validation. The final
  `displaySegments` still require positive duration, ordered audio bounds and text
  conservation before one atomic `segmentsReplace`; failure preserves existing ASS
  and recovery. The exact Q8_0 CPU/CUDA short/medium/long functional matrix passes.
- Parakeet/ReazonSpeech's 120-second no-progress execution deadline advances only on
  increasing model/VAD/graph stages or completed slice counts with a fixed total.
  Repeated graph/slice messages and arbitrary stderr do not count as progress. Slice
  completion maps to the existing bounded protocol fraction; `ready` does not claim
  model loading or graph execution.
- Qwen retains its accepted full-CLI wait/cancel behavior and Qwen-specific adjacent
  output-anomaly grouping. The pinned Qwen CLI does not expose the Parakeet slice
  progress source; it must not inherit that deadline as a false 120-second total
  runtime cap. Its execution diagnostics remain fail-closed device assertions,
  not a fabricated progress clock. Host cancellation/Job-tree reap, output bounds
  and terminal persistence apply to all three engines unchanged.

## Lifecycle

```text
request -> error -> EOF
        |-> ready(durationMs) -> (progress | segment | segmentsReplace)*
                              -> completed | error -> EOF
```

Segment or replacement events may occur before the first progress event. This is required because a pinned backend may provide valid segments while its progress callback remains silent. Ready duration makes immediate upper-bound validation possible.

The following are protocol failures:

- output before ready other than one structured error;
- duplicate ready;
- ready backend/device mismatch;
- progress regression or progress beyond duration;
- progress/completed duration drift;
- invalid, out-of-order, or out-of-bounds segment;
- oversized replacement or line;
- completed and error both occurring;
- any stdout event after a terminal event;
- EOF without completed/error, even when exit code is zero.

## Canonical resource limits

`../protocol-v1-limits.json` is the only machine-readable source. CMake reads it to generate `hikaru_asr/protocol_limits.hpp`; CTest parses the JSON again and compares every generated value. T05 must embed or generate from this JSON rather than hand-copy constants.

| Key | Value |
|---|---:|
| `maxRequestLineBytes` | 262,144 |
| `maxEventLineBytes` | 8,388,608 |
| `maxJobIdBytes` | 128 |
| `maxPathBytes` | 32,767 |
| `maxTextBytes` | 16,384 |
| `maxModelEntries` | 8 |
| `maxReplacementSegments` | 32,768 |
| `maxStderrDiagnosticBytes` | 65,536 |

The path limit covers Windows extended paths. The replacement count exceeds the 20,915-unit authoritative long Qwen evidence while remaining finite; accepted subtitle segments are expected to be much fewer. The 8 MiB event-line cap accommodates a large realistic replacement but still independently caps the aggregate text/JSON allocation. Count, per-text, and line limits all apply simultaneously.

## Validation error families

Request/startup rejection is emitted as one pre-ready `error` followed by EOF. Stable codes currently include:

- framing/shape: `missing_request`, `request_line_too_large`, `request_bom`, `request_contains_nul`, `request_multiline`, `request_malformed_json`, `request_invalid_shape`, `request_extra_line`, `missing_or_invalid_field`;
- compatibility/route: `unsupported_protocol_version`, `unknown_engine`, `unknown_backend`, `invalid_route`, `unknown_device`, `invalid_device_for_route`, `invalid_language`;
- identity/path/config: `invalid_job_id`, `invalid_model_paths`, `unknown_model_role`, `duplicate_model_role`, `missing_model_role`, `unexpected_model_role`, `invalid_local_path`, `invalid_vad_config`.

Host-side protocol classification codes are owned by T05. The shared validator exposes stable failures such as `event_line_too_large`, `event_malformed_json`, `unknown_event`, `duplicate_ready`, `event_before_ready`, `ready_route_mismatch`, `progress_regression`, `duration_drift`, `invalid_segment`, `invalid_segment_order`, `segment_out_of_bounds`, `replacement_too_large`, `event_after_terminal`, and `missing_terminal_event`.

## Output and exit classification handoff

| Observed stdout / exit | T05 classification requirement |
|---|---|
| valid `completed`, exit `0` | success |
| valid `error`, documented worker error exit | preserve structured code/message |
| nonzero exit without `error` | host-generated abnormal-exit failure |
| exit `0` without terminal | incomplete-protocol failure |
| valid `completed`, then nonzero exit | failure; never publish success |
| output after terminal | protocol failure |
| malformed/version/unknown/oversized output | protocol failure |
| host termination of hang/process tree | cancellation/termination result owned by T05 |

A valid structured error remains authoritative for its safe code/message. stderr does not change protocol state and must be retained with a host-side bound no larger than product policy.

## Deterministic fake worker

Interface:

```powershell
hikaru-asr-fake-worker.exe --scenario <name>
```

The fake worker still requires one normal request line and closed stdin. Scenario selection is CLI-only and is never part of `WorkerRequestV1`.

| Scenario | Deterministic behavior | Exit |
|---|---|---:|
| `success` | ready, segment before first progress, progress, segment, replacement, final progress, completed | 0 |
| `segments-replace` | ready, preview segment, atomic replacement, completed | 0 |
| `structured-error` | ready, partial segment, progress, structured runtime error | 20 |
| `malformed-json` | malformed stdout line | 0 |
| `unknown-event` | ready then unknown event | 0 |
| `version-mismatch` | event with protocol version 2 | 0 |
| `invalid-transition` | progress before ready | 0 |
| `invalid-segment` | ready then zero-duration segment | 0 |
| `duration-drift` | ready then progress with changed duration | 0 |
| `oversized-line` | one `maxEventLineBytes + 1` line | 0 |
| `crash-before-ready` | no stdout terminal | 70 |
| `crash-after-progress` | ready and progress, then abnormal exit | 71 |
| `zero-exit-without-terminal` | ready and progress, then incomplete EOF | 0 |
| `completed-then-nonzero` | valid completed sequence followed by nonzero exit | 72 |
| `hang-after-ready` | deterministic ready prefix, then hangs | host terminates |
| `child-process-hang` | deterministic ready prefix, launches the same executable as a silent child, then both hang | host terminates tree |
| `stderr-diagnostics` | exactly 65,536 deterministic diagnostic bytes on stderr; stdout is valid ready/completed JSONL | 0 |

CTest runs every terminating scenario twice and compares full stdout, stderr, and exit code; it also exercises missing, malformed, extra-line, oversized, and missing-Qwen-aligner request rejection through the executable. Hang tests compare the exact ready prefix, assign the fake worker and its child to a Windows Job Object, terminate after a fixed 400 ms harness timeout, verify the child scenario actually launched at least two job processes, and verify the job has zero active processes. CTest itself has a fixed outer timeout.

## Offline build and discovery contract

The tracked `third_party/nlohmann/` directory contains nlohmann/json 3.11.3 single header, MIT license, and `provenance.json` with exact size/SHA-256. Configure fails if any identity differs and performs no download.

From a Visual Studio developer environment with CMake and Ninja on `PATH`:

```powershell
cd native-asr
cmake --preset windows-x64-release
cmake --build --preset windows-x64-release
ctest --preset windows-x64-release
```

Equivalent explicit commands are supported:

```powershell
cmake -S native-asr -B native-asr/build/windows-x64-protocol -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build native-asr/build/windows-x64-protocol --config Release
ctest --test-dir native-asr/build/windows-x64-protocol -C Release --output-on-failure
```

T05 executable discovery is stable:

```text
native-asr/build/windows-x64-protocol/bin/hikaru-asr-fake-worker.exe
```

No binary or build directory is tracked. T12 owns packaged runtime provenance; T17 later attests final model-backed CPU release identities.


## Full-CLI Qwen application worker

`HIKARU_ASR_BUILD_QWEN_CLI_WORKER=ON` builds
`hikaru-asr-qwen-cli-worker` from the existing `main.cpp`/emitter, protocol and
shared WAV reader plus `qwen_cli.cpp`. It has no CTranslate2 or historical
`CrispAsrBackend`/Qwen timeline linkage. The option is off by default and rejects
mixed CT2/development builds. `HIKARU_QWEN_CLI_FILE` selects the full
`crispasr.exe` copied beside the worker. The host verifies the distributed
runtime file set before launching it; the worker does not rehash the CLI.
The worker target itself does not own model-manager readiness, downloads or
packaging authority. Current production Qwen is enabled through the existing
manager and independent CrispASR runtime lock; the manager supplies all three
verified role paths to `ResolvedNativeLaunch::resolve`, with required CPU VAD
and no custom config. This document specifies the boundary, not release readiness.

### Model-free capability (not inference protocol)

The pinned full CLI additionally accepts the controlled `--hikaru-probe-cuda`
prelaunch operation. It takes no model/audio path and does not emit worker JSONL.
Its sole successful stdout document is schemaVersion 1, backend `crispasr`, device
`cuda`, operation `ggml-add-f32`, nodes 1, otherDeviceNodes 0, resultVerified true,
modelExecutionProof false. Success requires actual CUDA backend initialization,
allocation, graph execution and exact readback. It is not ASR/lazy-audio/aligner
proof; those remain required by the real transcription adapter.

Rust invokes the same-root verified CLI, never CT2's executable or ABI, using a
suspended process assigned to the existing kill-on-close Job before resume. A
15-second model-free deadline, 16-KiB pipe bounds, exit-zero requirement, complete
UTF-8/JSON validation, duplicate/extra-field rejection and descendant reap apply.
CPU transcription does not run the probe; explicit CUDA never reruns on CPU.
This capability does not open the separate product/publication gates.

### Private process and result ownership

- The Rust host creates an exclusive `{safe-job-id}-cli` directory under the
  canonical audio workspace's `asr-jobs` child. The cache root continues to come
  from `app_paths::work_cache_dir`; no user-selected results directory is added.
- For the explicit three-role route, the host creates a Windows kill-on-close Job,
  creates the worker suspended, assigns it before resuming, and uses that owned
  Job for cancellation/shutdown and descendant reaping. The worker likewise
  assigns the CLI to a nested kill-on-close Job while suspended. No breakaway or
  inherited ownership handle is allowed. Killing only the worker still kills
  its CLI/descendants; the host verifies zero active processes before releasing
  the existing gate and publishing `reaped`.
- UTF-8 request paths are converted with strict Windows Unicode APIs. Input and
  runtime paths are checked for existence, type and reparse ancestors at launch;
  no input/ancestor handles are held during inference. The exclusive results
  file is created with `CREATE_NEW` and held without delete
  sharing, so a concurrent symlink/rename cannot redirect the CLI output.
- CLI argv is fixed file-mode Qwen/ja/default-thread/default-upstream-pipeline
  options, explicit ASR/aligner/VAD files, and no server/download/auto model.
  Audio's relative argv is derived from the validated canonical request
  and checked against the owned UTF-16 cwd, not guessed from a basename. This
  preserves extended/CJK/spaced managed paths despite miniaudio's extended
  absolute-path limitation; an alternative basename is covered by CTest.
- Only private stderr and NUL handles cross `CreateProcessW` through an explicit
  handle allowlist. stdout is discarded; stderr is drained into bounded private
  line inspection and never forwarded to worker JSONL or ordinary host logs.
  The environment is a fresh allowlist: concrete device, same-root/System32 PATH,
  Windows roots and private temporary paths. No shell or inherited loader/model
  knobs select a program or model.
- The small reviewed full-CLI audio adaptation returns false on miniaudio failure
  in validated `HIKARU_QWEN_DEVICE` mode **before** native alternate decoding or
  FFmpeg/shell fallback. Normal upstream mode is unchanged. Windows child-process
  restriction was tested but rejected because it caused DLL initialization exit
  `0xC0000142`; it is not used to replace Job ownership or the source guard.
- After child exit and whole-tree reaping, result bytes are read from the held
  file and validated. Rust removes the private work directory on terminal reap;
  failed/half output and cancellation never write the existing ASS.

### Complete-output acceptance

The parser uses vendored nlohmann, the canonical protocol limits and existing
protocol event validation/serialization. It rejects duplicate keys at any depth,
truncation/trailing JSON, BOM/invalid Unicode (including escaped surrogates),
oversize/count/text limits, wrong scalar types, negative/out-of-audio original
rows, display fallback, missing or wholly unhelpful word timing, and same-run
non-whitespace text loss. Source word `t0/t1` remain centiseconds and must agree
exactly with millisecond offsets.

The Qwen adapter alone merges contiguous display anomalies after validating every
original member: zero-duration rows join the previous group, or merge forward
from the beginning until an original positive-duration member arrives; decreasing
starts merge backward until group starts are nondecreasing. All-zero input fails
even when distinct zero points span a positive envelope. Positive-duration equal
starts and ordinary overlaps remain unchanged. Group endpoints are the minimum
existing start and maximum existing end; original text bytes, including permitted
whitespace, concatenate in order without a separator. No sorting, deletion,
clipping, invented timestamps, or word/VAD/LIS changes occur. The complete final
replacement still passes the unchanged generic positive-duration, text, bounds,
order, count and serialized-size checks. This bounded display change is not
alignment-quality, final-device or product acceptance.

Bounded graph markers must attest ASR, aligner and lazy audio on
the requested concrete device, with positive graph nodes and zero other-device
nodes; successful CPU VAD is mandatory. CPU must not initialize CUDA.

Success requires CLI exit zero. Only then may one `segmentsReplace` immediately
precede `completed`. Empty output is legal only with explicit `vadSilence=true`,
empty source/display arrays and the successful CPU VAD execution marker. Missing
output/failed VAD is not silence. Stage progress remains indeterminate; no timer,
arbitrary stderr activity or `ready` is treated as forward model progress.
The host still requires worker EOF plus exit zero; its completed candidate is
persisted to recovery and (for non-empty output) fallback ASS under the terminal
lock before completed becomes visible. Persistence failure commits a safe failed
terminal rather than claiming completed. First-terminal-wins remains unchanged.

### Tests and local identities

The separate `hikaru-asr-qwen-cli-fixture-worker` target is test-only; its only
identity bypass accepts the tiny same-root `fake_qwen_cli.cpp` executable. No
scenario or bypass key exists in product requests/builds. CTest covers 23 normal,
invalid-output, silence, missing-VAD, extended/CJK/spaced and alternative-basename
cases in the historical section-2 baseline. The current suite also covers adjacent
zero/start-reversal merging, exact whitespace/Unicode, unchanged overlaps/equal
starts, all-zero rejection and invalid members/merged text limits. Rust host tests
assert the corresponding atomic replacement, exact snapshot/recovery and ASS
Dialogue rows; failed results still preserve existing ASS.
Rust host tests use `HIKARU_ASR_QWEN_CLI_FIXTURE_WORKER` only inside the
existing test module for recovery, ASS preservation/write failure, cancellation,
shutdown, worker-only crash, real descendants, immediate reopen and reparse
rejection.

Real host tests use a separate strict `qwen-full-cli-host-v1` input schema via
`HIKARU_ASR_QWEN_CLI_HOST_INPUTS` and `_REQUIRED=1`, only in the test module. Required
mode without its own complete setup fails; generic `HIKARU_ASR_CRISPASR_INPUTS`
retains its historical decoder and cannot authorize this route. Inputs bind all
worker/runtime files, exact model/aligner/VAD bytes and the short WAV. Audio is
copied to a temporary managed workspace before the unchanged host consumes it.
Run exactly:

```text
cargo test --manifest-path src-tauri/Cargo.toml --lib asr_worker::tests::qwen_cli_real_short_host_ass_roundtrip -- --exact --test-threads=1 --nocapture
```

The section-2 controlled audio guard produces these CLI identities (not package
or release authority): CPU 17166848 bytes / SHA-256
`4c5df7de3420aa6653f1208d10b99b99309bf6f918cd69801a581c4f82e29f17`;
CUDA 66503168 bytes / SHA-256
`1be7e85177c105fa24e3985208cb2d3e949df6d0b622ffba97ef0440bc0e4be3`.
Previous section-1 CLI bytes and failed integration attempts remain private
historical evidence; they are not relabeled as current worker/ASS success.
