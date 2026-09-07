"""Developer-only real-window and one fake LaunchAgent persistence proof."""

import argparse
from builtins import BaseExceptionGroup
from contextlib import closing
import fcntl
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


def fresh_tick(home, previous, deadline, *, registration_id=None):
    # Integer seconds: move past the prior commit's wall-clock second before
    # resetting it, then require a strictly later committed daemon update.
    while int(time.time()) <= previous:
        if time.monotonic() >= deadline:
            raise TimeoutError("tick clock deadline")
        time.sleep(0.05)
    if time.monotonic() >= deadline:
        raise TimeoutError("tick deadline before schedule change")
    db = checked_database(home)
    with (
        closing(
            sqlite3.connect(f"{db.as_uri()}?mode=rw", uri=True, timeout=1)
        ) as connection,
        connection,
    ):
        connection.execute("BEGIN IMMEDIATE")
        rows = connection.execute(
            "SELECT user, interval_seconds, status, registration_id FROM watches"
        ).fetchall()
        if (
            len(rows) != 1
            or rows[0][0] != "alice"
            or rows[0][1] not in (600, 601)
            or rows[0][2] != "active"
            or not isinstance(rows[0][3], str)
            or not rows[0][3]
            or (registration_id is not None and rows[0][3] != registration_id)
        ):
            raise ValueError("fixture must contain the unchanged active alice watch")
        _, prior_interval, _, registration_id = rows[0]
        interval = 601 if prior_interval == 600 else 600
        # C1 replaces an existing task on interval/registration changes only.
        # Resetting last_ok alone leaves its existing 600-second sleep intact.
        # Keep the watch registration and daemon; use normal reconciliation.
        if (
            connection.execute(
                "UPDATE watches SET last_ok=0, interval_seconds=? WHERE user='alice'",
                (interval,),
            ).rowcount
            != 1
        ):
            raise ValueError("missing isolated watch")
    while time.monotonic() < deadline:
        checked_database(home)
        with closing(
            sqlite3.connect(f"{db.as_uri()}?mode=ro", uri=True, timeout=1)
        ) as connection:
            rows = connection.execute(
                "SELECT user, last_ok, interval_seconds, status, registration_id FROM watches"
            ).fetchall()
        if (
            len(rows) != 1
            or rows[0][0] != "alice"
            or rows[0][2:] != (interval, "active", registration_id)
        ):
            raise ValueError("isolated watch changed during tick observation")
        value = rows[0][1]
        if type(value) is int and value > previous:
            return {
                "last_ok": value,
                "prior_interval": prior_interval,
                "interval_seconds": interval,
                "registration_id": registration_id,
            }
        time.sleep(0.1)
    raise TimeoutError("no fresh committed fake watch tick")


def persistence_sequence(driver):
    errors = []
    try:
        driver.seed()
        driver.install()
        driver.tick("app_alive")
        driver.close_app()
        driver.tick("app_closed")
        driver.relocate()
        driver.tick("app_relocated")
    except BaseException as caught:
        errors.append(caught)
    # Stopping the independently owned app is safe even when a CLI group
    # became unknown. Never issue fallback native mutations in that case.
    app_stopped = False
    try:
        driver.stop_app()
        app_stopped = True
    except BaseException as caught:
        errors.append(caught)
    if app_stopped and not any(
        isinstance(error, UnsafeProcessGroup) for error in errors
    ):
        try:
            driver.cleanup()
        except BaseException as caught:
            errors.append(caught)
    if len(errors) == 1:
        raise errors[0]
    if errors:
        raise BaseExceptionGroup("native proof and finalization failed", errors)


def failure_record(error):
    record = {"type": type(error).__name__, "message": str(error)[:4096]}
    if isinstance(error, BaseExceptionGroup):
        record["errors"] = [failure_record(item) for item in error.exceptions]
    return record


