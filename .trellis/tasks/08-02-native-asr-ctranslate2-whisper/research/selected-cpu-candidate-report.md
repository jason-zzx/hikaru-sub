# T06 Selected CPU Candidate Short/Medium Report

## Decision

**short/medium pass; long remains blocked pending review.**

The selected candidate is timestamp-driven, CPU int8, beam 1, and `conditionOnPreviousText=false`. It was selected by the separate bounded short decode diagnostic; this report uses a new lock and final rebuilt production defaults. Candidate A and the CPU RTF matrix remain separate historical identities.

| Case | Samples | CER | CPU inference RTF | Cold wall | Peak RSS | Timeline errors | Gaps >=1.5s | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| short-v1 | 1 cold + 3 warm | `0.2667` | warm median `0.623` | `28.342s` | `3.43 GB` | 0 | 0 | **pass** |
| medium-v1 | 1 measured | `0.1134` | `0.559` | informational | `3.43 GB` | 0 | 0 | **pass** |

Medium used 16 decoded-timestamp seek windows out of 18; previous-text history remained disabled in every trace. No VAD, temperature fallback, transcript prompt, suppress-token change, private fork, synthetic timing, or reference repair was added.

## Frozen Identity

- Candidate lock SHA-256: `0be239a83640c65f740f169da6c37a1141d3e92140d829243787671f9f410083`
- Config SHA-256: `77120c8543e780231d8c65b3868c07f44d685a22a136da56c64e6a6922d4f9e6`
- Measurement executable SHA-256: `9acbf01a68bb95bac54bd2aab67a83c48ab240900d1317f55acb5861028e8254`
- Production worker SHA-256: `cb77a661a9cca23895cd8c9a56fe18e1a99bdeb324f30390f7f38b77aa0764ad`
- CTranslate2 DLL SHA-256: `e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59`
- Tokenizer DLL SHA-256: `892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d`
- model.bin SHA-256: `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1`

## Scope And Residual Gate

No long-v1 or seven-model run was started. Even when short/medium pass, large-v3 is not qualified until authoritative long-v1 passes, followed by the remaining T06 matrix. Release/default routing remains Python legacy. The corpus still lacks `low-volume` coverage.
