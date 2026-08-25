# Ordinary Faster-Whisper upstream parity audit

## Scope and authority

> **Non-qualification research only.** This audit does not select or freeze a candidate, authorize a third model-backed diagnostic, qualify either Whisper anchor, create CPU inheritance, or change a product route. It reads source and existing ignored diagnostic evidence only; no model-backed inference was run.

The comparison is pinned to:

- faster-whisper `1.2.1`, commit `65882eee9f5cdbeeb2d877f1131d48cf241b327d`;
- installed `faster_whisper/transcribe.py`, 80,403 bytes, SHA-256 `5d5ffb00018561d3d529b2c72e1d9f5fff055bea725f3cccc7c6c67f5cc8ffe4`;
- native CTranslate2 `4.8.0` ordinary Whisper implementation in `native-asr/src/ctranslate2_whisper.cpp`;
- the tracked first and exact-VAD diagnostic publications; ignored raw rows are used only for sanitized aggregate counts.

Verified public authority:

- <https://github.com/SYSTRAN/faster-whisper/tree/65882eee9f5cdbeeb2d877f1131d48cf241b327d>
- <https://github.com/SYSTRAN/faster-whisper/blob/65882eee9f5cdbeeb2d877f1131d48cf241b327d/faster_whisper/transcribe.py>
- <https://github.com/OpenNMT/CTranslate2/blob/v4.8.0/include/ctranslate2/models/whisper.h>

## Exact Python baseline route by anchor and case

The corpus durations are `24,102ms`, `498,872ms`, and `4,144,235ms` for short-v1, medium-v1, and long-v2 respectively (`.asr-benchmark/manifest.json`). The product selects its special long path only for `faster-whisper + large-v2 + ja + duration >= 600,000ms` (`asr-service/engines/faster_whisper.py:689-712`).

| Logical model | Case | Source-proven Python route |
|---|---|---|
| large-v3 | short-v1 | ordinary direct path: installed upstream `WhisperModel`, exact Silero V6 upstream VAD, beam 5, all other upstream defaults |
| large-v3 | medium-v1 | same ordinary direct path |
| large-v3 | long-v2 | same ordinary direct path; large-v3 never enters the project long-mode fork |
| large-v2 | short-v1 | ordinary direct path because duration is below 600 seconds |
| large-v2 | medium-v1 | ordinary direct path because duration is below 600 seconds |
| large-v2 | long-v2 | project long path: Silero V4 compression, `FasterWhisper121Model`, beam 5, previous text on, word timestamps on, restored source timestamps |

Direct-route evidence:

- non-long loads instantiate upstream `WhisperModel`; only long mode substitutes `FasterWhisper121Model` (`asr-service/engines/faster_whisper.py:429-486`);
- direct transcription passes `vad_filter=True`, `beam_size=5`, and no additional ordinary options (`asr-service/engines/faster_whisper.py:521-542`, `:366-368`);
- when no product VAD override is supplied, `vad_parameters=None`, so faster-whisper 1.2.1 uses its pinned defaults (`asr-service/engines/faster_whisper.py:370-388`);
- large-v2 long-v2 uses the separate path at `asr-service/engines/faster_whisper.py:592-687`.

This route asymmetry matters later: the two Python anchors do not use one algorithm on long-v2. Native still must use one frozen candidate identity across both anchors and merely satisfy each same-model quality floor; it must not copy the large-v2 Python long path as a native implementation template.

## Source-proven parity table

