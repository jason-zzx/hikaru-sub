# Large-v2 Native host integration continuation

## Result

The remaining large-v2 implementation blocker is cleared. The packaged v2 worker, exact pinned large-v2 model, and 24,102 ms audio complete through the unchanged Rust Native host contract; the real-worker cancellation path also passes and reaps the process within the existing bound.

No product host lifecycle, event reducer, reap, recovery, fallback persistence, worker, or runtime code change was required in this continuation.

## Exact root cause

The timeout was in the local test invocation contract, not in the Native host.

The existing local PowerShell harness invoked `cargo test` without `--lib` and without an exact fully-qualified test name. That broad invocation built and enumerated an additional Tauri test target with zero matching tests, and its build/startup time was charged to the external command timeout before/during the real-worker gate.

Sanitized measurements on the same current worker/model/audio inputs:

- exact lib-only success test: 32.891 s total; test body 32.13 s; passed;
- old broad two-command harness: 82.328 s total; success body 30.53 s and cancel body 7.06 s; both passed, with extra build/target-enumeration overhead;
- corrected lib-only exact harness: 37.578 s total; success body 28.66 s and cancel body 7.09 s; both passed.

The corrected local harness now uses `cargo test --lib asr_worker::tests::<name> -- --exact --test-threads=1 --nocapture`. This is a test-only invocation correction and does not inflate the host deadline or weaken terminal/recovery assertions.

The real-worker timeout diagnostic in `asr_worker.rs` was also sanitized: it reports only status, duration/processed milliseconds, segment count, error presence, reap/gate state, event kinds, and stderr byte count. It no longer prints snapshots, transcript text, or stderr content.

## Enablement restored

After the exact success/cancel/recovery gate passed:

- restored `faster-whisper/large-v2` in `src-tauri/resources/native-asr-models.json` at immutable revision `f0fe81560cb8b68660e564f55dd99207059c092e`;
- restored the verified four-file closure, MIT attribution, exact sizes, and SHA-256 values;
- removed `faster-whisper/large-v2` from `POST_MVP_MODELS`;
- updated Rust manifest/support assertions for all seven Faster-Whisper models;
- updated frontend availability assertions so large-v2 is independently ready/downloadable rather than deferred;
- kept `large-v3` as the default and introduced no second registry or fallback route.

The large-v2 `model.bin` identity was reused from prior verified evidence. The three small metadata files were rechecked locally against the restored tuple without downloading model data.

## Changed files in this continuation

Tracked:

- `src-tauri/src/asr_worker.rs`
- `src-tauri/resources/native-asr-models.json`
- `src-tauri/src/asr_models.rs`
- `src/hooks/useAsrAvailability.test.tsx`

Local ignored harness:

- `.cache/run-large-v2-host-tests.ps1`

Existing shared working-tree changes from the pre-handoff implementation were preserved.

## Verification

Passed:

- exact large-v2 Rust Native host success test;
- exact large-v2 Rust Native host cancellation/reap test;
- corrected combined local host harness;
- `rustfmt --edition 2021 --check src-tauri/src/asr_worker.rs src-tauri/src/asr_models.rs`;
- focused frozen-manifest identity/closure test;
- focused supported/deferred classification test;
- focused frontend constants/availability tests;
- `cargo test --manifest-path src-tauri/Cargo.toml asr_models`;
- `cargo test --manifest-path src-tauri/Cargo.toml asr_worker`;
- `cargo test --manifest-path src-tauri/Cargo.toml`;
- `pnpm test`;
- `pnpm build` (existing chunk-size advisory only);
- `pnpm asr:runtime:verify` — archive SHA-256 `958eba83b2426a7904296df4d0756b83ec084c646dfec2f48327cf38abf85d75`, 6,860,450 bytes;
- Trellis task validation;
- `git diff --check`;
- `git diff --cached --name-only` returned empty.

## Reused valid evidence

No worker/runtime byte changed in this continuation. The handoff's completed v2 runtime build, Native CTest, seven-model direct smokes, large-v2 601,000 ms smoke, installed/portable smokes, package rebuild/audit, package budgets, and zero-model/forbidden-file audit remain valid and were not repeated.

## Final review correction

The continuation originally reused the earlier v2 package audit after restoring the `large-v2` manifest row. That reuse was incomplete because the packaged application/model resource still had to be rebuilt to embed the seven-row manifest. Final review reran `pnpm release:local` and independently audited the rebuilt outputs:

- NSIS: 11,149,116 bytes; runtime artifact `hikaru-asr-windows-x64-cpu-v2`; worker SHA-256 `ef0b64af86a6cf19bc66a98f3546ad7de1393364b38f88244b5047e063627652`; seven model rows; zero forbidden/model-weight entries.
- Portable ZIP: 15,445,004 bytes; 24 entries; the same v2 runtime/worker identity; all seven immutable model revisions embedded in the application; zero forbidden/model-weight entries.

This correction changes package evidence only. Worker/runtime/model bytes, product host lifecycle, and the exact host test conclusions remain unchanged.

## Remaining blockers and next action

No implementation blocker remains from the large-v2 host integration path. The task stays `in_progress` pending final report/spec synchronization and user-authorized finish work. No commit, stage, archive, or completion transition was performed.
