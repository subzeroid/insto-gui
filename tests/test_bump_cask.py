"""The cask bump rewrites exactly the version and the two digests, or refuses."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts import bump_cask

REPO = Path(__file__).resolve().parents[1]
ARM = "a" * 64
INTEL = "b" * 64
CASK = f"""cask "insto" do
  version "0.1.9"

  on_arm do
    sha256 "{"1" * 64}"

    url "https://github.com/subzeroid/insto-gui/releases/download/v#{{version}}/insto_#{{version}}_aarch64.dmg"
  end
  on_intel do
    sha256 "{"2" * 64}"

    url "https://github.com/subzeroid/insto-gui/releases/download/v#{{version}}/insto_#{{version}}_x64.dmg"
  end

  name "insto"
  app "insto.app"
end
"""
SUMS = f"{ARM}  insto_0.2.0_aarch64.dmg\n{INTEL}  insto_0.2.0_x64.dmg\n"


class ReadSums(unittest.TestCase):
    def test_picks_the_two_dmgs_of_the_version(self):
        self.assertEqual(bump_cask.read_sums(SUMS + "c" * 64 + "  insto_0.1.9_x64.dmg\n", "0.2.0"), (ARM, INTEL))

    def test_missing_or_malformed_lines_are_errors(self):
        with self.assertRaises(ValueError):
            bump_cask.read_sums(f"{ARM}  insto_0.2.0_aarch64.dmg\n", "0.2.0")
        with self.assertRaises(ValueError):
            bump_cask.read_sums(SUMS.replace(INTEL, "zz"), "0.2.0")
        with self.assertRaises(ValueError):
            bump_cask.read_sums(SUMS + SUMS, "0.2.0")


class Rewrite(unittest.TestCase):
    def test_changes_only_the_three_values(self):
        after = bump_cask.rewrite(CASK, "0.2.0", ARM, INTEL)
        self.assertIn('version "0.2.0"', after)
        self.assertIn(f'sha256 "{ARM}"', after)
        self.assertIn(f'sha256 "{INTEL}"', after)
        self.assertEqual(after.count("sha256"), 2)
        # Everything else — urls with #{version}, name, app — is byte-identical.
        strip = lambda s: [l for l in s.splitlines() if "version \"" not in l and "sha256" not in l]  # noqa: E731
        self.assertEqual(strip(after), strip(CASK))

    def test_an_unexpected_cask_shape_is_refused(self):
        with self.assertRaises(ValueError):
            bump_cask.rewrite(CASK.replace("on_intel", "on_x86"), "0.2.0", ARM, INTEL)
        with self.assertRaises(ValueError):
            bump_cask.rewrite(CASK + '  version "9.9.9"\n', "0.2.0", ARM, INTEL)


class Cli(unittest.TestCase):
    def run_cli(self, version, sums, cask):
        return subprocess.run(
            [sys.executable, "-B", "-m", "scripts.bump_cask", "--version", version, "--sums", str(sums), "--cask", str(cask)],
            cwd=REPO, capture_output=True, text=True,
        )

    def test_rewrites_then_reports_nothing_to_do(self):
        with tempfile.TemporaryDirectory() as tmp:
            sums, cask = Path(tmp, "SHA256SUMS"), Path(tmp, "insto.rb")
            sums.write_text(SUMS)
            cask.write_text(CASK)
            first = self.run_cli("0.2.0", sums, cask)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertIn('version "0.2.0"', cask.read_text())
            second = self.run_cli("0.2.0", sums, cask)
            self.assertEqual(second.returncode, 3)
            self.assertIn("already at 0.2.0", second.stdout)

    def test_bad_version_or_sums_exit_1(self):
        with tempfile.TemporaryDirectory() as tmp:
            sums, cask = Path(tmp, "SHA256SUMS"), Path(tmp, "insto.rb")
            sums.write_text(SUMS)
            cask.write_text(CASK)
            self.assertEqual(self.run_cli("v0.2.0", sums, cask).returncode, 1)
            self.assertEqual(self.run_cli("0.3.0", sums, cask).returncode, 1)
            self.assertEqual(cask.read_text(), CASK)


if __name__ == "__main__":
    unittest.main()
