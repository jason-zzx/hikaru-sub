# Final Trellis independent review — Native Faster-Whisper model expansion

## Result

**Accepted after one P1 package fix.** No P0/P1 implementation finding remains. The task remains `in_progress` only until separately authorized commit and finish-work archival; no stage, commit, archive, or completion transition was performed.

The combined implementation stays within the requested Windows x64 Native CTranslate2 CPU expansion. It introduces no backend, downloader, command family, frontend registry, Python fallback, GPU route, or unrelated refactor.

## Post-review closure update

- `AGENTS.md`, the owning Trellis specs, root README, runtime dependency guide, release guide, third-party notices, and sidecar boundary README have been synchronized to the seven-model/runtime-v2 production contract.
- The user subsequently confirmed final manual testing passed. This closes the review's only remaining manual-acceptance note without recording private paths, transcript text, or ASS content.
- Automated/package identities below remain unchanged. The only remaining workflow step is user-authorized commit and finish-work archival.

## Finding fixed

### P1 — rebuilt packages did not contain the restored seven-model support boundary

The pre-review NSIS package still embedded a six-row `native-asr-models.json` and omitted `faster-whisper/large-v2`. The continuation report had incorrectly reused package evidence after restoring the large-v2 manifest row.

Fixed by:

- rerunning `pnpm release:local` against the current seven-row source manifest and runtime v2 archive;
- re-extracting and auditing the NSIS package;
- re-auditing the portable tree and ZIP;
- correcting `research/host-integration-continuation.md` so the package-evidence history is current and sanitized.

Rebuilt package identities:

- NSIS: 11,149,116 bytes; SHA-256 `a3c3a4ff26396df8d6dd6226e12f745802e836526b90798bbe034d8ea134f881`.
- Portable ZIP: 15,445,004 bytes; SHA-256 `f534e0c456b3e8c06401d7f098f81d03f50a580a142f1f39f65aa40e758b5421`.
- Both contain runtime artifact `hikaru-asr-windows-x64-cpu-v2` and worker SHA-256 `ef0b64af86a6cf19bc66a98f3546ad7de1393364b38f88244b5047e063627652`.
- NSIS contains all seven model rows; the portable executable contains all seven immutable model revision identities.
- Both package audits found zero model weights and zero Python/sidecar/GPU/VAD/CrispASR/PDB forbidden entries.

## Contract review

### Exact model delivery and isolation

