"""Supervise one isolated fake LaunchAgent test; never a production controller."""

from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import stat
import subprocess
import time
from pathlib import Path
from typing import BinaryIO


class UnsafeProcessGroup(RuntimeError):
    """The test group could not be stopped; fallback mutation is unsafe."""


def _group_alive(pid: int) -> bool:
    try:
        os.killpg(pid, 0)
    except ProcessLookupError:
        return False
    return True


def stop_group(process: subprocess.Popen) -> None:
    """Signal only our new session, allowing pytest's finally block to run."""
    for sig, grace in ((signal.SIGINT, 60), (signal.SIGTERM, 5), (signal.SIGKILL, 5)):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            process.wait(timeout=5)
            return
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline:
            process.poll()  # Reap the leader before checking its group.
            if not _group_alive(process.pid):
                process.wait(timeout=5)
                return
            time.sleep(0.1)
    raise UnsafeProcessGroup(
        "owned child process group did not stop; retain proof artifacts"
    )


def _stop_confirmed(process: subprocess.Popen) -> None:
    try:
        stop_group(process)
    except BaseException as exc:
        # A second Ctrl-C or signaling error must not allow fallback while
        # a child management command could still hold its mutation lock.
        raise UnsafeProcessGroup("child group shutdown was not confirmed") from exc


def run_child(
    command: list[str], *, log: BinaryIO, cwd: Path, env: dict[str, str], timeout: float
) -> int:
    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    except BaseException as exc:
        # Construction may be interrupted after fork but before a process
        # handle reaches us. No handle means no proof that the group is gone.
        raise UnsafeProcessGroup(
            "child construction did not confirm process state"
        ) from exc
    try:
        code = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        _stop_confirmed(process)
        raise RuntimeError(f"child timed out after {timeout} seconds") from None
    except BaseException:
        _stop_confirmed(process)
        raise
    # A reaped pytest leader is insufficient if a CLI child is still alive.
    try:
        alive = _group_alive(process.pid)
    except BaseException as exc:
        raise UnsafeProcessGroup("child group state is unknown") from exc
    if alive:
        _stop_confirmed(process)
        raise RuntimeError("test exited with remaining child processes")
    return code


def label_absent(label: str, environment: dict[str, str]) -> bool:
    result = subprocess.run(
        ["/bin/launchctl", "print", f"gui/{os.getuid()}/{label}"],
        capture_output=True,
        env=environment,
        timeout=10,
        check=False,
    )
    if result.returncode == 0:
        return False
    expected = f'Bad request.\nCould not find service "{label}" in domain for user gui: {os.getuid()}\n'
    if (
        result.returncode == 113
        and not result.stdout
        and result.stderr.decode() == expected
    ):
        return True
    raise RuntimeError("launchctl did not confirm absence of the exact test label")


def _private_directory(path: Path) -> None:
    info = path.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o7077
    ):
        raise ValueError(f"expected private owned ordinary directory: {path}")


def _exists(path: Path) -> bool:
    return os.path.lexists(path)


def _check_home(home: Path) -> None:
    _private_directory(home.parent)
    _private_directory(home)
    config = home / "config.toml"
    info = config.lstat()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o7077
    ):
        raise ValueError("unsafe isolated config")
    if config.read_bytes() != b'backend = "fake"\n':
        raise ValueError("isolated config is not the exact fake fixture")


def _write_context(path: Path, context: dict, *, first: bool = False) -> None:
    flags = (
        os.O_WRONLY | os.O_NOFOLLOW | (os.O_CREAT | os.O_EXCL if first else os.O_TRUNC)
    )
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(context, stream, indent=2)
        stream.write("\n")


