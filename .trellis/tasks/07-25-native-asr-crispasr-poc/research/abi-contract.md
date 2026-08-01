# CrispASR v0.8.22 Public C ABI Contract

## Pinned Boundary

- Release/tag: `v0.8.22`
- Commit: `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`
- Windows x64 library archive SHA-256: `bebdc63f28e7fcf4ac81913d3dea9eb6e2a52936de2dd02628594ce9cff11f75`
- Public session header SHA-256: `cdefd19f6f208ed3f77f31c1cc8df19224c1c81ed5e0e6064650a827000c68df`
- Runtime DLL SHA-256: `aa5d08f8cfe459727764bbe724b0780a75bd4167043c9cf63fd0fb43c2a559de`

The release library archive contains `include/crispasr.h` but omits `include/crispasr_session.h`. The harness compiles against the exact pinned source header and resolves every used export from the pinned DLL at runtime. Missing hashes, files or exports fail before inference.

## Used Public Signatures

The harness uses the following pinned public subset:

```c
crispasr_session* crispasr_session_open_with_params(
    const char* model_path, const char* backend_name,
    const crispasr_open_params_v1* params);
const char* crispasr_session_backend(crispasr_session* s);
int crispasr_session_available_backends(char* out_csv, int out_cap);

void crispasr_session_set_progress_callback(
    crispasr_session* s, crispasr_progress_callback cb, void* user_data);
void crispasr_session_set_segment_callback(
    crispasr_session* s, crispasr_segment_callback cb, void* user_data);
void crispasr_session_set_token_callback(
    crispasr_session* s, crispasr_token_callback cb, void* user_data);

crispasr_session_result* crispasr_session_transcribe_lang(
    crispasr_session* s, const float* pcm, int n_samples, const char* language);

int crispasr_session_result_n_segments(crispasr_session_result* r);
const char* crispasr_session_result_segment_text(crispasr_session_result* r, int i);
int64_t crispasr_session_result_segment_t0(crispasr_session_result* r, int i);
int64_t crispasr_session_result_segment_t1(crispasr_session_result* r, int i);
int crispasr_session_result_n_words(crispasr_session_result* r, int i_seg);
const char* crispasr_session_result_word_text(
    crispasr_session_result* r, int i_seg, int i_word);
int64_t crispasr_session_result_word_t0(
    crispasr_session_result* r, int i_seg, int i_word);
int64_t crispasr_session_result_word_t1(
    crispasr_session_result* r, int i_seg, int i_word);
float crispasr_session_result_word_p(
    crispasr_session_result* r, int i_seg, int i_word);
void crispasr_session_result_free(crispasr_session_result* r);

crispasr_align_result* crispasr_align_words_abi(
    const char* aligner_model, const char* transcript,
    const float* samples, int32_t n_samples,
    int64_t t_offset_cs, int32_t n_threads);
int crispasr_align_result_n_words(crispasr_align_result* r);
const char* crispasr_align_result_word_text(crispasr_align_result* r, int i);
int64_t crispasr_align_result_word_t0(crispasr_align_result* r, int i);
int64_t crispasr_align_result_word_t1(crispasr_align_result* r, int i);
void crispasr_align_result_free(crispasr_align_result* r);

void crispasr_session_close(crispasr_session* s);
```

The probe confirms all 25 used exports. Required logical backends are advertised, but the correct pinned public session backend for a ReazonSpeech GGUF is `parakeet`, matching pinned CLI/backend detection.

## CPU Attestation

The final matrix uses `crispasr_session_open_with_params` ABI v2 with:

```text
use_gpu = 0
n_gpu_layers = 0
flash_attn = 0
n_threads = 16
```

Runs use a restricted PATH containing only the harness directory and Windows System32. Raw evidence enumerates actual loaded task-local modules. All final model runs loaded the executable plus `crispasr.dll`, `ggml-base.dll`, `ggml-cpu.dll`, and `ggml.dll`. CPU attribution is therefore based on explicit public params plus loaded-module evidence, not a hard-coded label.

