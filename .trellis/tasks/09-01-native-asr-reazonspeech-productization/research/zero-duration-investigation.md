# ReazonSpeech Q8_0 zero-duration display-row investigation

## Scope and evidence rules

Research only. No production source, task requirement, plan, spec, manifest, lock, test, or runtime artifact was changed during this investigation. No repair was applied at this stage. This report contains no transcript text, vocabulary token IDs, logits, sensitive stderr, or private absolute paths. All row and token numbers below are **zero-based ordinals**, not vocabulary IDs. Raw JSON/logs remain ignored-local because they contain transcript text.

**Subsequent owner disposition:** later context-preserving replay and upstream review proved NeMo pure-RNNT `[t,t+1)` semantics. The owner then explicitly approved intersecting that interval only with the exact actual PCM sample support of the same parent/gap decode call, removing convolution-padding extent outside supplied PCM. That approved intersection supersedes this report's earlier blanket rejection of “clipping”; next-cue, display/VAD/slice-end guessing, neighboring-row endpoints and generic stretch/clamp repairs remain prohibited. The final CPU/CUDA short/medium/long matrix passes.

The investigated identity is pinned CrispASR v0.8.32 at `e2a356146e36bc1cc0410edefb01990448766979` plus `reazon-research/reazonspeech-nemo-v2` Q8_0, acquisition revision `22799a5919ea26e3c5293fe0e68846fe7918a234`, model SHA-256 `20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2`, and the frozen CPU Silero dependency.

Existing product-worker captures were primary evidence. Their private result file had already been cleaned after strict parser failure, so exact row lineage was recovered by direct JSON-preservation replays with the same pinned CLI/model/VAD/audio/argv/device selection and by deterministic offline replay of `crispasr_make_disp_segments`. The offline replay was checked against the retained short product JSON and reproduced all 12 display rows exactly in row count, compact text, and endpoints. Medium CPU, medium CUDA, and long CPU preservation replays had already completed before the parent stop-steering message; no run remained and no further model run was started afterward.

## Executive finding

**Root cause is upstream CrispASR's pure-RNNT timestamp representation, not the product adapter.** For every nonblank ReazonSpeech RNNT label, both greedy and beam decode store the same encoder-frame ordinal as start and end. The later layers faithfully preserve that point anchor:

1. `parakeet_rnnt_decode` emits `{token, t, t, probability}` (`source-reazonspeech-p1/src/parakeet.cpp:2759`; RNNT beam has the same shape at the corresponding beam emission seams).
2. Result conversion computes both endpoints as `sliceOffsetCs + frameOrdinal * frameDurationCs` (`parakeet.cpp:3701-3702`). Equality therefore exists **before** JSON units or application parsing.
3. Japanese word grouping treats every non-punctuation token as a new word and attaches punctuation tokens to the current word (`parakeet.cpp:3546,3607-3623`). A word inherits its first token's start and last token's end.
4. Display segmentation takes the first word start and last word end of each punctuation-delimited display group (`crispasr_output.cpp:371-515`, specifically `511-512`).
5. JSON serialization only multiplies centiseconds by ten (`crispasr_output.cpp:734-735`).
6. The product parser copies those integers unchanged, proves display/source text conservation, and delegates final shape validation (`native-asr/src/parakeet_cli.cpp:35-63`). The protocol correctly rejects `endMs <= startMs` (`native-asr/src/protocol.cpp:246-251`).

Every invalid row in the recovered medium CPU (21), medium CUDA (22), and long CPU (97) evidence maps exactly to a source word range and then to a source RNNT token range whose tokens all have `t0 == t1` and only one unique frame anchor. The product parser/unit mapping did not create or alter any endpoint.

## Exact data lineage

### Source chain

```text
pure RNNT nonblank emission at encoder frame t
  -> emitted token range [t, t]
  -> token t0/t1 = VAD/slice offset + t * frame_dur_cs
  -> Japanese word t0 = first token t0; t1 = last token t1
  -> punctuation display group t0 = first word t0; t1 = last word t1
  -> JSON startMs/endMs = centiseconds * 10
  -> product Segment copied unchanged
  -> protocol rejects startMs == endMs
```

