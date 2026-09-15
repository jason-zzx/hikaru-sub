# Parakeet implementation plan

## Authority

Requirements, owner authorization and scope boundaries are defined in [`prd.md`](./prd.md).

Status: in_progress; implementation and acceptance review are complete, and the child remains active only for the owner-controlled commit/archive boundary. The owner approved the complete upstream Japanese pipeline (D1), later authorized dependency publication/default enablement, and confirmed the final application runs on both CPU and CUDA. PRD acceptance AC1–AC7 is satisfied; historical quality gates do not apply.

## Dependency publication / default distribution result — modelRuns=0

- Accepted preceding path/hygiene/media review; no new inference or upstream rebuild.
  Rebuilt only worker CPU/CUDA bindings through existing CMake inputs and produced
  fresh shared-v2 with unchanged hash-verified P1 CLI/DLLs and all5,496 prepared files.
- Published one new `hikaru-asr-crispasr-windows-x64-cuda-shared-v2.zip` to the existing
  `jason-zzx/hikaru-sub` / `native-asr-cuda-v1` dependency release after supervisor
  checkpoint. Asset719,774,286 bytes, SHA-256
  `23a3c4082a520d3c0e4698a229bd4767a7f5a10f2bc1c7d45235f379c5ee292d`.
  Official53.891s and China ghfast.top232.641s downloads independently matched;
  no retry/network campaign. Old two remote assets and tag are unchanged.
- Default `native-asr/runtime/crispasr-product-lock.json` now uses both-device
  Qwen+Parakeet shared-v2 and truthful publication flags. Exact old default bytes
  remain in `crispasr-product-lock-v1.json`; original CPU archive and local candidate
  remain intact. Normal source rows reference only the new CUDA bytes; CT2 rows/locks
  and model identities are unchanged. No runtime/host/readiness gate was bypassed.
- Default `pnpm release:local` (no candidate env) succeeded, including TS/Vite/Rust.
  NSIS16,295,031 bytes; portable23,359,299 bytes, within80/90MiB. Fresh extracted
  package audits verify CPU closure/notices/no weights/CUDA and19 unchanged CT2 files
  each. Downloaded official/China archives passed the existing actual Rust installer,
  full closure, bounded CUDA compute probe, readiness, both-engine authorization,
  missing/corrupt rejection, prior-ASS and synthetic device-failure isolation at
  installed-like/portable-like roots. These are not installer/UI/model-run proofs.
- New exact local app: `.local/parakeet-final/hikaru-sub.exe`,24,520,704 bytes,
  SHA-256 `ebdd55fe119ae3bdf22ab6ba055ef16affbfdceee441c194cce1ef1c1218f5c4`.
  Embedded final lock SHA-256
  `75de397e9d6f88a16d6a204db94457c6e0942b8b450d1fdfbaa689265175b19c` and LF manifest
  bytes were checked. It contains the reviewed worker/media fixes, verified CPU and
  separately installed verified CUDA, but **no preinstalled model weights**; F16 plus
  required shared CPU Silero remain normal on-demand downloads. Old
  `.local/parakeet-app` EXE remains byte-identical/pre-fix, not represented as updated.
- Fresh checks: Native CTest9/9 each (unchanged accepted real-clock watchdog evidence
  retained), Cargo301 passed/3 ignored with actual model-free CLI fixture, frontend
 893 passed, default local packaging, path-check, task validate and full diff-check.
  The first source-inventory assertion misread its dictionary as a list before writes;
  corrected assertion passed. Two shell cmd invocations were no-op prompts; retained
  logs are not builds. The real structured cmd calls succeeded. First frontend run
  found one fixture copying the old fixed CPU filename (892 passed/1 failed); changed
  it to follow lock.archive.path, then893 passed. No production/harness redesign.
- Reproduce sanitized exact evidence with
  `python -X utf8 -B .trellis/tasks/09-01-native-asr-parakeet-productization/research/dependency_publish.py --check`.
  New raw lock/logs remain ignored in `native-asr/build/full-cli/dependency-final/`.
  Earlier six host/two UI and source/media proofs retain their historical identities;
  no old hash-bound record was rewritten. Subsequent historical publisher replay must
  explicitly bind preserved source, not silently substitute after a drift failure.
