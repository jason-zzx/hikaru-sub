# T06 Start-Gate Input Lockability

## Decision

**Ready to enter T06 implementation after review.** The authoritative corpus, CT2/toolchain dependencies, Candidate A sources, one conditional Candidate B VAD asset, all seven product-model immutable revisions, licenses, and private-output boundary are lockable.

This is a start-gate provenance record, not the final model-run lock. Historical Candidate A/selected identities remain in their dedicated locks. After selected long-v1 produced 7 confirmed gaps, the required Candidate B planning addendum was completed in `candidate-b-lock.md`; implementation must create a new final executable/DLL/VAD/config/tool identity before any Candidate B model-backed measurement.

## Upstream Task Identities

| Input | Identity |
|---|---|
| T01 authoritative manifest | `e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277` |
| Archived T02 lock document | SHA-256 `207646dc2b1c2004098d7a5bdf88093de2ebb1de5a9b087355bb078e1979511a` |
| T02 final evidence binary | SHA-256 `f8ee5060a384438da4a5fac2e7951ff6004cd15935b65dfd90ee79d208d5d1e2` |
| T04 protocol implementation | commit `96077103e0c3070894b70ffa9fcd888bcc93075d` |
| T05 Rust host implementation | commit `74d1a4e` |

T02 already locks CTranslate2 `4.8.0` commit `54a546cec4262f9770d4674a0bfb4ac3c4f05698` (MIT), oneDNN `3.1.1` (Apache-2.0), MSVC/CMake/Ninja, tokenizer dependency graph, pocketfft and OpenMP runtime evidence. T06 may update a dependency only by revising this planning record and rerunning the affected qualification matrix.

## Candidate Source Lock

### Candidate A - Timestamp-Driven Long Form

| Role | Immutable source | SHA-256 | License |
|---|---|---|---|
| Official authority | OpenAI Whisper `whisper/transcribe.py` at `25639fc17ddc013d56c594bfbf7644f2185fad84` | `0957d3308567c27fe9f3c85779fcfcd14b16abb79e18d353cbe189b29a027089` | MIT |
| Maintained implementation reference | faster-whisper `faster_whisper/transcribe.py` v1.2.1 commit `65882eee9f5cdbeeb2d877f1131d48cf241b327d` | `5d5ffb00018561d3d529b2c72e1d9f5fff055bea725f3cccc7c6c67f5cc8ffe4` | MIT |

OpenAI LICENSE SHA-256: `b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d`; faster-whisper LICENSE SHA-256: `af6798135e729f8aa6c853936d037dfdea449734d26b8ea6a89805fca758c0d5`.

Candidate A uses these sources to define timestamp-token seek, prompt/reset, no-speech and invalid-generation candidates. Current Hikaru Sub Python output and private long fork remain diagnostic regression material only.

### Candidate B - Conditional Silero V6 VAD

Candidate B is activated only if Candidate A still has T01-confirmed gaps.

| Input | Immutable source | Size | SHA-256 | License |
|---|---|---:|---|---|
| VAD behavior reference | faster-whisper `faster_whisper/vad.py` v1.2.1 commit `65882eee9f5cdbeeb2d877f1131d48cf241b327d` | 12,543 | `37a9c774aefdd3162d936b896c8dcf5571b2ed938d65bffecfd631770049a18d` | MIT |
| Silero V6 ONNX asset | faster-whisper `assets/silero_vad_v6.onnx` at the same commit | 1,245,151 | `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2` | Distributed in pinned MIT faster-whisper source; upstream Silero attribution review required before activation |

The installed development asset matches the pinned ONNX SHA-256. Selected Candidate A later failed only the long-v1 confirmed-gap gate, so the mandatory planning gate was activated and converged in `candidate-b-lock.md`:

- sole executor: Microsoft ONNX Runtime `1.28.0` official Windows x64 CPU ZIP, tag/commit `da9b5e364c465de65c49d91e696cd6485270757f`, archive SHA-256 `abef733dacbe2f571547a7150b479b5cb9cc0df22f96c24983a42cadb1b4f8bc`, C API `28`, MIT;
- upstream attribution: Silero VAD `v6.0` commit `fba061dc5559f696e62171e9a0741782b0fdc23c`, MIT LICENSE SHA-256 `2e63e9a...`; its immutable tag ONNX assets are not byte-identical to the selected faster-whisper asset and do not replace it;
- planning preflight: the exact model loads under direct ORT CPU/no-custom-op session with the locked `input/h/c -> speech_probs/hn/cn` schema and one zero-input stateful inference;
- algorithm: ordinary faster-whisper 1.2.1 V6 defaults, explicitly not batched `160ms/30s` or current Hikaru Python VAD settings; no silent Candidate A fallback;
- packaging: ORT/VAD is conditional on Candidate B passing all large-v3 gates. No second VAD candidate is permitted in T06.

