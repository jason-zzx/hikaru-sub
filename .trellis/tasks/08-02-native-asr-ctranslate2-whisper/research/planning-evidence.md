# T06 Planning Evidence

## T02 Findings To Carry Forward

- CTranslate2 4.8.0 + oneDNN 3.1.1 Windows x64 CPU int8 is executable without Python/CUDA.
- T02 final matrix used one immutable executable/DLL/input-lock identity and legal token-derived timelines.
- CPU RTF/RSS were within frozen gates.
- The fixed-window candidate failed product quality: large-v3 short CER 0.3583; large-v3 medium/long had 10/71 confirmed gaps. Backend viability and algorithm qualification are separate.
- Source seek duration and padded 30-second model timestamp range are distinct; verified WAV-end bounds require raw provenance.
- Kotoba belongs to renumbered T08 even though T02 measured it; T07 is now the earlier development CTranslate2 CUDA seam.

## Current Product Facts

- `src/constants/asr.ts` exposes ordinary models: tiny, base, small, medium, large-v2, large-v3, large-v3-turbo.
- large-v3 is the current default.
- Current Python large-v2 Japanese >=600000ms path uses a private/forked V4/seed/session design. It remains a mandatory regression case but not implementation authority.
- T01 frozen gates are per model/case: CER <=0.35, CPU inference RTF <=1.0, short cold <=120s, CT2 RSS <=6 GiB, zero invalid/out-of-bounds timeline, zero confirmed gaps >=1500ms.
- Corpus-wide positive coverage still lacks low-volume.

## User Decisions

- large-v3 and large-v2 long-audio are hard native promotion gates.
- Every current model must be measured and classified.
- Failure of another non-default model does not block a qualified native faster-whisper route.
- T17 must still display all model identities. Qualification controls runnable/disabled status and explanation; release never silently falls back to Python.
- Ordinary faster-whisper is mandatory. T06 must diagnose CPU RTF before closure; a proven CPU ceiling moves development execution to T07 CUDA, while formal publication still waits for T14/T15.

## Algorithm Planning Decisions

- Candidate A qualification remains provisional, but the same-binary warmed 120s CPU matrix has completed the RTF attribution gate.
- Measured RTF is A fixed/no-history/beam5 `0.842`, B timestamp/no-history/beam5 `0.916`, C timestamp/full-history/beam5 `1.321`, D timestamp/full-history/beam1 `0.988`. A/B reject an inherent CT2 CPU ceiling on this machine; B→C confirms full-history prefill as the dominant regression factor, while C→D shows beam 5 materially increases total cost in the full-history configuration. The four cells do not separately prove a beam/history interaction, and D's higher generated-token/overlap totals keep it non-qualification. These diagnostic rows are not qualification evidence.
- The bounded same-binary short-v1 decode selection changed only beam size with timestamp-driven seek/history off. Beam 1 passed CER/RTF/timeline/gap at `0.2667/0.632/0/0`; beam 5 reproduced the `0.3583` CER failure at RTF `0.811`. Beam 1 was selected, and beam 3/10 were not run because expansion was unnecessary.
- A separate `selected-cpu-candidate-lock.md` freezes timestamp-driven/no-history/beam 1 and final rebuilt runtime identities. Independent review fixed diagnostic-default drift and hardened canonical containment plus manifest/raw/runtime/tool identity validation before replacing the selected rows. The revised-lock large-v3 short rerun passes with CER `0.2667`, warm RTF median `0.623`, cold wall `28.342s`, RSS `3.43 GB`, 0 timeline/gap; medium passes with CER `0.1134`, RTF `0.559`, RSS `3.43 GB`, 0 timeline/gap. The accepted next gate then completed long-v1 under the same lock/runtime: CER `0.2653`, RTF `0.550`, RSS `3.43 GB`, and 0 timeline errors pass, but 7 confirmed gaps `>=1500ms` fail the hard gate. The selected CPU candidate is `stop-revise`; no large-v2, other-model, full-matrix, or GPU run started.
- The mandatory Candidate B implementation is now complete under the sole Microsoft ONNX Runtime 1.28.0 official Windows x64 CPU executor (`da9b5e3...`, archive `abef733d...`, C API 28), exact faster-whisper V6 asset `4cbf549b...`, and last-review replacement final lock `e687ead6...` / config `75dedb49...`. Direct-session CTest covers schema, probability, recurrent carry, intervals, restoration and fail-closed errors; final evidence additionally binds the actual Ryzen 7 5800X CPU, restricted PATH policy `439a41...`, canonical roots `77f4714a...`, module layout `a650e185...`, and loaded runner/CT2/tokenizer/ORT/VCOMP identities. No Python, custom ops, fallback or protocol change was added.
- Candidate B retained the exact ordinary faster-whisper 1.2.1 V6 behavior: PCM16 `/32768.0`, 512/64 row/context, recurrent h/c across 10,000-row ORT calls, threshold `0.5`, negative threshold `0.35`, min speech `0ms`, infinite max speech, min silence `2000ms`, pad `400ms`, source-ordered silence compression and cumulative-silence timestamp restoration. The canonical C++ raw config serializes exactly `0.35`; the adapter uses the same integer sample/half-even 10ms restoration semantics and keeps strict identity equality.
- Authoritative replacement large-v3 short 1 cold + 3 warm passes all applicable gates: CER `0.2667`, warm RTF median `0.654`, cold wall `29.544s`, RSS `3.44 GB`, 0 timeline/gap. Replacement medium 1 measured passes CER `0.1055`, RTF `0.599`, RSS `3.44 GB`, timeline 0 and subtitle-scale/provenance gates, but has 1 confirmed gap `>=1500ms`. Strict adapter/publisher validation and the 21-case mutation matrix, including correlated all-module/all-root rewriting, pass. Candidate B is therefore `stop-revise`; long-v1 and all other models were not run, route remains disabled, T07 remains inactive, and ORT/VAD is not accepted for T13 packaging.
- Upstream Silero `v6.0` commit `fba061d...` and MIT LICENSE remain pinned for attribution. Its three immutable tag ONNX files differ in bytes/hash/schema from faster-whisper asset `4cbf549b...`; they do not replace the selected model.
- Promote only T02 primitives proven independently: WAV/mel/tokenizer/load/timestamp/provenance.
- Replace unconditional fixed non-overlap seek with one pinned authoritative timestamp-driven candidate.
- Stop if Candidate A passes; only then, if gaps remain, evaluate one pre-pinned maintained VAD/chunk candidate.
- Do not add multiple corpus-specific repair passes, reference-derived splits, synthetic timestamps or Python private-fork parity.
- Freeze one selected algorithm/config before running the seven-model matrix.
- Python large-v3 CPU reference diagnostics were rerun on the same T01 manifest using the development interpreter and application HF_HOME. The deterministic report is `research/python-large-v3-reference-report.md`; it is non-gating. Python short is CER `0.358`, warm inference RTF `0.886`, 1 timeline error and 0 gaps; medium is CER `0.099`, 1 timeline error and 1 gap; long is CER `0.295`, 0 timeline errors and 1 gap, with medium/long published RTF reported as cold total RTF. Candidate A remains the native CPU baseline because it is stronger on short/medium absolute gates and native inference cost, while its long seven-gap issue remains a separate unresolved quality blocker.

