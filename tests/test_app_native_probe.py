import hashlib
from builtins import BaseExceptionGroup
from contextlib import closing
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from scripts.app_native_probe import (
    Fixture,
    NativeDriver,
    StagedFixture,
    close_window,
    fresh_tick,
    label_for,
    persistence_sequence,
    private_read,
    redacted,
    stage_document,
    write_new,
    window_marker,
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

    def test_tick_changes_schedule_then_requires_new_committed_timestamp(self):
        fixture = Fixture.create(self.root, self.source, self.manifest)
        db = fixture.home / "store.db"
        previous = int(time.time()) - 5
        with closing(sqlite3.connect(db)) as connection, connection:
            connection.execute(
                "CREATE TABLE watches(user TEXT, last_ok INTEGER, "
                "interval_seconds INTEGER, status TEXT, registration_id TEXT)"
            )
            connection.execute(
                "INSERT INTO watches VALUES('alice', ?, 600, 'active', 'registration')",
                (previous,),
            )
        db.chmod(0o600)

        def daemon():
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                with closing(sqlite3.connect(db)) as connection, connection:
                    # C1 reconciles existing tasks for schedule changes, NOT
                    # last_ok alone. A fake writer reacting only to last_ok
                    # previously concealed the native proof's invalid trigger.
                    if connection.execute(
                        "SELECT last_ok, interval_seconds FROM watches"
                    ).fetchone() == (0, 601):
                        connection.execute(
                            "UPDATE watches SET last_ok=?", (int(time.time()),)
                        )
                        return
                time.sleep(0.01)

        worker = threading.Thread(target=daemon)
        worker.start()
        try:
            self.assertGreater(
                fresh_tick(fixture.home, previous, time.monotonic() + 3)["last_ok"],
                previous,
            )
        finally:
            worker.join(timeout=4)
        with self.assertRaises(TimeoutError):
            fresh_tick(fixture.home, previous, time.monotonic() + 0.1)
        with closing(sqlite3.connect(db)) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT last_ok, interval_seconds FROM watches"
                ).fetchone(),
                (0, 600),
            )

    def test_failed_cli_retains_bounded_private_diagnostics(self):
        fixture = Fixture.create(self.root, self.source, self.manifest)
        driver = NativeDriver(fixture, None, time.monotonic() + 5)
        result = SimpleNamespace(returncode=1, stdout=b"detail", stderr=b"x" * 20000)
        output = io.StringIO()
        with (
            patch("scripts.app_native_probe.run_child", return_value=result),
            redirect_stdout(output),
        ):
            with self.assertRaises(RuntimeError) as caught:
                driver.cli("watch-service", "uninstall")
        self.assertNotIn("detail", str(caught.exception))
        self.assertEqual(output.getvalue(), "")
        evidence = driver.evidence[-1]
        self.assertEqual(evidence["stdout"], "detail")
        self.assertEqual(evidence["stderr"], "x" * 16384)
        self.assertTrue(evidence["diagnostics_truncated"])

    def test_tick_rejects_changed_registration_or_unexpected_watch_before_update(self):
        fixture = Fixture.create(self.root, self.source, self.manifest)
        db = fixture.home / "store.db"
        with closing(sqlite3.connect(db)) as connection, connection:
            connection.execute(
                "CREATE TABLE watches(user TEXT, last_ok INTEGER, "
                "interval_seconds INTEGER, status TEXT, registration_id TEXT)"
            )
        db.chmod(0o600)
        for row in (
            ("bob", 12, 600, "active", "expected"),
            ("alice", 12, 300, "active", "expected"),
            ("alice", 12, 600, "paused", "expected"),
            ("alice", 12, 600, "active", "changed"),
        ):
            with self.subTest(row=row):
                with closing(sqlite3.connect(db)) as connection, connection:
                    connection.execute("DELETE FROM watches")
                    connection.execute("INSERT INTO watches VALUES(?, ?, ?, ?, ?)", row)
                with self.assertRaises(ValueError):
                    fresh_tick(
                        fixture.home,
                        0,
                        time.monotonic() + 1,
                        registration_id="expected",
                    )
                with closing(sqlite3.connect(db)) as connection:
                    self.assertEqual(
                        connection.execute("SELECT * FROM watches").fetchone(), row
                    )

    def cleanup_driver(self):
        fixture = Fixture.create(self.root, self.source, self.manifest)
        # Never create a real LaunchAgents artifact in a unit test.
        fixture.plist = self.root / "owned.plist"
        fixture.manifest.parent.mkdir(parents=True, mode=0o700)
        fixture.manifest.parent.parent.chmod(0o700)
        write_new(fixture.manifest, b"{}")
        write_new(fixture.plist, b"{}")
        return NativeDriver(fixture, None, time.monotonic() + 5)

    def test_cleanup_retries_once_only_after_exact_absence_and_revalidation(self):
        driver = self.cleanup_driver()
        calls = []

        def uninstall(argv, cwd, deadline, env):
            calls.append(deadline)
            if len(calls) == 1:
                return SimpleNamespace(
                    returncode=1, stdout=b"", stderr=b"not absent yet"
                )
            driver.fixture.manifest.unlink()
            driver.fixture.plist.unlink()
            return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

        with (
            patch("scripts.app_native_probe.run_child", side_effect=uninstall),
            patch("scripts.app_native_probe.label_absent", return_value=True) as absent,
            patch.object(
                driver.fixture, "validate", wraps=driver.fixture.validate
            ) as validate,
        ):
            driver.cleanup()
        self.assertEqual(len(calls), 2)
        self.assertEqual(validate.call_count, 2)
        self.assertEqual(absent.call_count, 2)
        # Per-call caps fit one shared absolute cleanup budget.
        self.assertLessEqual(max(calls), absent.call_args.args[2])
        self.assertEqual(
            absent.call_args_list[0].args[2], absent.call_args_list[1].args[2]
        )
        self.assertTrue(driver.cleanup_confirmed)
        self.assertEqual([item["exit_code"] for item in driver.evidence], [1, 0])

    def test_cleanup_never_retries_loaded_label(self):
        driver = self.cleanup_driver()
        with (
            patch(
                "scripts.app_native_probe.run_child",
                return_value=SimpleNamespace(
                    returncode=1, stdout=b"", stderr=b"failed"
                ),
            ) as child,
            patch("scripts.app_native_probe.label_absent", return_value=False),
        ):
            with self.assertRaises(RuntimeError):
                driver.cleanup()
        self.assertEqual(child.call_count, 1)
        self.assertFalse(driver.cleanup_confirmed)

    def test_cleanup_revalidation_failure_prevents_retry(self):
        driver = self.cleanup_driver()
        with (
            patch(
                "scripts.app_native_probe.run_child",
                return_value=SimpleNamespace(
                    returncode=1, stdout=b"", stderr=b"failed"
                ),
            ) as child,
            patch("scripts.app_native_probe.label_absent", return_value=True),
            patch.object(
                driver.fixture, "validate", side_effect=[None, ValueError("changed")]
            ),
        ):
            with self.assertRaisesRegex(ValueError, "changed"):
                driver.cleanup()
        self.assertEqual(child.call_count, 1)

    def test_cleanup_never_retries_timeout_or_unknown_group(self):
        driver = self.cleanup_driver()
        for error in (TimeoutError("deadline"), UnsafeProcessGroup("unknown")):
            with (
                self.subTest(error=error),
                patch("scripts.app_native_probe.run_child", side_effect=error) as child,
                patch("scripts.app_native_probe.label_absent") as absent,
            ):
                with self.assertRaises(type(error)):
                    driver.cleanup()
                self.assertEqual(child.call_count, 1)
                absent.assert_not_called()

    def test_cleanup_second_failure_never_gets_third_attempt(self):
        driver = self.cleanup_driver()
        with (
            patch(
                "scripts.app_native_probe.run_child",
                return_value=SimpleNamespace(
                    returncode=1, stdout=b"", stderr=b"failed"
                ),
            ) as child,
            patch("scripts.app_native_probe.label_absent", return_value=True),
        ):
            with self.assertRaises(RuntimeError):
                driver.cleanup()
        self.assertEqual(child.call_count, 2)
        self.assertFalse(driver.cleanup_confirmed)

    def test_signal_terminated_uninstall_never_retries(self):
        driver = self.cleanup_driver()
        with (
            patch(
                "scripts.app_native_probe.run_child",
                return_value=SimpleNamespace(
                    returncode=-9, stdout=b"", stderr=b"signal"
                ),
            ) as child,
            patch("scripts.app_native_probe.label_absent", return_value=True) as absent,
        ):
            with self.assertRaises(RuntimeError):
                driver.cleanup()
        self.assertEqual(child.call_count, 1)
        absent.assert_not_called()
        self.assertEqual(driver.evidence[-1]["stderr"], "signal")


