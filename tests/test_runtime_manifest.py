import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.runtime_manifest import describe, sha256, verify
from scripts import runtime_manifest


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "dir").mkdir()
        (self.root / "dir/a").write_bytes(b"hello")

    def test_inventory_and_hash(self):
        entries = describe(self.root)
        self.assertEqual([x["path"] for x in entries], [".", "dir", "dir/a"])
        self.assertEqual(entries[0]["type"], "directory")
        self.assertEqual(entries[0]["mode"], 0o700)
        self.assertEqual(entries[2]["sha256"], sha256(self.root / "dir/a"))
        self.assertEqual(entries[2]["size"], 5)
        verify(self.root, entries)

    def test_root_mode_change_is_detected(self):
        self.root.chmod(0o700)
        entries = describe(self.root)
        self.root.chmod(0o777)
        with self.assertRaises(ValueError):
            verify(self.root, entries)

    def test_verification_does_not_materialize_directory_names(self):
        entries = describe(self.root)
        with patch.object(
            Path, "iterdir", side_effect=AssertionError("eager directory listing")
        ):
            verify(self.root, entries)

    def test_hardlinked_file_is_rejected(self):
        os.link(self.root / "dir/a", self.root / "hardlink")
        with self.assertRaisesRegex(ValueError, "Hardlinked"):
            describe(self.root)

    def test_unlisted_or_oversized_file_is_rejected_before_hashing(self):
        entries = describe(self.root)
        extra = self.root / "extra"
        extra.write_bytes(b"unexpected")
        real_open = runtime_manifest.os.open
        real_path_open = Path.open
        hashed = []

        def record_open(path, *args, **kwargs):
            hashed.append(Path(path))
            return real_open(path, *args, **kwargs)

        def record_path_open(path, *args, **kwargs):
            hashed.append(Path(path))
            return real_path_open(path, *args, **kwargs)

        with (
            patch.object(runtime_manifest.os, "open", side_effect=record_open),
            patch.object(Path, "open", record_path_open),
        ):
            with self.assertRaises(ValueError):
                verify(self.root, entries)
        self.assertNotIn(extra, hashed)
        extra.unlink()
        hashed.clear()
        (self.root / "dir/a").write_bytes(b"oversized content")
        with (
            patch.object(runtime_manifest.os, "open", side_effect=record_open),
            patch.object(Path, "open", record_path_open),
        ):
            with self.assertRaises(ValueError):
                verify(self.root, entries)
        self.assertNotIn(self.root / "dir/a", hashed)
        (self.root / "dir/a").write_bytes(b"hello")
        with (
            patch.object(runtime_manifest.os, "open", side_effect=record_open),
            patch.object(Path, "open", record_path_open),
        ):
            verify(self.root, entries)
        self.assertIn(self.root / "dir/a", hashed)

    def test_mutations(self):
        for mutation in ("change", "extra", "delete", "mode", "type"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                file = root / "a"
                file.write_text("hello")
                entries = describe(root)
                if mutation == "change":
                    file.write_text("other")
                elif mutation == "extra":
                    (root / "b").mkdir()
                elif mutation == "delete":
                    file.unlink()
                elif mutation == "mode":
                    file.chmod(0o700)
                else:
                    file.unlink()
                    file.mkdir()
                with self.assertRaises(ValueError):
                    verify(root, entries)

    def test_unsafe_nodes(self):
        for kind in ("link", "fifo", "specialbits", "owner", "rootlink"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                if kind == "owner":
                    with patch("scripts.runtime_manifest.os.getuid", return_value=-1):
                        with self.assertRaises(ValueError):
                            describe(root)
                    continue
                if kind == "link":
                    (root / "link").symlink_to("missing")
                elif kind == "fifo":
                    os.mkfifo(root / "fifo")
                elif kind == "specialbits":
                    (root / "a").touch()
                    (root / "a").chmod(0o4644)
                else:
                    (root / "link").symlink_to(root, target_is_directory=True)
                    root = root / "link"
                with self.assertRaises(ValueError):
                    describe(root)
