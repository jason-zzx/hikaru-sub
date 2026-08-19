# Python legacy 基线与 native 资格门槛实施计划

> 本计划只在用户评审 `prd.md` / `design.md` 后启动。当前阶段不运行模型、不修改生产代码、不切换 native 路由。

## Dependencies And Inputs

- `.trellis/tasks/archive/2026-07/07-25-native-asr-benchmark-baseline/research/benchmark-contract.md`
- `.trellis/tasks/archive/2026-07/07-25-native-asr-benchmark-baseline/research/python-reference-report.md`
- `scripts/asr-benchmark.py` 和 `asr-service/engines/registry.py`
- `.asr-benchmark/manifest.json`（ignored local input）
- 当前开发 Python interpreter、当前 sidecar lock、当前模型缓存
- parent `07-25-native-asr-migration` planning artifacts

## Implementation Result (2026-08-18)

- The first CUDA acquisition completed 18 rows, but independent review found that those raw envelopes did not bind the acquisition-time benchmark runner identity. They are therefore invalid as authority and are isolated under ignored `research/local/history/unbound-acquisition-runner/`; no tracked baseline handoff is authoritative from those rows.
- The benchmark now emits an acquisition-time identity for `scripts/asr-benchmark.py` (`sourcePath` + SHA-256), the frozen `python-legacy-cuda-v1` profile binds that SHA, and the publisher rejects missing or drifted per-row runner identity. The detached, resumable 18-row CUDA reacquisition with runner SHA `2e0dbee811f28e18dd1d5d29bb9ed50ab5ed028004adf1820665a128a813c45c` completed all 18 rows (runnerStatus=completed, rc=0, on-disk SHA-256 matching `matrix-state.json`), and the tracked handoff `research/python-legacy-baseline.json` / `.md` was published from those rows with byte-identical double generation.
- The stdlib-only publisher/comparator recomputes quality metrics from the validated local ASS through the shared T01 implementation and rejects model/case/profile/artifact/companion, native-result identity, acquisition-tool, or mutable-metric drift. Tracked JSON/Markdown will be regenerated only after all reacquired rows validate.
- Native GGUF mappings whose revision/hash remains pending cannot qualify until T12/T14 freezes the exact artifact/companion identity. CT2 mappings are revision-bound now.
- The three pre-switch CPU rows remain isolated under ignored `research/local/history/python-legacy-cpu-v1/` and are invalid for `python-legacy-cuda-v1`.
- Runner correctness fixes retained: benchmark inference enters the same `whisper_inference_session` used by production jobs, loaded long-mode compute identity is recorded after lazy load, and parent/child JSON transport is forced to UTF-8.

## Ordered Checklist

### 1. Freeze model identity and baseline profile

- [x] Create a task-local identity/profile lock covering `large-v2`, `large-v3`, Kotoba, Parakeet, Qwen3-ASR + ForcedAligner, and ReazonSpeech.
- [x] Record explicit Python-to-native mappings and companion model identities; reject family/name-only matching.
- [x] Freeze the CUDA Python legacy profile (`--device cuda`, per-engine production compute resolution), current interpreter, dependency versions, model revisions/hashes, GPU identity, cache state, VAD, long-mode and seed/history parameters.
- [x] Mark `tiny`, `base`, `small`, `medium`, and `large-v3-turbo` as `whisper-family-unlock-only`, with no independent Python quality baseline.
- [x] Add the exact ignored local root and validate that no raw transcript, audio, ASS body, model weight or absolute path enters tracked output.

### 2. Acquire Python legacy rows

- [x] Validate the T01 corpus identity before any model run.
- [x] Run current Python sidecar through the final identity-bound benchmark runner with `--device cuda` for every required model and all `short-v1`, `medium-v1`, `long-v2` cases; reacquisition completed 18/18 rows on 2026-08-18.
- [x] Use short `1 cold + 3 warm`; medium/long one complete run or a complete identity-bound structured failure/timeout record according to the existing rules.
- [x] Preserve final refresh reduction, Qwen ForcedAligner provenance, completed/failed/skipped semantics and all existing resource/timing metadata.
- [x] Re-run only invalid/drifted rows; do not edit metrics by hand or retry with changed parameters under the same identity.

### 3. Add model-level comparison and publication

