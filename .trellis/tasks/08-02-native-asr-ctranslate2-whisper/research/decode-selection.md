# T06 Large-v3 Short Decode Selection

## Decision

**selected for authoritative rerun: beam 1** — lowest-cost short quality pass.

Freeze a new selected CPU candidate identity, rebuild production defaults if required, then run only authoritative short (1 cold + 3 warm) and medium (one measured sample).

This diagnostic changes only beam size. Every row uses timestamp-driven seek, `conditionOnPreviousText=false`, CPU int8, one deterministic authoritative short-v1 sample, no VAD, no fallback ladder, and no transcript prompt or repair. It is selection evidence, not qualification evidence.

## Bound Identities

- Manifest SHA-256: `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277`
- short-v1 WAV SHA-256: `4d6759ae9b48863490d0e4033ebd20a0c4eb503b454501e566eaff294f814211`
- short-v1 ASS SHA-256: `60cd8c81b759e514e74af548f5a7478c0c409943932d35356504dae9f7fd844b`
- large-v3 revision: `edaa852ec7e145841d8ffdb056a99866b5f0a478`
- model.bin SHA-256: `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1`
- tokenizer.json SHA-256: `6d8cbd7cd0d8d5815e478dac67b85a26bbe77c1f5e0c6d76d1ce2abc0e5f21ca`
- measurement executable SHA-256: `6339a201579fea04d128b82f5de2314444e54419cc6d7d16fe6b21612233d45f`
- CTranslate2 DLL SHA-256: `e1204cfe83cd82916807d64060d896f6e244e139be5c9850838c5fe2da6e6e59`
- tokenizer DLL SHA-256: `892142f8f3e64b77a835c1fa234fcea3bccc854faa9238f9d4be4a03ff24fc9d`
- ignored raw file SHA-256: `a1b02c4f5494e7723d2fed6a754116ffccd61f962d537e3d75782113a17e07d5`
- publisher SHA-256: `221ad160eab1a32ac4ff8284cfcba89b901db6a7c507a702e21649eb673bd8e6`

## Beam Probes

| Beam | CER | CPU inference RTF | Timeline errors | Gaps >=1.5s | Segments | Exact raw-row SHA-256 | Quality gate |
|---:|---:|---:|---:|---:|---:|---|---|
| 1 | `0.2667` | `0.632` | 0 | 0 | 5 | `03539c2760eb8b9327eba9a221d9ac754c970a88c77d763fbd1db5e5ec4148d2` | pass |
| 5 | `0.3583` | `0.811` | 0 | 0 | 4 | `60b414a918c1882e4c807144b64db23aabec6c08bdde71274518412970ce8684` | fail |

Quality pass means CER `<=0.35`, zero timeline errors, and zero confirmed speech gaps. Lowest cost is the lowest measured inference RTF among quality-passing rows; final CPU qualification still requires the frozen short/medium reruns and all resource/performance gates.

## Privacy And Scope

Tracked output contains identities, aggregate metrics, subtitle distributions, hashes, and the decision only. Transcript text, token IDs, raw segments, absolute paths, model bytes, and private media remain under the canonical ignored T06 `research/local/` root. Release/default routing remains Python legacy.
