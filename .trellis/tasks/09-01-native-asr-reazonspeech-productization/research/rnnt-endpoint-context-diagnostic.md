# Context-preserving pure-RNNT endpoint diagnostic

## Scope and result

Research/diagnostic only. **No endpoint repair was applied during this diagnostic.** No tracked production source, test, manifest, lock, spec, task requirement, runtime authority, accepted JSON/display behavior, or product parser behavior was changed at this stage. No full-medium ASR, long audio, CUDA, matrix, packaging, release, publication, commit, push, version, or CHANGELOG action was run here.

**Subsequent owner disposition:** the owner approved NeMo `[t,t+1)` plus exact intersection with the actual PCM sample support supplied to the same parent/gap decode call. This removes only convolution-padding extent outside real input PCM; it is not next-cue, display/VAD/slice-end guessing. The final candidate and CPU/CUDA short/medium/long matrix pass.

**Result: implementation and validation of the pure-RNNT endpoint correction are now justified.** The exact original full-route CPU chunk containing medium source segment 8 was reconstructed and replayed without re-running VAD over the crop. A one-slice VAD import drove the pinned full CLI over the original medium file with the controlled Reazon CPU policy enabled; a second seam replay of the identical PCM retained private token arrays for ordinal identity. Their sanitized decoder traces are byte-identical. Together they reproduced all four original chunk-3 source segments exactly. The known bad source token ordinal 26 was then observed in the primary full-slice greedy decode at encoder frame `t=83` of `T_enc=132`, followed immediately by a real blank advance `83 -> 84`. NeMo's public standard RNNT convention maps this token to `[83,84)`, which maps absolutely to `[37,780,37,860)` ms. That endpoint is 3,780 ms before the exact slice end and is inside the 498,872 ms audio.

The token is **not** on the final encoder frame: final frame index is 131, leaving 48 encoder frames after frame 83. The previously unresolved final-frame concern therefore does not apply to this token. A separate generic padded-final-frame edge remains known: this 10,500 ms input produced 132 x 80 ms = 10,560 ms of encoder-grid extent, so a hypothetical emission on frame 131 would have a NeMo endpoint 60 ms beyond raw PCM. The approved implementation intersects only with the exact actual sample support of that same decode invocation; an outside or non-positive intersection remains fail-closed.

## Exact identities

| Item | Identity |
|---|---|
| CrispASR | v0.8.32, commit `e2a356146e36bc1cc0410edefb01990448766979` |
| Pinned original `src/parakeet.cpp` | SHA-256 `7cdeab5a90f27c862dcaa6efcf5fb7c5392a6931acf2a879886ad758da74b3e7` |
| Diagnostic-only copied `src/parakeet.cpp` | SHA-256 `1a0a645da0befd844b98b59d60faddcd7afb13df60ee021b63e70cd903085195` |
| Original CPU `crispasr.exe` | SHA-256 `c6c7b4556b0a20a337f5aa76d919783b881c75f20d36c666115c5fd01781a68e` |
| Diagnostic CPU executable | SHA-256 `4386adcb0a1e9a4232d9e5b4289c05b8f0365cabc4f70b892c472b102f1caeeb` |
| Logical model | `reazon-research/reazonspeech-nemo-v2` |
| Upstream model revision | `33693408be76b7cba9fd4a7546a0a8772430211b` |
| cstr GGUF revision | `22799a5919ea26e3c5293fe0e68846fe7918a234` |
| Q8_0 model | 667,147,072 bytes; SHA-256 `20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2` |
| Silero VAD | v6.2.0, revision `9ffd54a1e1ee413ddf265af9913beaf518d1639b`; SHA-256 `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` |
| Tracked acquisition lock | SHA-256 `8b4b54883801c4df2d44c88c281f5ca092918aabf0a9f6aab18fda9d66999e98` |
| Medium WAV | mono PCM16, 16 kHz, 7,981,952 frames, 498,872 ms; SHA-256 `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` |
| Retained full-route CPU medium result | SHA-256 `81b403a6be3dce1b303994726739bc6b52794c7e6e444693247e9c8da2e2d0ff` |
| NeMo public source | v2.7.3 tag commit `1d4ee423806d461f9146ae982f9da8eb32495ae7` |
| NeMo `rnnt_decoding.py` | SHA-256 `ef502fa06a4e49d518f43fff43fc03d67e1a6c8b612afa2b9b63e08171b8941a` |
| NeMo `rnnt_greedy_decoding.py` | SHA-256 `2e974a7647f2dd4e4d50992c304f9d18ea4bdec5082f219ced38fdd320c3b890` |
| NeMo `rnnt_beam_decoding.py` | SHA-256 `f1b3d96bde7fb496cb1a9888b10f6431133a107f484db9d5a27f117e65c73f15` |
| ReazonSpeech decoder source | commit `aba06315c4c84c9af11239680e05414f9164a65d`; SHA-256 `059d4c9b13204a44739cc741e6fb268a0d58fd64af067e51fc90b757a3408463` |

