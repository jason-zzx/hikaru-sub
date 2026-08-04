# T06 Candidate B Product-Model Disposition

Candidate B is `stop-revise`. It is a separate evidence identity from Candidate A, CPU RTF diagnosis, beam selection, selected CPU short/medium, and selected CPU long. No route is qualified or enabled; Release/default remains Python legacy.

| Model | Candidate B status | Reason |
|---|---|---|
| large-v3 | `stop-revise` | Candidate B failed at least one large-v3 short/medium gate |
| large-v2 | `blocked-not-run` | Candidate B large-v3 hard gate is incomplete |
| tiny | `blocked-not-run` | Candidate B large-v3 hard gate is incomplete |
| base | `blocked-not-run` | Candidate B large-v3 hard gate is incomplete |
| small | `blocked-not-run` | Candidate B large-v3 hard gate is incomplete |
| medium | `blocked-not-run` | Candidate B large-v3 hard gate is incomplete |
| large-v3-turbo | `blocked-not-run` | Candidate B large-v3 hard gate is incomplete |

All seven model IDs remain visible for downstream T17. No model is hidden, silently routed, or classified unsupported by this checkpoint.
