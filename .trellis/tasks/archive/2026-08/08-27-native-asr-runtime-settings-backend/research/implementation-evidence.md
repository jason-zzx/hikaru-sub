# T16 implementation evidence

## Delivered product files

- `src-tauri/src/settings.rs`
- `src-tauri/src/dependencies.rs`
- `src-tauri/src/asr_models.rs`
- `src-tauri/src/asr.rs`
- `src/types/index.ts`
- `src/constants/runtimeDependencies.ts`
- `src/constants/runtimeDependencies.test.ts`

## Delivered behavior

- Legacy `pythonPath` and `asrServicePath` remain accepted JSON input, are cleared in memory, and are omitted from serialization. Loading settings does not write the file; all unrelated settings remain intact.
- `RuntimeDependencyKind::NativeAsrCpu` resolves the locked T13 resource at `resource_dir()/native-asr/windows-x64/cpu`, checks the MVP artifact/platform/arch/protocol/capability identity and required runtime entries, and reports it as built-in/unmanaged.
- Production dependency probe emits FFmpeg, the built-in Native CPU runtime, and exact T12 large-v3 readiness. It emits no Python 3.11 or ASR venv items and performs no recursive size scan.
- Explicit storage measure covers managed FFmpeg when applicable, bounded `deps/models`, `deps/downloads`, and app cache. Cleanup rejects the bundled runtime and keeps existing containment/current-video preservation.
- One immutable `AsrRoutePolicy` selects engine list, model status/download/progress, and transcription routing as one command family.
- The Native branch consumes `NativeAsrModelManager` status/download jobs, maps T12 disposition metadata to backward-compatible public booleans, resolves the exact ready model path, and starts the locked T13 worker through the existing `NativeAsrHost` and `ResolvedNativeLaunch`.
- Native preflight errors for missing/deferred/unsupported model, device, language, VAD, or runtime return directly and never fall through to the Python sidecar.
- Release/default remains legacy until T18. No persisted route setting or Release environment override was added.
- Existing public command names, TypeScript wrappers, `AsrJobSnapshot`, active-job gate, reducer, cancel/crash/recovery, and ASS fallback contracts remain unchanged.

## Acceptance evidence

| AC | Evidence |
|---|---|
| AC1 | Settings tests prove legacy-key input, in-memory clearing, serialization omission, and unrelated field preservation. |
| AC2 | Probe implementation/tests emit FFmpeg, `nativeAsrCpu`, and exact large-v3 model state with no Python/venv and no recursive size call. |
| AC3 | Measure/cleanup tests cover bounded models/downloads/app cache, current-video preservation, and non-cleanable bundled runtime. |
| AC4 | ASR mapper tests cover ready, supported-missing, post-MVP-unavailable, and unsupported booleans/metadata. |
| AC5 | Native command branches delegate to the process-owned T12 manager and preserve polling/not-found fields. |
| AC6 | Native request tests and reviewed flow prove CPU/auto, exact model path, T13 worker, deterministic rejection, and no sidecar fallback. |
| AC7 | All stable model/inference commands read the same immutable process route policy; Release default remains legacy. |
| AC8 | Focused/full ASR and Cargo suites retain lifecycle, cancel, crash, recovery, fallback, and missing-job coverage. |
| AC9 | Runtime resource tests cover installed-like/portable-like roots; existing executable-adjacent dependency/app-path tests pass. |
| AC10 | Full frontend, build, runtime verifier, and Cargo tests pass. |
| AC11 | Task validation, diff check, and no-staged-files check pass; no commit/archive/cutover occurred. |

## Validation

```text
cargo check --manifest-path src-tauri/Cargo.toml                                      PASS
cargo test --manifest-path src-tauri/Cargo.toml settings::tests                      PASS
cargo test --manifest-path src-tauri/Cargo.toml dependencies::tests                  PASS
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests                    PASS
cargo test --manifest-path src-tauri/Cargo.toml asr::tests                           PASS
rustfmt --edition 2021 --check <four touched Rust files>                             PASS
pnpm test -- src/constants/runtimeDependencies.test.ts                               PASS
pnpm test                                                                            PASS
pnpm build                                                                           PASS (existing chunk-size advisory only)
pnpm asr:runtime:verify                                                              PASS
cargo test --manifest-path src-tauri/Cargo.toml                                      PASS
cargo check --release with malicious HIKARU_ASR_FAKE_* env values                   PASS; Release remains legacy
python ./.trellis/scripts/task.py validate 08-27-native-asr-runtime-settings-backend PASS
git diff --check                                                                     PASS
git diff --cached --quiet                                                            PASS
```

Repository-wide `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` remains red only for pre-existing formatting in untouched `src-tauri/src/ffmpeg.rs`; every T16 Rust file passes targeted rustfmt.

## Independent review

`trellis-check` found no P0/P1 issue. It removed one unreachable non-debug `resolve_debug_native_launch` stub that caused a Release-only dead-code warning, then reran affected/full checks successfully.

## Residual scope

- No new real 3 GB large-v3 inference smoke was run because the required worker/model/audio environment triple was absent. T12/T13 already prove the exact model-worker handoff; T18 owns installed/portable/offline short and >10-minute release qualification.
- T17 still owns removal of Python setup UI and final model/device/unavailable presentation.
- T18 still owns the Release/default Native policy flip and packaged Python/sidecar removal.
- No model bytes, audio, transcript text, secrets, full network bodies, or private absolute paths are tracked in this evidence.
