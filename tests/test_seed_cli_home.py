import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.seed_cli_home import REPO, TOKEN, check_target


class SeedCliHomeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name).resolve()

    def tearDown(self):
        self.temp.cleanup()

    def test_token_is_an_offline_fixture_value(self):
        self.assertEqual(TOKEN, "isolated-migration-credential")
        self.assertTrue(4 <= len(TOKEN) <= 4096)
        self.assertTrue(all(33 <= ord(character) <= 126 for character in TOKEN))

    def test_accepts_a_new_child_of_a_private_owned_parent(self):
        self.base.chmod(0o700)
        check_target(self.base / "cli home")

    def test_refuses_a_relative_or_noncanonical_target(self):
        self.base.chmod(0o700)
        for target in (Path("cli home"), self.base / ".." / self.base.name / "cli home"):
            with self.assertRaises(SystemExit) as caught:
                check_target(target)
            self.assertEqual(caught.exception.code, 2)

    def test_refuses_an_existing_target(self):
        self.base.chmod(0o700)
        existing = self.base / "cli home"
        existing.mkdir(mode=0o700)
        with self.assertRaises(SystemExit):
            check_target(existing)

    def test_refuses_a_group_or_world_writable_parent(self):
        self.base.chmod(0o777)
        with self.assertRaises(SystemExit):
            check_target(self.base / "cli home")

    def test_refuses_a_parent_that_is_a_desktop_root(self):
        self.base.chmod(0o700)
        for marker in ("desktop-state.json", "desktop-home.json", ".desktop.lock"):
            path = self.base / marker
            path.write_bytes(b"")
            with self.assertRaises(SystemExit):
                check_target(self.base / "cli home")
            path.unlink()

    def test_usage_error_exits_two_without_importing_insto(self):
        result = subprocess.run(
            [sys.executable, "-I", "-B", str(REPO / "scripts/seed_cli_home.py")],
            capture_output=True,
            cwd=REPO,
            env={"PATH": "/usr/bin:/bin", "HOME": str(self.base)},
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b"")
        self.assertIn(b"usage: seed_cli_home.py HOME", result.stderr)


if __name__ == "__main__":
    unittest.main()