class NativeCLIError(RuntimeError):
    """A normally completed nonzero CLI, not a timeout/unknown process group."""


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
        "migrate_started",
        "migrate_ready",
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
            "migrate_failed",
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
        self.watch_registration = None

    def pin_service(self, pid, started):
        if not started or len(started) > 128:
            raise RuntimeError("service start identity unavailable")
        identity = (pid, started)
        if self.service_identity is not None and identity != self.service_identity:
            raise RuntimeError("service restarted instead of continuing")
        self.service_identity = identity

    def cli(self, *args, cleanup_deadline=None):
        deadline = min(
            self.deadline if cleanup_deadline is None else cleanup_deadline,
            time.monotonic() + 45,
        )
        result = run_child(
            [str(self.fixture.python), "-I", "-B", "-m", "insto", *args],
            self.fixture.home,
            deadline,
            {**ENV, "INSTO_HOME": str(self.fixture.home), "INSTO_BACKEND": "fake"},
        )
        evidence = {"cli": list(args), "exit_code": result.returncode}
        self.evidence.append(evidence)
        if result.returncode:
            # This evidence is written only to the proof's new private0600
            # result file. Never send CLI output to the UI or progress console.
            evidence.update(
                {
                    "stdout": result.stdout[:16384].decode("utf-8", "replace"),
                    "stderr": result.stderr[:16384].decode("utf-8", "replace"),
                    "diagnostics_truncated": max(len(result.stdout), len(result.stderr))
                    > 16384,
                }
            )
            if result.returncode < 0:
                raise RuntimeError(
                    "isolated CLI was signal-terminated; diagnostics retained privately"
                )
            raise NativeCLIError("isolated CLI failed; diagnostics retained privately")
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
        tick = fresh_tick(
            self.fixture.home,
            self.previous,
            min(self.deadline, time.monotonic() + 40),
            registration_id=self.watch_registration,
        )
        self.watch_registration = tick["registration_id"]
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
                **tick,
                "prior_last_ok": self.previous,
                "service_pid": pid,
                "service_started": process.stdout.strip().decode("ascii"),
            }
        )
        self.previous = tick["last_ok"]

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
        deadline = time.monotonic() + 120
        owned = self.cleanup_artifacts()
        if owned:
            try:
                self.cli("watch-service", "uninstall", cleanup_deadline=deadline)
            except NativeCLIError:
                # Core may have completed bootout before its immediate absence
                # check failed. Retry at most once, only when the exact label
                # is now absent and ownership is revalidated. Never retry an
                # ambiguous/loaded label, timeout or unknown child state.
                if not label_absent(self.fixture.label, self.fixture.root, deadline):
                    raise
                if self.cleanup_artifacts():
                    self.cli("watch-service", "uninstall", cleanup_deadline=deadline)
        if (
            os.path.lexists(self.fixture.manifest)
            or os.path.lexists(self.fixture.plist)
            or not label_absent(self.fixture.label, self.fixture.root, deadline)
        ):
            raise RuntimeError("exact native cleanup unconfirmed; retain all artifacts")
        self.cleanup_confirmed = True

    def cleanup_artifacts(self):
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
        return manifest_exists or plist_exists


CLI_TOKEN = "isolated-migration-credential"
DESKTOP_TOKEN = "offline-fixture-token-not-real"
STAGE = "staged.json"
# The bridge always runs isolated and without bytecode, so the plist it writes
# on migration carries exactly these interpreter flags.
BRIDGE_FLAGS = ["-I", "-B"]
# What the product records as the manifest's `python`. It depends on the
# spawning environment, so it can only be observed, never guessed.
IDENTITY_SOURCE = "import os, sys; print(os.path.abspath(sys.executable))"


def account_home():
    """The home the host derives from the account database, ignoring HOME."""
    return Path(pwd.getpwuid(os.getuid()).pw_dir)


def label_for(home):
    return f"io.insto.watch.{os.getuid()}.{hashlib.sha256(os.fsencode(home)).hexdigest()[:16]}"


def stage_document(home):
    return {"schema_version": 1, "home": None if home is None else str(home)}


