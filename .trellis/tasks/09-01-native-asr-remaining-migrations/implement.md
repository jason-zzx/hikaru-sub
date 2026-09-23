# Remaining Native ASR migrations implementation plan

## Execution order

### Phase 1 - Qwen3-ASR + ForcedAligner

Functionality/delivery and owner CPU/CUDA application runs are accepted; CUDA
publication review was owner-closed, not independently executed by the timed-out
reviewer. Cleanup/timeline retirement and exact-byte lock relocation to stable
scratch are accepted; the owner waived further review and the Qwen child was
archived on 2026-09-09. Parakeet is archived; ReazonSpeech implementation, local
qualification and owner-authorized shared-v3 dependency/default enablement are
complete, and its child awaits archive; general VAD has not started.

- [x] Freeze the parent device-coverage decision: Qwen3, Parakeet and ReazonSpeech must each support production CPU and CUDA.
- [x] Review the new integration-first design and curated context for `08-20-native-asr-qwen3-aligner`; user explicitly instructed 开始实施 and task.py start activated the child.
- [x] Retain the previously confirmed default Q4_K pair, mandatory CPU VAD and upstream LIS/interpolation; user now requests full upstream CLI without Qwen-only source trimming.
- [x] First deliver serial real CPU/CUDA short flows using the pinned full `crispasr-cli` target and only necessary device/output adapters; do not resume the trimmed target's 20-symbol link work.
- [x] Bridge the CLI into existing worker/job/recovery/ASS before final packaging closure; no new job system or quality experiment.
- [x] Preserve exact upstream Qwen ASR/ForcedAligner identities and lock the recommended published pair's files/source/license; no quantization competition, converter research campaign or subtitle-quality matrix.
- [x] Extend model delivery with one Qwen logical download job, pair-total progress, resumable per-role staging, full-pair repair/cleanup semantics and pair-level atomic readiness publication; do not add a new model-download cancellation API.
- [x] Establish independent CrispASR CPU/CUDA artifact IDs, locks, verifiers and roots: bundled CPU and managed on-demand CUDA, both isolated from the existing CTranslate2 artifacts and without model weights.
- [x] Integrate required CPU VAD in Qwen, include its asset in logical progress/readiness, and preserve upstream word-aware alignment/display semantics; only the child-approved adjacent display anomaly merge using existing endpoint envelopes; no other repair or text-duration fallback.
- [x] Run separate CPU/CUDA short/medium/long functional and lifecycle checks; no reference ASS, quality scoring, Python parity or inherited GPU quality label.
- [x] Finish the exact-byte Qwen lock relocation to `native-asr/runtime/full-cli/upstream-engineering-baseline-lock.json` and scratch decoupling to `native-asr/build/full-cli`; offline checks passed, the owner waived further independent review, and the child was archived without automatic sibling activation or repeated qualification.

### Phase 2 - Parakeet

- [x] Refine `09-01-native-asr-parakeet-productization` from archived CrispASR/Parakeet evidence.
- [x] Preserve exact upstream Parakeet logical identity; directly integrate the full pinned upstream toolchain and one compatible upstream/community-recommended artifact, recording actual source/revision/files/size/SHA/format/quantization/license and known conversion provenance. No quantization competition, converter research campaign or custom alignment; investigate current failures without treating old failures as current CLI evidence.
- [x] Reuse the frozen bundled CPU/on-demand CUDA runtime contracts; implement Parakeet model delivery, CPU+CUDA execution, frontend availability and lifecycle integration. Owner approved existing required CPU Silero readiness plus full upstream Japanese slicing and actual-audio gap retranscription/segment-boundary reconstruction; no new general VAD UI or application-side custom repair.
- [x] Complete separate real CPU/CUDA short/medium/long CLI→worker→ASS functional, resolved-device, output-safety, download/offline/cancel/recovery/cleanup and regression checks; no CER/gap/RTF threshold qualification, Python parity or inherited GPU quality label. Final independent standards/safety and requirements/distribution-evidence reviews passed with no findings, and the owner confirmed final CPU/CUDA application execution.
- [x] Owner-authorized commit completed and Parakeet child archived on 2026-09-15; ReazonSpeech was not started automatically.

### Phase 3 - ReazonSpeech NeMo

- [x] Refine and implement `09-01-native-asr-reazonspeech-productization` from R1/R2 archived evidence.
- [x] Preserve exact upstream identity and freeze the registry-recommended Q8_0 artifact/source/license without subtitle-quality or F16/Q4_K competition.
- [x] Reuse shared CPU/on-demand CUDA runtime contracts and exact CPU Silero through pinned full-CLI `model + vad`; complete model delivery, CPU/CUDA execution, frontend availability and lifecycle integration without general VAD settings.
- [x] Complete CPU/CUDA short/medium/long functional, resolved-device, exact PCM-support endpoint, output-safety, download/offline/cancel/recovery/cleanup and local product-delivery checks without quality/performance qualification.
- [ ] Complete final child review and archive before starting general VAD; the independent owner checkpoint has published/verified shared-v3 and preserved shared-v2 rollback.

