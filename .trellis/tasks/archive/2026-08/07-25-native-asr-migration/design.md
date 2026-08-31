# 原生 ASR 迁移总体设计

## Summary

首个 Native ASR 版本采用最小可发布架构：独立 native worker + Rust job host + bundled CTranslate2 CPU runtime + 受管 large-v3 模型。React/Tauri 产品合同保持稳定，生产包移除 Python 运行时依赖。

迁移分为两个阶段：

1. **Native MVP**：只发布 `faster-whisper / large-v3 / CPU`。
2. **Post-MVP expansion**：七个 Faster-Whisper CPU 模型已完成；下一步复用 accepted Kotoba K2 接入 exact 模型交付、同一 bundled CPU runtime、Tauri 路由和 React UX。Kotoba 字幕质量修订不属于本父任务。

历史质量 evidence 保留，但 Python parity、双 Whisper anchor 和 GPU qualification 不再控制 MVP 发布。

## Architecture

```text
React
  TranscribeView / model UI / runtime settings
        |
        | typed Tauri invoke
        v
Tauri Rust
  AsrState / model manager / runtime manager
  - one active job
  - worker lifecycle and process-tree cancellation
  - JSONL -> AsrJobSnapshot
  - model download/hash/atomic install
  - installed/portable paths and recovery
        |
        | one JSON request on stdin
        | JSONL events on stdout
        v
hikaru-asr-worker.exe
  - CTranslate2 CPU backend
  - faster-whisper / large-v3 only for MVP
  - inference, timestamps and minimal normalization
```

Python legacy remains source-level development evidence for one stable release cycle, but is not part of the packaged production architecture after T18.

## MVP Route

| Engine | Model | Backend | Device | MVP status |
|---|---|---|---|---|
| `faster-whisper` | `large-v3` | CTranslate2 | bundled CPU | available/default after T18 |
| all others | existing IDs | existing planned backends | none for MVP | visible/unavailable |

The route uses the frozen Candidate A worker/algorithm seam. Its historical subtitle-quality disposition remains `stop-revise`; the new release policy records a separate `mvp-eligible-with-known-quality-limitations` disposition.

## Stable Boundaries

### React

- Keep engine/model presentation, task polling, progress and ASS generation.
- Consume typed wrappers from `src/services/tauri.ts`.
- Show large-v3 as Native available only when runtime and model readiness agree.
- Keep every other existing model visible with an explicit post-MVP/unavailable state.
- Never silently route unavailable models to Python.

### Tauri Rust

- Own the single-active-job invariant and stable command surface.
- Resolve and validate audio/model/runtime paths before spawning the worker.
- Reduce protocol events into the existing snapshot.
- Own process-tree cancellation, abnormal-exit handling, recovery snapshots and app-exit cleanup.
- Own large-v3 model download, checksum validation, atomic readiness and storage cleanup.
- Keep probe, measure and cleanup separated and preserve portable path rules.

### Native Worker

- Read only Tauri-approved local paths.
- Perform large-v3 CTranslate2 CPU inference and emit legal `AsrSegment` results.
- Emit only protocol JSONL on stdout; write bounded diagnostics to stderr.
- Never download models, persist app settings or generate styled ASS.

## Protocol And Segment Contracts

The existing command names, `AsrJobSnapshot` and state flow remain unchanged:

```text
pending -> running -> completed | failed | cancelled
```

Required protocol events remain `ready`, `progress`, `segment`, `segmentsReplace`, `completed` and `error`.

MVP segment acceptance is deliberately functional rather than parity-based:

- valid UTF-8;
- non-empty final text;
- `0 <= startMs < endMs <= audioDurationMs`;
- nondecreasing timeline;
- no protocol or text-conservation violation.

CER, S/D/I, semantic gaps and comparison with Python legacy are retained as diagnostics. They block only when they expose a functional failure such as empty/corrupt output or inability to complete representative long audio.

## Candidate A Policy Boundary

```text
archived evidence
  historicalQualityDisposition = stop-revise

release-first parent policy
  mvpDisposition = mvp-eligible-with-known-quality-limitations
```

No archived report changes. No new Candidate A identity is invented. T13 must bind the final runtime to the same accepted worker/algorithm/model inputs or explicitly record any identity change and rerun the minimum functional smoke.

## Model Delivery

MVP manifest scope starts with one logical model:

```text
faster-whisper / large-v3
  -> exact CT2 revision and required files
  -> official + China source mapping
  -> size + SHA-256 + license + attribution
  -> atomic readiness marker
```

The manifest format remains multi-entry so post-MVP models can be added without a second downloader design. `08-26-native-asr-whisper-model-expansion` has added exact entries for `tiny`, `base`, `small`, `medium`, `large-v2` and `large-v3-turbo`. The next extension adds the exact Kotoba repository/revision/file identities plus its Kotoba-only non-empty `preprocessor_config.json` readiness contract while preserving the existing seven Faster-Whisper entries.

Valid existing CT2 snapshots may be reused after exact readiness validation. New writes remain under managed `deps/models/ctranslate2`; `.part` files remain under `deps/downloads`.

