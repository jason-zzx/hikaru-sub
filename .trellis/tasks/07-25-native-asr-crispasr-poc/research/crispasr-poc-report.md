# CrispASR v0.8.22 Three-Engine Gate 0 PoC Report

## Decision Summary

| Route | Decision | Gate 0 outcome |
|---|---|---|
| Parakeet JA Q8_0 | `stop-revise` | CPU public C ABI lifecycle/performance work, and native word getters are real, but all three authoritative cases fail CER; short/medium also have confirmed gaps and top-level output remains one oversized segment. |
| ReazonSpeech Q8_0 | `proceed-with-named-risks` | The correct pinned public session call is backend `parakeet` for the Reazon GGUF. All three cases pass frozen CER/RTF/RSS/timeline/gap gates, but each result is one oversized segment and 91–94% of native word ranges are zero-duration, so T09 still needs an upstream-supported subtitle segmentation/timing strategy before product routing. |
| Qwen3-ASR 1.7B Q4_K + ForcedAligner Q4_K | `stop-revise` | Upstream-derived character-to-source-segment grouping makes short, leading-silence and boundary outputs legal without synthetic expansion. Short CER/performance pass, but start timing fails badly; medium/long retain zero-duration grouped source segments and fail closed with zero accepted output. |

T03 therefore does **not** justify switching any production default. Reazon establishes a feasible text/runtime route for follow-up, while Parakeet and Qwen require revised algorithm/upstream evidence. This is Gate 0 only, not completion of T08-T10 or the parent migration.

## Immutable Evidence Identity

Every published row was regenerated from one final evidence set:

- T01 manifest SHA-256: `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277`
- Input lock SHA-256: `f72aa6d2c7117abff16862bef8f9e18c45c9fcb9dc98249c2cf6e0872703279f`
- Release harness: 472,576 bytes, SHA-256 `66e35b7a00f22338304a7005a9cfd633352a8a6afa93b11ff0d1c158e62040cf`
- `crispasr.dll`: SHA-256 `aa5d08f8cfe459727764bbe724b0780a75bd4167043c9cf63fd0fb43c2a559de`
- `ggml-base.dll`: SHA-256 `7c296bf21291c386766ea8f8055c9a7477756a3ed3c45026ade32e6a54f374c4`
- `ggml-cpu.dll`: SHA-256 `5872f3cf3001f172f99672d1385ff45e5d9129a55c4e07dcbc8d9373ae9b4554`
- `ggml.dll`: SHA-256 `e4c77bd4e86f66af6ed4b245bba14f5aa35fbea1220ea07cb3029bef1c4aa72d`

Raw evidence records actual audio/model/aligner size and SHA-256, case ID/source, manifest/lock/executable/DLL identities, public open params, loaded local modules and sanitized environment. One shared native evidence validator is invoked by `--validate-evidence`, the T01 adapter and the publisher for authoritative completed/failed rows, derived obligations and every negative row. It also binds authoritative audio to the selected manifest case and recomputes deterministic derived WAV identity from the authoritative short source plus the named fixture derivation. Published `rowIdentityMap` entries expose each row's complete auditable identity without paths or transcript text. Failed Qwen medium/long evidence passed this complete trace/identity/lifecycle validator and was intentionally not scored.

## CPU And Runtime Attestation

All model matrix and negative runs used a PATH containing only the harness directory and Windows System32. Sessions opened through `crispasr_session_open_with_params` with ABI v2, `use_gpu=0`, `n_gpu_layers=0`, `flash_attn=0`, and 16 CPU threads. Actual loaded task-local modules were the executable plus `crispasr.dll`, `ggml-base.dll`, `ggml-cpu.dll`, and `ggml.dll`; the report does not infer backend use from filenames alone.

The pinned session ABI exposes no cooperative cancellation function. A downstream worker must retain process-tree termination unless a later pinned public ABI adds a safe cancellation contract.

## Frozen Gates

| Metric | Budget |
|---|---:|
| CER | `<=0.35` per engine/case |
| CPU inference RTF | `<=1.0` |
| Short cold process wall | `<=120s` |
| CrispASR peak RSS | `<=12 GiB` |
| Timeline errors | `0` |
| Confirmed speech gaps `>=1500ms` | `0` |
| Qwen ForcedAligner start median / P95 | `<=150ms` / `<=500ms` |

Cold-wall is not applicable to medium/long; their recorded total wall is descriptive only.

## Parakeet JA Q8_0

