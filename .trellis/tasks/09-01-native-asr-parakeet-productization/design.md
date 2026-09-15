# Parakeet full-CLI integration design

## Authority

Requirements, owner authorization and delivery boundaries are defined in [`prd.md`](./prd.md); completed execution and evidence are recorded in [`implement.md`](./implement.md).

Status: in_progress; owner confirmed D1 and subsequently explicitly authorized implementation. No Git commit/publication authority.

## Current delivery state

The authorized shared-v2 dependency is published and both profile downloads verified.
Default builds now embed both-device Qwen+Parakeet authority; the original Qwen-only
lock is retained byte-for-byte as `crispasr-product-lock-v1.json`. New local packaging
contains reviewed path/media fixes; the old app and inference proofs remain unchanged.
Exact results and limits are in implement.md. Earlier local-candidate/default-only
statements below describe the preceding stage, not current distribution readiness.

## 1. Scope and decision

PRD is authority: exact Japanese Parakeet, complete upstream integration, separate CPU/CUDA functional acceptance, no quality scoring/quantization tournament/custom aligner. ReazonSpeech and general VAD remain separate.

**D1 — owner-approved complete Japanese pipeline:** reuse the already frozen CPU Silero dependency as required Parakeet readiness; retain upstream Japanese VAD/12-second slice handling and actual-audio gap retranscription, including its returned-word/segment-boundary reconstruction. Do not introduce a general VAD setting, optional engine-wide VAD API, new VAD model or application-side custom gap-fill algorithm. This narrowly extends the parent VAD/gap-fill scope for Parakeet; general VAD remains last and ReazonSpeech is unchanged.

Evidence and source URLs: `research/planning-evidence.md`.

## 2. Model and runtime

- Proposed first/only functional target: `cstr/parakeet-tdt-0.6b-ja-GGUF/parakeet-tdt-0.6b-ja.gguf` (F16, default TDT), corresponding to exact `nvidia/parakeet-tdt_ctc-0.6b-ja`. The card recommends F16; CLI registry defaults to Q8_0. Choose card-recommended F16 without a tournament or size optimization. Incompatibility/resource failure returns to planning rather than automatically switching artifacts.
- Before acquisition, freeze repository revision, file size/SHA, source card/license and known conversion provenance using trusted repository metadata; after acquisition verify actual bytes/GGUF identity. Do not use `main`, `-m auto`, implicit download or filename inference in production. Do not invent converter commit/qualification claims.
- Reuse shared CrispASR CPU/CUDA roots, full pinned source and existing build/packager/verifiers. Do not create per-model runtime packs. Old Qwen runtime bytes are immutable evidence, not proof that Parakeet already runs safely.
- Local shared candidate packaging uses an explicit fresh `shared-*` artifact identity and generated lock. `HIKARU_CRISPASR_CANDIDATE_LOCK` is an absolute build-time input shared by resource preparation, Rust embedding and portable preparation; default builds retain immutable published Qwen authority. The running app never reads this variable or an external mutable lock. Normal model support requires the permitted model flag plus both embedded device artifacts' engine membership; listing and launch still verify exact payloads, and selected-engine authorization precedes host caching/launch. Default Qwen-only authority rejects Parakeet. This input does not authorize candidate CUDA publication/download readiness.
- Parakeet-specific device attestations and controlled offline failure paths may require a shared runtime revision. Build a new local candidate through existing producers; derive new hashes/locks from actual bytes, retain old accepted artifacts, rerun Qwen compatibility and both Parakeet devices. Never overwrite the published CUDA asset identity or upload in this task. If final runtime bytes differ, remote distribution requires separate owner action; document the missing download separately rather than falsely enabling it. Owner-approved local use of an exact verified installed candidate does not require remote publication.

## 3. Data flow and minimal seams

`existing model status/download → Native route/device resolution → host private CLI workspace → worker → full crispasr CLI → bounded final result → segmentsReplace → completed → existing ASS persistence`

- Extend the existing CLI process/path/Job/output handling only where two real callers need reuse; no generic backend plugin framework. Keep Qwen-specific request/output validation and approved display merging isolated.
- New Parakeet route dispatch in `native-asr/src/main.cpp` must select the full CLI, not historical `parakeet_family_policy` windows/development C ABI. Do not delete sibling development code as incidental cleanup.
- Under D1, explicit roles are `model` and `vad`, never `aligner`. Update protocol role validation and Rust `validate_route` consistently; work directory/reparse-point validation must apply to both production CLI routes.
- Use `--backend parakeet`, explicit model/audio/result paths, Japanese language, explicit CPU/CUDA, strict pipeline/word-timestamp checks. Under D1 explicitly pass existing Silero path and strict required-VAD behavior. Keep upstream Japanese slicing defaults: do not set `--chunk-seconds`, enable custom overlap/stitching or inherit tuning environment variables. Freeze exact supported argv from pinned source before first smoke.
- Process environment remains allowlisted; no inherited `CRISPASR_*` overrides. Canonical relative audio paths, Unicode-safe model checks, no model network auto-acquisition and no FFmpeg shell fallback. These safeguards must cover Parakeet, not rely on the Qwen-only environment guard.

## 4. Device and lifecycle safety

