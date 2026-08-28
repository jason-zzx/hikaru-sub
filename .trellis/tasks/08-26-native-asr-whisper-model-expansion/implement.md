# Native Faster-Whisper model expansion implementation plan

> Status: planning and intentionally parked. T16 is complete; the enforced next tasks are T17 and then T18. Do not activate this task until T18 is completed and archived unless the user explicitly changes the parent roadmap. Do not commit, push, merge, rebase, reset, or archive without separate user authorization.

## Step 0 - Confirm the production baseline

- Verify T16 runtime/settings, T17 frontend migration, and T18 release cutover are completed and archived.
- Read their final PRD/design/implementation evidence and inspect the current command/status/type contracts.
- Confirm product/default `start_asr`, model check/download/progress, and availability metadata are Native rather than Python-sidecar backed.
- Confirm the released worker/runtime identity and the exact `large-v3` regression commands.
- If T18 is not complete, stop after planning/research. Do not implement a mixed native-download/Python-launch state.
- If the user explicitly reprioritizes, update the parent roadmap and this task design before code changes; do not silently absorb T16-T18.

Rollback: none; this is an evidence gate.

## Step 1 - Load owning specs and freeze exact model identities

- Load `trellis-before-dev` for Tauri, native worker, and frontend layers.
- Read `AGENTS.md`, the final task artifacts, planning evidence, T12/T13 specs/evidence, and final T16-T18 artifacts.
- Requery the Hugging Face API for each canonical repository at its immutable revision.
- For `config.json`, `model.bin`, `tokenizer.json`, and the applicable vocabulary file, record exact byte size and SHA-256.
- Verify MIT license and attribution source for every row.
- Confirm turbo uses the canonical repository rather than a floating redirect alias.
- Store release authority in `src-tauri/resources/native-asr-models.json`; task research may record how values were obtained but is not a second runtime lock.

Focused check: independently fetch/hash at least one small text file and compare it with the proposed manifest tuple before editing production behavior.

Rollback: discard task-local identity notes; no product files changed.

## Step 2 - Add failing manifest and lookup tests

Before adding rows, extend `asr_models.rs` tests to require:

- all six logical IDs and exact canonical revisions;
- exact backend/format/license/source metadata;
- exact path/size/SHA tuple closure for every row;
- `vocabulary.txt` acceptance for Systran tiny/base/small/medium/large-v2;
- `vocabulary.json` acceptance for turbo;
- no ordinary Whisper `preprocessor_config.json` requirement;
- no duplicate logical IDs, model identities, roles, paths, or ASCII case aliases;
- post-MVP classification remains for Kotoba/Qwen/Parakeet/Reazon while the six manifest-backed models become supported.

Run the focused tests and confirm they fail for the missing rows.

Rollback: remove only the new failing tests.

## Step 3 - Extend the existing manifest and model manager minimally

- Add the six exact schema-v1 manifest rows.
- Reuse the existing parser, path builders, downloader, readiness verification, publication, and job state.
- Remove the six Faster-Whisper pairs from `POST_MVP_MODELS` only if the list remains necessary for other engines; do not add a replacement support registry.
- Change Rust logic only where a failing test proves a large-v3-only assumption.
- Preserve direct-install priority over exact legacy snapshots and keep all model namespaces independent.
- Keep official/China source mapping unchanged.

Focused checks:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests::manifest
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests::readiness
```

Rollback: revert the six rows and any directly required generalization; existing `large-v3` remains untouched.

## Step 4 - Prove independent readiness, download, and publication

Add small fixture coverage that exercises both vocabulary forms and multiple logical IDs:

- direct and legacy readiness for representative text/json vocabulary rows;
- one model missing/corrupt while another stays ready;
- independent direct/download paths for all six IDs;
- same-model download coalescing without cross-model coalescing;
- one model's interrupted/bad-hash/repair path does not modify another model;
- terminal snapshots retain the correct engine/model/revision;
- manifest absence remains unavailable rather than falling back.

Reuse existing generic tests instead of cloning the entire downloader suite six times. Add only the smallest cross-model checks needed to prove isolation.

Focused checks:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests::readiness
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests::download
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests::publication
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests::coalesces
```

Rollback: remove only new fixtures/tests and row-specific direct/download data created for local verification.

## Step 5 - Qualify the released worker without rebuilding it

Using exact managed model directories and the released T18 CPU worker:

- run a short Japanese end-to-end host smoke for `tiny`;
- repeat for `base`, `small`, `medium`, `large-v2`, and `large-v3-turbo`;
- assert non-empty UTF-8 text, ordered positive-duration audio-bounded segments, normal completion, and recovery/fallback persistence;
- record model/runtime hashes, duration, pass/fail, and timing only; do not record transcript text or private paths;
- rerun the existing `large-v3` model-backed regression;
- run `large-v2` against a Japanese input longer than ten minutes;
- run the existing host cancel/crash/recovery suite and one real newly added model cancellation smoke if the current test harness supports it.

