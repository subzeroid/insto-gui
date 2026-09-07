"""Developer-only: seed one fresh isolated desktop profile with saved snapshots.

Usage (with the prepared runtime interpreter, never a user machine):
    python3 -I -B scripts/seed_desktop_fixture.py /abs/fresh/root ROWS_JSON [--desired=running|stopped]
The root must exist, be canonical, private (0700) and empty. The core's Profile
also enforces its own ancestor-permission policy on the root's parents: the
macOS per-user temp dir satisfies it, a 1777 /tmp may not. The token written
is a fake offline value; the bridge never contacts a provider for C2 reads.
"""

import contextlib
import json
import os
import sqlite3
import stat
import sys
from pathlib import Path
from typing import NoReturn


def fail(message: str) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(2)


def main() -> None:
    if not 3 <= len(sys.argv) <= 4:
        fail("usage: seed_desktop_fixture.py ROOT ROWS_JSON [--desired=running|stopped]")
    desired = "stopped"
    if len(sys.argv) == 4:
        if not sys.argv[3].startswith("--desired="):
            fail("the optional third argument is --desired=running or --desired=stopped")
        desired = sys.argv[3].removeprefix("--desired=")
        if desired not in {"running", "stopped"}:
            fail("--desired must be running or stopped")
    root = Path(sys.argv[1])
    if not root.is_absolute() or not root.is_dir() or root.resolve() != root:
        fail("root must be an existing canonical absolute directory")
    info = root.lstat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700 or any(root.iterdir()):
        fail("root must be private (0700), owned and empty")
    try:
        rows = json.loads(sys.argv[2])
    except ValueError:
        fail("rows must be JSON")
    if not isinstance(rows, list) or any(
        not isinstance(row, dict)
        or set(row) != {"pk", "stamp", "fields"}
        or not isinstance(row["pk"], str)
        or not isinstance(row["stamp"], int)
        or isinstance(row["stamp"], bool)
        or not isinstance(row["fields"], dict)
        for row in rows
    ):
        fail("rows must be [{pk, stamp, fields}]")
    from insto.desktop.configuration import config_bytes, initialize_database
    from insto.desktop.profile import Profile
    from insto.service.history import _PROFILE_TRACKED_FIELDS

    profile = Profile(root)
    with profile.locked(initialize=True):
        initialize_database(profile.home / "store.db")
        profile.write_config(config_bytes(profile, "offline-fixture-token-not-real"))
        profile.write_state(profile.new_state(remaining=8, desired=desired))
    with contextlib.closing(sqlite3.connect(profile.home / "store.db")) as db:
        with db:
            for row in rows:
                fields = dict.fromkeys(_PROFILE_TRACKED_FIELDS, None)
                fields.update(row["fields"])
                db.execute(
                    "INSERT INTO snapshots(target_pk,captured_at,profile_fields_json,last_post_pks_json) VALUES (?,?,?,?)",
                    (row["pk"], row["stamp"], json.dumps(fields, ensure_ascii=False), "[]"),
                )
    print(json.dumps({"seeded": len(rows), "store": str(profile.home / "store.db")}))


if __name__ == "__main__":
    main()
