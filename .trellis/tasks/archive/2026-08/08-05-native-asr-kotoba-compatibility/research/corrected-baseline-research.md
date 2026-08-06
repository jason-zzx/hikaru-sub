# Corrected Long Baseline And CTranslate2 Re-evaluation Research

## User Correction

- `.asr-benchmark/long-v2.ass` is the correct subtitle reference for the existing `long.wav`.
- Missing standalone non-semantic vocalizations such as the medium reference cues `うんうん` and `うあ、うあ、うあ` should not fail subtitle quality.
- Historical CTranslate2 candidates must be re-evaluated, not only the current T08 Kotoba K1 candidate.

## Corrected Reference Identity

| Input | Identity |
|---|---|
| Audio | existing `long.wav`, SHA-256 `af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e` |
| Correct reference | `long-v2.ass`, SHA-256 `46b4891a4f86c70c1fe54ba4dcfbd776b361f73bb774f1d14e0f2bb53659d04b` |
| Dialogue count | `681` |
| Last reference end | `4,067,080 ms` |
| Audio duration | `4,144,235 ms` |

The old `long.ass` identity must remain historical evidence only. It must not remain the current authoritative long reference and archived reports must not be rewritten as though they originally used `long-v2.ass`.

## Raw Evidence Availability

Ignored local completed raw segments remain available for:

- T02 ordinary large-v3 fixed-window short/medium/long;
- T02 Kotoba fixed-window short/medium/long;
- T06 selected ordinary Candidate A short/medium/long;
- T06 Candidate B VAD short/medium;
- T08 Kotoba K1 short/medium/long.

These candidates can be rescored against the corrected reference without rerunning inference. T06 Candidate B has no long raw result because its old medium gate stopped execution.

## Preview Re-score

This preview recomputed CER, timeline, and confirmed-gap coverage from the retained raw segments. It classified only standalone repeated non-semantic vocalization cues as diagnostic exclusions; all lexical or mixed cues remained quality-gating.

| Candidate | Case | CER | RTF | Semantic gaps | Excluded vocalization gaps | Timeline errors |
|---|---|---:|---:|---:|---:|---:|
| T02 ordinary fixed-window | short-v1 | `0.3583` | `0.777` | 0 | 0 | 0 |
| T02 ordinary fixed-window | medium-v1 | `0.1745` | `0.717` | 10 | 0 | 0 |
| T02 ordinary fixed-window | long-v2 | `0.2245` | `0.706` | 68 | 0 | 0 |
| T02 Kotoba fixed-window | short-v1 | `0.3417` | `0.556` | 0 | 0 | 0 |
| T02 Kotoba fixed-window | medium-v1 | `0.2224` | `0.515` | 3 | 2 | 0 |
| T02 Kotoba fixed-window | long-v2 | `0.2512` | `0.459` | 16 | 0 | 0 |
| T06 selected Candidate A | short-v1 | `0.2667` | `0.623` | 0 | 0 | 0 |
| T06 selected Candidate A | medium-v1 | `0.1134` | `0.559` | 0 | 0 | 0 |
| T06 selected Candidate A | long-v2 | `0.1509` | `0.550` | 0 | 0 | 0 |
| T06 Candidate B VAD | short-v1 | `0.2667` | `0.654` | 0 | 0 | 0 |
| T06 Candidate B VAD | medium-v1 | `0.1055` | `0.599` | 0 | 1 | 0 |
| T08 Kotoba K1 | short-v1 | `0.3250` | `0.035` | 0 | 0 | 0 |
| T08 Kotoba K1 | medium-v1 | `0.2163` | `0.032` | 0 | 2 | 0 |
| T08 Kotoba K1 | long-v2 | `0.2268` | `0.030` | 7 | 0 | 0 |

The preview was planning evidence only. Final deterministic publication reproduced every listed CER/disposition and gap count exactly at four decimals: `research/evidence/corrected-ct2-reassessment.json` SHA-256 `a470ce38aeb2173b54b31f359771bc6d24836a5688ee605c0091db7681bdf99d`, generated under correction lock SHA-256 `4a91bc04eb25c2c4fafc65667a05d233b8ef0f698ed6e7f7943d8197ffe0c6d1` and current manifest SHA-256 `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea`.

## Consequences

### T02

Both historical fixed-window algorithms remain rejected. The corrected long reference reduces previously reported gaps but does not change the disposition:

- ordinary large-v3 still fails short CER and medium/long semantic gaps;
- Kotoba still fails medium/long semantic gaps.

### T06 Selected Candidate A

The selected timestamp-driven/no-history/beam-1 ordinary large-v3 candidate now passes short, medium, and corrected long gates. Its old seven-gap long failure was caused by the incorrect reference ASS. This removes the evidence basis for mandatory Candidate B and unlocks the previously blocked ordinary model matrix in a later qualification step.

### T06 Candidate B

Its old medium failure is only one excluded vocalization gap. It would pass the revised medium gate, but running Candidate B long is unnecessary if selected Candidate A is retained: VAD/ORT was introduced only to address the now-invalid selected Candidate A long-gap blocker. Avoiding Candidate B also keeps ORT/VAD out of the CPU package input.

### T08 Kotoba K1

Medium passes after its two non-semantic vocalizations become diagnostic-only. Corrected long improves from 23 reported gaps to 7 semantic gaps, but K1 remains `stop-revise`; no production route is enabled.

### T07

The CUDA speed decision does not use ASS/CER/gap data and remains unchanged.

## Publication And History Boundary

- Update the current private benchmark manifest to a new `long-v2` case identity rather than silently changing the reference behind `long-v1`.
- Preserve archived T01/T02/T06 reports as historical results against the old manifest.
- Add correction/supersession reports that cite original raw hashes and task identities; do not edit archived evidence to imply it originally used the corrected reference.
- Re-score completed raw evidence first. Rerun inference only for newly unblocked qualification cases, not to reproduce unchanged segments.

## Approved Vocalization Policy

The user approved the conservative deterministic boundary:

- NFKC-normalize, then remove whitespace, Unicode punctuation/symbols, and `ー` / `〜` / `~`;
- exclude only when the complete remaining cue equals 1..6 repeats of exactly one unit from `あ`, `う`, `え`, `お`, `ん`, `うん`, or `うあ`;
- apply the exclusion only when every reference cue overlapping the uncovered region is approved standalone vocalization;
- keep excluded vocalizations in CER and publish them as separate diagnostic gaps;
- keep `はい`, laughter text/markers, mixed lexical cues, and unknown forms quality-gating.
