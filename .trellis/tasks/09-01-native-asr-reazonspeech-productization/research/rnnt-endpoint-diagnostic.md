# Pure-RNNT endpoint diagnostic

## Result

**Semantic answer: yes, with an important qualification.** Standard NeMo RNN-T timestamp post-processing defines each nonblank token emitted at encoder timestep `t` as the half-open interval **`[t, t + 1)`**. ReazonSpeech independently uses the same one-encoder-step rule for a segment tail: `end_seconds = last_subword.seconds + 0.08`. This is primary upstream behavior, not an assumed convenience duration.

However, the approved 31,380–37,780 ms crop did **not** reproduce the already identified bad token. The cropped decode was context-sensitive: it emitted 24 tokens over 78 encoder frames and ended at 37,140 ms, whereas the retained full-route source segment emitted 27 tokens and contained bad token ordinal 26 at `[37,780, 37,780]`. Re-running VAD over the crop also changed the route's effective speech boundaries. No whole-medium replay was run. Therefore the exact offending token's blank/advance event remains empirically unbound, as required by the stop condition.

**Historical implementation disposition:** this first crop alone did not justify a runtime change. The later context-preserving replay bound bad token ordinal 26 and proved the same NeMo `[t,t+1)` rule in its original parent decode. The owner then approved exact intersection with that parent/gap invocation's actual PCM support; the final candidate and CPU/CUDA matrix pass. **No repair was applied during this diagnostic itself; accepted JSON/display output and product parsing were unchanged at this stage.**

## Exact diagnostic identity

| Item | Identity |
|---|---|
| CrispASR | v0.8.32, commit `e2a356146e36bc1cc0410edefb01990448766979` |
| Original pinned `src/parakeet.cpp` | SHA-256 `7cdeab5a90f27c862dcaa6efcf5fb7c5392a6931acf2a879886ad758da74b3e7` |
| Ignored-local diagnostic `src/parakeet.cpp` | SHA-256 `1a0a645da0befd844b98b59d60faddcd7afb13df60ee021b63e70cd903085195` |
| Original CPU `crispasr.exe` | SHA-256 `c6c7b4556b0a20a337f5aa76d919783b881c75f20d36c666115c5fd01781a68e` |
| Diagnostic CPU executable | SHA-256 `4386adcb0a1e9a4232d9e5b4289c05b8f0365cabc4f70b892c472b102f1caeeb` |
| Model | `reazon-research/reazonspeech-nemo-v2`, cstr Q8_0 revision `22799a5919ea26e3c5293fe0e68846fe7918a234`, SHA-256 `20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2` |
| VAD identity used by controlled crop | Silero v6.2.0, SHA-256 `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` |
| Medium WAV | 498.872 s mono PCM16/16 kHz, SHA-256 `6870afe1daa4579c885294b6b9a0031f35c195883e5af3bdab967b6178c9a458` |
| Approved span | `[31,380 ms, 37,780 ms)`, 102,400 PCM samples / 204,800 bytes, PCM SHA-256 `1ba1e2fe47b4840d29b48ee4aaadd711eb1bb078c4c97e826f005c1d6d5c612f` |
| Runtime decoding | CPU, greedy default (`beam_size=1`), 8 threads; instrumentation changed diagnostics only |
| Exact-slice harness | SHA-256 `415e7a0f0d46339939a38483208a82ae9c171d67d2fc066b2ac569aa6ab96c3d` |

A fresh complete upstream rebuild was attempted but exceeded 30 minutes while rebuilding unrelated pinned toolchain targets. The final diagnostic executable was instead linked in ignored scratch by recompiling only the copied `parakeet.cpp` object against the existing exact CPU build graph. The original source, object/library, and CPU executable were restored afterward; the restored executable hash is the original `c6c7…a68e` above.

## Observed event trace

### Retained offending-token identity

From the prior hash-bound full-route capture:

- display row ordinal: `13`
- source segment ordinal: `8`, offsets `[31,380, 37,780]` ms, chunk ordinal `3`
- source word ordinal: `24`
- source token ordinal: `26`
- current serialized interval: `[37,780, 37,780]` ms
- sanitized text fingerprint: SHA-256/16 `35c96e698019be4d`, 4 codepoints
- raw result SHA-256: `81b403a6be3dce1b303994726739bc6b52794c7e6e444693247e9c8da2e2d0ff`

