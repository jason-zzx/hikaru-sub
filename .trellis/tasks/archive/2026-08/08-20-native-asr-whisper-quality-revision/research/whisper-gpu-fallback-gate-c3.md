# Native Faster-Whisper fallback Gate C3 result

**Verdict: `clean-to-request-renewed-acquisition`; qualification ineligible.**

Final reviewed lock: `research/gpu-fallback-diagnostic-lock-v3.md`, SHA-256 `b95bdcc1e2a33ab30c2064fef70d466cd92842fedaaaed07350a1c111bcdcf29`.

## Review finding and repair

The independently reviewed v2 lock listed the complete expected module inventory, but the fallback publisher still accepted any loaded-module superset containing its required subset. Its test fixture could omit `vcomp140.dll`, and an additional frozen runtime module could be accepted. That contradicted the lock's exact-inventory claim.

Gate C3 repaired only this evidence boundary:

- fallback rows now require the exact eight-module set;
- every module name, size, SHA-256, root role and raw version string must match;
- missing, additional, identity-drifted, version-drifted or root-drifted modules are rejected;
- ordinary first-diagnostic and VAD-diagnostic validation behavior is unchanged;
- mutation coverage includes missing `vcomp140.dll`, additional `onnxruntime_providers_shared.dll`, identity drift and version drift.

Publisher SHA-256: `ece07ee742992e4315fed0635c7c56feaa1fb6e5142e912173739f647901f30c`.
Publisher tests SHA-256: `ef9e72fcdb45b8fc2f015c65906762142ece4802465bfa56820aa3708f721d8c`.

## Preserved identities

- Original invalid-preflight lock: `5fcfe845451f418a1e21fe8711ba9f367fdc2e13f8c2e02dd598683dde4e073a`.
- Gate-C3-blocked v2 lock: `823630f08ab15ed7dadf4f80f0e5a320c89e3e2171cd55b8ac86cc6463235b82`.
- Invalid-preflight JSON/Markdown: `29b8767342bb9f1ac57c630285c1481b58877c57b92c775e38f9dfb9d4b6a212` / `27054915dc39d7e2e58535e0a62dfb6fbaf55aac47caf5bd0f66017f539b2f6f`.
- v2 preparation JSON/Markdown: `5fa4f06f4caea4cb38e7bbbc36b5024b2ab5400efefdb513cd579ab2df282ac4` / `0509d242a5fb9b12988d8fb1510b4ebb53e207f1066b6bf7dd0b2b039d7dd1bb`.

The existing 51-file source/tool/runtime/model/corpus/VAD/zlib/authority re-attestation remains matched with no rebuild. No production route or candidate algorithm changed.

## Validation

- Publisher selection/mutation/privacy/determinism tests: 15/15 passed.
- Exact current loaded-module identity validation: passed.
- Superseded lock and preflight hashes: preserved.
- Trellis context validation, privacy/ignore checks, `git diff --check`, and no-staged check: passed.

## No-model boundary and next gate

No ASR model was loaded and neither `short-b5-on-vad-fallback` nor `medium-b5-on-vad-fallback` has run. No quality, performance, resource, fallback-trigger or selected-temperature metrics exist.

Gate C3 permits asking for fresh explicit acquisition approval under the exact v3 lock only. It does not itself authorize inference or formal qualification.
