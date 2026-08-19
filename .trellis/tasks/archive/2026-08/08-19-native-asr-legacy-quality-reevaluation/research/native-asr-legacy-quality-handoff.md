# Native ASR Legacy Quality Handoff

Authority: `research/evidence/native-asr-legacy-quality-reevaluation.json` (`1cec6882872a0c73fda569fe9ec4ad3e7e3e536b610e4b7f17f18f82d5102f85` lock).

| Model | Observed relative metrics | Identity-aware subtitle quality | Evidence | Independent gate |
|---|---|---|---|---|
| `faster-whisper/large-v3` | `stop-revise` | `stop-revise` | `complete` | `pass` |
| `kotoba-faster-whisper/kotoba-whisper-v2.0-faster` | `stop-revise` | `stop-revise` | `complete` | `pass` |
| `parakeet/parakeet-tdt_ctc-0.6b-ja` | `stop-revise` | `baseline-incomplete` | `validated-failure` | `stop-revise` |
| `reazonspeech-nemo/reazonspeech-nemo-v2` | `stop-revise` | `baseline-incomplete` | `validated-failure` | `stop-revise` |
| `qwen3-asr/qwen3-asr-1.7b` | `stop-revise` | `baseline-incomplete` | `validated-failure` | `stop-revise` |

- Large-v3 does not unlock Whisper: large-v2 remains missing as an independently qualified anchor.
- Parakeet, ReazonSpeech, and Qwen remain identity-aware `baseline-incomplete` until T12 freezes native model/companion mappings; their existing structural failures remain blocking.
- Qwen T11 grouping/timeline productization and T14/T15/T18 runtime/device/release gates are unchanged.
- This handoff changes no production route and does not rewrite archived conclusions.
