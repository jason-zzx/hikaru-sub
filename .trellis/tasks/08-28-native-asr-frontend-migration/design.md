# T17 Native ASR frontend migration design

## Summary

T17 removes the Python setup surface and makes the existing Settings and Transcribe views consume the T16 Native availability payloads.

```text
T16 stable Tauri commands
  list_asr_engines
  check_asr_model
  download/progress
  probe_runtime_dependencies
          |
          v
shared typed ASR availability owner
  engine info + model disposition + device capability
          |
          +-------------------+
          v                   v
Settings transcription     TranscribeView
selectors/status           selectors/start gate
          \                   /
           v                 v
             ModelManager
        selected model + download
```

No new Tauri command, Rust payload, backend route, store, registry, dependency, or page is planned.

## Architecture boundaries

### T16 remains the backend authority

Frontend availability is derived only from:

- `listAsrEngines()` for engine/backend/device/reason;
- `checkAsrModel(engine, model)` for model disposition/reason/readiness;
- `probeRuntimeDependencies()` for built-in runtime/model dependency presentation.

The frontend does not infer support from model names, inspect the model manifest, or maintain a second enabled-model set. `ASR_ENGINE_OPTIONS` / `ASR_ENGINE_MODELS` remain presentation registries; T16 metadata decides whether each entry is selectable.

T17 does not touch `AsrRoutePolicy`. Until T18, normal Release/default still uses legacy routing; T17 code remains compatible with optional Native fields so the frontend can land before the final flip.

### Shared availability owner

Settings and Transcribe need the same rules and both render engine/model/device selects. One small shared hook or focused domain service should own:

- loading `listAsrEngines`;
- loading model statuses for the visible models of the selected engine;
- deriving disabled options and concise labels/reasons;
- selected engine/model/device availability;
- request identity so stale engine/model responses are ignored;
- explicit refresh after download or retry.

The implementation should choose the smallest existing-style shape, but it must avoid two independent interpretations and avoid reading/hashing the same large-v3 readiness repeatedly within one mounted view. A global Zustand store is unnecessary because Settings and Transcribe are not simultaneously active and no availability job must survive navigation.

Failures are state, not support truth:

- keep the persisted current value visible;
- show a controlled detection error;
- do not silently enable or rewrite the route;
- allow an explicit retry.

### Option-level disabled state

Extend `SelectOption` with an optional `disabled` boolean and pass it to the existing Radix `SelectItem`. Labels may append a concise reason such as `（后续版本支持）`; no new select component or custom popup is needed.

Unavailable selected legacy values remain rendered by the controlled Select. Disabled means the user cannot newly choose that option; it does not mutate the existing value.

### Device derivation

The existing duplicated device arrays should become one shared constant. For the Native MVP:

- `auto` is enabled when the selected engine is available and resolves to the reported CPU route;
- `cpu` is enabled for a reported CPU engine;
- `cuda` remains visible but disabled with later-support copy;
- an unavailable engine disables its device routes;
- legacy payloads without device metadata retain compatibility until T18, while the start gate still checks engine/model status.

No persisted-device migration is performed.

## ModelManager changes

`ModelManager` remains the owner of selected-model download polling and the imperative pre-transcription gate. Its status rendering changes from sidecar/Python interpretation to disposition interpretation:

| State | UI | Download |
| --- | --- | --- |
| `ready` | 模型已就绪 | no |
| `supportedMissing` | 模型未下载 | yes |
| `postMvpUnavailable` | 后续版本支持 + reason | no |
| `unsupported` | 当前版本不支持 + reason | no |
| check error | 检测失败 + controlled error | no |

The shared availability owner should supply or share the selected status with `ModelManager` so selector loading and `ModelManager` do not independently perform the same exact readiness scan. After a successful download, one forced refresh updates both the model status display and select state.

Keep:

- one active `downloadPromiseRef` per mounted manager;
- existing polling fields and progress UI;
- request identity on engine/model changes;
- imperative `checkForTranscribe()` and `startDownload()` behavior;
- diagnostic path/source display already present.

Remove `asrSidecarError` coupling and Python setup hints.

## Settings migration

### Transcription panel

Keep the existing engine/model/device fields and `ModelManager`. Remove `AsrEngineSetupPanel` and its setup lifecycle props. Add a small Native MVP status/copy block only if needed to explain:

- CPU runtime is built in;
- large-v3 downloads separately;
- unavailable engines/models/devices are visible for future support.

Do not add another runtime card if the existing Runtime Dependencies page already provides the accurate built-in runtime status.

### SettingsView

Delete setup-only state and callbacks:

