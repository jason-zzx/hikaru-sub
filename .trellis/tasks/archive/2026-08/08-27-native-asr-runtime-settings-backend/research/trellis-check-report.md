# T16 Trellis check report

## Result

No confirmed P0/P1 issues remain. The reviewed implementation satisfies the T16 boundary: one immutable policy selects the stable ASR command family, Native errors cannot enter the sidecar, T12 exact model paths feed the T13 worker through the existing host, and Release/default remains legacy for T18.

## Review fix

- Removed the unreachable non-debug `resolve_debug_native_launch` stub from `src-tauri/src/asr.rs`. The call is already compiled only under `debug_assertions`; removing the unused Release stub makes Release checking warning-free without changing behavior.

## Reviewed contracts

- All engine/model/download/start/progress/cancel paths use the same process route policy.
- Native preflight failures drop an unactivated reservation and return directly; no Native error branch calls `ensure_base_url`.
- T13 runtime consumption checks resource identity/capability/required entries and uses the exact packaged worker path.
- T12 owns readiness hashing and the sole resolved model path; no alias/model-name/custom path is accepted.
- Release ignores debug fake-worker environment values and remains legacy.
- Legacy ASR settings keys are accepted, ignored, not serialized, and not rewritten on load.
- Probe emits no Python/venv, measure remains explicit, recursive work stays off async workers, and cleanup remains bounded.
- Public command names, compatibility booleans, download polling, typed wrappers, and job/recovery contracts remain stable.

## Validation summary

- Focused settings/dependencies/asr_models/asr Rust tests: PASS
- Full `cargo test --manifest-path src-tauri/Cargo.toml`: PASS
- Touched-file rustfmt: PASS
- Full `pnpm test`: PASS
- `pnpm build`: PASS (existing chunk advisory only)
- `pnpm asr:runtime:verify`: PASS
- Release cargo check with malicious debug env values: PASS
- Task validation: PASS
- `git diff --check`: PASS
- No staged files: PASS

Repository-wide `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` reports only a pre-existing formatting difference in untouched `src-tauri/src/ffmpeg.rs:630`; no T16 file is implicated.

## Residual gates

- Optional real-model smoke was not rerun; T18 owns final installed/portable/offline model-backed qualification.
- T17 owns visible Python setup removal and unavailable model/device UX.
- T18 owns the Release/default Native flip and packaged Python removal.
- No commit, push, archive, staging, or Git history change was performed.
