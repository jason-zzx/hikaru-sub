# T18 Native ASR release-cutover implementation plan

> Status: accepted. Automated release gates and final installed/portable manual acceptance passed; archive during finish-work. Do not change the application version, add a version-specific changelog entry, tag, push, publish, merge, rebase, reset, or delete user data.

## Step 0 - Confirm frozen handoffs and load coding specs

- Re-read T12/T13/T16/T17 final artifacts and `research/release-cutover-audit.md`.
- Verify the tracked runtime archive and lock still match the T13 handoff identity.
- Verify `src-tauri/resources/native-asr-models.json` still contains only the exact T12 large-v3 production entry.
- Confirm the working tree contains no concurrent runtime/model identity change.
- Load `trellis-before-dev` for Tauri/package/docs work before editing.

Commands:

```bash
pnpm asr:runtime:verify
git status --short
git diff -- native-asr src-tauri/resources/native-asr-models.json
```

Stop and return to planning if runtime/model bytes or identities drifted. T18 must not rebuild or silently requalify a different artifact.

Rollback: none; evidence gate only.

## Step 1 - Add focused failing cutover and packaging tests

### Route-policy test

Update the focused `src-tauri/src/asr.rs` tests to prove:

- default product policy is always `NativeMvp`;
- debug fake-host presence is a host injection detail, not the route selector;
- explicit `Legacy` still exists only as rollback/test evidence;
- the complete stable command family continues using the same policy;
- Native preflight/progress/cancel failures never contact the sidecar.

Do not create a configurable policy framework.

### Resource-preparation test

Add the smallest runnable test around `scripts/prepare-asr-resource.mjs` that:

- creates a stale `src-tauri/resources/asr-service` fixture;
- runs the preparation function against a temporary root or focused fixture;
- proves the stale legacy directory is removed;
- proves the verified Native runtime target is prepared.

Refactor the script only enough to export one testable function while preserving CLI behavior. Do not create a generic resource pipeline.

### Portable staging test

Update `tests/PortablePackage.test.ts` so its fixture deliberately contains stale source/release `asr-service` directories but expects:

- no `asr-service` in the portable stage;
- verified `native-asr` remains present;
- `runtime-dependency-sources.json`, executable, and `.portable` remain present;
- `deps/`, caches, PDBs, build directories, and stale release resources remain absent.

Focused commands:

```bash
pnpm test -- tests/PortablePackage.test.ts
cargo test --manifest-path src-tauri/Cargo.toml one_route_policy_controls_the_complete_backend_family
```

Use the actual resource-preparation test filename added during implementation.

Rollback: remove only the new assertions/refactor; no product data changes.

## Step 2 - Switch the single production route default

In `src-tauri/src/asr.rs`:

- make the default immutable route policy `NativeMvp` for normal debug and Release application state;
- keep fake-worker lookup only for injecting a test host;
- preserve the existing Native command branches and direct error returns;
- retain legacy enum/source only for rollback evidence;
- update comments that still say production/default is legacy until T18.

Do not change command names, request/response types, settings, model selection, worker launch contract, reducer, recovery, or frontend code unless a compile/test failure exposes a real stale boundary.