- Limits: general long/expanded-relative audio, deep CLI roots and cross-volume deep
  work remain unsupported; physical inference GPU evidence is RTX3070-only. No new
  inference/UI listening/manual install/uninstall proof, app release/version/CHANGELOG,
  app upload, Git stage/history operation, archive or next-engine work. The owner later
  resumed review and confirmed the final application runs on CPU and CUDA. Independent
  final standards/safety and requirements/distribution-evidence reviews both passed with
  no findings (`6d44a394-8953-42a3-8411-9cb91bb7b1ee/parakeet/final-*-review.md`).

## Scoped path / hygiene / media follow-up — modelRuns=0

The latest independent local-app review (`17665840-044e-4e4c-b333-b24ae142a0fa/parakeet/local-app-final-review.md`) **accepted** capability gating and retained short-path CPU/CUDA UI/ASS evidence. This follow-up does not rerun or relabel those runs, the six host cases, or old generated evidence. Pre-edit source bytes/hash inventory are retained under ignored `native-asr/build/full-cli/path-hygiene-pre-edit/`.

- **Observed cwd272 startup: source fix, bounded.** Shared `full_cli.cpp` keeps ordinary private cwd; when its spelling reaches MAX_PATH it uses the already verified/pinned CLI own-root, never a writable ancestor, alias, 8.3 path or relocated portable cache. Audio remains canonical same-volume relative argv; result/cache/TEMP remain in the original host-owned workspace. Suspended Job ownership/environment/device/cleanup checks are unchanged. Real model-free portable-topology fixture goes red on the old worker and green on the new worker at ordinary cwd272 (276 extended), with real WAV/result I/O and no ancestor DLL loading. Ordinary cwd200 passes. Deep runtime and real C:/D:/ deep-work cross-volume fail structurally. Original product272 and historical model-free342/346 error267 are distinct observations.
- **Remaining path limits:** this is not arbitrary long-path support. The unchanged decoder/CRT can reject long audio or expanded relative spellings (also observed with private cwd240 plus `..`); deep CLI root or cross-volume deep-work remains unsupported. No upstream runtime/algorithm/device changes. The accepted `.local/parakeet-app` remains byte-identical and **pre-fix**; no updated worker was installed there or packaged.
- **Manifest hygiene:** only 431 CRLF sequences became LF; parsed JSON and every non-newline byte unchanged. Old SHA-256 `602bb8edcb719dec89b32cc5deb31a4f6fd829f7759089bdf2962a5d9629fa61`; new `51ea8f70a018cfa9a0f856149f0a4adf644e5789885e508ec59ea0d38c232d12`. Old embedded app/source proofs retain the old bytes, not the new whitespace identity.
- **Media root cause fixed:** retained input is genuine 320×180 Matroska, not WAV-disguised. Actual old app `get_video_info` fails `program not found` with the retained uppercase `ffmpeg.EXE` setting and System32-only PATH: peer resolution matched `.exe` case-sensitively. `peer_ffprobe_path` now compares only Windows filenames case-insensitively and preserves parent path bytes/POSIX case semantics. No healthy media decoding code changed. A separate debug app built with `tauri/custom-protocol` invokes actual commands: generated video320×180/1000ms/25fps, retained video dimensions320×180, fresh uncached PCM16 mono16kHz audio1.0026875s. Existing frontend completion tests assert both PlayRes values and serialized ASS. Retained Matroska lacks stream duration, so the existing metadata contract reports0 for that input; generated MP4 verifies duration.
- **Verification:** new isolated Native build/CTest10/10; explicit second-volume path check12 cases; full Cargo301 passed/3 ignored with actual model-free CLI fixture; pnpm893 tests and build; diff-check. Logs are `path-ctest-final-r2.log`, `path-green-r3.log`, `path-cargo-full.log`, `path-pnpm-test.log`, `path-pnpm-build.log` and `media-check[-fixed]/` under ignored full-CLI scratch. CPU/CUDA test labels are synthetic, not fresh execution-device proof. A windowless Wry unit-test experiment failed at loader startup and was removed; actual app commands provided the successful media proof instead. No inference, upstream rebuild, package campaign, release decision or Git staging/history action. Independent scoped review passed with no blocking finding (`db07d83e-a4ff-4ea1-a1f8-fd785b090830/parakeet/path-hygiene-media-review.md`).

