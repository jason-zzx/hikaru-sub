import copy
import importlib.util
import io
import json
import os
import random
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "asr-benchmark.py"
SPEC = importlib.util.spec_from_file_location("asr_benchmark", SCRIPT_PATH)
assert SPEC and SPEC.loader
benchmark = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = benchmark
SPEC.loader.exec_module(benchmark)


class _Segment:
    def __init__(self, start_ms, end_ms, text):
        self.start_ms = start_ms
        self.end_ms = end_ms
        self.text = text


class _Refresh:
    def __init__(self, segments):
        self.segments = tuple(segments)


class BenchmarkMetricTests(unittest.TestCase):
    def test_normalization_and_cer_counts_are_deterministic(self):
        self.assertEqual(benchmark.normalize_japanese_text("Ａ b\r\n\t語。"), "Ab語。")
        self.assertEqual(
            benchmark.levenshtein_counts("abc", "adc"),
            {
                "substitutions": 1,
                "deletions": 0,
                "insertions": 0,
                "referenceCharacters": 3,
                "errors": 1,
                "cer": 1 / 3,
            },
        )
        self.assertEqual(benchmark.levenshtein_counts("abc", "ac")["deletions"], 1)
        self.assertEqual(benchmark.levenshtein_counts("abc", "abxc")["insertions"], 1)
        self.assertEqual(benchmark.levenshtein_counts("ab", "ba")["substitutions"], 2)

    def test_levenshtein_matches_naive_dp_for_random_short_strings_and_long_near_matches(self):
        def naive(reference, hypothesis):
            previous = [(index, 0, 0, index) for index in range(len(hypothesis) + 1)]
            for reference_index, reference_char in enumerate(reference, start=1):
                current = [(reference_index, 0, reference_index, 0)]
                for hypothesis_index, hypothesis_char in enumerate(hypothesis, start=1):
                    if reference_char == hypothesis_char:
                        current.append(previous[hypothesis_index - 1])
                        continue
                    substitution = previous[hypothesis_index - 1]
                    deletion = previous[hypothesis_index]
                    insertion = current[hypothesis_index - 1]
                    candidates = [
                        (substitution[0] + 1, 0, substitution[1] + 1, substitution[2], substitution[3]),
                        (deletion[0] + 1, 1, deletion[1], deletion[2] + 1, deletion[3]),
                        (insertion[0] + 1, 2, insertion[1], insertion[2], insertion[3] + 1),
                    ]
                    edit, _rank, substitutions, deletions, insertions = min(
                        candidates, key=lambda item: (item[0], item[1])
                    )
                    current.append((edit, substitutions, deletions, insertions))
                previous = current
            return previous[-1]

        generator = random.Random(0)
        for _ in range(1000):
            reference = "".join(generator.choice("abc") for _ in range(generator.randrange(15)))
            hypothesis = "".join(generator.choice("abc") for _ in range(generator.randrange(15)))
            expected = naive(reference, hypothesis)
            actual = benchmark.levenshtein_counts(reference, hypothesis)
            self.assertEqual(
                (actual["errors"], actual["substitutions"], actual["deletions"], actual["insertions"]),
                expected,
                (reference, hypothesis),
            )

        long_reference = "あ" * 20_000 + "い" + "う" * 20_000
        long_hypothesis = "あ" * 20_000 + "え" + "う" * 20_000
        self.assertEqual(benchmark.levenshtein_counts(long_reference, long_hypothesis)["substitutions"], 1)

    def test_percentile_uses_linear_interpolation(self):
        self.assertEqual(benchmark.percentile([0, 100], 0.95), 95.0)
        self.assertEqual(benchmark.percentile([5], 0.95), 5.0)
        self.assertIsNone(benchmark.percentile([], 0.95))
        with self.assertRaises(ValueError):
            benchmark.percentile([], 1.1)

    def test_timeline_metrics_count_each_invalid_shape(self):
        metrics = benchmark.timeline_metrics(
            [
                {"startMs": 0, "endMs": 500, "text": "first"},
                {"startMs": -10, "endMs": -10, "text": ""},
                {"startMs": 100, "endMs": 1100, "text": "late"},
            ],
            1000,
        )
        self.assertEqual(
            metrics,
            {
                "segmentCount": 3,
                "emptyTextCount": 1,
                "nonPositiveDurationCount": 1,
                "negativeStartCount": 1,
                "afterAudioEndCount": 1,
                "nonMonotonicCount": 1,
            },
        )
        nested = benchmark.timeline_metrics(
            [
                {"startMs": 0, "endMs": 1000, "text": "outer"},
                {"startMs": 100, "endMs": 500, "text": "nested"},
            ],
            1000,
        )
        self.assertEqual(nested["nonMonotonicCount"], 0)

    def test_missing_speech_uses_merged_ass_confirmed_intervals_only(self):
        missing = benchmark.missing_speech_regions(
            [
                {"startMs": 0, "endMs": 2500},
                {"startMs": 2000, "endMs": 4000},
                {"startMs": 5000, "endMs": 9000, "speech": False},
            ],
            [
                {"startMs": 0, "endMs": 1000, "text": "a"},
                {"startMs": 3000, "endMs": 4000, "text": "b"},
            ],
        )
        self.assertEqual(
            missing,
            [{"speechIntervalIndex": 0, "startMs": 1000, "endMs": 3000, "durationMs": 2000}],
        )
        self.assertEqual(
            benchmark.missing_speech_regions(
                [{"startMs": 0, "endMs": 2000}],
                [{"startMs": 0, "endMs": 2000, "text": ""}],
            ),
            [{"speechIntervalIndex": 0, "startMs": 0, "endMs": 2000, "durationMs": 2000}],
        )
        self.assertEqual(
            benchmark.missing_speech_regions(
                [{"startMs": 0, "endMs": 3000}],
                [{"startMs": -100, "endMs": 1500, "text": "covered"}],
            ),
            [{"speechIntervalIndex": 0, "startMs": 1500, "endMs": 3000, "durationMs": 1500}],
        )
        self.assertEqual(
            benchmark.missing_speech_regions(
                [{"startMs": 0, "endMs": 2999}],
                [{"startMs": 0, "endMs": 1500, "text": "covered"}],
            ),
            [],
        )

    def test_refresh_replaces_preview_for_all_refresh_capable_routes(self):
        for engine in ("parakeet", "qwen3-asr", "reazonspeech-nemo"):
            with self.subTest(engine=engine):
                closed = []

                def events():
                    try:
                        yield _Segment(0, 1000, "preview")
                        yield _Refresh([_Segment(100, 900, "final")])
                        yield _Segment(1000, 1200, "tail")
                    finally:
                        closed.append(True)

                reduced = benchmark.reduce_segment_events(events(), _Refresh)
                self.assertEqual(
                    reduced,
                    [
                        {"startMs": 100, "endMs": 900, "text": "final"},
                        {"startMs": 1000, "endMs": 1200, "text": "tail"},
                    ],
                )
                self.assertEqual(closed, [True])

    def test_qwen_synthetic_timestamps_are_not_timing_eligible(self):
        reference = [{"startMs": 100, "endMs": 500, "text": "日本語", "speech": True}]
        hypothesis = [{"startMs": 180, "endMs": 580, "text": "日本語"}]
        synthetic = benchmark.timing_metrics(reference, hypothesis, "synthetic", "qwen3-asr")
        native_label = benchmark.timing_metrics(reference, hypothesis, "engine-native", "qwen3-asr")
        aligned = benchmark.timing_metrics(reference, hypothesis, "forced-aligner", "qwen3-asr")
        differently_segmented = benchmark.timing_metrics(
            [
                {"startMs": 100, "endMs": 300, "text": "日本", "speech": True},
                {"startMs": 400, "endMs": 600, "text": "語", "speech": True},
            ],
            [{"startMs": 120, "endMs": 580, "text": "日本語"}],
            "forced-aligner",
            "qwen3-asr",
        )
        self.assertFalse(synthetic["eligible"])
        self.assertFalse(native_label["eligible"])
        self.assertIsNone(synthetic["p95StartErrorMs"])
        self.assertEqual(synthetic["unmatchedHypothesisCount"], 1)
        self.assertTrue(aligned["eligible"])
        self.assertEqual(aligned["medianStartErrorMs"], 80)
        self.assertEqual(aligned["p95StartErrorMs"], 80.0)
        self.assertEqual(differently_segmented["matchedCount"], 2)
        self.assertEqual(differently_segmented["unmatchedReferenceCount"], 0)
        self.assertEqual(differently_segmented["unmatchedHypothesisCount"], 0)

    def test_timing_mapping_handles_split_insert_delete_repeat_and_empty_segments(self):
        split = benchmark.timing_metrics(
            [{"startMs": 100, "endMs": 500, "text": "日本語", "speech": True}],
            [
                {"startMs": 0, "endMs": 10, "text": ""},
                {"startMs": 120, "endMs": 200, "text": "日"},
                {"startMs": 210, "endMs": 300, "text": "本"},
                {"startMs": 310, "endMs": 400, "text": "語"},
                {"startMs": 500, "endMs": 600, "text": "余"},
            ],
            "forced-aligner",
            "qwen3-asr",
        )
        self.assertEqual(split["matchedCount"], 1)
        self.assertEqual(split["unmatchedReferenceCount"], 0)
        self.assertEqual(split["unmatchedHypothesisCount"], 2)
        self.assertEqual(split["medianStartErrorMs"], 20)

        reference = [
            {"startMs": 100, "endMs": 200, "text": "abc", "speech": True},
            {"startMs": 500, "endMs": 600, "text": "ああい", "speech": True},
            {"startMs": 900, "endMs": 1000, "text": "削除", "speech": True},
        ]
        hypothesis = [
            {"startMs": 120, "endMs": 220, "text": "adc"},
            {"startMs": 520, "endMs": 620, "text": "あああい"},
        ]
        edited = benchmark.timing_metrics(reference, hypothesis, "forced-aligner", "qwen3-asr")
        self.assertEqual(edited["matchedCount"], 2)
        self.assertEqual(edited["unmatchedReferenceCount"], 1)
        self.assertEqual(edited["unmatchedHypothesisCount"], 0)
        self.assertEqual(edited["medianStartErrorMs"], 20)
        self.assertEqual(edited, benchmark.timing_metrics(reference, hypothesis, "forced-aligner", "qwen3-asr"))


