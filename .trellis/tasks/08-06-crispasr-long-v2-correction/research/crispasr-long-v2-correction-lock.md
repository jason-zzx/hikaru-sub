# CrispASR Long-v2 Correction Lock

This task-local lock freezes deterministic re-scoring only. Historical T01/T03 artifacts remain immutable; Qwen medium/long-v2 remain unscored blockers.

```json
{
  "archivedSourceSha256": {
    "t01BenchmarkContract": "e08ceaad3b72cdd116d700b42f5afccb7c0568e26a359cf1b6e518b2355ce1b2",
    "t03Adapter": "b347112296c342abf5371f421297f8011357e77f2d482fa354a54bc3fbb42d55",
    "t03EvidenceContract": "2351f3b0533b80d0fe7b10fae659d5f45f9e4e80b00ba54cbb0a1b67d0daf1bf",
    "t03InputLock": "f72aa6d2c7117abff16862bef8f9e18c45c9fcb9dc98249c2cf6e0872703279f",
    "t03Publisher": "ba3562db4f0ab29072c5f0f0c9c78b833895f5e2f2353be8e209faf6e444b05b",
    "t03Report": "91bc43292c27fa652dca50b6f5158c9203a83b297c86f872222a3b6a00109d96"
  },
  "boundaries": [
    "no inference",
    "no worker rebuild",
    "no archived T01/T03 rewrite",
    "no product/runtime route change",
    "python-legacy Release/default"
  ],
  "budgets": {
    "cerMax": 0.35,
    "cpuInferenceRtfMax": 1.0,
    "crispasrPeakRssBytesMax": 12884901888,
    "qwenStartMedianMsMax": 150,
    "qwenStartP95MsMax": 500,
    "semanticGapsMax": 0,
    "shortColdWallMsMax": 120000,
    "timelineErrorsMax": 0
  },
  "comparatorSha256": "b2ae880e693d16daf6a3e29f7be3f0058c2ce74068b333b90850be5798cef822",
  "compiledValidatorCommand": "<archived-exe> --validate-evidence <raw> --manifest research/local/manifest-long-v1.json --manifest-sha256 e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277 --lock <archived-lock> --model <locked-model> [--aligner <locked-aligner>] --audio <current-corpus-wav> --case-id <historical-case-id> --case-source t01-authoritative",
  "compiledValidatorRows": [
    "parakeet-short|short-v1|parakeet-ja|no-aligner",
    "parakeet-medium|medium-v1|parakeet-ja|no-aligner",
    "parakeet-long|long-v1|parakeet-ja|no-aligner",
    "reazonspeech-short|short-v1|reazonspeech|no-aligner",
    "reazonspeech-medium|medium-v1|reazonspeech|no-aligner",
    "reazonspeech-long|long-v1|reazonspeech|no-aligner",
    "qwen3-short|short-v1|qwen3-asr|qwen3-aligner",
    "qwen3-medium|medium-v1|qwen3-asr|qwen3-aligner",
    "qwen3-long|long-v1|qwen3-asr|qwen3-aligner"
  ],
  "cpuOpenParams": {
    "abiVersion": 2,
    "flashAttn": 0,
    "nGpuLayers": 0,
    "nThreads": 16,
    "useGpu": 0
  },
  "currentLongAssSha256": "46b4891a4f86c70c1fe54ba4dcfbd776b361f73bb774f1d14e0f2bb53659d04b",
  "currentManifestSha256": "3c05c0eb705c29060123090e27e62a56e84177ef7e83a58485e3cbd90707d9ea",
  "dispositions": {
    "parakeet": "stop-revise",
    "qwen3": "stop-revise",
    "reazonspeech": "proceed-with-named-risks"
  },
  "executable": {
    "sha256": "66e35b7a00f22338304a7005a9cfd633352a8a6afa93b11ff0d1c158e62040cf",
    "sizeBytes": 472576
  },
  "longAudioSha256": "af0eafc9355bfb1a3749e986645b7bfb016beaa03880920c8c09af9645c29b3e",
  "longDurationMs": 4144235,
  "modelSha256": {
    "parakeet-ja": "5a61e6c7d956c3c72a76fafcd798cac0c9ea66d0e29b3910cd04865a1e42cc17",
    "qwen3-aligner": "a7bb4cbeacc6414f11a5d23dc7661a51a941a71e6d559dc7b408b52473f2ae84",
    "qwen3-asr": "ec197cef7ccc589fdcae1becc3f4a3de119d0a41e790b898b519b1a048dad8d4",
    "reazonspeech": "20b828d05f859a4b0ea0bdcc232cb6e02543d6ddd0b3a1ad1ce37aa56fd7cfd2"
  },
  "oldLongAssSha256": "7954ce24af05dca37b2930136c83ee722e80fd637ef298cc7eeb47f29cf8c6f3",
  "oldManifestSha256": "e4656b82e307a9a8e8cf92f9e10e6d5e968565fd28cf5a9da1dcf2fc8488d277",
  "preview": {
    "parakeet-long-v2": [
      0.5962,
      0,
      0,
      0
    ],
    "parakeet-medium-v1": [
      0.6123,
      1,
      0,
      0
    ],
    "parakeet-short-v1": [
      0.4917,
      2,
      0,
      0
    ],
    "qwen3-short-v1": [
      0.2083,
      0,
      0,
      0
    ],
    "reazonspeech-long-v2": [
      0.2944,
      0,
      0,
      0
    ],
    "reazonspeech-medium-v1": [
      0.2857,
      0,
      0,
      0
    ],
    "reazonspeech-short-v1": [
      0.1333,
      0,
      0,
      0
    ]
  },
  "publicationCommands": [
    "python research/test_publish_crispasr_long_v2_correction.py",
    "python research/publish_crispasr_long_v2_correction.py"
  ],
  "publicationDataSha256": "0dde2c901a41b808259967ade7f5255f4942b21da6fd604eb158bf4122020f2a",
  "publisherSha256": "12dcdc061f77e647807951a5ee642862f1fe7fad446f68fff1a0f990f9c30184",
  "rawSha256": {
    "parakeet-long": "49520ba5851050701ae3936e58e5c3e6e3a2ae47c840e2e4bfbd372fa165255d",
    "parakeet-medium": "684ee6dbb5ebdeea1ab6e47288d349dcd272fb3132238b66fceeebbf192dfec5",
    "parakeet-short": "5e68c20de04c60022550c50664758c43ec71cd48c1564bd8f9c6217b62c0e37c",
    "qwen3-long": "33d46de94e42d86c7cd9b315c1b143b306cf2cd12abdbf13ed062f5a53fe8943",
    "qwen3-medium": "02013002cd133bb3619e18637654a50ec970ba9d7ac5bc7340bed6c677ee0b87",
    "qwen3-short": "2b7fe38eab319f85e232a6219cb6b48efaff730e5e573683d87ac759fa9022f4",
    "reazonspeech-long": "967a881a1e9a3c49b017eb54e0bedc251be454f6ec15477fc4bdc189d9e81634",
    "reazonspeech-medium": "d531864d763ee7f4c010b2e683a4bda578c60a61509f171d7a1063d22681074c",
    "reazonspeech-short": "f48b010c50d3d599f35c3ed5658f085469affafd3817039c762ca3d3c45165ef"
  },
  "requiredDllSha256": {
    "crispasr.dll": "aa5d08f8cfe459727764bbe724b0780a75bd4167043c9cf63fd0fb43c2a559de",
    "ggml-base.dll": "7c296bf21291c386766ea8f8055c9a7477756a3ed3c45026ade32e6a54f374c4",
    "ggml-cpu.dll": "5872f3cf3001f172f99672d1385ff45e5d9129a55c4e07dcbc8d9373ae9b4554",
    "ggml.dll": "e4c77bd4e86f66af6ed4b245bba14f5aa35fbea1220ea07cb3029bef1c4aa72d"
  },
  "restrictedPath": {
    "entryCategories": [
      "harness-directory",
      "windows-system32"
    ],
    "entryCount": 2,
    "restricted": true
  },
  "testSha256": "2022dc38fda8fb12133df159c210f9f7f6ac055c9a924a1146fd97b221167f96"
}
```