The model converter writes an 80 ms encoder-frame duration from the configured window stride and 8x subsampling (`models/convert-parakeet-to-gguf.py:473-474`). This coarse frame grid is real, but **rounding is not the cause of equality**: `t_start` and `t_end` are already the identical integer `t` before multiplication. Q8_0 can change logits/token choices, but it does not quantize timestamp values.

### What each later stage does and does not do

| Suspect | Finding |
|---|---|
| Model/RNNT token timestamps | **Origin.** Pure RNNT hard-codes point intervals `[t,t]` for every emitted label. Multiple labels may also be emitted on the same frame before blank advances the encoder. |
| Timestamp quantization/rounding | Not the origin. Equality precedes conversion to centiseconds/milliseconds. The 80 ms frame grid affects resolution but does not collapse a positive interval here. |
| VAD slice offsets | Not the origin. The same offset is added to both endpoints, preserving equality. Slice choice determines which token becomes a segment/display tail and therefore when the latent defect becomes visible. |
| Gap retranscription | Not the origin. Gap coverage temporarily uses `max(word.t1, word.t0 + 1)` only for coverage detection (`crispasr_gap_fill.h:213`), but recovered words retain original endpoints and recovered segment bounds are copied from first/last words (`:263,285-286`). JSON has no first-pass/recovery provenance tag, so individual source-segment origin cannot be proven after the fact. |
| Japanese word grouping | Propagation/exposure seam. It creates one word per non-punctuation token in no-space mode; punctuation may attach. It does not invent the zero anchor. |
| Display grouping boundaries | Propagation/exposure seam. Punctuation grouping can leave a final or isolated one-anchor word as its own display row. Endpoint selection itself is correct for the selected words. |
| JSON serialization | Not the origin. Exact integer `*10`, no rounding or interpolation. |
| Product adapter/unit mapping | Not the origin. Exact endpoint and text mapping was reproduced for every invalid row. Source words legally allow equal endpoints, while final display protocol intentionally requires positive duration. |

### Short success is incidental

Short CPU has 85 source words, of which 78 already have zero duration. Nevertheless, its 12 display rows each group 3-19 words spanning more than one real frame anchor; all 12 therefore have positive duration (minimum 160 ms). Short success does **not** show that the timestamp defect is absent; it only avoids a punctuation/display boundary that isolates a one-anchor tail.

### Medium and long structure

| Case | Source segments | Source words | zero-duration source words | Display rows | zero-duration display rows | Protocol order | In bounds | Compact text conserved |
|---|---:|---:|---:|---:|---:|---|---|---|
| short CPU | 10 | 85 | 78 | 12 | 0 | yes | yes | yes |
| medium CPU | 150 | 1,448 | 1,280 | 221 | 21 | yes | yes | yes |
| medium CUDA | 149 | 1,449 | 1,283 | 221 | 22 | yes | yes | yes |
| long CPU | 853 | 12,489 | 11,614 | 1,256 | 97 | yes | yes | yes |

“Protocol order” means nondecreasing `startMs`, which is the actual `segmentsReplace` contract. Adjacent rows can overlap; non-overlap is not required. All outputs remain in audio bounds and display compact text equals same-run source compact text. They are still invalid because one or more final rows lack positive duration.

Medium details:

- CPU: 21 invalid rows; every row is one word / one RNNT token / one frame anchor. Fifteen are also complete zero-duration source segments; six are final one-word punctuation groups at the tail of otherwise positive source segments.
- CUDA: 22 invalid rows with the same shape. Fifteen are complete zero-duration source segments; seven are final tail groups.
- All 21 CPU bad fingerprints occur on CUDA at the same absolute anchor with the same text hash. CUDA has one additional bad fingerprint at 314,750 ms. Thus bad-row anchor/hash agreement is 21/21 CPU rows and 21/22 CUDA rows. Full CPU/CUDA transcript and source-segmentation hashes are not identical, so row ordinals after the CUDA-only row shift by one.

