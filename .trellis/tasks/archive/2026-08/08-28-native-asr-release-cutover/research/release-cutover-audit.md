# T18 release-cutover audit

## Scope decision

The user confirmed that T18 does **not** update the application version or add a version-specific `CHANGELOG.md` entry. It delivers a release-ready Native cutover only; version/tag/publish operations remain separate.

## Completed inputs

- T12 model manager: `.trellis/tasks/archive/2026-08/08-20-native-asr-model-manager/`
- T13 CPU runtime package: `.trellis/tasks/archive/2026-08/08-20-native-asr-cpu-runtime-package/`
- T16 runtime/settings backend: `.trellis/tasks/archive/2026-08/08-27-native-asr-runtime-settings-backend/`
- T17 frontend migration: `.trellis/tasks/archive/2026-08/08-28-native-asr-frontend-migration/`
- Parent authority: `.trellis/tasks/07-25-native-asr-migration/{prd.md,design.md,implement.md}`

T13 handoff freezes:

- artifact `native-asr/artifacts/windows-x64-cpu.zip`;
- artifact SHA-256 `e84948f668bc0e308ad4d47edb58b9644f0d3c468c9e2071913277416dea7ff3`;
- worker SHA-256 `095a19ca896867efe64a19501594e7a7ee0539f58411051f83504b4900de2c14`;
- unpacked runtime size `26,023,959` bytes;
- model-weight count `0`;
- prior installed-like/portable-like short and 601-second functional smoke evidence.

T18 must rerun release qualification against the unchanged artifact instead of treating T13 evidence alone as the cutover gate.

## Pre-implementation production route seam (resolved)

`src-tauri/src/asr.rs` owned one `AsrRoutePolicy` for engine list, model status/download/progress, start, progress, and cancel.

At audit time, Native routing depended on a debug fake-host seam. T18 changed the immutable application default to `NativeMvp`; a successfully injected debug fake host now changes only the host executable. Every stable ASR command still branches on the same policy, Native preflight errors return directly without reaching `ensure_base_url`, and legacy sidecar source remains only as rollback evidence.

The implemented cutover changed only that default decision and focused tests; it added no setting, environment release override, command family, or route registry.

## Pre-implementation release resource seam (resolved)

### Native resource preparation

At audit time, `scripts/prepare-asr-resource.mjs` copied the repo-root `asr-service/` tree into `src-tauri/resources/asr-service/` and also verified/extracted the frozen Native runtime. T18 retained Native verification/extraction and replaced the sidecar copy with explicit removal of the legacy resource target so a stale prior worktree cannot be bundled.

The existing script name and package command can remain to minimize churn; its product meaning becomes “prepare ASR release resources,” not “copy Python sidecar.”

### Tauri bundle

`src-tauri/tauri.conf.json` bundles the complete `src-tauri/resources/` directory. Therefore merely stopping the copy is insufficient: the old tracked/generated `src-tauri/resources/asr-service/` tree must be deleted, and preparation must remove any stale local copy before `tauri build`.

### Portable staging

At audit time, `scripts/package-portable.mjs` required and copied `runtime-dependency-sources.json`, `asr-service`, and `native-asr`. T18 removed the `asr-service` requirement/copy while preserving explicit staging of the source manifest, verified Native runtime, executable, and `.portable` marker.

`tests/PortablePackage.test.ts` currently creates and expects `asr-service`; it is the focused regression seam for proving the resource is absent and stale release files are not copied.

### CI and release workflow

Both `.github/workflows/ci.yml` and `.github/workflows/release.yml` call `pnpm asr:prepare-resource`. No new workflow or build system is needed. Existing release packaging already consumes the prepared resource and creates NSIS + portable artifacts.

## Legacy source boundary

`src-tauri/src/lib.rs` still manages `AsrSetupState` and registers setup commands. `src-tauri/src/asr.rs`, `src-tauri/src/asr_setup.rs`, `src-tauri/src/dependencies.rs`, and `asr-service/` retain legacy source paths.

Parent/T16/T17 contracts explicitly retain Python legacy source for one stable release cycle. T18 therefore should not delete the entire legacy Rust/Python source or redesign command registration unless package/content tests prove compiled dormant setup commands violate a release requirement. The required product gate is:

