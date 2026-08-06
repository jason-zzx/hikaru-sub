# CrispASR Long-v2 Correction Planning Evidence

## Problem

The current private benchmark correctly uses `long-v2.ass`, but the archived T03 CrispASR PoC remains bound to the superseded `long-v1` manifest. T08 corrected retained CTranslate2 evidence only; no equivalent CrispASR supersession artifact exists. Therefore the parent migration cannot truthfully claim that every current backend conclusion uses the corrected long reference.

## Benchmark Identities

| Identity | Value |
|---|---|
| historical manifest | `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277` |
| historical case | `long-v1` / `long.ass` |
| historical ASS SHA-256 | `7954ce24af05dca37b2930136c83ee722e80fd637ef298cc7eeb47f29cf8c6f3` |
| current manifest | `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` |
| current case | `long-v2` / `long-v2.ass` |
| current ASS SHA-256 | `46b4891a4f86c70c1fe54ba4dcfbd776b361f73bb774f1d14e0f2bb53659d04b` |
| unchanged long WAV SHA-256 | `af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e` |
| unchanged duration | `4,144,235ms` |
| current Dialogue count | `681` |

The approved standalone-vocalization exclusion in `scripts/asr-benchmark.py` remains part of the current comparator. Excluded cues remain in CER and publish separately.

## T03 Historical Identity

The archived T03 report and raw evidence bind:

- CrispASR v0.8.22 commit `cf0fdbbe38ad0aa107e3250f6ee5bdc755aced45`;
- input lock SHA-256 `f72aa6d2c7117abff16862bef8f9e18c45c9fcb9dc98249c2cf6e0872703279f`;
- executable SHA-256 `66e35b7a00f22338304a7005a9cfd633352a8a6afa93b11ff0d1c158e62040cf`;
- the same final DLL/model/open-parameter/restricted-PATH identities for Parakeet, ReazonSpeech, and Qwen3;
- completed Parakeet and ReazonSpeech short/medium/long raw rows;
- completed Qwen short plus failed, identity-valid Qwen medium/long rows with `segment-legality-failed` and zero accepted timed output.

The ignored raw files, executable, models, old manifest snapshot, and current corpus are still locally available. No inference rerun is required for correction.

## Preview Re-score

A temporary read-only preview imported the current shared comparator and scored retained T03 segments against current manifest `3c05c0eb...`. It did not alter task or product files and did not establish final evidence identity.

| Route | Case | CER | Semantic gaps | Excluded vocalization gaps | Timeline errors | Preview disposition |
|---|---|---:|---:|---:|---:|---|
| Parakeet | short-v1 | `0.4917` | 2 | 0 | 0 | fail |
| Parakeet | medium-v1 | `0.6123` | 1 | 0 | 0 | fail |
| Parakeet | long-v2 | `0.5962` | 0 | 0 | 0 | fail |
| ReazonSpeech | short-v1 | `0.1333` | 0 | 0 | 0 | pass |
| ReazonSpeech | medium-v1 | `0.2857` | 0 | 0 | 0 | pass |
| ReazonSpeech | long-v2 | `0.2944` | 0 | 0 | 0 | pass |
| Qwen3 + ForcedAligner | short-v1 | `0.2083` | 0 | 0 | 0 | text/timeline row measurable; timing gate still fails |
| Qwen3 + ForcedAligner | medium-v1 | unscored | N/A | N/A | no accepted timeline | unchanged upstream blocker |
| Qwen3 + ForcedAligner | long-v2 | unscored | N/A | N/A | no accepted timeline | unchanged upstream blocker |

The preview indicates no route-level disposition change:

- Parakeet remains `stop-revise`.
- ReazonSpeech remains `proceed-with-named-risks`; its one oversized top-level segment and mostly zero-duration native word ranges remain product blockers/risks independent of the ASS correction.
- Qwen remains `stop-revise`; medium/long fail before a scoreable timeline exists.

Final publication must recompute these values after validating every original raw/runtime/model identity and must fail closed if the preview is not reproduced.

## Required Correction Boundary

1. Preserve the archived T01/T03 reports byte-for-byte as historical old-manifest evidence.
2. Validate all nine authoritative T03 raw rows against their original old-manifest identity before consuming them.
3. Recompute completed rows through the current shared comparator and current manifest.
4. Carry Qwen failed rows as validated unscored supersessions; do not invent segments, CER, or gaps.
5. Preserve T03 CPU/performance/resource/timing/segmentation gates; do not apply T08 GPU limits retroactively.
6. Publish deterministic sanitized correction JSON/Markdown plus a parent handoff.
7. Update only current authority in the parent task/spec; historical references may remain when explicitly labeled historical.
8. Repair T08 authoritative artifact links that still point to its pre-archive active path.
9. Do not rerun inference, change native/product code, enable a route, or rewrite archived task reports.

## Current Documentation Drift

- `.trellis/tasks/07-25-native-asr-migration/prd.md` and `design.md` still quote some old long-v1 T03/T06 values as if they are the latest evidence.
- `.trellis/tasks/07-25-native-asr-migration/research/t08-corrected-ct2-handoff.md` contains correct CTranslate2 dispositions but links to the now-nonexistent active T08 path instead of `archive/2026-08/...`.
- The ASR quality spec explains corrected-ground-truth behavior but does not yet require an all-backend evidence inventory whenever the authoritative reference identity changes.