Long CPU details:

- 97 invalid rows; 95 contain one word and two contain two words.
- Exact token lineage is 94 one-token rows and three two-token rows; every token range has one unique frame anchor and every token has equal endpoints.
- 85 invalid rows are complete zero-duration source segments. Eleven more are tail groups of positive source segments, and one is an internal punctuation-bounded singleton. This proves the defect is not solely a gap-fill/one-segment artifact.

## Exact medium CPU/CUDA invalid-row fingerprints

`seg:word/token` uses zero-based source segment, source word, and source token ordinals. A dash means the fingerprint did not occur on that device. Text is represented only by SHA-256 prefix and codepoint count.

| CPU row | CUDA row | anchor ms | CPU source seg:word/token | CUDA source seg:word/token | chars | text SHA-256/16 |
|---:|---:|---:|---|---|---:|---|
| 13 | 13 | 37780 | 8:24/26 | 8:24/26 | 4 | `35c96e698019be4d` |
| 15 | 15 | 39190 | 10:0/0 | 10:0/0 | 2 | `d1a5f020535e98da` |
| 23 | 23 | 63200 | 14:26/28 | 14:26/28 | 2 | `35a08bff92ef5b1f` |
| 29 | 29 | 74310 | 19:4/4 | 19:4/4 | 2 | `759383153c120977` |
| 38 | 38 | 103030 | 26:0/0 | 26:0/0 | 3 | `b81c0b4923efee6b` |
| 55 | 55 | 140210 | 33:0/0 | 33:0/0 | 1 | `762c1a1a571413e6` |
| 59 | 59 | 146330 | 34:19/22 | 34:19/22 | 2 | `325983163ae7cae7` |
| 65 | 65 | 157770 | 40:0/0 | 40:0/0 | 1 | `a668052ae6ec6ecb` |
| 77 | 77 | 182740 | 46:0/0 | 46:0/0 | 2 | `8059f43b69df9852` |
| 78 | 78 | 183430 | 47:0/0 | 47:0/0 | 2 | `8059f43b69df9852` |
| 79 | 79 | 183460 | 48:0/0 | 48:0/0 | 2 | `8059f43b69df9852` |
| 89 | 89 | 218320 | 58:0/0 | 58:0/0 | 1 | `dc5a4d3d82f7e157` |
| 95 | 95 | 225870 | 61:13/15 | 61:13/15 | 2 | `fb27a6ad502af018` |
| 105 | 105 | 251810 | 70:0/0 | 70:0/0 | 1 | `dc5a4d3d82f7e157` |
| 114 | 114 | 268280 | 77:0/0 | 77:0/0 | 2 | `267239f4fcaa6caf` |
| — | 135 | 314750 | — | 87:5/6 | 1 | `598e6dcaa5412a9a` |
| 160 | 159 | 365090 | 100:1/1 | 99:1/1 | 3 | `c550c27beb9ce56f` |
| 162 | 161 | 366700 | 102:0/0 | 101:0/0 | 1 | `1d37bdf9abb0f388` |
| 173 | 172 | 391410 | 110:0/0 | 109:0/0 | 2 | `c313903ea0395adf` |
| 182 | 181 | 408510 | 116:0/0 | 115:0/0 | 1 | `dc5a4d3d82f7e157` |
| 203 | 203 | 457620 | 136:0/1 | 135:0/1 | 10 | `21b2ba1811e66eef` |
| 204 | 204 | 457670 | 137:0/0 | 136:0/0 | 10 | `21b2ba1811e66eef` |

## Exact long CPU invalid-row fingerprints

All listed rows have `startMs == endMs`; `anchor ms` is that shared value. Word/token ranges are zero-based ordinals within the named source segment. Text is represented only by SHA-256 prefix and codepoint count.