## Historical local-candidate evidence

Pre-fix candidate app, CPU/CUDA UI/ASS runs, package identities and historical harness dispositions remain reproducible through `research/local-app-evidence.json` and `research/local_app_publish.py`. Their former open items are superseded by the reviewed path/media fixes and published shared-v2 result above; original evidence is not relabeled.

## P0 — Converge planning

- [x] Record owner-approved functional-only scope in child and parent.
- [x] Inspect fixed upstream CLI and current product seams; record `research/planning-evidence.md`.
- [x] Draft technical design and ordered implementation/validation plan.
- [x] Resolve D1: owner approved complete upstream Japanese pipeline with required existing CPU Silero and upstream actual-audio gap retranscription; child PRD and parent VAD/gap-fill exceptions synchronized narrowly, without changing ReazonSpeech/general VAD scope.
- [x] Converge PRD top-to-bottom against final approved structure; review PRD/design/implement and curated contexts for D1, functional-only scope and parent compatibility. This is the planning author's consistency pass, not independent implementation review.
- [x] Owner explicitly approved implementation with 开始实现; `task.py validate` passed and `task.py start` activated this child without empty-context bypass. No commit/publication authority. Start warned that task branch equals base_branch; resolve branch metadata before archive, not by unauthorized Git history operations.

## P1 — Freeze acquisition and first CPU/CUDA proof (AC1, AC3, AC4)

- [x] Load ASR/Tauri/frontend applicable specs; honor this task's functional-only exception to historical quality scenarios.
- [x] Before code adaptations and first smoke, complete direct tracing of the pinned slice resolver, native device dispatch and JSON/display writer; bind exact argv and assertion sites. See `research/p1-source-trace.md`.
- [x] Freeze compatible F16 model acquisition metadata at a concrete revision, CC-BY-4.0 attribution, bytes/hash/format and actual known conversion provenance. `research/p1-acquisition-lock.json` binds revision `d9e3ba65a6579796389ea89e5939509ed257f972`, the verified 1,246,932,800-byte F16 artifact and unchanged mandatory CPU Silero. Actual GGUF contains 967 tensors (303 F16 / 664 F32); missing converter commit is explicitly not invented.
- [x] Extend the existing complete pinned upstream build only with necessary controlled path/offline/device/output adaptations. Both full CPU/CUDA targets built through existing scripts, without source/architecture trimming or a per-model runtime pack. Initial CUDA compiler command hit its 1800s tooling deadline; preserved evidence and an explicitly authorized same-config incremental retry completed. No model call was killed and no published identity was changed.
- [x] Run serial real short CPU then CUDA CLI smoke with exact runtime/model/argv/environment hashes, full own-root module inventory and execution proof. Original r3 results remain retained. After accepted review fixes R1–R3, current r4 harness: CPU 9.344s / CUDA 2.531s, 9 legal display rows each; Qwen shared-candidate CPU/CUDA short regressions 14.281s / 16.093s, 8 display rows each. CUDA proves actual Parakeet encoder/predictor/joint execution, not just Qwen markers or DLL loading. Intrinsic upstream CPU host projection/state/argmax and required CPU VAD are explicitly distinguished from graph fallback.
- [x] Investigate failures through actual invocation/device/process evidence. Original CPU output was valid but its harness failed a case-sensitive Windows module-path comparison; original failed row remains failed, and a new hash-bound run replaced it as evidence. Runner cleanup/recovery/CRLF-progress hardening received fresh CPU/CUDA reruns; independent review then identified the three R1–R3 defects, now corrected with new source/process/text regressions and fresh r4 device runs. Independent re-review resolved R1/R2/R3 with no blocking finding; parent accepted this P1 gate after rerunning `p1_publish.py --check` and `git diff --check`. No algorithm change, model/decoder switch or quality scoring occurred.

