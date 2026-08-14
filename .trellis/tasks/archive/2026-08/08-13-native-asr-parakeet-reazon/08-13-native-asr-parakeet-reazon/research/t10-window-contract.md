# T10 Pinned CrispASR Window Contract

## Scope

This note closes the pre-implementation feasibility question for invoking pinned CrispASR v0.8.22 repeatedly on bounded PCM windows through one already-open `parakeet` session. It does not claim model quality.

Pinned source root used for inspection:

`.trellis/tasks/archive/2026-08/07-25-native-asr-crispasr-poc/research/local/src/CrispASR-cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45/`

Source commit remains `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`.

## Findings

### 1. One session supports repeated synchronous transcribe calls

`src/crispasr_c_api.cpp:4554-4567` implements `crispasr_session_transcribe_lang` as a normal synchronous function over caller-provided `pcm` and `n_samples`. Each call creates/returns a new `crispasr_session_result*`; no one-shot/consumed flag is set on the session.

The same pinned file also performs repeated calls internally:

- `4559-4588`: best-of-N loops over `transcribe_autochunk` on the same session;
- `4499-4547`: `transcribe_autochunk` loops over bounded PCM ranges and calls `transcribe_single(s, pcm + b, e - b, ...)` repeatedly on the same session;
- `6770-6859`: VAD helpers call `crispasr_session_transcribe_lang` on caller-selected slices or stitched buffers while retaining the same session.

Therefore T10 may reuse one loaded session for sequential, non-concurrent bounded calls. T10 must not re-enter the session from callbacks or call it concurrently; the public header explicitly requires callbacks to stay non-blocking and not re-enter the session.

### 2. Each call owns an independent result

`include/crispasr_session.h` exposes `crispasr_session_result_free` for every returned result. `src/crispasr_c_api.cpp:7404-7407` deletes exactly the supplied result. Internal repeated-call loops free each part independently after copying/moving it (`transcribe_autochunk`, `4532-4546`).

T10 can therefore keep T09's per-call result RAII and callback reset. The session itself remains open until the backend is destroyed.

### 3. Parakeet decoder state is per call, not carried between windows

The session retains the loaded model/context, but decode state is created by each invocation:

- `src/crispasr_c_api.cpp:5045-5086` dispatches every call to `parakeet_transcribe_segments(..., t_offset_cs=0, ...)` using the current PCM buffer;
- `src/parakeet.cpp:3928-4022` recomputes mel and encoder output per `parakeet_transcribe_ex` call and runs a fresh decode;
- TDT/RNNT decode functions create fresh local LSTM/predictor state (`parakeet_lstm_state`, `lstm_init_state`) rather than storing decoder history on the session;
- result/token/word arrays are allocated anew for each call.

Thus a T10 window is an independent inference input while model weights/runtime allocations remain reusable. This is exactly the intended candidate change for P1/R1.

### 4. Returned timing is relative to the supplied PCM buffer

`src/crispasr_c_api.cpp:5070` calls `parakeet_transcribe_segments` with `t_offset_cs=0`. `src/parakeet.cpp:4006-4008` and the shared decode path add `t_offset_cs` to token timestamps; zero offset means returned segment/word times start in the caller-supplied buffer's local timeline.

Pinned internal chunking explicitly shifts local results into an outer timeline (`src/crispasr_c_api.cpp:4522-4534`). T10 may apply the same narrow operation after copied validation: add the requested window start to local source/word times. It must reject overflow or any translated range outside the declared window/audio; it must not clamp or stretch.

### 5. Progress semantics are not a reliable per-window signal

The public header states the progress callback is for chunked/auto-chunked long transcription; single-pass and non-Parakeet paths may remain silent. T03/T09 evidence also observed sparse/silent progress.

T10 may emit worker-owned progress at each successfully completed window boundary. It must not interpret callback silence as failure and must keep progress monotonic.

## Frozen T10 use

- Calls are sequential and non-concurrent on one session.
- Each call receives an exact 16 kHz PCM sample slice.
- Each result is copied and freed before the next call.
- Callbacks are reset after each call and never re-enter the session.
- Returned source/word times are treated as window-local, then translated by exact window start.
- Translated timing outside the window/audio fails the candidate; no clamp or synthetic duration is allowed.
- If fake-ABI repeated-call tests or the first real short acquisition contradict these source-derived contracts, the candidate fails and T10 returns to planning rather than inventing a workaround.