## CPU Runtime Package

T13 owns the final MVP artifact:

```text
native-asr/windows-x64/cpu/
├─ hikaru-asr-worker.exe
├─ required CTranslate2/oneDNN/runtime DLLs
├─ runtime-manifest.json
└─ licenses/
```

The artifact contains no models, CrispASR backend, CUDA/Vulkan runtime or rejected ORT/VAD candidate. Any shared DLL included in the artifact must be an explicit CTranslate2 MVP runtime dependency, not an optional-engine exception.

T13 freezes toolchain, source/dependency versions, component hashes and licenses. T18 verifies and consumes this artifact; it does not rebuild it around post-MVP engine inputs.

## Runtime And Settings

```text
T12 model manager + T13 CPU artifact
                |
                v
T16 runtime/settings backend
```

T16 removes production Python/venv probing and exposes:

- built-in CPU runtime status;
- large-v3 model readiness/download state;
- unavailable metadata for all non-MVP models;
- downloads and app-cache storage.

Installed/portable path resolution and probe/measure/cleanup behavior remain unchanged in principle. Recursive filesystem work stays off async workers through `spawn_blocking`.

## Frontend UX

T17 preserves the current transcription flow and changes only runtime/model availability presentation:

- CPU runtime is built in.
- large-v3 is available after model readiness.
- all other models remain visible and disabled with a concise “后续支持” explanation.
- Python, venv, pip and ASR service setup copy is removed from production UI.
- no raw invoke or duplicate state source is introduced.

## Release Flow

```text
T12 + T13
   -> T16
   -> T17
   -> T18
```

T12 and T13 may run in parallel. T16 starts when their contracts stabilize. T17 follows T16. T18 performs final installed/portable integration, short + >10-minute functional smoke, packaging checks, notices/spec updates and production cutover.

T14/T15 GPU work is explicitly post-MVP and not a dependency of T16/T17/T18. The P1 Faster-Whisper model expansion is complete. The next parent child is Native Kotoba K2 production integration on the existing CPU architecture; Kotoba quality revision is excluded. Qwen/Parakeet/Reazon and GPU work remain independent later lanes.

## Security And Privacy

- Treat audio/model paths, filenames, URLs and worker output as untrusted at their boundaries.
- Canonicalize and constrain managed writes/cleanup under approved roots.
- Use structured process arguments and JSON; never interpolate user paths into shell commands.
- Bound protocol lines/events/segment counts.
- Verify every model/runtime artifact before readiness or load.
- Do not record subtitle text, secrets or sensitive request bodies in logs or tracked evidence.

These requirements remain release blockers regardless of the reduced subtitle-quality priority.

## Rollout And Rollback

1. T18 enabled large-v3 CPU Native routing and removed packaged Python dependencies.
2. The completed Faster-Whisper expansion enabled `tiny/base/small/medium/large-v2/large-v3-turbo` on the same CT2 CPU architecture.
3. The next rollout enables `kotoba-faster-whisper` with its exact manifest model and accepted K2 profile in the same bundled CPU worker; large-v3 remains the default.
4. Kotoba quality revision remains outside this parent and does not block route enablement.
5. Python remains source-level development/rollback evidence only and is not restored as a silent fallback.
6. A patch rollback can disable the Kotoba route or restore prior package inputs without deleting user models, settings, projects or subtitles.
7. Later engine/GPU routes are enabled independently; their failures cannot revoke any released Faster-Whisper route.

## Test Strategy

- Fake-worker/Rust tests retain lifecycle, malformed protocol, crash, cancel and recovery coverage.
- T12 tests cover source routing, resume/hash/atomic install, readiness, legacy cache and cleanup containment.
- T13 CTest/package checks cover protocol/backend load, artifact manifest, missing/wrong DLL, installed/portable paths and cached large-v3 smoke.
- T16 Rust tests cover settings migration, runtime/model availability, probe/measure/cleanup and portable paths.
- T17 frontend tests cover visible availability states, removal of Python setup and preserved transcription flow.
- T18 runs full frontend/Rust/worker tests plus short and >10-minute end-to-end functional smoke.
- Historical CER/S/D/I/gap metrics remain publishable diagnostics but are not MVP parity gates.

## Design Decisions

- **D1:** One released model beats five unfinished model lanes.
- **D2:** CPU-only MVP avoids optional GPU pack/build/driver work before first release.
- **D3:** Candidate A is reused under a new release policy; historical evidence remains immutable.
- **D4:** Safety, functional legality and product contracts remain hard gates; only subtitle-quality parity is relaxed.
- **D5:** T13 owns the final MVP runtime artifact; T18 integrates rather than rebuilds it.
- **D6:** All existing model IDs remain visible, but only large-v3 is runnable in the MVP.
- **D7:** Post-MVP quality and GPU work is independent and cannot block or revoke the MVP.
- **D8:** The six-model Faster-Whisper expansion is complete; accepted Kotoba K2 production integration is the next P1 increment, while Kotoba quality revision is excluded and Qwen3/Parakeet/ReazonSpeech/GPU packs remain independent later work.