| long CPU row | anchor ms | source seg:word range | token range | words/tokens | chars | text SHA-256/16 |
|---:|---:|---|---|---:|---:|---|
| 5 | 55310 | 1:30 | 32 | 1/1 | 6 | `a2b427a523da5708` |
| 6 | 55600 | 2:0 | 0 | 1/1 | 2 | `2ab01f1ec07e784d` |
| 38 | 145290 | 24:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 45 | 155450 | 27:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 67 | 221900 | 43:0 | 0 | 1/1 | 4 | `1ed7463894c4e6be` |
| 72 | 229290 | 48:0 | 0 | 1/1 | 2 | `f17bfc45f716299f` |
| 76 | 239050 | 51:18 | 18 | 1/1 | 2 | `3673ecbb67987ccd` |
| 78 | 240890 | 53:0–1 | 0–1 | 2/2 | 2 | `4f6f56e3170b5597` |
| 89 | 264970 | 59:13 | 15 | 1/1 | 6 | `a2b427a523da5708` |
| 91 | 266510 | 61:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 115 | 434370 | 79:0 | 0 | 1/1 | 1 | `9df8cbce8468e790` |
| 139 | 490330 | 96:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 140 | 490410 | 97:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 173 | 577750 | 113:5 | 5 | 1/1 | 1 | `7a0a3e30c7c42e14` |
| 175 | 583560 | 115:0 | 0 | 1/1 | 2 | `fad04fc93bda68d1` |
| 184 | 604360 | 123:0 | 0 | 1/1 | 2 | `2422ee8abcc83ed0` |
| 224 | 699380 | 144:0 | 0 | 1/1 | 2 | `de9b2724fa675d58` |
| 244 | 735610 | 156:0 | 0 | 1/1 | 3 | `484955487e6a0797` |
| 273 | 822750 | 176:8 | 9 | 1/1 | 4 | `55094920afddde49` |
| 289 | 871850 | 189:0 | 0 | 1/1 | 1 | `3265cdd08afe9532` |
| 290 | 872530 | 190:0 | 1 | 1/1 | 4 | `35c96e698019be4d` |
| 294 | 885350 | 194:0 | 0 | 1/1 | 2 | `80969d56b19202da` |
| 296 | 887750 | 196:0 | 0 | 1/1 | 3 | `d37a7538fa21f005` |
| 329 | 984460 | 219:0 | 0 | 1/1 | 2 | `0ac4412c242353f5` |
| 391 | 1276830 | 262:0 | 0 | 1/1 | 1 | `9e228bcc5ed49ae3` |
| 426 | 1357400 | 286:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 439 | 1384390 | 292:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 442 | 1393840 | 295:0 | 0 | 1/1 | 1 | `614459aa75868bbf` |
| 445 | 1402510 | 298:0 | 0 | 1/1 | 3 | `1e0fb7bad2b35deb` |
| 453 | 1427330 | 302:0 | 0 | 1/1 | 2 | `e24f9eadaac2feb9` |
| 475 | 1482420 | 311:0 | 0 | 1/1 | 1 | `9e228bcc5ed49ae3` |
| 485 | 1506440 | 318:0 | 0 | 1/1 | 1 | `7a2b9fadc056a4e1` |
| 512 | 1582150 | 337:0 | 0 | 1/1 | 1 | `427566260604d16f` |
| 513 | 1583160 | 338:0 | 0 | 1/1 | 2 | `de9b2724fa675d58` |
| 514 | 1583640 | 339:0 | 0 | 1/1 | 1 | `a071406edf016fa0` |
| 524 | 1611990 | 345:34–35 | 36–37 | 2/2 | 2 | `06ffc763fd81c160` |
| 548 | 1686660 | 363:0 | 0 | 1/1 | 1 | `a2e54fdcf32b8cea` |
| 551 | 1694280 | 366:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 573 | 1751910 | 380:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 574 | 1751990 | 381:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 579 | 1770320 | 384:0 | 0 | 1/1 | 1 | `dc5a4d3d82f7e157` |
| 613 | 1887070 | 406:21 | 23 | 1/1 | 3 | `ff4eb8f1c242dc78` |
| 614 | 1887120 | 407:0 | 0 | 1/1 | 3 | `ff4eb8f1c242dc78` |
| 615 | 1887170 | 408:0 | 0 | 1/1 | 3 | `ff4eb8f1c242dc78` |
| 621 | 1900510 | 413:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 670 | 2127720 | 443:0 | 0 | 1/1 | 3 | `322678a4c9730c1d` |
| 673 | 2138840 | 444:44 | 47 | 1/1 | 3 | `322678a4c9730c1d` |
| 683 | 2172430 | 451:0 | 0 | 1/1 | 1 | `dbc879e139da5b0a` |
| 687 | 2182700 | 453:0 | 0 | 1/1 | 3 | `b81c0b4923efee6b` |
| 688 | 2183950 | 454:0 | 0 | 1/1 | 3 | `b81c0b4923efee6b` |
| 692 | 2193540 | 458:0 | 0 | 1/1 | 2 | `da156178633c4561` |
| 704 | 2222570 | 468:0 | 0 | 1/1 | 3 | `322678a4c9730c1d` |
| 705 | 2222620 | 469:0 | 0 | 1/1 | 3 | `322678a4c9730c1d` |
| 718 | 2253470 | 480:0 | 0 | 1/1 | 1 | `a2e54fdcf32b8cea` |
| 745 | 2350610 | 504:0 | 1 | 1/1 | 1 | `dbc879e139da5b0a` |
| 746 | 2350660 | 505:0 | 0 | 1/1 | 1 | `dbc879e139da5b0a` |
| 785 | 2481250 | 528:0 | 0 | 1/1 | 2 | `de9b2724fa675d58` |
| 810 | 2548560 | 542:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 822 | 2578930 | 552:0 | 0 | 1/1 | 2 | `538fa5973853cacc` |
| 856 | 2667280 | 576:0 | 0 | 1/1 | 1 | `9e228bcc5ed49ae3` |
| 871 | 2689220 | 583:0 | 0 | 1/1 | 1 | `9a56a4f7b1211a27` |
| 879 | 2722220 | 588:4 | 4 | 1/1 | 1 | `9e228bcc5ed49ae3` |
| 887 | 2742380 | 592:0 | 0 | 1/1 | 1 | `3eb9f20eae387817` |
| 895 | 2762640 | 598:0 | 0 | 1/1 | 3 | `7ff97b2f65b6ae3f` |
| 896 | 2762670 | 599:0 | 0 | 1/1 | 3 | `7ff97b2f65b6ae3f` |
| 897 | 2763920 | 600:0 | 0 | 1/1 | 1 | `9e228bcc5ed49ae3` |
| 927 | 2840590 | 623:0 | 0 | 1/1 | 3 | `1acb6b28536fc770` |
| 932 | 2860080 | 627:0 | 0 | 1/1 | 2 | `538fa5973853cacc` |
| 936 | 2867040 | 628:20 | 24 | 1/1 | 3 | `7ff97b2f65b6ae3f` |
| 938 | 2868560 | 630:0 | 0 | 1/1 | 2 | `2cf9e21f8ca6f3b8` |
| 968 | 2937910 | 652:0 | 0 | 1/1 | 1 | `f044d12b2a9f611b` |
| 974 | 2949540 | 656:0 | 0 | 1/1 | 2 | `de9b2724fa675d58` |
| 979 | 2965880 | 659:0 | 0 | 1/1 | 1 | `4c6ff24613969749` |
| 998 | 3001130 | 674:0 | 0 | 1/1 | 1 | `dbc879e139da5b0a` |
| 1021 | 3067840 | 686:0 | 0 | 1/1 | 1 | `598e6dcaa5412a9a` |
| 1025 | 3075070 | 687:20 | 22 | 1/1 | 1 | `598e6dcaa5412a9a` |
| 1038 | 3106230 | 694:0 | 0 | 1/1 | 3 | `d37a7538fa21f005` |
| 1041 | 3109640 | 696:8 | 8–9 | 1/2 | 3 | `ca700cc7c3c59ad3` |
| 1059 | 3161700 | 707:0 | 0 | 1/1 | 2 | `870b8730ba39c8f1` |
| 1095 | 3355690 | 725:0 | 0 | 1/1 | 1 | `b0a1eab5f902df03` |
| 1103 | 3415490 | 733:0 | 0 | 1/1 | 1 | `3b0a650001298c05` |
| 1107 | 3429500 | 737:0 | 0 | 1/1 | 2 | `c26edd7ebde90557` |
| 1111 | 3446420 | 741:0 | 0 | 1/1 | 1 | `0e2c91a393eaf7ec` |
| 1112 | 3446580 | 742:0 | 0 | 1/1 | 1 | `9df8cbce8468e790` |
| 1115 | 3449350 | 745:0 | 0 | 1/1 | 1 | `8b53bf6f987a8b5b` |
| 1120 | 3470200 | 750:0 | 0 | 1/1 | 2 | `c8e79cdc2985a3dd` |
| 1125 | 3497810 | 755:0 | 0 | 1/1 | 1 | `9df8cbce8468e790` |
| 1133 | 3539640 | 761:0 | 0 | 1/1 | 1 | `2e7d2c03a9507ae2` |
| 1147 | 3627880 | 775:0 | 0 | 1/1 | 3 | `f3843d714a609ea4` |
| 1148 | 3627910 | 776:0 | 0 | 1/1 | 3 | `f3843d714a609ea4` |
| 1161 | 3678320 | 785:0 | 0 | 1/1 | 1 | `598e6dcaa5412a9a` |
| 1172 | 3721950 | 791:0 | 0 | 1/1 | 2 | `0ac4412c242353f5` |
| 1187 | 3781110 | 801:0 | 0 | 1/1 | 2 | `01c6323aa94618b0` |
| 1210 | 3925530 | 817:0 | 0 | 1/1 | 2 | `cd94bd4679ae479f` |
| 1213 | 3929740 | 820:0 | 0 | 1/1 | 2 | `c26edd7ebde90557` |
| 1228 | 3980650 | 832:0 | 0 | 1/1 | 2 | `da156178633c4561` |
| 1252 | 4058650 | 850:0 | 0 | 1/1 | 2 | `0ac4412c242353f5` |

