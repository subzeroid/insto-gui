import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from scripts.proof_process import OwnedChild, UnsafeProcessGroup


@unittest.skipUnless(hasattr(os, "waitid"), "developer supervisor requires waitid")
class OwnedChildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.children = []

    def tearDown(self):
        for child in self.children:
            if not child.reaped and not child.unsafe:
                child.abort()
        self.temp.cleanup()

    def start(self, code):
        child = OwnedChild.start(
            [sys.executable, "-I", "-B", "-c", code],
            cwd=self.root,
            env={"PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8"},
        )
        self.children.append(child)
        return child

    def test_success_reads_both_streams_and_signals_before_sole_reap(self):
        child = self.start(
            "import sys; print('ready',flush=True); print('diagnostic',file=sys.stderr)"
        )
        events = []
        original_killpg = os.killpg
        original_wait = child.process.wait
        original_observe = child.observe_exit
        original_members = child._live_descendants
        with (
            patch(
                "scripts.proof_process.os.killpg",
                side_effect=lambda *args: (
                    events.append("signal"),
                    original_killpg(*args),
                )[1],
            ),
            patch.object(
                child.process,
                "wait",
                side_effect=lambda **kwargs: (
                    events.append("reap"),
                    original_wait(**kwargs),
                )[1],
            ),
            patch.object(
                child,
                "observe_exit",
                side_effect=lambda: (events.append("observe"), original_observe())[1],
            ),
            patch.object(
                child,
                "_live_descendants",
                side_effect=lambda: (events.append("members"), original_members())[1],
            ),
        ):
            result = child.finish(time.monotonic() + 5)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"ready\n")
        self.assertEqual(result.stderr, b"diagnostic\n")
        self.assertLess(events.index("observe"), events.index("signal"))
        self.assertLess(events.index("signal"), events.index("members"))
        self.assertEqual(events[-1], "reap")
        self.assertEqual(events.count("signal"), 1)
        self.assertEqual(events.count("reap"), 1)
        with patch(
            "scripts.proof_process.os.killpg",
            side_effect=AssertionError("post-reap signal"),
        ):
            child.abort()

    def test_nonzero_exit_is_preserved(self):
        self.assertEqual(
            self.start("raise SystemExit(7)").finish(time.monotonic() + 5).returncode, 7
        )

    def test_timeout_cleans_owned_group(self):
        child = self.start("import time; time.sleep(30)")
        with self.assertRaises(TimeoutError):
            child.finish(time.monotonic() + 0.1)
        self.assertTrue(child.reaped)
        with self.assertRaises(ProcessLookupError):
            os.kill(child.process.pid, 0)

    def test_inherited_pipe_child_is_killed_before_reap(self):
        child = self.start(
            "import subprocess; p=subprocess.Popen(['/bin/sleep','30']); print(p.pid,flush=True)"
        )
        child.wait_for_line(lambda line: line.strip().isdigit(), time.monotonic() + 5)
        grandchild = int(child.stdout.strip())
        result = child.finish(time.monotonic() + 5)
        self.assertEqual(result.returncode, 0)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            try:
                os.kill(grandchild, 0)
            except ProcessLookupError:
                break
            time.sleep(0.02)
        else:
            self.fail("owned descendant remained")

    def test_stdout_and_stderr_overflow_are_bounded(self):
        for stream in ("stdout", "stderr"):
            child = self.start(
                f"import sys,time; sys.{stream}.write('x'*3000000); sys.{stream}.flush(); time.sleep(30)"
            )
            with self.assertRaisesRegex(RuntimeError, "output limit"):
                child.finish(time.monotonic() + 5)
            self.assertTrue(child.reaped)
            self.assertLessEqual(len(child.stdout), 2 * 1024 * 1024)
            self.assertLessEqual(len(child.stderr), 64 * 1024)

    def test_bounded_input_and_incremental_lines(self):
        child = self.start(
            "import sys; print('started',flush=True); print(sys.stdin.readline().strip(),flush=True)"
        )
        child.wait_for_line(lambda line: line == b"started", time.monotonic() + 5)
        child.send(b"close\n", time.monotonic() + 2)
        child.wait_for_line(lambda line: line == b"close", time.monotonic() + 5)
        self.assertEqual(child.finish(time.monotonic() + 5).returncode, 0)

    def test_missing_waitid_refuses_before_spawn(self):
        with (
            patch("scripts.proof_process.os.waitid", None),
            patch(
                "scripts.proof_process.subprocess.Popen",
                side_effect=AssertionError("must not spawn"),
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "waitid"):
                self.start("pass")

    def test_unknown_ownership_never_signals(self):
        child = self.start("import time; time.sleep(30)")
        with (
            patch("scripts.proof_process.os.waitid", side_effect=ChildProcessError),
            patch(
                "scripts.proof_process.os.killpg",
                side_effect=AssertionError("unknown signal"),
            ) as signal_call,
        ):
            with self.assertRaises(UnsafeProcessGroup):
                child.abort()
            signal_call.assert_not_called()
        self.assertTrue(child.unsafe)
        # Restore the test's known child ownership; this is not native fallback.
        child.unsafe = False
        child.abort()

    def test_permission_failure_with_live_process_is_never_accepted(self):
        child = self.start("import time; time.sleep(30)")
        with patch("scripts.proof_process.os.killpg", side_effect=PermissionError):
            with self.assertRaises(UnsafeProcessGroup):
                child.abort()
        self.assertTrue(child.unsafe)
        child.unsafe = False
        child.abort()

    def test_unknown_group_members_quarantines_without_reap(self):
        child = self.start("import time; time.sleep(30)")
        with (
            patch.object(child, "_live_descendants", side_effect=OSError),
            patch.object(
                child.process, "wait", side_effect=AssertionError("unknown group reap")
            ) as reap,
        ):
            with self.assertRaises(UnsafeProcessGroup):
                child.abort()
            reap.assert_not_called()
        self.assertTrue(child.unsafe)
        self.assertFalse(child.reaped)
        child.unsafe = False
        child.abort()

    def test_exited_leader_eperm_with_live_descendant_refuses_reap(self):
        child = self.start("pass")
        deadline = time.monotonic() + 5
        while child.observe_exit() is None and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(child.observe_exit(), 0)
        with (
            patch("scripts.proof_process.os.killpg", side_effect=PermissionError),
            patch.object(child, "_live_descendants", return_value=True),
            patch.object(
                child.process, "wait", side_effect=AssertionError("live group reap")
            ) as reap,
        ):
            with self.assertRaises(UnsafeProcessGroup):
                child.abort()
            reap.assert_not_called()
        self.assertTrue(child.unsafe)
        self.assertFalse(child.reaped)
        child.unsafe = False
        child.abort()


if __name__ == "__main__":
    unittest.main()