def redacted(document):
    raw = encoded(document)
    if CLI_TOKEN.encode() in raw or DESKTOP_TOKEN.encode() in raw:
        raise RuntimeError("refusing to record a fixture credential")
    return raw


def checked_child(argv, cwd, deadline, env=None, what="child"):
    result = run_child(argv, cwd, deadline, env)
    if result.returncode:
        # Diagnostics stay in the private 0600 result file, never on the console.
        raise NativeCLIError(f"{what} failed; diagnostics retained privately")
    return result


class StagedFixture:
    """One staged insto home and exactly one temporary LaunchAgent label.

    `migrate` stages the application's OWN profile inside the fresh proof root,
    so the binding the app reads is `own` and its startup flow may migrate
    automatically. `adopt` stages an ordinary CLI home beside the root — never
    inside it, and never under a parent carrying a desktop-root marker, because
    the core refuses such a home as `home_invalid`.
    """

    @classmethod
    def create(cls, root, source, manifest, previous_python, mode, agents=None):
        private_directory(root)
        private_directory(source.parent)
        safe_ancestors(source)
        if source.name != "insto.app" or source.parent != root.parent:
            raise ValueError("source must be this proof's copied insto.app sibling")
        if not root.name.startswith("insto-app-proof-") or not re.fullmatch(
            "[0-9a-f]{64}", manifest["build_id"]
        ):
            raise ValueError("invalid proof identity")
        if mode not in ("migrate", "adopt"):
            raise ValueError("unsupported staged mode")
        if any(root.iterdir()):
            raise ValueError("staging needs the root before the app publishes into it")
        bundled = (
            source / "Contents/Resources/runtime/python/bin/python3"
        ).resolve(strict=True)
        safe_ancestors(previous_python.parent)
        if (
            not previous_python.is_file()
            or previous_python.resolve(strict=True) != previous_python
            or previous_python == bundled
        ):
            raise ValueError(
                "previous interpreter must be an existing canonical other file"
            )
        fixture = cls()
        fixture.root, fixture.source, fixture.mode = root, source, mode
        fixture.bundled, fixture.previous = bundled, previous_python
        fixture.runtime_manifest = manifest
        fixture.published = (
            root / "runtimes" / manifest["build_id"] / "python/bin/python3"
        )
        if mode == "migrate":
            fixture.home = root / "profile"
            fixture.staged_home = None
        else:
            native = root.parent / "native"
            if os.path.lexists(native):
                raise ValueError("refusing a reused staging directory")
            native.mkdir(mode=0o700)
            fixture.home = native / "cli home"
            fixture.staged_home = fixture.home
        fixture.label = label_for(fixture.home)
        fixture.agents = (
            account_home() / "Library/LaunchAgents" if agents is None else agents
        )
        fixture.plist = fixture.agents / f"{fixture.label}.plist"
        fixture.manifest = fixture.home / "services/watch/manifest.json"
        if os.path.lexists(fixture.plist):
            raise ValueError("refusing existing exact registration")
        fixture.context = root.parent / f"{root.name}-identity.json"
        fixture.identity = {
            "mode": mode,
            "root": str(root),
            "home": str(fixture.home),
            "label": fixture.label,
            "plist": str(fixture.plist),
            "manifest": str(fixture.manifest),
            "bundled_python": str(bundled),
            "previous_python": str(previous_python),
            "published_python": str(fixture.published),
            "build_id": manifest["build_id"],
            "uid": os.getuid(),
        }
        fixture.raw = encoded(fixture.identity)
        write_new(fixture.context, fixture.raw)
        return fixture

    def validate(self):
        if private_read(self.context) != self.raw:
            raise ValueError("immutable identity changed")
        private_directory(self.root)
        private_directory(self.home)

    def seed(self, deadline):
        if self.mode == "migrate":
            checked_child(
                [
                    str(self.bundled),
                    "-I",
                    "-B",
                    str(REPO / "scripts/seed_desktop_fixture.py"),
                    str(self.root),
                    "[]",
                    "--desired=running",
                ],
                self.root.parent,
                min(deadline, time.monotonic() + 90),
                {**ENV, "HOME": str(self.root)},
                what="desktop profile seed",
            )
        else:
            checked_child(
                [
                    str(self.bundled),
                    "-I",
                    "-B",
                    str(REPO / "scripts/seed_cli_home.py"),
                    str(self.home),
                ],
                self.root.parent,
                min(deadline, time.monotonic() + 90),
                {**ENV, "HOME": str(self.home.parent)},
                what="cli home seed",
            )
        self.validate()

    def install_previous(self, deadline):
        """Register the service with the previous runtime, from a foreign cwd.

        The CLI pins its default `./output` against the working directory, and
        the bridge normalizes that to the home on migration; installing from
        elsewhere is the realistic case the migration must accept.
        """
        if not label_absent(self.label, self.root.parent, deadline):
            raise ValueError("refusing an already loaded exact label")
        checked_child(
            [str(self.previous), "-I", "-B", "-m", "insto", "watch-service", "install"],
            self.root.parent,
            min(deadline, time.monotonic() + 120),
            {**ENV, "INSTO_HOME": str(self.home)},
            what="previous-version install",
        )
        manifest = json.loads(private_read(self.manifest))
        plist = plistlib.loads(private_read(self.plist))
        if manifest["config_home"] != str(self.home) or plist.get("Label") != self.label:
            raise ValueError("installed registration is not this fixture's")
        if manifest["python"] != plist["ProgramArguments"][0]:
            raise ValueError("manifest and plist disagree about the interpreter")
        return manifest["python"]

    def bridge_identity(self, deadline):
        """The interpreter path a bridge process records for itself.

        Spawned exactly as the host spawns the bridge — same interpreter,
        `-I -B`, working directory and environment — because a framework build
        can report a different executable under a different spawn.
        """
        result = checked_child(
            [str(self.published), *BRIDGE_FLAGS, "-c", IDENTITY_SOURCE],
            self.root,
            min(deadline, time.monotonic() + 60),
            {
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                "LANG": "en_US.UTF-8",
                "LC_ALL": "en_US.UTF-8",
                "HOME": str(account_home()),
                "INSTO_DESKTOP_ROOT": str(self.root),
            },
            what="published interpreter identity",
        )
        return result.stdout.decode("ascii").strip()

    def registered_identity(self, expected):
        """Both files the product owns must name the same interpreter."""
        manifest = json.loads(private_read(self.manifest))
        if manifest["python"] != expected:
            raise ValueError("registration manifest names another interpreter")
        arguments = plistlib.loads(private_read(self.plist))["ProgramArguments"]
        if arguments != [
            expected,
            *BRIDGE_FLAGS,
            "-m",
            "insto.service.watch_service_runner",
            str(self.manifest),
        ]:
            raise ValueError("registration plist names another interpreter")
        return manifest

    def executor_pid(self, deadline):
        lock = Path(f"{self.home / 'store.db'}.watch.lock")
        end = min(deadline, time.monotonic() + 120)
        while time.monotonic() < end:
            try:
                pid = int(private_read(lock).strip())
            except (FileNotFoundError, ValueError, OSError):
                pid = 0
            if pid > 1:
                return pid
            time.sleep(0.2)
        raise TimeoutError("no verified service executor")

    def running_service(self, deadline):
        """The live PID, proven to be this fixture's runner.

        Only the command suffix is asserted: on a macOS framework build
        `bin/python` re-execs another binary and `ps -o command=` prints that
        one. Interpreter identity is proven from the manifest and the plist the
        product writes, never from `ps`.
        """
        pid = self.executor_pid(deadline)
        result = checked_child(
            ["/bin/ps", "-ww", "-p", str(pid), "-o", "command="],
            self.root.parent,
            min(deadline, time.monotonic() + 10),
            what="service command",
        )
        command = result.stdout.decode("utf-8", "replace").rstrip()
        suffix = f" {' '.join(BRIDGE_FLAGS)} -m insto.service.watch_service_runner {self.manifest}"
        if not command.endswith(suffix):
            raise RuntimeError("live service is not this fixture's runner")
        return pid

    def stage(self):
        write_new(self.root / STAGE, encoded(stage_document(self.staged_home)))

    def cleanup(self, deadline):
        """Fixture-owned cleanup that needs no application and no healthy journal.

        Boots the label out if loaded, removes this fixture's own files (plist
        first), then proves the job is gone and that no executor still holds the
        watch lock, whatever state a failed migration left behind.
        """
        target = f"gui/{os.getuid()}/{self.label}"
        loaded = run_child(
            ["/bin/launchctl", "print", target],
            self.root.parent,
            min(deadline, time.monotonic() + 10),
        )
        if loaded.returncode == 0:
            run_child(
                ["/bin/launchctl", "bootout", target],
                self.root.parent,
                min(deadline, time.monotonic() + 60),
            )
        for path in (self.plist, self.manifest):
            if os.path.lexists(path):
                private_read(path)  # links and foreign files are refused before any unlink
                path.unlink()
        while time.monotonic() < deadline:
            # bootout of a live job returns before launchd drops the label.
            if label_absent(self.label, self.root.parent, deadline):
                break
            time.sleep(0.5)
        lock = Path(f"{self.home / 'store.db'}.watch.lock")
        if os.path.lexists(lock):
            with open(lock, "rb") as stream:  # a live executor would hold this flock
                while True:
                    try:
                        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        if time.monotonic() >= deadline:
                            raise RuntimeError(
                                "an executor still holds the watch lock"
                            ) from None
                        time.sleep(0.5)
                        continue
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
                    break
        if (
            os.path.lexists(self.manifest)
            or os.path.lexists(self.plist)
            or not label_absent(self.label, self.root.parent, deadline)
        ):
            raise RuntimeError("exact native cleanup unconfirmed; retain all artifacts")


