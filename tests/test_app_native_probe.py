import hashlib
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from scripts.app_native_probe import (
    Fixture,
    NativeDriver,
    fresh_tick,
    persistence_sequence,
    private_read,
    write_new,
)
from scripts.proof_process import UnsafeProcessGroup
from scripts.runtime_manifest import describe


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / "insto-app-proof-test"
        self.root.mkdir(mode=0o700)
        self.source = self.base / "insto.app"
        self.source.mkdir(mode=0o700)
        self.runtime = self.root / "runtimes" / ("a" * 64)
        self.runtime.mkdir(parents=True, mode=0o700)
        self.runtime.parent.chmod(0o700)
        (self.runtime / "python/bin").mkdir(parents=True)
        (self.runtime / "python/bin/python3").write_bytes(b"test interpreter")
        self.manifest = {
            "build_id": "a" * 64,
            "files": describe(self.runtime / "python"),
        }
        (self.runtime / "manifest.json").write_text(json.dumps(self.manifest))
        (self.runtime / "manifest.json").chmod(0o600)

    def tearDown(self):
        self.temp.cleanup()

    def test_private_files_reject_links_and_permissive_modes(self):
        path = self.root / "data"
        write_new(path, b"safe")
        self.assertEqual(private_read(path), b"safe")
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            write_new(path, b"overwrite")
        link = self.root / "link"
        link.symlink_to(path)
        with self.assertRaises((ValueError, OSError)):
            private_read(link)
        os.link(path, self.root / "hardlink")
        with self.assertRaises(ValueError):
            private_read(path)
        other = self.root / "public"
        other.write_bytes(b"data")
        other.chmod(0o644)
        with self.assertRaises(ValueError):
            private_read(other)

    def test_fixture_identity_exact_and_never_reused(self):
        fixture = Fixture.create(self.root, self.source, self.manifest)
        self.assertEqual(
            private_read(fixture.home / "config.toml"), b'backend = "fake"\n'
        )
        expected = hashlib.sha256(os.fsencode(fixture.home)).hexdigest()[:16]
        self.assertEqual(fixture.label, f"io.insto.watch.{os.getuid()}.{expected}")
        self.assertEqual(fixture.python, self.runtime / "python/bin/python3")
        fixture.validate()
        with self.assertRaises((ValueError, FileExistsError)):
            Fixture.create(self.root, self.source, self.manifest)
        original = fixture.context.read_bytes()
        fixture.context.write_bytes(original + b" ")
        with self.assertRaises(ValueError):
            fixture.validate()

    def test_config_and_runtime_substitution_refuse_cleanup_identity(self):
        fixture = Fixture.create(self.root, self.source, self.manifest)
        (fixture.home / "config.toml").write_bytes(b'backend = "hikerapi"\n')
        with self.assertRaises(ValueError):
            fixture.validate()
        (fixture.home / "config.toml").write_bytes(b'backend = "fake"\n')
        fixture.python.write_bytes(b"substituted")
        with self.assertRaises(ValueError):
            fixture.validate()

    def test_relocation_only_exact_owned_copy_to_absent_sibling(self):
        fixture = Fixture.create(self.root, self.source, self.manifest)
        fixture.relocate()
        self.assertFalse(self.source.exists())
        self.assertTrue(fixture.moved.is_dir())
        fixture.validate()
        with self.assertRaises(ValueError):
            fixture.relocate()

    def test_existing_relocation_destination_rejected_before_fixture(self):
        (self.base / "insto-moved.app").mkdir()
        with self.assertRaises(ValueError):
            Fixture.create(self.root, self.source, self.manifest)
        self.assertFalse((self.root / "native").exists())

    def test_loaded_label_without_ownership_files_never_uninstalls(self):
        fixture = Fixture.create(self.root, self.source, self.manifest)
        driver = NativeDriver(fixture, None, time.monotonic() + 5)
        with (
            patch.object(driver, "cli") as cli,
            patch("scripts.app_native_probe.label_absent", return_value=False),
        ):
            with self.assertRaisesRegex(RuntimeError, "cleanup unconfirmed"):
                driver.cleanup()
            cli.assert_not_called()
        self.assertFalse(driver.cleanup_confirmed)

    def test_substituted_context_forbids_cleanup_mutation(self):
        fixture = Fixture.create(self.root, self.source, self.manifest)
        driver = NativeDriver(fixture, None, time.monotonic() + 5)
        fixture.context.write_bytes(b"{}")
        with patch.object(driver, "cli") as cli:
            with self.assertRaises(ValueError):
                driver.cleanup()
            cli.assert_not_called()

    def test_tick_requires_reset_then_new_committed_timestamp(self):
        fixture = Fixture.create(self.root, self.source, self.manifest)
        db = fixture.home / "store.db"
        previous = int(time.time()) - 5
        with closing(sqlite3.connect(db)) as connection, connection:
            connection.execute("CREATE TABLE watches(user TEXT, last_ok INTEGER)")
            connection.execute("INSERT INTO watches VALUES('alice', ?)", (previous,))
        db.chmod(0o600)

        def daemon():
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                with closing(sqlite3.connect(db)) as connection, connection:
                    if (
                        connection.execute("SELECT last_ok FROM watches").fetchone()[0]
                        == 0
                    ):
                        connection.execute(
                            "UPDATE watches SET last_ok=?", (int(time.time()),)
                        )
                        return
                time.sleep(0.01)

        worker = threading.Thread(target=daemon)
        worker.start()
        try:
            self.assertGreater(
                fresh_tick(fixture.home, previous, time.monotonic() + 3), previous
            )
        finally:
            worker.join(timeout=4)
        with self.assertRaises(TimeoutError):
            fresh_tick(fixture.home, previous, time.monotonic() + 0.1)


