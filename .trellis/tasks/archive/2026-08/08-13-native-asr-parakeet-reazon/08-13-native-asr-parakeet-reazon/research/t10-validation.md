# T10 Final Validation

## Independent review

Two bounded `trellis-check` passes found no blocking static issue after the partial-failure RTF fix. The child command runner was unavailable (`hypa` executable missing), so all executable gates below were rerun by the parent session. The first review's actionable finding was fixed: a backend failure before full audio coverage now publishes attempted time/duration only, not full-case RTF.

## Native lanes

All configure/build/test lanes passed:

- `windows-x64-release`: 6/6 CTest.
- `windows-x64-ct2-release`: 8/8 CTest, including `crispasr-release-route-disabled`.
- `windows-x64-ct2-cuda-development`: 8/8 CTest.
- exact ignored T10 CrispASR build: 8/8 CTest, including `crispasr-worker-contract`.

The T10 worker contract covers preview suppression, monotonic progress, one atomic replacement, post-ready zero-output policy failure, protocol replacement limits, and unchanged Qwen/VAD/Vulkan/default-off behavior.

## Rust host

- Full `cargo test --manifest-path src-tauri/Cargo.toml`: 209 passed.
- `cargo check --release --manifest-path src-tauri/Cargo.toml`: passed.
- Model-backed Reazon short success: atomic replacement, recovery JSON and ASS passed.
- Model-backed Reazon long policy failure: `crispasr_result_invalid`, failed status and zero accepted segments passed.
- Model-backed medium hard cancellation: cancel/reap deadline and zero accepted segments passed.

The real-model helper uses a 60-second terminal wait because model/window inference is not a fake-worker timing assertion; the cancellation operation itself retains the existing two-second bound.

## Product and benchmark regressions

- `pnpm test`: 105 files / 830 tests passed.
- `pnpm build`: passed; only the existing Vite large-chunk warning was emitted.
- benchmark self-check: passed.
- authoritative manifest validation: passed with the existing `low-volume` coverage warning.
- benchmark unittest: 24 passed.

## Evidence, privacy, task

- publisher mutation/determinism suite: 9 passed.
- deterministic publication regenerated successfully with independent `stop-revise` results.
- task context validation: 5 implement + 5 check entries passed.
- `git diff --check`: passed.
- active and prospective archived `research/local/` roots are ignored.
- tracked evidence privacy scan found no user-absolute paths, raw identifiers, credentials, transcript text, media, model, stderr or binaries.
- no staged files.

## Ponytail simplification revalidation

After the final complexity review, five behavior-preserving reductions removed duplicated progress emission, tautological/redundant policy checks, repeated worker-test assertions, and repeated acquisition manifest/data plumbing. Because native source identity changed, the old rows were invalidated rather than reused.

The final worker/runner were rebuilt, both engines reran the complete `1+3 / 1 / 1` matrix, the raw index/publication/handoff were regenerated, all four native CTest lanes passed again, and all three real Rust-host model tests passed against the new worker. Quality dispositions remained independently `stop-revise`.

## Result

T10 is complete with independent `stop-revise` dispositions for both `reazonspeech-nemo` R1 and `parakeet` P1. No accepted T10 engine-algorithm input is handed to T14/T15, and Release/default remains Python legacy.
