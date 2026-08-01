# Native ASR Worker Protocol v1 设计

## Summary

T04 建立一个很小的 C++ protocol library 和 deterministic fake worker。它只冻结 wire contract 与异常场景，不实现 host、模型或产品路由。T05 通过同一 fake executable 验证 Rust 生命周期；T06/T08 在同一 `native-asr/` 工程中接入真实 backend。

## Architecture

```text
native-asr/
  protocol library
    request/event structs
    JSON parse/serialize
    validation + bounded constants
          |
          +--> protocol self-check executable / CTest
          |
          +--> hikaru-asr-fake-worker
                    |
                    +--> T05 Rust host integration tests
```

不创建 trait/factory 层。共享内容只是一组 plain structs、enums、validation functions 和 constants。

## Proposed Files

```text
native-asr/
  CMakeLists.txt
  CMakePresets.json
  docs/protocol-v1.md
  protocol-v1-limits.json             # canonical cross-language limits
  include/hikaru_asr/protocol.hpp
  src/protocol.cpp
  src/fake_worker.cpp
  tests/protocol_tests.cpp
  third_party/nlohmann/json.hpp
  third_party/nlohmann/LICENSE.MIT
```

构建产物和依赖缓存放在 ignored `native-asr/build/` 或显式本地构建目录；不得提交 exe/DLL。

## Request Model

```text
WorkerRequestV1
  protocolVersion = 1
  jobId
  engine
  backend
  modelPaths[]
    role
    path
  audioPath
  device = cpu | cuda | vulkan
  language = ja
  useVad
  vadConfig?
```

固定 route matrix：

| Engine | Backend | Required model roles | Allowed device values |
|---|---|---|---|
| faster-whisper | ctranslate2 | model | cpu/cuda |
| kotoba-faster-whisper | ctranslate2 | model | cpu/cuda |
| parakeet | crispasr | model | cpu/cuda/vulkan |
| reazonspeech-nemo | crispasr | model | cpu/cuda/vulkan |
| qwen3-asr | crispasr | model + aligner | cpu/cuda/vulkan |

Protocol validates the fixed combination but does not inspect model bytes, managed roots, hardware availability or hashes.

## Event Model

Every event carries `protocolVersion` and `event` so a line can be validated independently.

```text
ReadyEvent       backend, device, durationMs
ProgressEvent    processedMs, durationMs (must equal ready)
SegmentEvent     startMs, endMs, text
ReplaceEvent     segments[]
CompletedEvent   durationMs, detectedLanguage
ErrorEvent       code, message
```

Unknown fields are ignored. Unknown event names and unsupported protocol versions fail.

## Lifecycle Semantics

The fake worker and protocol tests model the worker-side legal sequence; T05 owns host reduction.

```text
stdin one request line
  -> validate failure -> one pre-ready error -> stdout close -> process exit
  -> validate success -> ready(durationMs)
                      -> zero or more progress/segment/replace
                      -> one terminal completed/error
                      -> stdout close
                      -> process exit
```

Pre-ready errors are limited to request/version/route/path/audio-validation classes. After ready, every segment can be bounded immediately even if no progress event is ever emitted; progress/completed duration must equal ready.

Exit classification handoff:

| Observed output/exit | T05 expected classification |
|---|---|
| completed + exit 0 | success |
| error + any documented error exit | structured failure |
| nonzero without error | worker_abnormal_exit |
| exit 0 without terminal | worker_protocol_incomplete |
| completed then nonzero | failure, never completed |
| output after terminal | protocol failure |
| malformed/oversized line | protocol failure |

T04 encodes scenarios and expected outputs; T05 owns the final error code mapping.

## Bounds

`native-asr/protocol-v1-limits.json` is the sole machine-readable limits source. CMake reads it with built-in JSON support and generates/validates the C++ constants; T05 later embeds the same file and runs a cross-language equality test. Concrete values are selected during implementation with these constraints:

- request/event line size is finite and checked before JSON allocation grows without bound;
- path/job/text lengths cover Windows local paths and ordinary subtitles;
- replacement segment count comfortably exceeds T01 long reference size while remaining finite;
- model role count stays small and route-specific;
- stderr scenario can exceed the proposed host retention cap without polluting stdout.

`protocol-v1.md` records the final numeric values. No handwritten Rust mirror is permitted.

## Fake Worker Interface

The fake executable receives only a test scenario selector and then reads a normal protocol request from stdin. Example shape:

```text
hikaru-asr-fake-worker --scenario success
```

Scenario selection is not part of `WorkerRequestV1` and is never accepted by the production worker. Child-process scenarios use a second invocation of the same fake executable to avoid shipping another helper binary. Terminating scenarios compare complete output/exit; hang scenarios expose a deterministic prefix, use fixed CTest timeout, and are killed by the harness with orphan checks.

## JSON Dependency

Vendor pinned `nlohmann/json` 3.11.3 single header plus LICENSE.MIT and recorded SHA-256 under `native-asr/third_party/`. Configure/build/test never invokes FetchContent or network. T12 owns the reproducible packaging dependency/license inventory; T17 attests the final artifact identity. No second JSON library is added.

## Security And Privacy

- Parse bounded lines, reject NUL/URI/relative path syntax, and never execute request paths.
- stdout contains protocol JSONL only; diagnostics go to stderr.
- Fake text is synthetic and contains no user transcript.
- Tests use temporary paths and synthetic segments; no `.asr-benchmark` media is needed.
- No absolute machine path is serialized into tracked fixtures or docs.

## Compatibility

- Protocol v1 already reserves resolved GPU devices, avoiding a T13/T14 protocol version bump.
- Additive unknown fields are tolerated; behavioral changes, new required fields or event names require explicit protocol review.
- Existing React/Tauri IPC remains unchanged because T04 stops at the worker boundary.

## Rollback

No production caller exists in T04. Removing the new CMake protocol/fake-worker files fully rolls back the task.
