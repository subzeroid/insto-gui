import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import native_service_probe as native


class NativeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.core = self.root / "core"
        (self.core / ".venv/bin").mkdir(parents=True)
        (self.core / ".venv/bin/python").touch()
        (self.core / "tests/e2e").mkdir(parents=True)
        (self.core / "tests/e2e/test_watch_service.py").touch()
        self.python = self.root / "different path/python/bin/python3"
        self.python.parent.mkdir(parents=True)
        self.python.touch()
        self.userhome = self.root / "userhome"
        self.userhome.mkdir()
        self.home = self.root / "native-test/service home"
        self.env = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"}
        self.addCleanup(patch.stopall)
        patch.object(Path, "home", return_value=self.userhome).start()
        self.real_label_absent = native.label_absent
        self.absent = patch.object(native, "label_absent", return_value=True).start()

    def run_probe(self):
        native.run_native(
            core=self.core, python=self.python, root=self.root, environment=self.env
        )

    def context(self):
        return json.loads((self.root / "native-context.json").read_text())

    def child(self, command, *, log, cwd, env, timeout):
        context = self.context()  # Must exist before the first child starts.
        self.assertEqual(context["phase"], "starting")
        self.assertEqual(context["home"], str(self.home))
        self.assertEqual(env["INSTO_TEST_HOME"], str(self.home))
        self.assertEqual(env["INSTO_TEST_PYTHON"], str(self.python))
        self.assertEqual(env["INSTO_TEST_NO_BYTECODE"], "1")
        self.assertNotIn("HIKERAPI_TOKEN", env)
        self.assertEqual(timeout, 600)
        self.assertIn(str(self.root / "native-test"), command)
        log.write(b"1 passed in 20.00s\n")
        return 0

    def test_success_records_context_before_child_and_cleanup(self):
        with patch.object(native, "run_child", side_effect=self.child):
            self.run_probe()
        self.assertEqual(self.context()["phase"], "passed")
        self.assertEqual(self.context()["exit_code"], 0)
        self.assertTrue(self.context()["cleanup_confirmed"])

    def test_skip_is_not_success(self):
        def skipped(*args, log, **kwargs):
            log.write(b"1 skipped in 0.1s\n")
            return 0

        with patch.object(native, "run_child", side_effect=skipped):
            with self.assertRaisesRegex(RuntimeError, "one passing"):
                self.run_probe()
        self.assertEqual(self.context()["phase"], "failed")

    def test_child_failure_and_interrupt_preserve_evidence(self):
        for error in (
            RuntimeError("timed out"),
            KeyboardInterrupt(),
            OSError("spawn failed"),
        ):
            with self.subTest(error=type(error).__name__):
                context = self.root / "native-context.json"
                if context.exists():
                    context.unlink()
                result = self.root / "native-result.txt"
                if result.exists():
                    result.unlink()
                with patch.object(native, "run_child", side_effect=error):
                    with self.assertRaises(type(error)):
                        self.run_probe()
                self.assertEqual(self.context()["phase"], "failed")
                self.assertTrue(self.context()["cleanup_confirmed"])

    def test_refuses_existing_basetemp_before_launch(self):
        (self.root / "native-test").mkdir()
        with patch.object(native, "run_child") as child:
            with self.assertRaises(ValueError):
                self.run_probe()
        child.assert_not_called()

    def test_refuses_loaded_label_before_launch(self):
        self.absent.return_value = False
        with patch.object(native, "run_child") as child:
            with self.assertRaises(RuntimeError):
                self.run_probe()
        child.assert_not_called()

    def test_fallback_exact_home_only_after_child_stopped(self):
        calls = []

        def child(command, *, log, cwd, env, timeout):
            calls.append(command)
            if len(calls) == 1:
                self.home.mkdir(parents=True, mode=0o700)
                self.home.parent.chmod(0o700)
                config = self.home / "config.toml"
                config.write_text('backend = "fake"\n')
                config.chmod(0o600)
                manifest = self.home / "services/watch/manifest.json"
                manifest.parent.mkdir(parents=True)
                manifest.write_text("{}")
                log.write(b"1 failed in 0.1s\n")
                return 1
            self.assertEqual(
                command,
                [
                    str(self.python),
                    "-I",
                    "-B",
                    "-m",
                    "insto",
                    "watch-service",
                    "uninstall",
                ],
            )
            self.assertEqual(env["INSTO_HOME"], str(self.home))
            self.assertEqual(env["INSTO_BACKEND"], "fake")
            self.assertEqual(timeout, 120)
            (self.home / "services/watch/manifest.json").unlink()
            return 0

        with patch.object(native, "run_child", side_effect=child):
            with self.assertRaises(RuntimeError):
                self.run_probe()
        self.assertEqual(len(calls), 2)
        self.assertTrue(self.context()["cleanup_confirmed"])

    def test_tampered_home_never_triggers_fallback(self):
        def child(*args, log, **kwargs):
            self.home.parent.mkdir(mode=0o700)
            self.home.symlink_to(self.userhome, target_is_directory=True)
            (self.userhome / "services/watch").mkdir(parents=True)
            (self.userhome / "services/watch/manifest.json").write_text("{}")
            return 1

        with patch.object(native, "run_child", side_effect=child) as call:
            with self.assertRaises(RuntimeError):
                self.run_probe()
        self.assertEqual(call.call_count, 1)
        self.assertEqual(self.context()["phase"], "cleanup_failed")

    def test_changed_context_blocks_cleanup_mutation(self):
        def child(*args, **kwargs):
            context = self.context()
            context["home"] = str(self.userhome)
            (self.root / "native-context.json").write_text(json.dumps(context))
            return 1

        with patch.object(native, "run_child", side_effect=child) as call:
            with self.assertRaisesRegex(RuntimeError, "context identity changed"):
                self.run_probe()
        self.assertEqual(call.call_count, 1)
        self.assertEqual(self.context()["phase"], "cleanup_failed")

    def test_unstopped_group_never_triggers_fallback(self):
        with patch.object(
            native, "run_child", side_effect=native.UnsafeProcessGroup("still running")
        ) as call:
            with self.assertRaisesRegex(RuntimeError, "cleanup unconfirmed"):
                self.run_probe()
        self.assertEqual(call.call_count, 1)
        self.assertFalse(self.context()["cleanup_confirmed"])

    def test_second_interrupt_during_shutdown_never_uninstalls(self):
        from unittest.mock import Mock

        process = Mock(pid=23456)

        def timeout(*args, **kwargs):
            self.home.mkdir(parents=True, mode=0o700)
            self.home.parent.chmod(0o700)
            config = self.home / "config.toml"
            config.write_text('backend = "fake"\n')
            config.chmod(0o600)
            manifest = self.home / "services/watch/manifest.json"
            manifest.parent.mkdir(parents=True)
            manifest.write_text("{}")
            raise subprocess.TimeoutExpired("test", 600)

        process.wait.side_effect = timeout
        with (
            patch.object(native.subprocess, "Popen", return_value=process) as popen,
            patch.object(native, "stop_group", side_effect=KeyboardInterrupt),
        ):
            with self.assertRaisesRegex(RuntimeError, "cleanup unconfirmed"):
                self.run_probe()
        popen.assert_called_once()
        self.assertTrue((self.home / "services/watch/manifest.json").exists())
        self.assertEqual(self.context()["phase"], "cleanup_failed")

    def test_interrupt_during_spawn_does_not_claim_cleanup_or_uninstall(self):
        def interrupted_spawn(*args, **kwargs):
            self.home.mkdir(parents=True, mode=0o700, exist_ok=True)
            self.home.parent.chmod(0o700)
            config = self.home / "config.toml"
            config.write_text('backend = "fake"\n')
            config.chmod(0o600)
            manifest = self.home / "services/watch/manifest.json"
            manifest.parent.mkdir(parents=True, exist_ok=True)
            manifest.write_text("{}")
            raise KeyboardInterrupt

        with patch.object(
            native.subprocess, "Popen", side_effect=interrupted_spawn
        ) as popen:
            with self.assertRaisesRegex(RuntimeError, "cleanup unconfirmed"):
                self.run_probe()
        popen.assert_called_once()
        self.assertFalse(self.context()["cleanup_confirmed"])
        self.assertEqual(self.context()["phase"], "cleanup_failed")

    def test_fallback_failure_keeps_manifest_and_reports_cleanup_failed(self):
        def child(*args, **kwargs):
            if not self.home.exists():
                self.home.mkdir(parents=True, mode=0o700)
                self.home.parent.chmod(0o700)
                config = self.home / "config.toml"
                config.write_text('backend = "fake"\n')
                config.chmod(0o600)
                manifest = self.home / "services/watch/manifest.json"
                manifest.parent.mkdir(parents=True)
                # The core uninstall command must reject this tampered manifest;
                # supervisor must not unlink it when the controller refuses.
                manifest.write_text('{"home":"/foreign"}')
            return 1

        with patch.object(native, "run_child", side_effect=child) as call:
            with self.assertRaisesRegex(RuntimeError, "fallback uninstall failed"):
                self.run_probe()
        self.assertEqual(call.call_count, 2)
        self.assertTrue((self.home / "services/watch/manifest.json").exists())
        self.assertEqual(self.context()["phase"], "cleanup_failed")

    def test_unknown_final_status_is_cleanup_failure(self):
        self.absent.side_effect = [True, RuntimeError("unknown status")]
        with patch.object(native, "run_child", side_effect=self.child):
            with self.assertRaisesRegex(RuntimeError, "unknown status"):
                self.run_probe()
        self.assertEqual(self.context()["phase"], "cleanup_failed")

    def test_unknown_launchctl_response_is_not_absence(self):
        with patch.object(
            native.subprocess,
            "run",
            return_value=subprocess.CompletedProcess(
                [], 113, b"", b"permission denied"
            ),
        ):
            with self.assertRaises(RuntimeError):
                self.real_label_absent("io.insto.watch.example", self.env)

    def test_exact_missing_launchctl_label_is_absence(self):
        label = "io.insto.watch.example"
        stderr = f'Bad request.\nCould not find service "{label}" in domain for user gui: {os.getuid()}\n'.encode()
        with patch.object(
            native.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 113, b"", stderr),
        ):
            self.assertTrue(self.real_label_absent(label, self.env))
            with self.assertRaises(RuntimeError):
                self.real_label_absent("different", self.env)


