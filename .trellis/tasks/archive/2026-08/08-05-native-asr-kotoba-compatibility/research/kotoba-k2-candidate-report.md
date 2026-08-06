# T08 Kotoba K2 Candidate Report

**Disposition: `accepted-kotoba-algorithm-input`.**

K2 uses bounded 15-second source windows, a 10-second maximum applied stride, and latest-start half-open ownership. The complete matrix is required for acceptance.

| Case | Samples | CER | GPU RTF | Cold wall | Peak RSS | Timeline errors | Semantic gaps | Excluded vocalization gaps | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `short-v1` | 1 cold + 3 warm | `0.3500` | `0.052` | `6.067s` | `1.66 GB` | 0 | 0 | 0 | **pass** |
| `medium-v1` | 1 measured | `0.2796` | `0.047` | `28.002s` | `1.66 GB` | 0 | 0 | 2 | **pass** |
| `long-v2` | 1 measured | `0.2948` | `0.043` | `182.190s` | `1.66 GB` | 0 | 0 | 0 | **pass** |

## Gap Reassessment

Coordinate-set hash: `7aeda829b3a12c3a52e48ec2db70e1bf48af08f69cf839fcae5f26312657350f`.

| K1 gap | Start ms | End ms | K2 status |
|---:|---:|---:|---|
| 1 | 941630 | 945090 | `covered` |
| 2 | 1276940 | 1278540 | `covered` |
| 3 | 1289540 | 1291540 | `covered` |
| 4 | 1456720 | 1458540 | `covered` |
| 5 | 1606830 | 1608540 | `covered` |
| 6 | 1845700 | 1847230 | `covered` |
| 7 | 4050480 | 4053460 | `covered` |

These diagnostics do not alter the unchanged zero-semantic-gap gate.

## Scope

This is sanitized development evidence on the reviewed CUDA lane. Release/default routing remains Python legacy; no runtime pack or production route is enabled.
