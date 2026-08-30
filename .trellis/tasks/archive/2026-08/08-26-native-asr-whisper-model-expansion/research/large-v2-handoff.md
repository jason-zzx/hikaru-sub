# Large-v2 continuation handoff

> Historical handoff snapshot. Superseded by `host-integration-continuation.md` and `final-trellis-check-report.md`; the host blocker is cleared and `large-v2` is enabled.

## Current state

The task remains `in_progress`. The previous implementation agent was paused because its context was exhausted. Preserve the current shared working tree, ignored model caches, `.cache/` build roots, and generated packages. Do not reset, stage, commit, archive, or delete caches.

Current product safety state:

- `tiny`, `base`, `small`, `medium`, `large-v3`, and `large-v3-turbo` are manifest-backed.
- `large-v2` is intentionally absent from `src-tauri/resources/native-asr-models.json` and remains in `POST_MVP_MODELS` until the remaining Native host gate passes.
- The frontend still shows `large-v2` but disables it with the existing post-MVP reason.

## Exact root cause already established

Exact `Systran/faster-whisper-large-v2@f0fe81560cb8b68660e564f55dd99207059c092e` produced this sanitized first-window structure for the 24,102 ms input:

- Mel bins: 80
- source window: 24,102 ms
- generated tokens: 224
- timestamp count: 1
- structure: one leading timestamp at offset 0, followed by 223 text tokens
- old parser branch: `timestamps-do-not-form-complete-pair`
- old result: structured `invalid_generation`

This is a generic valid generation shape that lacks a closing timestamp, not a model identity, download, vocabulary, Mel, or smoke-parser error.

Implemented generic fix in `native-asr/src/ctranslate2_whisper.cpp`:

- a sequence with one leading timestamp followed by text uses the source-window end as the segment end;
- no model-name branch;
- no legality error is suppressed for unrelated malformed timestamp shapes;
- history/seek behavior is covered by shared C++ regression tests in `native-asr/tests/ctranslate2_whisper_tests.cpp`.

## Runtime revision already built

A new CPU runtime revision is present in the working tree:

- artifact ID: `hikaru-asr-windows-x64-cpu-v2`
- archive: `native-asr/artifacts/windows-x64-cpu.zip`
- archive size: 6,860,450 bytes
- archive SHA-256: `958eba83b2426a7904296df4d0756b83ec084c646dfec2f48327cf38abf85d75`
- worker SHA-256 in installed/portable layouts: `ef0b64af86a6cf19bc66a98f3546ad7de1393364b38f88244b5047e063627652`
- algorithm identity in the lock: `selected-cpu-timestamp-no-history-beam1-v2`

`native-asr/runtime/windows-x64-cpu-lock.json`, `src-tauri/src/dependencies.rs`, and `scripts/prepare-asr-resource.test.mjs` were updated for v2. Runtime bytes and lock must remain consistent.

## Validation already completed

Passed before pause:

- exact model file verification for all seven Faster-Whisper models;
- final v2 worker short smoke for all seven models:
  - tiny: 24,102 ms, 14 segments, 18 events;
  - base: 24,102 ms, 10 segments, 16 events;
  - small: 24,102 ms, 5 segments, 9 events;
  - medium: 24,102 ms, 5 segments, 9 events;
  - large-v2: 24,102 ms, 1 segment, 5 events;
  - large-v3: 24,102 ms, 5 segments, 9 events;
  - large-v3-turbo: 24,102 ms, 10 segments, 14 events;
- large-v2 direct-worker long smoke: 601,000 ms, 121 segments, 147 events;
- installed-like and portable-like direct-worker large-v2 short and 601,000 ms smokes;
- representative installed/portable tiny short smoke;
- Native CTest: 4/4 passed;
- `pnpm asr:runtime:verify`;
- focused/full Cargo tests, frontend tests, and `pnpm build` at the recorded checkpoint;
- `pnpm release:local`;
- package audit: setup and portable under budget, artifact v2/worker identity equal, model file count 0, forbidden file count 0;
- Trellis task validation;
- `git diff --check` after line-ending normalization;
- no staged files.

The latest package measurements observed before pause were approximately:

- setup: 11,143,329 bytes;
- portable ZIP: 15,444,912 bytes;
- portable entries: 24;
- bundled model files: 0;
- forbidden files: 0.

## Remaining blocker

The existing Rust model-backed host test for exact large-v2 times out even though direct execution of the same packaged worker/model/audio completes in about 32 seconds with ready/segment/progress/completed events.

Observed attempts:

- `production_worker_runs_the_selected_device_through_the_native_host` timed out repeatedly;
- worker process consumed CPU and memory during polling;
- temporary diagnostic edits to `src-tauri/src/asr_worker.rs` were reverted; the file should currently be clean relative to HEAD;
- direct worker smoke still completes normally.

Do not restore the `large-v2` manifest row until this host integration timeout is explained and the unchanged product host contract passes. Do not solve it with a model-name branch, arbitrary timeout inflation, detached process, skipped recovery persistence, or weakened lifecycle assertions.

## Required next action

1. Inspect only the exact real-worker test path and host terminal/reap/persistence flow in `src-tauri/src/asr_worker.rs`; do not scan the whole repository or caches.
2. Reproduce the large-v2 host timeout with bounded diagnostics that record only lifecycle/event kinds, process state, timings, and artifact sizes—never transcript/ASS text or private paths.
3. Determine whether the timeout is test harness I/O, terminal/reap ordering, recovery/fallback persistence, process-tree wait, or another generic host issue.
4. Add the smallest generic regression and root-cause fix if required.
5. Run the exact large-v2 host success/cancel/recovery gate.
6. Only after the host gate passes, restore the exact large-v2 manifest row, remove it from `POST_MVP_MODELS`, update frontend/Rust tests, and rerun affected/full gates.
7. Persist a sanitized implementation report under this task's `research/` directory.

## Current hygiene

- Task status must remain `in_progress`.
- No Git history or remote operations are authorized.
- No files are staged.
- `.trellis/tasks/08-26-native-asr-whisper-model-expansion/research/trellis-check-report.md` is an untracked checkpoint report intentionally preserved.
