# Native ASR safeguard simplification — approved design

Implemented in owner-approved batches. Final local verification and its limits are recorded in `implement.md`; this design does not authorize task archival, Git operations or distribution updates.

## 1. Boundary and shape

One cohesive cleanup task, executed in small sequential batches. Build scripts, workers, host tests and current specifications consume the same identity mechanisms; separate independently archived child deliverables would leave contradictory intermediate contracts. Each batch must verify before proceeding, and the final review covers both backends. This is not authority to implement all batches in one diff.

No new abstraction or validation framework. Delete redundant producers and their consumers; keep ordinary assertions where the condition still matters. `research.md` contains source anchors, not a new generated evidence ledger.

## 2. Integrity stays at real boundaries

Keep upstream version/revision selection and external archive/model/runtime checks. Keep the host's embedded product lock and full distributed file-set verification. It already runs before host-cache lookup (`asr.rs:285-345`).

Remove the additional CMake→generated header→worker CLI size/SHA binding (`HIKARU_QWEN_CLI_SHA256`, `HIKARU_QWEN_CLI_SIZE`, `qwen_cli_identity.hpp`, `verify_cli`). Retain explicit neighboring CLI path, existence/open errors, device flags and controlled DLL search. Preserve CMake's CLI copy input. The standalone developer worker becomes a normal local executable, not an authenticity verifier; product execution remains protected by Tauri's runtime verifier.

`crispasr-product-lock*.json`, CT2 released runtime locks, model manifest hashes and `SHA256SUMS` remain distribution mechanisms. Do not erase hashes in already distributed manifests just because they include historical metadata. Build-time acquisition of external binary inputs still verifies their integrity; removing redundant source-file checks is not permission to accept arbitrary DLL bytes as a released runtime.

## 3. Lifetime anti-replacement pins

Remove `PinnedPaths` and its per-ancestor, full-inference handle retention. Keep simple path validity/existence/type checks needed to launch correctly and the host's normalized contained paths. Do not introduce a replacement lease manager or runtime option.

Keep handles that actually perform I/O and process management: stdout/stderr pipes, result file reading, Job/process handles, and host atomic subtitle replacement. The pre-created private result handle can remain when it is also the I/O implementation; do not redesign result persistence merely because one comment mentions symlink protection.

Do not broadly remove download/extraction/cleanup symlink guards. No new support claim for junctions or cross-volume deep paths. The accepted risk is concurrent same-user input replacement, not arbitrary writes or deletes outside managed directories.

## 4. Development runners and host tests

### Full CLI tooling

- Keep existing smoke commands and reusable Job/progress/validation helpers; simplify them in place.
- Delete `--freeze-runtime`, local runtime/source/tooling/log/result hash inventories and permanent hash-bound CUDA recovery permits. Existing ignored-local historical gate files should cease to be read as launch authority, not be deleted wholesale.
- Keep nonblocking model-run mutual exclusion, task-owned Job termination and physical reap. No automatic rerun on another device. After a failed attempt, report failure and permit a fresh explicit invocation after cleanup; do not require an identical historical binary and hash-bound short sentinel. If physical cleanup cannot be confirmed, stop for that actual reason.
- Replace hard-coded short-audio SHA admission with actual WAV format/duration validation. An intentionally short test may enforce its duration, not one historical file identity.
- Keep model validity at acquisition/readiness; do not hash weights repeatedly merely to populate reports. Local test arguments identify model/device/audio paths; never use a test input override in production.
- Reports need command/device/case/outcome and useful diagnostics, not durable identity chains. Raw text/private paths stay ignored-local; any tracked summary is sanitized.

### Rust/Native tests

Simplify current Qwen, Parakeet and probe fixture loaders; retain required-mode failures for missing inputs and actual host→worker→ASS, cancellation, recovery and malformed-output assertions. Remove old R2/legacy schema bindings only together with their current callers and tests. Do not preserve obsolete fields just to satisfy archived publishers; do not delete all real model tests as a shortcut.

`check.py` and `recovery_check.py` consume smoke helpers: adapt imports/assertions in the same batch. `path_check.py` keeps task-independent execution and safe scratch-path checks but stops authenticating CRLF counts/internal JSON formatting.

## 5. Builds and reporting-only inference hashes

- `prepare.py`: verify external source archives and extract safely; remove redundant hashes of files just extracted from those archives. Keep patch application anchors that prevent applying a real source patch to an incompatible upstream layout.
- `package.py`: stop recursively hashing the source tree, adaptation scripts and CMake cache into new package metadata. Keep actual artifact file/archive hashing, licenses, source revision attribution, engine declarations and separate local-candidate output.
- CMake/CT2 build script: remove unnecessary exact local tool versions/edition and clean-source/header-byte gates; preserve minimum/API/ABI or specifically known compiler compatibility requirements, source revisions and verified external binary inputs. Record observed tool versions as diagnostics without claiming untested toolchains are supported.
- Keep Cargo/pnpm locks. Keep CUDA deterministic source-name seed derivation and private path remapping; those hashes have an independent functional purpose. Keep published-archive verification and do not convert release checks into permissive development checks.
- CT2/Kotoba token/attempt/tuple SHA fields only serialized for evidence are removed with their serializer/check-only consumers. Dedup uses `same_segment`, not these hashes. Keep actual trace values required by algorithms or direct regression checks. Remove similar reporting-only chains in retained legacy CrispASR development routes; do not retire their entire backend/ABI in this task.
- A single whole-text digest remains permissible when needed to compare private output without recording text; no replacement per-token identity system.

## 6. Local builds versus published artifacts

Changed workers must be built in new ignored-local output roots. Use existing test-only local input seams and, where a Tauri end-to-end build needs integrity metadata, the existing local candidate mechanism. Actual package hashes in that mechanism are **distribution integrity**, not source/log evidence hashes.

No default resource ZIP, published CPU/CUDA lock, remote asset or application version is rewritten. Do not run `pnpm asr:runtime:build` as-is: its default output targets a tracked archive. Do not call normal packaging success proof of changed workers if it only reused old archives. If CT2 local end-to-end testing needs a production-authority change, stop and report that integration gap rather than weaken the verifier or add a new override framework.

Source cleanup acceptance and adoption into future distributed artifacts are separate decisions. Report explicitly which binary was actually tested and which default artifacts are unchanged, using paths/build commands rather than a new hash-bound report.

## 7. Current instruction cleanup

Update affected current README/spec sections and narrow obsolete identity obligations in active tasks (not archived tasks). VAD model/runtime integrity requirements stay. Kotoba quality goals stay; raw/runner evidence hash obligations do not. Parent migration instructions keep device/output/product contracts without requiring wholesale requalification for every reporting-only source change.

Remove obsolete mandatory publisher/sentinel instructions rather than merely append a contradictory exception. Preserve real privacy, cancellation, output and hardware limitations. Any historical background necessary for understanding can link to unchanged archived records.

## 8. Rollback and scope checks

Each batch has an explicit diff and checks. On a failure, isolate and fix the current batch; do not restore an identity lock just to make a test pass, relax output contracts, or change decoding behavior. Reverting an unaccepted batch is a targeted file edit, never a history reset or overwriting unrelated work.

New evidence that a proposed deletion protects a separate real correctness boundary returns that item to planning. This does not justify indefinitely keeping the entire proof system. No performance claim without measurement; functional and maintainability improvements are sufficient goals.
