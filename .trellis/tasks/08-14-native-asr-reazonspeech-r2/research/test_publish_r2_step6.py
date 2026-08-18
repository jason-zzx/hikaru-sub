#!/usr/bin/env python3
"""Mutation tests for Reazon R2 Step 6 lane attribution."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import tempfile
import unittest

import publish_r2_step6 as publisher


class Step6PublisherMutationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest, cls.index, cls.entries, cls.observed = publisher.load()

    def assert_rejected(self, mutate) -> None:
        index = copy.deepcopy(self.index)
        with tempfile.TemporaryDirectory(dir=publisher.LOCAL) as directory:
            root = Path(directory)
            mutate(index, root)
            path = root / "validation-index.json"
            path.write_text(
                json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
                newline="\n",
            )
            with self.assertRaises(RuntimeError):
                publisher.load(path)

    def test_lane_swap_is_rejected(self) -> None:
        def mutate(index: dict, _: Path) -> None:
            entries = {entry["label"]: entry for entry in index["entries"]}
            entries["lane-success"]["lane"], entries["lane-pre-ready-negative"]["lane"] = (
                entries["lane-pre-ready-negative"]["lane"],
                entries["lane-success"]["lane"],
            )

        self.assert_rejected(mutate)

    def test_command_and_environment_mutations_are_rejected(self) -> None:
        for field in ("command", "environment"):
            with self.subTest(field=field):
                def mutate(index: dict, _: Path, field: str = field) -> None:
                    entry = next(item for item in index["entries"] if item["label"] == "lane-success")
                    if field == "command":
                        entry["command"].append("--mutated")
                    else:
                        entry["environment"]["HIKARU_ASR_R2_STEP6_LANE"] = "cancellation"

                self.assert_rejected(mutate)

    def test_duplicated_protocol_as_policy_evidence_is_rejected(self) -> None:
        def mutate(index: dict, _: Path) -> None:
            entries = {entry["label"]: entry for entry in index["entries"]}
            entries["lane-post-ready-policy"]["log"] = copy.deepcopy(
                entries["lane-post-ready-protocol"]["log"]
            )

        self.assert_rejected(mutate)

    def test_log_header_mismatch_is_rejected(self) -> None:
        entry = self.entries["lane-success"]
        source = publisher.safe_local(entry["log"]["path"])
        with tempfile.TemporaryDirectory(dir=publisher.LOCAL) as directory:
            lines = source.read_text(encoding="utf-8").splitlines(keepends=True)
            header = json.loads(lines[0].removeprefix(publisher.HEADER_PREFIX))
            header["payload"]["laneId"] = "cancellation"
            lines[0] = publisher.HEADER_PREFIX + publisher.canonical_json(header) + "\n"
            log = Path(directory) / "lane-success-mutated.log"
            log.write_text("".join(lines), encoding="utf-8", newline="\n")
            with self.assertRaisesRegex(RuntimeError, "header digest mismatch"):
                publisher.parse_lane_log(log)

    def test_render_is_deterministic_and_uses_observed_records(self) -> None:
        first = publisher.render(self.manifest, self.entries, self.observed)
        second = publisher.render(self.manifest, self.entries, self.observed)
        self.assertEqual(first, second)
        self.assertIn("Observed status", first)
        self.assertIn(f"`{self.observed['cancellation']['cancellationElapsedMs']}ms`", first)


if __name__ == "__main__":
    unittest.main()