class SequenceTests(unittest.TestCase):
    def test_service_identity_change_is_not_continuation(self):
        driver = NativeDriver(None, None, time.monotonic() + 5)
        driver.pin_service(123, b"Sat Sep  5 10:00:00 2026")
        driver.pin_service(123, b"Sat Sep  5 10:00:00 2026")
        for pid, started in [
            (124, b"Sat Sep  5 10:00:00 2026"),
            (123, b"Sat Sep  5 10:00:01 2026"),
        ]:
            with self.assertRaisesRegex(RuntimeError, "restarted"):
                driver.pin_service(pid, started)

    class Driver:
        def __init__(self, failure=None):
            self.events = []
            self.failure = failure
            self.cleanup_confirmed = False

        def step(self, name):
            self.events.append(name)
            if name == self.failure:
                raise RuntimeError("fixture failure")
            if name == "install" and self.failure == "unsafe":
                raise UnsafeProcessGroup("unknown child")

        def seed(self):
            self.step("seed")

        def install(self):
            self.step("install")

        def tick(self, phase):
            self.step(phase)

        def close_app(self):
            self.step("close")

        def relocate(self):
            self.step("move")

        def stop_app(self):
            self.step("stop_app")

        def cleanup(self):
            self.step("cleanup")
            self.cleanup_confirmed = True

    def test_required_order_and_exact_cleanup(self):
        driver = self.Driver()
        persistence_sequence(driver)
        self.assertEqual(
            driver.events,
            [
                "seed",
                "install",
                "app_alive",
                "close",
                "app_closed",
                "move",
                "app_relocated",
                "stop_app",
                "cleanup",
            ],
        )

    def test_safe_failure_still_cleans(self):
        driver = self.Driver("app_closed")
        with self.assertRaises(RuntimeError):
            persistence_sequence(driver)
        self.assertEqual(driver.events[-2:], ["stop_app", "cleanup"])

    def test_unknown_ownership_forbids_fallback(self):
        driver = self.Driver("unsafe")
        with self.assertRaises(UnsafeProcessGroup):
            persistence_sequence(driver)
        self.assertNotIn("cleanup", driver.events)


if __name__ == "__main__":
    unittest.main()
