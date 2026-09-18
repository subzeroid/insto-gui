"""The application version, read from the three files that must agree on it."""

import argparse
import json
import sys
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def read_version(repo: Path) -> str:
    npm = json.loads((repo / "package.json").read_text())["version"]
    cargo_toml = tomllib.loads((repo / "src-tauri/Cargo.toml").read_text())
    try:
        cargo = cargo_toml["package"]["version"]
    except KeyError as error:
        raise ValueError("src-tauri/Cargo.toml has no [package] version") from error
    tauri = json.loads((repo / "src-tauri/tauri.conf.json").read_text())["version"]
    if not npm == cargo == tauri:
        raise ValueError(
            f"Version files disagree: package.json {npm}, Cargo.toml {cargo}, tauri.conf.json {tauri}"
        )
    return npm


def check_tag(repo: Path, tag: str) -> str:
    version = read_version(repo)
    if tag != f"v{version}":
        raise ValueError(f"Tag {tag} does not match application version {version}")
    return version


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="require this tag to equal v<version>")
    args = parser.parse_args()
    try:
        version = check_tag(REPO_ROOT, args.tag) if args.tag else read_version(REPO_ROOT)
    except ValueError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
    print(version)


if __name__ == "__main__":
    main()
