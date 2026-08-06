# T06 Corrected Long-v2 Supersession

This supplemental handoff preserves all archived T06 reports as historical long-v1 results. It does not rewrite the selected Candidate A or Candidate B evidence identities.

Retained raw segments were revalidated through their archived locks/adapters and rescored by the current shared comparator against long-v2 manifest `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea`.

## Selected Candidate A

| Case | CER | CPU RTF | Semantic gaps | Timeline errors | Corrected result |
|---|---:|---:|---:|---:|---|
| short-v1 | `0.2667` | `0.623` | 0 | 0 | pass |
| medium-v1 | `0.1134` | `0.559` | 0 | 0 | pass |
| long-v2 | `0.1509` | `0.550` | 0 | 0 | pass |

Selected Candidate A now passes the corrected large-v3 short/medium/long-v2 gate. This unlocks a separate future ordinary seven-model qualification matrix; it does not enable production routing by itself.

## Candidate B

Candidate B short passes. Candidate B medium has CER `0.1055`, zero semantic gaps, one excluded standalone-vocalization gap, and zero timeline errors. Because selected Candidate A passes the corrected large-v3 gate, Candidate B is diagnostic-only: long was not run, and ORT/VAD remains excluded from package inputs.

Authoritative correction: `.trellis/tasks/08-05-native-asr-kotoba-compatibility/research/evidence/corrected-ct2-reassessment.json`, SHA-256 `a470ce38aeb2173b54b31f359771bc6d24836a5688ee605c0091db7681bdf99d`.