class SequenceTests(unittest.TestCase):
    def test_expected_closed_preparation_is_not_a_drain_failure(self):
        class Child:
            def __init__(self):
                self.lines = iter(
                    (
                        b'{"proof":"close_requested"}',
                        b'{"proof":"prepare_failed","code":"closed"}',
                        b'{"proof":"inspect_failed","code":"transport"}',
                        b'{"proof":"drained"}',
                    )
                )
                self.finished = False

            def send(self, data, deadline):
                self.control = data

            def finish(self, deadline):
                self.finished = True
                return SimpleNamespace(returncode=0)

            def wait_for_line(self, predicate, deadline):
                for line in self.lines:
                    if predicate(line):
                        return line
                raise AssertionError("missing drain")

        with redirect_stdout(io.StringIO()):
            child = Child()
            close_window(child, time.monotonic() + 1)
            self.assertEqual(child.control, b"close\n")
            self.assertTrue(child.finished)
            with self.assertRaises(RuntimeError):
                window_marker(Child(), "ui_ready", time.monotonic() + 1)

    def test_live_window_progress_forwards_only_expected_static_marker(self):
        class Child:
            def wait_for_line(self, predicate, deadline):
                self_accepted = [
                    line
                    for line in (
                        b'{"proof":"secret"}',
                        b'{"proof":"ui_ready","extra":"secret"}',
                        b'{"proof":"ui_ready"}',
                    )
                    if predicate(line)
                ]
                self.assertion = self_accepted

        child = Child()
        output = io.StringIO()
        with redirect_stdout(output):
            window_marker(child, "ui_ready", time.monotonic() + 1)
        self.assertEqual(child.assertion, [b'{"proof":"ui_ready"}'])
        self.assertEqual(output.getvalue(), '{"observed": "ui_ready"}\n')

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

    def test_cleanup_failure_does_not_hide_primary_failure(self):
        driver = self.Driver("app_closed")
        cleanup_error = ValueError("cleanup failure")
        with patch.object(driver, "cleanup", side_effect=cleanup_error):
            with self.assertRaises(BaseExceptionGroup) as caught:
                persistence_sequence(driver)
        self.assertEqual(len(caught.exception.exceptions), 2)
        self.assertIsInstance(caught.exception.exceptions[0], RuntimeError)
        self.assertIs(caught.exception.exceptions[1], cleanup_error)

    def test_unknown_app_cleanup_keeps_primary_and_forbids_native_cleanup(self):
        driver = self.Driver("app_closed")
        unsafe = UnsafeProcessGroup("unknown app group")
        with patch.object(driver, "stop_app", side_effect=unsafe):
            with self.assertRaises(BaseExceptionGroup) as caught:
                persistence_sequence(driver)
        self.assertIs(caught.exception.exceptions[1], unsafe)
        self.assertNotIn("cleanup", driver.events)


class StagedFixtureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name).resolve()
        self.base.chmod(0o700)
        self.root = self.base / "insto-app-proof-staged-test"
        self.root.mkdir(mode=0o700)
        self.source = self.base / "insto.app"
        (self.source / "Contents/Resources/runtime/python/bin").mkdir(parents=True, mode=0o700)
        self.bundled = self.source / "Contents/Resources/runtime/python/bin/python3"
        self.bundled.write_bytes(b"bundled interpreter")
        self.previous = self.base / "previous/python/bin/python3"
        self.previous.parent.mkdir(parents=True, mode=0o700)
        self.previous.write_bytes(b"previous interpreter")
        self.agents = self.base / "LaunchAgents"
        self.agents.mkdir(mode=0o700)
        self.manifest = {"build_id": "a" * 64}

    def tearDown(self):
        self.temp.cleanup()

    def create(self, mode="adopt", previous=None):
        return StagedFixture.create(
            self.root,
            self.source,
            self.manifest,
            self.previous if previous is None else previous,
            mode,
            agents=self.agents,
        )

    def test_label_is_the_products_own_derivation(self):
        home = self.base / "native/cli home"
        digest = hashlib.sha256(os.fsencode(home)).hexdigest()[:16]
        self.assertEqual(label_for(home), f"io.insto.watch.{os.getuid()}.{digest}")

    def test_migrate_binds_the_apps_own_profile(self):
        fixture = self.create(mode="migrate")
        self.assertEqual(fixture.home, self.root / "profile")
        self.assertIsNone(fixture.staged_home)

    def test_adopt_stages_a_home_outside_the_desktop_root(self):
        fixture = self.create(mode="adopt")
        self.assertEqual(fixture.home, self.base / "native/cli home")
        self.assertEqual(fixture.staged_home, fixture.home)
        # A home inside the desktop root, or beside its markers, is never adoptable.
        self.assertNotIn(self.root, fixture.home.parents)

    def test_refuses_a_root_the_app_has_already_published_into(self):
        (self.root / "runtimes").mkdir(mode=0o700)
        with self.assertRaises(ValueError):
            self.create()

    def test_refuses_a_previous_interpreter_that_is_the_bundled_one(self):
        with self.assertRaises(ValueError):
            self.create(previous=self.bundled)

    def test_refuses_an_existing_exact_registration(self):
        (self.agents / f"{label_for(self.base / 'native/cli home')}.plist").write_bytes(b"")
        with self.assertRaises(ValueError):
            self.create()

    def test_refuses_a_group_writable_artifact_parent(self):
        self.base.chmod(0o777)
        with self.assertRaises(ValueError):
            self.create()

    def test_stage_document_is_the_documented_two_key_object(self):
        self.assertEqual(stage_document(None), {"schema_version": 1, "home": None})
        self.assertEqual(
            stage_document(Path("/private/cli home")),
            {"schema_version": 1, "home": "/private/cli home"},
        )

    def test_stage_file_is_private_and_written_once(self):
        fixture = self.create()
        fixture.stage()
        path = self.root / "staged.json"
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(private_read(path))["home"], str(fixture.home))
        with self.assertRaises(FileExistsError):
            fixture.stage()

    def test_recorded_evidence_never_carries_a_fixture_credential(self):
        self.assertEqual(json.loads(redacted({"ok": True})), {"ok": True})
        for secret in ("isolated-migration-credential", "offline-fixture-token-not-real"):
            with self.assertRaises(RuntimeError):
                redacted({"stderr": f"boom {secret}"})


if __name__ == "__main__":
    unittest.main()
