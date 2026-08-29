# Faster-Whisper model expansion planning evidence

## Dependency state

- The parent roadmap sequence remains `T17 frontend migration -> T18 Native MVP release -> Faster-Whisper model expansion`.
- T12, T13, T16, and T17 are completed and archived.
- T18 is accepted and provides the production Native large-v3 CPU baseline; its active task is awaiting finish-work archival.

Conclusion: this task remains planning only until the T18 archive completes, then becomes the next executable child. The model-identity research below remains the non-authoritative planning input for that implementation.

## Existing seams to reuse

### Model delivery

- `src-tauri/resources/native-asr-models.json` is already a multi-entry schema-v1 manifest, currently containing only `faster-whisper/large-v3`.
- `src-tauri/src/asr_models.rs:183` owns `NativeAsrModelManager` with exact manifest validation, direct/legacy readiness, resumable download, hash verification, staged publication, repair, and per-model job coalescing.
- `src-tauri/src/asr_models.rs:30-36` currently classifies the six target models as post-MVP unavailable. Adding a validated manifest row naturally changes each one to supported-missing/ready without a second registry.
- Ordinary Whisper readiness requires four logical roles. The manifest may bind the vocabulary role to either `vocabulary.txt` or `vocabulary.json`; Kotoba-only `preprocessor_config.json` must not become a general requirement.

### Worker/runtime

- The final CPU worker accepts the ordinary `faster-whisper` engine generically rather than checking a model name (`native-asr/src/main.cpp:235-246`).
- Model validation accepts `vocabulary.json` or `vocabulary.txt` (`native-asr/src/ctranslate2_whisper.cpp:1271-1281`).
- The backend reads `model->n_mels()` and accepts 80 or 128 Mel bins (`native-asr/src/ctranslate2_whisper.cpp:1684-1687`).
- `preprocessor_config.json` is checked only when the Kotoba flag is set (`native-asr/src/ctranslate2_whisper.cpp:1265-1289`).

Conclusion: the default plan is no worker/runtime byte change. Real model load/inference smoke is the gate that may invalidate this assumption.

### Frontend

- `src/constants/asr.ts:15-27` already lists `tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`, and `large-v3-turbo`.
- `large-v3` remains the default (`src/constants/asr.ts:54-56`).
- Existing `ModelManager` and typed Tauri wrappers already own model check/download/progress behavior.

Conclusion: do not create another frontend model registry. After T17/T18, extend the existing availability contract so validated manifest entries become independently downloadable/selectable.

## External model identity research

Hugging Face API responses observed during planning provide these immutable repository revisions:

| Product model | Repository | Revision | Required vocabulary form observed | License |
| --- | --- | --- | --- | --- |
| `tiny` | `Systran/faster-whisper-tiny` | `d90ca5fe260221311c53c58e660288d3deb8d356` | `vocabulary.txt` | MIT |
| `base` | `Systran/faster-whisper-base` | `ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66` | `vocabulary.txt` | MIT |
| `small` | `Systran/faster-whisper-small` | `536b0662742c02347bc0e980a01041f333bce120` | `vocabulary.txt` | MIT |
| `medium` | `Systran/faster-whisper-medium` | `08e178d48790749d25932bbc082711ddcfdfbc4f` | `vocabulary.txt` | MIT |
| `large-v2` | `Systran/faster-whisper-large-v2` | `f0fe81560cb8b68660e564f55dd99207059c092e` | `vocabulary.txt` | MIT |
| `large-v3-turbo` | `dropbox-dash/faster-whisper-large-v3-turbo` | `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf` | `vocabulary.json` | MIT |

Planning sources:

- `https://huggingface.co/api/models/<repository>` for canonical repository, revision, license, and sibling filenames.
- `https://huggingface.co/api/models/<repository>/tree/<revision>?recursive=true&expand=true` for pinned tree metadata and LFS object identities.

The implementation must refetch the pinned revision, compute/verify the exact SHA-256 and byte size for every required file, and record attribution URLs in the bundled manifest. The planning table is not itself the release lock.

## Minimal implementation shape

1. Confirm the accepted T18 production baseline is archived and load its final evidence.
2. Freeze six exact manifest rows and add regression tests for every tuple.
3. Reuse the existing model manager; only generalize code where a real failing test proves large-v3-only behavior.
4. Run each model through exact readiness, download, worker load, and short Japanese transcription.
5. Run the required >10-minute `large-v2` smoke and representative installed/portable checks.
6. Enable availability through the existing T16/T17 contract; keep `large-v3` default and keep failures visible without Python fallback.

## Main risks

- Treating the turbo alias/redirect as a stable identity instead of freezing the canonical repository.
- Accidentally requiring `preprocessor_config.json` for ordinary Whisper because the turbo repository happens to contain it.
- Rebuilding the final runtime before a real model test proves a worker incompatibility.
- Shipping a manifest row before its functional smoke passes, which would expose a downloadable but nonfunctional route.
- Starting implementation before T18 finish-work completes and overlapping an unstable archive/commit baseline.
