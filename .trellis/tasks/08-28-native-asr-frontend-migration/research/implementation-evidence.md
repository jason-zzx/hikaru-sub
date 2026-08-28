# T17 Native ASR frontend migration implementation evidence

## Delivered scope

- Added one mounted `useAsrAvailability` owner for typed `listAsrEngines` / `checkAsrModel` metadata, option projection, route gating, refresh, and stale-request rejection.
- Extended the existing Select adapter with disabled items; engine/model/device product lists remain `ASR_ENGINE_OPTIONS`, `ASR_ENGINE_MODELS`, and the shared device presentation list.
- Migrated Settings, ModelManager, and Transcribe to Native disposition/reason handling while preserving unavailable persisted values.
- Removed the Python/venv/pip/service-template setup panel, frontend setup constants/types/wrappers, legacy Python settings fields, and sidecar-specific UI error helper.
- Kept model download promise reuse/progress/diagnostics and the existing transcription polling, cancel, document guard, recovery, PlayRes, ASS save, and translation handoff flow.
- Native starts now always send `useVad: false` and `vadConfig: null`; Native CPU metadata disables CUDA.
- Runtime Dependencies now presents `nativeAsrCpu` as bundled/status-only, downloads only FFmpeg, and routes `asrModels` to Transcription.
- No Rust route policy, package resource, Python rollback source, command name, job contract, or Git history was changed.

## Validation

```text
Focused T17 tests (availability, disabled persisted values, dispositions, Settings/runtime, Transcribe seams, FFmpeg cache) PASS (9 files, 28 tests)
pnpm test PASS (107 files, 817 tests)
pnpm build PASS (existing chunk-size advisory only)
python ./.trellis/scripts/task.py validate 08-28-native-asr-frontend-migration PASS
git diff --check PASS
git diff --cached --quiet PASS
```

The earlier implementation-runner claim that `pnpm test` restored legacy tests and deleted new tests was not reproducible and is not valid acceptance evidence. The exact full command was rerun with SHA-256 checks before and after: all new T17 tests remained byte-identical, and the deleted setup-era tests remained absent. No test or package script in the current environment mutates the working tree.

## Residual scope

- T18 still owns Release/default Native routing, Python/sidecar package removal, and installed/portable/offline real-model qualification.
- No real large-v3 model bytes or inference smoke were run in this frontend-only task.
