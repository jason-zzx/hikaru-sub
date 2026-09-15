# P1 pinned full-CLI trace (before model execution)

Authority: verified complete CrispASR v0.8.32 source archive at `e2a356146e36bc1cc0410edefb01990448766979`, GGML `5049ebb8472fdc965eb3fb72c1cb111260726186`, full c2pa-audio `e40329b83f16f67bb5ddc7bb13ae18de0a9376fc`. Existing `upstream-engineering-baseline-lock.json` and `prepare.py` bind archive bytes. Pristine source is ignored at `native-asr/build/full-cli/source-pristine`; adapted candidate is separate at `source-parakeet-p1`. No accepted/published runtime was overwritten.

## Invocation / active dispatcher

Planned controlled argv (absolute verified model/VAD, relative canonical audio, private output):

```text
crispasr.exe --backend parakeet -m <exact-F16> --vad -vm <exact-shared-Silero>
  --strict-pipeline --require-vad --require-word-timestamps -l ja
  --split-on-punct -ojf -of <private-result> -f <relative-PCM-WAV>
  --gpu-backend cpu|cuda -t 8 --cache-dir <private-empty-cache>
  [--no-gpu only for cpu]
```

No `-am`, model auto-resolution, decoder override, explicit chunk size, VAD stitch, streaming, extra processors or inherited tuning variables. `whisper_params.h:22,28,31,66,243`: one processor, max_len 0, beam -1 (greedy), GPU flag explicit, empty decoder string means TDT. `cli.cpp:2665-2716` routes non-Whisper backend/strict requests to `crispasr_run_backend`; the backend is initialized before `process_one_input` at `crispasr_run.cpp:4917`. Not the disabled legacy block starting at line 4927.

`crispasr_backend_parakeet.cpp:60-87`: `cp.use_gpu = params.use_gpu && params.gpu_backend != "cpu"`; actual loaded vocabulary detects Japanese; no CTC switch without explicit request. `transcribe:154-175` uses `parakeet_transcribe_segments` with upstream sticky/default configuration, not historical Hikaru window policy. JA does not advertise internal chunking or split parallel encode/decode (`capabilities:53`, `supports_split_transcribe:195`).

`crispasr_run.cpp:1038-1090`: JA safe window is 12 seconds, including the 12–30s auto-VAD case; explicit required VAD uses the same resolver with a 12s slice cap. `crispasr_compute_audio_slices` receives the actual audio and existing Silero. VAD load/compute failure propagates to strict exit30 before empty/silence success. Empty successful VAD gets explicit `vadSilence=true` machine output through the existing controlled adaptation.

Sequential `process_slice:1701-1705` calls the model, then `finish_slice`. `finish_slice:1599-1602` invokes the approved `crispasr_gap_fill_slice` on actual PCM while cap > 0; env is empty so upstream default gap fill stays on. No app-generated text or timing. `parakeet_orchestrate.cpp:719` excludes JA from the separate non-JA repair. No overlap-save/LCS is enabled for VAD slices. Sequential branch is `crispasr_run.cpp:2048-2051`.

## Actual compute/device sites

- `parakeet.cpp:2898-2901`: selected encoder backend previously allowed CPU fallback. New controlled guard checks requested mode and actual backend before fallback. Shared GPU resolver rejects failed CUDA rather than `ggml_backend_init_best`.
- `parakeet_encode_mel:900-1000`: encoder scheduler contains selected backend plus CPU fallback backend. New check inspects every allocated node assignment before compute, then requires success; any CPU/unknown assignment in CUDA fails closed rather than reassigning nodes. Presence of a CPU backend handle alone is not execution proof or failure.
- `parakeet_ggml_decode_active:1379-1391`: CUDA defaults to GGML decoding; CPU defaults to native host loops. Controlled guard rejects a mismatched decode path rather than overriding the upstream decision.
- `parakeet_init_ggml_decoder:1398-1405` constructs persistent predictor/joint graphs. `core/rnnt_ggml.h:187-239` allocates on one actual backend; controlled allocation failures now terminate rather than using partial graphs. `decoder_predictor:252` and `decoder_joint:270` directly call `ggml_backend_graph_compute`, not the encoder scheduler; new direct-dispatch checks bind concrete backend and successful compute. Per-step scheduler paths are also guarded but not selected by the clean default environment.
- CPU TDT loops and CUDA native decoding both reach `parakeet_tdt_decode`; completion evidence is emitted after its real frame/step loop, before return (near pristine line 1704), with counts but no tokens/text.
- **Intrinsic host work is not fallback:** pinned default CUDA still calculates mel features/position encodings, reads back encoder/state/logits, caches decoder weights in F32, computes `all_proj_e` on CPU (`parakeet.cpp:1496-1522`), and performs argmax/duration/control loops on CPU. These are upstream operations, not schedulable encoder/predictor/joint nodes silently offloaded to CPU. Do not claim all model arithmetic runs on CUDA or use Qwen's no-host-weight-cache condition. No algorithm/precision substitution is made by these adaptations.
- VAD remains the existing CPU planned-graph path, including the accepted false-on-compute-failure correction and successful completion marker. Qwen-specific ASR/lazy-audio/aligner assertions remain untouched.