## Ownership And Lifetime

| Value | Contract | Harness evidence |
|---|---|---|
| `crispasr_session*` | Caller-owned; close with `crispasr_session_close` | Every opened session closes exactly once |
| `crispasr_session_result*` | Caller-owned; free with `crispasr_session_result_free` | Segment and nested word text/times are copied first; every created result frees once |
| Result segment/word strings | Result-owned borrowed pointers | Converted immediately to owned `std::string`; never retained after result free |
| `crispasr_align_result*` | Caller-owned; free with `crispasr_align_result_free` | Raw character entries are copied first; every created alignment result frees once |
| Aligner strings | Aligner-result-owned borrowed pointers | Copied before alignment result free |
| Callback text/token pointers | Valid only during callback | Callback stores only copied text metadata/timing/order |
| Callback `user_data` | Stored, not copied | Scope guard clears all three callbacks before context destruction |

Every transcribe success/error path records `callbackResetCount=3`, inactive context after reset, result/align free counts and session close count. Failed Qwen medium/long evidence passes the same complete lifecycle validator. No late callback or close crash was observed.

## Route Findings

### Parakeet

The harness calls `crispasr_session_transcribe_lang`; pinned session code selects its official short/long orchestration automatically. It no longer forces the chunked API for short audio. Public nested word getters expose TDT-native timings separately from the single top-level segment. Short had 50 legal words; medium/long had 23/43 zero-duration word ranges respectively.

### ReazonSpeech

Pinned source contains a string alias inconsistency: session open accepts `reazonspeech`, while the Parakeet-family transcribe branch checks `parakeet`. Pinned CLI/backend detection maps a ReazonSpeech GGUF to `parakeet`; using that public backend transcribes successfully. The prior null-result blocker was a harness interpretation error, not a model/runtime blocker.

All cases return one top-level segment. Nested words are present, but 69/76 short, 1,141/1,248 medium and 10,098/10,749 long word ranges are zero-duration.

### Qwen3 Forced Alignment

Qwen session timestamps are never accepted. The ASR result text and source segments are copied, then the required aligner is called. Raw per-character ranges remain in ignored evidence.

Pinned upstream tokenizes CJK per character and groups a flat alignment back into source segments using the first consumed entry's start and last consumed entry's end. The harness implements equivalent semantics. It does not expand zero durations.

- short, leading-silence and boundary grouping produced legal ForcedAligner-derived segments;
- short timing accuracy still failed;
- medium/long had complete source segments whose grouped first/last centisecond endpoints were equal, so the full timeline failed closed with zero accepted output.

## Callback Findings

- Segment callbacks matched final getters on observed results; no replacement refresh was observed.
- Qwen token callbacks fired; Parakeet/Reazon token callbacks did not.
- All observed callbacks ran on the transcribe thread.
- Progress callbacks did not fire, including long runs. This pin does not prove usable progress callbacks.
- Passing null restores CrispASR's internal polling callback for segment/token paths, but it removes the harness user context. The scope guard records that reset before context destruction.

## Cancellation

The pinned session ABI exposes no cooperative cancellation/abort function. The harness does not invent interruption. Downstream must use worker process termination unless a later pinned ABI adds a safe contract.

## Controlled Errors

The real Qwen negative matrix covers:

- missing aligner request;
- corrupt file rejected by locked identity;
- unloadable fixture reaching public model load;
- empty transcript after a valid baseline model load;
- real alignment followed by a malformed empty source-segment map;
- zero-sample invalid-audio request after a valid baseline model load.

Every case retains sanitized request/identity/result/lifecycle traces and accepts zero timed output. Invalid WAV and output paths outside the canonical task-local ignored root fail closed.

## Authoritative Sources

- <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/include/crispasr_session.h>
- <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/src/crispasr_c_api.cpp>
- <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/src/crispasr_aligner.cpp>
- <https://github.com/CrispStrobe/CrispASR/blob/cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/examples/cli/crispasr_run.cpp>
