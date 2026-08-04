# T06 Ordinary Faster-Whisper Product-Model Disposition

Candidate A remains a historical provisional `stop-revise` evidence set. The separate selected CPU beam-1/no-history candidate has large-v3 status `stop-revise`. No route is enabled; Release/default remains Python legacy.

| Model | Current T06 status | Reason |
|---|---|---|
| large-v3 | `stop-revise` | selected CPU candidate failed at least one authoritative long-v1 gate |
| large-v2 | `blocked-not-run` | large-v3 hard gate failed |
| tiny | `blocked-not-run` | large-v3 hard gate failed |
| base | `blocked-not-run` | large-v3 hard gate failed |
| small | `blocked-not-run` | large-v3 hard gate failed |
| medium | `blocked-not-run` | large-v3 hard gate failed |
| large-v3-turbo | `blocked-not-run` | large-v3 hard gate failed |

All seven model IDs remain visible for downstream T17. No model is hidden, silently routed, or classified unsupported by this checkpoint.
