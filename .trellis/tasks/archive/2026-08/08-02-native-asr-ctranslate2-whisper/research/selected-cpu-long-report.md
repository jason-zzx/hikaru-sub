# T06 Selected CPU Candidate Large-v3 Long-v1 Report

## Decision

**fail — stop; do not run large-v2 or any other model.**

The run used the accepted selected lock: timestamp-driven seek, no previous-text history, beam 1, CPU int8, and no VAD, fallback, transcript prompt, repair, or Python/private-fork behavior.

| Case | Samples | CER | CPU inference RTF | Peak RSS | Timeline errors | Gaps >=1.5s | Segments | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| long-v1 | 1 measured | `0.2653` | `0.550` | `3.43 GB` | 0 | 7 | 1156 | **fail** |

## Subtitle And Timestamp Provenance

- Segment duration median/P95/max: `2680` / `7210` / `29980` ms.
- Segment characters median/P95/max: `14` / `34.0` / `81`.
- 123 of 148 windows advanced from decoded timestamp evidence; 25 advanced at source-window end.
- The trace chain reached source frame 414424 of 414424; history stayed disabled, fallback calls were zero, and 1 token-derived final end was explicitly bounded to verified WAV end.
- Every accepted segment retained source/model-window, token-trace, timestamp-token, raw-end/final-end, and WAV-end-bound provenance in ignored raw evidence. Tracked evidence contains aggregates and hashes only.

## Frozen Identity

- Selected lock SHA-256: `0be239a83640c65f740f169da6c37a1141d3e92140d829243787671f9f410083`
- Config SHA-256: `77120c8543e780231d8c65b3868c07f44d685a22a136da56c64e6a6922d4f9e6`
- Measurement executable SHA-256: `9acbf01a68bb95bac54bd2aab67a83c48ab240900d1317f55acb5861028e8254`
- Production worker SHA-256: `cb77a661a9cca23895cd8c9a56fe18e1a99bdeb324f30390f7f38b77aa0764ad`
- model.bin SHA-256: `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1`
- Long raw SHA-256: `4ebb28126703b5ebb88184e78b6b4c7b181784e9f0b039bbd6d1fd9f4b84b32c`
- Long adapted result SHA-256: `d9f3233281b4b585a2e57befdae6790541e1e1b400563ca1b3b54939283a396e`
- Long publisher SHA-256: `cc369d7f2ab2e24eed420f1b89d678404699d95327c8c6aa07ba950caa160d2c`

## Next Gate

Stop the product-model matrix. Any Candidate B work must first return to planning and pin the minimal native ONNX executor, license/archive identity, size, and packaging impact. No other model ran, the seven-model matrix did not start, and Release/default routing remains Python legacy. The corpus still lacks `low-volume` coverage.
