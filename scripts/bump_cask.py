"""Rewrite the Homebrew cask for a published release from its SHA256SUMS.

    python3 -B -m scripts.bump_cask --version 0.2.0 --sums SHA256SUMS --cask Casks/insto.rb

The cask keeps its shape; only `version` and the two `sha256` values change.
Exit code 0 when the file was rewritten, 3 when it already carried that version
with those hashes (nothing to do), 1 on any inconsistency.
"""

import argparse
import re
import sys
from pathlib import Path

VERSION = re.compile(r'^(\s*version ")(\d+\.\d+\.\d+)("\s*)$', re.M)
ARM = re.compile(r'(on_arm do\n\s+sha256 ")([0-9a-f]{64})(")')
INTEL = re.compile(r'(on_intel do\n\s+sha256 ")([0-9a-f]{64})(")')
DIGEST = re.compile(r"^[0-9a-f]{64}$")


def read_sums(text: str, version: str) -> tuple[str, str]:
    """The aarch64 and x64 DMG digests of one version, from a `shasum` listing."""
    wanted = {f"insto_{version}_aarch64.dmg": None, f"insto_{version}_x64.dmg": None}
    for line in text.splitlines():
        digest, _, name = line.strip().partition("  ")
        if name in wanted:
            if not DIGEST.match(digest):
                raise ValueError(f"malformed digest for {name}")
            if wanted[name] is not None:
                raise ValueError(f"{name} listed twice")
            wanted[name] = digest
    missing = [name for name, digest in wanted.items() if digest is None]
    if missing:
        raise ValueError("SHA256SUMS lacks " + ", ".join(missing))
    return wanted[f"insto_{version}_aarch64.dmg"], wanted[f"insto_{version}_x64.dmg"]


def rewrite(cask: str, version: str, arm: str, intel: str) -> str:
    if len(VERSION.findall(cask)) != 1 or not ARM.search(cask) or not INTEL.search(cask):
        raise ValueError("cask does not have the expected version / on_arm / on_intel lines")
    cask = VERSION.sub(lambda m: m.group(1) + version + m.group(3), cask, count=1)
    cask = ARM.sub(lambda m: m.group(1) + arm + m.group(3), cask, count=1)
    return INTEL.sub(lambda m: m.group(1) + intel + m.group(3), cask, count=1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--sums", required=True, type=Path)
    parser.add_argument("--cask", required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        print(f"not a release version: {args.version}", file=sys.stderr)
        sys.exit(1)
    try:
        arm, intel = read_sums(args.sums.read_text(), args.version)
        before = args.cask.read_text()
        after = rewrite(before, args.version, arm, intel)
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
    if after == before:
        print(f"cask already at {args.version}")
        sys.exit(3)
    args.cask.write_text(after)
    print(f"cask set to {args.version}: arm {arm[:12]}… intel {intel[:12]}…")


if __name__ == "__main__":
    main()
