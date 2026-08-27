# Native ASR MVP model manager design

## Summary

T12 adds a small Rust-owned model-delivery module for one immutable CTranslate2 artifact. It reuses the existing runtime source setting and dependencies, validates every required byte, installs below the executable-adjacent `deps` root, and returns a resolved model directory for later native launch wiring.

```text
bundled native-asr-models.json
        + runtime source profile
                  |
                  v
        NativeAsrModelManager
        /         |          \
 status       download      resolve
   |              |            |
 direct install <-+-> staging   +-> direct exact path
 legacy snapshot ---- verify    +-> legacy exact snapshot
```

T12 deliberately does not rewire the existing sidecar-backed Tauri commands. T16/T17 own that cross-layer switch; T18 owns the production default.

## Existing seams reused

- `dependencies.rs` already owns executable-adjacent `deps`, `deps/downloads`, `deps/models/huggingface`, writable/elevation checks, and official/China source selection.
- `reqwest`, `futures`, and `sha2` already implement streaming and hashing elsewhere in the Rust backend.
- `AsrState` already owns ASR process/job state. T12 can add one `NativeAsrModelManager` field without changing current command behavior.
- `ResolvedNativeLaunch` already accepts an absolute model directory. T16 will pass T12's resolved path into that existing seam.
- `httpmock` and `tempfile` are already available for deterministic downloader and path tests.

No new dependency, daemon, database, background service, or frontend state is required.

## Proposed files

| File | Change |
|---|---|
| `src-tauri/resources/native-asr-models.json` | New bundled schema-v1 manifest containing only large-v3. |
| `src-tauri/src/asr_models.rs` | New manifest validation, path resolution, readiness, download jobs, resume, verification, staging publication, and tests. |
| `src-tauri/src/dependencies.rs` | Expose minimal crate-local helpers for `deps/downloads`, direct CT2 model root, and existing Hugging Face root; preserve current probe/measure behavior. |
| `src-tauri/src/asr.rs` | Store a `NativeAsrModelManager` inside `AsrState`; do not change current public model commands. |
| `src-tauri/src/lib.rs` | Declare the new module only. No command registration changes in T12. |

If implementation can keep tests inside `asr_models.rs`, no separate test file is added.

## Manifest contract

The bundled file is trusted release input but still validated before use.

```json
{
  "schemaVersion": 1,
  "models": [
    {
      "logicalId": "faster-whisper/large-v3",
      "engine": "faster-whisper",
      "model": "large-v3",
      "backend": "ctranslate2",
      "format": "ctranslate2",
      "repository": "Systran/faster-whisper-large-v3",
      "revision": "edaa852ec7e145841d8ffdb056a99866b5f0a478",
      "license": {
        "spdx": "MIT",
        "attribution": "Systran conversion of openai/whisper-large-v3",
        "source": "https://huggingface.co/Systran/faster-whisper-large-v3/tree/edaa852ec7e145841d8ffdb056a99866b5f0a478"
      },
      "files": [
        {
          "role": "model-config",
          "path": "config.json",
          "sizeBytes": 2394,
          "sha256": "..."
        }
      ]
    }
  ]
}
```

Validation rules:

- schema version exactly `1`;
- one row per `(engine, model)` and `logicalId`;
- engine/model/backend/format/repository/revision non-empty and free of ASCII controls;
- revision is the exact 40-character lowercase commit hash for this release;
- file path is one normal relative component for T12; no root, drive prefix, `.` or `..`;
- role and file path unique within a model;
- size positive and SHA-256 exactly 64 lowercase hex characters;
- required roles for the MVP entry are config, weights, tokenizer, and vocabulary;
- no floating alias or user-provided manifest override.

The schema is a list so future tasks can append model rows. It does not add companion groups, fallback policy, devices, or UI labels that T12 does not need.

## Path layout

Given executable root `<app>`:

```text
<app>/deps/
├─ models/
│  ├─ ctranslate2/
│  │  └─ faster-whisper/
│  │     └─ large-v3/
│  │        └─ edaa852ec7e145841d8ffdb056a99866b5f0a478/
│  │           ├─ config.json
│  │           ├─ model.bin
│  │           ├─ tokenizer.json
│  │           └─ vocabulary.json
│  └─ huggingface/                       # existing legacy cache; read-only to T12
│     └─ hub/models--Systran--faster-whisper-large-v3/
│        └─ snapshots/<revision>/
└─ downloads/
   └─ native-asr-models/
      └─ faster-whisper/large-v3/<revision>/
         ├─ parts/<file>.part
         └─ stage-<job-id>/
```

All model-manager path builders accept a test root, making installed and portable behavior the same pure layout calculation. Production obtains that root from existing executable-adjacent `deps` helpers.

Path policy:

- manifest segments are validated before joining;
- direct required files must be regular non-symlink files;
- legacy snapshot files may be Hugging Face symlinks, but both snapshot directory and canonical file target must remain under the canonical managed Hugging Face root;
- model-manager cleanup receives only its exact download namespace, never an arbitrary caller path;
- T12 does not delete or rewrite the legacy root.

## Model dispositions and internal contract

```rust
enum NativeAsrModelDisposition {
    SupportedMissing,
    Ready,
    PostMvpUnavailable,
    Unsupported,
}

struct NativeAsrModelStatus {
    engine: String,
    model: String,
    backend: Option<String>,
    revision: Option<String>,
    disposition: NativeAsrModelDisposition,
    origin: Option<NativeAsrModelOrigin>,
}

struct ResolvedNativeAsrModel {
    logical_id: String,
    backend: String,
    revision: String,
    path: PathBuf,
    origin: NativeAsrModelOrigin,
}
```

Known current product model IDs other than large-v3 return `PostMvpUnavailable`; arbitrary unknown IDs return `Unsupported`. The known list should reuse the existing engine registry/constant if one already exists during implementation; otherwise T12 keeps the minimum ordinary faster-whisper set required by the parent roadmap in one local constant, without adding a generic policy framework.

`resolve_ready_model` returns `ResolvedNativeAsrModel` only for `Ready`; callers cannot obtain a path from a merely supported or post-MVP row.

## Readiness algorithm

For the exact manifest row:

1. Build the direct immutable revision path.
2. Validate all required files:
   - path type and symlink policy;
   - exact byte size;
   - exact SHA-256.
3. If valid, return `Ready / DirectInstall`.
4. Otherwise build the exact legacy Hugging Face snapshot path.
5. Canonicalize the managed Hugging Face root and candidate snapshot.
6. Require the snapshot and every resolved file target to stay below that root.
7. Validate the same exact sizes and SHA-256 values.
8. If valid, return `Ready / LegacyHuggingFaceSnapshot`; otherwise return `SupportedMissing`.

T12 performs full exact hashing during readiness rather than introducing a persistent trust cache. Hashing and other blocking filesystem verification run through `spawn_blocking`, not on the async runtime. This is the shortest fail-closed implementation. If profiling later shows unacceptable latency, a future task may add a receipt/cache that preserves exact invalidation guarantees.

Malformed or unreadable candidates are treated as not ready for status queries and return a sanitized diagnostic from explicit resolution APIs. Network is never used during readiness.

## Source resolution

The manifest stores repository, revision, and relative file paths. Runtime source selection supplies the endpoint:

- official: `https://huggingface.co`;
- China: existing `huggingfaceEndpoint`, currently `https://hf-mirror.com`.

A file URL is:

```text
{endpoint}/{repository}/resolve/{revision}/{relative-file}
```

Only bundled values participate. The `reqwest::Client` follows normal redirects and uses a bounded request timeout. Logs and snapshots identify the source mode/endpoint but never include credentials or response bodies.

## Download job state

`NativeAsrModelManager` is cloneable and owns shared state through `Arc`:

```rust
struct NativeAsrModelManager {
    jobs: Arc<Mutex<HashMap<String, Arc<Mutex<ModelDownloadJob>>>>>,
    active_by_model: Arc<Mutex<HashMap<String, String>>>,
}
```

The real implementation may combine these maps if that is shorter while retaining these invariants:

- one active job per logical model;
- repeated same-model start returns the active job ID;
- terminal snapshots remain pollable;
- terminal job removal from `active_by_model` does not remove its snapshot;
- no lock is held across network awaits or multi-gigabyte hashing;
- job IDs contain only safe ASCII characters for managed staging names.

Snapshot fields:

- `id`;
- `engine`, `model`, `revision`;
- `status: running | completed | failed`;
- `progress: Option<f64>`;
- `downloadedBytes`, `totalBytes`;
- `sourceEndpoint`;
- `resolvedPath` on success;
- sanitized `error` on failure.

T12 does not add cancellation because the stable product API has no model-download cancellation command and the PRD does not require one.

## Per-file resume behavior

For each file in manifest order:

1. Inspect the stable `.part` file.
2. If length is greater than expected, delete and restart.
3. If length equals expected, verify SHA-256:
   - valid: reuse without network;
   - invalid: delete and restart.
4. If length is between zero and expected, request `Range: bytes=<length>-`.
5. Response handling:
   - `206` with a matching `Content-Range` start: append;
   - `200`: truncate and treat as a fresh response;
   - incompatible/missing range on `206`, `416`, or another non-success response: discard/restart once or fail with a controlled error; never append uncertain bytes.
6. Reject transfer growth beyond the expected size.
7. Flush and close the part, then verify exact size and SHA-256.
8. Copy/rename the verified file into the job staging tree.

Progress is the sum of already-valid bytes plus streamed bytes across all required files, capped below completion until the staged tree and final path verify.