- `asrSetupRunning`;
- `asrSetupRefreshKey`;
- save-before-setup and refresh-after-setup flows;
- Python/venv cleanup/preparation refresh branches.

The normal Settings Save button continues to persist `asrEngine`, `asrModel`, and `asrDevice`. It must not normalize unavailable values.

### Runtime dependency page

Render only T16 production kinds. Action rules become:

- FFmpeg missing -> existing prepare/download;
- ASR models missing/needs setup -> go to Transcription;
- Native CPU runtime -> status only, never prepare/cleanup;
- downloads/app cache/model storage -> existing explicit measure/managed cleanup rules.

For missing `nativeAsrCpu`, use specific copy indicating an application runtime/package problem rather than an installable dependency.

## Obsolete frontend deletion

After removing all callers, delete frontend-only legacy setup surface:

- `src/components/workflow/AsrEngineSetupPanel.tsx`;
- `src/constants/asrSetup.ts` and its tests;
- ASR setup wrappers/imports from `src/services/tauri.ts`;
- setup wrapper tests, while retaining/moving the unrelated FFmpeg cache test;
- setup job/environment/profile types and legacy Python settings fields from `src/types/index.ts`;
- `python311` / `asrVenv` frontend runtime kinds and labels;
- sidecar-specific UI error utility/copy when no caller remains.

Do not delete the corresponding Rust commands, legacy settings input compatibility, sidecar source, packaged resources, or Python dependencies; T18 owns that rollback/package boundary.

## Transcribe flow

### Availability and start gate

On mount and engine/model change:

1. load the persisted selection without rewriting it;
2. load engine metadata and model dispositions;
3. render all known options with unavailable choices disabled;
4. keep Start disabled while required availability is unknown or failed;
5. if the selected model is `supportedMissing`, keep the existing confirmation/download/start sequence;
6. start only when engine, model, and device are usable.

All error copy becomes route-neutral or Native-specific. No `sidecar` or Python setup instruction remains.

### VAD boundary

The T13 MVP runtime advertises `vad: false`, and T16 rejects Native VAD. T17 removes the runnable VAD controls from the production Native MVP surface and sends `useVad: false` / `vadConfig: null`. The shared TypeScript/Rust request fields remain intact for rollback and future runtime capability work.

### Preserved job/document flow

The following logic remains structurally unchanged:

- FFmpeg detection and preparation;
- audio extraction and task-store progress;
- model download confirmation;
- `startAsr` args other than unsupported VAD selection;
- progress retry/backoff and missing-job handling;
- cancellation and active-task UI;
- document guard, recovery discard, stale-result rejection;
- segment conversion/merge, video resolution, PlayRes, ASS serialization/save;
- navigation to Translation.

## Compatibility and migration

- Old settings with Python path keys are already sanitized by T16; removing optional frontend fields does not change persisted Rust compatibility.
- Old engine/model/device values remain valid user data even when unavailable. The UI shows the saved value and reason until the user changes it.
- A model download uses the existing T16/T12 job and exact path contract.
- T18 can later switch Release/default to Native without another frontend redesign.
- The post-T18 Faster-Whisper expansion enables additional manifest entries through the same disposition-driven UI without editing a support whitelist.

## Rollout and rollback

### Rollout

1. Land typed availability and option disabling.
2. Migrate `ModelManager` and Transcribe gating.
3. Remove Python setup surface and obsolete frontend types/wrappers.
4. Run focused/full frontend tests and build.
5. Hand the stable frontend to T18; do not independently release T17 against legacy packaging.

### Rollback

Restore the previous frontend commit only. Do not change T16 route policy, model data, downloads, settings files, projects, subtitles, caches, or packaged runtime resources.

## Security and privacy

- Keep all invokes behind typed `tauri.ts` wrappers.
- Display backend-controlled concise reason/error strings only; do not expose model response bodies, headers, credentials, transcript text, or private paths beyond existing bounded diagnostic-path behavior.
- No new external URL, custom model path, shell command, or package permission is introduced.

## Decisions

- **D1:** T16 metadata is the availability authority; no frontend enabled-model registry.
- **D2:** One shared availability owner serves Settings and Transcribe; no global store.
- **D3:** Extend the existing Select adapter with disabled items instead of adding another control.
- **D4:** Preserve unavailable saved selections; never auto-migrate user choice.
- **D5:** Remove frontend Python setup code, but keep Rust/Python rollback source for T18.
- **D6:** Do not expose unsupported Native VAD or CUDA as runnable controls.
- **D7:** Preserve all transcription job/document/ASS semantics and existing command names.