class ChildSupervisorTests(unittest.TestCase):
    def test_interrupted_group_cleanup_is_explicitly_unsafe(self):
        from unittest.mock import Mock

        for stop_error in (KeyboardInterrupt(), PermissionError("cannot signal")):
            process = Mock(pid=23456)
            process.wait.side_effect = subprocess.TimeoutExpired("test", 1)
            with self.subTest(error=type(stop_error).__name__):
                with (
                    patch.object(native.subprocess, "Popen", return_value=process),
                    patch.object(native, "stop_group", side_effect=stop_error),
                ):
                    with self.assertRaises(native.UnsafeProcessGroup):
                        native.run_child(
                            ["/safe/python"], log=None, cwd=Path("/"), env={}, timeout=1
                        )

    def test_unknown_group_state_after_exit_is_unsafe(self):
        from unittest.mock import Mock

        process = Mock(pid=23456)
        process.wait.return_value = 0
        with (
            patch.object(native.subprocess, "Popen", return_value=process),
            patch.object(
                native, "_group_alive", side_effect=PermissionError("unknown")
            ),
        ):
            with self.assertRaises(native.UnsafeProcessGroup):
                native.run_child(
                    ["/safe/python"], log=None, cwd=Path("/"), env={}, timeout=1
                )

    def test_stop_group_escalates_and_reaps_only_owned_group(self):
        from unittest.mock import Mock

        process = Mock(pid=23456)
        # Expire each grace window immediately, then report absence after kill.
        with (
            patch.object(native.os, "killpg") as kill,
            patch.object(native.time, "monotonic", side_effect=[0, 61, 62, 68, 69, 70]),
            patch.object(native, "_group_alive", return_value=False),
        ):
            native.stop_group(process)
        self.assertEqual(
            kill.call_args_list,
            [
                unittest.mock.call(23456, signal.SIGINT),
                unittest.mock.call(23456, signal.SIGTERM),
                unittest.mock.call(23456, signal.SIGKILL),
            ],
        )
        process.wait.assert_called_once_with(timeout=5)

    def test_real_child_timeout_runs_finally_without_launchd(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / "finally-ran"
            code = "import time; from pathlib import Path\ntry:\n time.sleep(30)\nfinally:\n Path('finally-ran').write_text('clean')\n"
            with (root / "log").open("wb") as log:
                with self.assertRaisesRegex(RuntimeError, "timed out"):
                    native.run_child(
                        [sys.executable, "-I", "-B", "-c", code],
                        log=log,
                        cwd=root,
                        env={"PATH": "/usr/bin:/bin"},
                        timeout=0.5,
                    )
            self.assertEqual(marker.read_text(), "clean")

    def test_timeout_escalates_only_own_process_group(self):
        from unittest.mock import Mock

        process = Mock(pid=23456)
        process.wait.side_effect = [subprocess.TimeoutExpired("test", 1), None]
        with (
            patch.object(native.subprocess, "Popen", return_value=process) as popen,
            patch.object(native, "stop_group") as stop,
        ):
            with self.assertRaisesRegex(RuntimeError, "timed out"):
                native.run_child(
                    ["/safe/python"], log=None, cwd=Path("/"), env={}, timeout=1
                )
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        stop.assert_called_once_with(process)

    def test_interrupt_also_stops_group(self):
        from unittest.mock import Mock

        process = Mock(pid=23456)
        process.wait.side_effect = KeyboardInterrupt
        with (
            patch.object(native.subprocess, "Popen", return_value=process),
            patch.object(native, "stop_group") as stop,
        ):
            with self.assertRaises(KeyboardInterrupt):
                native.run_child(
                    ["/safe/python"], log=None, cwd=Path("/"), env={}, timeout=1
                )
        stop.assert_called_once_with(process)


if __name__ == "__main__":
    unittest.main()
