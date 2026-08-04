# T07 CTranslate2 CUDA Development Result

**Development result: `development-gpu-ready`.**

This result is ignored-local development evidence only. It is not a publishable runtime pack or route qualification.

| Sample | CPU warm median RTF | GPU warm median RTF | GPU/CPU | >=20% faster | GPU RTF <=0.5 diagnostic |
|---|---:|---:|---:|---|---|
| `short-v1` | `0.577901` | `0.062971` | `0.1090` | `yes` | `yes` |
| `medium-v1-first-120s` | `0.591635` | `0.077707` | `0.1313` | `yes` | `yes` |

The decision reads no subtitle text and does not calculate CER, confirmed gaps, segmentation, or timeline quality.
T08 should use this GPU lane for repeated subtitle-quality iteration even when subtitle quality gates still fail.

## Limitations

- Ignored-local RTX 3070 development evidence only; not a runtime pack or release qualification.
- CER, confirmed gaps, segmentation, and timeline quality were not read or scored.
- RTF <= 0.5 is diagnostic for future T15 work and does not override the paired 20% rule.
