# T03C CrispASR Long-v2 Correction Design

## Summary

T03C adds a correction publisher beside, not inside, the archived T03 task. It validates the archived T03 raw/runtime/model identity against the historical manifest, then scores only completed candidate segments against the current manifest through the shared T01 comparator. Failed Qwen medium/long rows remain unscored identity-valid blockers. The archived T03 report remains immutable; a new sanitized supersession matrix becomes current authority.

No native inference, build, or product path changes.

## Evidence Flow

```text
archived T03 raw + old manifest + T03 lock/runtime/model identity
  -> original identity validation
  -> unchanged audio identity mapping (long-v1 source -> long-v2 current case)
  -> current manifest + scripts/asr-benchmark.py
  -> corrected completed-row metrics
  -> validated unscored Qwen failed rows
  -> deterministic sanitized JSON + Markdown
  -> parent CrispASR handoff + active authority cleanup
```

## Historical Validation Boundary

Use the archived T03 `evidence_contract.py` only as an invocation seam for the original compiled `--validate-evidence` command. The new publisher supplies explicit repository/archive paths and exact hashes; it must not depend on the archived Python files' old active-directory `parents[...]` assumptions.

For each authoritative row, validate:

- old manifest SHA-256 and old case ID;
- unchanged case audio hash/size/duration;
- T03 input lock;
- executable and required DLL tuple;
- primary model and optional aligner;
- explicit CPU open parameters;
- loaded local module tuple and restricted PATH;
- route/backend/case source;
- completed or failed status and lifecycle identity.

The original long raw rows legitimately identify `long-v1`; correction maps them to current `long-v2` only after proving the current case uses identical WAV bytes and duration. The ASS identity is allowed to change; audio identity is not.

## Corrected Scoring

Load `scripts/asr-benchmark.py` by file path and validate the current private manifest. For completed rows, feed the retained top-level segments to `_sample_metrics(...)` with their original timestamp provenance and engine identity.

Publish per case:

- source historical case ID and current case ID;
- old/current manifest and ASS hashes;
- raw SHA-256;
- sample counts;
- CER and S/D/I counts;
- CPU inference RTF and short cold wall;
- peak RSS;
- timeline error count;
- semantic gap count;
- excluded vocalization gap count;
- top-level segment count and sanitized length/risk aggregates;
- applicable frozen gates.

Short/medium are recomputed too, even though their reference bytes did not change, so one current-manifest matrix and one current comparator identity cover each route.

## Qwen Failed-row Boundary

Qwen medium and historical long are failed raw envelopes with `segment-legality-failed`, zero accepted timed output, and complete raw alignment/source grouping evidence. They cannot be scored because there is no legal candidate timeline.

Correction behavior:

1. Validate each row against original T03 identity.
2. Verify medium maps to unchanged medium-v1 and historical long maps to current long-v2 through identical WAV/duration.
3. Publish `upstream-blocker`, failure code, attempted status, accepted timed segment count 0, resource/performance observations, raw hash, and current benchmark identity.
4. Keep CER/timeline/gap/Qwen timing gates `blocked`/unscored.
5. Never inspect the corrected ASS to create or repair candidate output.

## Correction Lock

`research/crispasr-long-v2-correction-lock.md` freezes:

- old/current manifest hashes and exact old/current long case identities;
- shared comparator SHA-256;
- archived T03 report/evidence/input-lock/adapter/evidence-contract hashes;
- executable/DLL/model/aligner identities;
- every authoritative raw file role and SHA-256;
- original T03 gates and route dispositions;
- expected preview matrix to four decimals;
- no-inference/no-archive-rewrite/no-product-change boundary;
- publisher and test source hashes after implementation stabilizes.

Any source/tool/identity change invalidates publication.

## Publisher Structure

Add the minimum task-local files:

```text
research/crispasr-long-v2-correction-lock.md
research/publish_crispasr_long_v2_correction.py
research/test_publish_crispasr_long_v2_correction.py
research/evidence/crispasr-long-v2-correction.json
research/crispasr-long-v2-correction-report.md
research/crispasr-long-v2-handoff.md
research/local/                         # ignored, temporary validation/publication output
```

The publisher owns validation, scoring, sanitization, deterministic rendering, and atomic writes. Do not create a framework or modify archived T03 tooling.

## Determinism And Privacy

- Sort routes/cases and JSON keys explicitly.
- Exclude generated timestamps; publication must be a pure function of locked bytes.
- Recompute metrics from raw segments and current ASS in memory.
- Tracked evidence contains hashes/aggregates only; no text, reference segments, speech intervals, raw alignment arrays, token IDs, or absolute paths.
- Use canonical containment and `git check-ignore` for task-local output.
- Run `publish(...)` twice into separate ignored outputs and compare bytes before copying final tracked output.

## Mutation Coverage

Tests mutate one or more coordinated fields and require rejection:

- old/current manifest or long audio/ASS identity;
- raw file bytes/hash/route/case role;
- executable/DLL/model/aligner/open-parameter/module/PATH identity;
- completed/failed row status;
- candidate segments, precomputed metrics, or route disposition;
- Qwen failed row promoted to measured or given synthetic segments;
- gate thresholds or preview values;
- missing route/case row;
- publisher/comparator/lock source hash;
- private path/text/token/alignment content in tracked output.

## Parent And Spec Updates

Update current authority only:

- parent `prd.md`, `design.md`, and `implement.md` current status sections use corrected T03 outcomes;
- add/link `research/t03c-crispasr-long-v2-handoff.md` or equivalent parent handoff path;
- repair parent T08 handoff links from active T08 paths to `archive/2026-08/...`;
- clarify that archived T01/T02/T03/T06/T08 reports are historical for their original manifest;
- add an ASR quality spec rule: a reference identity change requires an inventory and supersession for every backend/result family that consumed the old identity, not only the currently active backend.

Historical archived task files remain byte-identical.

## Validation

- Shared benchmark self-check/tests and current manifest validation.
- Original T03 compiled identity validator for all nine authoritative raw rows.
- Correction publisher mutation/determinism/privacy tests.
- Preview/final matrix exact reproduction.
- Hash comparison proving archived T01/T03 tracked inputs unchanged.
- Search gate over active parent/spec/handoffs for old manifest/long-v1/current-authority drift.
- Task validation, `git diff --check`, ignore/status/size/privacy scans.

## Rollback

Delete task-local correction artifacts and revert parent/spec current-authority edits. The archived T03 task, raw files, current benchmark, and all product/runtime code remain untouched.

## Design Decisions

- **D1:** Publish supersession evidence; never rewrite archived reports.
- **D2:** Validate old identity before scoring current reference.
- **D3:** Re-score completed raw segments only; failed Qwen rows remain unscored.
- **D4:** Map old long to long-v2 only because audio hash and duration are identical.
- **D5:** Preserve task-specific CPU/resource/timing gates; no retroactive T08 GPU gate.
- **D6:** Keep correction tooling task-local and minimal; no inference or archived-tool refactor.