## Final T04/T05 Handoff

- T04 code `96077103e0c3070894b70ffa9fcd888bcc93075d` finalized `native-asr/docs/protocol-v1.md`, canonical `protocol-v1-limits.json`, offline nlohmann provenance, `windows-x64-release`, fake-worker scenarios and discovery.
- T05 code `74d1a4e` plus archive `a18509a` added `src-tauri/src/asr_worker.rs`, shared active gate/process-tree cleanup, recovery/terminal reducer and debug-only host injection while Release/default remains Python legacy.
- Reusable Rust API is `NativeAsrHost::new(executable, worker_args, active_gate)` plus `ResolvedNativeLaunch::resolve(...)`; production worker uses an empty worker-args vector, unlike the fake `--scenario` path.
- `ResolvedNativeLaunch` requires the audio to live in a managed workspace, so T06's focused host test copies the selected authoritative WAV into a temporary managed workspace and injects a locked canonical CT2 model path.
- T06 test-only host variables are `HIKARU_ASR_PRODUCTION_WORKER`, `HIKARU_ASR_CT2_MODEL_PATH`, and `HIKARU_ASR_CT2_AUDIO_PATH`; no Release/product route reads them.
- The durable Tauri host contract is recorded in `.trellis/spec/tauri/media-ffmpeg-asr.md`; T06 does not create a second reducer, recovery format or process lifecycle.

## Start-Gate Lockability Result

- Candidate A pins OpenAI Whisper `transcribe.py` at `25639fc...` and faster-whisper v1.2.1 at `65882eee...`, both MIT.
- The only conditional Candidate B remains faster-whisper v1.2.1 Silero V6 (`vad.py` + `silero_vad_v6.onnx`, asset SHA-256 `4cbf549b...`). Its required separate planning lock is now complete: official ORT 1.28.0 CPU is the sole executor, direct session only, with fixed algorithm/attribution/preflight/conditional packaging and no fallback.
- All seven ordinary model repositories are public/ungated/MIT with immutable revisions and LFS model-weight SHA-256 values recorded in `start-gate-lock.md`.
- Base/small/medium/large-v2/large-v3/large-v3-turbo are cached at the pinned revisions. Tiny is not cached but is pinned and remotely lockable; this affects immediate run readiness, not task start.
- A generic active/archive `.gitignore` rule protects T06 `research/local/` before any raw/model/build output is created.

## Task Boundaries

- T04 owns protocol and test-only fake worker; T05 owns host/cancel/recovery; T06 creates the production `hikaru-asr-worker`, CPU diagnosis and device decision.
- T07 owns ignored-local development CTranslate2 CUDA execution only; T08 owns Kotoba/cache compatibility.
- T12 owns model manifest/download/readiness.
- T13 owns the reproducible CPU packaging pipeline/provisional artifact; it adds Candidate B ORT/VAD only if large-v3 short/medium/long retains the candidate. T18 owns final rebuild, attestation and release identity.
- T14/T15 own formal CUDA/Vulkan packs and accelerated qualification.
- T16/T17 own qualification metadata persistence and all-model-visible UI.

T06 manifests consume the final tracked T04 protocol/limits, durable T05 Tauri spec and archived T05 planning evidence. Candidate B implementation/final identity and deterministic short/medium publication are complete, but its single medium confirmed gap makes it `stop-revise`; no long, other-model, T07, GPU, package or routing work followed.
