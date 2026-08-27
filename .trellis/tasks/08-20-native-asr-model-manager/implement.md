# Native ASR MVP model manager implementation plan

> Status: implemented and locally verified. The exact large-v3 packaged-worker short smoke passed; installed/portable and >10-minute release smoke remain T18 gates. Do not commit, push, or change remote state without separate explicit user authorization.

## Step 1 — Load owning contracts and add failing manifest/path tests

- Load `trellis-before-dev` for the Tauri layer.
- Read the final T12 PRD/design, parent migration artifacts, `AGENTS.md`, Tauri path/runtime/async/command specs, archived T02 model lock, and T13 runtime handoff.
- Add the smallest `asr_models.rs` test fixtures covering:
  - valid schema-v1 row;
  - unsupported schema;
  - duplicate identity;
  - unsafe relative path;
  - malformed SHA-256;
  - missing required role;
  - direct, legacy, and download path derivation below a temporary `deps` root.
- Confirm these tests fail before implementation.

Rollback: remove the new empty module/test registration; no production behavior or data changes.

## Step 2 — Add the frozen model manifest and validated lookup

- Add `src-tauri/resources/native-asr-models.json` containing only the exact large-v3 row from the PRD.
- Implement manifest structs and validation in `src-tauri/src/asr_models.rs` using `include_str!`.
- Implement exact lookup by `(engine, model)` and one explicit post-MVP disposition for known non-MVP product models.
- Do not add aliases, remote manifests, companion groups, custom URLs, devices, UI labels, or other model entries.
- Add focused tests for exact metadata, role closure, lookup, post-MVP disposition, and unknown identity.

Focused check:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests::manifest
```

Rollback: remove the manifest and parser; no downloaded data exists yet.

## Step 3 — Implement managed paths and exact readiness

- Expose only the minimum crate-local path helpers from `dependencies.rs`:
  - managed downloads root;
  - direct CTranslate2 model root;
  - existing managed Hugging Face root.
- Keep executable-adjacent `deps` behavior unchanged for installed and portable builds.
- Implement direct immutable revision path and exact Hugging Face snapshot path derivation.
- Implement file verification with:
  - direct-install symlink rejection;
  - legacy canonical containment;
  - exact size;
  - exact SHA-256;
  - sanitized diagnostics.
- Implement resolution order: valid direct install, then valid exact legacy snapshot, else supported-missing.
- Run full-file hashing and other blocking filesystem verification through `spawn_blocking`.
- Do not scan recursively, accept arbitrary caller paths, copy legacy files, or require ordinary Whisper `preprocessor_config.json`.
- Add small-file tests for every valid/invalid readiness case and path escape.

Focused check:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests::readiness
```

Rollback: remove readiness/path helpers; legacy cache remains untouched.

## Step 4 — Implement source resolution and resumable per-file download

- Reuse `effective_source_profile`; official resolves to Hugging Face and China resolves to the configured mirror endpoint.
- Build URLs only from the validated bundled repository/revision/file values.
- Implement a bounded `reqwest::Client` and per-file `.part` downloads below the exact managed namespace.
- Implement resume behavior:
  - append only after matching `206 Content-Range`;
  - truncate on `200` when a range was ignored;
  - restart oversized, completed-but-bad-hash, incompatible-range, and `416` partials safely;
  - reject growth beyond expected size;
  - preserve useful interrupted partials;
  - delete known-corrupt completed partials.
- Aggregate progress across all required files.
- Never log response bodies, credentials, subtitles, or model bytes.
- Use `httpmock` tests for fresh download, valid resume, ignored range, invalid range, interruption, and hash mismatch.

Focused check:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests::download
```

Rollback: remove downloader code and delete only test/download-namespace fixtures.

## Step 5 — Implement staged publication and repair behavior

- Create one job-scoped stage directory below `deps/downloads/native-asr-models/...`.
- Move/copy only individually verified files into stage.
- Revalidate the full stage before touching the final revision path.
- Publish by directory rename into a missing immutable final path.
- If the final path already validates, discard stage and reuse it.
- If the final path is invalid, preserve it until stage validation succeeds, then replace it through a bounded job-scoped backup/repair sequence.
- Revalidate the published final directory before reporting completion.
- Remove completed parts/stage/invalid backup only after success; failed or interrupted publication must never produce a ready partial final tree.
- Add mutation tests for incomplete stage, failed repair, valid-final preservation, and successful publication.

Focused check:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests::publication
```

