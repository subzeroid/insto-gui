"""Strict P0-v1 manifest validation at the developer app-staging boundary."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat

MAX_MANIFEST_BYTES = 16 * 1024 * 1024
MAX_ENTRIES = 50_000
MAX_FILE_BYTES = 256 * 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024 * 1024
INPUT_FIELDS = {
    "core_commit",
    "core_wheel_name",
    "core_wheel_sha256",
    "requirements_sha256",
    "build_constraints_sha256",
    "uv_version",
    "architecture",
    "python_version",
    "upstream_url",
    "upstream_sha256",
}


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("Duplicate manifest key")
        result[key] = value
    return result


def _ascii(value):
    if isinstance(value, str):
        if not all(32 <= ord(char) <= 126 for char in value):
            raise ValueError("Manifest v1 requires printable ASCII strings")
    elif isinstance(value, dict):
        for key, item in value.items():
            _ascii(key)
            _ascii(item)
    elif isinstance(value, list):
        for item in value:
            _ascii(item)


def _hex(value, length=64):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{%d}" % length, value)


def _inventory(entries):
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_ENTRIES:
        raise ValueError("Manifest entry budget")
    seen = {}
    previous = ""
    total = 0
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Invalid inventory entry")
        kind = entry.get("type")
        fields = {"path", "type", "mode"}
        if kind == "file":
            fields |= {"size", "sha256"}
        elif kind != "directory":
            raise ValueError("Manifest v1 supports ordinary nodes only")
        if set(entry) != fields:
            raise ValueError("Invalid inventory fields")
        name = entry["path"]
        if not isinstance(name, str) or not name or "\\" in name:
            raise ValueError("Invalid inventory path")
        path = PurePosixPath(name)
        if (
            path.is_absolute()
            or ".." in path.parts
            or path.as_posix() != name
            or name <= previous
        ):
            raise ValueError("Noncanonical inventory path/order")
        if name == ".":
            if kind != "directory":
                raise ValueError("Missing runtime root directory")
        elif seen.get(path.parent.as_posix()) != "directory":
            raise ValueError("Missing inventory parent")
        mode = entry["mode"]
        if type(mode) is not int or not 0 <= mode <= 0o777 or mode & 0o022:
            raise ValueError("Unsafe inventory mode")
        if kind == "file":
            size = entry["size"]
            if (
                type(size) is not int
                or not 0 <= size <= MAX_FILE_BYTES
                or not _hex(entry["sha256"])
            ):
                raise ValueError("Invalid inventory size/hash")
            total += size
            if total > MAX_TOTAL_BYTES:
                raise ValueError("Manifest total byte budget")
        seen[name] = kind
        previous = name
    if seen.get(".") != "directory" or seen.get("bin/python3") != "file":
        raise ValueError("Missing runtime interpreter")
    interpreter = next(entry for entry in entries if entry["path"] == "bin/python3")
    if not interpreter["mode"] & 0o100:
        raise ValueError("Runtime interpreter is not executable")


def read_manifest(path: Path, pin: dict, distributions: dict) -> dict:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_nlink != 1
        ):
            raise ValueError("Unsafe manifest file")
        if stat.S_IMODE(info.st_mode) & 0o7022:
            raise ValueError("Unsafe manifest permissions")
        raw = stream.read(MAX_MANIFEST_BYTES + 1)
    if len(raw) > MAX_MANIFEST_BYTES:
        raise ValueError("Manifest byte budget")
    try:
        manifest = json.loads(raw, object_pairs_hook=_pairs)
    except (UnicodeError, RecursionError) as error:
        raise ValueError("Invalid manifest JSON") from error
    _ascii(manifest)
    if not isinstance(manifest, dict) or set(manifest) != {
        "manifest_version",
        "inputs",
        "files",
        "build_id",
    }:
        raise ValueError("Invalid manifest fields")
    if (
        type(manifest["manifest_version"]) is not int
        or manifest["manifest_version"] != 1
    ):
        raise ValueError("Unsupported manifest version")
    unsigned = {key: value for key, value in manifest.items() if key != "build_id"}
    canonical = json.dumps(
        unsigned, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()
    if (
        not _hex(manifest["build_id"])
        or hashlib.sha256(canonical).hexdigest() != manifest["build_id"]
    ):
        raise ValueError("Invalid manifest identifier")
    inputs = manifest["inputs"]
    if (
        not isinstance(inputs, dict)
        or set(inputs) != INPUT_FIELDS
        or any(not isinstance(value, str) for value in inputs.values())
    ):
        raise ValueError("Invalid manifest inputs")
    if (
        inputs["core_commit"] != pin["core_commit"]
        or inputs["core_wheel_name"] != f"insto-{pin['core_version']}-py3-none-any.whl"
    ):
        raise ValueError("Runtime does not match the app core pin")
    if not _hex(inputs["core_commit"], 40) or any(
        not _hex(inputs[name]) for name in INPUT_FIELDS if name.endswith("_sha256")
    ):
        raise ValueError("Invalid input hash")
    upstream = distributions["targets"].get(inputs["architecture"])
    if (
        upstream is None
        or inputs["python_version"] != distributions["python_version"]
        or inputs["upstream_url"] != upstream["url"]
        or inputs["upstream_sha256"] != upstream["sha256"]
    ):
        raise ValueError("Runtime does not match the Python distribution pin")
    _inventory(manifest["files"])
    return manifest