### Phase 4 - General Native VAD (Qwen prerequisite already owned by Phase 1)

- [x] Freeze VAD device policy: VAD always runs on CPU; the selected device controls only the main ASR model.
- [ ] Reuse the frozen Qwen CPU VAD dependency and inventory the additional VAD behavior required by other production routes; do not redesign Qwen's fixed pipeline.
- [ ] Refine `09-01-native-asr-vad-migration` with exact applicability, model asset, CPU runtime and failure policy.
- [ ] Implement the minimum shared CPU VAD mechanism required by those routes without adding VAD device UI or CUDA pack content.
- [ ] Validate both `CPU VAD -> CPU ASR` and `CPU VAD -> CUDA ASR`, then complete the child quality check and archive it.

### Phase 5 - Parent integration check

- [ ] Verify all four children are completed and archived in the fixed order.
- [ ] Verify all original v0.4.1 selectable model routes are production Native on both CPU and CUDA and no longer `postMvpUnavailable`.
- [ ] Verify each route retains its exact upstream logical model and one final artifact with source/hash/license authority. Qwen uses the upstream-recommended pair, Parakeet uses its compatible upstream/community-recommended artifact, and ReazonSpeech uses the upstream registry-recommended exact Q8_0; all rely on new runtime functional validation, not quality competition or fresh conversion research.
- [ ] Verify Qwen ASR+aligner download/status/repair/cleanup behaves as one logical pair and can never expose a single-role or mixed-version ready state.
- [ ] Verify Qwen, Parakeet and ReazonSpeech each have separate CPU/CUDA short/medium/long functional, resolved-device, output-safety and lifecycle coverage without subtitle-quality checks, performance-threshold qualification or inherited GPU quality labels.
- [ ] Verify the shared CrispASR CPU runtime is bundled as an independent closed world with zero model weights, the shared CUDA pack is managed/on-demand under an independent root, neither can load/repair/clean the CTranslate2 artifacts, and final NSIS/portable ZIP sizes remain within 80/90 MiB.
- [ ] Verify VAD remains CPU-only for both CPU and CUDA ASR routes, with no VAD GPU choice or separate CUDA VAD pack. Qwen's full CUDA CLI may include CPU Silero code/support; VAD weights stay shared and outside runtime packs.
- [ ] Verify no Python/runtime/venv/PyTorch/NeMo fallback or package dependency was restored.
- [ ] Run full frontend, Rust, Native runtime/model, installed/portable and cross-route regression gates.
- [ ] Synchronize shared specs and user documentation for the final supported model/device/VAD matrix.
- [ ] Keep versioning and release work outside this task.

## Parent validation commands

Each child owns additional backend/model-specific commands. The parent final gate includes at least:

```powershell
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm release:local
python ./.trellis/scripts/task.py validate 09-01-native-asr-remaining-migrations
git diff --check
```

## Rollback points

- After each engine child: its product/source gate can remain disabled without affecting completed earlier routes.
- Before VAD: all three model routes must have a stable non-VAD baseline or an explicitly documented mandatory-VAD contract.
- Parent failure never authorizes restoring Python fallback or changing already frozen model/runtime bytes.

## Start gate

Do not run `task.py start` for the parent or a child until:

- that child applies its current agreed verification scope: Qwen's rebuild is functional-only on CPU/CUDA, including mandatory CPU VAD and upstream LIS; do not resurrect old quality gates. Parakeet is also functional-only on CPU/CUDA with full upstream integration and no quality/quantization competition; owner separately approved reusing required CPU Silero and retaining upstream Japanese actual-audio gap retranscription/segment reconstruction, not Qwen aligner/repair behavior. ReazonSpeech is likewise functional-only on CPU/CUDA, fixes the upstream registry-recommended exact Q8_0 without a quality/quantization competition, and reuses the same exact CPU Silero only through its pinned full-CLI `model + vad` route; general VAD remains last;
- for Qwen's integration-first start, the bundled-CPU/on-demand-CUDA distribution, independent roots and final packaging contract are specified; exact final artifact identities/pack measurements are frozen after functional integration, not required before starting it. Later model children must wait for that final shared runtime contract and reuse it rather than creating per-model runtime packs;
- that child has converged PRD/design/implement artifacts;
- its `implement.jsonl` and `check.jsonl` contain real spec/research context;
- the user approves implementation of that child.
