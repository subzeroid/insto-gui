"""The runtime inside a built application bundle must match its own manifest."""

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.runtime_manifest import describe
from scripts import verify_app_runtime as verifier

REPO = Path(__file__).resolve().parents[1]


class VerifyAppRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name).resolve() / "insto.app"
        self.runtime = self.app / "Contents/Resources/runtime"
        python = self.runtime / "python"
        (python / "bin").mkdir(parents=True)
        (python / "bin/python3").write_bytes(b"fixture executable")
        (python / "bin/python3").chmod(0o755)
        (python / "LICENSE").write_text("fixture license\n")
        pin = json.loads((REPO / "packaging/core-pin.json").read_text())
        pins = json.loads((REPO / "packaging/python-distributions.json").read_text())
        self.manifest = {
            "manifest_version": 1,
            "inputs": {
                "core_commit": pin["core_commit"],
                "core_wheel_name": f"insto-{pin['core_version']}-py3-none-any.whl",
                "core_wheel_sha256": "a" * 64,
                "requirements_sha256": "b" * 64,
                "build_constraints_sha256": "c" * 64,
                "uv_version": "uv 0.8.13",
                "architecture": "arm64",
                "python_version": pins["python_version"],
                "upstream_url": pins["targets"]["arm64"]["url"],
                "upstream_sha256": pins["targets"]["arm64"]["sha256"],
            },
            "files": describe(python),
        }
        canonical = json.dumps(self.manifest, sort_keys=True, separators=(",", ":")).encode()
        self.manifest["build_id"] = hashlib.sha256(canonical).hexdigest()
        (self.runtime / "manifest.json").write_text(json.dumps(self.manifest) + "\n")
        (self.runtime / "manifest.json").chmod(0o644)

    def test_intact_bundle_passes_and_reports_build_id(self):
        result = verifier.verify_app(self.app)
        self.assertEqual(result["build_id"], self.manifest["build_id"])
        self.assertEqual(result["inputs"]["architecture"], "arm64")

    def test_one_changed_byte_fails(self):
        target = self.runtime / "python/LICENSE"
        target.write_text("fixture licensE\n")
        with self.assertRaisesRegex(ValueError, "Runtime inventory mismatch"):
            verifier.verify_app(self.app)

    def test_extra_file_fails(self):
        (self.runtime / "python/extra").write_text("x")
        with self.assertRaisesRegex(ValueError, "Unexpected runtime entry"):
            verifier.verify_app(self.app)

    def test_missing_manifest_fails(self):
        (self.runtime / "manifest.json").unlink()
        with self.assertRaisesRegex(ValueError, "no runtime manifest"):
            verifier.verify_app(self.app)

    def test_missing_runtime_directory_fails(self):
        import shutil

        shutil.rmtree(self.runtime)
        with self.assertRaisesRegex(ValueError, "no runtime directory"):
            verifier.verify_app(self.app)

    def test_non_app_path_is_refused(self):
        with self.assertRaisesRegex(ValueError, "canonical .app"):
            verifier.verify_app(self.app.parent)

    def test_cli_prints_one_json_line(self):
        result = subprocess.run(
            [sys.executable, "-B", "-m", "scripts.verify_app_runtime", str(self.app)],
            cwd=REPO, capture_output=True, text=True, check=True,
        )
        lines = result.stdout.splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0]), {"build_id": self.manifest["build_id"], "architecture": "arm64"})

    def test_cli_fails_on_mismatch(self):
        (self.runtime / "python/LICENSE").write_text("fixture licensE\n")
        result = subprocess.run(
            [sys.executable, "-B", "-m", "scripts.verify_app_runtime", str(self.app)],
            cwd=REPO, capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("Runtime inventory mismatch", result.stderr)


if __name__ == "__main__":
    unittest.main()