## Repair-class evaluation (no implementation)

### Ranked 1 — prove and correct RNNT interval semantics at the upstream decoder seam

- **Exact seam:** `parakeet_rnnt_decode` and pure-RNNT beam emission in `src/parakeet.cpp`, before `parakeet_emitted_token` becomes `parakeet_token_data`.
- **Candidate principle:** retain the real label-emission frame and derive an end only from an observed decoder/encoder advance that upstream RNNT semantics define as the label's interval boundary. Do not start with `t+1`, slice end, next cue, or a display-layer patch.
- **Provenance:** legitimate source timestamp bug fix **only if** pinned NeMo/ReazonSpeech or an authoritative RNNT timestamp contract confirms that the observed blank/frame advance is the label endpoint. The current cstr model provenance does not identify a converter commit, and pinned CrispASR documentation does not define RNNT interval semantics; that evidence is still missing.
- **Prohibition:** does not violate the ban if it restores a real model/decoder endpoint. It does violate the ban if it merely assigns one frame, next cue start, slice end, or another convenient duration without authoritative semantics.
- **Blast radius:** can be gated to `n_tdt_durations == 0`, avoiding TDT Parakeet and Qwen algorithm paths, but it still rebuilds the shared CrispASR binaries and can affect all pure-RNNT models. Qwen code is not touched; Parakeet TDT code is adjacent/shared-build only.
- **Evidence required:** a decoder-event trace binding each offending token ordinal to emission frame, subsequent blank/max-step advance, slice frame count, and serialized endpoint; an authoritative upstream timestamp rule; model-free tests for greedy and beam; and proof that no source text/token selection changes.
- **Required matrix after a candidate exists:** ReazonSpeech CPU and CUDA × short/medium/long (six runs), all functional/structural gates. Because the shared runtime is rebuilt, repeat Parakeet CPU/CUDA structural regression at short/medium/long and Qwen CPU/CUDA shared-runtime regression required by the task. No CER, semantic-gap, Python-parity, quality, or performance gate.

