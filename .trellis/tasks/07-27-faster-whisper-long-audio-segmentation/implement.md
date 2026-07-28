# Implementation Plan

## 0. Constraints

- Scope A remains approved: project-owned faster-whisper generation-loop fork.
- Implement only the validated Japanese `large-v2 >= 10min` long path.
- Fix CTranslate2 random seed `0` immediately before long model load; expose no
  user setting.
- Keep short audio and Kotoba on their existing upstream paths; neither path may
  request fixed CTranslate2 seed `0`. After a seeded long session, restore a
  fresh nonzero random seed before the shared Whisper-family lock is released.
- Narrow only default ordinary short Japanese `large-v2` non-CPU compute to
  `int8_float16`; keep CPU `int8`, explicit compute, other languages/models,
  long mode, and Kotoba unchanged.
- Do not commit, push, merge, rebase, or reset without separate explicit user
  authorization.
- Keep private corpora, generated subtitles, model weights, absolute local paths,
  and raw diagnostic text outside git.

## 1. Rebase Tests To The Accepted Contract

1. Replace obsolete all-audio fork expectations with routing fixtures for:
   - source duration 599999/600000ms;
   - Japanese/non-Japanese;
   - `large-v2`/other model;
   - ordinary/Kotoba engine.
2. Keep extension-disabled parity fixtures for upstream yielded segments,
   prompts, decode calls, seek progression, and word-timestamp refinement.
3. Add long prompt fixtures for carried blend plus punctuation tokens, budget
   reservation, every-window carry, no-end reset, punctuation non-reset,
   temperature reset, and empty windows.
4. Assert short mode uses upstream `WhisperModel`, V6 direct VAD, no carried
   prompt, no global word timestamps, and no long RNG seed.
5. Cover default target `None`/`auto`/`default` compute, explicit override, CPU,
   non-Japanese, other-model, Kotoba, and public `load()` then transcribe reload
   behavior.
6. Assert long mode uses the fork, aligned words, timestamp-token seek, and the
   long compute resolver.

Red gate: run focused generation/segmentation/Kotoba tests before implementation.

## 2. Add Managed Silero V4 Support

1. Add a focused sidecar module for:
   - official/China pinned URLs;
   - managed `HF_HOME` cache path;
   - streaming download, SHA-256 verification, and atomic replacement;
   - model-readiness validation;
   - ONNX session/state inference with 1536-sample windows;
   - deterministic V4 speech timestamp state machine.
2. Do not add the ONNX or temporary download to git/resources.
3. Extend ordinary `large-v2` readiness/download to include the V4 asset through
   the existing model confirmation flow.
4. Keep custom VAD values session-only and map them onto the V4 defaults.
5. Add Silero VAD MIT/provenance to `THIRD_PARTY_NOTICES.md` and sidecar README.

Rollback point: stop if the official V4 helper cannot reproduce the documented
17 full-corpus chunk boundaries or model downloads cannot remain inside the
managed cache.

## 3. Implement Long/Short Routing

1. Read source WAV duration with the existing `_duration_ms` helper before
   ordinary model load.
2. Select long mode only for Japanese ordinary `large-v2` at or above 600000ms.
3. Short mode:
   - construct upstream `WhisperModel` and retain the V6 direct path;
   - for ordinary Japanese `large-v2` only, when compute type is
     unset/`auto`/`default`, resolve effective non-CPU to `int8_float16` and CPU
     to `int8`;
   - honor explicit compute and retain the existing resolver for non-Japanese,
     other models, and Kotoba;
   - if public `load()` preloaded a mismatched generic model, release it before
     one targeted reload and reuse the matching model thereafter;
   - if auto-device GPU warmup fails, clear the failed model and traceback-held
     references before constructing CPU fallback;
   - retain previous text, no fork prompt, and no word timestamps.
4. Long mode:
   - call `ctranslate2.set_random_seed(0)` immediately before constructing the
     forked model, matching the formally validated timing;
   - construct the forked model;
   - resolve CUDA/auto to `int8_float16`, CPU fallback to `int8`;
   - decode audio once, run V4 once, collect/concatenate chunks once;
   - call `transcribe` once with built-in VAD disabled;
   - restore segment/word timestamps once.
