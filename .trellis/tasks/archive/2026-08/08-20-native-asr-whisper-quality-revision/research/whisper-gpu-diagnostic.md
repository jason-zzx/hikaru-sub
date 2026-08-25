# Native Faster-Whisper GPU diagnostic

**Selection: `no-candidate-selected`.**

| Cell | Case | CER | S/D/I | Gaps | GPU RTF | RSS MiB | Result |
|---|---|---:|---:|---:|---:|---:|---|
| `short-b1-off` | `short-v1` | `0.283333` | `7/27/0` | `0` | `0.086091` | `3081.9` | `stop-revise` |
| `short-b5-off` | `short-v1` | `0.333333` | `19/15/6` | `0` | `0.103318` | `3081.9` | `stop-revise` |
| `medium-b1-off` | `medium-v1` | `0.103736` | `83/119/34` | `0` | `0.070685` | `3081.9` | `stop-revise` |
| `medium-b1-on` | `medium-v1` | `-` | `-` | `-` | `0.342946` | `3081.9` | `stop-revise:timestamp_after_audio` |
| `medium-b5-off` | `medium-v1` | `0.103297` | `89/117/29` | `0` | `0.088046` | `3081.9` | `stop-revise` |
| `medium-b5-on` | `medium-v1` | `0.092747` | `69/85/57` | `1` | `0.104718` | `3081.9` | `stop-revise` |

Diagnostic rows are selection-only and cannot be promoted to formal evidence.