Focused checks:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr::tests
cargo test --manifest-path src-tauri/Cargo.toml asr_worker::tests
```

Verify explicitly:

- large-v3 CPU/auto reaches Native host;
- unsupported engine/model/device/language/VAD fails before launch;
- missing/corrupt runtime/model returns a controlled error and releases the active slot;
- progress/cancel unknown job does not enter legacy HTTP code;
- cancel/crash/recovery/active-gate behavior remains unchanged.

Rollback: restore only the route default; no model/user data is touched.

## Step 3 - Remove Python sidecar from release resources

### Preparation script

Simplify `scripts/prepare-asr-resource.mjs`:

- delete the generated `src-tauri/resources/asr-service` target with recursive force;
- remove obsolete Python copy/filter logic and unused imports;
- keep runtime lock loading and verified Native extraction unchanged;
- keep `pnpm asr:prepare-resource` as the stable release/CI entry point.

### Tracked resource tree

Delete the tracked `src-tauri/resources/asr-service/` tree after the script/test proves it is no longer required. Do not delete repo-root `asr-service/`.

### Portable package

Update `scripts/package-portable.mjs`:

- stop resolving/requiring `resourceDir/asr-service`;
- remove it from the explicit staging list;
- preserve Native runtime re-verification before staging.

Do not alter `runtime-dependency-sources.json`, model manifest identities, `.portable`, app paths, or unrelated resources.

Focused checks:

```bash
pnpm asr:prepare-resource
pnpm test -- tests/PortablePackage.test.ts tests/WindowsBundleConfig.test.ts
pnpm asr:runtime:verify
```

Repository/package searches:

```bash
rg -n "resources/asr-service|\[asrResource, \"asr-service\"\]|missing ASR resource directory" scripts tests package.json .github src-tauri/tauri.conf.json
find src-tauri/resources -maxdepth 1 -type d -name asr-service
```

Expected: no production packaging caller or generated legacy resource remains. Repo-root historical/development references may remain intentionally.

Rollback: restore the resource copy/staging files only if reverting to the previous legacy release; never delete user `deps/asr-service` or model data as part of source rollback.

## Step 4 - Run cross-layer regression gates before packaging

Run and fix all failures:

```bash
pnpm asr:runtime:verify
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

Also run the final Native worker CMake/CTest/package checks from the T13 handoff using the frozen build/runtime inputs. Rebuilding the final archive is not required when no runtime byte changed; verifier and CTest/package checks must use the frozen artifact identity.

Review the complete flow:

```text
T17 availability gate
  -> stable tauri.ts wrappers
  -> stable Tauri ASR commands
  -> default NativeMvp policy
  -> T12 exact model
  -> T13 packaged host
  -> existing progress/cancel/recovery/ASS pipeline
```

Search for accidental fallback or split routing:

```bash
rg -n "route_policy|ensure_base_url|start_asr|check_asr_model|download_asr_model|get_model_download_progress" src-tauri/src/asr.rs
```

Stop if any Native failure can reach `ensure_base_url` or if one command family remains legacy.

## Step 5 - Build and audit release artifacts

Run the actual local release path:

```bash
pnpm release:local
```

Audit NSIS and portable outputs:

- record package relative path, size, and SHA-256;
- verify both contain the same T13 runtime manifest/artifact identity;
- verify neither contains `asr-service`, Python executable/library, venv, Python package tree, model weights, PDB, optional GPU/VAD/CrispASR runtime, cache, or staged `deps/`;
- verify portable contains `.portable`, `runtime-dependency-sources.json`, executable, and Native runtime;
- verify setup `<= 80 MiB`, portable ZIP `<= 90 MiB`, unpacked runtime `<= 250 MiB`, bundled model count `= 0`;
- compare actual runtime payload/license files with the frozen verifier inventory.

Write sanitized results to:

`.trellis/tasks/08-28-native-asr-release-cutover/research/release-qualification-evidence.json`

The evidence may contain hashes, sizes, counts, relative identities, tool versions, and pass/fail states. It must not contain transcript/ASS text, model bytes, credentials, or private absolute paths.

Rollback: delete only generated package outputs/evidence if invalid; do not mutate user data or the frozen runtime/model artifacts.

## Step 6 - Rerun model-backed installed/portable qualification

Use the exact cached T12 large-v3 revision and unchanged final worker SHA.

For both installed-like and portable-like package layouts:

1. run `scripts/smoke-native-asr-runtime.mjs` with `.asr-benchmark/short.wav`;
2. run it with an input longer than 10 minutes from `.asr-benchmark/long.wav`;
3. record duration, event count, segment count, input hash, model identity, worker hash, layout role, and result;
4. verify UTF-8 JSONL-only output, non-empty ordered positive-duration audio-bounded segments, monotonic progress, and completed duration;
5. rerun packaged-host cancel `<=2s`, crash/recovery, active-slot release, unsupported-route, and missing-job checks using the existing T13/T16 test seams.

Then perform the smallest product-level smoke on extracted portable and installed application builds:

- start without configured/system Python;
- confirm Native runtime/model availability;
- run cached large-v3 CPU transcription and verify progress/output creation;
- cancel one run and confirm UI/job recovery;
- confirm no Python/sidecar process or packaged sidecar resource is used;
- verify offline cached-model transcription causes no model/Python network access.

Append only sanitized results to `research/release-qualification-evidence.json`.

