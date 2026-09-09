# Full upstream CLI integration (Qwen application enabled)

## Current state and authority

The owner confirmed CPU and CUDA application runs. Qwen selection/download/start
and the separate CrispASR CUDA download remain enabled. The owner accepted closure
of the CUDA-publication review item; the timed-out independent agent **did not
execute that review**. Dependency publication is not a new application release.
The separately authorized old Qwen development-timeline retirement uses offline
model-free worker builds/tests only; no inference, probe, download/upload or packaging.

- Current file/archive authority: `../crispasr-product-lock.json`.
  `productEnablementAllowed=true`, `externalStableAssetPublished=true`; preserve
  its bytes. Its historical pending status string is not current acceptance authority.
- CUDA asset: `hikaru-asr-crispasr-windows-x64-cuda-v1.zip` on the existing
  `native-asr-cuda-v1` dependency release, **719,774,409 bytes**, SHA-256
  `5a8e0272d41341e1759a32765fc4a218135df6626bfec83c80eed2b08379370d`.
  Official GitHub and ghfast.top downloads matched and passed isolated installation,
  full closure verification and the bounded model-free probe. CT2 is a separate asset/root.
- Exact Q4_K pair + mandatory CPU Silero readiness and runtime checks remain required.
  Model download total is **2,020,801,514 bytes**. Valid installed CUDA requires
  verification/probe even independently of published download sources.
- Repaired final CPU/CUDA short/medium/long manager→host→ASS flows were independently
  accepted: CPU cues **8/107/626**, CUDA **8/112/615**, plus silence/cancel/reopen and
  local package audits. See task `implement.md` for the six-row table, 12 runner
  records/14 actual CLI calls, 11 reconstructed successful outputs and limitations.
  Old failures remain old failures; no quality scoring or Python parity was performed.
- Historical local NSIS/portable extraction passed at **15.525/22.257 MiB** against
  **80/90 MiB** budgets. Those packages predate enablement/UI changes; they are not
  a newly released app or evidence of later installer interaction. Only RTX3070 was
  tested; manual installation/uninstallation and release readiness remain separate.

Task prefix below: `.trellis/tasks/08-20-native-asr-qwen3-aligner`.
Keep `research/upstream-engineering-baseline-lock.json` at its exact path/bytes:
`prepare.py`, `package.py`, and `smoke.py` still consume it. Its acquisition-time
verification flags remain historical, not relabeled. Keep `upstream-rebuild-sources.json`
and the concise `upstream-rebuild-research.md` source rationale. The unused trimmed
target and abandoned experiments are retired. The old Qwen development timeline
library/table/dedicated tests are also retired as a unit; the generic development
worker retains its original structured-failure seam. Current full-CLI code/tests,
shared backend ABI and sibling development targets remain unchanged.

## Pinned source and redistribution

- CrispASR v0.8.32: `e2a356146e36bc1cc0410edefb01990448766979`.
- GGML: `5049ebb8472fdc965eb3fb72c1cb111260726186`.
- Full c2pa-audio: `e40329b83f16f67bb5ddc7bb13ae18de0a9376fc`; complete archive URL,
  size/SHA in `prepare.py` supersede the old header-only acquisition record as
  build-input authority. Optional native C2PA signing is disabled by upstream config.
- `build.cmd` builds the ordinary full `crispasr-cli` target and its dependencies.
  It disables CURL/FFmpeg/SDL2/espeak-ng/Opus/AMR fetching, GGML OpenMP and other GPU
  extensions through existing options, not Qwen-only source guards. CLI internal
  backends/server remain compiled but the controlled application never invokes them.
  VCOMP140 remains an actual upstream per-target dependency, not claimed removed.
- `delivery.cmake` applies deterministic metadata/path mapping, not inference changes.
  CUDA12.8.93 + MSVC19.50.35722.0 uses `-allow-unsupported-compiler`. Pinned GGML's
  non-native defaults produced PTX50/61/70/75/80/90 and SASS86/89/120a; coverage is
  not NVIDIA-supported host-toolchain or cross-generation/driver/VRAM qualification.
- `package.py` consumes completed CLI/worker builds and declared source/redist/license
  inputs; it neither compiles nor downloads models. It emits independent CPU/CUDA
  archives and complete notices, including Microsoft 2026 original terms, NVIDIA,
  MIT/BSD/Apache components and uroman's additional acknowledgement. Model cards
  declare Apache-2.0 / Apache-2.0 / MIT; missing converterCommit is not invented.
  Publication metadata is retained only for exact already-published archive bytes;
  changed bytes require separate authorization/verification. Do not edit producer
  or lock merely to change historical status prose.
- CPU resource preparation replaces only its own verified subtree, preserving CT2.
  CPU is bundled; CUDA is managed/on-demand at `deps/asr-runtime/crispasr/cuda/current`.
  Weights, development tools and raw evidence enter neither runtime nor application packages.

## Build and focused reproduction commands

These are retained engineering commands, **not cleanup actions or authorization to
rerun models**. Use an x64 Visual Studio Developer prompt (VS18.2/MSVC14.50.35717,
SDK10.0.26100, VS CMake/Ninja, installed CUDA12.8 in the accepted environment).