## How the original context was reconstructed

1. The retained full-route result identifies source segment 8 as `chunk_id=3` and records its source interval as `[31,380,37,780]` ms.
2. A bounded VAD-only pass over the frozen medium WAV used the frozen Silero model and the route's 12-second Reazon/JA slice cap. It performed no ASR decode and produced 53 slices, matching the retained full-route log's `processing 53 slice(s)`.
3. Exported chunk ordinal 3 is exactly:
   - sample range `[498,240,666,240)`;
   - absolute time range `[31,140,41,640)` ms;
   - 168,000 mono samples / 336,000 PCM bytes;
   - slice PCM SHA-256 `323a4ea0765a0831a766ce9f811aab7cb0e48fd6279741bbc1e833e8a60a60d5`.
4. Pinned `crispasr_chunk_context_gate.h` disables overlap-save extension for VAD-derived slices. Therefore the original encoder input for chunk 3 was the bare sample range above, not the narrower source segment and not neighboring chunks.
5. An ignored-local one-slice VAD import then selected exactly chunk 3 from the original full medium file. The pinned full CLI ran with the controlled Reazon CPU environment, explicit model + VAD roles, strict pipeline requirements, and the original absolute slice offset. It processed only this imported chunk; no unrelated medium chunk was decoded.
6. The controlled product JSON path supplies display rows and therefore omits private token arrays. A second ignored-local seam replay fed the identical `[498240,666240)` PCM directly with absolute offset 31,140 ms and VAD disabled. This retained token arrays for ordinal/fingerprint identity without changing encoder or decoder input.
7. The full-route-import and direct-seam decoder traces are byte-identical (same SHA-256 below). This also avoids the previous experiment's context-changing mistake of running VAD over the narrower `[31,380,37,780)` crop.
8. The route's own gap-fill logic made two additional decoder calls on subranges within this same chunk; both remained inside chunk 3.

VAD export identity:

- `context-vad/vad-slices.json`: SHA-256 `be4cc45b42d5cdb6db0457b5da6520be9261490c5d9ccc2e1533750849a1bb0b`
- kind `chunks`, sample rate 16,000, `chunk_cs=1200`, 53 slices
- chunk 3: samples `[498240,666240)`, centiseconds `[3114,4164)`

## Reproduction identity check

The controlled full-route import produced four source segments with exact segment/word offsets and sanitized text fingerprints; its word-level chunk fingerprint `998d2e60a228f777cb81dc297e3fc75f14eb598a364db2e1cccbb73969f6cba9` matches the retained chunk. The direct seam replay additionally retained token arrays and produced four source segments exactly matching all retained source segments whose original `chunk_id` was 3.

| In-chunk source ordinal | Absolute offsets ms | Tokens | Words | Sanitized source fingerprint | Match |
|---:|---:|---:|---:|---|---|
| 0 (original global source segment 8) | `[31,380,37,780]` | 27 | 25 | `e8c6d1620f5f95e999d6f02f1bc60a013256dc65f2aeb154184d407774789642` | exact |
| 1 | `[38,950,39,190]` | 2 | 1 | `e2787429f798d3500607404e3729bb8dfc8a71d8f298095ff0283813b83628d4` | exact |
| 2 | `[39,190,39,190]` | 1 | 1 | `51419d750d329288c865ee74987e7ab97d1900d8550e1bd5d8866b4176fb6e28` | exact |
| 3 | `[40,100,41,620]` | 9 | 8 | `c434560c9291123f8e934afed6fe3c0eaee78d684c6335902ada25f07968019a` | exact |

