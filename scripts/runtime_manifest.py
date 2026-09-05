"""Exact inventories for the developer-only portable runtime proof."""

import hashlib
import os
from pathlib import Path
import stat


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _checked_stat(path: Path):
    info = path.lstat()
    if info.st_uid != os.getuid():
        raise ValueError(f"Wrong owner: {path}")
    if info.st_mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX):
        raise ValueError(f"Special permission bits: {path}")
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
        raise ValueError(f"Nonordinary node: {path}")
    return info


def describe(root: Path) -> list[dict]:
    root = Path(root)
    root_info = _checked_stat(root)
    if not stat.S_ISDIR(root_info.st_mode):
        raise ValueError(f"Not a directory: {root}")
    entries = [
        {"path": ".", "type": "directory", "mode": stat.S_IMODE(root_info.st_mode)}
    ]

    def visit(directory):
        for path in directory.iterdir():
            info = _checked_stat(path)
            is_dir = stat.S_ISDIR(info.st_mode)
            entry = {
                "path": path.relative_to(root).as_posix(),
                "type": "directory" if is_dir else "file",
                "mode": stat.S_IMODE(info.st_mode),
            }
            if is_dir:
                visit(path)
            else:
                entry.update(size=info.st_size, sha256=sha256(path))
            entries.append(entry)

    visit(root)
    return sorted(entries, key=lambda entry: entry["path"])


def verify(root: Path, entries: list[dict]) -> None:
    if describe(root) != entries:
        raise ValueError(f"Runtime inventory mismatch: {root}")
