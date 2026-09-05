import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from scripts import prepare_runtime as builder


class UnpackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def archive(self, members):
        archive = self.root / "archive.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            for name, kind, target in members:
                info = tarfile.TarInfo(name)
                info.type = kind
                if kind == tarfile.REGTYPE:
                    info.size = len(target)
                    tar.addfile(info, io.BytesIO(target))
                else:
                    info.linkname = target
                    tar.addfile(info)
        return archive

    def test_normal_internal_link(self):
        archive = self.archive(
            [
                ("python/bin/python3.12", tarfile.REGTYPE, b"binary"),
                ("python/bin/python3", tarfile.SYMTYPE, "python3.12"),
            ]
        )
        destination = self.root / "out"
        builder.unpack(archive, destination)
        self.assertEqual((destination / "python/bin/python3").read_bytes(), b"binary")
        self.assertEqual(destination.stat().st_mode & 0o777, 0o700)

    def test_hostile_archives(self):
        cases = [
            [("/python/a", tarfile.REGTYPE, b"x")],
            [("python/../a", tarfile.REGTYPE, b"x")],
            [("other/a", tarfile.REGTYPE, b"x")],
            [("python/a", tarfile.LNKTYPE, "python/b")],
            [("python/a", tarfile.FIFOTYPE, "")],
            [("python/a", tarfile.SYMTYPE, "../../outside")],
            [("python/a", tarfile.SYMTYPE, "/tmp/outside")],
            [("python/a", tarfile.SYMTYPE, "missing")],
            [("python/a", tarfile.SYMTYPE, "b"), ("python/b", tarfile.SYMTYPE, "a")],
        ]
        for index, members in enumerate(cases):
            with (
                self.subTest(members=members),
                self.assertRaises((ValueError, tarfile.TarError)),
            ):
                builder.unpack(self.archive(members), self.root / str(index))

    def test_budgets(self):
        archive = self.archive(
            [("python/a", tarfile.REGTYPE, b"12"), ("python/b", tarfile.REGTYPE, b"12")]
        )
        for index, limit in enumerate(
            ("MAX_MEMBERS", "MAX_MEMBER_BYTES", "MAX_TOTAL_BYTES")
        ):
            with patch.object(builder, limit, 1), self.assertRaises(ValueError):
                builder.unpack(archive, self.root / str(index))

    def test_fetch_hash_exclusive_and_budget(self):
        output = self.root / "download"
        with patch.object(
            builder.urllib.request, "urlopen", return_value=io.BytesIO(b"abc")
        ):
            builder.fetch(
                "https://example.test/file", hashlib.sha256(b"abc").hexdigest(), output
            )
        with self.assertRaises(FileExistsError):
            builder.fetch("https://example.test/file", "bad", output)
        with patch.object(
            builder.urllib.request, "urlopen", return_value=io.BytesIO(b"abc")
        ):
            with self.assertRaises(ValueError):
                builder.fetch("https://example.test/file", "bad", self.root / "bad")
        with (
            patch.object(builder, "MAX_DOWNLOAD_BYTES", 2),
            patch.object(
                builder.urllib.request, "urlopen", return_value=io.BytesIO(b"abc")
            ),
            self.assertRaises(ValueError),
        ):
            builder.fetch("https://example.test/file", "bad", self.root / "big")


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.core = self.root / "core"
        self.core.mkdir()
        self.repo = self.root / "repo"
        (self.repo / "packaging").mkdir(parents=True)
        (self.repo / "packaging/python-distributions.json").write_text(
            json.dumps(
                {
                    "python_version": "3.12.14",
                    "targets": {
                        "arm64": {"url": "https://example.test/python", "sha256": "abc"}
                    },
                }
            )
        )
        self.output = self.repo / ".build/runtime"
        self.calls = []
        for target, value in (("REPO_ROOT", self.repo),):
            p = patch.object(builder, target, value)
            p.start()
            self.addCleanup(p.stop)
        for target, value in (("system", "Darwin"), ("machine", "arm64")):
            p = patch.object(builder.platform, target, return_value=value)
            p.start()
            self.addCleanup(p.stop)

    def run_fake(self, args, *, cwd):
        self.calls.append(args)
        self.assertFalse((self.output / "manifest.json").exists())
        if args[:2] == ["git", "status"]:
            return ""
        if args[:2] == ["git", "rev-parse"]:
            return "a" * 40
        if args[:2] == ["uv", "--version"]:
            return "uv 0.8.13"
        if args[:2] == ["uv", "export"]:
            Path(args[args.index("--output-file") + 1]).write_text(
                "locked==1 --hash=sha256:abc\n"
            )
        if args[:2] == ["uv", "build"]:
            wheel_dir = Path(args[args.index("--out-dir") + 1])
            wheel_dir.mkdir(exist_ok=True)
            (wheel_dir / "insto-0.1-py3-none-any.whl").write_bytes(b"wheel")
        return ""

    def fake_unpack(self, archive, destination):
        (destination / "python/bin").mkdir(parents=True)
        (destination / "python/bin/python3.12").write_bytes(b"binary")
        (destination / "python/bin/python3").symlink_to("python3.12")
        (destination / "python/LICENSE").write_text("license")

    def test_build_flags_metadata_and_manifest_last(self):
        with (
            patch.object(builder, "run", side_effect=self.run_fake),
            patch.object(builder, "fetch"),
            patch.object(builder, "unpack", side_effect=self.fake_unpack),
        ):
            builder.build(self.core, self.output)
        manifest = json.loads((self.output / "manifest.json").read_text())
        self.assertEqual(manifest["inputs"]["architecture"], "arm64")
        self.assertEqual(manifest["inputs"]["python_version"], "3.12.14")
        self.assertEqual(
            manifest["inputs"]["core_wheel_sha256"],
            hashlib.sha256(b"wheel").hexdigest(),
        )
        self.assertEqual(
            manifest["inputs"]["requirements_sha256"],
            hashlib.sha256((self.output / "requirements.txt").read_bytes()).hexdigest(),
        )
        self.assertFalse((self.output / "python/bin/python3").is_symlink())
        self.assertTrue((self.output / "python/LICENSE").exists())
        exports = [call for call in self.calls if call[:2] == ["uv", "export"]]
        self.assertIn("--no-default-groups", exports[0])
        self.assertIn("--no-dev", exports[0])
        self.assertIn("--only-group", exports[1])
        self.assertTrue(all("--frozen" in call for call in exports))
        wheel = next(call for call in self.calls if call[:2] == ["uv", "build"])
        self.assertIn("--build-constraints", wheel)
        self.assertIn("--require-hashes", wheel)
        installs = [call for call in self.calls if "install" in call]
        self.assertEqual(len(installs), 2)
        self.assertIn("--require-hashes", installs[0])
        self.assertTrue(all("--no-compile" in call for call in installs))
        self.assertTrue(
            all("build-constraints.txt" not in str(call) for call in installs)
        )
        supplied = manifest.pop("build_id")
        self.assertEqual(
            supplied,
            hashlib.sha256(
                json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest(),
        )

    def test_boundary(self):
        for output in (
            self.root / "outside",
            self.repo / ".build/deep/runtime",
            self.repo / ".build",
        ):
            with (
                self.subTest(output=output),
                patch.object(builder, "run", side_effect=self.run_fake),
                self.assertRaises(ValueError),
            ):
                builder.build(self.core, output)

    def test_dirty_core_and_architecture(self):
        with (
            patch.object(builder, "run", return_value=" M uv.lock"),
            self.assertRaises(ValueError),
        ):
            builder.build(self.core, self.output)
        with (
            patch.object(builder.platform, "machine", return_value="unknown"),
            self.assertRaises(ValueError),
        ):
            builder.build(self.core, self.output)

    def test_failure_retains_output_without_manifest(self):
        with (
            patch.object(builder, "run", side_effect=self.run_fake),
            patch.object(builder, "fetch", side_effect=RuntimeError("download failed")),
            self.assertRaises(RuntimeError),
        ):
            builder.build(self.core, self.output)
        self.assertTrue(self.output.is_dir())
        self.assertFalse((self.output / "manifest.json").exists())

    def test_directory_symlink_rejected_by_builder(self):
        def linked_unpack(archive, destination):
            self.fake_unpack(archive, destination)
            (destination / "python/linked-bin").symlink_to(
                "bin", target_is_directory=True
            )

        with (
            patch.object(builder, "run", side_effect=self.run_fake),
            patch.object(builder, "fetch"),
            patch.object(builder, "unpack", side_effect=linked_unpack),
            self.assertRaises(ValueError),
        ):
            builder.build(self.core, self.output)
        self.assertFalse((self.output / "manifest.json").exists())

    def test_existing_output_and_unsafe_build_root(self):
        build_root = self.output.parent
        build_root.mkdir(mode=0o700)
        self.output.mkdir()
        with (
            patch.object(builder, "run", side_effect=self.run_fake),
            self.assertRaises(ValueError),
        ):
            builder.build(self.core, self.output)
        build_root.chmod(0o755)
        with (
            patch.object(builder, "run", side_effect=self.run_fake),
            self.assertRaises(ValueError),
        ):
            builder.build(self.core, build_root / "other")

    def test_run_contract(self):
        with patch.object(builder.subprocess, "run") as subprocess_run:
            subprocess_run.return_value.stdout = " value\n"
            self.assertEqual(builder.run(["tool", "argument"], cwd=self.core), "value")
        subprocess_run.assert_called_once_with(
            ["tool", "argument"],
            cwd=self.core,
            check=True,
            timeout=600,
            capture_output=True,
            text=True,
        )