Pinned model SHA-256: `5a61e6c7d956c3c72a76fafcd798cac0c9ea66d0e29b3910cd04865a1e42cc17`.

The harness now follows the pinned official session behavior by calling `crispasr_session_transcribe_lang`, which auto-selects the recommended short/long path, instead of forcing the chunked API for every duration.

| Case | CER | CPU RTF | Cold wall gate | RSS | Timeline | Gaps | Top-level output | Native words |
|---|---:|---:|---|---:|---|---:|---|---|
| `short-v1` | 0.492 fail | 0.132 pass | 5.244s pass | 0.83 GiB pass | 0 errors | 2 fail | 1 segment / 71 chars | 50; all legal; median 160ms |
| `medium-v1` | 0.612 fail | 0.125 pass | N/A | 0.91 GiB pass | 0 errors | 1 fail | 1 segment / 1,146 chars | 737; 23 zero-duration |
| `long-v1` | 0.582 fail | 0.125 pass | N/A | 1.52 GiB pass | 0 errors | 0 pass | 1 segment / 9,731 chars | 6,349; 43 zero-duration |

Short warm inference RTF median is `0.125` over three warm repeats. Public nested word getters therefore expose meaningful native TDT timing, especially on short audio, but this PoC does not invent subtitle assembly from them. The top-level result remains subtitle-scale-unusable and all CER gates fail.

**Decision:** `stop-revise`.

## ReazonSpeech Q8_0

Pinned model SHA-256: `20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2`.

The first harness incorrectly passed session backend `reazonspeech`. Pinned source does expose an alias inconsistency: open accepts that string while transcribe dispatch checks `parakeet`. However, pinned CLI/backend detection maps a ReazonSpeech GGUF to the public `parakeet` session backend. Using that correct public call removes the false route blocker.

| Case | CER | CPU RTF | Cold wall gate | RSS | Timeline | Gaps | Top-level output | Native words |
|---|---:|---:|---|---:|---|---:|---|---|
| `short-v1` | 0.133 pass | 0.155 pass | 5.775s pass | 0.83 GiB pass | 0 errors | 0 pass | 1 segment / 107 chars | 76; 69 zero-duration |
| `medium-v1` | 0.286 pass | 0.149 pass | N/A | 0.89 GiB pass | 0 errors | 0 pass | 1 segment / 2,008 chars | 1,248; 1,141 zero-duration |
| `long-v1` | 0.318 pass | 0.150 pass | N/A | 1.52 GiB pass | 0 errors | 0 pass | 1 segment / 16,665 chars | 10,749; 10,098 zero-duration |

Short warm inference RTF median is `0.151` over three warm repeats. The frozen text/performance/resource gates pass independently on all cases. The apparent zero-gap result is produced by one broad segment per file and must not be mistaken for subtitle segmentation quality. Native word getters exist, but most ranges have `startMs == endMs`, so directly using them would violate the common segment contract.

**Decision:** `proceed-with-named-risks` for T09 algorithm work only; do not switch the product route yet.

## Qwen3-ASR + Required ForcedAligner

Pinned model pair:

- ASR SHA-256 `ec197cef7ccc589fdcae1becc3f4a3de119d0a41e790b898b519b1a048dad8d4`
- ForcedAligner SHA-256 `a7bb4cbeacc6414f11a5d23dc7661a51a941a71e6d559dc7b408b52473f2ae84`

Pinned upstream tokenizes CJK per character with the exact v0.8.22 ranges, including U+3000–U+303F and U+FF00–U+FFEF while excluding compatibility ranges such as U+F900–U+FAFF. Focused tests cover punctuation, consecutive punctuation and mixed Japanese/ASCII, and the final long record proves exactly 20,915 source/alignment units. Individual character entries may quantize to zero centiseconds, so the harness retains every raw entry but applies the pinned upstream segment-mode semantics: each original ASR source segment consumes its exact token count and takes the first aligned start and last aligned end. It never expands a duration, uses Python output, or accepts session-native Qwen timing. The public session getter is recorded only as `sessionGetterWordTiming` sentinel evidence with `eligibleForAcceptedTimeline=false`; ForcedAligner entry/grouping timing is the sole accepted source.

### Positive obligations

| Obligation | Result | Raw aligner entries | Zero-duration raw entries | Accepted output |
|---|---|---:|---:|---:|
| authoritative short | measured | 112 | 30 | 1 legal ForcedAligner segment |
| leading silence | measured | 112 | 41 | 1 legal ForcedAligner segment |
| chunk boundary | measured | 221 | 108 | 2 legal ForcedAligner segments |
| authoritative medium | upstream blocker | 2,451 | 1,614 | 0; fail closed |
| authoritative long | upstream blocker | 20,915 | 15,116 | 0; fail closed |