| Area | faster-whisper 1.2.1 / Python product | Native | Disposition |
|---|---|---|---|
| Beam and ordinary decode penalties | beam 5; patience/length/repetition `1`; no-repeat ngram `0` (`transcribe.py:747-778`, `:970-1003`) | same fields exist and are passed to CT2 (`ctranslate2_whisper.hpp:59-75`; `ctranslate2_whisper.cpp:1560-1571`) | parity for the beam-5 diagnostic identities |
| Prompt layout | optional `sot_prev + newest 223 previous tokens`, then `sot + language + task` (`transcribe.py:1187-1206`, `:1532-1565`) | same ordering and 223-token cap (`ctranslate2_whisper.cpp:816-832`) | structural parity |
| Generation fallback | fixed ladder `0.0,0.2,0.4,0.6,0.8,1.0`; retry on compression ratio `>2.4` or average log probability `<-1`; silence override; sampling attempts use beam 1, best-of 5, top-k 0 (`transcribe.py:747-775`, `:1402-1530`) | exactly one CT2 generate call at fixed temperature `0.0`; no compression-ratio calculation or retry (`ctranslate2_whisper.hpp:66-72`; `ctranslate2_whisper.cpp:1573-1586`) | **material mismatch** |
| Prompt reset | reset boundary uses the temperature selected by fallback (`transcribe.py:1372-1383`) | compares the immutable config temperature, always `0.0` in these rows (`ctranslate2_whisper.cpp:1712-1719`) | **material consequence of missing fallback** |
| History eligibility | upstream adds tokens only for non-empty, positive-duration yielded segments (`transcribe.py:1344-1352`) | parser appends every timestamp slice to history before checking whether it has text (`ctranslate2_whisper.cpp:1073-1095`), then appends those tokens to history (`:1712-1715`) | material medium-only mismatch; cannot explain short-v1 |
| Timestamp splitting and seek | upstream uses consecutive timestamps; single-timestamp ending advances by the source window, otherwise advances to the last completed timestamp (`transcribe.py:1031-1101`, `:1265-1276`) | implements the same high-level branches (`ctranslate2_whisper.cpp:1043-1140`, `:1721-1750`) | high-level parity; stricter native source-end validation remains intentional |
| No-speech decision | skip when no-speech is above `0.6` unless average log probability is above `-1` (`transcribe.py:1215-1235`) | algebraically equivalent predicate (`ctranslate2_whisper.cpp:1600-1624`) | parity; existing diagnostic rows skipped no windows |
| Suppression | upstream resolves default non-speech/control suppression and blank-at-start before CT2 generation (`transcribe.py:970-1003`, `:1446-1458`, `:1884-1907`) | native leaves CT2 `WhisperOptions` defaults: blank suppression on and token list `[-1]`; CT2 resolves `-1` from converted model `suppress_ids` | no code-supported mismatch; pinned large-v3 converted config contains 88 default suppressed IDs |
| Word timestamps | false on ordinary direct large-v3 (`transcribe.py:778`; product passes no override) | absent | parity for large-v3 ordinary baseline; not a candidate variable |
| VAD | direct product path enables pinned upstream V6 VAD (`faster_whisper.py:535-541`) | second diagnostic used the exact V6 asset/settings and independently validated restoration | parity seam exercised; quality failed, so VAD alone is closed |
| Final audio bounds | upstream may return a row that is structurally out of bounds; the baseline reports one timeline error for large-v3 short and medium | native bounds only a token-derived end with raw provenance and rejects a start at/after audio end (`ctranslate2_whisper.cpp:1647-1703`) | native strictness is required by the absolute gate and must not be relaxed for parity |

## Sanitized facts from existing raw traces

No transcript, token ID, raw event body, or private path is reproduced below.

| Row | Status | Windows | Generation calls | Fallback calls | History-bearing windows | Generated-token count | Total source overlap | Segments |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| short-b1-off | completed | 1 | 1 | 0 | 0 | 88 | 0ms | 4 |
| short-b5-off | completed | 1 | 1 | 0 | 0 | 106 | 0ms | 5 |
| medium-b1-off | completed | 18 | 18 | 0 | 0 | 2,019 | 33,400ms | 197 |
| medium-b5-off | completed | 18 | 18 | 0 | 0 | 1,984 | 33,400ms | 180 |
| medium-b1-on | failed (`timestamp_after_audio`) | 53 | 53 | 0 | 52 | 11,318 | 1,018,720ms | 401 before failure |
| medium-b5-on | completed | 18 | 18 | 0 | 17 | 2,144 | 11,620ms | 206 |
| short-b5-vad | completed | 1 | 1 | 0 | 0 | 106 | 0ms | 5 |
| medium-b5-on-vad | completed | 17 | 17 | 0 | 16 | 2,294 | 17,780ms | 179 |

Additional source-proven observations:

- every diagnostic window made exactly one generation call and zero fallback calls;
- no diagnostic window was skipped by the no-speech predicate;
- short VAD retained all `385,637` samples, explaining its byte-identical quality result relative to no-VAD beam 5;
- medium VAD retained `7,593,600 / 7,981,952` samples in 10 intervals;
- all medium beam-1/beam-5 off/on completed windows had average log probability above `-1`; this does **not** prove upstream fallback would be inactive because compression-ratio telemetry was not acquired;
- medium-b1-on's 53-window/1,018,720ms overlap runaway is consistent with history/seek instability, but it is not evidence that the same mechanism causes the one-window short insertion regression.

## Ranked causal mismatches

### 1. Missing exact upstream generation fallback — high confidence source mismatch, unproven output causality

**Fact:** large-v3 Python baseline uses the upstream fallback ladder by default. Native always accepts the first temperature-0 result and records zero fallback calls. This is the only verified decode-policy mismatch that exists in the one-window short case as well as medium.

**Hypothesis:** one or more Python baseline windows retried because of compression ratio, changing text and possibly selecting a temperature above `0.5`, which also resets later history. That could address both the short insertion blocker and medium history-conditioned coverage/text failures under one upstream-defined mechanism.