The combined sanitized chunk fingerprint is `862b7e98dd5e8bba6dc93c1b2936600edee3c38b46a0891f0bdeb2de02ec0f64` for both retained and replayed results. Each fingerprint is derived only from source offsets, per-token/per-word text SHA-256 values, codepoint counts, and ordinals; it contains no transcript text or vocabulary IDs.

Known bad identity reproduced exactly:

- original global source segment: 8;
- replay in-chunk source segment: 0;
- source segment offsets: `[31,380,37,780]` ms;
- source token count: 27;
- source word count: 25;
- source word ordinal: 24;
- source token ordinal: 26;
- current token/word interval: `[37,780,37,780]` ms;
- sanitized text fingerprint: SHA-256/16 `35c96e698019be4d`, 4 codepoints.

Because the controlled full-route import and direct seam replay have byte-identical decoder traces, while the direct replay also reproduces the full in-chunk per-token/per-word structure and exact bad ordinal/anchor, the trace is accepted as the original context rather than a context-sensitive substitute.

## Exact event trace for source token ordinal 26

The diagnostic executable changed logging only. It retained the current emitted interval `{t,t}` and did not alter token selection, blank behavior, result construction, JSON, display grouping, or parser behavior.

The replay contained three decoder calls:

| Call | Purpose | `T_enc` | Emitted tokens | Steps | `max_per_step` advances |
|---:|---|---:|---:|---:|---:|
| 0 | Primary exact full-slice decode | 132 | 36 | 168 | 0 |
| 1 | Same-chunk gap-fill subrange | 34 | 4 | 38 | 0 |
| 2 | Same-chunk gap-fill subrange | 23 | 3 | 26 | 0 |

The known bad token is in primary call 0, so it is not a gap-fill-only artifact.

Sanitized event sequence:

```text
decoder_begin frames=132 frame_dur_cs=8 max_per_step=10
...
blank frame=82 next_frame=83 emitted_count=26 inner=0
emit ordinal=26 frame=83 current_start_frame=83 current_end_frame=83 inner=0
blank frame=83 next_frame=84 emitted_count=27 inner=1
blank frame=84 next_frame=85 emitted_count=27 inner=0
...
decoder_end frames=132 emitted_count=36 steps=168
```

Exact findings:

- emission frame `t`: 83;
- all same-frame emissions at frame 83: only source token ordinal 26;
- following event: blank at frame 83;
- following frame advance: `83 -> 84`;
- `max_per_step`: 10 configured, not reached for this frame; no `max_per_step` advance anywhere in the primary call;
- `T_enc`: 132;
- valid encoder frame indices: 0 through 131;
- frame duration: 8 centiseconds / 80 ms;
- current CrispASR interval: `[83,83]`, absolute `[37,780,37,780]` ms;
- NeMo candidate interval: `[83,84)`, absolute `[37,780,37,860)` ms.

Sanitized decoder trace SHA-256: `a9f652befe8b9af6bab502412c4ad222d12698d8c4b13afdfe1786cf4deb8bba`. The controlled full-route import and direct seam replay produced this same trace hash.

## Legality of `[t,t+1)` for this token

The exact mapping is:

```text
slice offset              = 31,140 ms
frame duration            = 80 ms
emission frame t          = 83
start                      = 31,140 + 83 * 80 = 37,780 ms
NeMo end boundary t + 1   = 31,140 + 84 * 80 = 37,860 ms
```

Bounds:

```text
audio                      [0, 498,872) ms
exact source slice         [31,140, 41,640) ms
candidate token interval   [37,780, 37,860) ms
```

Therefore, for this exact token:

- `[t,t+1)` is a positive 80 ms half-open interval;
- the endpoint is 3,780 ms before the slice end;
- the endpoint is 461,012 ms before the audio end;
- the endpoint is not derived from the next cue, display row, gap boundary, VAD boundary, or slice end;
- no clip, stretch, merge, protocol relaxation, or synthetic fallback is required.

**Legality conclusion: yes.** NeMo/ReazonSpeech `[t,t+1)` maps to a legal, in-slice, in-audio endpoint for the known bad token.

## Final-frame and slice-boundary conclusion

For the known bad token, the question is resolved decisively:

- `t=83`;
- `T_enc=132`;
- final encoder frame index is 131;
- 48 frames follow frame 83;
- a real blank advances to frame 84 immediately after emission;
- the candidate endpoint is well inside the original slice.