## Product Model Revision Lockability

Metadata was read from each immutable Hugging Face revision with blob metadata enabled. `metadataSetSha256` is SHA-256 over sorted canonical JSON entries for the required files (`config.json`, `model.bin`, tokenizer, vocabulary and preprocessor when present). `model.bin` uses its LFS SHA-256.

All seven repositories are public, ungated and declare MIT. Cached status is planning-machine availability only, not evidence authority.

| Model | Repository | Revision | model.bin bytes | model.bin SHA-256 | metadataSetSha256 | Planning availability |
|---|---|---|---:|---|---|---|
| tiny | `Systran/faster-whisper-tiny` | `d90ca5fe260221311c53c58e660288d3deb8d356` | 75,538,270 | `dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1` | `4d605ea5d7a10767ae13982b2f598cb5051759af744b38a96d9124361c5d1ee7` | remote-only; exact revision is downloadable |
| base | `Systran/faster-whisper-base` | `ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66` | 145,217,532 | `d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9` | `99b5a34632522dfb7861611f8d729dd79f878975548c50f75edeee5e220947ab` | cached |
| small | `Systran/faster-whisper-small` | `536b0662742c02347bc0e980a01041f333bce120` | 483,546,902 | `3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671` | `c16c7680515ec28656b65567b40fa59b2434f3a41de1c1173bc482c697ce825d` | cached |
| medium | `Systran/faster-whisper-medium` | `08e178d48790749d25932bbc082711ddcfdfbc4f` | 1,527,906,378 | `9b45e1009dcc4ab601eff815b61d80e60ce3fd8c74c1a14f4a282258286b51ae` | `a78890217ef14a0a08cf78f2839bdda704cf88f8bb45065d8213cdf5da11bd50` | cached |
| large-v2 | `Systran/faster-whisper-large-v2` | `f0fe81560cb8b68660e564f55dd99207059c092e` | 3,086,912,962 | `bf2a9746382e1aa7ffff6b3a0d137ed9edbd9670c3b87e5d35f5e85e70d0333a` | `62fb33a82ab8c6ba64668470dff1158d4b4da8c1ebde7ae6ae6f93a95bc83c5f` | cached |
| large-v3 | `Systran/faster-whisper-large-v3` | `edaa852ec7e145841d8ffdb056a99866b5f0a478` | 3,087,284,237 | `69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1` | `bfcd3413537ac44713376d779390dfd4d17748d4be8f9304506af8e0232acbc7` | cached; T02 file hash already verified |
| large-v3-turbo | `mobiuslabsgmbh/faster-whisper-large-v3-turbo` | `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf` | 1,617,884,929 | `e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da` | `62a1fc520f98d24a1a40f1a7bcfce8c81177d3f089a513469d748bed13de4fc4` | cached |

Tiny being absent locally does not block T06 start. Before its measured run, acquire only the pinned revision into the task-local ignored model root and verify every required file locally. T06 worker code never downloads models.

## Source Endpoints

- OpenAI authority: `https://github.com/openai/whisper/tree/25639fc17ddc013d56c594bfbf7644f2185fad84`
- Maintained reference/VAD asset: `https://github.com/SYSTRAN/faster-whisper/tree/65882eee9f5cdbeeb2d877f1131d48cf241b327d`
- ONNX Runtime executor: `https://github.com/microsoft/onnxruntime/releases/tag/v1.28.0`
- Silero attribution: `https://github.com/snakers4/silero-vad/tree/fba061dc5559f696e62171e9a0741782b0fdc23c`
- Model metadata: `https://huggingface.co/api/models/{repository}/revision/{revision}?blobs=true`
- Model revision pages: `https://huggingface.co/{repository}/tree/{revision}`

## Local And Privacy Boundary

- Raw transcripts, token traces, development model copies, build/run results and temporary locks live only under `.trellis/tasks/08-02-native-asr-ctranslate2-whisper/research/local/`.
- The same ignore rule must cover a future archived path.
- `.asr-benchmark/`, `native-asr/build/`, app model cache and task-local local roots remain untracked.
- Tracked evidence contains no reference text, model bytes, machine paths or credentials.

## Start-Gate Conclusion

- Candidate A source/license and all historical evidence identities remain locked.
- Candidate B source/model/executor/algorithm/attribution/preflight/package boundary is fully locked in `candidate-b-lock.md`; this planning completion does not authorize or claim implementation.
- All seven product model revisions and model-weight hashes remain lockable.
- Six models are already cached; tiny is remote-only but public/ungated and pinned.
- T04/T05 protocol/host dependencies are complete and archived.
- Remaining T06 work is independently reviewed minimal Candidate B implementation, a new final identity, and large-v3 short/medium/long only. large-v2/full matrix remains blocked until that gate passes.
