# Native ASR Worker Protocol v1 实施计划

> 状态：`planning`。T01～T03 已归档；T04 是 Gate 1 的第一个任务，完成并评审前不得启动 T05。

## Dependencies

- Parent fixed engine/backend routes and stable product IPC.
- Archived T02 source/model timestamp and legal-evidence handoff.
- Archived T03 callback/cancellation handoff: current CrispASR pin has no cooperative cancellation contract.
- Pinned C++17 toolchain and nlohmann/json 3.11.3 source/hash/license must be lockable.

## Execution Checklist

### 1. Freeze Protocol Contract

- [ ] Write `native-asr/docs/protocol-v1.md` with request schema, pre-ready validation errors, ready duration, route/model-role matrix, event schemas, lifecycle, exit matrix and compatibility policy.
- [ ] Create canonical `native-asr/protocol-v1-limits.json`; generate/validate C++ constants from it and document why values cover the authoritative long case.
- [ ] Confirm `device` accepts resolved `cpu|cuda|vulkan` and rejects `auto`.

### 2. Create Minimal Native Project

- [ ] Add one `native-asr/` CMake/CMakePresets project using C++17 and vendored pinned nlohmann/json 3.11.3 single header + LICENSE/hash; no FetchContent/network.
- [ ] Add plain protocol enums/structs/parser/serializer/validation; no backend abstraction or model code.
- [ ] Keep build/dependency outputs ignored and record dependency license/provenance.

### 3. Implement Request And Event Validation

- [ ] Cover fixed engine/backend/model-role combinations, absolute local paths, language/device/VAD values and additive-field compatibility.
- [ ] Cover pre-ready structured errors, ready exact duration, legal segment-before-progress, duration equality/drift, progress monotonicity, legal segments, atomic replacement and terminal exact-once semantics.
- [ ] Reject malformed/oversized/version/unknown/late-event cases before unsafe allocation or downstream use.

### 4. Implement Deterministic Fake Worker

- [ ] Add the reviewed scenario matrix without extending production request fields.
- [ ] Use the same executable for child-process hang scenarios.
- [ ] Keep stdout pure JSONL, stderr deterministic/bounded test diagnostics and scenario exit codes documented.
- [ ] Assert terminating scenario output/exit is stable; hang scenarios expose stable prefix and fixed-timeout orphan-free termination.

### 5. Add CTest Coverage

- [ ] Request good/base/bad cases for all five routes including Qwen companion requirements.
- [ ] Event serialization/parse round trips, pre-ready/runtime errors, segment-before-progress, duration drift and all invalid transitions.
- [ ] Resource-limit boundaries at max and max+1, plus canonical JSON/generated C++ consistency.
- [ ] Fake success/error/crash/incomplete/hang/child/stderr scenarios.
- [ ] Test executable discovery contract that T05 can consume without checking in binaries.

### 6. Publish T05 Handoff

- [ ] Record exact CMake configure/build/CTest commands and fake executable path contract.
- [ ] List host classifications T05 must implement without putting Rust behavior into the C++ library.
- [ ] Update T05 context manifests to the final/archived T04 handoff before T05 start.

## Planned Files

```text
native-asr/CMakeLists.txt
native-asr/CMakePresets.json
native-asr/docs/protocol-v1.md
native-asr/protocol-v1-limits.json
native-asr/include/hikaru_asr/protocol.hpp
native-asr/src/protocol.cpp
native-asr/src/fake_worker.cpp
native-asr/tests/protocol_tests.cpp
native-asr/third_party/nlohmann/json.hpp
native-asr/third_party/nlohmann/LICENSE.MIT
```

Only add another small fixture/source file if CTest cannot express a required deterministic scenario with the listed executable.

## Validation

Exact preset names are fixed in implementation, with equivalent commands to:

```powershell
cmake -S native-asr -B native-asr/build/windows-x64-protocol -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build native-asr/build/windows-x64-protocol --config Release
ctest --test-dir native-asr/build/windows-x64-protocol -C Release --output-on-failure
python ./.trellis/scripts/task.py validate .trellis/tasks/08-02-native-asr-worker-protocol
git diff --check
```

Required negative checks:

```text
No Python executable or model/cache access
No network during configure/build/tests; vendored dependency hash/license verified
No production Tauri/React/Python diff
No tracked build output, binary, private corpus, raw transcript or absolute user path
```

## Review Gates

Before `task.py start`:

- [ ] User reviews PRD/design/implement and protocol boundary.
- [ ] `implement.jsonl` and `check.jsonl` contain real context.
- [ ] Task and parent validate; vendored dependency pin/hash/license is reviewed.

Before completion:

- [ ] Release build and full CTest pass from a clean build directory.
- [ ] Independent check confirms bounds, lifecycle/exit semantics and fake process-tree scenarios.
- [ ] T05 handoff is complete without product host/model code escaping scope.

## Stop Conditions

- Protocol cannot represent Qwen model+aligner or resolved CPU/CUDA/Vulkan without backend-specific hacks.
- Fake worker cannot deterministically reproduce cancellation/crash/process-tree cases.
- JSON dependency provenance/license or line-bound enforcement remains unresolved.

Revise T04 rather than letting T05 define a second implicit protocol.

## Rollback

Delete T04 `native-asr/` additions and ignored build output. Existing product paths remain unchanged.
