# T08 Kotoba Productization Inputs

## Scope

T08 productizes the single existing engine/model route:

- engine: `kotoba-faster-whisper`
- backend: `ctranslate2`
- model: `kotoba-tech/kotoba-whisper-v2.0-faster`
- pinned revision: `f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc`
- model license: MIT

Release/default routing remains Python legacy. T08 produces an accepted native engine algorithm/cache-compatibility handoff for later T12-T18 work; it does not publish a GPU pack or switch production routing.

## Authoritative Sources

### Kotoba model card

Pinned source:

`https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-faster/raw/f44edd35eaeb2274e85ac7b31fb2c6f59ff1c4bc/README.md`

The model card's example uses:

```python
model.transcribe(
    audio,
    language="ja",
    chunk_length=15,
    condition_on_previous_text=False,
)
```

It also states that chunked long-form decoding was empirically better than sequential long-form decoding, but the converted repository itself only supplies the CTranslate2 model and does not define a native chunk-merging implementation for Hikaru Sub.

### Preprocessor contract

Pinned `preprocessor_config.json` declares:

- `feature_size = 128`
- `sampling_rate = 16000`
- `n_fft = 400`
- `hop_length = 160`
- `nb_max_frames = 3000`
- `chunk_length = 30`

The model card's 15-second inference window is therefore a source-window policy. The model tensor and timestamp-token range remain 30 seconds, matching the existing ASR quality guideline.

### CTranslate2 API

Pinned CTranslate2 `4.8.0` public Whisper API exposes model mel count, `WhisperOptions`, encode/generate, no-speech probability, and timestamp-token generation. It does not provide application-level long-form orchestration or cache discovery.

### Hugging Face cache layout

Official Hugging Face cache documentation defines immutable snapshot paths as:

```text
<HF_HOME>/hub/models--<namespace>--<repo>/snapshots/<commit>/
```

Snapshot files may be symlinks into `blobs/` or direct copies on Windows when symlinks are unavailable. A valid snapshot can therefore be reused in place without copying. T08 must use the exact pinned commit directory, not mutable `refs/main` resolution. T12 remains the production downloader/resolver owner.

## Existing Repository Evidence

### T02 fixed-window baseline

T02 used 15-second fixed, non-overlapping Kotoba source windows, no previous-text context, and beam 5. Results against T01 ground truth:

| Case | CER | CPU RTF | Timeline errors | Confirmed gaps >=1.5s | Result |
|---|---:|---:|---:|---:|---|
| short-v1 | `0.3417` | `0.556` warm median | 0 | 0 | pass |
| medium-v1 | `0.2224` | `0.515` | 0 | 5 | fail |
| long-v1 | `0.3165` | `0.459` | 0 | 36 | fail |

The failure class is missing confirmed speech at long-form boundaries, not CER, runtime feasibility, memory, or timeline legality.

### T06 reusable production seam

T06 moved the proven Whisper primitives into `hikaru-asr-worker` and added timestamp-driven seek, source/model-window distinction, no-history support, narrow duplicate removal, legal timeline checks, protocol output, and real Rust-host compatibility. The current production entry dispatches only ordinary `faster-whisper`; Kotoba protocol routing is already allowed but returns `route_not_implemented`.

T06's selected ordinary defaults are timestamp-driven, no-history, beam 1. Those defaults must not be changed by T08.

### T07 development GPU lane

T07 recorded `development-gpu-ready` on RTX 3070/CUDA 12.8/CTranslate2 4.8.0 with `WITH_CUDNN=OFF`:

- short-v1 GPU/CPU warm RTF ratio: `0.1090`
- medium first-120s GPU/CPU warm RTF ratio: `0.1313`

T08 quality iteration should therefore use the existing CUDA device-0/FLOAT16 lane. Subtitle quality failures do not trigger CPU fallback.

## Minimum Candidate

The smallest evidence-backed candidate is **K1**:

- same worker/backend/protocol as T06/T07;
- Kotoba-only 15-second maximum source window;
- padded 30-second model tensor and timestamp range;
- `language=ja`;
- `condition_on_previous_text=false`;
- beam size `5` from the pinned model-card/faster-whisper default;
- timestamp-driven seek instead of T02's fixed non-overlap seek;
- no VAD dependency in the first candidate;
- GPU device 0/FLOAT16 for repeated authoritative measurement.

This changes only the failure-relevant dimension: long-form seek/overlap behavior. It does not add ORT, VAD, reference-derived repair, fuzzy merge, synthetic timestamps, or a second worker.

If K1 fails a confirmed-gap gate, complete the remaining authoritative K1 cases under the same frozen identity, then return to planning with the full failure profile. Do not pre-implement a second candidate. A later candidate may use a maintained chunk/VAD method only when the measured K1 failure demonstrates that it addresses the same failure class and a new identity is reviewed.

## Cache Compatibility Boundary

T08 proves compatibility by running the real worker/host against the exact legacy snapshot directory under the current managed Hugging Face cache. The proof must cover:

- symlink-backed or copied snapshot files;
- exact pinned revision directory;
- required `config.json`, `model.bin`, `tokenizer.json`, and `vocabulary.*`;
- Kotoba-only non-empty `preprocessor_config.json`;
- missing/incomplete/malformed snapshot failure before `ready`;
- no copy or mutation of the legacy snapshot.

T08 does not add the final production model manifest, downloader, readiness marker, cleanup, or migration UI; those remain T12/T16/T17 responsibilities.

## Likely Code Surface

- `native-asr/src/ctranslate2_whisper.hpp`
- `native-asr/src/ctranslate2_whisper.cpp`
- `native-asr/src/main.cpp`
- `native-asr/tests/ctranslate2_whisper_tests.cpp`
- `src-tauri/src/asr_worker.rs` test module only
- `.gitignore` for the T08 canonical ignored local root
- task-local lock, adapter, publisher, evidence, and report files

No frontend, production downloader, runtime manifest, installer, portable packaging, or Python route changes are required for K1.

## Planning Conclusion

Repository evidence resolves the design decisions needed to begin. No remaining product-intent question blocks planning: the parent task already fixes the engine/model, quality gates, GPU-first development rule, cache compatibility goal, and release-routing boundary.
