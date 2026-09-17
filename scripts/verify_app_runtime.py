"""Verify the runtime bundled inside a built insto.app against its own manifest.

Tauri's ad-hoc signing and DMG creation must leave `Contents/Resources/runtime`
byte-identical to what `stage_app_runtime` staged; the Rust publisher would refuse
a changed runtime at first launch. This check turns that observation into a rule
that runs on every debug and release bundle.
"""

import argparse
import json
from pathlib import Path

from scripts.app_manifest import read_manifest
from scripts.runtime_manifest import verify

REPO_ROOT = Path(__file__).resolve().parents[1]


def verify_app(app: Path) -> dict:
    app = Path(app).absolute()
    if app.suffix != ".app" or not app.is_dir() or app.resolve(strict=True) != app:
        raise ValueError("Expected a canonical .app bundle directory")
    runtime = app / "Contents/Resources/runtime"
    if runtime.is_symlink() or not runtime.is_dir():
        raise ValueError("Bundle carries no runtime directory")
    manifest_path = runtime / "manifest.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("Bundle carries no runtime manifest")
    pin = json.loads((REPO_ROOT / "packaging/core-pin.json").read_text())
    distributions = json.loads(
        (REPO_ROOT / "packaging/python-distributions.json").read_text()
    )
    manifest = read_manifest(manifest_path, pin, distributions)
    verify(runtime / "python", manifest["files"])
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    args = parser.parse_args()
    manifest = verify_app(args.app)
    print(
        json.dumps(
            {
                "build_id": manifest["build_id"],
                "architecture": manifest["inputs"]["architecture"],
            }
        )
    )


if __name__ == "__main__":
    main()