class BenchmarkManifestTests(unittest.TestCase):
    def setUp(self):
        self.manifest_path = REPO_ROOT / "asr-service" / "benchmarks" / "corpus.example.json"
        self.corpus_root = self.manifest_path.parent

    def _validate_mutation(self, mutate, pattern):
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        mutate(manifest)
        with tempfile.TemporaryDirectory() as temporary:
            candidate = Path(temporary) / "manifest.json"
            candidate.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(benchmark.ContractError, pattern):
                benchmark.validate_manifest(candidate, self.corpus_root)

    def test_example_manifest_derives_reference_only_from_ass(self):
        result = benchmark.validate_manifest(self.manifest_path)
        case = result["cases"][0]
        self.assertEqual(case["id"], "synthetic-parser-fixture-v1")
        self.assertNotIn("referenceText", result["manifest"]["cases"][0])
        self.assertEqual(case["reference"]["text"], "テスト\n一行")
        self.assertEqual(case["reference"]["dialogueCount"], 1)
        self.assertEqual(case["reference"]["segments"][0]["startMs"], 100)
        self.assertEqual(case["reference"]["segments"][0]["endMs"], 900)
        self.assertEqual(case["reference"]["speechIntervals"], [{"startMs": 100, "endMs": 900}])
        self.assertTrue(result["warnings"])

    def test_ass_parser_sorts_timeline_and_strips_ass_markup(self):
        ass = r"""[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Comment: 0,0:00:00.00,0:00:09.00,Default,,0,0,0,,ignored
Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,後,comma
Dialogue: 0,0:00:00.10,0:00:01.00,Default,,0,0,0,,{\an2}前\N行\n次\h語
"""
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reference.ass"
            path.write_text(ass, encoding="utf-16")
            reference = benchmark.parse_ass_reference(path)
        self.assertEqual(reference["text"], "前\n行\n次 語後,comma")
        self.assertEqual([item["startMs"] for item in reference["segments"]], [100, 2000])

    def test_ass_parser_fails_closed_for_invalid_events_contract(self):
        invalid_documents = [
            "[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,text\n",
            "[Events]\nFormat: Start, End, Text, Text\n",
            "[Events]\nFormat: Start, End, Text, Effect\nDialogue: 0:00:00.00,0:00:01.00,text,effect\n",
            "[Events]\nFormat: Start, End, Text\n[Script Info]\n[Events]\nDialogue: 0:00:00.00,0:00:01.00,text\n",
            "[Events]\nFormat: Start, End, Text\nDialogue 0:00:00.00,0:00:01.00,text\n",
            "[Events]\nFormat: Start, End, Text\nDialogue: 0:60:00.00,0:61:00.00,text\n",
        ]
        for document in invalid_documents:
            with self.subTest(document=document.splitlines()[-1]):
                with tempfile.TemporaryDirectory() as temporary:
                    path = Path(temporary) / "reference.ass"
                    path.write_text(document, encoding="utf-8")
                    with self.assertRaises(benchmark.ContractError):
                        benchmark.parse_ass_reference(path)

    def test_duration_class_boundaries_are_frozen(self):
        self.assertEqual(benchmark.duration_class(29_999), "short")
        self.assertIsNone(benchmark.duration_class(30_000))
        self.assertEqual(benchmark.duration_class(300_000), "medium")
        self.assertEqual(benchmark.duration_class(900_000), "medium")
        self.assertIsNone(benchmark.duration_class(900_001))
        self.assertIsNone(benchmark.duration_class(3_600_000))
        self.assertEqual(benchmark.duration_class(3_600_001), "long")

    def test_unsafe_wav_and_ass_keys_are_rejected(self):
        for field in ("audio", "ass"):
            for key in ("C:" + "/private/file", "../file", "./file", "private//file", "file://x", "a\\b", "bad?x"):
                with self.subTest(field=field, key=key):
                    self._validate_mutation(
                        lambda manifest, name=field, value=key: manifest["cases"][0].update({name: value}),
                        "safe POSIX relative key",
                    )

    def test_wav_and_ass_hash_mismatches_are_rejected(self):
        for field, pattern in (("audioSha256", "does not match audio"), ("assSha256", "does not match ASS")):
            with self.subTest(field=field):
                self._validate_mutation(
                    lambda manifest, name=field: manifest["cases"][0].update({name: "0" * 64}),
                    pattern,
                )

    def test_authority_license_and_derivation_fields_are_strict(self):
        mutations = [
            (lambda manifest: manifest.update(notes="private transcript"), "unsupported fields"),
            (lambda manifest: manifest["cases"][0].update(notes="private transcript"), "unsupported fields"),
            (
                lambda manifest: manifest["cases"][0]["referenceDerivation"].update(notes="private transcript"),
                "unsupported fields",
            ),
            (lambda manifest: manifest["cases"][0].update(tags=["clear-japanese", "clear-japanese"]), "duplicates"),
            (lambda manifest: manifest["cases"][0].update(tags=["private-label"]), "unknown coverage labels"),
            (lambda manifest: manifest["cases"][0].update(source="unknown"), "source must be an explicit string"),
            (lambda manifest: manifest["cases"][0].update(license="unknown"), "license must be an explicit string"),
            (lambda manifest: manifest["cases"][0].update(authorizationStatus="unknown"), "authorizationStatus"),
            (
                lambda manifest: manifest["cases"][0]["referenceDerivation"].update(speechConfirmation="inferred"),
                "speechConfirmation must be confirmed",
            ),
            (
                lambda manifest: manifest["cases"][0].update(referenceText="python output"),
                "must derive private reference data from ASS",
            ),
        ]
        for mutate, pattern in mutations:
            with self.subTest(pattern=pattern):
                self._validate_mutation(mutate, pattern)

    def test_manifest_rejects_machine_paths_but_allows_urls(self):
        for field, value in (
            ("description", "captured from " + "C:" + r"\Users\alice\audio.wav"),
            ("source", chr(47) + "home/alice/private/audio.wav"),
            ("license", chr(92) * 2 + r"server\share\license.txt"),
        ):
            with self.subTest(field=field):
                self._validate_mutation(
                    lambda manifest, name=field, text=value: manifest["cases"][0].update({name: text})
                    if name != "description"
                    else manifest.update({name: text}),
                    "must not contain a machine absolute path",
                )
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        manifest["cases"][0]["source"] = "https://example.com/source"
        with tempfile.TemporaryDirectory() as temporary:
            candidate = Path(temporary) / "manifest.json"
            candidate.write_text(json.dumps(manifest), encoding="utf-8")
            benchmark.validate_manifest(candidate, self.corpus_root)

    def test_raw_result_inside_repository_must_be_ignored(self):
        with self.assertRaisesRegex(benchmark.ContractError, "must be covered by .gitignore"):
            benchmark._require_ignored_raw_output(REPO_ROOT / "not-ignored-result.json")
        benchmark._require_ignored_raw_output(REPO_ROOT / ".asr-benchmark" / "results" / "result.json")


