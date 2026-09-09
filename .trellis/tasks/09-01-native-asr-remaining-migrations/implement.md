# Remaining Native ASR migrations implementation plan

## Execution order

### Phase 1 - Qwen3-ASR + ForcedAligner

Functionality/delivery and owner CPU/CUDA application runs are accepted; CUDA
publication review was owner-closed, not independently executed by the timed-out
reviewer. Cleanup/timeline retirement is accepted. The child remains in_progress
for the newly authorized exact-byte lock relocation and stable scratch decoupling;
offline checks and independent review precede parent-owned archive. Other children
have not started.

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
- [ ] Finish the authorized exact-byte Qwen lock relocation to `native-asr/runtime/full-cli/upstream-engineering-baseline-lock.json` and scratch decoupling to `native-asr/build/full-cli`; after offline checks and independent review, parent preflights the whole-directory move and archives without commit. Mark complete and update actual archived context paths only after archive succeeds; no automatic sibling activation or repeated qualification.

### Phase 2 - Parakeet

- [ ] Refine `09-01-native-asr-parakeet-productization` from archived CrispASR/Parakeet evidence.
- [ ] Preserve exact upstream Parakeet logical identity, qualify viable Native conversion/quantization candidates that resolve the historical medium/long blockers, then select one final artifact by reviewed quality/community/maturity evidence rather than size and freeze its complete conversion identity.
- [ ] Reuse the frozen bundled CPU/on-demand CUDA runtime contracts; implement only Parakeet model delivery, CPU+CUDA execution, frontend availability and lifecycle integration.
- [ ] Complete the WAV+ASS absolute CUDA quality-performance matrix plus CPU short/medium/long functional/lifecycle matrix and archive the child before starting ReazonSpeech.

### Phase 3 - ReazonSpeech NeMo

- [ ] Refine `09-01-native-asr-reazonspeech-productization` from R1/R2 archived evidence.
- [ ] Preserve exact upstream ReazonSpeech logical identity, qualify viable Native conversion/quantization candidates that resolve the long-audio zero-duration failure without synthetic repair, then select one final artifact by reviewed quality/community/maturity evidence rather than size and freeze its complete conversion identity.
- [ ] Reuse the frozen bundled CPU/on-demand CUDA runtime contracts; implement only ReazonSpeech model delivery, CPU+CUDA execution, frontend availability and lifecycle integration.
- [ ] Complete the WAV+ASS absolute CUDA quality-performance matrix plus CPU short/medium/long functional/lifecycle matrix and archive the child before starting VAD.

### Phase 4 - General Native VAD (Qwen prerequisite already owned by Phase 1)

- [x] Freeze VAD device policy: VAD always runs on CPU; the selected device controls only the main ASR model.
- [ ] Reuse the frozen Qwen CPU VAD dependency and inventory the additional VAD behavior required by other production routes; do not redesign Qwen's fixed pipeline.
- [ ] Refine `09-01-native-asr-vad-migration` with exact applicability, model asset, CPU runtime and failure policy.
- [ ] Implement the minimum shared CPU VAD mechanism required by those routes without adding VAD device UI or CUDA pack content.
- [ ] Validate both `CPU VAD -> CPU ASR` and `CPU VAD -> CUDA ASR`, then complete the child quality check and archive it.

### Phase 5 - Parent integration check

- [ ] Verify all four children are completed and archived in the fixed order.
- [ ] Verify all original v0.4.1 selectable model routes are production Native on both CPU and CUDA and no longer `postMvpUnavailable`.
- [ ] Verify each route retains its exact upstream logical model and one final artifact with source/hash/license authority. Qwen uses the upstream-recommended pair with new runtime functional validation, not a quality competition or fresh conversion research; apply remaining children’s own candidate-selection contracts.
- [ ] Verify Qwen ASR+aligner download/status/repair/cleanup behaves as one logical pair and can never expose a single-role or mixed-version ready state.
- [ ] Verify Qwen has separate CPU/CUDA short/medium/long functional and lifecycle coverage without subtitle-quality checks. Apply other children’s own still-active verification contracts, not Qwen's retired quality/inheritance rules.
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

- that child applies its current agreed verification scope: Qwen's rebuild is functional-only on CPU/CUDA, including mandatory CPU VAD and upstream LIS; do not resurrect old quality gates. Other children retain their own planning contracts;
- for Qwen's integration-first start, the bundled-CPU/on-demand-CUDA distribution, independent roots and final packaging contract are specified; exact final artifact identities/pack measurements are frozen after functional integration, not required before starting it. Later model children must wait for that final shared runtime contract and reuse it rather than creating per-model runtime packs;
- that child has converged PRD/design/implement artifacts;
- its `implement.jsonl` and `check.jsonl` contain real spec/research context;
- the user approves implementation of that child.