- [x] Implement the smallest stdlib-only adapter/publisher needed to bind native and Python rows by model identity, case and comparison profile.
- [x] Recompute or delegate all shared quality metrics through T01; never trust mutable adapted metric fields.
- [x] Compare only subtitle quality against Python: CER/S-D-I, empty text, semantic gaps and Qwen eligible timing.
- [x] Keep structural hard gates (timeline legality, text conservation, subtitle/protocol legality and complete coverage), RTF, cold wall, RSS, required samples, identity, protocol, cancellation, recovery, path, privacy, license and packaging checks on the existing absolute contracts.
- [x] Publish baseline JSON plus deterministic sanitized Markdown after the identity-bound reacquisition completes; the comparison contract is implemented and the reacquired 18 identity-bound rows published `research/python-legacy-baseline.json` / `.md` on 2026-08-18.
- [x] Emit a Whisper family gate that requires both `large-v2` and `large-v3`; emit independent model dispositions for Kotoba, Parakeet, Qwen3 and ReazonSpeech.

### 4. Update planning/spec authority

- [x] Update parent `prd.md`: new evidence hierarchy, model-level quality comparison, Whisper family unlock, unchanged non-quality absolute gates.
- [x] Update parent `design.md`: baseline identity manifest, comparison flow, disposition dimensions and release boundary.
- [x] Update parent `implement.md`: dependency edge before T06/T08/T10/T10R/T11/T14/T15/T18, revised gate wording and validation expectations.
- [x] Update `.trellis/spec/asr/quality-guidelines.md`: replace the blanket “Python references never establish relative gates” rule with the scoped contract; retain ground truth, provenance, security, protocol and absolute non-quality rules.
- [x] Update relevant unarchived downstream descriptions in the parent task map. Do not edit archived evidence.
- [x] Add supersession pointers from the new handoff to the old T01 short-only report while retaining historical native reports unchanged.

### 5. Validate and hand off

- [x] Run benchmark self-check and manifest validation.
- [x] Run focused benchmark publication/mutation tests, including model/case/profile/companion identity drift and attempted cross-model substitution.
- [x] Run Python sidecar unit tests; all 243 tests pass in the development venv and all optional engine suites load in this environment.
- [x] Generate the sanitized report twice from the reacquired identity-bound rows and require byte-identical output.
- [x] Run privacy/path/ignore scans, `git diff --check`, `task.py validate`, and inspect `git diff --cached --name-only` without staging or committing.
- [x] Have an independent review check that quality-only relative comparison did not relax existing non-quality or security gates. (trellis-check run f07ef919, 2026-08-19: all 6 items PASS; absolute RTF/wall/RSS/structural/security gates confirmed unchanged)

## Validation Commands

```powershell
python scripts/asr-benchmark.py self-check
python scripts/asr-benchmark.py validate --manifest .asr-benchmark/manifest.json --corpus-root .asr-benchmark
python -m unittest discover -s asr-service/tests -p "test_asr_benchmark.py"
Push-Location asr-service
python -m unittest discover tests
Pop-Location
python ./.trellis/scripts/task.py validate .trellis/tasks/08-18-native-asr-python-legacy-baseline
git diff --check
git diff --cached --name-only
```

Model runs use the development interpreter and ignored output paths documented in the task-local identity lock; they are not CI commands and must not run before planning approval.

## Review Gates

Before `task.py start`:

- [x] User approves the final PRD/design/implementation artifacts.
- [x] The exact baseline model scope is recorded: Whisper anchors only plus all non-Whisper models.
- [x] The exact metric split is recorded: subtitle quality relative to Python; everything else remains prior absolute/engineering gates.
- [x] Context manifests contain real spec/research entries.

Before completion:

- [x] All required baseline rows are valid or explicitly unavailable/not-run.
- [x] Both Whisper anchors have complete matrices and independent rows.
- [x] No downstream task can publish a native route from a missing, invalid, cross-model or family-averaged baseline.
- [x] Historical task reports remain unchanged.
- [x] No production route, runtime package, model downloader or UI behavior changed.

## Rollback Points

- Before model acquisition: delete only new planning/ignored task-local files.
- After baseline publication: remove the new handoff and comparison adapter; preserve raw evidence and historical reports as documented, or mark the handoff superseded.
- Before downstream edits: restore only unarchived planning/spec wording touched by this task; never rewrite archived evidence.
- No Git history or remote state changes are authorized by this plan.