If all models pass, do not modify or rebuild the worker.

If one fails because of worker code:

1. preserve the exact failing model/audio/runtime evidence;
2. add one failing shared-behavior regression;
3. fix the root cause without model-name branches;
4. freeze/rebuild a new runtime revision;
5. rerun all six new models and full `large-v3` runtime/package gates.

Rollback: delete only task-local smoke output. Never delete shared managed models or benchmark media.

## Step 6 - Integrate with the final T18 backend contract

- Inspect whether T18 already resolves any selected manifest-backed model generically.
- If generic, add no launch routing code; prove the six rows flow through existing commands.
- If `large-v3` is hardcoded, replace only that selection with `NativeAsrModelManager.resolve_ready_model(engine, model)` and the returned backend/path.
- Preserve command names, camelCase fields, `AsrJobSnapshot`, one-active-job behavior, cancel, crash, recovery, and ASS generation.
- Ensure unavailable/missing models return the final T16/T18 controlled status/error and never start Python or `large-v3`.
- Keep blocking readiness hashing off async workers through the existing `spawn_blocking` boundary.

Focused checks depend on the final T18 names; at minimum run focused `asr_models`, `asr`, and `asr_worker` tests.

Rollback: restore the prior generic/large-v3 launch selection; model files remain intact.

## Step 7 - Extend availability UI without another registry

- Reuse `ASR_ENGINE_MODELS`, `ModelManager`, typed `tauri.ts` wrappers, and the final T17 availability type.
- Make manifest-backed missing models independently downloadable and ready models selectable/runnable.
- Keep `large-v3` as the default.
- Keep absent/failed models visible with a concise Simplified Chinese reason.
- Ensure model switches ignore stale checks/download state using the existing request identity behavior.
- Do not add a new screen, source selector, advanced model flags, or Python setup fallback.

Tests:

- all six existing Faster-Whisper options remain visible;
- `large-v3` remains default;
- one ready model is enabled while another unavailable model stays disabled with a reason;
- one model's download/error state does not affect another;
- no Python fallback copy or action reappears.

Focused checks:

```bash
pnpm test -- src/constants/asr.test.ts
pnpm test -- src/components/workflow/ModelManager.test.tsx
pnpm test -- src/components/workflow/TranscribeView.test.tsx
```

Use the actual existing test filenames after T17; do not create empty parallel suites merely to match these examples.

Rollback: revert availability presentation changes; keep the stable T17 behavior.

## Step 8 - Installed/portable and regression verification

- Verify exact readiness/path behavior for all seven manifest-backed Faster-Whisper models in installed-like and portable-like roots through Rust tests.
- Run packaged installed/portable smoke with at least one small new model and `large-v2`; keep the existing `large-v3` installed/portable regression.
- Confirm package archives still contain zero model weights.
- Confirm official/China model downloads still target executable-adjacent managed `deps` roots.
- Confirm rollback/removing a manifest row does not delete downloaded models, partials, settings, projects, or subtitles.
- Record release-note inputs: supported models, approximate download sizes, CPU-only status, and known quality diagnostics.

If worker bytes changed, rebuild and verify the full runtime/package artifact exactly as required by the T13 contract. If worker bytes did not change, do not create a new runtime artifact revision.

## Step 9 - Full quality gate

Run the final applicable commands:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models
cargo test --manifest-path src-tauri/Cargo.toml asr_worker
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test
pnpm build
python ./.trellis/scripts/task.py validate 08-26-native-asr-whisper-model-expansion
git diff --check
git status --short
```

Also run the final T18 worker CTest/runtime verifier and installed/portable smoke commands from its archived evidence.

Independent review must verify:

- all six manifest identities are immutable and exact;
- vocabulary form and 80/128 Mel behavior are model-derived;
- ordinary Whisper does not inherit Kotoba readiness;
- no duplicate registry, backend, downloader, command family, or Python fallback was introduced;
- failure/download/readiness is isolated by model;
- `large-v3` default and regression behavior remain intact;
- runtime bytes were not rebuilt without evidence;
- no secrets, transcript text, model bytes, private paths, or staged files were added.

Fix every P0/P1 issue and rerun affected/full gates before reporting completion.

## Context configuration before activation

`implement.jsonl` and `check.jsonl` must contain real spec/research entries. Before `task.py start`, refresh them against the final T16-T18 artifact locations, run task validation, present the converged PRD/design/implement artifacts, and obtain explicit user approval.

Do not activate while Step 0 is blocked.

## Completion gate

Planning is ready for later activation when:

- PRD, design, and implementation plan are converged;
- context manifests contain real entries;
- task validation passes;
- the dependency gate is explicit and the user has reviewed the plan.

Implementation is complete only when all six models pass exact delivery and functional qualification, T18/`large-v3` has no regression, frontend/backend availability is correct, and all required checks pass.