def run_native(
    *, core: Path, python: Path, root: Path, environment: dict[str, str]
) -> None:
    _private_directory(root)
    if not root.is_absolute() or root.resolve() != root:
        raise ValueError("native proof root must be canonical and absolute")
    if (
        not python.is_absolute()
        or python != root / "different path/python/bin/python3"
        or not python.is_file()
    ):
        raise ValueError("native interpreter must be the retained relocated runtime")
    core = core.resolve(strict=True)
    test_python = core / ".venv/bin/python"
    test_file = core / "tests/e2e/test_watch_service.py"
    if not test_python.is_file() or not test_file.is_file():
        raise ValueError("native smoke requires the C0 developer test environment")
    # An allowlist prevents credentials, pytest configuration and Python path
    # overrides from leaking in even if called outside probe_runtime.
    env = {key: environment[key] for key in ("PATH", "LANG")}
    base = root / "native-test"
    home = base / "service home"
    label = f"io.insto.watch.{os.getuid()}.{hashlib.sha256(os.fsencode(home)).hexdigest()[:16]}"
    plist = Path.home() / "Library/LaunchAgents" / f"{label}.plist"
    manifest = home / "services/watch/manifest.json"
    if _exists(base) or _exists(plist):
        raise ValueError("refusing to reuse existing native test state")
    if not label_absent(label, env):
        raise RuntimeError("test label already loaded; no test was started")
    identity = {
        "runtime": str(python),
        "home": str(home),
        "label": label,
        "plist": str(plist),
        "backend": "fake",
    }
    context = {
        **identity,
        "phase": "starting",
        "exit_code": None,
        "cleanup_confirmed": False,
    }
    context_path = root / "native-context.json"
    _write_context(context_path, context, first=True)
    error: BaseException | None = None
    cleanup_error: BaseException | None = None
    log_path = root / "native-result.txt"
    try:
        with log_path.open("xb") as log:
            context["exit_code"] = run_child(
                [
                    str(test_python),
                    "-m",
                    "pytest",
                    str(test_file),
                    "--basetemp",
                    str(base),
                    "-q",
                ],
                log=log,
                cwd=core,
                timeout=600,
                env={
                    **env,
                    "INSTO_TEST_LAUNCHD": "1",
                    "INSTO_TEST_NO_BYTECODE": "1",
                    "INSTO_TEST_PYTHON": str(python),
                    "INSTO_TEST_HOME": str(home),
                },
            )
        with log_path.open("rb") as log:
            log.seek(max(0, log_path.stat().st_size - 65536))
            tail = log.read().decode("utf-8", errors="replace")
        if context["exit_code"] != 0 or not re.search(
            r"^1 passed(?: in [\d.]+s)?\s*$", tail, re.MULTILINE
        ):
            raise RuntimeError(
                "native smoke requires exactly one passing test, not a skip"
            )
    except BaseException as exc:
        error = exc
    finally:
        try:
            if isinstance(error, UnsafeProcessGroup):
                raise error
            # Confirm the recorded identity was not substituted before any
            # fallback mutation. The core controller validates manifest/plist
            # contents and ownership again under its management lock.
            saved = json.loads(context_path.read_text())
            if any(saved.get(key) != value for key, value in identity.items()):
                raise ValueError("native context identity changed")
            if _exists(manifest) or _exists(plist):
                _check_home(home)
                with log_path.open("ab") as log:
                    code = run_child(
                        [
                            str(python),
                            "-I",
                            "-B",
                            "-m",
                            "insto",
                            "watch-service",
                            "uninstall",
                        ],
                        cwd=root,
                        log=log,
                        timeout=120,
                        env={**env, "INSTO_HOME": str(home), "INSTO_BACKEND": "fake"},
                    )
                if code != 0:
                    raise RuntimeError("fallback uninstall failed")
            if _exists(manifest) or _exists(plist) or not label_absent(label, env):
                raise RuntimeError("isolated native registration remains")
            context["cleanup_confirmed"] = True
        except BaseException as exc:
            cleanup_error = exc
        context["phase"] = (
            "cleanup_failed" if cleanup_error else "failed" if error else "passed"
        )
        if error:
            context["error"] = f"{type(error).__name__}: {error}"
        if cleanup_error:
            context["cleanup_error"] = (
                f"{type(cleanup_error).__name__}: {cleanup_error}"
            )
        _write_context(context_path, context)
    if cleanup_error:
        raise RuntimeError(
            f"native cleanup unconfirmed; retain {root}: {cleanup_error}"
        ) from cleanup_error
    if error:
        raise error
