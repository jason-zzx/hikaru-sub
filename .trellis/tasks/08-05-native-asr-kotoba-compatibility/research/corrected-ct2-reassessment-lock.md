# Corrected CTranslate2 Reassessment Lock

## Boundary

This lock freezes deterministic re-scoring only. No inference is rerun, Candidate B long is not run, archived T01/T02/T06 reports remain unchanged, and Release/default routing remains Python legacy.

Private raw evidence, original-adapter copies, the historical manifest snapshot, and adapted results stay below ignored `research/local/` roots.

## Manifest And Comparator

| Input | Bytes | SHA-256 |
|---|---:|---|
| historical long-v1 manifest snapshot | 2,865 | `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277` |
| current long-v2 manifest | 2,868 | `3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea` |
| shared comparator `scripts/asr-benchmark.py` | 101,313 | `b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822` |
| corrected reassessment publisher | 27,409 | `ba2c6d4d07e5cdd23aaa4a12b49e832e4857c93b997e791e9657f42745c5c489` |
| corrected reassessment test | 2,871 | `8c5687c80357a4601e1eb881dba646346b4f741f44449bd566f57b68a804b617` |
| corrected K1 adapter | 28,101 | `6b3be440fa2c9d169eab6d86e9b5c208461b02c671e2102e1dcfa7c85a5adb32` |
| corrected K1 publisher | 12,782 | `cb9265667491d4329c2b2108009b2939079561b1761eb2cb7b0962fcbc7e33b6` |
| corrected K1 publisher test | 12,560 | `8facc32fc3601209ca606baeab6adfb5e8bb45456fb860d6b6e974d826694926` |

Current long-v2 identity:

- audio SHA-256: `af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e`
- ASS SHA-256: `46b4891a4f86c70c1fe54ba4dcfbd776b361f73bb774f1d14e0f2bb53659d04b`
- Dialogue rows: `681`
- duration: `4,144,235 ms`

## Vocalization Policy

Canonical policy SHA-256: `304dc012df35cae201ffd2a41c6d0ca10d062be12fcefcf784d161dd31b91639`.

- NFKC-normalize, then remove whitespace, Unicode punctuation/symbols, and `ー` / `〜` / `~`.
- Exclude only complete 1..6 repeats of one unit from `あ`, `う`, `え`, `お`, `ん`, `うん`, `うあ`.
- Every reference cue overlapping an uncovered region must be approved.
- Excluded regions remain in CER and publish separately from semantic gaps.

## T02 Historical Fixed-Window Evidence

Archived adapter SHA-256: `157f739f8fc99496c24780de238d75885ee0d189a81cb6e76e8a39ddbe4ac16f`.

The archived JSON lock is LF-normalized in the current checkout (`207646dc2b1c2004098d7a5bdf88093de2ebb1de5a9b087355bb078e1979511a`). Its original CRLF byte identity, retained by every raw row and rehydrated only below ignored local correction storage, is `e0036e0f4f63180239f05524cac62b895017e49bd0eed3e72420432bf2a9b9f7`.

| Candidate | Source case | Raw SHA-256 |
|---|---|---|
| ordinary large-v3 fixed window | short-v1 | `2f7d38ecbcc1d5853b47f51c9468e7e949ac1b410d8aecc27e52a6e271af99e5` |
| ordinary large-v3 fixed window | medium-v1 | `453e2fe380bd3e2e809a9c6cc26533fca91c3ae1b1d37c666b5315e7d1704d74` |
| ordinary large-v3 fixed window | long-v1 | `7f29ee9be534739e20d7f1d0f802a48a39844023c3c89c08d933cac6f7c2d3ca` |
| Kotoba fixed window | short-v1 | `71db6d0572cc079588f65f87ed96b77acc3637ded8280bf6bad6961c527e4cc9` |
| Kotoba fixed window | medium-v1 | `bca05b36ab4898e552b75e2c90d28453792259e9738ce2e0af698ef195acf7cc` |
| Kotoba fixed window | long-v1 | `4d661771477bbc7cf4e6d257885babae8c399371e0810583bcac58a5346f0086` |

## T06 Evidence

Selected Candidate A:

- lock SHA-256: `0be239a83640c65f740f169da6c37a1141d3e92140d829243787671f9f410083`
- adapter SHA-256: `4c650fc4f6e07ab5c2fa0315c722966499001622868a861d223be368246835da`
- short raw: `1d559f9a68c4fc1bcd5acc820a0b650d58a30b10654ed31ef245a088bfee8166`
- medium raw: `5cd366a7737b503138e629ca6f6d2ca602e32697ebf69e900f3d649e5ad2c3b0`
- long raw: `4ebb28126703b5ebb88184e78b6b4c7b181784e9f0b039bbd6d1fd9f4b84b32c`

Candidate B:

- final lock SHA-256: `e687ead686df0499c70b649b63d7a85cd2882bc32deae20d1ccdbffc480a376f`
- adapter SHA-256: `b5a47e4e8a97583ea270be6deb9e7f69fb58a3a2bbd510415072abcf8a665d88`
- short raw: `9fc31c5d3f97ae6de192edd26ac6a3a12836be7bf29f998a779e7594d9305afe`
- medium raw: `94c2a0c5a222f7f1bfe51f6710cc80fe8ebf54e5e3bd00f48648cfe222afca0b`
- long: deliberately not run

## T08 K1 Evidence

- original inference lock SHA-256: `24d20963c1d5790d142694f579e2baf7baf21bf19355e126aaa66352a95a7c4e`
- original adapter SHA-256: `e6d0c97791102ab8363e8011bd8321c93024b8722164b812f154a9e0e3d671ad`
- short raw: `5f5695f961df5cf199aaba0b48af51f31de195fe847f170f122e40d3ee03e82d`
- medium raw: `dda53c612a0e7a03ee32775fdfe168b21522272e88d201838a91cdbc86005fba`
- long raw: `9a55accff3b028de3882fc9db580061bf2f88b337e30ffc913205037d7307ba0`

The K1 lock remains the immutable inference identity against the historical manifest. This correction lock changes only authoritative scoring/publication to short-v1, medium-v1, and long-v2.

## Expected Corrected Dispositions

- T02 ordinary and Kotoba fixed-window candidates remain historical `stop-revise`.
- T06 selected Candidate A passes corrected large-v3 short/medium/long-v2; the full ordinary model matrix remains follow-up qualification work.
- T06 Candidate B is diagnostic-only; long is not run and ORT/VAD is not a package input.
- T08 K1 medium passes after two excluded vocalization gaps, while long-v2 retains seven semantic gaps and remains `stop-revise`.
