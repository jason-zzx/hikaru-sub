# Phase 3D v4 acquisition preflight outcome

## Disposition

**`invalid-evidence`; no parity attribution was produced.**

Fresh authorization under exact v4 lock SHA-256 `e38e23f5fc28405ffb2554324b2967c077d6eeda46b010ec51aac5bece378ff8` was consumed by the new VAD-preflight attempt. The acquisition stopped before Python Silero inference and before any ASR model construction.

## Re-attestation

The exact v4 lock, frozen source/tools, both isolated runtime roots, model, two Mel tensors, short corpus identity, Python VAD/ONNX Runtime disk set, restricted PATH roots, expected module disk identities, RTX 3070 driver `596.49`, CUDA `12.8.93`, and preserved predecessor artifacts matched the lock.

All four closed no-model preflight envelopes were freshly rerun and remained byte-identical to the reviewed v4 envelopes, each with `vadModelLoaded=false`, `asrModelLoaded=false`, and `modelLoaded=false`.

## Fail-closed result

The frozen VAD tool SHA-256 `21a1e0a2b9911e0fed0200f9b8bbfd4582710ef53c40d237416760c82c62843d` still defines only `gpu-short-parity-bisect-lock-v3.md` as an accepted lock path and rejects every other path before importing faster-whisper or ONNX Runtime. The exact v4 command therefore exited with frozen error `VAD preflight input path identity drifted`.

This is a reviewed lock/tool contract defect, not a VAD or candidate result. No source, tool, runtime, lock, or configuration was repaired in place.

- VAD inference executed: `false`
- Atomic v4 VAD artifact present: `false`
- CTranslate2 Whisper model constructed: `false`
- Encode/generate executed: `false`
- Four parity cells run: `0/4`
- Parser artifacts produced: `0`
- Parity JSON/Markdown publication produced: `false`
- Quality candidate/formal matrix/route/CPU inheritance changes: `none`

## Ignored-local evidence hashes

| Artifact | SHA-256 |
|---|---|
| v4 pre-model re-attestation | `385353870ebba5d20c894daf595e80f735ff95d0e629992a7dc52c2fde46b5ef` |
| `python-runtime-python-mel` no-model preflight | `e8b888fbaad6e3350867110a5b0d06f6844279cce11d05d0225952513c4a15a2` |
| `python-runtime-native-mel` no-model preflight | `9363ba44922fcefce3a537f4121a3831da14bab80f0fb3f8606da79bdc281cda` |
| `native-runtime-python-mel` no-model preflight | `c9eb1e3656ee6b662e82f71ed2da7c36118fecb167e82823d11290e8f9e74fc7` |
| `native-runtime-native-mel` no-model preflight | `03942aad9960e4945979a1c77128d07d8a43b295c3b17e02ec38573bcf44b7c7` |
| sanitized invalid-preflight record | `47299ae4a7d52b818dae72afa4e69f429e8ddd4e8a8a561ff5a96d0d894013c0` |
| ignored stderr log | `c35313299d5556ca412ea99d56038b7dc3844d6de21b05ea85266da2cc608454` |

A future attempt requires a new reviewed lock/tool identity and fresh authorization. V4 cannot be retried or repaired in place.
