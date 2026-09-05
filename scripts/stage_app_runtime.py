"""Developer-only staging of an explicitly pinned runtime for the app bundle."""

import argparse
import json
import os
from pathlib import Path
import shutil
import stat

from scripts.app_manifest import read_manifest
from scripts.runtime_manifest import verify

REPO_ROOT = Path(__file__).resolve().parents[1]


def _private_directory(path: Path):
    info = path.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o700
    ):
        raise ValueError("Build directories must be ordinary, owned and private")


def stage(source: Path, destination: Path) -> dict:
    build_root = REPO_ROOT / ".build"
    _private_directory(build_root)
    source, destination = Path(source).absolute(), Path(destination).absolute()
    if source.parent != build_root or source.resolve(strict=True) != source:
        raise ValueError("Source must be a canonical immediate build child")
    _private_directory(source)
    if (
        destination != build_root / "app-resources/runtime"
        or destination.exists()
        or destination.is_symlink()
    ):
        raise ValueError("App destination must be a new fixed resource directory")
    pin = json.loads((REPO_ROOT / "packaging/core-pin.json").read_text())
    distributions = json.loads(
        (REPO_ROOT / "packaging/python-distributions.json").read_text()
    )
    manifest = read_manifest(source / "manifest.json", pin, distributions)
    verify(source / "python", manifest["files"])
    if not destination.parent.exists() and not destination.parent.is_symlink():
        destination.parent.mkdir(mode=0o700)
    _private_directory(destination.parent)
    destination.mkdir(mode=0o700)
    # A raced-in symlink is copied as a link, not followed, and rejected below.
    # This developer stager is not the production descriptor-relative publisher.
    shutil.copytree(source / "python", destination / "python", symlinks=True)
    verify(destination / "python", manifest["files"])
    verify(source / "python", manifest["files"])
    output = destination / ".manifest.partial"
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    # Publish the ready name only after write, flush, sync and close succeeded.
    # The destination was exclusively created by this developer invocation.
    output.rename(destination / "manifest.json")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    manifest = stage(args.source, REPO_ROOT / ".build/app-resources/runtime")
    print(f"Staged pinned runtime {manifest['build_id']}")


if __name__ == "__main__":
    main()
