# Build Native ASR MVP model manager

## Goal

Deliver the exact native model-management capability required by the first Hikaru Sub Native ASR MVP: identify, download, verify, install, reuse, and resolve `faster-whisper / large-v3` as an immutable CTranslate2 model without Python.

This task is T12 in the Native ASR migration roadmap and has priority P1. It delivers a production-ready model-manager contract for T16–T18, but does not switch the current Python-default product route.

## Background and authority

- The parent migration fixes the first Native MVP route as Windows x64, built-in CPU runtime, `faster-whisper / large-v3 / CTranslate2`, with no bundled model weights.
- T13 has delivered the final CPU runtime artifact. T16 depends on T12 and T13; T17 depends on T16 and T12 metadata; T18 owns release cutover.
- Archived T02/T06/T07 evidence freezes the model repository, revision, file identities, and native-worker compatibility.
- The official immutable repository metadata identifies the model as a CTranslate2 conversion licensed under MIT.
- Model readiness is only an artifact-integrity statement. It does not claim subtitle-quality qualification, runtime availability, route enablement, or release readiness.

## Frozen MVP identity

- Logical identity: `faster-whisper/large-v3`
- Repository: `Systran/faster-whisper-large-v3`
- Revision: `edaa852ec7e145841d8ffdb056a99866b5f0a478`
- Backend/format: `ctranslate2`
- License: MIT
- Attribution: Systran conversion of `openai/whisper-large-v3`

Required files:

| Role | File | Bytes | SHA-256 |
|---|---|---:|---|
| model-config | `config.json` | 2,394 | `a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9` |
| model-weights | `model.bin` | 3,087,284,237 | `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1` |
| tokenizer | `tokenizer.json` | 2,480,617 | `6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca` |
| vocabulary | `vocabulary.json` | 1,068,114 | `c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1` |

Ordinary faster-whisper readiness must not require `preprocessor_config.json`; that requirement remains Kotoba-only.

## Requirements

### R1 — Versioned trusted manifest

- Add a bundled, versioned manifest that is the sole runtime authority for native model repository, revision, backend, format, license, attribution, required file roles, exact sizes, and SHA-256 values.
- The schema may represent future entries, but T12 contains only the MVP large-v3 entry.
- Runtime code must reject unsupported schema versions, duplicate logical identities, unsafe relative paths, missing required metadata, and malformed hashes before network or filesystem mutation.
- `main`, model aliases, repository-name matching, and Python framework metadata must never substitute for the frozen revision.

### R2 — Managed paths and containment

- New native installs live under `deps/models/ctranslate2`.
- Partials and staging trees live under `deps/downloads/native-asr-models`.
- Every manifest-derived path must remain a normal relative path below its owning managed root.
- Cleanup of failed/stale T12 staging data must remain within the exact managed download namespace.
- Direct native installs must reject required-file symlinks. Legacy Hugging Face snapshot symlinks may be reused only when their canonical targets remain inside the managed Hugging Face root.

### R3 — Exact readiness and ready-path resolution

- A model is ready only when every required file exists with the exact size and SHA-256 from the bundled manifest.
- Missing files, directories in place of files, wrong sizes, wrong hashes, symlink escapes, incomplete staging trees, or identity drift must fail closed.
- Resolution prefers a valid direct native install, then a valid exact legacy Hugging Face CT2 snapshot.
- Readiness returns the exact resolved model directory and its origin to Rust consumers.
- Unsupported/post-MVP model IDs return an explicit unavailable disposition rather than falling back to Python or another model.

### R4 — Official and China source routing

- Reuse the existing runtime source setting. Do not add another model-source preference.
- Official downloads resolve against Hugging Face; China downloads resolve against the configured `hf-mirror` endpoint.
- URLs are derived only from trusted manifest repository/revision/file values and the bundled source profile.
- Redirects may be followed, but no credentials, headers, subtitles, or private user data may be logged.

### R5 — Resumable verified download

