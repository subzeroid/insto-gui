"""Developer-only real-window and one fake LaunchAgent persistence proof."""

import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import plistlib
import pwd
import re
import sqlite3
import stat
import sys
import time

from scripts.app_manifest import read_manifest
from scripts.proof_process import OwnedChild, UnsafeProcessGroup
from scripts.runtime_manifest import verify

REPO = Path(__file__).resolve().parents[1]
ENV = {"PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8"}
FAKE_CONFIG = b'backend = "fake"\n'


def private_directory(path):
    info = path.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o7077
    ):
        raise ValueError("expected private owned directory")
    if not path.is_absolute() or path.resolve(strict=True) != path:
        raise ValueError("expected canonical absolute directory")
    return info.st_dev, info.st_ino


def safe_ancestors(path):
    for parent in (path, *path.parents):
        info = parent.lstat()
        if (
            not stat.S_ISDIR(info.st_mode)
            or info.st_uid not in (0, os.getuid())
            or info.st_mode & 0o7022
        ):
            raise ValueError("unsafe ancestor directory")
    if path.resolve(strict=True) != path:
        raise ValueError("noncanonical path")


def private_read(path, limit=65536):
    safe_ancestors(path.parent)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_nlink != 1
            or info.st_mode & 0o7077
        ):
            raise ValueError("expected private owned single-link file")
        if info.st_size > limit:
            raise ValueError("private file byte limit")
        data = stream.read(limit + 1)
        if len(data) > limit:
            raise ValueError("private file byte limit")
        return data


def write_new(path, data):
    private_directory(path.parent)
    descriptor = os.open(
        path, os.O_WRONLY | os.O_NOFOLLOW | os.O_CREAT | os.O_EXCL, 0o600
    )
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()


class Fixture:
    @classmethod
    def create(cls, root, source, manifest):
        private_directory(root)
        private_directory(source.parent)
        safe_ancestors(source)
        if source.name != "insto.app" or source.parent != root.parent:
            raise ValueError("source must be this proof's copied insto.app sibling")
        if not root.name.startswith("insto-app-proof-") or not re.fullmatch(
            "[0-9a-f]{64}", manifest["build_id"]
        ):
            raise ValueError("invalid proof identity")
        moved = source.with_name("insto-moved.app")
        if os.path.lexists(moved) or os.path.lexists(root / "native"):
            raise ValueError("refusing reused fixture or relocation destination")
        runtime = root / "runtimes" / manifest["build_id"]
        private_directory(runtime)
        verify(runtime / "python", manifest["files"])
        if (
            json.loads(private_read(runtime / "manifest.json", 16 * 1024 * 1024))
            != manifest
        ):
            raise ValueError("published runtime manifest mismatch")
        fixture = cls()
        fixture.root, fixture.source, fixture.moved = root, source, moved
        fixture.runtime_manifest = manifest
        fixture.runtime = runtime
        fixture.python = runtime / "python/bin/python3"
        fixture.home = root / "native/service home"
        fixture.label = f"io.insto.watch.{os.getuid()}.{hashlib.sha256(os.fsencode(fixture.home)).hexdigest()[:16]}"
        fixture.plist = (
            Path(pwd.getpwuid(os.getuid()).pw_dir)
            / "Library/LaunchAgents"
            / f"{fixture.label}.plist"
        )
        fixture.manifest = fixture.home / "services/watch/manifest.json"
        if os.path.lexists(fixture.plist):
            raise ValueError("refusing existing exact registration")
        (root / "native").mkdir(mode=0o700)
        fixture.home.mkdir(mode=0o700)
        write_new(fixture.home / "config.toml", FAKE_CONFIG)
        fixture.context = root / "native/identity.json"
        fixture.directories = {
            path: private_directory(path)
            for path in (root, root / "native", fixture.home, runtime, source.parent)
        }
        info = source.lstat()
        fixture.app_inode = (info.st_dev, info.st_ino)
        fixture.identity = {
            "source_app": str(source),
            "moved_app": str(moved),
            "root": str(root),
            "home": str(fixture.home),
            "python": str(fixture.python),
            "build_id": manifest["build_id"],
            "label": fixture.label,
            "plist": str(fixture.plist),
            "manifest": str(fixture.manifest),
            "backend": "fake",
            "uid": os.getuid(),
            "app_inode": fixture.app_inode,
        }
        fixture.raw = encoded(fixture.identity)
        write_new(fixture.context, fixture.raw)
        info = fixture.context.lstat()
        fixture.context_inode = (info.st_dev, info.st_ino)
        return fixture

    def validate(self):
        for path, identity in self.directories.items():
            if private_directory(path) != identity:
                raise ValueError("fixture directory identity changed")
        if private_read(self.context) != self.raw:
            raise ValueError("immutable identity changed")
        info = self.context.lstat()
        if (info.st_dev, info.st_ino) != self.context_inode:
            raise ValueError("identity journal replaced")
        if private_read(self.home / "config.toml") != FAKE_CONFIG:
            raise ValueError("fixture is no longer exact fake config")
        verify(self.runtime / "python", self.runtime_manifest["files"])
        if (
            json.loads(private_read(self.runtime / "manifest.json", 16 * 1024 * 1024))
            != self.runtime_manifest
        ):
            raise ValueError("published manifest changed")
        candidates = [
            path for path in (self.source, self.moved) if os.path.lexists(path)
        ]
        if len(candidates) != 1:
            raise ValueError("source app identity ambiguous")
        safe_ancestors(candidates[0])
        info = candidates[0].lstat()
        if (info.st_dev, info.st_ino) != self.app_inode:
            raise ValueError("source app replaced")

    def relocate(self):
        self.validate()
        if not self.source.is_dir() or os.path.lexists(self.moved):
            raise ValueError("relocation requires original and absent destination")
        # Both exact siblings belong to this new private artifact directory.
        # No caller-supplied destination and no reusable source app are accepted.
        self.source.rename(self.moved)
        self.validate()


