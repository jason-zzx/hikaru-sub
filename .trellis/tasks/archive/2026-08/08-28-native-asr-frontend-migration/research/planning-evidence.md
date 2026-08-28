# T17 frontend migration planning evidence

## Roadmap authority

- Parent order is fixed as `(T12 + T13) -> T16 -> T17 -> T18 -> Faster-Whisper model expansion`.
- T12, T13, and T16 are completed and archived.
- T16 intentionally left Release/default routing on the Python legacy route. T18 owns the single Release/default Native flip, packaged Python/sidecar removal, and installed/portable/offline model-backed qualification.
- T17 therefore owns frontend migration only. It must consume the stable T16 command/type payloads without changing route policy or package contents.

Authoritative inputs:

- `.trellis/tasks/07-25-native-asr-migration/{prd.md,design.md,implement.md}`
- `.trellis/tasks/archive/2026-08/08-27-native-asr-runtime-settings-backend/{prd.md,design.md,implement.md}`
- `.trellis/tasks/archive/2026-08/08-27-native-asr-runtime-settings-backend/research/implementation-evidence.md`

## Confirmed T16 frontend handoff

The existing command names remain authoritative:

- `list_asr_engines`
- `check_asr_model`
- `download_asr_model`
- `get_model_download_progress`
- `start_asr`
- `get_asr_progress`
- `cancel_asr`
- `probe_runtime_dependencies`

`AsrEngineInfo` already carries optional `backend`, `device`, and `reason` metadata.

`AsrModelStatus` already carries:

- compatibility booleans `available` and `downloaded`;
- `disposition`: `supportedMissing | ready | postMvpUnavailable | unsupported`;
- optional `backend`, `revision`, `origin`, and `reason`.

Native mapping is backend-owned:

| Disposition | Available | Downloaded | Frontend meaning |
| --- | ---: | ---: | --- |
| `ready` | true | true | runnable now |
| `supportedMissing` | true | false | route exists; offer exact model download |
| `postMvpUnavailable` | false | false | visible, disabled, later-support reason |
| `unsupported` | false | false | visible when known/current, disabled, unsupported reason |

Native `list_asr_engines` reports Faster-Whisper as the built-in CTranslate2 CPU engine and known non-MVP engines as unavailable with a reason. T17 must not reinterpret `available: false` as missing Python.

## Current frontend debt owned by T17

### Python setup UI remains live

- `src/components/workflow/AsrEngineSetupPanel.tsx` still probes Python/service-template/venv state, downloads Python 3.11, starts setup jobs, shows pip/setup logs, and exposes virtual-environment rebuild controls.
- `src/components/workflow/SettingsTranscriptionPanel.tsx` still renders that panel and reads `settings.pythonPath` / `settings.asrServicePath`.
- `src/components/workflow/SettingsView.tsx` still owns ASR setup running/refresh state and Python/venv-specific refresh branches.
- `src/components/workflow/RuntimeDependenciesPanel.tsx` still offers Python download and ASR venv configuration actions even though T16 production probe no longer emits those items.

### Obsolete frontend contracts remain

- `src/constants/asrSetup.ts` and its test encode Python dependency profiles.
- `src/services/tauri.ts` still exports ASR setup wrappers used only by the setup panel.
- `src/services/tauriAsrSetup.test.ts` tests those wrappers plus one unrelated FFmpeg cache behavior.
- `src/types/index.ts` still includes frontend-only Python paths, ASR setup job/environment types, legacy runtime dependency kinds, and unused pip/source-profile fields retained only for T17 compatibility.

Rust setup commands and legacy enum variants remain T18 rollback/package scope; T17 only removes their frontend callers and public UI contract.

### Availability UX is still sidecar-shaped

- `src/utils/asrSidecarError.ts` classifies Python/sidecar errors and exposes setup instructions.
- `src/components/workflow/ModelManager.tsx` treats every unavailable model as “ASR engine not installed” and ignores `disposition` / `reason`.
- `src/components/workflow/TranscribeView.tsx` shows `sidecar` status/error copy, requires manual engine detection, and routes unavailable engines to Python setup.
- Engine/model/device options are duplicated/static and cannot disable individual options because `SelectOption` has no `disabled` field.

### Unsupported Native MVP controls remain selectable

- The T13 runtime capability has `vad: false`; T16 deterministically rejects Native VAD requests.
- T16 accepts only `auto` / `cpu` for the Native MVP and rejects CUDA/Vulkan.
- The current Transcribe view still exposes VAD controls and an enabled CUDA option, which would produce avoidable controlled backend failures after T18.

## Existing seams to reuse

- `ASR_ENGINE_OPTIONS`, `ASR_ENGINE_MODELS`, `defaultAsrModel`, and `asrModelOptions` remain the only frontend product registries. Do not add a second support list.
- `ModelManager` already owns selected-model download polling, same-job promise reuse, request identity protection, and the imperative pre-transcription gate.
- `select-adapter.tsx` already wraps the Radix/shadcn Select and can minimally pass an option-level `disabled` flag to `SelectItem`.
- `RuntimeDependenciesPanel` and `SettingsView` already consume typed T16 runtime probe/storage payloads.
- `TranscribeView` already owns model-download confirmation, transcription polling, cancel, document guards, recovery, video resolution, ASS generation, and save behavior. These flows must remain unchanged.

## Minimal implementation shape

1. Remove the visible Python setup panel and its orphaned frontend-only constants, wrappers, types, tests, and copy.
2. Extend the existing Select adapter for disabled options; derive engine/model/device availability from T16 metadata while keeping the current product registries.
3. Use one shared frontend availability owner for Settings and Transcribe so exact model readiness is not redundantly scanned by selector logic and `ModelManager`.
4. Make `ModelManager` render disposition/reason and offer download only for `supportedMissing`.
5. Keep unavailable saved settings visible without rewriting them; users explicitly choose the available large-v3 CPU route.
6. Remove unsupported VAD interaction from the Native MVP surface and ensure starts send `useVad: false`.
7. Preserve model download, polling, cancellation, document guards, recovery, ASS generation, and settings persistence.

## Main risks

- Duplicating Native support state in frontend constants instead of consuming T16 metadata, which would drift immediately during the post-T18 Faster-Whisper expansion.
- Triggering multiple full exact-readiness scans for the same large-v3 model from selector and model-manager components.
- Auto-rewriting an old unavailable engine/model/device selection and destroying user intent.
- Leaving Python/sidecar setup copy reachable after production dependency reporting has migrated.
- Leaving CUDA or VAD enabled so the final Native route predictably fails after the user clicks Start.
- Accidentally absorbing T18 route-policy/package/removal work into a frontend task.