- `src-tauri/resources/native-asr-models.json` contains exactly seven ordinary Faster-Whisper rows: `tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, and `large-v3-turbo`.
- Every row freezes a canonical repository, immutable 40-character revision, MIT attribution/source, and exact four-file role/path/size/SHA-256 closure.
- A targeted local verification independently hashed all 28 required files, including all model weights; every size and SHA-256 matched the current manifest.
- Systran tiny/base/small/medium/large-v2 use `vocabulary.txt`; large-v3 and canonical Dropbox turbo use `vocabulary.json`. No ordinary row includes `preprocessor_config.json`.
- Manifest/parser validation remains the sole support registry. Managed direct/download namespaces are derived from each logical model identity.
- Cross-model readiness and concurrent different-model download/publication tests prove independent paths, job IDs, terminal engine/model/revision identity, and failure isolation.
- The concurrent directory creation fix accepts only `AlreadyExists`, then uses `symlink_metadata` and rejects link/reparse-like or non-directory entries before descending. Existing-path rejection remains unchanged; successful creation is also revalidated.

### Worker compatibility and timestamp fallback

- Model loading remains model-derived: either vocabulary form is accepted, `model->n_mels()` must be exactly 80 or 128, and Kotoba's 128-Mel/preprocessor checks remain conditional on the Kotoba route.
- The single-leading-timestamp fix is generic and contains no model-name branch. It accepts only a sole timestamp at position zero followed by at least one non-EOT text token, bounds the segment end to the source window/audio end, rejects empty/late/malformed variants, and advances exactly the consumed source window.
- Production ordinary Faster-Whisper remains `beam1`, timestamp-seek, and history-off. The C++ core regression covers the legal fallback, bounded timeline, positive seek, malformed non-leading timestamp, EOT-only tail, and out-of-range timestamp cases; existing short decode regression verifies zero retained history and seek-to-WAV-end behavior.
- Native CTest is available through the locked VS18 CMake toolchain and passed 4/4 against the final v2 build directory.

### Native host routing and timeout conclusion

- Native request validation is generic over the `faster-whisper` engine; actual model support/readiness stays authoritative in `NativeAsrModelManager`.
- `start_asr` resolves only the selected exact ready path and packaged CPU worker. Supported-missing, deferred, unsupported, runtime, language, device, and VAD failures return directly; no Native branch enters `ensure_base_url` or falls back to large-v3/Python.
- `large-v3` remains the frontend default and all seven options remain in the existing `ASR_ENGINE_MODELS` registry.
- The host timeout conclusion is valid: no product timeout, monitor, terminal, reap, recovery, fallback ASS, or lifecycle behavior was changed. The only tracked host change sanitizes a test-time timeout panic.
- Exact lib-only invocations passed:
  - success: `cargo test --manifest-path src-tauri/Cargo.toml --lib asr_worker::tests::production_worker_runs_the_selected_device_through_the_native_host -- --exact --test-threads=1 --nocapture` — 33.18 s;
  - cancellation/reap: `cargo test --manifest-path src-tauri/Cargo.toml --lib asr_worker::tests::cancelling_the_real_worker_after_ready_never_publishes_completed -- --exact --test-threads=1 --nocapture` — 8.26 s.
- A separate direct-worker large-v2 short smoke completed in 32.766 s with event kinds `ready/segment/progress/progress/completed`, one legal segment, 24,102 ms duration, exit 0, and zero stderr bytes.
- The process-mode runner initially held a parent PowerShell/output handle open and reported external command timeouts even though the detached exact Cargo child completed. Captured Cargo test results plus an empty targeted process check prove this was runner invocation plumbing, not a hidden Native host deadline/lifecycle weakness.

### Runtime/resource/dependency/package consistency

- Current archive: 6,860,450 bytes; SHA-256 `958eba83b2426a7904296df4d0756b83ec084c646dfec2f48327cf38abf85d75`.
- Lock, ZIP `runtime-manifest.json`, prepared Tauri resource, NSIS payload, portable tree, and portable ZIP agree on artifact v2, candidate `selected-cpu-timestamp-no-history-beam1-v2`, and the final worker identity.
- `src-tauri/src/dependencies.rs` expects artifact v2, and resource preparation tests expect the current archive hash.
- Runtime verification and atomic resource preparation both passed after the package rebuild.

### Diagnostics and evidence hygiene

- The Rust timeout diagnostic reports only status, duration/processed milliseconds, segment count, error presence, reap/gate state, event kinds, and stderr byte count. It does not print snapshots, segment text, stderr content, or paths.
- The one-off C++ timestamp diagnostic recorded only sanitized token structure/counts, offsets, Mel bins, parser branch/status, and error code during diagnosis. It was removed after evidence capture; the focused parser regression remains.
- Task research contains no transcript/ASS text, stderr content, credentials, or private absolute paths. The accidental untracked root `NUL` file found during review was removed.

## Post-acceptance ponytail cleanup

After manual acceptance, the user authorized the reviewed simplifications:

- removed the unreferenced one-off C++ timestamp diagnostic CLI while retaining the formal fallback regression;
- replaced the 265-line manifest tuple mirror with a line-ending-independent canonical JSON SHA-256 lock plus existing semantic/parser tests;
- removed duplicate model enumeration and repeated snapshot assertions from Rust/frontend tests.

Measured reduction: 449 lines. Focused Native CTest, all 24 `asr_models` tests, all 12 `asr` tests, full frontend tests (109 files / 822 tests), task validation, `git diff --check`, and no-staged-files checks passed.

## Release-note inputs

- Supported Native CPU models: `tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, and `large-v3-turbo`; `large-v3` remains the default.
- Approximate exact managed download sizes: 75 MiB, 141 MiB, 464 MiB, 1,460 MiB, 2,947 MiB, 2,948 MiB, and 1,547 MiB respectively.
- No model weights are bundled. Models download independently and one model's failure does not affect another.
- CPU-only; CUDA/Vulkan, Native VAD, Kotoba, Qwen3, Parakeet, and ReazonSpeech remain unavailable without Python fallback.
- Relative speed/quality and Python comparisons remain diagnostic; functional output legality is the support gate.
- Do not add these notes to the already released `0.4.1` changelog entry. Copy them into the exact future version entry when `package.json` is separately versioned for release.

## Verification

Passed:

- all 28 exact local model file size/SHA-256 checks;
- Native CTest 4/4;
- focused exact large-v2 host success and cancellation/reap tests;
- direct large-v2 worker short smoke;
- `cargo test --manifest-path src-tauri/Cargo.toml asr_models`;
- `cargo test --manifest-path src-tauri/Cargo.toml asr_worker`;
- `cargo test --manifest-path src-tauri/Cargo.toml`;
- focused frontend/resource tests;
- full `pnpm test`;
- `pnpm build` (existing Vite chunk-size advisory only);
- targeted Rust `rustfmt --check`;
- `pnpm asr:runtime:verify`;
- `pnpm asr:prepare-resource`;
- `pnpm release:local`;
- rebuilt NSIS/portable closed-package audits and budgets;
- Trellis task validation;
- `git diff --check`;
- no staged files.

One optional online requery attempt timed out while following a Hugging Face file redirect. It did not modify product/model data and was superseded by the complete local 28-file size/SHA-256 verification. No model download was repeated.

## Acceptance status and residual risks

- **Implementation/package acceptance:** passed; no P0/P1 remains.
- **Documentation/spec acceptance:** passed; current product docs and owning specs describe the seven-model/runtime-v2 boundary.
- **Manual acceptance:** passed by explicit user confirmation after this independent review.
- **Task state:** intentionally still `in_progress` pending separately authorized commit and finish-work archival.

## Exact next action