### Ranked 2 — upstream-backed Japanese grouping correction using endpoints already inside the selected provenance range

- **Exact seam:** `parakeet_group_words` (`parakeet.cpp:3524-3650`) or, less desirably, generic `crispasr_make_disp_segments` (`crispasr_output.cpp:371-515`).
- **Legitimate form:** correct a demonstrably wrong tokenizer-native word or sentence boundary while continuing to use the selected tokens' existing endpoints.
- **Observed limitation:** every bad row has exactly one unique token-frame anchor. Therefore there is no second real endpoint **inside that row's own provenance range** for the display code to choose. A pure endpoint-selection correction cannot repair these rows.
- **Prohibition:** a tokenizer-metadata-backed boundary correction could be legitimate. A heuristic that absorbs the row into a neighbor is automatic adjacent merge and is prohibited. Assigning a neighboring row's endpoint while keeping separate text is stretching/clipping and is prohibited.
- **Blast radius:** changing `parakeet_group_words` affects ReazonSpeech and Parakeet-family word output; changing `crispasr_make_disp_segments` affects Qwen, Parakeet, ReazonSpeech, and other CLI backends.
- **Evidence required:** tokenizer metadata or upstream segmentation logic proving current Japanese boundaries wrong; exact text/token conservation; all produced rows positive without heuristic neighbor absorption.
- **Required matrix:** if word grouping changes, ReazonSpeech and Parakeet CPU/CUDA × short/medium/long plus Qwen CPU/CUDA regression. If generic display grouping changes, Qwen, Parakeet, and ReazonSpeech all require CPU/CUDA × short/medium/long structural matrices.