def checked_database(home):
    private_directory(home)
    path = home / "store.db"
    private_read(path, 32 * 1024 * 1024)
    for suffix in ("-wal", "-shm", "-journal"):
        sidecar = path.with_name(path.name + suffix)
        if os.path.lexists(sidecar):
            private_read(sidecar, 32 * 1024 * 1024)
    return path


def fresh_tick(home, previous, deadline):
    # Integer seconds: move past the prior commit's wall-clock second before
    # resetting it, then require a strictly later committed daemon update.
    while int(time.time()) <= previous:
        if time.monotonic() >= deadline:
            raise TimeoutError("tick clock deadline")
        time.sleep(0.05)
    db = checked_database(home)
    with (
        closing(
            sqlite3.connect(f"{db.as_uri()}?mode=rw", uri=True, timeout=1)
        ) as connection,
        connection,
    ):
        if connection.execute("SELECT user FROM watches").fetchall() != [("alice",)]:
            raise ValueError("fixture must contain exactly the alice watch")
        if (
            connection.execute(
                "UPDATE watches SET last_ok=0 WHERE user='alice'"
            ).rowcount
            != 1
        ):
            raise ValueError("missing isolated watch")
    while time.monotonic() < deadline:
        checked_database(home)
        with closing(
            sqlite3.connect(f"{db.as_uri()}?mode=ro", uri=True, timeout=1)
        ) as connection:
            value = connection.execute(
                "SELECT last_ok FROM watches WHERE user='alice'"
            ).fetchone()[0]
        if type(value) is int and value > previous:
            return value
        time.sleep(0.1)
    raise TimeoutError("no fresh committed fake watch tick")


def persistence_sequence(driver):
    error = None
    try:
        driver.seed()
        driver.install()
        driver.tick("app_alive")
        driver.close_app()
        driver.tick("app_closed")
        driver.relocate()
        driver.tick("app_relocated")
    except BaseException as caught:
        error = caught
    finally:
        # Stopping the independently owned app is safe even when a CLI group
        # became unknown. Never issue fallback native mutations in that case.
        driver.stop_app()
        if not isinstance(error, UnsafeProcessGroup):
            driver.cleanup()
    if error:
        raise error


def run_child(argv, cwd, deadline, env=None):
    if time.monotonic() >= deadline:
        raise TimeoutError("proof deadline expired before spawn")
    return OwnedChild.start(argv, cwd=cwd, env=ENV if env is None else env).finish(
        deadline
    )


def label_absent(label, cwd, deadline):
    result = run_child(
        ["/bin/launchctl", "print", f"gui/{os.getuid()}/{label}"],
        cwd,
        min(deadline, time.monotonic() + 10),
    )
    if result.returncode == 0:
        return False
    expected = f'Bad request.\nCould not find service "{label}" in domain for user gui: {os.getuid()}\n'.encode()
    if result.returncode == 113 and result.stdout == b"" and result.stderr == expected:
        return True
    raise RuntimeError("exact launchd label absence is unconfirmed")