- Download each required file through a managed `.part` file.
- Resume when the server returns a valid matching range response.
- If a server ignores the range, reports an incompatible range, or the partial exceeds the expected size, restart that file safely rather than appending corrupt bytes.
- Verify exact final size and SHA-256 before a file enters the install staging tree.
- Progress reports aggregate downloaded and total bytes across the complete model.
- A network failure or hash failure must preserve useful resumable partials but must never create a ready model.

### R6 — Atomic install and failure preservation

- Verify the complete staged model before publishing the immutable revision directory.
- A valid existing final install is never replaced or damaged.
- An invalid existing final directory may be replaced only after the new staging tree fully verifies.
- Interrupted or failed installation leaves no partial final directory that can pass readiness.
- Successful installation resolves to the same exact model identity used by the native worker and T13/T18 smoke tests.

### R7 — Duplicate-download coalescing and stable job state

- Concurrent requests for the same logical model identity return the same active job rather than starting duplicate 3 GB downloads.
- Job state exposes a stable ID, running/completed/failed status, aggregate progress, downloaded bytes, total bytes, resolved path on success, source identity, and a sanitized error on failure.
- Job state remains available for polling after terminal completion during the application process lifetime.
- Different future model identities must not share progress or failure state.

### R8 — Compatibility and handoff

- T12 must not change the current production Python-default transcription route or silently rewire the existing frontend model commands.
- T12 exposes a Rust-owned internal contract that T16 can wire into the stable Tauri command names and T17 can represent in the frontend.
- The contract must distinguish:
  - large-v3 supported but missing;
  - large-v3 ready with an exact resolved path;
  - known post-MVP models unavailable;
  - unknown/unsupported identities.
- Existing managed Hugging Face snapshots are read-only reuse candidates; T12 does not copy, mutate, or delete them.

## Acceptance criteria

- [ ] AC1: The bundled manifest contains the exact large-v3 repository, immutable revision, backend/format, MIT attribution, and all required file roles/sizes/SHA-256 values.
- [ ] AC2: Manifest validation rejects unsupported versions, unsafe paths, duplicate identities, malformed hashes, and incomplete entries.
- [ ] AC3: Exact direct installs and exact managed legacy snapshots resolve ready; missing, wrong-size, wrong-hash, wrong-revision, framework-cache, and symlink-escape cases do not.
- [ ] AC4: Official and China URL resolution is deterministic and uses only bundled manifest/source-profile data.
- [ ] AC5: Fresh download, valid resume, ignored-range restart, bad-range restart, network interruption, wrong hash, and partial-file recovery tests pass.
- [ ] AC6: Full staging verification precedes final publication; failed replacement preserves an existing valid install, and no partial final directory reports ready.
- [ ] AC7: Simultaneous same-model requests coalesce to one job and one network transfer; terminal snapshots remain pollable.
- [ ] AC8: Installed and portable executable-root layouts resolve the same bounded `deps` structure without AppData model storage.
- [ ] AC9: The resolved large-v3 path is accepted by the packaged native CPU worker for the T12-backed smoke handoff.
- [ ] AC10: Current Python-default commands and frontend behavior remain unchanged until T16/T17/T18.
- [ ] AC11: Focused Rust tests and `cargo test --manifest-path src-tauri/Cargo.toml` pass; `pnpm build` confirms no cross-layer contract regression.

## Out of scope

- Native inference implementation or subtitle-quality changes.
- CPU/GPU runtime packaging, device detection, or GPU packs.
- Production route cutover, settings migration, or Python dependency removal.
- Frontend model-manager UX changes.
- Models other than faster-whisper large-v3.
- Companion/group policy for Kotoba, Qwen3, Parakeet, or ReazonSpeech.
- Importing arbitrary user models or custom download URLs.
- Copying or mutating legacy Hugging Face snapshots.
- A persistent verification cache before readiness hashing is measured as a real bottleneck.

## Dependencies and rollback boundary

- Depends on archived T02 model-format evidence and the parent managed-path/source contracts.
- Produces the model identity/readiness/download contract consumed by T16–T18.
- Rollback removes the native model manifest/module and its managed staging/install data only. It does not delete legacy Hugging Face snapshots, user projects, settings, subtitles, or the Python-default route.