Current implementation, package, documentation, and manual acceptance gates are complete. Keep the task `in_progress` until the user separately authorizes commit and finish-work archival.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The combined diff is limited to the seven-model manifest expansion, generic Native routing, one shared timestamp fallback, runtime v2 identity, isolation/race hardening, tests, and sanitized task evidence. The only review fix rebuilt stale generated packages and corrected their evidence."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Independent evidence includes 28 exact model hashes, CTest 4/4, exact real host success/cancel results, direct worker smoke, focused/full Rust and frontend gates, runtime/resource/package closure audits, task validation, diff check, and no staged files."
    }
  ],
  "changedFiles": [
    ".trellis/tasks/08-26-native-asr-whisper-model-expansion/check.jsonl",
    ".trellis/tasks/08-26-native-asr-whisper-model-expansion/implement.jsonl",
    ".trellis/tasks/08-26-native-asr-whisper-model-expansion/implement.md",
    ".trellis/tasks/08-26-native-asr-whisper-model-expansion/prd.md",
    ".trellis/tasks/08-26-native-asr-whisper-model-expansion/research/planning-evidence.md",
    ".trellis/tasks/08-26-native-asr-whisper-model-expansion/research/host-integration-continuation.md",
    ".trellis/tasks/08-26-native-asr-whisper-model-expansion/research/large-v2-handoff.md",
    ".trellis/tasks/08-26-native-asr-whisper-model-expansion/research/trellis-check-report.md",
    ".trellis/tasks/08-26-native-asr-whisper-model-expansion/task.json",
    "native-asr/artifacts/windows-x64-cpu.zip",
    "native-asr/runtime/windows-x64-cpu-lock.json",
    "native-asr/src/ctranslate2_whisper.cpp",
    "native-asr/tests/ctranslate2_whisper_tests.cpp",
    "scripts/prepare-asr-resource.test.mjs",
    "src-tauri/resources/native-asr-models.json",
    "src-tauri/src/asr.rs",
    "src-tauri/src/asr_models.rs",
    "src-tauri/src/asr_worker.rs",
    "src-tauri/src/dependencies.rs",
    "src/constants/asr.test.ts",
    "src/hooks/useAsrAvailability.test.tsx"
  ],
  "testsAddedOrUpdated": [
    "native-asr/tests/ctranslate2_whisper_tests.cpp",
    "scripts/prepare-asr-resource.test.mjs",
    "src-tauri/src/asr.rs tests",
    "src-tauri/src/asr_models.rs tests",
    "src-tauri/src/asr_worker.rs real-worker diagnostic path",
    "src/constants/asr.test.ts",
    "src/hooks/useAsrAvailability.test.tsx"
  ],
  "commandsRun": [
    {
      "command": "python .cache/final-review/verify_local_models.py",
      "result": "passed",
      "summary": "All seven immutable revisions and all 28 required files matched exact size and SHA-256."
    },
    {
      "command": "VS18 ctest --test-dir .cache/native-asr-runtime/large-v2-final-a/build/native-asr --output-on-failure",
      "result": "passed",
      "summary": "Native CTest 4/4 passed."
    },
    {
      "command": "cargo test --manifest-path src-tauri/Cargo.toml --lib asr_worker::tests::production_worker_runs_the_selected_device_through_the_native_host -- --exact --test-threads=1 --nocapture",
      "result": "passed",
      "summary": "Exact large-v2 Native host success completed in 33.18 s."
    },
    {
      "command": "cargo test --manifest-path src-tauri/Cargo.toml --lib asr_worker::tests::cancelling_the_real_worker_after_ready_never_publishes_completed -- --exact --test-threads=1 --nocapture",
      "result": "passed",
      "summary": "Exact real-worker cancel/reap gate completed in 8.26 s."
    },
    {
      "command": "python .cache/final-review/direct_worker_smoke.py",
      "result": "passed",
      "summary": "Large-v2 direct worker completed in 32.766 s with legal completion, one segment, exit 0, and zero stderr bytes."
    },
    {
      "command": "cargo test --manifest-path src-tauri/Cargo.toml asr_models",
      "result": "passed",
      "summary": "Focused model manifest/readiness/download/publication/isolation suite passed."
    },
    {
      "command": "cargo test --manifest-path src-tauri/Cargo.toml asr_worker",
      "result": "passed",
      "summary": "Focused Native host suite passed."
    },
    {
      "command": "cargo test --manifest-path src-tauri/Cargo.toml",
      "result": "passed",
      "summary": "Full Rust/Tauri suite passed."
    },
    {
      "command": "pnpm test",
      "result": "passed",
      "summary": "Full frontend/script test suite passed."
    },
    {
      "command": "pnpm build",
      "result": "passed",
      "summary": "TypeScript/Vite build passed with the existing chunk-size advisory only."
    },
    {
      "command": "rustfmt --edition 2021 --check src-tauri/src/asr.rs src-tauri/src/asr_models.rs src-tauri/src/asr_worker.rs src-tauri/src/dependencies.rs",
      "result": "passed",
      "summary": "All touched Rust files passed targeted formatting."
    },
    {
      "command": "pnpm asr:runtime:verify && pnpm asr:prepare-resource",
      "result": "passed",
      "summary": "Archive v2 and the atomically prepared Tauri resource matched SHA-256 958eba83... and size 6,860,450."
    },
    {
      "command": "pnpm release:local",
      "result": "passed",
      "summary": "Rebuilt current NSIS and portable packages after detecting the stale six-row package."
    },
    {
      "command": "7-Zip/Python NSIS and portable package identity audit",
      "result": "passed",
      "summary": "Seven model identities, runtime v2, final worker hash, size budgets, zero model weights, and zero forbidden entries verified."
    },
    {
      "command": "python ./.trellis/scripts/task.py validate 08-26-native-asr-whisper-model-expansion",
      "result": "passed",
      "summary": "Both context manifests validated with 10 curated entries."
    },
    {
      "command": "git diff --check && git diff --cached --name-only",
      "result": "passed",
      "summary": "Diff check passed and the staged-file list was empty."
    },
    {
      "command": "python .cache/final-review/verify_models.py",
      "result": "failed",
      "summary": "Optional Hugging Face online requery timed out on a file redirect; superseded by complete local exact hashing without downloads."
    }
  ],
  "validationOutput": [
    "Runtime archive: 6,860,450 bytes, SHA-256 958eba83b2426a7904296df4d0756b83ec084c646dfec2f48327cf38abf85d75.",
    "Worker: SHA-256 ef0b64af86a6cf19bc66a98f3546ad7de1393364b38f88244b5047e063627652 across archive/resource/NSIS/portable.",
    "Models: seven immutable rows, 28/28 exact required file tuples verified.",
    "Packages: NSIS 11,149,116 bytes; portable ZIP 15,445,004 bytes; zero forbidden/model-weight entries.",
    "No staged files; task remains in_progress."
  ],
  "residualRisks": [],
  "noStagedFiles": true,
  "diffSummary": "Seven exact Faster-Whisper manifest rows, generic Native CPU preflight/routing, isolated model delivery and concurrent directory handling, generic single-leading-timestamp fallback with runtime v2 rebuild, sanitized diagnostics, and focused/full regressions.",
  "reviewFindings": [
    "fixed P1: stale NSIS/package application embedded only six model rows after large-v2 was restored; rebuilt and re-audited current NSIS/portable packages.",
    "no remaining blockers"
  ],
  "manualNotes": "Specs and current product docs were synchronized after review, and the user confirmed final manual testing passed. Task remains in_progress only pending separately authorized commit/finish work."
}
```