**Limitation:** existing Python baseline evidence does not record per-window attempts, selected temperature, or compression ratio. Therefore the audit cannot claim that fallback actually fired or that it will improve quality.

### 2. Native retains non-emitted timestamp slices in previous-text history — high confidence source mismatch, medium-only

**Fact:** upstream history grows only from yielded legal non-empty segments; native history grows from all parsed timestamp slices before the text check.

**Hypothesis:** this can perturb later prompts and contributes to the beam-1/history-on runaway or beam-5/history-on coverage difference.

**Why it is not the next candidate:** short-v1 has one window and no history, so this change cannot address the mandatory short insertion blocker by itself. The task requires a candidate grounded in the complete known failure distribution.

### 3. Final-window parser strictness — high confidence source difference, rejected as a quality revision

Native rejects start-at/after-audio while Python can publish a timeline-error row. Relaxing native would violate the independent zero-timeline-error gate and merely imitate invalid output. End bounding with raw provenance already covers the only allowed correction.

### 4. Large-v2 long product fork — confirmed future compatibility risk, not a large-v3 causal variable

The Python large-v2 long-v2 baseline uses Silero V4, project prompt-state behavior and word timestamps, unlike every large-v3 row. A future formal candidate must still pass this baseline with one native identity, but importing this special path into ordinary native Whisper would broaden the candidate beyond the present large-v3 root-cause question.

## Rejected hypotheses

- **Beam/history-only:** the frozen six-cell diagnostic selected nothing.
- **Exact V6 VAD alone:** it cleared the medium gap but regressed medium CER and all S/D/I fields; short was unchanged.
- **No-speech threshold:** source predicates match and no diagnostic window was skipped.
- **Suppression defaults:** both paths enable blank suppression and the converted model's default suppression inventory; no missing suppression setting is demonstrated.
- **Word timestamps for large-v3:** the Python large-v3 direct route leaves them disabled.
- **More beam values or arbitrary VAD tuning:** no code parity evidence supports a grid.
- **Relaxing timeline validation:** forbidden by the absolute gate.
- **Reference-derived repair, transcript seeding, output stitching, or post-processing:** forbidden and not causal implementation parity.
- **GPU performance/resource pressure:** every diagnostic row passed GPU RTF/RSS and the failures are textual/coverage-specific.

## Exactly one recommended next single-causal candidate

### `upstream-generation-fallback-parity-v1`

Recommend planning one candidate whose **only causal implementation change** is replacing the current single temperature-0 generation call with the exact faster-whisper 1.2.1 `generate_with_fallback` policy:

- fixed attempts `0.0, 0.2, 0.4, 0.6, 0.8, 1.0`;
- temperature 0 uses the frozen beam 5/patience path;
- positive temperatures use beam 1, best-of/num-hypotheses 5, top-k 0;
- exact UTF-8/zlib compression-ratio threshold `2.4`, average-log-probability threshold `-1.0`, silence override, and all-failed selection;
- use the selected attempt temperature for the existing `>0.5` prompt-reset rule;
- retain beam 5, previous text on, exact V6 VAD, timestamp-driven seek, parser, model, GPU identity and all other second-diagnostic inputs unchanged.

This is an upstream algorithm-parity unit, not a temperature search. It is preferred over fixing history eligibility first because it is the only code-supported mismatch present in both the one-window short blocker and medium.

**This recommendation does not authorize acquisition.** Before any model load, the smallest required validation is:

1. pure/fake-generation tests that compare native decision vectors with the installed 1.2.1 Python oracle for: no retry, compression retry, log-probability retry, silence override, first passing attempt, and all-failed best-result selection;
2. assertions for exact per-attempt beam/sampling options and maximum six calls;
3. a prompt-state test proving that only the selected temperature controls the `>0.5` reset boundary;
4. closed identity/config serialization and trace fields for attempt count, selected temperature, trigger categories and per-attempt aggregate hashes, with no transcript or token IDs in tracked output;
5. independent review of those tests and the proposed two-row short/medium selection lock.

Only after that separate review may the user decide whether to authorize a third non-qualifying short-v1/medium-v1 diagnostic. A non-triggering fallback would intentionally reproduce the second diagnostic's failure and close this hypothesis without a formal candidate.

## Residual risks

- Python baseline raw evidence lacks fallback-attempt telemetry; causality remains a hypothesis until a separately approved diagnostic.
- Exact compression-ratio parity depends on byte-identical UTF-8 and zlib semantics and needs oracle vectors before inference.
- Even if fallback fixes large-v3 short/medium, large-v3 long-v2 and all large-v2 rows remain unmeasured for that identity.
- The medium-only history eligibility mismatch remains a possible later cause if fallback is proven inactive or insufficient; it must not be combined into the same first candidate.
