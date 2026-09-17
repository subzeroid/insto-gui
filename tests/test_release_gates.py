"""The release gate script's argument contract and its refusal to be destructive off CI."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "packaging/release-gates.sh"


def run(*args):
    env = {key: value for key, value in os.environ.items() if key != "CI"}
    return subprocess.run([str(SCRIPT), *args], capture_output=True, text=True, env=env)


class ReleaseGatesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.evidence = Path(self.temp.name) / "evidence.jsonl"

    def test_missing_arguments_exit_2(self):
        result = run("--stage", "artifacts")
        self.assertEqual(result.returncode, 2)
        self.assertIn("missing arguments", result.stderr)
        self.assertFalse(self.evidence.exists())

    def test_unknown_stage_exits_2(self):
        result = run("--stage", "bogus", "--dmg", "x.dmg", "--target", "t", "--evidence", str(self.evidence))
        self.assertEqual(result.returncode, 2)
        self.assertIn("unknown stage", result.stderr)

    def test_install_stage_refuses_outside_ci(self):
        result = run("--stage", "install", "--dmg", "x.dmg", "--target", "t", "--evidence", str(self.evidence))
        self.assertEqual(result.returncode, 2)
        self.assertIn("throwaway", result.stderr)
        self.assertFalse(self.evidence.exists())

    def test_failed_gate_writes_fail_line_and_exits_1(self):
        app = Path(self.temp.name) / "insto.app"
        (app / "Contents/MacOS").mkdir(parents=True)
        (app / "Contents/MacOS/insto").write_bytes(b"not a mach-o")
        result = run(
            "--stage", "artifacts",
            "--dmg", str(Path(self.temp.name) / "missing.dmg"),
            "--app", str(app), "--target", "t", "--evidence", str(self.evidence),
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("GATE FAILED: signature_intact", result.stderr)
        lines = [json.loads(line) for line in self.evidence.read_text().splitlines()]
        self.assertEqual(lines, [{"gate": "signature_intact", "result": "fail", "target": "t"}])

    def test_exit_trap_does_not_swallow_the_failing_gate_s_status(self):
        """The cleanup EXIT trap must re-raise the gate's exit code, not its own."""
        app = Path(self.temp.name) / "insto.app"
        (app / "Contents/MacOS").mkdir(parents=True)
        (app / "Contents/MacOS/insto-gui").write_bytes(b"not a mach-o")
        result = run(
            "--stage", "artifacts",
            "--dmg", str(Path(self.temp.name) / "missing.dmg"),
            "--app", str(app), "--target", "t", "--evidence", str(self.evidence),
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("GATE FAILED: signature_intact", result.stderr)
        lines = [json.loads(line) for line in self.evidence.read_text().splitlines()]
        self.assertEqual(lines, [{"gate": "signature_intact", "result": "fail", "target": "t"}])


if __name__ == "__main__":
    unittest.main()