Rollback: remove only direct native install/staging fixtures created by T12; never touch legacy snapshots.

## Step 6 — Implement coalesced manager jobs and internal handoff contract

- Implement `NativeAsrModelManager` with shared process-lifetime job state.
- Add start/status/progress/resolve operations that:
  - return one active job ID per logical model;
  - keep locks out of network waits and large file hashing;
  - retain terminal snapshots for polling;
  - expose source endpoint, bytes, progress, resolved path, and sanitized failure;
  - keep future model identities isolated.
- Add one manager field to `AsrState` so T16 can wire the stable commands without inventing another state owner.
- Keep current sidecar-backed `check_asr_model`, `download_asr_model`, and `get_model_download_progress` behavior unchanged in T12.
- Add concurrency tests proving simultaneous same-model starts perform one network sequence and return the same active job ID.

Focused check:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models::tests::coalesces
cargo test --manifest-path src-tauri/Cargo.toml asr::tests
```

Rollback: remove the `AsrState` field and manager state; public behavior remains Python legacy.

## Step 7 — Run exact real-model and packaged-worker handoff

Preconditions:

- an exact cached legacy snapshot or completed direct install matching the frozen large-v3 manifest;
- the verified T13 packaged CPU runtime.

Checks:

- resolve the exact ready path through T12;
- prove the packaged worker accepts that directory as the `model` role;
- run the smallest available short-audio model-backed smoke needed to prove load/inference compatibility;
- if the parent/T13 release gate still lacks the >10-minute smoke, run it here or record the exact handoff command/result for T18 without changing T12's scope;
- record only hashes, relative/sanitized identities, pass/fail, and timing diagnostics—never transcript text, model bytes, or private absolute paths.

If the local exact model or required smoke media is unavailable, keep the real-model handoff explicitly unverified; do not weaken automated identity/readiness tests or claim AC9.

Rollback: delete only task-local smoke output; never delete shared model caches or benchmark media.

## Step 8 — Full quality gate and planning/task validation

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
python ./.trellis/scripts/task.py validate 08-20-native-asr-model-manager
git diff --check
git status --short
```

Independent review must verify:

- exact large-v3 identity and four-file ordinary Whisper closure;
- no floating revision, arbitrary URL, recursive cache discovery, or Python fallback;
- no ordinary Whisper `preprocessor_config.json` requirement;
- official/China routing reuses existing settings;
- direct/legacy containment and symlink rules;
- resume branches cannot append uncertain bytes;
- hash failure and crash paths cannot publish ready partial data;
- duplicate downloads really coalesce;
- existing valid installs and legacy snapshots survive failures;
- current Python-default commands/frontend remain unchanged;
- no new crate or speculative post-MVP framework was added.

Fix every P0/P1 finding and rerun affected gates before completion.

## Context configuration before activation

`implement.jsonl` must include:

- `.trellis/spec/tauri/paths-and-runtime-deps.md`;
- `.trellis/spec/tauri/async-and-blocking.md`;
- `.trellis/spec/tauri/quality-guidelines.md`;
- `.trellis/tasks/08-20-native-asr-model-manager/research/planning-evidence.md`;
- archived T02 immutable model input lock.

`check.jsonl` must include the same owning path/async/quality contracts plus the parent migration PRD and T12 planning evidence.

Then set task scope, run `task.py validate`, present PRD/design/implement for user review, and only after explicit approval run:

```bash
python ./.trellis/scripts/task.py start 08-20-native-asr-model-manager
```

## Completion gate

Planning is ready for activation only when:

- `prd.md`, `design.md`, and `implement.md` are converged and user-approved;
- both context manifests contain real entries;
- task validation passes;
- the user explicitly approves implementation.

Implementation is complete only when all acceptance criteria have evidence and required checks pass. Do not commit, push, archive, merge, rebase, or reset without separate explicit user authorization.