def window_marker(child, expected, deadline):
    progress = {
        "window_opened",
        "ui_ready",
        "close_requested",
        "exit_requested",
        "drained",
        "script_started",
        "form_ready",
        "prepare_started",
        "prepare_ready",
        "inspect_started",
        "inspect_ready",
    }
    if expected not in progress:
        raise ValueError("unsupported static proof marker")

    def match(line):
        try:
            value = json.loads(line)
        except (ValueError, UnicodeError):
            return False
        if expected == "drained" and value in (
            {"proof": "prepare_failed", "code": "closed"},
            {"proof": "inspect_failed", "code": "closed"},
            {"proof": "inspect_failed", "code": "transport"},
        ):
            # Only after a real Close/ExitRequested marker: cancellation of
            # accepted initialization/reads is expected while draining.
            return False
        if isinstance(value, dict) and value.get("proof") in (
            "ui_failed",
            "prepare_failed",
            "inspect_failed",
        ):
            raise RuntimeError("real WebKit proof failed; retain bounded evidence")
        if any(value == {"proof": event} for event in progress):
            print(json.dumps({"observed": value["proof"]}), flush=True)
        return value == {"proof": expected}

    child.wait_for_line(match, deadline)


def close_window(child, deadline, control=b"close\n"):
    child.send(control, min(deadline, time.monotonic() + 2))
    window_marker(
        child,
        "close_requested" if control == b"close\n" else "exit_requested",
        deadline,
    )
    window_marker(child, "drained", deadline)
    result = child.finish(deadline)
    if result.returncode != 0:
        raise RuntimeError("real app did not exit successfully")


class NativeDriver:
    def __init__(self, fixture, app, deadline):
        self.fixture, self.app, self.deadline = fixture, app, deadline
        self.cleanup_confirmed = False
        self.previous = 0
        self.evidence = []
        self.service_identity = None

    def pin_service(self, pid, started):
        if not started or len(started) > 128:
            raise RuntimeError("service start identity unavailable")
        identity = (pid, started)
        if self.service_identity is not None and identity != self.service_identity:
            raise RuntimeError("service restarted instead of continuing")
        self.service_identity = identity

    def cli(self, *args, cleanup=False):
        deadline = (
            time.monotonic() + 120
            if cleanup
            else min(self.deadline, time.monotonic() + 45)
        )
        result = run_child(
            [str(self.fixture.python), "-I", "-B", "-m", "insto", *args],
            self.fixture.home,
            deadline,
            {**ENV, "INSTO_HOME": str(self.fixture.home), "INSTO_BACKEND": "fake"},
        )
        self.evidence.append({"cli": list(args), "exit_code": result.returncode})
        if result.returncode:
            raise RuntimeError("isolated CLI failed; no raw diagnostics forwarded")
        return result

    def seed(self):
        self.fixture.validate()
        if not label_absent(self.fixture.label, self.fixture.root, self.deadline):
            raise ValueError("refusing already loaded exact label")
        self.cli("@alice", "-c", "watch", "600")

    def install(self):
        self.cli("watch-service", "install")
        manifest = json.loads(private_read(self.fixture.manifest))
        expected = {
            "config_home": str(self.fixture.home),
            "python": str(self.fixture.python),
            "backend": "fake",
            "label": self.fixture.label,
            "db_path": str(self.fixture.home / "store.db"),
            "env_file": None,
        }
        if any(manifest.get(key) != value for key, value in expected.items()):
            raise ValueError("installed manifest differs from isolated fixture")
        plist = plistlib.loads(private_read(self.fixture.plist))
        if plist.get("Label") != self.fixture.label or plist.get(
            "ProgramArguments"
        ) != [
            str(self.fixture.python),
            "-I",
            "-B",
            "-m",
            "insto.service.watch_service_runner",
            str(self.fixture.manifest),
        ]:
            raise ValueError("daemon does not use exact published interpreter")

    def tick(self, phase):
        if phase == "app_alive" and self.app.observe_exit() is not None:
            raise RuntimeError("app exited before live-window tick")
        if phase != "app_alive" and not self.app.reaped:
            raise UnsafeProcessGroup(
                "app group not closed before persistence observation"
            )
        value = fresh_tick(
            self.fixture.home, self.previous, min(self.deadline, time.monotonic() + 40)
        )
        status = json.loads(self.cli("watch-service", "status", "--json").stdout)
        pid = status.get("process", {}).get("pid")
        lock_pid = int(private_read(self.fixture.home / "store.db.watch.lock").strip())
        if (
            type(pid) is not int
            or pid <= 1
            or pid != lock_pid
            or status.get("registration") != "loaded"
        ):
            raise RuntimeError("tick lacks verified exact service process")
        if phase == "app_alive" and self.app.observe_exit() is not None:
            raise RuntimeError("app exited during live-window tick")
        process = run_child(
            ["/bin/ps", "-p", str(pid), "-o", "lstart="],
            self.fixture.root,
            min(self.deadline, time.monotonic() + 5),
        )
        if process.returncode:
            raise RuntimeError("service start identity unavailable")
        self.pin_service(pid, process.stdout.strip())
        self.evidence.append(
            {
                "phase": phase,
                "last_ok": value,
                "prior_last_ok": self.previous,
                "service_pid": pid,
                "service_started": process.stdout.strip().decode("ascii"),
            }
        )
        self.previous = value

    def close_app(self):
        close_window(self.app, min(self.deadline, time.monotonic() + 130))
        self.evidence.append(
            {
                "phase": "app_exited",
                "exit_code": self.app.process.returncode,
                "owned_group_cleaned": True,
            }
        )

    def relocate(self):
        self.fixture.relocate()
        self.evidence.append({"phase": "source_app_relocated"})

    def stop_app(self):
        if not self.app.reaped:
            self.app.abort()

    def cleanup(self):
        self.fixture.validate()
        manifest_exists = os.path.lexists(self.fixture.manifest)
        plist_exists = os.path.lexists(self.fixture.plist)
        if manifest_exists or plist_exists:
            # Reads reject links/foreign files first; the installed controller
            # then validates exact ownership contents under its management lock.
            if manifest_exists:
                private_read(self.fixture.manifest)
            if plist_exists:
                private_read(self.fixture.plist)
            self.cli("watch-service", "uninstall", cleanup=True)
        if (
            os.path.lexists(self.fixture.manifest)
            or os.path.lexists(self.fixture.plist)
            or not label_absent(
                self.fixture.label, self.fixture.root, time.monotonic() + 15
            )
        ):
            raise RuntimeError("exact native cleanup unconfirmed; retain all artifacts")
        self.cleanup_confirmed = True