- production route never enters legacy;
- no Python sidecar/runtime/venv/packages/template are shipped;
- no frontend action exposes Python setup;
- no Native failure falls back to Python.

The locked runtime source manifest may retain historical Python download metadata for rollback/source compatibility; it is metadata, not a bundled interpreter or environment. Do not expand scope by redesigning that manifest unless an artifact audit finds actual Python bytes included.

## Local qualification inputs

Ignored local assets currently exist:

- `.asr-benchmark/short.wav`;
- `.asr-benchmark/long.wav` (longer than 10 minutes);
- exact managed large-v3 snapshot under `src-tauri/target/debug/deps/models/huggingface/.../edaa852ec7e145841d8ffdb056a99866b5f0a478/`.

Tracked evidence must record only stable hashes, duration, counts, artifact/model identity, layout role, and pass/fail state. It must not record transcript/ASS text, raw model bytes, or absolute user paths.

`scripts/smoke-native-asr-runtime.mjs` already validates:

- UTF-8 JSONL-only output;
- ready/completed protocol order;
- monotonic bounded progress;
- non-empty ordered positive-duration audio-bounded segments;
- completed duration consistency.

Reuse this harness rather than adding another transcript validator. T18 may need a thin release qualification wrapper/evidence writer only if one command is required to run installed-like and portable-like matrices, package-size/content checks, and sanitized evidence consistently.

## Pre-implementation documentation drift (resolved)

The following authoritative docs described Python as the production/release architecture at audit time and were updated after the code landed:

- `README.md`: feature list, first-use flow, technology table, runtime docs links.
- `docs/release.md`: package contents and Windows validation steps.
- `docs/runtime-dependencies.md`: packaging model, resolution order, storage layout, setup flow, cleanup, source behavior.
- `THIRD_PARTY_NOTICES.md`: release-package scope and CTranslate2/Python component boundary.
- `AGENTS.md`: technology stack, architecture boundary, runtime dependency/model cache rules, diagnostics.
- `.trellis/spec/tauri/media-ffmpeg-asr.md`: pre-cutover route/package contracts must become post-cutover contracts.
- `.trellis/spec/frontend/type-safety.md`: remove “T18 still owns” transitional wording while preserving availability-driven UI contracts.
- `.trellis/spec/asr/`: update only where the sidecar/package role is stated; do not rewrite historical quality evidence.

## Required validation

Automated:

```bash
pnpm asr:runtime:verify
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm release:local
python ./.trellis/scripts/task.py validate 08-28-native-asr-release-cutover
git diff --check
```

Native runtime/worker:

- run the existing final CMake/CTest/package checks owned by T13;
- rerun short and >10-minute smoke for installed-like and portable-like layouts using the exact cached model and final worker bytes;
- rerun cancel/crash/recovery/active-gate coverage or its existing packaged-host test command.

Package audit:

- NSIS and portable contain the same runtime manifest identity;
- no `asr-service`, Python executable, venv, Python package tree, model weight, PDB, optional GPU/VAD/CrispASR runtime, cache, or `deps/` staging data;
- setup <= 80 MiB, portable ZIP <= 90 MiB, unpacked runtime <= 250 MiB, bundled model count = 0;
- license inventory matches the runtime lock and actual payload.

## Primary risks and rollback points

1. **Stale legacy resource rebundling** — prevent by explicitly deleting `src-tauri/resources/asr-service` during preparation and testing package absence.
2. **Split route family** — prevent by changing the single existing default policy only and retaining command-family tests.
3. **Debug/release drift** — test `AsrState::default`/policy independently of fake-host presence; fake worker injection must remain a host seam, not the production route selector.
4. **False release evidence** — bind smoke/package evidence to exact artifact, worker, model revision, input hashes, and package hashes.
5. **Private data leakage** — evidence contains no transcript text or absolute private paths.
6. **Over-deleting rollback source** — remove packaged resources, not the root sidecar/history tree.
7. **Version/release creep** — do not change application version, version-specific changelog entry, tag, GitHub Release, or remote state.
