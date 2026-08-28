# T17 Native ASR frontend migration implementation plan

> Status: planning. Do not run `task.py start` until the user reviews these artifacts. Do not commit, push, merge, rebase, reset, archive, or start T18 without separate explicit authorization.

## Step 0 - Confirm the T16 handoff and T18 boundary

- Re-read the final T16 implementation evidence and current `AsrEngineInfo`, `AsrModelStatus`, runtime dependency, and Tauri wrapper types.
- Confirm the stable command names and optional Native metadata still match this plan.
- Confirm Release/default remains legacy and no T18 package/route work has landed concurrently.
- Load `trellis-before-dev` for the frontend layer before editing.

Stop and revise the plan if T16 payload names changed. Do not add a parallel command or support registry to compensate.

Rollback: none; evidence gate only.

## Step 1 - Add focused failing availability/select tests

Create the smallest tests proving the new behavior before deleting legacy UI:

- extend the existing Select adapter contract so disabled options render as disabled Radix items;
- engine/model/device option derivation keeps every known option visible;
- Faster-Whisper `large-v3` and Native `auto`/CPU are enabled under T16 metadata;
- post-MVP engines/models and CUDA are disabled with reason copy;
- an unavailable persisted selection remains the selected value and is not rewritten;
- stale availability results cannot overwrite a newer engine/model selection.

Prefer testing one shared pure projection/helper plus one component integration instead of duplicating the matrix in every view.

Likely tests:

- `src/constants/asr.test.ts` or a focused new availability helper/hook test;
- `src/components/ui/select-adapter.test.tsx` only if disabled behavior is not already covered through a workflow component;
- `src/components/workflow/SettingsTranscriptionPanel.test.tsx`.

Focused command:

```bash
pnpm test -- src/constants/asr.test.ts src/components/workflow/SettingsTranscriptionPanel.test.tsx
```

Rollback: remove only new tests/helpers; product behavior remains unchanged.

## Step 2 - Implement one shared availability owner

- Reuse `ASR_ENGINE_OPTIONS`, `ASR_ENGINE_MODELS`, `defaultAsrModel`, `asrModelOptions`, `listAsrEngines`, and `checkAsrModel`.
- Add the smallest shared hook/domain helper that loads engine metadata and model status for the selected engine, exposes selected route usability, derives disabled option labels, and ignores stale requests.
- Avoid duplicate exact large-v3 readiness scans between selector logic and `ModelManager`; share the selected status/refresh path rather than calling `checkAsrModel` independently from multiple owners in one mounted view.
- Treat missing optional Native fields as a legacy compatibility case, not as permission to reinterpret Native unavailable as Python setup.
- Centralize the duplicated ASR device option list and derive disabled state from engine metadata.
- Extend `SelectOption` with optional `disabled` and pass it to `SelectItem`.

Do not add Zustand state, caching infrastructure beyond the mounted availability owner, another registry, or a new Tauri command.

Focused checks:

```bash
pnpm test -- src/constants/asr.test.ts
pnpm build
```

Rollback: restore static options and adapter shape; no persisted data changes.

## Step 3 - Migrate ModelManager to Native dispositions

Add/extend `src/components/workflow/ModelManager.test.tsx` for:

- `ready` -> ready status, no download button;
- `supportedMissing` -> download button and existing progress flow;
- `postMvpUnavailable` -> visible reason, no download/setup action;
- `unsupported` -> unsupported reason, no download/setup action;
- detection failure -> controlled retryable error;
- engine/model change ignores stale checks;
- same download request is reused and successful completion refreshes shared status.

Then update `ModelManager` minimally:

- consume the shared selected-model status/refresh owner;
- remove `asrSidecarError` imports and missing-Python interpretation;
- preserve polling, progress, diagnostics, promise coalescing, and imperative methods;
- return `unavailable` for deferred/unsupported models without suggesting Python fallback.

Focused command:

```bash
pnpm test -- src/components/workflow/ModelManager.test.tsx
```

Rollback: restore the old selected-model status rendering; T16 backend remains unchanged.

## Step 4 - Remove Python setup UI and frontend-only contracts

Delete or simplify only after callers have migrated:

- remove `AsrEngineSetupPanel` from `SettingsTranscriptionPanel`;
- remove setup lifecycle props/state/callbacks from `SettingsTranscriptionPanel` and `SettingsView`;
- remove Python/venv preparation and cleanup branches from runtime dependency UI;
- delete `src/components/workflow/AsrEngineSetupPanel.tsx`;
- delete `src/constants/asrSetup.ts` and `src/constants/asrSetup.test.ts`;
- remove ASR setup wrappers/imports from `src/services/tauri.ts`;
- remove setup-only types and legacy frontend settings fields from `src/types/index.ts`;
- remove frontend runtime kinds/labels `python311` and `asrVenv`;
- delete setup wrapper assertions and retain the unrelated FFmpeg cache test under an accurate filename;
- remove `asrSidecarError.ts` and its tests if no caller remains.

