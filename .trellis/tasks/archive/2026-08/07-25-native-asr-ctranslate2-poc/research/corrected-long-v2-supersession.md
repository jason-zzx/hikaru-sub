# T02 Corrected Long-v2 Supersession

This supplemental handoff does not modify the archived T02 report or its historical long-v1 manifest identity `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277`.

Retained raw CTranslate2 segments were identity-validated through the archived adapter/input lock and rescored by the current shared comparator against long-v2 manifest `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea`.

| Candidate | Case | CER | Semantic gaps | Excluded vocalization gaps | Corrected result |
|---|---|---:|---:|---:|---|
| ordinary large-v3 fixed window | short-v1 | `0.3583` | 0 | 0 | fail: CER |
| ordinary large-v3 fixed window | medium-v1 | `0.1745` | 10 | 0 | fail: gaps |
| ordinary large-v3 fixed window | long-v2 | `0.2245` | 68 | 0 | fail: gaps |
| Kotoba fixed window | short-v1 | `0.3417` | 0 | 0 | pass |
| Kotoba fixed window | medium-v1 | `0.2224` | 3 | 2 | fail: semantic gaps |
| Kotoba fixed window | long-v2 | `0.2512` | 16 | 0 | fail: gaps |

Both historical candidates remain `stop-revise`. Runtime feasibility remains proven; no inference was rerun and no archived evidence was rewritten.

Authoritative correction: `.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/evidence/corrected-ct2-reassessment.json`, SHA-256 `a470ce38aeb2173b54b31f359771bc6d24836a5688ee605c0091db7681bdf99d`.