`LOCAL` is the task's ignored `research/local/integration-first/` directory;
`CACHE` is its existing `research/local/upstream-rebuild-baseline/` archive cache.
Preparation requires the verified full c2pa archive at the supplied path; missing
acquisition needs separate scope. Do not modify cache/old accepted build trees.
`prepare.py` requires a fresh output under LOCAL. Device build roots cannot be
reused across devices/pins. The smoke runner is fixed to `LOCAL/<device>/bin/crispasr.exe`;
do not point it at another package by assumption or execute stale binaries.

```bat
python native-asr/runtime/full-cli/prepare.py --cache "%CACHE%" --c2pa-archive "%LOCAL%/c2pa-audio.tar.gz" --output "%LOCAL%/source-new"
python native-asr/runtime/full-cli/patch.py "%LOCAL%/source-new"
call native-asr/runtime/full-cli/build.cmd "%LOCAL%/source-new" "%LOCAL%/cpu" cpu
call native-asr/runtime/full-cli/build.cmd "%LOCAL%/source-new" "%LOCAL%/cuda" cuda "%CUDA_ROOT%"
python native-asr/runtime/full-cli/check.py --source "%LOCAL%/source-new" --output "%LOCAL%/output-check-new"
python native-asr/runtime/full-cli/smoke.py --device cpu --name cpu-new --asr "%ASR%" --aligner "%ALIGNER%" --vad "%VAD%" --audio "%SHORT_WAV%"
python native-asr/runtime/full-cli/smoke.py --device cuda --name cuda-new --cuda-bin "%CUDA_ROOT%/bin" --asr "%ASR%" --aligner "%ALIGNER%" --vad "%VAD%" --audio "%SHORT_WAV%"
```

Run serially and stop on any nonzero exit. Each run name must be new. Models/audio
may alternatively resolve from ignored `models-verified.json`/`audio-verified.json`;
all actual hashes are checked. Short input is the authorized mono PCM16/16kHz,
385637-frame WAV SHA `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211`.
No reference ASS is read. `--unicode-paths` exercises Chinese/spaced hardlink paths;
`--case silence|missing-vad|invalid-vad|missing-asr|missing-aligner|auto-asr|auto-aligner|auto-vad|missing-cuda`
selects focused real CLI cases (`missing-cuda` requires CUDA). These are not mocks.
`git unknown` in the archive-built banner avoids claiming the application HEAD as
upstream version; the source lock is authority.

## Adaptation and regression boundaries

`HIKARU_QWEN_DEVICE=cpu|cuda` is process-scoped controlled invocation, not a product
availability switch. Outside it, ordinary upstream behavior remains.

- ASR/lazy audio/aligner share the concrete device; scheduler node assignments,
  view nodes and weight/KV buffer ownership are checked, never reassigned. CUDA
  cannot fall back to CPU. CPU VAD compute failure resets the scheduler and returns
  false before completion/conversion; existing nullptr/load-failed chain exits30.
- Local role paths validate before resolver and acquisition; no implicit download
  or replacement. UTF-8 file loaders use Windows wide paths. The worker derives
  relative audio argv from canonical path/owned cwd because upstream miniaudio
  rejects extended absolute paths. Controlled decode failure exits before alternate
  native or FFmpeg/shell fallback; no algorithm or input-media rewrite.
- The active slice dispatcher exports actual `displaySegments`, `displayFallback`
  and `vadSilence`. Non-word fallback exits41, write failure42, VAD failure30,
  device/role/acquisition failure40. Only optional diagnostic BPE tokens are omitted
  from machine output because a token can contain incomplete UTF-8; actual ASR/
  word/display text is not dropped/repaired. Offsets are ms; words t0/t1 are centiseconds.
- `check.py` compiles the actual upstream writer, runs mutation checks and the
  retained exact-source `vad_failure_check.py` (24 CPU/CUDA-mode fault/control
  cases) plus `audio_failure_check.py` (12 decode/fallback cases). They are
  model-free source regressions, not real hardware compute-fault claims.
- `validate.py` is the unshipped original CLI smoke validator; it checks whole
  JSON/UTF-8, word units, same-run text, legal positive ordered rows and device/VAD
  markers. It does not perform the later product adapter's adjacent anomaly merge.
  Product `qwen_cli.cpp` validates the entire supplied span (including raw NUL),
  then only merges approved zero-duration/decreasing-start groups using existing
  endpoints and ordered text; generic protocol validation remains unchanged.
  See `.trellis/spec/asr/qwen-cli-output.md` and `native-asr/docs/protocol-v1.md`.
- Smoke uses task mutex/inventory, suspended Job assignment before resume,
  restricted PATH, module/hash checks and bounded private diagnostics. It does
  not infer forward progress from arbitrary stderr or kill normal CPU loading
  after a fixed 120s silence. Product host owns cancellation/recovery/reap;
  physical exit and retryable private-file cleanup are distinct.
- `--hikaru-probe-cuda` executes/readbacks one GGML CUDA F32-add node under the
  existing 15s/16KiB strict Rust process/JSON boundary. It declares
  `modelExecutionProof=false`; CPU never invokes it and it does not prove ASR graphs.

Necessary ignored evidence stays under `research/local/integration-first/`
(`vad-compute-fix`, `worker-ass`, `model-delivery`, `adjacent-display-implementation`,
`final-delivery`, `repaired-final-delivery`) and sibling `cuda-publication`,
`enable-selection`, `cuda-start-ui`. Keep original failures/missing raw limitations;
no raw transcript/token/logit/private path belongs in tracked documentation.