### Ranked 3 — dropping or merging rows (rejected)

- **Seam:** generic display creation, Reazon-specific product parser, or protocol adapter.
- **Effect:** dropping loses text; merging preserves text but changes accepted cue boundaries and provenance.
- **Status:** explicitly prohibited by the task's text-conservation and no-automatic-adjacent-merge requirements. It is not a root-cause correction.
- **Blast radius:** Reazon-only if hidden in `parakeet_cli.cpp`; broad if placed in protocol/display code. Either location would mask upstream evidence.

### Ranked 4 — fabricating duration (rejected)

- **Examples:** arbitrary `end = start + 1ms`, next cue start, logical VAD/slice end, midpoint/average distribution, neighboring-row clipping/stretching, or reference-derived repair.
- **Status:** these remain prohibited synthetic timing. The later source-backed NeMo `[t,t+1)` encoder cell plus exact same-invocation PCM-support intersection is a separately approved root-cause correction, not this rejected class.
- **Blast radius:** potentially Reazon-only, but would silently turn structurally invalid upstream output into accepted ASS and defeat fail-safe behavior.

### Protocol relaxation (rejected)

Allowing `startMs == endMs` in `protocol.cpp` would weaken every Native ASR route, still produce invalid subtitle intervals, and conceal the producer defect. It is neither a timestamp fix nor an acceptable productization path.

## Smallest defensible next experiment

Do **not** run medium or long again. Build an ignored-local, non-production diagnostic variant that changes no output and replay only the already-identified 6.4-second medium CPU source span at 31,380-37,780 ms (shared CPU/CUDA bad fingerprint: display row 13, source segment 8, word ordinal 24, token ordinal 26).

The diagnostic must record sanitized ordinals only:

1. token emission frame `t`;
2. every subsequent blank or `max_per_step` encoder-frame advance until the token can be assigned an actual observed boundary;
3. total encoder frames and slice boundary;
4. current serialized `[t,t]` endpoint and a hash binding the trace to frozen source/model/audio/slice identity.