## Output and safety

`crispasr_run.cpp:2076-2137`: merge completed upstream segments, call actual `crispasr_make_disp_segments`, strict word validation, then writer. Existing controlled output adaptation at this exact active writer is reused by the Parakeet control. `crispasr_output.cpp` retains upstream grouping and exports the same display rows alongside raw source words. Source `t0/t1` are centiseconds; JSON offsets and `displaySegments.startMs/endMs` multiply by ten. Diagnostic token bytes remain omitted only from controlled machine output; no actual word/display text is repaired.

Shared controlled local-file prechecks now accept exactly model+VAD for Parakeet (no aligner); UTF-8 model paths use the existing wide loader; controlled decode cannot enter native alternatives or shell FFmpeg; cache download entry fails closed. The new control does not change ordinary upstream invocations or Qwen's required three roles. The smoke runner must supply a small allowlisted environment without CRISPASR/GGML tuning, freeze its entire argv/environment, inventory own-root DLLs, and validate output without Qwen anomaly merging.

These are source assertions, not CPU/CUDA success claims. Real output/device results are separate generated evidence. The model remains unavailable.

## Accepted P1 review corrections (r4; re-review pending)

- **R1:** The original encoder check above covered compute, not the preceding allocator. The actual `parakeet_encode_mel` allocation-failure branch now calls the controlled fatal helper before returning an empty vector. Every later slice, gap retranscription and streamed window reaches that shared function; failure can no longer enter the orchestrator's streamed retry or merge earlier valid text into an exit-zero partial result. Uncontrolled upstream diagnostic/empty return is unchanged. Prepared-source comparison against the preserved r3 tree found exactly one changed file and one inserted guard. `encoder_failure_check.py` extracts the complete function and real failure helper, exercises allocator failure at calls 1/5/6 and success on CPU/CUDA/uncontrolled modes, and removes the guard as a negative control. Its 24 cases are model-free source regressions, not induced GPU OOM claims.
- **R2:** Both P1 callers now use the same task-wide `cuda-ownership.json` gate. A flushed immutable attempt containing model/runtime/audio/caller identities, backend, actual argv/environment and owner PID+creation time is hash-bound by an atomic gate before suspended process creation. Reap is physical state; nonzero external exit is an abnormal outcome. An interrupted/dead owner leaves a blocker; reconciliation under `model.lock` rejects a live matching owner, a still-live recorded child, another backend, changed identities and CPU substitution. A successful same-identity short sentinel must additionally finish within 120 seconds; only its matching gate can be cleared after durable output/module/physical completion evidence. Unknown/live ownership fails closed rather than killing another owner. The source-level Job-assignment window stays suspended; any residual live process blocks further runs. Real model-free Python process tests cover external child termination, runner termination/Job cleanup and a live owner after mutex release for both engine bindings, plus wrong identity/deadline/clear mutations. No ASR model was terminated.
- **R3:** Consumed display/source/word text rejects exactly C0 and DEL, matching Native protocol policy; unused metadata may contain escaped NUL and Unicode characters outside that policy remain legal. Consumed source segment/word offsets must be integer, nonnegative, endpoint-ordered and audio-bounded; word centisecond values must match their integer millisecond offsets. Legal zero-duration raw anchors and overlap are not repaired or banned. Final display rows still require positive duration and nondecreasing starts. Source endpoint order is not an added global word non-overlap/order rule, which would exceed the protocol and inherited upstream word-anchor contract.

Previous r3 tools, source, local executable/DLL/cache bytes and generated evidence remain hash-verifiable at `native-asr/build/full-cli/p1-r3-preserved/`. New runtime/attempt/result identities and actual r4 timings are derived in `p1-evidence.json`; no old successful or failed row was relabeled.
