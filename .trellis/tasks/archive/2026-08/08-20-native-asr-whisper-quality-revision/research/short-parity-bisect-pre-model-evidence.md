# Phase 3D short parity pre-model evidence

## Disposition

**Pre-model implementation complete; pending independent review.** No ASR model was constructed, no VAD model ran, no `encode`/`generate` call occurred, and no parity/quality row or candidate disposition was published.

- Candidate/probe: `short-input-runtime-parity-bisect-v1`
- Lock: `gpu-short-parity-bisect-lock.md`
- Lock SHA-256: `470f9e0fba8cb0bc837660eae4173635bcc86212bea83324a02c0953d9c36793`
- Runner SHA-256 in both isolated roots: `307379a2085ee422f5814fdbb82f334a7f90d7600086dd5285e61f183230ec6c`
- Promotion and qualification eligibility: `false`
- Next allowed action after a clean review: ask for explicit authorization of exactly four model-backed cells.

## Closed seams

The default-off `windows-x64-ct2-cuda-whisper-parity-bisect` preset builds the existing tests executable with one parity-only precomputed-Mel entry. Protocol v1, production defaults, Tauri/frontend types and ordinary presets do not expose the seam.

The runner accepts only:

- `python-runtime-python-mel`
- `python-runtime-native-mel`
- `native-runtime-python-mel`
- `native-runtime-native-mel`

Each model-backed mode requires the exact `80 × 3000` little-endian float32 Mel hash, exact short/large-v3/lock/worker identity and two repeats. Output is rejected outside the task-local ignored root. The runner records raw tokens/text only ignored-local; the publisher emits only aggregate hashes and rejects promotion.

## Mel preparation

| Producer | Shape | SHA-256 |
|---|---|---|
| faster-whisper 1.2.1 NumPy | `80 × 3000` | `51209b71c3450718055dfad8a3d5923283dd95d702d606b0bdf56aac53218aa9` |
| native pocketfft | `80 × 3000` | `c2fc425ae691a4b1f9acd92580061ad97df82e01165747d761653f87634b9e08` |

Both start from the exact decoded short waveform SHA-256 `2cbf22e7635a41cf751401525e4358c19f2d452ae99c0ced78f65b6e9327e1c2`. The tensors differ at `89,425` values; maximum absolute difference is `7.510185241699219e-06`, mean absolute difference is `6.203453040143359e-08`. Ignored sanitized metadata SHA-256 is `e40e00b562b8196c40be271b6d8555bc425a50da415571299193ae8cecc993c4`.

A future acquisition preflight must still run exact Python Silero V6 and reproduce one `[0,385637)` interval plus the same waveform hash before loading large-v3. That attestation was deliberately not run under the current no-model authorization.

## Same-runner runtime smoke

The identical final runner completed `--fallback-self-check`, `--short-parity-self-check`, `--self-check` and a no-model runtime inventory in both isolated roots under `runtime-bin → CUDA 12.8 bin → Windows System32` PATH order.

| Root | CT2 SHA-256 | No-model observed relevant modules | Smoke SHA-256 |
|---|---|---:|---|
| native no-cuDNN | `e2d74b6f9992da14bb8c2b931983b1bcac7c9410565712cb56c5fd64f2fb6ba2` | 5 | `e4dd18cf324a1614de5ce253a51af927ddda68067c196a8b506d0e8eca101472` |
| Python wheel | `60e536c0801432cde4a105aeebbca35fbf228aa3e901807b2310b02676c2f140` | 5 | `050a41530eb0ec74fb31b055350cb8c33420ee348d77f9b55dfeaf269d06c76e` |

The native smoke loaded the runner, CT2, tokenizer, ORT and System32 `vcomp140.dll`. The wheel smoke loaded the same runner/tokenizer/ORT, wheel CT2 and wheel `libiomp5md.dll`; it did not load the native OpenMP runtime. Canonical paths remain ignored-local.

The lock separately freezes the exact expected post-generation sets: eight modules for native and nine for the wheel, adding the reviewed CUDA driver/cuBLAS set and wheel cuDNN where applicable. Any missing or additional lazy module during a future authorized row is invalid evidence and requires review; the publisher does not adapt the expected set after seeing output.

## Oracle and publisher checks

- Python feature producer is pinned to CPython `3.11.15`, faster-whisper `1.2.1`; source hashes are frozen in the lock.
- Parser oracle reproduces the installed faster-whisper timestamp-slice rules over ignored token IDs and emits only segment count, text hash, timeline hash and timeline error count. Native parser aggregates are independently replayed from the same tokens and checked against raw segments.
- The lock binds CPython 3.11.15, faster-whisper parser sources, `tokenizers/__init__.py`, and the `tokenizers.pyd` native extension; the publisher rehashes each before decoding.
- `generationFingerprint` binds the first-attempt token hash, ordered fallback decision vector, selected attempt/temperature and selected token hash. Equal selected token hashes with divergent Python/native parser aggregates select `parser-divergence` even when fallback fingerprints differ.
- A must reproduce Python parser text hash `4ae70515...`; D must reproduce native parser text hash `d5eb90a2...`.
- The publisher recognizes only the frozen factor decision matrix and emits no CER, reference text, CPU inheritance, acceptance or production recommendation.
- The existing GPU quality publisher has an explicit mutation check rejecting the short-parity raw kind.

Focused checks passed:

```text
parity CTest: 10/10
short parity publisher: 12/12
short parity input/parser oracles: 5/5
existing GPU diagnostic publisher: 15/15
native final no-model smoke: pass
Python-wheel final no-model smoke: pass
four closed lock/file preflights: 4/4, modelLoaded=false
```

## Remaining review gate

Independent review must verify the precomputed-Mel entry cannot escape the parity build gate, the same executable truly survives both roots, the expected post-generation module sets are adequately fail-closed, raw/private fields remain ignored, parser/fingerprint decision rules match the design, and no existing quality/formal path accepts parity rows.

A clean review does not authorize model loading. The task must stop and request explicit acquisition approval for the exact four cells.