Any missing local model/audio/package/platform capability is a release blocker for T18, not an accepted skipped check. Do not mark the task complete until the required matrix runs.

## Step 7 - Update product, agent, and Trellis documentation

After verified behavior exists, update the smallest authoritative set:

- `README.md`;
- `docs/release.md`;
- `docs/runtime-dependencies.md`;
- `THIRD_PARTY_NOTICES.md`;
- `asr-service/README.md` only to mark its development/legacy role;
- `AGENTS.md`;
- `.trellis/spec/tauri/media-ffmpeg-asr.md`;
- `.trellis/spec/frontend/type-safety.md` transitional wording;
- `.trellis/spec/asr/index.md` or the smallest owning ASR guide.

Required documentation state:

- production ASR is Native `faster-whisper / large-v3 / CPU` through an independent worker;
- Native runtime is bundled/status-only; model weights remain on-demand under managed `deps/models`;
- release packages contain no Python sidecar/runtime/venv/packages or model weights;
- Python sidecar source is development/historical rollback evidence for one stable cycle;
- only large-v3 is runnable; six-model expansion and all other engines/GPU/VAD remain deferred;
- no version or version-specific changelog update is included.

Do not rewrite archived quality evidence or claim unsupported engines are released.

## Step 8 - Final validation and independent review

Run the complete gate again after documentation/spec changes:

```bash
pnpm asr:runtime:verify
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm release:local
python ./.trellis/scripts/task.py validate 08-28-native-asr-release-cutover
git diff --check
git status --short
```

Re-audit the final rebuilt NSIS/portable hashes, sizes, forbidden content, runtime identity, license inventory, and model count. Update evidence if package hashes changed because documentation/resource inputs changed.

Dispatch `trellis-check` with the active task context and require review of:

- PRD/acceptance-criteria coverage;
- one-policy Native routing and no fallback;
- stale-resource removal and package closure;
- installed/portable/offline model qualification;
- cancel/crash/recovery/active-gate behavior;
- size/license/privacy gates;
- documentation/spec accuracy;
- no version/changelog/commit/tag/push scope creep.

Fix every P0/P1 issue and rerun affected/full gates.

## Step 9 - Fix manual-smoke detection, progress, and cancel regressions

Add red-capable focused tests before the fixes:

- Rust model-manager test: first exact ready lookup verifies the fixture, then a second lookup through the same manager reuses the successful process-lifetime resolution; a new manager still performs fresh verification. Missing results are not cached, and a successful managed download seeds/refreshes the ready cache.
- Transcribe component test: hold `startAsr` pending, assert an indeterminate startup progress is visible, click cancel before jobId exists, assert `取消中…` and exactly `已取消转录`, then resolve jobId and assert backend cancel runs without the document-change message or `检测模型…` regression.

Implement minimally:

- cache only exact successful ready resolutions inside `NativeAsrModelManager`; reuse them across `status`/start preflight and seed after verified download publication;
- keep protocol/worker inference unchanged;
- render indeterminate startup/first-window progress until real `processedMs` advances;
- separate user-cancel state from document guard/unmount, keep duplicate starts locked while cancellation waits for jobId, and use the exact cancellation copy requested by the user.

Focused validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests
pnpm test -- src/components/workflow/TranscribeView.test.tsx src/hooks/useAsrAvailability.test.tsx tests/ModelManagerTranscribeGate.test.tsx
pnpm build
```

Then rerun full `pnpm test`, full Cargo tests, `git diff --check`, task validation, and independent review. Because runtime/model/packaging bytes do not change, do not rerun the >10-minute worker matrix unless review finds identity drift.

## Completion gate

- Production/default stable ASR commands use Native large-v3 CPU with no Python fallback.
- NSIS and portable ship the exact verified Native runtime and no Python sidecar/runtime/venv/packages or model weights.
- Installed-like and portable-like short + >10-minute smoke, cancel/crash/recovery/active-gate, package content/size/license, frontend, build, Rust, worker, release-local, task validation, diff and independent review gates all pass.
- Product/agent/Trellis docs describe the post-cutover architecture accurately.
- Application version and version-specific changelog are unchanged.
- No commit, tag, push, publish, merge, rebase, reset, archive, or user-data deletion occurs without separate explicit authorization.
