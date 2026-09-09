# Native ASR absolute-quality requirement supersession

## Retained requirement correction

Record ID: `native-asr-quality-requirement-supersession-2026-09-03-r1`.
Disposition: `accepted-requirement-correction`.

> 我没有要求和旧版python比较质量，这是旧的迁移任务的遗留文案，我应该也说过不要比较了。只要新的native方案能够正常正确地跑通流程，并通过基本的质量门槛就可以了

Legacy Python output is diagnostic only: it cannot define Native expected text, create/repair references, establish completeness, waive an absolute gate, or decide Native pass/fail. S/D/I components and all Python deltas are non-gating.

## Current scope versus historical Qwen planning

The original Qwen unavailable/Phase-4-unauthorized state, proposed F16/reflect/grid candidate, raw-only grouping, 150/500ms timing gates and GPU-quality inheritance were **historical planning, since superseded**. Current Qwen uses the accepted upstream full CLI, recommended Q4_K pair, mandatory CPU Silero, upstream LIS/interpolation and approved bounded adjacent-display merge. CPU/CUDA functional delivery and owner application runs are accepted; no Qwen quality matrix, Python parity or inheritance label is required. See `../prd.md`, `../implement.md` and `.trellis/spec/asr/qwen-cli-output.md`.

Parakeet/Reazon and other independently scoped qualification work retain their own absolute WAV+ASS contracts in `.trellis/spec/asr/quality-guidelines.md` and the remaining-migrations parent: per-case CER <=0.35, zero semantic confirmed-speech gaps >=1500ms, legal text-conserving timelines, CUDA RTF <=0.5, short cold wall <=120s, backend RSS budget, and applicable model-specific gates. Their CPU functional/lifecycle matrix inherits only after the exact CUDA candidate qualifies; no Python-relative test is restored. This Qwen cleanup does not redesign those children.

## Original authority anchors

These hashes bind the archived predecessor requirement text, not new model execution or a relabel of its evidence.

| Authority | Role | bytes | SHA-256 |
|---|---|---:|---|
| `.trellis/tasks/archive/2026-08/07-25-native-asr-migration/design.md` | Python parity not a release gate; functional legality required | 10647 | `2bfc7c5c8723a63bf909da2db74137c52a49a2d89d37aec26bf07c72db2dbffa` |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-ctranslate2-poc/design.md` | WAV+ASS and absolute CER/performance/RSS gates | 3714 | `38bb09988d9204f92cf6b705340f78de322ad4e3a975d65ffcde924bfd3e4ff5` |
| `.trellis/tasks/archive/2026-08/07-25-native-asr-crispasr-poc/design.md` | CrispASR absolute gates; no Python-relative requirement | 5114 | `3f7377842a1a2b844fe777c301371b4cfd2a3aeec85645b4d647f55ff971665b` |

Abandoned experimental records/tools are removed under the owner's explicit cleanup scope, not promoted or rewritten as successful candidates. Existing ignored-local raw evidence and archived tasks remain untouched. Identity drift, incomplete/concurrent/terminated runs, actual invalid output and prior structured failures retain their original meaning. Current accepted Qwen functionality comes from later full-CLI evidence, not reinterpretation of those old experiments. Tracked notes retain only sanitized counts/hashes, never raw transcript/token/logit data.
