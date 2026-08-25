# Whisper short parity v2 acquisition preflight

**Status: `invalid-evidence`; stopped before ASR model load.**

The user-authorized exact-v2 chain passed frozen tool/VAD/model/Mel disk checks. Exact Silero V6 then executed, but post-VAD loaded-module attestation failed with:

```text
required loaded module is missing: onnxruntime.dll
```

The lock required sibling `onnxruntime.dll` (`16,783,712` bytes, SHA-256 `b7dfcb4dea88f8488812c99e2c9016b9a30a374c83b888d39664df3238bcb48b`) to be loaded from role `python-site-packages-onnxruntime-capi`. The executed Python extension was `onnxruntime_pybind11_state.pyd` (`17,420,088` bytes, SHA-256 `28a78fe15545c56fbbdf598286d18438cd015fe37660e39e4498190613ef7fc6`); a no-model PE dependency check confirms that extension does not directly import sibling `onnxruntime.dll`.

| Field | Result |
|---|---|
| Immutable v2 lock | `481c17cc99d84071bfaf6aaad10222d2848e09416f0b29552e97fa7d42819543` |
| Immutable superseded lock | `470f9e0fba8cb0bc837660eae4173635bcc86212bea83324a02c0953d9c36793` |
| Frozen VAD preflight tool | `34ac05c65d6bb416282d1ceb87a016a39839f998ea1e04bec42c0a69f5aaf772` |
| Ignored sanitized invalid record | `5c287a6b7b252284466379873bb4e2a237fda1dc0a1babc551583757ff3fc118` |
| VAD model loaded | `yes` |
| Atomic VAD artifact | `no` |
| ASR model loaded | `no` |
| Four-cell rows / parser artifacts | `0 / 0` |
| Parity metrics/publication | `none` |

Both locks and every frozen source/runtime file remain unchanged. V2 cannot continue or be relaxed in place. Any correction requires a new reviewed lock that binds the actual Python ORT loaded-module contract and fresh acquisition authorization. Production/default remains Python legacy.