Thus neither encoder exhaustion nor a VAD/slice boundary caused this token's zero duration. The zero duration is solely the current CrispASR pure-RNNT serialization of a point anchor as `{t,t}`.

Generic final-frame edge, now characterized rather than guessed:

- raw slice duration: 10,500 ms;
- encoder grid: `132 * 80 = 10,560` ms;
- a hypothetical emission on final frame 131 would have the NeMo endpoint at 10,560 ms, 60 ms beyond this raw slice because the encoder grid includes padded extent;
- NeMo's public RNNT convention still defines the encoder-domain interval as `[131,132)`; product output uses only its intersection with the exact actual PCM support passed to that invocation, not a guessed logical slice boundary.

No final-frame token was observed for the bad ordinal. The later authoritative CPU/CUDA matrix exercised the approved exact-support intersection and completed with legal output; an outside or non-positive intersection still fails closed.

## Greedy and beam implications

### Observed greedy runtime

The production-default greedy trace provides direct event evidence for this token: one nonblank at frame 83, then blank and frame advance to 84. The blank is corroborating runtime behavior, while NeMo's public timestamp post-processing is the semantic authority for `end_offset=t+1`.

### NeMo public semantics

NeMo v2.7.3 standard RNNT post-processing emits, for every nonblank token:

```text
start_offset = s
end_offset   = s + 1
```

Greedy appends the acoustic `time_idx` for a nonblank. Beam search likewise appends encoder index `i`/`t` for nonblank expansions. All standard RNNT search modes then use the common `[s,s+1)` post-processing. TDT remains separate and uses predicted duration.

### Pinned CrispASR beam semantics

Pinned CrispASR pure-RNNT beam search has the same acoustic-time model as greedy:

- blank sets `t = parent.t + 1`;
- nonblank stays at `parent.t`;
- current code stores the nonblank as `{parent.t,parent.t}`;
- `max_per_step` is only a progress cap and must not define token duration.

Pure-RNNT MAES likewise stores `{t,t}` while time advances by encoder frame. Therefore the source-backed endpoint correction applies consistently to greedy, standard beam, and pure-RNNT MAES. It must not alter TDT, CTC, token selection, blank transitions, beam scoring, or search order.

ReazonSpeech independently corroborates the same model-family convention: its decoder defines `SECONDS_PER_STEP=0.08` and sets a segment tail to the final subword time plus one step.

## Implementation disposition

**Is implementation now justified? Yes — for implementation and validation, not for availability or release promotion.**

The semantic and empirical prerequisites are both present:

1. authoritative NeMo standard RNNT `[t,t+1)` semantics;
2. independent ReazonSpeech `+0.08` tail behavior;
3. exact context reproduction of the original bad token;
4. observed emission at frame 83;
5. observed following blank advance to 84;
6. candidate endpoint inside both exact slice and audio bounds;
7. no dependence on a synthetic cue/display/VAD boundary.

### Precise smallest implementation shape (description only)

1. In pinned `src/parakeet.cpp`, change only pure-RNNT nonblank emission intervals from `{t,t}` to `{t,t+1}` at the three pure-RNNT emission seams:
   - greedy `parakeet_rnnt_decode`;
   - standard beam `parakeet_rnnt_beam_decode`;
   - pure-RNNT MAES `parakeet_rnnt_maes_decode`.
2. Leave TDT duration handling, CTC timing, decoder decisions, token IDs, probabilities, blank/frame advancement, grouping, JSON units, display construction, product protocol, and parser behavior unchanged.
3. Do not use the observed blank itself, `max_per_step`, next token/cue, slice end, or audio end as an alternate endpoint. The source value is always the NeMo one-step encoder boundary.
4. Preserve strict fail-closed validation. Apply the owner-approved intersection only against the exact actual PCM sample support carried by the same parent/gap decode call; do not use logical slice/audio metadata as a guessed endpoint. Reject outside or non-positive intersections.
5. Add focused model-free tests covering greedy, beam, and MAES pure-RNNT `[t,t+1)` construction, multiple same-frame labels sharing the same half-open cell, `t=T_enc-1` encoder-domain behavior, and proof that TDT/CTC paths are unchanged.
6. Then run the already-required ReazonSpeech CPU/CUDA short/medium/long functional/structural matrices and shared-runtime regressions. No CER, semantic-gap, Python-parity, subtitle-quality, or performance qualification is implied.

