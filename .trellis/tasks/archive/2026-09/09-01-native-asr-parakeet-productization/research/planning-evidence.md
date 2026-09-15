# Parakeet integration planning evidence

## Authority and limits

Read-only planning research. No model download, compilation, inference, package replacement or product enablement was performed. Upstream code below is pinned to CrispASR `e2a356146e36bc1cc0410edefb01990448766979` (v0.8.32); the model card was read from mutable main and must be revision-pinned before acquisition. Source comments and model-card benchmark claims are not Hikaru Sub validation.

## Upstream findings

1. `examples/cli/crispasr_backend_parakeet.cpp`: native word timestamps are supplied by the TDT backend. Japanese detection uses vocabulary content. Japanese defaults do not advertise internal chunking; `prefers_vad()` returns `is_ja_model_`, `vad_slice_cap_seconds()` defaults to 12 for Japanese. Therefore the non-Japanese single-pass path is not the Japanese product design.
2. `examples/cli/crispasr_run.cpp`: auto-enables VAD when the backend prefers it and audio exceeds the backend window or 30 seconds, unless explicit chunking/VAD configuration overrides this. VAD slices are capped by the backend window. Strict VAD failure returns error 30. External alignment is optional, not required for Parakeet's native word times. Ordinary JSON receives `all_segs`, whereas display output uses `crispasr_make_disp_segments`; raw JSON cannot be presumed to contain display-split rows.
3. `src/crispasr_model_registry.cpp`: `parakeet-ja` maps to `cstr/parakeet-tdt-0.6b-ja-GGUF/parakeet-tdt-0.6b-ja-q8_0.gguf` on mutable main. Registry default is Q8_0; its comments warn Q4_K can loop with TDT. No exact artifact hash/size was established by this registry inspection.
4. Model card: `base_model: nvidia/parakeet-tdt_ctc-0.6b-ja`, `license: cc-by-4.0`; explicitly recommends F16 (`parakeet-tdt-0.6b-ja.gguf`), also calls Q8_0 a recommended smaller file. Both include TDT/CTC heads according to the card. Proposed first functional artifact is F16 + default TDT, following the card's main recommendation rather than prioritizing size; no comparison tournament. Exact revision/bytes/metadata remain implementation acquisition outputs, not invented planning inputs.
5. The model card describes upstream Japanese VAD/12-second splitting and a second transcription pass over gaps. `src/parakeet_orchestrate.cpp` distinguishes JA from its non-JA repair (`const bool repair = !is_ja`), documenting separate Japanese machinery through `crispasr_gap_fill_slice` in `examples/cli/crispasr_gap_fill.h`. The pinned `crispasr_gap_fill.h` was then inspected: default uncovered-time threshold is 100 cs, minimum override 30 cs, at most two rounds; padded actual PCM is passed to `be.transcribe(samples + s0, s1 - s0, win0_cs, params)`. It keeps backend-produced words/times with gap/coverage ownership checks, rebuilds text, and splits/merges/clamps segment bounds. It does not insert placeholder words or synthetic word timestamps, but upstream segment-bound changes and possible ASR hallucinations remain real behaviors, not accuracy guarantees. Owner subsequently approved retaining this complete upstream Japanese pipeline (D1). This permits upstream actual-audio retranscription and its segment-boundary reconstruction, not application-side custom gap fill or fabricated output.

## Source URLs

- https://raw.githubusercontent.com/CrispStrobe/CrispASR/e2a356146e36bc1cc0410edefb01990448766979/examples/cli/crispasr_backend_parakeet.cpp
- https://raw.githubusercontent.com/CrispStrobe/CrispASR/e2a356146e36bc1cc0410edefb01990448766979/examples/cli/crispasr_run.cpp
- https://raw.githubusercontent.com/CrispStrobe/CrispASR/e2a356146e36bc1cc0410edefb01990448766979/src/crispasr_model_registry.cpp
- https://raw.githubusercontent.com/CrispStrobe/CrispASR/e2a356146e36bc1cc0410edefb01990448766979/src/parakeet_orchestrate.cpp
- https://raw.githubusercontent.com/CrispStrobe/CrispASR/e2a356146e36bc1cc0410edefb01990448766979/examples/cli/crispasr_gap_fill.h
- https://huggingface.co/cstr/parakeet-tdt-0.6b-ja-GGUF/raw/main/README.md

## Local integration seams

- `native-asr/src/qwen_cli.cpp:276-328`: Qwen-specific role count, argv, runtime verification and controlled environment; process/path/output safety is reusable, Qwen inference assumptions are not.
- `native-asr/src/main.cpp:648-724`: existing production CLI dispatch is Qwen-specific; historical Parakeet-family policy is not the full upstream CLI route.
- `src-tauri/src/asr_worker.rs:200-268`: Qwen-only full-CLI branch owns additional path validation/private CLI work directory. Extend explicitly for the accepted Parakeet role contract.
- `src-tauri/resources/native-asr-models.json`: Qwen demonstrates compound logical-model delivery and shared Silero source metadata; Parakeet needs its own trusted model record, not guessed paths or Qwen pair reuse.
- `native-asr/runtime/full-cli/README.md`: exact shared runtime/source authority, Qwen-only device adaptations, package/publication boundaries. New Parakeet execution proof is required; Qwen graph checks cannot attest Parakeet graphs.

## Confirmed decision

D1: Owner explicitly approved complete upstream Japanese integration, including required existing CPU Silero readiness and upstream actual-audio gap retranscription. General VAD remains last; application-side synthetic timing/custom repairs remain prohibited. This is design approval, not authorization to implement, publish or change ReazonSpeech scope.