Short measurements: CER `0.208` pass, CPU inference RTF `0.619` pass, cold wall `20.987s` pass, RSS `3.40 GiB` pass, zero timeline errors and zero confirmed gaps. Short warm inference RTF median is `0.585`. However, the accepted source grouping is still one broad segment: Qwen start median error is `7,700ms` and P95 is `17,969ms`, both fail.

Medium and long were attempted after short passed the legality/resource gate. Some complete upstream source segments still inherit equal first/last centisecond endpoints after grouping. Because no synthetic duration expansion is allowed, the complete timeline is rejected and the T01 adapter leaves those failed runs unscored. Medium inference RTF was `0.659` with 6.46 GiB peak RSS; long inference RTF was `0.634` with 6.77 GiB peak RSS, but quality/timing gates remain blocked.

### Real negative matrix

| Case | Actual stage/condition | ABI called | Accepted timed output |
|---|---|---:|---:|
| `missing` | request identity has no aligner | no | 0 |
| `corrupt` | actual corrupt file fails locked hash identity | no | 0 |
| `unloadable` | fixture identity recorded; public ABI model load returns null | yes | 0 |
| `empty-transcript` | valid locked model after successful baseline load; empty request returns null | yes | 0 |
| `malformed-segment-map` | real alignment succeeds; empty source segment map groups to no output | yes | 0 |
| `invalid-audio` | valid locked model after successful baseline load; zero-sample request returns null | yes | 0 |

Each case retains sanitized request/identity/trace/lifecycle evidence and exact condition labels. The successful baseline records `alignResultCreated=true`, `alignResultFreeCount=1`; the malformed-map case records the same created/free counts; all null-result negatives record `false`/`0`. Every published `exactOnce` value is derived as `freeCount == (created ? 1 : 0)`. No negative accepted timed output.

**Decision:** `stop-revise`.

## Lifecycle And Callback Findings

- Every successful or failed transcribe sample resets progress/segment/token callbacks through a scope guard before callback context destruction (`callbackResetCount=3`, context inactive afterwards).
- Opened sessions close exactly once; created session results and aligner results free exactly once. Borrowed strings are copied before release.
- No late callback or close crash was observed. Observed callbacks ran on the transcribe thread.
- Preview callbacks matched final getters for measured routes; no replacement refresh was observed.
- Progress callbacks remained silent, including long runs. Consumers must not depend on them for this pin.
- All raw evidence records actual loaded local modules and restricted-PATH status.

Detailed lifecycle evidence: `evidence/lifecycle-callbacks.json`.

## Runtime, Size And Licenses

- CPU C ABI library archive: 37,724,402 bytes.
- Final harness binary: 472,576 bytes.
- Four pinned GGUF files: 3,360,618,368 bytes total.
- CrispASR and nlohmann/json: MIT.
- Parakeet JA: CC-BY-4.0; NVIDIA attribution required.
- ReazonSpeech, Qwen3-ASR and Qwen3 ForcedAligner: Apache-2.0.

Exact identities and attribution are in `crispasr-input-lock.json` and `evidence/runtime-inventory.json`.

## Reproduction

```powershell
.trellis\tasks\07-25-native-asr-crispasr-poc\research\poc-src\build.cmd all
python .trellis/tasks/07-25-native-asr-crispasr-poc/research/poc-src/run_evidence.py
python .trellis/tasks/07-25-native-asr-crispasr-poc/research/poc-src/publish_evidence.py
```

SDK, models, build products, raw transcripts and private references remain below the exact ignored task-local `research/local/` root.

## Downstream Handoff

- **T08:** preserve public CPU open params, executable/DLL/model/lock identity validation, callback scope-guard reset, exact-once cleanup and worker process termination.
- **T09:** Parakeet fails quality despite useful native words. Reazon passes frozen text/performance gates but needs an upstream-supported segmentation/timing plan; do not equate its one broad segment with subtitle readiness.
- **T10:** retain upstream-derived grouping and all raw character provenance; keep ForcedAligner mandatory and fail closed. Short timing accuracy and medium/long legal grouping must be revised before product routing.
- **Parent Gate 0:** replace the false Reazon dispatch blocker with measured `proceed-with-named-risks`; Parakeet and Qwen remain `stop-revise`. No T03 route is ready to become a production default from this PoC alone.