First compare that trace against authoritative NeMo/ReazonSpeech RNNT timestamp semantics. Do not alter the JSON or product parser. This experiment later succeeded: it bound the offending token to NeMo's real `[t,t+1)` interval, after which the owner approved the exact same-invocation PCM-support intersection described above. Next-cue and logical slice-end assignment remain synthetic and disallowed. CUDA was then rerun only after the source-backed candidate existed.

## Confidence and unknowns

- **High confidence:** zero duration originates at pure-RNNT emitted-token endpoints; conversion, JSON units, and product parsing are faithful.
- **High confidence:** short success is grouping luck; 78/85 short source words already carry zero duration.
- **High confidence:** CPU/CUDA manifestation is materially the same; all CPU medium bad anchor/text fingerprints recur on CUDA.
- **High confidence:** no observed invalid row contains two distinct real token anchors, so display endpoint selection alone cannot repair it.
- **Medium confidence:** VAD/gap orchestration determines which point-anchored tokens become isolated segment/display tails, but is not the source of equality.
- **Resolved later:** authoritative NeMo/ReazonSpeech pure-RNNT semantics are `[t,t+1)`; convolution-padding extent is removed only by exact actual PCM support passed to the same parent/gap decode.
- **Still not inferred from JSON:** exact first-pass versus gap-retranscription origin of each historical source segment; production correctness does not depend on guessing it because each invocation supplies its own exact PCM support.
- **Evidence limitation:** exact medium/long row tables come from same-identity preservation replays plus validated offline display replay because the original worker-owned result was cleaned after parser failure. Existing worker captures independently preserve the CPU/CUDA medium and CPU long structured failures.

## Evidence references

### outputReference

- `.trellis/tasks/09-01-native-asr-reazonspeech-productization/research/zero-duration-investigation.md`

### artifactPaths

Ignored-local raw/private artifacts (contain transcript text; do not track):

- `native-asr/build/full-cli/acquisition/reazon-cpu-medium-stdout.jsonl` — SHA-256 `8ee01fad428f343dc0e631aeb5e8c3005290066ec48fa10532011641c3a580a5`
- `native-asr/build/full-cli/acquisition/reazon-cuda-medium-stdout.jsonl` — SHA-256 `011ce92ec3a82304b16b851c5627bc74479834a2df91ce962586a80efcc7c603`
- `native-asr/build/full-cli/acquisition/reazon-cpu-long-stdout.jsonl` — SHA-256 `5f1c662944ae95ef8b2b0fb3766c54a71d0c9462d65e0f0660549bcf3b2e2501`
- `native-asr/build/full-cli/acquisition/zero-duration-investigation/cpu-medium/result.json` — SHA-256 `81b403a6be3dce1b303994726739bc6b52794c7e6e444693247e9c8da2e2d0ff`
- `native-asr/build/full-cli/acquisition/zero-duration-investigation/cuda-medium/result.json` — SHA-256 `91b6bf83a80f4123c3e43c0bc35fc9c1e9748d2993fd4076f4cf3c57b601c30a`
- `native-asr/build/full-cli/acquisition/zero-duration-investigation/cpu-long/result.json` — SHA-256 `b19f310954f67441052fe38af8992728a6d224b7b8ac806892a57eda9cf4d957`

Ignored-local sanitized derivation:

- `native-asr/build/full-cli/acquisition/zero-duration-investigation/analysis-sanitized.json` — SHA-256 `175bfd0959892170e3aeee611d4ec120c637d709ce57bfc31e337c0f668846ed`

Pinned/source references:

- `native-asr/build/full-cli/acquisition/reazonspeech-acquisition-lock.json`
- `native-asr/build/full-cli/source-reazonspeech-p1/src/parakeet.cpp`
- `native-asr/build/full-cli/source-reazonspeech-p1/examples/cli/crispasr_output.cpp`
- `native-asr/build/full-cli/source-reazonspeech-p1/examples/cli/crispasr_gap_fill.h`
- `native-asr/src/full_cli.cpp`
- `native-asr/src/parakeet_cli.cpp`
- `native-asr/src/protocol.cpp`