class StagedDriver:
    def __init__(self, fixture, app, deadline):
        self.fixture, self.app, self.deadline = fixture, app, deadline
        self.cleanup_confirmed = False
        self.evidence = []

    def stage(self):
        self.fixture.seed(self.deadline)
        previous_identity = self.fixture.install_previous(self.deadline)
        previous_pid = self.fixture.running_service(self.deadline)
        self.evidence.append(
            {
                "phase": "previous_registration",
                "interpreter": previous_identity,
                "service_pid": previous_pid,
                "label": self.fixture.label,
            }
        )
        self.previous_identity, self.previous_pid = previous_identity, previous_pid
        self.fixture.stage()

    def observe(self):
        markers = [
            "window_opened",
            "prepare_started",
            "prepare_ready",
            "inspect_started",
            "inspect_ready",
        ]
        if self.fixture.mode == "migrate":
            # Emitted by the command the application's own startup flow calls.
            markers += ["migrate_started", "migrate_ready"]
        for marker in [*markers, "ui_ready"]:
            window_marker(self.app, marker, self.deadline)

    def verify(self):
        published = self.fixture.bridge_identity(self.deadline)
        if published == self.previous_identity:
            raise ValueError(
                "the two runtimes resolve to the same interpreter; nothing is proven"
            )
        if self.fixture.mode == "migrate":
            self.fixture.registered_identity(published)
            pid = self.fixture.running_service(self.deadline)
            if pid == self.previous_pid:
                raise RuntimeError("the previous runner survived the migration")
            self.evidence.append(
                {"phase": "migrated", "interpreter": published, "service_pid": pid}
            )
        else:
            if os.path.lexists(self.fixture.manifest) or os.path.lexists(
                self.fixture.plist
            ):
                raise RuntimeError(
                    "the application did not remove the registration it took over"
                )
            if not label_absent(
                self.fixture.label, self.fixture.root.parent, self.deadline
            ):
                raise RuntimeError("the exact label is still loaded")
            for leaf in ("config.toml", "store.db"):
                private_read(self.fixture.home / leaf, 32 * 1024 * 1024)
            if os.path.lexists(self.fixture.root / "desktop-home.json"):
                raise RuntimeError("the binding was not released")
            self.evidence.append(
                {
                    "phase": "adopted_and_released",
                    "interpreter": published,
                    "label": self.fixture.label,
                }
            )

    def close_app(self):
        close_window(self.app, min(self.deadline, time.monotonic() + 180))
        self.evidence.append(
            {
                "phase": "app_exited",
                "exit_code": self.app.process.returncode,
                "owned_group_cleaned": True,
            }
        )

    def stop_app(self):
        if not self.app.reaped:
            self.app.abort()

    def cleanup(self):
        self.fixture.cleanup(time.monotonic() + 180)
        self.cleanup_confirmed = True


