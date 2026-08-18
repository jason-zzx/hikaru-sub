# ReazonSpeech R2 final attestation

## Authority and supersession

- Candidate: `R2-vad12-pad30-overlap-top-level-v1`.
- Final disposition: `qualityDisposition=stop-revise`, `relativeSelection=better-than-r1`.
- Accepted algorithm handoff: `false`; Release/default remains Python legacy and the Reazon native route remains disabled.
- The pre-final-check publication is superseded and non-authoritative:
  - raw index: `ec1442516b7a1fd25bd35f850049046adfa6c4669947900cb3e0806e6b12b488`;
  - evidence JSON: `9e6efdfc1db2b595019afa723d9242d97abd5309425fe673621e57a66ca96085`;
  - report: `46f0b61265b654a5def4d8211b9ca08c82e56360b34997862dbe3c61d7d8ba03`.
- Supersession reason: it routed the R2 manifest through the generic CrispASR test decoder and exempted `crispasr_result_invalid` by code equality. The final authority restores the generic T09/T10 decoder and uses a separate R2-only required decoder plus an exact identity-bound failure subtype/fingerprint.

## Final frozen identities

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| acquisition input lock | 24,189 | `42039347f43d8b6faa2b9ab2f9acb3a2e021fb0e350eefa67e1bd38dde5bfd3f` |
| final worker | 623,616 | `e86c199e8a01cfead31d36f34d576fe89be52e0fd6f3d29163383ee94023c274` |
| R2 Step 6 manifest | 15,483 | `aa28e40c65c029c2c7c651121606f9334daddf21ee839c59954455d3bb5bb33c` |
| R2 Step 6 validation index | 28,343 | `81a0987bbbb1adac7fef7975aecbee324a559e1b24e4dd9271b2530d35e4d2f7` |
| R2 Step 6 report | 5,320 | `8a6d1ffa07457e5b7ecdff4ae2bf3ced3509684d676a89bdfcf78904823de72f` |
| formal raw index | 1,719 | `ac860d5a44725158505db3568588dff500d112b69fe601e8d8fe34d798e81ed6` |
| formal evidence JSON | 9,588 | `7b88496567285e5ee224300432b054fc7635da23ac817a1e888c66f9c215fbd9` |
| formal Markdown report | 1,134 | `547d9cab2175a16c12e2fa5001fb4f1b7866a97c09945dcd76b9a577b1d2d482` |
| formal handoff | 394 | `dafc03494eff48cce1e7b339b6a0514fc9c6b0b65fce055cebde20d31eefc37b` |

The complete publication was generated twice; the raw index and all three outputs were byte-identical.

## Final matrix

| Case | Result |
|---|---|
| short-v1 | completed `1 cold + 3 warm`; CER `0.266667`; semantic/excluded gaps `1 / 0`; timeline errors `0`; warm median CUDA RTF `0.031613`; peak RSS `941,690,880` bytes |
| medium-v1 | completed fresh process; CER `0.295385`; semantic/excluded gaps `19 / 1`; timeline errors `0`; CUDA RTF `0.021828`; peak RSS `972,058,624` bytes |
| long-v2 | `validated-failed`; `62` attempted / `61` completed calls; `attemptedThroughMs=768570`; `rtfScope=partial-attempt`; attempted RTF `0.045657`; no full-case RTF; peak RSS `1,205,370,880` bytes |

Long-v2 failure authority:

- code: `crispasr_result_invalid`;
- independently derived subtype: `zero_duration_top_level_result`;
- zero-based window index: `61` (62nd attempt);
- absolute window: `[763590,768570]ms`;
- local range: `2160..2160ms`;
- result-trace SHA-256: `f3179c7ab489bfcc211b4779fa15fb481354850dd08cbf2286b64c00f13c45bb`;
- fingerprint SHA-256: `35b1f992ca3619d7e985ee3e9bb33f01280bed48829766bafbe01ee1892dc93e`.

R1 is independently bound to the same reviewed subtype at zero-based window `23` (24th attempt), `[345000,360000]ms`, local `14800..14800`, fingerprint `6c76aa3a15660de07b377754a75c9938add1a71edb58d3b1a988ab5c75935716`. Code equality alone cannot exempt any other result-invalid failure.

## Validation

Passed:

- independently reconfigured true protocol-only native preset;
- native CT2 CPU preset;
- native CT2 CUDA-development preset;
- task-local R2 worker CTest lane;
- Rust full suite: `216/216` and release check;
- frontend: `105` files / `830` tests and production build;
- benchmark self-check, manifest validation and `24` focused comparator tests;
- R2 publisher: `18` tests;
- Step 6 publisher: `5` tests and six required host lanes;
- Trellis task validation;
- active and prospective archive ignore checks;
- tracked privacy scan;
- deterministic publication double-run;
- `git diff --check`;
- no staged files.

Expected non-blocking warnings remain unchanged: benchmark coverage lacks `low-volume`, Vite reports the existing large chunk, and pinned upstream CUDA/CTranslate2 compilation emits conversion/alignment warnings.

## Residual risks and boundary

- Long-v2 still fails on an upstream zero-duration top-level result; R2 is not qualified.
- Short/medium still contain semantic gaps; no absolute quality waiver was introduced.
- The residual blocker is not a `>=1000ms` uncovered span inside a valid VAD slice, so gap-fill remains unauthorized.
- No F16, official subword decoder, beam/MAES, caller-created overlap, ownership rewrite, dedup, stitching, pin upgrade, package/runtime-pack or route cutover was added.
