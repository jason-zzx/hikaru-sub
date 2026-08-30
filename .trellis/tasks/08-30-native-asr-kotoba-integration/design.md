# Native Kotoba ASR Integration Design

## Summary

This task promotes the already-implemented and archived accepted Kotoba K2 route into Hikaru Sub's production Native ASR stack. It does not design another recognition algorithm. The production slice remains one deep cross-layer module behind the existing command interface:

```text
React availability/model UI
        |
        | existing typed Tauri commands
        v
Tauri Native ASR orchestration
  model manifest + runtime identity + job host
        |
        | existing protocol v1 request/JSONL events
        v
bundled hikaru-asr-worker.exe
  faster-whisper + Kotoba K2 / CTranslate2 / CPU
```

No new Tauri command, frontend state store, worker process, backend registry, Python route, GPU pack, or protocol version is introduced.

## Decisions

### D1 - Kotoba Is Optional, Not The Default

The user confirmed that `faster-whisper / large-v3` remains the default for new sessions. `kotoba-faster-whisper` becomes a selectable Japanese-optimized route. Existing valid saved settings remain unchanged.

### D2 - Reuse Accepted K2 Without A New Quality Gate

The worker reuses `kotoba-k2-bounded-stride-overlap5-latest-start-owner-v1` exactly:

- 1500-frame / 15-second maximum source window;
- 1000-frame / 10-second maximum applied stride;
- at least 500 frames / 5 seconds overlap for full windows;
- latest-start half-open ownership;
- exact tuple dedup before callbacks;
- beam 5, Japanese, no previous-text history, no VAD;
- token-derived text and timestamps without clipping, synthesis, fuzzy merge, reference repair, or gap fill.

Archived K2 and later legacy-relative quality dispositions remain immutable. Product acceptance uses functional output, timeline legality, runtime/model integrity, lifecycle behavior, packaging, and UI flow—not K3 or Python parity.

### D3 - Keep Existing Interfaces

The stable interfaces already have enough depth:

- React uses `listAsrEngines`, `checkAsrModel`, `downloadAsrModel`, `getModelDownloadProgress`, `startAsr`, `getAsrProgress`, and `cancelAsr` through `src/services/tauri.ts`.
- Tauri passes the existing protocol v1 request and consumes the existing JSONL event stream.
- `AsrEngineInfo`, `AsrModelStatus`, `AsrJobSnapshot`, model-download snapshots, and ASS generation remain unchanged.

Kotoba is enabled by changing the implementations behind these interfaces. Adding Kotoba-specific commands or frontend state would duplicate the existing model/runtime lifecycle.

### D4 - The Model Manifest Remains The Support Authority

`src-tauri/resources/native-asr-models.json` is the single production authority for a supported engine/model pair. Tauri engine availability should be derived from manifest entries plus the explicit deferred-engine list, rather than introducing another hard-coded supported-engine table.

`start_asr` performs generic Native CPU request validation (device, language, VAD), then relies on model-manager disposition to decide whether the engine/model is supported and ready. This removes the current duplicate `engine == faster-whisper` gate.

### D5 - Preserve The Existing Product Model ID Safely

The external model ID remains:

```text
kotoba-tech/kotoba-whisper-v2.0-faster
```

This preserves existing settings and frontend constants. The manifest validator will accept either:

- one safe model path segment, used by current Faster-Whisper IDs; or
- one repository-style `owner/name` ID whose two segments independently pass the existing safe-segment validation.

Managed direct/download paths may therefore contain the two validated model-ID segments below the fixed engine root. Absolute paths, drive prefixes, backslashes, `.`/`..`, additional separators, reserved Windows names, control characters, and containment escapes remain rejected. No new `storageId` schema field is needed.

### D6 - Extend The Existing CPU Artifact

The release build keeps the current CTranslate2/oneDNN/tokenizer DLL closed set. `HIKARU_ASR_MVP_CPU_RUNTIME` continues to mean the restricted production CPU build, but its route gate changes from ordinary Faster-Whisper only to exactly:

- `faster-whisper -> ctranslate2 -> cpu`
- `kotoba-faster-whisper -> ctranslate2 -> cpu`

CrispASR, Qwen3, Parakeet, ReazonSpeech, VAD, CUDA, and Vulkan remain unavailable. The runtime lock and generated manifest advance to a new artifact identity and list both engines. The existing singular `candidateConfig` record is updated to identify the combined production configuration bundle; a new manifest schema is unnecessary because callers only need artifact identity and capabilities.

### D7 - Frontend Reuses Existing Availability UX

`ASR_ENGINE_OPTIONS` and `ASR_ENGINE_MODELS` already contain Kotoba. `useAsrAvailability`, `ModelManager`, `SettingsTranscriptionPanel`, and `TranscribeView` already handle supported-missing, downloading, ready, and unavailable states.

Therefore the minimum frontend implementation is:

- consume the new Tauri availability/status results;
- keep Kotoba enabled when supported/ready;
- keep CUDA disabled;
- retain large-v3 as default;
- update focused tests and any stale “后续版本支持” expectations.

No new page, dialog, model manager, store, or duplicate availability mapping is added.

## Exact Model Contract

The new manifest entry uses:

| Field | Value |
|---|---|
| engine | `kotoba-faster-whisper` |
| model | `kotoba-tech/kotoba-whisper-v2.0-faster` |
| backend / format | `ctranslate2` |
| repository | `kotoba-tech/kotoba-whisper-v2.0-faster` |
| revision | `f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc` |
| license | MIT |

Exact files inherited from the archived K2/K1 lock:

| Role | Path | Bytes | SHA-256 |
|---|---|---:|---|
| `model-config` | `config.json` | 2,394 | `a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9` |
| `model-weights` | `model.bin` | 1,512,927,867 | `60d2bc2e33de9d43f2745be09caefe1161acab670f6796d4a750d8d848382b36` |
| `preprocessor` | `preprocessor_config.json` | 340 | `7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711` |
| `tokenizer` | `tokenizer.json` | 2,481,381 | `f70c9740a90657b489cf05b0fa0605c1d497db542f11a70a8cc80a025c94c7d8` |
| `vocabulary` | `vocabulary.json` | 1,068,114 | `c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1` |

The generic model manager already verifies every listed file, so including the `preprocessor` role makes it mandatory for download/direct/legacy readiness without a second Kotoba-only downloader. The worker remains the final semantic validator for non-empty preprocessor metadata and loaded 128-Mel shape.

## Cross-Layer Data Flow

```text
1. React selects kotoba-faster-whisper
2. useAsrAvailability -> list_asr_engines + check_asr_model
3. Tauri manifest lookup returns supportedMissing or ready
4. ModelManager reuses download_asr_model/progress when missing
5. start_asr validates auto|cpu + ja + no VAD
6. model manager resolves the exact direct or legacy snapshot path
7. Tauri starts the bundled worker with engine=kotoba-faster-whisper
8. worker selects kotoba_k2_config and validates preprocessor/128 Mel
9. existing ready/progress/segment/completed events update AsrJobSnapshot
10. existing React flow writes and loads the transcribed ASS
```

Failure ownership remains local:

- model identity/download/readiness failures: Tauri model module;
- runtime artifact mismatch: Tauri runtime module;
- route/model/audio/inference failures: worker protocol error;
- display/retry/download interaction: existing React availability/model modules.

## Tauri Changes

### Model Module Seam

`asr_models` continues to hide manifest parsing, source URL derivation, resume/hash/atomic install, direct/legacy resolution, cache, and containment behind its existing status/download/resolve interface.

Implementation changes:

- add the exact Kotoba manifest entry;
- allow validated repository-style product model IDs;
- remove Kotoba from deferred-only classification;
- derive engine availability from manifest support;
- add containment/readiness/download tests for the nested safe model ID and required preprocessor file.

