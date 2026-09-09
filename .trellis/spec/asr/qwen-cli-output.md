# Native Qwen Full-CLI Output Boundary

## 1. Scope / Trigger

Apply to the Qwen full-CLI application worker, including changes to final display parsing or its immediate host/ASS consumers. The user-approved integration uses the pinned complete CLI, required CPU Silero VAD, upstream ForcedAligner LIS/interpolation and word-aware display output. It does not inherit the historical raw-session policy or subtitle-quality/Python-parity gates from migration research. This contract does not enable the product route or certify final runtime packages.

## 2. Signatures

`native-asr/src/qwen_cli.cpp` owns:

```cpp
std::vector<Segment> parse_result(const std::string& bytes,
                                 std::int64_t duration_ms, bool& silence);
```

CLI `displaySegments` contain `{startMs, endMs, text}` in integer milliseconds. Source `words.t0/t1` are centiseconds; their millisecond offsets must equal those values multiplied by ten. Output remains protocol v1 `segmentsReplace` followed by `completed`; no new IPC fields or controls.

## 3. Contracts

- Validate the complete original document and every original display member before merging: UTF-8/raw-NUL/JSON boundaries, types, nonblank bounded text, controls, nonnegative integer endpoints, `end >= start`, audio bounds, original count and byte limits. Retain words/fallback, same-run text conservation, silence and execution-device checks.
- Only zero-duration display rows and decreasing starts receive Qwen-specific adjacent merging. Zero rows join the preceding group; leading zero-only groups wait for an original positive-duration row. All-zero input fails even when separated points form a positive envelope.
- Merge start reversals backward until starts are nondecreasing. Each group consumes contiguous original rows, takes minimum existing start/maximum existing end, and concatenates exact original text bytes in order, including permitted whitespace, without added separators. Positive equal starts and ordinary overlaps alone do not trigger merging.
- Final groups must pass unchanged generic protocol validation and serialization, including positive duration, order and merged-text/event size limits. The generic validator never repairs rows. Underlying word timing, CLI algorithms, model identity and device selection are not changed.
- Parsing failure raises `qwen_cli_output_invalid`; failed or partial output cannot publish a replacement or overwrite existing ASS. Readiness/device/lifecycle validation is not supplied by parser-only replay.

## 4. Validation & Error Matrix

| Input | Required behavior |
|---|---|
| Valid positive ordered rows, including overlap/equal starts | Preserve every row |
| Zero row adjacent to positive row; start reversal | Merge minimum necessary contiguous group(s), then validate |
| All-zero rows at same or different points | Fail |
| Negative duration, out-of-audio, invalid/blank original text | Fail before a group envelope can hide the invalid member |
| Valid members produce oversized merged text/event | Fail; never truncate or drop text |
| Explicit successful VAD silence with empty source/display | Empty result allowed |

## 5. Good / Base / Bad Cases

- Good: `[10,12] A`, `[12,12] B` becomes `[10,12] AB`.
- Base: `[10,13] A`, `[11,14] B` stays unchanged.
- Bad: `[10,10] A`, `[12,12] B` must not become a fabricated successful `[10,12] AB`.

## 6. Tests Required

Use existing `fake_qwen_cli.cpp`, `qwen_cli_contract.py`, and `asr_worker_qwen_tests.rs`. Assert zero placement/consecutive/all-zero cases, backward cascades, unchanged overlap/equality, exact Unicode/whitespace, invalid-original rejection and post-merge limits. Host tests assert exact snapshot/recovery/ASS, atomic publication, old-ASS preservation and cleanup. Retained private-output replay must use the actual application parser object and distinguish replay from model execution; private text stays ignored-local and tracked fixtures remain synthetic. Final changed worker packages require affected CPU/CUDA functional verification, not relabeling old model evidence.

## 7. Wrong vs Correct

Wrong: relax protocol ordering, sort text, add 100 ms, or merge first and let valid neighbors conceal invalid members.

Correct: validate originals → Qwen-only contiguous grouping → exact text assembly → unchanged final protocol validation → existing atomic host/ASS flow.
