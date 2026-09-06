"""The seeding script refuses unsafe roots before importing the core."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts/seed_desktop_fixture.py"


class SeedFixtureGuards(unittest.TestCase):
    def run_script(self, *args):
        return subprocess.run(
            [sys.executable, "-I", "-B", str(SCRIPT), *args],
            capture_output=True,
            text=True,
            timeout=30,
        )

    def test_rejects_relative_missing_or_nonempty_roots_before_seeding(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "occupied").write_text("x")
            for arguments in [
                ("relative/root", "[]"),
                (str(root / "missing"), "[]"),
                (str(root), "[]"),
                (str(root), "not json"),
            ]:
                result = self.run_script(*arguments)
                self.assertNotEqual(result.returncode, 0, arguments)
                self.assertNotIn("Traceback", result.stderr)

    def test_usage_requires_two_arguments(self):
        self.assertNotEqual(self.run_script().returncode, 0)


if __name__ == "__main__":
    unittest.main()
