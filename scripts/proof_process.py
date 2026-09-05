"""Developer-only process ownership for isolated application proofs."""

import os
import select
import signal
import subprocess
import time

_QUARANTINE = []


class UnsafeProcessGroup(RuntimeError):
    pass


class OwnedChild:
    def __init__(self, process):
        self.process = process
        self.reaped = False
        self.unsafe = False
        self.stdout = bytearray()
        self.stderr = bytearray()
        self._line_offset = 0
        self._closed_streams = set()
        for stream in (process.stdin, process.stdout, process.stderr):
            os.set_blocking(stream.fileno(), False)

    @classmethod
    def start(cls, argv, *, cwd, env):
        if not callable(getattr(os, "waitid", None)) or not hasattr(os, "WNOWAIT"):
            raise RuntimeError("developer proof requires waitid(WNOWAIT)")
        try:
            process = subprocess.Popen(
                argv,
                cwd=cwd,
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=True,
            )
        except BaseException as error:
            raise UnsafeProcessGroup(
                "child construction did not establish ownership"
            ) from error
        try:
            return cls(process)
        except BaseException as error:
            _QUARANTINE.append(process)
            raise UnsafeProcessGroup("child pipes could not be initialized") from error

    def observe_exit(self):
        if self.unsafe:
            raise UnsafeProcessGroup("child ownership is unconfirmed")
        if self.reaped:
            return self.process.returncode
        try:
            info = os.waitid(
                os.P_PID, self.process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT
            )
        except BaseException as error:
            self._quarantine()
            raise UnsafeProcessGroup("child identity is no longer reserved") from error
        if info is None:
            return None
        return info.si_status if info.si_code == os.CLD_EXITED else -info.si_status

    def _quarantine(self):
        self.unsafe = True
        _QUARANTINE.append(self)

    def _read(self):
        for stream, output, limit in (
            (self.process.stdout, self.stdout, 2 * 1024 * 1024),
            (self.process.stderr, self.stderr, 64 * 1024),
        ):
            if stream in self._closed_streams:
                continue
            try:
                chunk = os.read(stream.fileno(), min(65536, limit - len(output) + 1))
            except BlockingIOError:
                continue
            if not chunk:
                self._closed_streams.add(stream)
            elif len(output) + len(chunk) > limit:
                raise RuntimeError("child output limit exceeded")
            else:
                output.extend(chunk)

    def send(self, data, deadline):
        if len(data) > 64:
            raise ValueError("proof control exceeds input limit")
        if self.reaped or self.unsafe:
            raise UnsafeProcessGroup("cannot write to closed child")
        offset = 0
        while offset < len(data):
            if time.monotonic() >= deadline:
                raise TimeoutError("proof control timed out")
            _, writable, _ = select.select(
                [],
                [self.process.stdin],
                [],
                max(0, min(0.05, deadline - time.monotonic())),
            )
            if writable:
                offset += os.write(self.process.stdin.fileno(), data[offset:])

    def wait_for_line(self, predicate, deadline):
        try:
            while time.monotonic() < deadline:
                self._read()
                while (end := self.stdout.find(b"\n", self._line_offset)) >= 0:
                    line = bytes(self.stdout[self._line_offset : end])
                    self._line_offset = end + 1
                    if predicate(line):
                        return line
                if self.observe_exit() is not None:
                    raise RuntimeError("child exited before proof signal")
                time.sleep(0.01)
            raise TimeoutError("proof signal timed out")
        except BaseException:
            if not self.unsafe:
                self.abort()
            raise

    def _live_descendants(self):
        # Only numeric process metadata is inspected. The leader remains
        # waitable, reserving this PGID throughout this check and final signal.
        result = subprocess.run(
            ["/bin/ps", "-axo", "pid=,pgid=,stat="],
            capture_output=True,
            timeout=2,
            check=True,
            env={"PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8"},
        )
        for line in result.stdout.splitlines():
            columns = line.split()
            if len(columns) != 3:
                raise UnsafeProcessGroup("unrecognized process metadata")
            pid, pgid = int(columns[0]), int(columns[1])
            if (
                pgid == self.process.pid
                and pid != self.process.pid
                and not columns[2].startswith(b"Z")
            ):
                return True
        return False

    def _finish_group(self):
        if self.reaped:
            return
        self.observe_exit()  # ECHILD must fail before any possible signal.
        try:
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                if self.observe_exit() is None:
                    raise UnsafeProcessGroup(
                        "owned group disappeared before child exit"
                    ) from None
            except PermissionError:
                # Darwin reports EPERM for a group consisting only of an
                # unreaped zombie. Accept this only after WNOWAIT confirms the
                # leader exited and numeric process inspection confirms no
                # live descendants. Any live/unknown member still fails closed.
                if self.observe_exit() is None or self._live_descendants():
                    raise UnsafeProcessGroup(
                        "cannot signal a live owned group"
                    ) from None
            deadline = time.monotonic() + 5
            while self.observe_exit() is None or self._live_descendants():
                if time.monotonic() >= deadline:
                    raise UnsafeProcessGroup("owned child group did not terminate")
                time.sleep(0.02)
            # The sole reap occurs only after the final signal and confirmation
            # that no live group member can still perform a management mutation.
            self.process.wait(timeout=1)
            self.reaped = True
        except BaseException as error:
            self._quarantine()
            raise UnsafeProcessGroup("child group cleanup is unconfirmed") from error
        finally:
            if self.reaped:
                self.process.stdin.close()

    def abort(self):
        if self.reaped:
            return
        self._finish_group()
        self.process.stdout.close()
        self.process.stderr.close()

    def finish(self, deadline):
        try:
            while True:
                self._read()
                if self.observe_exit() is not None:
                    break
                if time.monotonic() >= deadline:
                    raise TimeoutError("child deadline exceeded")
                time.sleep(0.01)
            self._finish_group()
            drain_deadline = time.monotonic() + 2
            while len(self._closed_streams) < 2:
                self._read()
                if time.monotonic() >= drain_deadline:
                    raise RuntimeError("child output remained open after group cleanup")
                time.sleep(0.001)
            return subprocess.CompletedProcess(
                self.process.args,
                self.process.returncode,
                bytes(self.stdout),
                bytes(self.stderr),
            )
        except BaseException:
            if not self.unsafe:
                self.abort()
            raise
        finally:
            if self.reaped:
                self.process.stdout.close()
                self.process.stderr.close()