P1 milestone only: generated `research/p1-evidence.json` is reproducible with `research/p1_publish.py --check`; raw outputs, exact runtime locks, source trees and full logs remain ignored under `native-asr/build/full-cli/`. Thirteen actual short CLI calls are retained: seven Parakeet calls (one original harness failure, four earlier successes, two current r4 successes), six Qwen compatibility calls (four earlier, two current r4). Exact-source output/device/watchdog mutations, 24 audio fallback cases and 24 VAD fault/control cases passed. R4 adds 24 exact-encoder allocation/control/guard-removed cases, strict consumed-text/source-time mutations and six model-free external-exit/interrupted-owner/live-owner scenarios across both bindings (each rejects six identity drifts, a late sentinel and two wrong completion attempts). Earlier Native compatibility CTest suites passed 7/7 and 8/8; they are retained evidence, not newly rebuilt P1 worker proof. Original r3 source/tools/runtime/evidence are frozen under `p1-r3-preserved/`. The malformed new test launcher/log and partial diff remain retained; supervisor-approved correction from the original launcher bytes passed. No ASR inference was killed; recovery process faults used owned Python fixtures only. No worker/host/ASS delivery or production availability is claimed; P2–P4 remain pending. P1 independent re-review is complete (workflow `4d435405-429c-4384-95a9-908b72a5caea`, reviewer `0dc18cb9-4412-471a-990d-3deb7df0e57b`, artifact `parakeet/p1-recheck-r1-r3.md`). Non-blocking follow-up: `recovery_check.py` permits generic OSError in its live-owner assertion; retained runs prove the exact durable-owner branch, but tighten that fixture when next modifying it. Suspended create-to-Job-assignment crash residue blocks through preflight inventory rather than guessed cleanup. Neither fault fixtures nor normal short runs establish actual model OOM/terminated-CUDA recovery.

## P2 — Worker/host/ASS integration (AC2–AC4)

Owner resumed the previously paused task and directed removal of optional observer gating (design §7). Do not continue repairing continuous process/DLL sampling or replace it with another mandatory monitor. Preserve prior attempts exactly; extract CPU functional/ASS/reap facts separately from historical harness errors. Complete missing actual CUDA host proof, then proceed to P3/P4 using existing runtime/worker safety and lifecycle checks. No automatic invalidation/rerun of successful inference solely for diagnostic-code changes.

- [x] Removed optional P2 observer calls and acceptance gates. No replacement monitor; unchanged r4 runtime proof, pinned worker assertions, serial mutex, owned reap and durable CUDA recovery remain required.

- [x] Explicit Parakeet full-CLI dispatch, model+vad roles, shared process/path/Job/result plumbing and independent strict parser are implemented; Qwen-specific merge remains isolated.
- [x] Rust role checks/private workspace/data handoff and Native protocol validation agree; no new job/cancel command.
- [x] Machine output retains actual upstream display grouping and validates strict bytes/units/backend/completion and legal time/text before atomic replacement.
- [x] Native contract and host fixture regressions cover route/roles, argv/device isolation, Unicode/reparse paths, missing files, strict output failures, truthful silence and prior ASS preservation. Current CPU/CUDA CTest passed 9/9 each; full Cargo exercised the fixture worker explicitly.
- [x] Real CPU/CUDA cancel, cleanup retry and subsequent short recovery passed. First CUDA cancel attempt in the old test failed because it unwrapped a truthful transient private-result cleanup error. That failed record remains unchanged; the updated test follows the existing Qwen bounded cleanup-retry contract, records the first error, confirms physical reap/gate release, then confirms deletion. No production cleanup behavior was changed.

## P3 — Managed model and UI delivery (AC5, AC7)

- [x] Trusted manifest contains exact F16 file/source/revision/size/SHA and CC-BY-4.0 attribution/modification notice. Existing compound download/staging/repair/readiness includes the identical shared Silero; manifest rejects mismatched shared VAD references.
- [x] URL derivation, partial resume, corrupt repair, atomic readiness, offline reuse and shared cleanup tests pass. Real managed runs seed verified complete partials and invoke the actual offline downloader/publication path; HTTP interruption/range tests use synthetic bytes, not a new remote 1.25GB download.
- [x] Existing frontend constants/settings/availability/download/start/status flows handle Parakeet; targeted UI tests prove the exact model and both device payloads. Later build-capability-gated local app work and real UI proofs are recorded above; default published Qwen-only builds still reject Parakeet. No test-only availability toggle, new API or quantization/language/VAD-device controls.

