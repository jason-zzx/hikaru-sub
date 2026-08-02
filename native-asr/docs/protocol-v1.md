# Hikaru Sub Native ASR Worker Protocol v1

Protocol v1 is the process boundary between the future Tauri host and one single-request native ASR worker. T04 provides validation and a deterministic fake worker only; it does not select runtimes, inspect model bytes, download files, or change the production ASR route.

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
    {"role": "aligner", "path": "C:\\managed\\models\\aligner.gguf"}
  ],
  "audioPath": "C:\\workspace\\audio.wav",
  "device": "cpu",
  "language": "ja",
  "useVad": true,
  "vadConfig": {
    "threshold": 0.5,
    "minSpeechDurationMs": 500,
    "minSilenceDurationMs": 300,
    "speechPadMs": 400,
    "maxSegmentDurationMs": 25000
  }
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
| `vadConfig` | Optional. Parsed only when `useVad=true`; ignored when VAD is disabled. |

Protocol path validation is syntax-only. Drive-rooted, UNC, and extended Windows file paths are accepted. Relative paths, URI schemes, Windows device namespaces, alternate data streams/wildcards, NUL/control characters, empty paths, and over-limit paths are rejected. The host remains responsible for canonical managed roots, hashes, readiness, permissions, and runtime choice.

### Fixed route matrix

| Engine | Backend | Required roles | Allowed devices |
|---|---|---|---|
| `faster-whisper` | `ctranslate2` | `model` | `cpu`, `cuda` |
| `kotoba-faster-whisper` | `ctranslate2` | `model` | `cpu`, `cuda` |
| `parakeet` | `crispasr` | `model` | `cpu`, `cuda`, `vulkan` |
| `reazonspeech-nemo` | `crispasr` | `model` | `cpu`, `cuda`, `vulkan` |
| `qwen3-asr` | `crispasr` | `model`, `aligner` | `cpu`, `cuda`, `vulkan` |

Qwen is rejected before inference if either role is absent. Duplicate, unknown, or route-extra roles are rejected; array order has no meaning.

### VAD ranges

All VAD fields are optional within `vadConfig`; unknown additive fields are ignored.

| Field | Accepted range |
|---|---:|
| `threshold` | finite number in `[0, 1]` |
| `minSpeechDurationMs` | integer `[0, 60000]` |
| `minSilenceDurationMs` | integer `[0, 60000]` |
| `speechPadMs` | integer `[0, 10000]` |
| `maxSegmentDurationMs` | integer `[1000, 600000]`, and not below supplied `minSpeechDurationMs` |

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
| `ready` | `backend`, `device`, positive integer `durationMs`. Must be first on a successful route, exact once, and match the request. |
| `progress` | Non-negative integer `processedMs`, positive integer `durationMs`. Processed time is non-decreasing and at most duration. Duration exactly matches ready. |
| `segment` | Integer `startMs`, `endMs`, bounded non-empty `text`. Appends one segment. |
| `segmentsReplace` | Complete `segments` array. The full candidate is validated before state changes. Empty replacement is legal. |
| `completed` | Ready-matching `durationMs`, `detectedLanguage: "ja"`. Unique success terminal. |
| `error` | Lowercase machine `code` (`[a-z0-9_]+`) and bounded, non-empty, control-free `message`. Unique failure terminal; it may occur before ready for request/startup validation. |

A segment is legal only when `0 <= startMs < endMs <= ready.durationMs`, text is valid and bounded, and segment order is non-decreasing by `startMs`. Replacement lists obey the same rules. The generic layer never clamps, expands, sorts, synthesizes, or partially applies invalid segments.

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