### Runtime Module Seam

`dependencies::resolve_native_asr_cpu_runtime` keeps the same interface. Its implementation accepts only the new artifact identity with capabilities exactly equal to CPU CTranslate2, both released engines, no VAD/GPU/CrispASR, and no bundled models.

### ASR Command Seam

`asr.rs` keeps the same Tauri command interface. Implementation changes:

- rename/generalize the MVP request validator;
- remove the duplicated faster-whisper-only engine check;
- report Kotoba available from manifest support;
- retain generic status handling and existing job lifecycle;
- extend focused tests to cover Kotoba success eligibility and unsupported engine rejection.

## Native Worker And Packaging Changes

- Change the restricted production route check to allow ordinary Faster-Whisper and Kotoba only.
- Preserve the non-production/development switches and rejected VAD behavior.
- Replace the release assertion that currently expects Kotoba `route_not_built` with assertions that:
  - Kotoba reaches model validation under the release worker;
  - Kotoba VAD fails with `kotoba_vad_not_qualified`;
  - unsupported routes remain controlled failures.
- Rebuild and attest the Windows x64 CPU artifact with a new artifact ID, worker hash, archive hash, capabilities list, combined candidate-config identity, `SHA256SUMS`, and runtime resource copy.
- Model weights and the model's license text are not bundled in the CPU runtime. Model MIT attribution remains in the trusted model manifest/notices documentation.

## Frontend Changes

No frontend production module needs a new interface. Update only what the new backend state makes stale:

- availability tests include Kotoba as enabled CPU and Qwen/Parakeet/Reazon as deferred;
- model option tests accept Kotoba `supportedMissing|ready`;
- settings/transcription tests cover selecting Kotoba without changing the default;
- user-facing description remains truthful and does not claim a new quality revision.

If existing components already render the correct enabled/downloadable state from the returned status, do not add presentational code merely to make the diff look cross-layer.

## Compatibility And Migration

- Existing default remains `faster-whisper / large-v3`.
- Existing saved Kotoba engine/model values become usable once the model/runtime is available; no settings rewrite is required.
- Existing direct Faster-Whisper model directories are unchanged.
- Exact legacy Kotoba snapshots can be reused read-only after full manifest verification.
- Existing downloaded Kotoba data is never deleted automatically during enablement or rollback.
- Protocol v1, command names, TypeScript types, ASS output paths, and recovery snapshots do not change.

## Security And Privacy

- The repository-style model ID is validated before path joins; every component remains relative and contained.
- Download URLs still derive only from trusted manifest repository/revision/file fields and the official/China source profiles.
- Model, audio, output, and cache paths remain local and structured; no shell-string interpolation is added.
- Logs must not include subtitle text, request bodies, headers, or private model paths beyond existing bounded diagnostics.

## Rollout And Rollback

### Rollout

1. Add exact model support and tests.
2. Enable and test the release worker route.
3. Build/attest the new CPU artifact and update Tauri runtime identity.
4. Enable Tauri engine routing and lifecycle coverage.
5. Update frontend expectations and run end-to-end model-backed smoke.
6. Update README/notices/specs only after the architecture is verified.

### Rollback

A patch rollback may:

- remove the Kotoba manifest entry from supported production models;
- report Kotoba unavailable again;
- restore the previous CPU artifact identity/resource;
- leave any valid downloaded Kotoba model untouched.

Rollback must not change Faster-Whisper defaults, delete user settings/models/subtitles, or restore packaged Python fallback.

## Validation Strategy

Automated validation:

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
# configured Native worker CTest for the release CPU build
```

Model-backed validation uses the exact manifest model:

- short Japanese audio: download/readiness/load/start/completion/ASS;
- >10-minute Japanese audio: completion, progress, legal timeline, non-empty text;
- cancellation while running;
- offline cached-model rerun;
- installed and portable resource/path layouts when build artifacts are available.

Quality metrics may be recorded diagnostically but do not decide acceptance.