### Bounded runtime replay

The exact PCM crop completed with exit code 0 and 104 sanitized decoder events. It reported:

```text
decoder_begin frames=78 frame_dur_cs=8 max_per_step=10
...
emit ordinal=20 frame=64 current=[64,64]
blank frame=64 next_frame=65 emitted_count=21 inner=1
...
emit ordinal=21 frame=68 current=[68,68]
blank frame=68 next_frame=69 emitted_count=22 inner=1
emit ordinal=22 frame=70 current=[70,70]
blank frame=70 next_frame=71 emitted_count=23 inner=1
emit ordinal=23 frame=72 current=[72,72]
blank frame=72 next_frame=73 emitted_count=24 inner=1
blank frame=73 next_frame=74 emitted_count=24 inner=0
blank frame=74 next_frame=75 emitted_count=24 inner=0
blank frame=75 next_frame=76 emitted_count=24 inner=0
blank frame=76 next_frame=77 emitted_count=24 inner=0
blank frame=77 next_frame=78 emitted_count=24 inner=0
decoder_end frames=78 emitted_count=24 steps=102
```

Observed properties:

- Every emitted label in this crop retained the current CrispASR point serialization `[t,t]`.
- Every emitted label was followed by a blank that advanced the encoder to `t+1`.
- No two labels were emitted on the same frame in this crop.
- No `max_per_step` advance occurred.
- The final emitted token was ordinal 23 at frame 72, serialized at 37,140 ms; it was followed by a real blank advance to frame 73.
- The original bad ordinal 26 / 37,780 ms token was absent. Thus the trace above is a decoder-semantic control, not a trace falsely relabeled as the offending token.

Sanitized trace SHA-256: `45fc2843ba54aa790ce57372acdd60543f37d41b5beac3faf0b2ac120f035053`. Private exact-slice result SHA-256: `336c81b80a19bd8496b1d15b14a43ed1096f5e0ebebcf5411fb462bf6aadf833`.

## Authoritative semantic sources

### Primary source

1. **NeMo Toolkit 2.7.3 standard RNN-T timestamp mapping**
   `nemo/collections/asr/parts/submodules/rnnt_decoding.py` (SHA-256 `ef502fa06a4e49d518f43fff43fc03d67e1a6c8b612afa2b9b63e08171b8941a`) defines standard RNNT token offsets as:

   ```python
   {"start_offset": s, "end_offset": s + 1}
   ```

   TDT is explicitly separate and uses `s + predicted_duration`. For pure RNNT, `_refine_timestamps` performs no later refinement. This is the strongest authority for `[t,t+1)`.

2. **NeMo greedy decoder**
   `rnnt_greedy_decoding.py` (SHA-256 `2e974a7647f2dd4e4d50992c304f9d18ea4bdec5082f219ced38fdd320c3b890`) appends `time_idx` for every nonblank label; a blank exits the label loop and the outer loop moves to the next acoustic timestep. NeMo's `Hypothesis` documentation describes `timestamp` as the index where the token appeared, not an already complete duration interval.

3. **NeMo beam decoder**
   `rnnt_beam_decoding.py` (SHA-256 `f1b3d96bde7fb496cb1a9888b10f6431133a107f484db9d5a27f117e65c73f15`) likewise appends encoder index `i`/`t` for nonblank expansions. The common `rnnt_decoding.py` post-processing supplies `end_offset=s+1`, so the semantic rule is not greedy-only.

4. **ReazonSpeech decoder**
   `pkg/nemo-asr/src/decode.py` at commit `aba06315c4c84c9af11239680e05414f9164a65d` (SHA-256 `059d4c9b13204a44739cc741e6fb268a0d58fd64af067e51fc90b757a3408463`) uses `SECONDS_PER_STEP = 0.08` and sets a segment tail to `last_subword.seconds + SECONDS_PER_STEP`. Commit `cca6b1f67d268048f38cf583d8dd819edbbe544a` is explicitly titled `fix: end_seconds of segment` and changed the former point endpoint to this one-step endpoint.

5. **Pinned CrispASR source**
   Greedy and beam pure-RNNT paths both store emitted labels as `{token,t,t,...}`. Blank advances one frame; `max_per_step` can also force one frame. This explains the defect but does not override NeMo/Reazon's interval mapping.

