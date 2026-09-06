"""The seeding script refuses unsafe roots and malformed rows before importing the core."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts/seed_desktop_fixture.py"
USAGE = "usage: seed_desktop_fixture.py ROOT ROWS_JSON"
ROOT_MESSAGE = "root must be an existing canonical absolute directory"
PRIVATE_MESSAGE = "root must be private (0700), owned and empty"
JSON_MESSAGE = "rows must be JSON"
SHAPE_MESSAGE = "rows must be [{pk, stamp, fields}]"
MALFORMED_ROWS = [
    '[{"pk":"7"}]',
    '[{"pk":"7","stamp":"x","fields":{}}]',
    '[{"pk":7,"stamp":1,"fields":{}}]',
    '[{"pk":"7","stamp":true,"fields":{}}]',
]


class SeedFixtureGuards(unittest.TestCase):
    def run_script(self, *args):
        return subprocess.run(
            [sys.executable, "-I", "-B", str(SCRIPT), *args],
            capture_output=True,
            text=True,
            timeout=30,
        )

    def assert_guard(self, message, *args):
        result = self.run_script(*args)
        self.assertEqual(result.returncode, 2, (args, result.stderr))
        self.assertTrue(result.stderr.startswith(message), (args, result.stderr))
        self.assertNotIn("Traceback", result.stderr)

    def test_rejects_relative_missing_or_nonempty_roots_before_seeding(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            root.chmod(0o700)
            (root / "occupied").write_text("x")
            self.assert_guard(ROOT_MESSAGE, "relative/root", "[]")
            self.assert_guard(ROOT_MESSAGE, str(root / "missing"), "[]")
            self.assert_guard(PRIVATE_MESSAGE, str(root), "[]")

    def test_rejects_malformed_rows_without_touching_an_empty_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            root.chmod(0o700)
            self.assert_guard(JSON_MESSAGE, str(root), "not json")
            for rows in MALFORMED_ROWS:
                self.assert_guard(SHAPE_MESSAGE, str(root), rows)
            self.assertEqual(list(root.iterdir()), [])

    def test_usage_requires_two_arguments(self):
        self.assert_guard(USAGE)


if __name__ == "__main__":
    unittest.main()