class BenchmarkRunnerContractTests(unittest.TestCase):
    def test_offline_guard_is_forced(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            benchmark._force_offline_model_loading()
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
            self.assertEqual(os.environ["TRANSFORMERS_OFFLINE"], "1")

    def test_child_uses_registry_measures_load_and_reduces_refresh(self):
        calls = []

        class Refresh:
            def __init__(self, segments):
                self.segments = tuple(segments)

        class FakeEngine:
            device = "cpu"
            compute_type = None
            use_vad = False
            vad_config = {}

            @staticmethod
            def is_available():
                return True

            @staticmethod
            def is_model_downloaded(_model):
                return True

            def load(self):
                calls.append("load")

            def transcribe(self, audio_path, *, language):
                calls.append(("transcribe", audio_path, language))
                return SimpleNamespace(
                    language="ja",
                    duration_ms=1000,
                    segments=iter([_Segment(0, 500, "preview"), Refresh([_Segment(100, 900, "final")])]),
                )

        def create_engine(*args):
            calls.append(("create", args))
            return FakeEngine()

        engines_package = types.ModuleType("engines")
        engines_package.__path__ = []
        base_module = types.ModuleType("engines.base")
        base_module.TranscriptSegmentRefresh = Refresh
        registry_module = types.ModuleType("engines.registry")
        registry_module.create_engine = create_engine
        request = {
            "engine": "faster-whisper",
            "model": "fake-model",
            "device": "cpu",
            "computeType": None,
            "language": "ja",
            "useVad": False,
            "vadConfig": {},
            "audioPath": "fixture.wav",
            "durationMs": 1000,
            "referenceText": "final",
            "referenceSegments": [{"startMs": 100, "endMs": 900, "text": "final", "speech": True}],
            "speechIntervals": [{"startMs": 100, "endMs": 900}],
            "mode": "cold",
            "repeatCount": 1,
        }
        stdout = io.StringIO()
        modules = {"engines": engines_package, "engines.base": base_module, "engines.registry": registry_module}
        with mock.patch.dict(sys.modules, modules), mock.patch.object(
            sys, "stdin", io.StringIO(json.dumps(request))
        ), mock.patch.object(sys, "stdout", stdout), mock.patch.object(
            benchmark, "environment_metadata", return_value={"os": "test"}
        ), mock.patch.object(
            benchmark,
            "_resource_metadata",
            return_value={
                "peakProcessRssBytes": 123,
                "peakProcessRssMethod": "test",
                "peakProcessRssUnavailableReason": None,
                "vram": {"peakVramBytes": None, "method": None, "unavailableReason": "cpu"},
            },
        ):
            self.assertEqual(benchmark._child_main(), 0)
        response = json.loads(stdout.getvalue().strip().removeprefix(benchmark.CHILD_SENTINEL))
        self.assertEqual(response["status"], "completed")
        self.assertEqual(calls[0][0], "create")
        self.assertEqual(calls.count("load"), 1)
        self.assertEqual(response["samples"][0]["segments"], [{"startMs": 100, "endMs": 900, "text": "final"}])
        self.assertEqual(response["samples"][0]["missingSpeechRegions"], [])

    def test_case_runner_uses_ass_derived_reference_and_separate_processes(self):
        requests = []

        def invoke(request):
            requests.append(copy.deepcopy(request))
            kind = request["mode"]
            values = [0.2] if kind == "cold" else [0.3, 0.1, 0.2]
            return {
                "status": "completed",
                "samples": [{"runKind": kind, "timings": {"inferenceRtf": value}} for value in values],
                "environment": {"os": "test"},
                "dependencyAvailable": True,
                "modelCache": {"status": "ready"},
            }

        case = {
            "id": "case-v1",
            "audio": "fixture.wav",
            "ass": "fixture.ass",
            "audioSha256": "a" * 64,
            "assSha256": "b" * 64,
            "durationMs": 1000,
            "durationClass": "short",
            "dialogueCount": 1,
            "tags": ["clear-japanese"],
            "referenceDerivation": {"type": "ass-dialogue-v1", "speechConfirmation": "confirmed"},
            "reference": {
                "text": "日本語",
                "segments": [{"startMs": 0, "endMs": 1000, "text": "日本語", "speech": True}],
                "speechIntervals": [{"startMs": 0, "endMs": 1000}],
                "dialogueCount": 1,
                "textSha256": "c" * 64,
                "normalizedTextSha256": "d" * 64,
            },
        }
        args = SimpleNamespace(
            engine="faster-whisper", model="large-v3", device="cpu", compute_type=None,
            language="ja", use_vad=False, hf_home="cache",
        )
        with mock.patch.object(benchmark, "_invoke_child", side_effect=invoke):
            result, environment = benchmark._case_result(case, Path("fixture.wav"), args, 3)
        self.assertEqual([request["mode"] for request in requests], ["cold", "warm"])
        self.assertEqual([request["repeatCount"] for request in requests], [1, 3])
        self.assertEqual(requests[0]["referenceText"], "日本語")
        self.assertEqual(requests[0]["speechIntervals"], [{"startMs": 0, "endMs": 1000}])
        self.assertEqual(result["warmInferenceRtfMedian"], 0.2)
        self.assertEqual(result["assSha256"], "b" * 64)
        self.assertEqual(environment, {"os": "test"})


class BenchmarkReportTests(unittest.TestCase):
    def test_report_is_deterministic_sanitized_and_supports_both_candidate_kinds(self):
        sensitive_value = "sec" + "ret"
        private_root = "C:" + r"\Users\alice"
        base = {
            "schemaVersion": 1,
            "kind": benchmark.RESULT_KIND,
            "candidateKind": "python-reference",
            "engine": "qwen3-asr",
            "model": private_root + r"\private-model",
            "device": "cpu",
            "runtime": {"hfHome": private_root + r"\cache"},
            "manifest": {
                "corpusId": "private-corpus-v1",
                "sha256": "b" * 64,
                "durationClasses": ["short", "medium", "long"],
                "coverageTags": [
                    "background-noise",
                    "clear-japanese",
                    "continuous-speech-over-30s",
                    "english",
                    "long-silence",
                    "numbers",
                    "proper-nouns",
                    "rapid-dialogue",
                ],
            },
            "cases": [
                {
                    "caseId": "private-case",
                    "audioSha256": "a" * 64,
                    "assSha256": "c" * 64,
                    "dialogueCount": 1,
                    "durationMs": 1000,
                    "durationClass": "short",
                    "tags": ["clear-japanese"],
                    "status": "failed",
                    "error": {
                        "classification": "inference-failed",
                        "message": "private transcript at " + private_root + "/audio.wav token=" + sensitive_value,
                    },
                    "dependencyAvailable": True,
                    "modelCache": {"status": "ready"},
                    "reproductionCommand": "python " + private_root + r"\runner.py --token=" + sensitive_value,
                    "referenceText": "private transcript",
                    "referenceSegments": [{"startMs": 0, "endMs": 1000, "text": "private transcript", "speech": True}],
                    "samples": [
                        {
                            "runKind": "cold",
                            "cer": {"cer": 0.0},
                            "timeline": {"emptyTextCount": 1},
                            "missingSpeechRegions": [],
                            "timings": {"totalRtf": 0.1},
                            "timestampProvenance": "forced-aligner",
                        }
                    ],
                    "warmInferenceRtfMedian": None,
                }
            ],
        }
        native = copy.deepcopy(base)
        native["candidateKind"] = "native-candidate"
        native["engine"] = "parakeet"
        first = benchmark.render_markdown([base, native])
        second = benchmark.render_markdown([copy.deepcopy(base), copy.deepcopy(native)])
        self.assertEqual(first, second)
        self.assertNotIn("private transcript", first)
        self.assertNotIn("Users", first)
        self.assertNotIn(sensitive_value, first)
        self.assertNotIn("\\cache", first)
        self.assertIn("redacted-model", first)
        self.assertIn("python-reference", first)
        self.assertIn("native-candidate", first)
        self.assertIn("optional diagnostic only", first)
        self.assertIn("User-reviewed T01 budgets are frozen", first)
        self.assertIn("current-implementation diagnostics only", first)
        self.assertIn("Python-reference duration classes not recorded: long, medium", first)
        self.assertIn("Missing coverage tags: low-volume, person-names", first)
        self.assertIn("| failed | 0.000 | 1 | 0 | 0.100 |", first)
        self.assertNotIn("proposed and unfrozen", first)
        self.assertIn("c" * 64, first)


if __name__ == "__main__":
    unittest.main()
