"""Developer-only: seed one CLI-shaped insto home for desktop adoption fixtures.

Usage (with a prepared runtime interpreter, never a user machine):
    python3 -I -B scripts/seed_cli_home.py "/abs/parent/cli home"
The parent must exist, be canonical, owned, not group/other writable, and carry
no desktop-root marker; the home itself must not exist and is created 0700. The
configuration is what an ordinary terminal user has: `backend = "hikerapi"`, an
offline token that no provider will ever accept, and an unreachable proxy, with
no watches, so `home.inspect` reports the home as adoptable and no provider
request can leave the host. The database is created at the schema the pinned
core reads. This is not the desktop's own profile: the desktop's own profile is
seeded by `seed_desktop_fixture.py`, and a home whose parent is a desktop root
is refused here for the same reason `home.inspect` reports it `home_invalid`.
"""

import json
import os
import stat
import sys
from pathlib import Path
from typing import NoReturn

REPO = Path(__file__).resolve().parents[1]
# The offline credential the core's own native migration smoke uses. It is a
# valid token *shape* (4-4096 printable ASCII bytes) and nothing else.
TOKEN = "isolated-migration-credential"
# Refused connections instead of provider traffic, even if a future core grew a
# startup credential check. Port 9 (discard) is closed on a normal macOS host.
PROXY = "http://127.0.0.1:9"
# Files that only a desktop root carries beside its own profile; a home inside
# one is never adoptable (`insto.desktop.profile._DESKTOP_ROOT_MARKERS`).
MARKERS = ("desktop-state.json", "desktop-home.json", ".desktop.lock")
CONFIG = f'backend = "hikerapi"\n[hikerapi]\ntoken = "{TOKEN}"\nproxy = "{PROXY}"\n'


def fail(message: str) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(2)


def check_target(home: Path) -> None:
    """Refuse anything but a new child of a private, owned, non-root parent."""
    if not home.is_absolute() or Path(os.path.normpath(home)) != home:
        fail("home must be an absolute, normalized path")
    if os.path.lexists(home):
        fail("home must not exist yet")
    parent = home.parent
    try:
        info = parent.lstat()
    except OSError:
        fail("home parent must be an existing directory")
    if not stat.S_ISDIR(info.st_mode) or parent.resolve() != parent:
        fail("home parent must be an existing canonical directory")
    if info.st_uid != os.getuid() or info.st_mode & 0o022 or info.st_mode & 0o7000:
        fail("home parent must be owned and not group/other writable")
    if any(os.path.lexists(parent / name) for name in MARKERS):
        fail("home parent is a desktop root; such a home is never adoptable")


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: seed_cli_home.py HOME")
    home = Path(sys.argv[1])
    check_target(home)
    from insto.desktop.configuration import initialize_database

    home.mkdir(mode=0o700)
    config = home / "config.toml"
    descriptor = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(CONFIG.encode("utf-8"))
        stream.flush()
        os.fsync(stream.fileno())
    # Stage inside the new private home: the parent is shared with other
    # fixtures and must never hold a partial database.
    initialize_database(home / "store.db", stage_dir=home)
    print(json.dumps({"home": str(home), "config": str(config), "store": str(home / "store.db")}))


if __name__ == "__main__":
    main()
