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
    if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
        raise ValueError(f"Hardlinked file: {path}")
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
    # Reject unlisted nodes and incorrect sizes before reading their contents.
    # Iterating only the declared paths would miss extras; describing the whole
    # actual tree first would hash arbitrarily large, already-invalid payloads.
    if not 1 <= len(entries) <= 50_000:
        raise ValueError("Runtime inventory entry budget")
    expected = {entry["path"]: entry for entry in entries}
    if len(expected) != len(entries):
        raise ValueError("Duplicate runtime inventory path")

    def visit(path: Path, name: str):
        entry = expected.pop(name, None)
        if entry is None:
            raise ValueError("Unexpected runtime entry")
        info = _checked_stat(path)
        directory = stat.S_ISDIR(info.st_mode)
        actual = {
            "path": name,
            "type": "directory" if directory else "file",
            "mode": stat.S_IMODE(info.st_mode),
        }
        if not directory:
            if info.st_size != entry.get("size") or info.st_size > 256 * 1024 * 1024:
                raise ValueError("Runtime file size mismatch")
            digest = hashlib.sha256()
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as stream:
                opened = os.fstat(stream.fileno())
                if (opened.st_dev, opened.st_ino, opened.st_size, opened.st_nlink) != (
                    info.st_dev,
                    info.st_ino,
                    info.st_size,
                    1,
                ):
                    raise ValueError("Runtime file changed before hashing")
                remaining = info.st_size
                while remaining:
                    chunk = stream.read(min(remaining, 1024 * 1024))
                    if not chunk:
                        raise ValueError("Runtime file changed while hashing")
                    digest.update(chunk)
                    remaining -= len(chunk)
                if stream.read(1):
                    raise ValueError("Runtime file grew while hashing")
            actual.update(size=info.st_size, sha256=digest.hexdigest())
        if actual != entry:
            raise ValueError("Runtime inventory mismatch")
        if directory:
            with os.scandir(path) as children:
                for child in children:
                    visit(
                        Path(child.path),
                        child.name if name == "." else f"{name}/{child.name}",
                    )

    visit(Path(root), ".")
    if expected:
        raise ValueError("Missing runtime entries")