5. Pin `ctranslate2==4.8.0` and keep `faster-whisper==1.2.1`.
6. Keep one model instance per job and preserve clear load/fallback errors.
7. Serialize only `faster-whisper` and `kotoba-faster-whisper` jobs with one
   process-wide inference lock covering handle creation through complete lazy
   iteration/close; leave all other engines concurrent.
8. On seeded long success, cancellation/close, handle error, or lazy error,
   replace seed `0` with a fresh system-random nonzero seed before unlock. This
   restores nondeterministic short/Kotoba fallback rather than seeding those
   paths with `0`.

## 4. Finalize Fork Prompt State

1. Retain the mechanically comparable upstream 1.2.1 loop and attribution.
2. Long mode carries the generic blend prompt plus punctuation seed in every
   window within the existing half-context budget.
3. Keep the exact grouped-window no-end reset contract.
4. Keep production word-end seek refinement disabled while returning aligned
   words.
5. Leave extension-disabled parity mode and multilingual language switching
   covered.
6. Add focused red/green coverage proving seed `0` is set before long model load,
   reset before unlock on every terminal path, and never requested by short mode
   or Kotoba.

## 5. Enforce Timestamp Invariants

1. Retain the existing source-word 30-second hard-hole helper and text-preserving
   fallback.
2. Apply source/previous/next bounds to every emitted event, not only hard-hole
   replacements.
3. Preserve one-segment lookahead and streaming.
4. Raise a clear `AsrError` if a positive non-overlapping interval cannot be
   preserved; never silently emit invalid bounds or drop text.
5. Cover the measured ordinary-overlap shape and malformed nonpositive cases.

## 6. Synchronize And Run Local Gates

Synchronize all behavioral sidecar files and dependency manifests to
`src-tauri/resources/asr-service/`.

```bash
cd asr-service
python -m unittest discover -s tests -p 'test_faster_whisper*.py'
python -m unittest discover -s tests -p 'test_jobs.py'
python -m unittest discover -s tests -p 'test_kotoba_faster_whisper.py'
python -m unittest discover tests
python -m py_compile jobs.py engines/faster_whisper.py engines/faster_whisper_model.py engines/silero_v4.py engines/whisper_runtime.py
```

Also run:

- packaged-copy byte comparisons;
- `git diff --check`;
- Trellis manifest validation;
- privacy scan for private paths/text and model binaries;
- source test confirming no ONNX/model weight is tracked.

## 7. Formal Private-Corpus Gate

Use only external temporary outputs.

1. Confirm the feedback command still fails the historical ASS and describes the
   original XXL baseline.
2. Run the production engine on the complete 69-minute source, not a truncated
   WAV proxy.
3. Report every ten-minute window, pre/post metrics, P10/P90, over-15/20/30 rates,
   boundary coverage, and representative semantic samples.
4. Confirm all six known transition gaps have zero spanning events.
5. Confirm zero invalid timestamps and zero adjacent overlaps after production
   bounding.
6. Compare normalized text with historical ASS, original XXL SRT, and same-PCM
   XXL control; separate decode differences from hard-hole changes.
7. Run the 498.872-second verified source and prove it selects short mode, does
   not download/run V4, and does not regress text or boundary distribution.
8. Delete temporary WAV/SRT/JSON/log/model-extraction artifacts after recording
   sanitized aggregate evidence.

Acceptance target selected by formal validation:

- repeated 20-minute outputs are byte-identical with CTranslate2 seed `0`;
- long output near 456 cues;
- every ten-minute median duration is within the validated `4.37-8.48s` range
  and tiny rate <=11%;
- no cue over 30s and over-15s rate <=4.26%;
- post/pre duration >=0.70, characters >=0.65, tiny delta <=11pp;
- short verified-text similarity >= historical 88.7440%.

The remaining short gate is satisfied from already completed sanitized evidence:
CUDA `float16` scored `88.1201%`, `float16` plus seed `0` scored `88.3077%`, and
independent upstream/V6/no-prompt/no-V4 `int8_float16` runs scored `90.3198%`
(203 cues), `89.5172%` (197 cues), and `90.5578%` (202 cues). Do not rerun private
inference for the implementation-only compute-selection correction.

## 8. Review Gate

1. Dispatch `trellis-check` against PRD/design, implementation, tests, license,
   managed asset behavior, and sanitized full-corpus report.
2. Fix all critical/high findings and re-run affected gates.
3. Update the ASR spec only after full validation passes.
4. Keep the task in progress and do not commit without explicit user instruction.
