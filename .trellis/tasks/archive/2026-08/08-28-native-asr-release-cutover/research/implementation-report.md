# T18 implementation closure report

## Result

The code, release resources, documentation, automated qualification, and final product-level UI smoke for the Native ASR cutover are accepted.

The user reported final installed and portable manual acceptance completed against the package identities recorded in `research/release-qualification-evidence.json`. T18 has no remaining acceptance blocker and is ready for finish-work archival.

## Implemented changes

- `src-tauri/src/asr.rs` now selects the existing `NativeMvp` route for normal debug and Release state. Only a successfully injected process-lifetime debug fake host enables the fake launch seam; invalid or late fake-worker environment values cannot bypass normal Native model/runtime preflight. Native errors do not enter the Python sidecar path.
- `scripts/prepare-asr-resource.mjs` deletes stale `src-tauri/resources/asr-service` and prepares only the verified frozen Native runtime.
- `scripts/package-portable.mjs` no longer requires or stages the Python sidecar resource.
- The tracked `src-tauri/resources/asr-service/` template tree is removed; repo-root `asr-service/` remains development/rollback source.
- Focused resource-preparation and portable-staging tests cover stale sidecar removal and the explicit Native-only allowlist.
- Product, release, dependency, license, agent, and Trellis specifications now describe the production Native large-v3 CPU route and the retained legacy-source boundary.
- No application version, version-specific changelog, runtime archive, runtime lock, model manifest, protocol, worker inference, or user-data migration was changed.

## Automated release qualification

Sanitized authoritative results are published in:

- `research/release-qualification-evidence.json`

Highlights:

- Frozen runtime archive: `e84948f668bc0e308ad4d47edb58b9644f0d3c468c9e2071913277416dea7ff3`, 6,859,911 bytes.
- Independent final CMake/package check produced a byte-identical archive.
- Worker SHA-256: `095a19ca896867efe64a19501594e7a7ee0539f58411051f83504b4900de2c14` in both installed and portable layouts.
- Exact large-v3 revision `edaa852ec7e145841d8ffdb056a99866b5f0a478`: all four required files match size and SHA-256.
- Installed and portable short smoke: 24,102 ms, 5 segments, 9 events each.
- Installed and portable long smoke: 601,000 ms, 168 segments, 193 events each.
- Output validation covered UTF-8/JSONL, protocol order, monotonic progress, non-empty ordered positive-duration audio-bounded segments, and completed duration.
- Native CTest: 4/4 passed.
- Route tests: 12/12 passed; Native worker matrix: 33/33 passed; real worker: 2/2 passed; real cancel: 1/1 passed.
- Final NSIS: 11,144,308 bytes (`<= 80 MiB`); portable ZIP: 15,443,450 bytes (`<= 90 MiB`); runtime: 26,023,959 bytes (`<= 250 MiB`); bundled model weights: 0.
- Clean installed/portable audits found no sidecar, Python/venv/package tree, GPU/VAD/CrispASR runtime, PDB, staged `deps/`, cache, or model weights.
- Final Release startup smoke showed no Python/Uvicorn child, no packaged sidecar, and correct portable `data/`, `cache/`, and `webview/` creation. Release ignored malicious debug fake-worker environment values.

## Final commands

- `pnpm asr:runtime:verify` — passed.
- `pnpm test` — 109 files / 822 tests passed.
- `pnpm build` — passed; existing Vite chunk-size warning only.
- `cargo test --manifest-path src-tauri/Cargo.toml` — 244 tests passed.
- `pnpm release:local` — passed; final NSIS and portable rebuilt.
- Clean final package audit — passed.
- Exact cached model size/SHA-256 verification — passed.
- `python ./.trellis/scripts/task.py validate 08-28-native-asr-release-cutover` — passed.
- `git diff --check` — passed.
- `git diff --cached --name-only` — empty; no staged files.

## Final manual product-level acceptance

The user accepted the final installed and portable product smoke against the package hashes recorded in `research/release-qualification-evidence.json`, covering runtime/model availability, cached large-v3 progress and ASS output, cancellation with active-slot recovery, restart/recovery behavior, and no model/Python network or sidecar dependency. The sanitized evidence records the user attestation without private paths, transcript/ASS text, network logs, or invented measurements.

## Privacy and repository safety

Tracked evidence contains no transcript or ASS text, audio/model bytes, credentials, or absolute private paths. No commit, tag, push, publish, merge, rebase, reset, archive, version change, or user-data deletion was performed by the implementation/check agents.