Do not remove Rust commands, Rust compatibility settings fields, Python source/resources, or backend legacy enum variants.

Update runtime/settings component tests to prove:

- no Python/venv/pip/setup copy or action is rendered;
- Native CPU runtime is status-only;
- missing Native runtime copy indicates an application/runtime problem;
- ASR model action still navigates to Transcription;
- normal settings Save behavior remains intact.

Focused commands:

```bash
pnpm test -- src/constants/runtimeDependencies.test.ts
pnpm test -- src/components/workflow/SettingsTranscriptionPanel.test.tsx
pnpm test -- src/components/workflow/RuntimeDependenciesPanel.test.tsx
pnpm build
```

Use actual added test filenames; do not create empty suites only to match this plan.

Rollback: restore the removed frontend files and call sites only; user settings/model data remain untouched.

## Step 5 - Migrate TranscribeView availability and start gating

Add a focused `src/components/workflow/TranscribeView.test.tsx` covering the T17 changes without cloning the full transcription suite:

- engine/model/device availability loads automatically or through one generic retry path;
- sidecar/Python setup copy is absent;
- unavailable/deferred route disables Start and shows the T16 reason;
- persisted unavailable selection remains visible until the user explicitly switches;
- large-v3 supported-missing opens the existing confirmation and successful download continues to `startAsr`;
- Native start sends `useVad: false` and `vadConfig: null`;
- a stale availability result after engine/model change cannot start the wrong route;
- existing cancel and document-guard behavior touched by the edit remains covered.

Then update `TranscribeView`:

- use the shared availability owner and disabled options;
- replace sidecar/manual setup state with generic Native availability/loading/error state;
- remove the Python-settings jump and sidecar-specific error classification;
- remove the runnable VAD controls for the MVP while retaining request schema compatibility;
- keep all audio/model/job/document/ASS logic otherwise unchanged.

Focused command:

```bash
pnpm test -- src/components/workflow/TranscribeView.test.tsx
```

Rollback: restore only the old presentation/gate; do not touch backend jobs or model data.

## Step 6 - Cross-layer and deletion audit

Search the frontend for residual production setup concepts:

```bash
rg -n "AsrEngineSetupPanel|resolveAsrSetupProfile|probeAsrSetupEnvironment|startAsrSetup|getAsrSetupProgress|cancelAsrSetup|pythonPath|asrServicePath|python311|asrVenv|配置当前引擎依赖|虚拟环境|sidecar 就绪|无法启动 sidecar" src
```

Expected result: no product frontend caller/copy remains. Synthetic historical strings may remain only where deliberately testing removed/legacy behavior is still justified; otherwise delete them.

Review the full flow:

```text
T16 engine/model/runtime payloads
  -> shared TypeScript types + tauri.ts
  -> one availability owner
  -> disabled Settings/Transcribe options + ModelManager
  -> existing start/progress/cancel/ASS pipeline
```

Verify:

- no second support registry or raw invoke exists;
- no automatic settings rewrite exists;
- no unavailable route can call `startAsr`;
- no Python fallback/setup action exists in T17 UI;
- no VAD/CUDA route is presented as runnable;
- no T18 route-policy/package file changed;
- no unrelated translation/editor/burn code changed.

## Step 7 - Full validation

Run and fix every failure:

```bash
pnpm test
pnpm build
python ./.trellis/scripts/task.py validate 08-28-native-asr-frontend-migration
git diff --check
git status --short
```

Rust tests are not required when the final diff is frontend/task-only. If implementation changes any Rust/Tauri backend file, stop and revise scope, then run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Step 8 - Independent quality gate and handoff

- Dispatch `trellis-check` with the current task context.
- Verify PRD acceptance criteria, cross-layer metadata use, stale-request handling, deletion completeness, no duplicate registry, and preserved transcription/document/ASS behavior.
- Fix every P0/P1 issue and rerun focused/full checks.
- Update `.trellis/spec/frontend/` only for durable contracts that actually changed; T18 package/route behavior must not be documented as completed.
- Record implementation evidence without transcript text, model bytes, secrets, request bodies, or private absolute paths.
- Present results and ask separately whether the user wants a commit. Do not commit or archive automatically.

## Completion gate

- Python setup UX and frontend-only setup contracts are gone.
- Runtime, engine, model, and device states are presented from T16 metadata.
- Only the Native large-v3 CPU route is runnable; deferred routes remain visible with reasons.
- Model download and transcription job/document/ASS flows are regression-free.
- T18 boundary remains intact.
- Focused/full tests, build, task validation, diff check, and independent review pass.