A network interruption keeps the bounded `.part` file for a later resume. A hash mismatch deletes the bad completed part so a later request cannot repeatedly reuse known-corrupt bytes.

## Atomic publication

1. Create a unique staging tree below the exact model download namespace.
2. Populate it only with fully verified files.
3. Re-run complete directory validation on the stage.
4. If the direct final path already validates, discard stage and return the existing path.
5. If a final path exists but is invalid, rename it to a job-scoped backup inside the same managed namespace or remove it only after stage validation.
6. Ensure the final parent exists and rename the complete stage directory to the immutable revision path.
7. Validate the published final directory once more.
8. Remove any invalid backup and completed part files only after success.

No partial file is ever streamed directly into the final directory. A crash before publication leaves only download-namespace data; a crash after rename leaves a complete validated directory.

On Windows, replacing a non-empty directory is not assumed atomic. The revision path is immutable, so the normal successful case is a single rename into a missing final path. Invalid existing directories are a repair path, and readiness remains fail-closed during the brief replacement interval.

## Legacy snapshot reuse

The exact candidate path is derived from the frozen repository and revision. T12 does not perform a recursive cache search and does not accept a model-name-only directory.

Reuse rules:

- snapshot revision directory exactly matches the manifest revision;
- all required logical files exist;
- symlink targets remain under managed Hugging Face cache;
- every size/hash matches;
- no copy or mutation occurs;
- framework caches without the CT2 required closure fail.

A later direct native download may coexist with a valid legacy snapshot. Direct install wins resolution so its lifecycle is independent from future Python cache cleanup.

## Compatibility and rollout

### T12

- Add and test the internal manager.
- Keep `check_asr_model`, `download_asr_model`, and `get_model_download_progress` proxying the sidecar.
- Keep Python-default transcription and all frontend behavior unchanged.

### T16

- Wire the stable Tauri command names and runtime/settings backend to `NativeAsrModelManager`.
- Pass `ResolvedNativeAsrModel.path` into native launch resolution.
- Integrate model storage probe/measure/cleanup semantics.

### T17

- Extend TypeScript/UI status representation and present post-MVP unavailable models.

### T18

- Switch production/default to native large-v3 CPU and remove packaged Python dependencies.

This ordering avoids a mixed state where the UI downloads a native-only direct model and then tries to launch the Python sidecar against the old Hugging Face cache.

## Testing strategy

Tests use temporary roots and `httpmock`; no test downloads the real 3 GB model.

### Manifest and path tests

- valid frozen fixture;
- schema drift, duplicates, unsafe paths, malformed hashes, missing roles;
- direct and legacy path derivation;
- installed-like and portable-like executable roots;
- cleanup containment and symlink escape.

### Readiness tests

Use small fixture files with manifest hashes generated in test:

- exact direct ready;
- direct missing/wrong-size/wrong-hash;
- valid legacy snapshot with contained symlinks where supported;
- legacy wrong revision, framework-only cache, escaped symlink;
- direct preference over legacy;
- post-MVP and unknown disposition.

### Download tests

- fresh multi-file success;
- valid resume with matching `Range` and `Content-Range`;
- server ignores range and returns `200`;
- incompatible `206`, `416`, oversized part;
- interruption preserves partial;
- wrong hash fails and never publishes;
- complete stage publishes only after all files pass;
- existing valid install survives failed download;
- duplicate same-model starts share one job/network sequence;
- terminal snapshots remain pollable.

### Validation

```bash
cargo test --manifest-path src-tauri/Cargo.toml asr_models
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
python ./.trellis/scripts/task.py validate 08-20-native-asr-model-manager
git diff --check
```

Real-model handoff validation uses the frozen cached large-v3 snapshot or a completed direct install and the packaged CPU worker. No tracked output contains model bytes, transcript text, absolute private paths, or full network response bodies.

## Rollback

- Remove `native-asr-models.json` and `asr_models.rs`.
- Remove the minimal path-helper and `AsrState` field changes.
- Delete only `deps/models/ctranslate2` and `deps/downloads/native-asr-models` artifacts created by this manager when explicitly requested.
- Leave `deps/models/huggingface`, user data, settings, subtitles, projects, T13 runtime artifacts, and the Python-default route untouched.

## Decisions

- **D1:** T12 is an internal Rust delivery seam; public command cutover waits for T16/T17.
- **D2:** One bundled manifest is the sole model identity authority; no remote manifest or alias resolution.
- **D3:** Reuse the existing official/China source profile; no second source setting.
- **D4:** Direct installs are immutable revision directories; legacy snapshots are exact, contained, read-only fallback candidates.
- **D5:** Full hashing is the initial readiness rule. Persistent verification caching is deferred until latency is measured.
- **D6:** No download cancellation, companion grouping, or post-MVP model entries in T12.
- **D7:** No new Rust dependency; reuse the existing networking, hashing, async, and test stack.
