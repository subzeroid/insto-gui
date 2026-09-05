import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.runtime_manifest import describe, sha256, verify


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

    def test_hardlinked_file_is_rejected(self):
        os.link(self.root / "dir/a", self.root / "hardlink")
        with self.assertRaisesRegex(ValueError, "Hardlinked"):
            describe(self.root)

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