def staged_sequence(driver):
    errors = []
    try:
        driver.stage()
        driver.observe()
        driver.verify()
        driver.close_app()
    except BaseException as caught:
        errors.append(caught)
    app_stopped = False
    try:
        driver.stop_app()
        app_stopped = True
    except BaseException as caught:
        errors.append(caught)
    if app_stopped and not any(
        isinstance(error, UnsafeProcessGroup) for error in errors
    ):
        try:
            driver.cleanup()
        except BaseException as caught:
            errors.append(caught)
    if len(errors) == 1:
        raise errors[0]
    if errors:
        raise BaseExceptionGroup("staged proof and finalization failed", errors)


def run(source, root, mode, previous_runtime=None):
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
    staged = mode in ("migrate", "adopt")
    launch = [str(source / "Contents/MacOS/insto-gui"), "--proof-window", str(root)]
    if staged:
        launch.append("--staged")
    app = OwnedChild.start(launch, cwd=source.parent, env=ENV)
    driver = None
    started_at = time.monotonic()
    result = {
        "mode": mode,
        "passed": False,
        # Every mode that installs a real registration must earn this flag from
        # its own driver; only the pure window modes start out clean.
        "cleanup_confirmed": mode not in ("native", "migrate", "adopt"),
        "build_id": manifest["build_id"],
    }
    try:
        deadline = time.monotonic() + (600 if staged else 260)
        if staged:
            # `new_root` creates the root before the window is built and the app
            # then waits for `staged.json`, so the fixture is staged into a root
            # that is still empty.
            while not os.path.lexists(root):
                if time.monotonic() >= deadline or app.observe_exit() is not None:
                    raise RuntimeError("the app did not create its proof root")
                time.sleep(0.01)
            previous_python = (previous_runtime / "python/bin/python3").resolve(
                strict=True
            )
            fixture = StagedFixture.create(root, source, manifest, previous_python, mode)
            driver = StagedDriver(fixture, app, deadline)
            staged_sequence(driver)
        else:
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
                    close_window(
                        app, deadline, b"quit\n" if mode == "quit" else b"close\n"
                    )
        result["passed"] = True
    except BaseException as error:
        result["failure_type"] = type(error).__name__
        result["failure"] = failure_record(error)
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
            write_new(source.parent / f"{root.name}-result.json", redacted(result))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("root", type=Path)
    parser.add_argument(
        "--mode",
        choices=("window", "quit", "close-preparing", "native", "migrate", "adopt"),
        default="window",
    )
    parser.add_argument("--allow-native-fake", action="store_true")
    parser.add_argument("--previous-runtime", type=Path)
    args = parser.parse_args()
    if args.mode == "native" and not args.allow_native_fake:
        parser.error("native mode requires explicit --allow-native-fake")
    if (args.mode in ("migrate", "adopt")) != (args.previous_runtime is not None):
        parser.error("--previous-runtime is required by, and only by, the staged modes")
    result = run(args.source, args.root, args.mode, args.previous_runtime)
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
