# T12 implementation evidence

## Delivered files

- `src-tauri/resources/native-asr-models.json`
- `src-tauri/src/asr_models.rs`
- minimal internal integration in `src-tauri/src/{dependencies,asr,lib}.rs`

The existing public `check_asr_model`, `download_asr_model`, and `get_model_download_progress` implementations remain Python-sidecar backed.

## Acceptance evidence

| AC | Evidence |
|---|---|
| AC1 | Bundled schema-v1 manifest freezes the exact large-v3 repo/revision, CT2 backend/format, MIT attribution/source, and four required size/SHA rows. |
| AC2 | Manifest tests reject schema drift, duplicates, missing roles, unsafe characters/traversal, malformed hashes, Windows reserved/trailing-dot aliases, and ASCII case collisions. |
| AC3 | Readiness tests cover exact direct/legacy resolution, preference, missing/wrong-size/wrong-hash/wrong-revision failure, direct link rejection, and legacy canonical containment. |
| AC4 | Official/China endpoint and deterministic immutable file URL tests pass. |
| AC5 | Tests cover fresh download, valid resume, ignored range, incompatible range, HTTP 416 restart, network interruption partial preservation, oversized/corrupt partial handling, and bad hash. |
| AC6 | Publication tests prove full-stage validation, valid-final preservation, invalid-final repair, and rollback on publication failure. |
| AC7 | Concurrent same-model starts return one active job and one network sequence; terminal snapshots remain pollable. |
| AC8 | Pure managed-root tests cover the same executable-adjacent `deps` layout used by installed and portable packages; no AppData model root is introduced. |
| AC9 | The verified T13 packaged Windows x64 CPU worker completed the existing real CT2 host success test with the exact cached large-v3 revision and short benchmark WAV in 21.43 seconds. Transcript text was not recorded. |
| AC10 | Public model commands and frontend contracts have no implementation change. |
| AC11 | Focused/full Rust tests, frontend build, task validation, implementation rustfmt, and diff checks pass. |

## Quality review

Independent `trellis-check` found no P0 issue. It found and fixed two P1 items:

1. Windows reserved device names, trailing-dot aliases, and ASCII case-colliding manifest identities/paths were accepted.
2. The frozen-manifest regression did not assert every role/path/size/SHA tuple.

Focused regression coverage was added and all affected/full gates passed after the fixes.

## Validation commands

```text
cargo test --manifest-path src-tauri/Cargo.toml asr_models                         PASS
cargo test --manifest-path src-tauri/Cargo.toml                                    PASS
pnpm build                                                                          PASS (existing chunk-size advisory only)
python ./.trellis/scripts/task.py validate 08-20-native-asr-model-manager          PASS
rustfmt --edition 2021 --check src-tauri/src/asr_models.rs                         PASS
git diff --check                                                                    PASS
git diff --cached --quiet                                                           PASS (no staged files)

HIKARU_ASR_PRODUCTION_WORKER=<packaged CPU worker>
HIKARU_ASR_CT2_MODEL_PATH=<exact managed large-v3 snapshot>
HIKARU_ASR_CT2_AUDIO_PATH=<short benchmark WAV>
cargo test --manifest-path src-tauri/Cargo.toml \
  production_worker_runs_the_selected_device_through_the_native_host -- --nocapture
                                                                                   PASS (21.43s)
```

## Residual scope

- The T12 real handoff proves exact-path packaged-worker load and short inference.
- Installed/portable offline smoke and audio longer than ten minutes remain T18 release-cutover gates.
- Readiness intentionally performs full exact hashing; persistent verification caching remains deferred until latency is measured.
- Production/default remains Python legacy until T16–T18.
