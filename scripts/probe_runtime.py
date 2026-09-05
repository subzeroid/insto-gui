"""Offline relocation proof for a locally built, unsigned runtime."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from scripts.native_service_probe import run_native
from scripts.runtime_manifest import verify

ENV = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"}
PROBE = """
import asyncio, importlib.metadata, json, platform, sqlite3, ssl, sys
import certifi, hikerapi, httpx, insto
assert sys.dont_write_bytecode and sys.flags.isolated
connection = sqlite3.connect(':memory:')
try:
    assert connection.execute('select 1').fetchone() == (1,)
finally:
    connection.close()
assert ssl.create_default_context(cafile=certifi.where()).cert_store_stats()['x509_ca'] > 0
async def sdk_probe():
    client = hikerapi.AsyncClient(token='offline-packaging-fixture', timeout=1)
    await client.aclose()
asyncio.run(sdk_probe())
print(json.dumps({'python': platform.python_version(), 'architecture': platform.machine(),
                 'core_version': insto.__version__, 'origin': insto.__file__,
                 'hikerapi_version': importlib.metadata.version('hikerapi')}))
"""


def handshake(python: Path, cwd: Path) -> dict[str, Any]:
    request = {
        "protocol_version": 1,
        "request_id": "packaging-proof",
        "operation": "hello",
        "params": {},
    }
    completed = subprocess.run(
        [str(python), "-I", "-B", "-m", "insto.desktop"],
        input=json.dumps(request).encode() + b"\n",
        capture_output=True,
        cwd=cwd,
        env=ENV,
        timeout=10,
        check=True,
    )
    if (
        completed.stderr
        or completed.stdout.count(b"\n") != 1
        or not completed.stdout.endswith(b"\n")
        or len(completed.stdout) > 2 * 1024**2
    ):
        raise ValueError("invalid handshake transport")
    response = json.loads(completed.stdout)
    if (
        not isinstance(response, dict)
        or type(response.get("protocol_version")) is not int
        or response["protocol_version"] != 1
        or response.get("request_id") != "packaging-proof"
        or "error" in response
    ):
        raise ValueError("incompatible handshake envelope")
    result = response.get("result")
    if not isinstance(result, dict):
        raise ValueError("missing handshake result")
    capabilities = result.get("capabilities")
    if (
        not isinstance(capabilities, list)
        or any(not isinstance(item, str) for item in capabilities)
        or "hello" not in capabilities
        or type(result.get("schema_version_supported")) is not int
        or result["schema_version_supported"] != 2
        or not isinstance(result.get("core_version"), str)
        or not result["core_version"]
    ):
        raise ValueError("required desktop capability missing")
    return result


def core_identity(core: Path) -> tuple[bool, str]:
    def git(*args: str) -> str:
        return subprocess.run(
            ["git", *args],
            cwd=core,
            env=ENV,
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        ).stdout.strip()

    return bool(git("status", "--porcelain", "--untracked-files=all")), git(
        "rev-parse", "HEAD"
    )


def probe(payload: Path, native_core: Path | None = None) -> Path:
    payload = payload.resolve(strict=True)
    manifest = json.loads((payload / "manifest.json").read_text())
    if (
        not isinstance(manifest, dict)
        or type(manifest.get("manifest_version")) is not int
        or manifest["manifest_version"] != 1
    ):
        raise ValueError("unsupported proof manifest")
    build_id = manifest.pop("build_id", None)
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    if hashlib.sha256(canonical).hexdigest() != build_id:
        raise ValueError("invalid proof manifest identifier")
    verify(payload / "python", manifest["files"])
    core = None
    if native_core is not None:
        core = native_core.resolve(strict=True)
        dirty, commit = core_identity(core)
        if dirty or commit != manifest["inputs"]["core_commit"]:
            raise ValueError(
                "native test input must be the same clean core revision as the runtime"
            )
    root = Path(
        tempfile.mkdtemp(prefix="relocated proof ", dir=payload.parent)
    ).resolve()
    print(f"Proof artifacts retained at {root}", flush=True)
    relocated = root / "different path/python"
    shutil.copytree(payload / "python", relocated)
    python = relocated / "bin/python3"
    verify(relocated, manifest["files"])
    hello = handshake(python, root)
    completed = subprocess.run(
        [str(python), "-I", "-B", "-c", PROBE],
        cwd=root,
        env=ENV,
        capture_output=True,
        timeout=20,
        check=True,
    )
    if completed.stderr or len(completed.stdout) > 2 * 1024**2:
        raise ValueError("invalid dependency probe transport")
    details = json.loads(completed.stdout)
    if details["python"] != manifest["inputs"]["python_version"]:
        raise ValueError("unexpected Python version")
    if details["architecture"] != manifest["inputs"]["architecture"]:
        raise ValueError("unexpected runtime architecture")
    if details["core_version"] != hello["core_version"]:
        raise ValueError("wheel version differs from handshake")
    origin = Path(details["origin"]).resolve()
    if (
        not origin.is_relative_to(relocated.resolve())
        or "site-packages" not in origin.parts
    ):
        raise ValueError("probe imported insto outside installed runtime")
    evidence: dict[str, Any] = {
        "build_id": build_id,
        "handshake": hello,
        "dependencies": details,
        "native": "not_run",
    }
    if core is not None:
        run_native(core=core, python=python, root=root, environment=ENV)
        evidence["native"] = "passed"
    verify(relocated, manifest["files"])
    with (root / "evidence.json").open("x") as stream:
        stream.write(json.dumps(evidence, indent=2) + "\n")
    print(root)
    return root


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("payload", type=Path)
    parser.add_argument("--native-core", type=Path)
    args = parser.parse_args()
    probe(args.payload, args.native_core)


if __name__ == "__main__":
    main()