No code change was made in this diagnostic.

## Remaining unknowns and risks

- The cstr GGUF model card still does not identify its exact converter commit or exact NeMo conversion environment. This does not negate the observed pinned runtime event or the public NeMo/Reazon interval convention, but it remains a provenance limitation.
- No beam runtime was executed; beam implications are source-derived from pinned CrispASR and NeMo. The production-default bad token was traced under greedy execution.
- No CUDA run was performed. CUDA is required only after a candidate source change exists, per the task's functional matrix.
- No full-medium/long matrix was run. By scope, this experiment proves the exact known token and characterizes the padded-final-frame edge; it does not assert that no other token lands on a padded final frame.
- The exact bad token is proven to originate in the primary full-slice decode, not the later same-chunk gap-fill calls. Other historical bad rows retain their previously documented provenance limitations unless separately traced.

## outputReference

The original agent output remains local to its session; this sanitized report is the tracked reference.

## artifactPaths

Ignored-local diagnostic artifacts; raw result/stderr files may contain transcript text or private paths and must remain untracked:

- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-vad/vad-slices.json` — SHA-256 `be4cc45b42d5cdb6db0457b5da6520be9261490c5d9ccc2e1533750849a1bb0b`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-vad/run-summary.json` — SHA-256 `c37a589dc552aba95ed6df18077c157dc3805b4b57375b6b2d712ee96bfd1caa`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-chunk3-full-route/one-slice-import.json` — exact ignored-local chunk selector; SHA-256 `8c41dd05b0deaf74bba97ac0f2d042846d554a8b6a886886cc758051fd3446df`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-chunk3-full-route/progress.jsonl` — sanitized controlled full-route trace; SHA-256 `a9f652befe8b9af6bab502412c4ad222d12698d8c4b13afdfe1786cf4deb8bba`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-chunk3-full-route/result.json` — private/raw controlled result; SHA-256 `51401e4b888fd305b0efe32bc5cc690dc9f190f4dc0db70ac55552ca4633dea2`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-chunk3-full-route/run-summary.json` — SHA-256 `06d739562657d1c3cc8e348770d7ecbcb131ae7d7bc9bd126b7bb3aa3e939a47`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-chunk3-full-route/stderr.raw` — private/raw; SHA-256 `46a2edc760df2aaa3d2aeb9a56cdc4decad92467d45db585545f2d23d61e383c`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-chunk3-full-route/stdout.raw` — private/raw; SHA-256 `22c1a022abf1d3ebaf1ab2a154a8af044d4554e5101052e5a77b5662cac7f17e`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-chunk3/progress.jsonl` — sanitized ordinals/frame events only; SHA-256 `a9f652befe8b9af6bab502412c4ad222d12698d8c4b13afdfe1786cf4deb8bba`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-chunk3/result.json` — private/raw; SHA-256 `8d9dd81f244e3437994b69d51b4ce867824f006affd8eaa95f4acf73cf539f54`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-chunk3/run-summary.json` — SHA-256 `e02443770abef5ce932c1ce6f4fd05cd1b734de764c49239b9be0f8ca90b1204`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-chunk3/stderr.raw` — private/raw; SHA-256 `1f489adc0a2538b7085961f422f4c8b813982ac9b3d139dd3f652e2973e88b48`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/context-chunk3/stdout.raw` — private/raw; SHA-256 `22c1a022abf1d3ebaf1ab2a154a8af044d4554e5101052e5a77b5662cac7f17e`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/bin/crispasr-endpoint-diag.exe` — SHA-256 `4386adcb0a1e9a4232d9e5b4289c05b8f0365cabc4f70b892c472b102f1caeeb`
- `native-asr/build/full-cli/source-rnnt-endpoint-diagnostic/src/parakeet.cpp` — SHA-256 `1a0a645da0befd844b98b59d60faddcd7afb13df60ee021b63e70cd903085195`
- `native-asr/build/full-cli/acquisition/zero-duration-investigation/cpu-medium/result.json` — prior private/raw authority; SHA-256 `81b403a6be3dce1b303994726739bc6b52794c7e6e444693247e9c8da2e2d0ff`

The new VAD and chunk outputs are ignored by `native-asr/.gitignore` (`/build/`). Post-run process inventory found no remaining CrispASR/RNNT process. No repair was applied.
