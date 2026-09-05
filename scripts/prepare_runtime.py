"""Developer-only, pinned macOS Python runtime builder.

Run with: python -m scripts.prepare_runtime --core-root PATH --output .build/NAME
Incomplete output is retained; subprocess failures add a private build-error.json
with the command, exit code, and at most 64 KiB of each captured output tail.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

from scripts.runtime_manifest import describe, sha256

REPO_ROOT = Path(__file__).resolve().parents[1]
MAX_MEMBERS = 50_000
MAX_MEMBER_BYTES = 256 * 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024 * 1024
MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024


def _inside(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def unpack(archive: Path, destination: Path) -> None:
    destination.mkdir(mode=0o700)
    destination = destination.resolve(strict=True)
    python_root = destination / "python"
    members = []
    declared = 0
    with tarfile.open(archive, mode="r:gz") as tar:
        for member in tar:
            if len(members) >= MAX_MEMBERS:
                raise ValueError("Archive member budget exceeded")
            path = PurePosixPath(member.name)
            if (
                not path.parts
                or path.is_absolute()
                or ".." in path.parts
                or path.parts[0] != "python"
            ):
                raise ValueError(f"Unsafe archive path: {member.name}")
            if not (member.isfile() or member.isdir() or member.issym()):
                raise ValueError(f"Unsupported archive member: {member.name}")
            if member.size < 0 or member.size > MAX_MEMBER_BYTES:
                raise ValueError("Archive member size budget exceeded")
            declared += member.size
            if declared > MAX_TOTAL_BYTES:
                raise ValueError("Archive total size budget exceeded")
            if member.issym():
                target = PurePosixPath(member.linkname)
                if not member.linkname or target.is_absolute():
                    raise ValueError(f"Unsafe symlink: {member.name}")
                normalized = Path(
                    os.path.normpath(destination / str(path.parent) / str(target))
                )
                if not _inside(normalized.absolute(), python_root):
                    raise ValueError(f"Escaping symlink: {member.name}")
            members.append(member)
        tar.extractall(destination, members=members, filter="data")
    if python_root.is_symlink() or not python_root.is_dir():
        raise ValueError("Archive must contain an ordinary python directory")
    for directory, names, files in os.walk(python_root, followlinks=False):
        for name in names + files:
            path = Path(directory) / name
            if path.is_symlink():
                try:
                    resolved = path.resolve(strict=True)
                except (OSError, RuntimeError) as error:
                    raise ValueError(f"Broken or cyclic symlink: {path}") from error
                if not _inside(resolved, python_root):
                    raise ValueError(f"Escaping symlink: {path}")


def fetch(url: str, expected: str, output: Path) -> None:
    digest = hashlib.sha256()
    total = 0
    with output.open("xb") as sink:
        with urllib.request.urlopen(url, timeout=30) as source:
            while chunk := source.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_DOWNLOAD_BYTES:
                    raise ValueError("Download size budget exceeded")
                digest.update(chunk)
                sink.write(chunk)
    if digest.hexdigest() != expected:
        raise ValueError("Upstream Python SHA-256 mismatch")


def run(arguments: list[str], *, cwd: Path) -> str:
    return subprocess.run(
        arguments, cwd=cwd, check=True, timeout=600, capture_output=True, text=True
    ).stdout.strip()


def _private_build_root() -> Path:
    root = REPO_ROOT / ".build"
    if not root.exists() and not root.is_symlink():
        root.mkdir(mode=0o700)
    info = root.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o700
    ):
        raise ValueError(
            f"Build directory must be ordinary, owned, and mode 0700: {root}"
        )
    return root


def build(core: Path, output: Path) -> dict:
    if platform.system() != "Darwin":
        raise ValueError("Runtime proof builds require macOS")
    if sys.version_info < (3, 12):
        raise ValueError("Developer Python 3.12 or later is required")
    pins = json.loads((REPO_ROOT / "packaging/python-distributions.json").read_text())
    architecture = platform.machine()
    if architecture not in pins["targets"]:
        raise ValueError(f"Unsupported architecture: {architecture}")
    upstream = pins["targets"][architecture]
    core = Path(core).resolve(strict=True)
    if run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=core):
        raise ValueError("Core build input must be clean")
    core_commit = run(["git", "rev-parse", "HEAD"], cwd=core)
    build_root = _private_build_root()
    output = Path(os.path.abspath(output))
    if output.parent != build_root or output.exists() or output.is_symlink():
        raise ValueError(f"Output must be a new immediate child of {build_root}")
    output.mkdir(mode=0o700)
    try:
        with tempfile.TemporaryDirectory(
            prefix="prepare-", dir=build_root
        ) as temporary:
            work = Path(temporary)
            archive = work / "python.tar.gz"
            fetch(upstream["url"], upstream["sha256"], archive)
            unpack(archive, work / "upstream")
            source = work / "upstream/python"
            for directory, names, _ in os.walk(source, followlinks=False):
                for name in names:
                    if (Path(directory) / name).is_symlink():
                        raise ValueError(
                            f"Directory symlinks cannot be normalized: {name}"
                        )
            runtime = output / "python"
            shutil.copytree(source, runtime, symlinks=False)
            python = str(runtime / "bin/python3")
            requirements = output / "requirements.txt"
            constraints = output / "build-constraints.txt"
            uv_version = run(["uv", "--version"], cwd=core)
            run(
                [
                    "uv",
                    "export",
                    "--frozen",
                    "--no-dev",
                    "--no-default-groups",
                    "--no-emit-project",
                    "--no-header",
                    "--output-file",
                    str(requirements),
                ],
                cwd=core,
            )
            run(
                [
                    "uv",
                    "export",
                    "--frozen",
                    "--only-group",
                    "dev",
                    "--no-emit-project",
                    "--no-header",
                    "--output-file",
                    str(constraints),
                ],
                cwd=core,
            )
            wheels = work / "wheels"
            run(
                [
                    "uv",
                    "build",
                    "--wheel",
                    "--build-constraints",
                    str(constraints),
                    "--require-hashes",
                    "--out-dir",
                    str(wheels),
                ],
                cwd=core,
            )
            candidates = list(wheels.glob("insto*.whl"))
            if len(candidates) != 1:
                raise ValueError("Expected exactly one insto wheel")
            wheel = candidates[0]
            run([python, "-I", "-B", "-m", "ensurepip"], cwd=core)
            pip = [
                python,
                "-I",
                "-B",
                "-m",
                "pip",
                "--isolated",
                "--disable-pip-version-check",
            ]
            run(
                [
                    *pip,
                    "install",
                    "--no-compile",
                    "--only-binary=:all:",
                    "--require-hashes",
                    "-r",
                    str(requirements),
                ],
                cwd=core,
            )
            run([*pip, "install", "--no-compile", "--no-deps", str(wheel)], cwd=core)
            run([*pip, "check"], cwd=core)
            inputs = {
                "core_commit": core_commit,
                "core_wheel_name": wheel.name,
                "core_wheel_sha256": sha256(wheel),
                "requirements_sha256": sha256(requirements),
                "build_constraints_sha256": sha256(constraints),
                "uv_version": uv_version,
                "architecture": architecture,
                "python_version": pins["python_version"],
                "upstream_url": upstream["url"],
                "upstream_sha256": upstream["sha256"],
            }
            manifest = {
                "manifest_version": 1,
                "inputs": inputs,
                "files": describe(runtime),
            }
            canonical = json.dumps(
                manifest, sort_keys=True, separators=(",", ":")
            ).encode()
            manifest["build_id"] = hashlib.sha256(canonical).hexdigest()
            with (output / "manifest.json").open("x") as stream:
                stream.write(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
            return manifest
    except BaseException as error:
        if isinstance(error, subprocess.CalledProcessError):

            def tail(value):
                data = value if isinstance(value, bytes) else (value or "").encode()
                return data[-64 * 1024 :].decode("utf-8", errors="ignore")

            diagnostic = {
                "command": error.cmd,
                "exit_code": error.returncode,
                "stdout_tail": tail(error.stdout),
                "stderr_tail": tail(error.stderr),
            }
            try:
                descriptor = os.open(
                    output / "build-error.json",
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o600,
                )
                with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                    json.dump(diagnostic, stream, ensure_ascii=False, indent=2)
                    stream.write("\n")
            except OSError:
                # A diagnostics write failure must not hide the build failure.
                print("Could not write build-error.json", file=sys.stderr)
        print(f"Incomplete runtime retained at {output}", file=sys.stderr)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.core_root, args.output)


if __name__ == "__main__":
    main()