- CPU disables CUDA loading/initialization. Explicit CUDA verifies the complete own-root runtime closure and actual Parakeet encoder/decoder execution path, failing on silent CPU backend fallback. Trace which CPU host operations are intrinsic; do not copy Qwen all-graph assertions without checking Parakeet architecture. A mixed compute fallback is not an accepted CUDA run.
- Existing auto selection is pre-launch only. No running GPU retry on CPU, alternate decoder or alternate model.
- Reuse suspended creation/Job assignment, cancellation and reap gate. Physical exit is separate from retryable private result cleanup; cleanup failure must not strand a task gate.
- Progress reflects monotonic stage/slice work. Preserve bounded startup and 120-second no-progress execution watchdog semantics; repetitive stderr is not progress. Only task-owned process trees may be killed. Serial model-backed validation uses a task-owned mutex and inventory; after killed CUDA runs require the frozen short sentinel before further authoritative measurements.

## 5. Output contract

- Parakeet supplies native TDT word timestamps; no Qwen ForcedAligner/LIS or newly introduced aligner model.
- Ordinary upstream JSON passes raw `all_segs` rather than display segments. Reuse the existing full-CLI machine-output adaptation to expose actual upstream word-aware display rows for Parakeet, after tracing the real active dispatcher. Do not implement a second segmentation algorithm in the app or treat giant raw chunks as proven subtitle display output.
- Validate bounded byte length, strict UTF-8 and raw-NUL rejection before JSON parse; enforce backend identity, complete result, finite integer/bounded timestamps and correct units. Trace pinned writer units, then test exact conversion; do not infer ms from field names.
- Emit one atomic `segmentsReplace`, then completed, only after positive-duration/start-order/audio-bound/text-conserving validation. Pure silence may yield a truthful empty success; decode/VAD failure cannot masquerade as silence.
- Do not apply Qwen adjacent-anomaly merging to Parakeet without separate approval. Invalid timestamps/text return structured failure and preserve prior ASS/document. Upstream actual-audio retranscription, approved in D1, is not permission for application-generated text/timing or reference repair.

## 6. Delivery/UI

Reuse `asr_models.rs` manifest/staging/atomic readiness/repair/cleanup. Under D1, one logical Parakeet download covers its ASR file plus the exact shared Silero asset; reuse verified VAD bytes without duplicating or deleting a sibling dependency. CPU/CUDA share weights. Model weights stay out of runtime and installer packages.

Reuse existing constants/status/settings/transcription start flow. No quantization, source language, VAD device or new download-cancel UI. Default builds remain unavailable for Parakeet; an explicitly selected shared build authority permits normal local validation after both-device functional and local delivery checks. Runtime engine membership, not backend-wide Qwen readiness or a runtime environment flag, authorizes it. Engine-specific failures must not alter Qwen/CT2 caches, route readiness or selected settings. Latest independent capability/UI review is accepted for its bounded short-path evidence, not whole-task/release acceptance. A subsequent source-only repair keeps ordinary private cwd but uses the verified/pinned CLI own-root when the private cwd reaches Win32 MAX_PATH; canonical same-volume relative audio, original absolute private output/cache/TEMP and host cleanup stay unchanged. Never use a writable ancestor as cwd (it adds a DLL search directory), an alias or relocated portable data. Model-free real-I/O fixtures close observed272 startup only. Unchanged upstream CRT expanded-relative/audio path limits, deep CLI roots and cross-volume deep-work remain unsupported; the retained runnable app is pre-fix. This follow-up requires independent review; implementation evidence/limits are in implement.md.

## 7. Verification scope — owner-directed integration first

The owner explicitly resumed implementation and instructed that the non-shipping P2 observer must not block Parakeet migration. Remove the continuously polling process/DLL observer from the required execution path; do not replace it with another mandatory checkpoint monitor or spend another iteration repairing it.

- Acceptance follows actual product behavior: requested device execution, legal result, worker/host completion, ASS persistence, cancellation/failure preserving existing subtitles and owned process cleanup. Keep the production runtime integrity checks, native device assertions, strict parser and lifecycle protections.
- Reuse P1 evidence for unchanged CLI/runtime/model bytes. Verify the actual P2 worker/host invocation and its results; do not repeat full runtime forensics solely because diagnostic observer code changed.
- Report functional outcome, lifecycle outcome and optional diagnostic completeness separately. An observer error does not erase successful transcription/ASS/cleanup or block unrelated implementation. A concrete product failure or unresolved required device proof still matters; missing optional module samples do not.
- Preserve original raw records and their historical harness dispositions. Record additional functional conclusions only from retained actual outputs; do not relabel failures as full passes. Prior CPU functional successes are usable for their proven scope, not substitutes for CUDA or final product acceptance.
- Retain serial model execution, owned process cancellation and the existing durable CUDA recovery gate. These prevent interference and unsafe cleanup; optional continuous system snapshots/file polling are not those protections.
- Rerun according to the changed product behavior: runtime/algorithm changes need affected device regression; worker/parser changes need affected host/output checks. Observer-only changes do not invalidate unchanged successful inference evidence. Use existing tests and bounded completion checks, not a new monitoring platform.
- Continue through worker/host/ASS, managed download/readiness and existing UI flows without waiting for optional forensic reports. No additional publication authority is implied.

## 8. Rollback and review

Parakeet-only availability can remain disabled/roll back without removing Qwen, CT2 or their weights. Shared runtime candidates retain exact old rollback identity; no in-place edits to accepted locks or history operations. Raw transcript/logit/private-path evidence stays ignored-local; tracked summaries contain actual hashes/counts/status/limitations, generated from retained outputs.

No version/CHANGELOG/release readiness/publication work. D1 is approved. Source/argv trace must precede the first smoke; explicit implementation approval remains the start gate; final artifact hashes and six-row hardware results are implementation outputs, not fabricated prerequisites.