### Inference

- Because the pinned GGUF route is pure RNNT (`n_tdt_durations == 0`) with an 80 ms encoder step, NeMo's standard RNNT rule maps the current CrispASR point anchor `t` to `[t,t+1)`, or 80 ms in this model.
- This endpoint is a **frame-cell boundary defined by NeMo's timestamp API**, not proof that the next blank acoustically marks the end of the spoken character.
- ReazonSpeech's independent `+0.08` segment-tail behavior corroborates the same interval convention for this exact model family.

### Unknown

- The cstr GGUF model card does not identify the converter commit or the exact NeMo version used during conversion.
- The approved crop does not preserve the original chunk-3 encoder context, so the exact bad token's following event is still unknown.
- The original bad token's behavior at a possible final encoder frame cannot be evaluated until a context-preserving fixture exists.

## Boundary decisions and edge cases

| Candidate boundary | Decision | Reason |
|---|---|---|
| `t + 1` encoder-step boundary | **Yes, semantically legitimate** | Explicit NeMo standard RNNT offset mapping and ReazonSpeech `+0.08` segment endpoint. |
| Next blank/frame advance | **Corroborating, not the authority** | Normal greedy/beam blanks advance time, but NeMo defines `end=t+1` regardless of whether a particular trace exposes that blank as the next event. |
| `max_per_step` advance | **No** | A safety/progress cap, not a model-semantic endpoint. It must not be used as provenance. |
| Logical slice/VAD boundary | **No** | An orchestration boundary is not a token endpoint and must not be guessed. |
| Multiple labels on one frame | All receive `[t,t+1)` under NeMo | They may overlap. A shared later blank cannot create distinct token ends and should not be used to order/stretch them. |
| Final token at padded encoder end | **`[t,t+1)` intersect exact invocation PCM support** | NeMo supplies `t+1`; the later owner-approved rule removes only extent outside the actual PCM samples passed to that same parent/gap decode. A missing, outside or non-positive intersection fails closed; no logical slice-end guess is used. |

## Confidence

- **High:** NeMo's standard pure-RNNT public timestamp post-processing defines `[t,t+1)`.
- **High:** ReazonSpeech intentionally adds one 80 ms step to a segment's last token anchor.
- **High:** `max_per_step` and slice end are not authoritative token endpoints.
- **High:** pinned CrispASR currently discards this semantic duration by serializing `[t,t]` in both greedy and beam paths.
- **Medium:** the same correction applies without qualification to the pinned converted checkpoint, because converter-version provenance is incomplete.
- **Low/unknown:** exact event sequence after the retained bad token, because the bounded crop did not reproduce it.

## outputReference

The original agent output remains local to its session; this sanitized report is the tracked reference.

## artifactPaths

Ignored-local diagnostic artifacts:

- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/bin/crispasr-endpoint-diag.exe` — SHA-256 `4386adcb0a1e9a4232d9e5b4289c05b8f0365cabc4f70b892c472b102f1caeeb`
- `native-asr/build/full-cli/source-rnnt-endpoint-diagnostic/src/parakeet.cpp` — SHA-256 `1a0a645da0befd844b98b59d60faddcd7afb13df60ee021b63e70cd903085195`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/run-exact-slice/progress.jsonl` — sanitized ordinals/events only; SHA-256 `45fc2843ba54aa790ce57372acdd60543f37d41b5beac3faf0b2ac120f035053`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/run-exact-slice/result.json` — private/raw, contains transcript text; SHA-256 `336c81b80a19bd8496b1d15b14a43ed1096f5e0ebebcf5411fb462bf6aadf833`
- `native-asr/build/full-cli/acquisition/rnnt-endpoint-diagnostic/run-exact-slice/stderr.raw` — private/raw; SHA-256 `bd7fa754b7f591e6197fe9fe30eb8337e09f4053db1722b74ea5365436290ade`
- `native-asr/build/full-cli/acquisition/zero-duration-investigation/cpu-medium/result.json` — prior private/raw source capture; SHA-256 `81b403a6be3dce1b303994726739bc6b52794c7e6e444693247e9c8da2e2d0ff`

No transcript text, vocabulary IDs, logits, private absolute source paths, or sensitive stderr are included in this report. No medium/long/CUDA matrix, packaging, release, publication, commit, push, lock switch, or output repair was performed.
