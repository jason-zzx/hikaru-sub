# Ordinary Faster-Whisper quality revision handoff

## Final disposition

`stop-revise / non-qualified`

This task closes without an accepted ordinary Faster-Whisper native candidate. Production/default remains Python legacy. No formal large-v3/large-v2 six-row candidate matrix or CPU `inherited-from-gpu` metadata exists.

## Valid model-backed conclusions

- Gate A beam/history diagnostic: `no-candidate-selected` (`whisper-gpu-diagnostic.json` SHA-256 `49e6add03a2630298df3b673a0ddfb3c0b0ad1ee65a822df62ef482b2fb5177f`).
- Exact Silero V6 diagnostic: `no-candidate-selected` (`whisper-gpu-vad-diagnostic.json` SHA-256 `890453f440418d4c418e7916fcbe52b8ea9db2c85f48ef79b7d1b30bc372ecbc`).
- Exact upstream fallback diagnostic: `no-candidate-selected` (`whisper-gpu-fallback-diagnostic.json` SHA-256 `66dfb00ee41599f78dc3cdf2c757d0946a922988e62bcc016b5d7c674c345f7c`). Fallback did not trigger on mandatory short-v1 and triggered but regressed medium-v1.

These results remain valid because they used the normal model-backed backend, which reads the loaded model feature contract.

## Invalid parity investigation

Phase 3D produced no feature/runtime/parser attribution. Its frozen large-v3 feature authority used `80 × 3000` Mel tensors, while the exact large-v3 model exposes `128` Mel bins. V5 therefore stopped after successful model construction and before encode/generate. The v1-v5 locks, VAD artifacts and invalid records remain historical fail-closed provenance only; none may be promoted or repaired in place.

The source-only `80 × 3000` Python/native Mel comparison in `next-candidate-causal-audit.md` is not model-valid for this large-v3 snapshot and cannot support a future candidate.

## Product and roadmap impact

- Ordinary native Faster-Whisper remains disabled and mandatory-route qualification remains unresolved.
- Other Whisper models remain locked behind the large-v2/large-v3 anchor gate.
- T14/T15 have no accepted ordinary Faster-Whisper algorithm input from this task.
- Python legacy remains the production/default route.
- No production route, protocol, frontend, packaging or CPU qualification claim changed.

## Follow-up boundary

Any further investigation belongs to a separate bounded execution-parity discovery task, not another lock revision in this task. That task must:

1. separate unscored model-backed discovery from frozen acquisition/qualification;
2. derive feature shape from the exact loaded model (`large-v3 = 128` Mel), never a model-independent default;
3. run A/D reproduction anchors before optional B/C crossover cells;
4. allow at most one harness correction and one later short/medium quality candidate;
5. terminate as `baseline-runtime-unresolved`, `native-harness-unresolved`, `feature-runtime-interaction` or `stop-revise` when the corresponding gate fails;
6. create qualification locks only after a causal candidate already exists.

No commit or archive authorization is implied by this handoff beyond the user's explicit task-closure decision.