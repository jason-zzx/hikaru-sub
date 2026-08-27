# T12 planning evidence

## Confirmed product and repository facts

- The parent Native ASR migration defines T12 as the remaining Gate A deliverable after the final CPU runtime package. T16 depends on T12 and T13; T17 depends on T16 plus T12 metadata; T18 owns production cutover.
- Production model status/download commands still proxy the Python sidecar (`src-tauri/src/asr.rs:733`, `:753`, `:782`). T12 must not silently switch those commands while transcription still defaults to Python legacy.
- The current managed Python/Hugging Face cache root is `deps/models/huggingface` (`src-tauri/src/dependencies.rs:416`). The parent requirement places new native CTranslate2 installs under `deps/models/ctranslate2` and temporary downloads under `deps/downloads`.
- Official/China source selection already belongs to the bundled runtime source profile (`src-tauri/src/dependencies.rs:16`, `:742`). The China profile supplies `https://hf-mirror.com`; official currently means Hugging Face directly.
- Existing dependencies already include `reqwest` streaming, `futures`, `sha2`, `tokio`, `serde`, `serde_json`, `httpmock`, and `tempfile`; T12 needs no new crate.
- The native worker accepts a resolved model directory through protocol `modelPaths` and validates ordinary Whisper `config.json`, `model.bin`, `tokenizer.json`, and `vocabulary.json|txt`. `preprocessor_config.json` is required only for Kotoba (`native-asr/src/ctranslate2_whisper.cpp:1265`). T12 must not broaden that requirement to ordinary faster-whisper.
- Current frontend contracts are only `{engine, model, available, downloaded}` plus the existing download snapshot (`src/types/index.ts:164`, `:175`). T12 can freeze an internal Rust contract without changing production UI; T16/T17 own command and TypeScript cutover.

## Frozen MVP model identity

Authority: archived T02 input lock, archived model identity manifest, repeated T06/T07 evidence, and the immutable Hugging Face revision API.

- Logical identity: `faster-whisper/large-v3`
- Repository: `Systran/faster-whisper-large-v3`
- Revision: `edaa852ec7e145841d8ffdb056a99866b5f0a478`
- Backend/format: `ctranslate2`
- License: MIT
- Attribution: Systran conversion of `openai/whisper-large-v3` to CTranslate2
- Official repository metadata at this revision reports `library_name=ctranslate2`, `license=mit`, and exact revision SHA.

Required native worker files:

| Role | Relative path | Bytes | SHA-256 |
|---|---|---:|---|
| model-config | `config.json` | 2,394 | `a9306624f5ec14270a014b647e5c316b6e03a662c369758d1b90697a7b0655b9` |
| model-weights | `model.bin` | 3,087,284,237 | `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1` |
| tokenizer | `tokenizer.json` | 2,480,617 | `6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca` |
| vocabulary | `vocabulary.json` | 1,068,114 | `c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1` |

`preprocessor_config.json` exists in the immutable repository, but is not an ordinary Whisper readiness requirement and is therefore not part of the minimum T12 install closure.

## Minimum ownership boundary

T12 should add one Rust model-manager module and one bundled model manifest. It should expose internal status, exact ready-path resolution, download start/progress, and bounded staging cleanup for later T16 wiring. It should not:

- change the Python-default transcription route;
- rewire the existing public model commands before T16/T17;
- add frontend UI or TypeScript fields;
- add a second source-selection configuration;
- add post-MVP models, companion grouping, or GPU policy.

## Required path and safety behavior

- Direct install: `deps/models/ctranslate2/faster-whisper/large-v3/<revision>/`.
- Persistent partial/staging namespace: `deps/downloads/native-asr-models/faster-whisper/large-v3/<revision>/`.
- Legacy reuse candidate: `deps/models/huggingface/hub/models--Systran--faster-whisper-large-v3/snapshots/<revision>/`.
- Direct installs reject symlinked required files. Legacy Hugging Face symlinks are accepted only when their canonical targets remain under the canonical managed Hugging Face root.
- Readiness validates every required file's exact size and SHA-256. T12 deliberately avoids a speculative persistent verification cache; add one only if measured startup/status latency is unacceptable without weakening invalidation.
- Download URLs are derived from the trusted bundled repository/revision/file manifest and the existing official/China endpoint. User input never becomes an arbitrary URL or filesystem path.
- All files download and verify in the managed download namespace. The final directory appears only after the complete staged directory verifies and is renamed into the immutable revision path.
- A valid existing final install is never replaced. An invalid final directory is removed only after a replacement staging tree has fully verified.

## Planning conclusion

Repository evidence resolves the main design choices. No remaining product-intent question blocks planning: the parent task already fixes the single model, source modes, paths, fail-closed readiness, legacy reuse, and no-cutover boundary.