## P4 — Final functional and compatibility matrix (AC2–AC7)

- [x] Local exact worker/model CPU/CUDA short-v1/medium-v1/long-v2 manager→host→worker→CLI→ASS matrix passed: CPU 9/99/630 cues, CUDA 9/99/630 cues. These are final local worker identities, not new packaged runtime acceptance. Strict output/text/timeline and exact ASS rows passed without repair/scoring. Hash-bound evidence: `research/product-evidence.json`.
- [x] Retained P4/packaged-verifier scope covers both-device silence, invalid audio/model/VAD, cancellation, matching recovery, offline readiness and owned cleanup with prior ASS preservation. Missing/corrupt runtime and synthetic device isolation are file/verifier tests, not additional end-to-end ASR failures. The later deep-path app start failure remains open separately above.
- [x] `research/product_publish.py --check` deterministically reproduces sanitized `product-evidence.json` from the frozen ignored-local evidence lock. Original CPU observer failures retain historical runner disposition separately from usable completed ASS/reap facts; the interrupted CPU run and failed old CUDA cancel remain failures.
- [x] Rechecked Qwen compatibility and CT2/Kotoba route isolation for the final shared distribution: retained unchanged P1 Qwen CPU/CUDA inference evidence was not relabeled or rerun, while rebuilt worker bindings, exact runtime closure/licenses, source rows, downloaded installation/readiness/probe, and installed/portable package contents passed targeted model-free checks.
- [x] Shared local runtime and later local app packaging completed; identities and limits are recorded above/below. Published Qwen-only authority remains immutable and rejects Parakeet; the exact local candidate permits verified installed use but is unpublished/unoffered for CUDA download. No upload or false download-readiness claim.
- [x] Final diff and AC coverage received independent standards/safety and requirements/distribution-evidence reviews with no findings. Applicable specs/docs identify RTX 3070 as the sole physically verified GPU; the owner separately confirmed final CPU/CUDA application execution. No automated quality claim was added.

## Retained functional evidence

- `research/product-evidence.json` plus `product_publish.py` bind the six CPU/CUDA short/medium/long host→ASS runs (9/99/630 cues per device), negative cases, cancellation, recovery and cleanup without quality scoring.
- `research/fixes-evidence.json` plus `fixes_publish.py` bind the Parakeet-only watchdog, output-fidelity, silence-preservation and shared candidate package fixes; `shared-local-candidate-lock.json` preserves that historical package identity.
- `research/local-app-evidence.json` plus `local_app_publish.py` bind the retained real CPU/CUDA UI selections and ASS saves. Historical publishers require their explicit preserved source roots; they must never silently substitute current files after identity drift.

## Validation commands

Run commands only in their applicable phase, after implementation authorization. Exact new Native test target names and real-run commands must be recorded when introduced; existing Qwen smoke arguments are not a Parakeet harness.

```bash
python ./.trellis/scripts/task.py validate 09-01-native-asr-parakeet-productization
git diff --check
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
python -B native-asr/runtime/full-cli/path_check.py
python -X utf8 -B .trellis/tasks/09-01-native-asr-parakeet-productization/research/local_app_publish.py --check
```

Also run targeted Native CTest against the actual CPU/CUDA build directories, existing full-CLI source/fault checks with the required explicit source/output inputs, and the task's serial model-backed harness. Record exact commands, build identity, exit status and actual results; compilation/mocks are not device evidence. Local `pnpm release:local` is a packaging check only, not publication authorization. Missing required environment/toolchain/network/device verification is a blocker or explicit limitation, not a passed check. Optional module/process diagnostic gaps are reported separately and do not block functional integration or invalidate successful product outcomes. Check only affected behavior; do not make observer-only edits trigger full inference reruns.

## Rollback points and completion

- After P1: incompatible model/runtime stays local and unavailable; return to planning without deleting existing artifacts.
- After P2/P3: disable only Parakeet; do not roll back Qwen/CT2 or restore Python.
- After shared-runtime changes: preserve old artifacts/locks for rollback, never mutate already published identities.
- After P4: final AC review and owner confirmation; do not archive while tests/delivery are failing or partial. No commit/push/merge/reset, version changes, uploads or release decisions are authorized. Complete/archive before proceeding to ReazonSpeech.
