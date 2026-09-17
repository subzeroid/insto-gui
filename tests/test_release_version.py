"""package.json, src-tauri/Cargo.toml and tauri.conf.json must carry one version."""

import json
import tempfile
import unittest
from pathlib import Path

from scripts import release_version

REPO = Path(__file__).resolve().parents[1]


def write_repo(root: Path, npm: str, cargo: str, tauri: str) -> None:
    (root / "src-tauri").mkdir(parents=True)
    (root / "package.json").write_text(json.dumps({"name": "insto-gui", "version": npm}))
    (root / "src-tauri/Cargo.toml").write_text(
        f'[package]\nname = "insto-gui"\nversion = "{cargo}"\nedition = "2021"\n\n'
        '[build-dependencies]\ntauri-build = { version = "=2.6.3", features = [] }\n'
    )
    (root / "src-tauri/tauri.conf.json").write_text(
        json.dumps({"productName": "insto", "version": tauri})
    )


class ReleaseVersionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_agreeing_files_yield_the_version(self):
        write_repo(self.root, "0.1.0", "0.1.0", "0.1.0")
        self.assertEqual(release_version.read_version(self.root), "0.1.0")

    def test_disagreeing_files_are_an_error(self):
        write_repo(self.root, "0.1.0", "0.1.1", "0.1.0")
        with self.assertRaisesRegex(ValueError, "disagree"):
            release_version.read_version(self.root)

    def test_dependency_version_line_is_not_mistaken_for_the_package(self):
        (self.root / "src-tauri").mkdir(parents=True)
        (self.root / "package.json").write_text(
            json.dumps({"name": "insto-gui", "version": "0.1.0"})
        )
        (self.root / "src-tauri/Cargo.toml").write_text(
            '[dependencies.tauri]\nversion = "2.0.0"\n\n'
            '[package]\nname = "insto-gui"\nversion = "0.1.0"\nedition = "2021"\n'
        )
        (self.root / "src-tauri/tauri.conf.json").write_text(
            json.dumps({"productName": "insto", "version": "0.1.0"})
        )
        self.assertEqual(release_version.read_version(self.root), "0.1.0")

    def test_missing_package_table_is_an_error(self):
        (self.root / "src-tauri").mkdir(parents=True)
        (self.root / "package.json").write_text(
            json.dumps({"name": "insto-gui", "version": "0.1.0"})
        )
        (self.root / "src-tauri/Cargo.toml").write_text(
            '[dependencies.tauri]\nversion = "2.0.0"\n'
        )
        (self.root / "src-tauri/tauri.conf.json").write_text(
            json.dumps({"productName": "insto", "version": "0.1.0"})
        )
        with self.assertRaisesRegex(ValueError, r"no \[package\] version"):
            release_version.read_version(self.root)

    def test_tag_must_match(self):
        write_repo(self.root, "0.1.0", "0.1.0", "0.1.0")
        release_version.check_tag(self.root, "v0.1.0")
        with self.assertRaisesRegex(ValueError, "Tag v0.2.0"):
            release_version.check_tag(self.root, "v0.2.0")

    def test_real_repository_agrees(self):
        self.assertEqual(release_version.read_version(REPO), "0.1.0")


if __name__ == "__main__":
    unittest.main()