def run(source, root, mode):
    if sys.platform != "darwin" or not callable(getattr(os, "waitid", None)):
        raise RuntimeError("native proof requires macOS developer Python with waitid")
    build = REPO / ".build"
    private_directory(build)
    private_directory(source.parent)
    safe_ancestors(source)
    if (
        source.parent.parent != build
        or not source.parent.name.startswith("native-app-")
        or {path.name for path in source.parent.iterdir()} != {"insto.app"}
        or source.name != "insto.app"
        or root.parent != source.parent
        or not root.name.startswith("insto-app-proof-")
        or os.path.lexists(root)
    ):
        raise ValueError("proof needs a fresh root beside a new private copied app")
    bundle = source / "Contents/Resources/runtime"
    manifest = read_manifest(
        bundle / "manifest.json",
        json.loads((REPO / "packaging/core-pin.json").read_text()),
        json.loads((REPO / "packaging/python-distributions.json").read_text()),
    )
    verify(bundle / "python", manifest["files"])
    app = OwnedChild.start(
        [str(source / "Contents/MacOS/insto-gui"), "--proof-window", str(root)],
        cwd=source.parent,
        env=ENV,
    )
    driver = None
    started_at = time.monotonic()
    result = {
        "mode": mode,
        "passed": False,
        "cleanup_confirmed": mode != "native",
        "build_id": manifest["build_id"],
    }
    try:
        deadline = time.monotonic() + 260
        window_marker(app, "window_opened", deadline)
        if mode == "close-preparing":
            while not os.path.lexists(root / "runtime.lock"):
                if time.monotonic() >= deadline or app.observe_exit() is not None:
                    raise RuntimeError("runtime preparation did not begin")
                time.sleep(0.01)
            close_window(app, deadline)
        else:
            window_marker(app, "ui_ready", deadline)
            if mode == "native":
                fixture = Fixture.create(root, source, manifest)
                driver = NativeDriver(fixture, app, deadline)
                persistence_sequence(driver)
            else:
                close_window(app, deadline, b"quit\n" if mode == "quit" else b"close\n")
        result["passed"] = True
    except BaseException as error:
        result["failure_type"] = type(error).__name__
        raise
    finally:
        try:
            if not app.reaped and not app.unsafe:
                app.abort()
        finally:
            result["app_group_cleaned"] = app.reaped
            result["elapsed_seconds"] = round(time.monotonic() - started_at, 3)
            if driver:
                result["cleanup_confirmed"] = driver.cleanup_confirmed
                result["native_events"] = driver.evidence
            result["app_stdout"] = bytes(app.stdout).decode("utf-8", "replace")
            result["app_stderr"] = bytes(app.stderr).decode("utf-8", "replace")
            write_new(source.parent / f"{root.name}-result.json", encoded(result))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("root", type=Path)
    parser.add_argument(
        "--mode",
        choices=("window", "quit", "close-preparing", "native"),
        default="window",
    )
    parser.add_argument("--allow-native-fake", action="store_true")
    args = parser.parse_args()
    if args.mode == "native" and not args.allow_native_fake:
        parser.error("native mode requires explicit --allow-native-fake")
    result = run(args.source, args.root, args.mode)
    print(
        json.dumps(
            {
                key: result[key]
                for key in ("mode", "passed", "cleanup_confirmed", "app_group_cleaned")
            }
        )
    )


if __name__ == "__main__":
    main()
