import hashlib
import errno
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from scripts.runtime_manifest import describe, verify
from scripts import stage_app_runtime as stager
from scripts import app_manifest


class StageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name).resolve()
        self.source = self.repo / ".build/runtime-c1-01"
        self.destination = self.repo / ".build/app-resources/runtime"
        self.source.mkdir(parents=True, mode=0o700)
        self.source.parent.chmod(0o700)
        self.python = self.source / "python"
        (self.python / "bin").mkdir(parents=True)
        (self.python / "bin/python3").write_bytes(b"fixture executable")
        (self.python / "bin/python3").chmod(0o755)
        (self.python / "LICENSE").write_text("fixture license\n")
        (self.repo / "packaging").mkdir()
        for name in ("core-pin.json", "python-distributions.json"):
            shutil.copyfile(
                stager.REPO_ROOT / "packaging" / name, self.repo / "packaging" / name
            )
        self.pin = json.loads((self.repo / "packaging/core-pin.json").read_text())
        pins = json.loads(
            (self.repo / "packaging/python-distributions.json").read_text()
        )
        self.manifest = {
            "manifest_version": 1,
            "inputs": {
                "core_commit": self.pin["core_commit"],
                "core_wheel_name": f"insto-{self.pin['core_version']}-py3-none-any.whl",
                "core_wheel_sha256": "a" * 64,
                "requirements_sha256": "b" * 64,
                "build_constraints_sha256": "c" * 64,
                "uv_version": "uv 0.8.13",
                "architecture": "arm64",
                "python_version": pins["python_version"],
                "upstream_url": pins["targets"]["arm64"]["url"],
                "upstream_sha256": pins["targets"]["arm64"]["sha256"],
            },
            "files": describe(self.python),
        }
        self.save_manifest()
        p = patch.object(stager, "REPO_ROOT", self.repo)
        p.start()
        self.addCleanup(p.stop)

    def save_manifest(self):
        self.manifest.pop("build_id", None)
        canonical = json.dumps(
            self.manifest, sort_keys=True, separators=(",", ":")
        ).encode()
        self.manifest["build_id"] = hashlib.sha256(canonical).hexdigest()
        (self.source / "manifest.json").write_text(json.dumps(self.manifest) + "\n")

    def test_exact_copy_preserves_source_and_executable_mode(self):
        before = describe(self.source)
        result = stager.stage(self.source, self.destination)
        self.assertEqual(result, self.manifest)
        self.assertEqual(describe(self.source), before)
        self.assertEqual(
            json.loads((self.destination / "manifest.json").read_text()), self.manifest
        )
        verify(self.destination / "python", self.manifest["files"])
        self.assertEqual(self.destination.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.destination.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(
            (self.destination / "manifest.json").stat().st_mode & 0o777, 0o600
        )
        self.assertEqual(
            set(p.name for p in self.destination.iterdir()), {"manifest.json", "python"}
        )

    def test_wrong_pin_is_rejected_before_destination_created(self):
        self.manifest["inputs"]["core_commit"] = "e" * 40
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "core pin"):
            stager.stage(self.source, self.destination)
        self.assertFalse(self.destination.exists())

    def test_corrupt_identifier_is_rejected(self):
        self.manifest["build_id"] = "0" * 64
        (self.source / "manifest.json").write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError, "identifier"):
            stager.stage(self.source, self.destination)

    def test_deleted_changed_extra_mode_symlink_hardlink_and_fifo(self):
        for kind in (
            "deleted",
            "changed",
            "extra",
            "mode",
            "symlink",
            "hardlink",
            "fifo",
        ):
            with self.subTest(kind=kind):
                original = self.python / "LICENSE"
                extra = self.python / "extra"
                if kind == "deleted":
                    original.unlink()
                elif kind == "changed":
                    original.write_text("changed")
                elif kind == "extra":
                    extra.write_text("extra")
                elif kind == "mode":
                    original.chmod(0o600)
                elif kind == "symlink":
                    extra.symlink_to("LICENSE")
                elif kind == "hardlink":
                    os.link(original, extra)
                else:
                    os.mkfifo(extra)
                with self.assertRaises(ValueError):
                    stager.stage(self.source, self.destination)
                self.assertFalse(self.destination.exists())
                if extra.exists() or extra.is_symlink():
                    extra.unlink()
                original.write_text("fixture license\n")
                original.chmod(0o644)

    def test_existing_destination_is_not_overwritten(self):
        self.destination.mkdir(parents=True, mode=0o700)
        self.destination.parent.chmod(0o700)
        sentinel = self.destination / "keep"
        sentinel.write_text("keep")
        with self.assertRaisesRegex(ValueError, "destination"):
            stager.stage(self.source, self.destination)
        self.assertEqual(sentinel.read_text(), "keep")

    def test_linked_source_or_destination_parent_is_refused(self):
        alias = self.source.parent / "alias"
        alias.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(ValueError):
            stager.stage(alias, self.destination)
        other = self.repo / "other"
        other.mkdir()
        self.destination.parent.symlink_to(other, target_is_directory=True)
        with self.assertRaises(ValueError):
            stager.stage(self.source, self.destination)
        self.assertEqual(list(other.iterdir()), [])

    def test_destination_is_fixed_build_resource_location(self):
        for path in (
            self.repo / "out",
            self.source.parent / "other-runtime",
            self.source,
        ):
            with (
                self.subTest(path=path),
                self.assertRaisesRegex(ValueError, "destination"),
            ):
                stager.stage(self.source, path)

    def test_duplicate_json_keys_are_rejected(self):
        raw = json.dumps(self.manifest)
        (self.source / "manifest.json").write_text(
            raw.replace(
                '"manifest_version": 1', '"manifest_version": 1, "manifest_version": 1'
            )
        )
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            stager.stage(self.source, self.destination)

    def test_unsupported_metadata_and_inventory_are_rejected(self):
        cases = (
            ("architecture", "unknown"),
            ("python_version", "0.0.0"),
            ("upstream_sha256", "0" * 64),
            ("core_wheel_name", "other.whl"),
            ("uv_version", "uv \u2603"),
        )
        for key, value in cases:
            with self.subTest(key=key):
                previous = self.manifest["inputs"][key]
                self.manifest["inputs"][key] = value
                self.save_manifest()
                with self.assertRaises(ValueError):
                    stager.stage(self.source, self.destination)
                self.manifest["inputs"][key] = previous
        self.manifest["files"].append(
            {"path": "../escape", "type": "directory", "mode": 493}
        )
        self.save_manifest()
        with self.assertRaises(ValueError):
            stager.stage(self.source, self.destination)

    def test_strict_types_order_modes_and_entry_shapes(self):
        baseline = json.loads(json.dumps(self.manifest))
        mutations = (
            lambda m: m.update(manifest_version=True),
            lambda m: m.update(unexpected="value"),
            lambda m: m["inputs"].update(extra="value"),
            lambda m: m["inputs"].update(core_wheel_sha256="z" * 64),
            lambda m: m["files"].reverse(),
            lambda m: m["files"].append(m["files"][-1]),
            lambda m: m["files"][0].update(mode=True),
            lambda m: m["files"][0].update(mode=0o777),
            lambda m: m["files"][1].update(size=-1),
            lambda m: m["files"][1].update(sha256="G" * 64),
            lambda m: m["files"][-1].update(mode=0o644),
            lambda m: m["files"][1].update(path="./LICENSE"),
            lambda m: m["files"][1].update(path="/LICENSE"),
            lambda m: m["files"][1].update(path="a\\b"),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                self.manifest = json.loads(json.dumps(baseline))
                mutate(self.manifest)
                self.save_manifest()
                with self.assertRaises(ValueError):
                    stager.stage(self.source, self.destination)
                self.assertFalse(self.destination.exists())

    def test_manifest_and_inventory_budgets(self):
        for name, value in (
            ("MAX_MANIFEST_BYTES", 10),
            ("MAX_ENTRIES", 2),
            ("MAX_FILE_BYTES", 1),
            ("MAX_TOTAL_BYTES", 1),
        ):
            with self.subTest(name=name), patch.object(app_manifest, name, value):
                with self.assertRaises(ValueError):
                    stager.stage(self.source, self.destination)
                self.assertFalse(self.destination.exists())

    def test_manifest_links_and_unsafe_permissions_are_rejected(self):
        path = self.source / "manifest.json"
        raw = path.read_bytes()
        path.chmod(0o666)
        with self.assertRaises(ValueError):
            stager.stage(self.source, self.destination)
        path.chmod(0o644)
        copy = self.source / "manifest-copy.json"
        os.link(path, copy)
        with self.assertRaises(ValueError):
            stager.stage(self.source, self.destination)
        path.unlink()
        path.symlink_to(copy.name)
        with self.assertRaises((ValueError, OSError)):
            stager.stage(self.source, self.destination)
        self.assertEqual(copy.read_bytes(), raw)
        self.assertFalse(self.destination.exists())

    def test_copy_disk_failure_retains_incomplete_without_manifest(self):
        with patch.object(
            stager.shutil,
            "copytree",
            side_effect=OSError(errno.ENOSPC, "fixture disk full"),
        ):
            with self.assertRaises(OSError):
                stager.stage(self.source, self.destination)
        self.assertTrue(self.destination.is_dir())
        self.assertFalse((self.destination / "manifest.json").exists())
        verify(self.source / "python", self.manifest["files"])

    def test_manifest_sync_failure_never_publishes_completion_name(self):
        with patch.object(
            stager.os, "fsync", side_effect=OSError(errno.ENOSPC, "fixture disk full")
        ):
            with self.assertRaises(OSError):
                stager.stage(self.source, self.destination)
        self.assertTrue(self.destination.is_dir())
        self.assertFalse((self.destination / "manifest.json").exists())

    def test_manifest_write_failure_retains_only_private_partial(self):
        real_dumps = json.dumps

        def failing_final_serialization(value, *args, **kwargs):
            if isinstance(value, dict) and "build_id" in value:
                raise OSError(errno.ENOSPC, "fixture disk full")
            return real_dumps(value, *args, **kwargs)

        with patch.object(
            stager.json, "dumps", side_effect=failing_final_serialization
        ):
            with self.assertRaises(OSError):
                stager.stage(self.source, self.destination)
        self.assertFalse((self.destination / "manifest.json").exists())
        self.assertEqual(
            (self.destination / ".manifest.partial").stat().st_mode & 0o777, 0o600
        )

    def test_changed_copy_never_gets_completion_manifest(self):
        real_copy = shutil.copytree

        def changing_copy(source, destination, *args, **kwargs):
            result = real_copy(source, destination, *args, **kwargs)
            if Path(destination) == self.destination / "python":
                (Path(destination) / "LICENSE").write_text("tampered during copy")
            return result

        with patch.object(stager.shutil, "copytree", side_effect=changing_copy):
            with self.assertRaises(ValueError):
                stager.stage(self.source, self.destination)
        self.assertTrue(self.destination.is_dir())
        self.assertFalse((self.destination / "manifest.json").exists())
        verify(self.source / "python", self.manifest["files"])

    def test_changed_source_after_copy_never_gets_completion_manifest(self):
        real_copy = shutil.copytree

        def changing_source(source, destination, *args, **kwargs):
            result = real_copy(source, destination, *args, **kwargs)
            if Path(destination) == self.destination / "python":
                (Path(source) / "LICENSE").write_text("changed source after copy")
            return result

        with patch.object(stager.shutil, "copytree", side_effect=changing_source):
            with self.assertRaises(ValueError):
                stager.stage(self.source, self.destination)
        self.assertFalse((self.destination / "manifest.json").exists())
        verify(self.destination / "python", self.manifest["files"])
