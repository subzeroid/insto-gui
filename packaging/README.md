# Runtime and app proofs — build machine only

P0 proves that a bundled Python core can run after relocation. These commands
are for developers, **not end-user installation steps**. P1 adds a local GUI
and a Rust runtime publisher, but no public installer. The target user flow remains:
install the app, enter a HikerAPI token, add accounts, start monitoring.

## P1 local shell

The Rust host strictly decodes C1 JSONL, bounds bridge I/O and lifetime, and
publishes the pinned runtime into a private versioned directory. Vue provides
token setup/replacement and explicit service Start/Stop/Repair. Opening the
app only prepares and inspects; closing must never stop the background service.
Cached quota and native process state are not monitoring-health guarantees.

Use the clean C1 revision in `packaging/core-pin.json` as the read-only build
input. After preparing a new runtime, stage it with:

```sh
python3 -B -m scripts.stage_app_runtime .build/runtime-c1-01
npm ci --ignore-scripts
npm test
npm run build
cargo test -p insto-desktop-host --locked
```

Staging refuses an existing `.build/app-resources/runtime`; it never overwrites
historical evidence. Rust is the production runtime-copy path; Python staging
is a developer packaging helper only. Bundled app commands and measured results
are recorded in [app-proof-results.md](app-proof-results.md).

P1 source locations must have safe, non-group-writable ancestors. Standard
`/Applications` (`root:admin 0775` on this Mac) is currently rejected. Run local
proofs only from a private user location; normal `/Applications` installation
requires a reviewed source-trust policy before R1. Destination ownership is
always current UID, never weakened to accommodate source installation paths.

The frontend is a bounded numeric client: unusual Python quota/timestamp
integers outside Rust `u64`, or outside JavaScript safe integers, are rejected
rather than silently rounded. No browser storage or general filesystem,
shell, provider-network or arbitrary-URL IPC is exposed.

## Historical P0 workflow

## Prerequisites

Use macOS on the target architecture, developer Python 3.12 or newer, `uv`
with `build --build-constraints --require-hashes` support, and network access
for the build. `uv 0.8.13` was used for the first proof. Native testing also
requires a logged-in GUI launchd domain and the matching clean C0 `insto`
checkout with its developer test environment already prepared.

The core input is read-only. Do not run `uv run` or unfrozen `uv sync` there:
frozen exports deliberately omit the root project, and the wheel is built
separately. The runtime receives only production dependencies, not pytest or
the developer dependency group. Developer dependencies constrain wheel builds.

## Build and verify

From this repository, replacing `/path/to/clean-core` with the actual C0
checkout and using a suitable developer `python3`:

```sh
python3 -B -m unittest discover -s tests -v
python3 -B -m scripts.prepare_runtime --core-root /path/to/clean-core --output .build/runtime-host-01
python3 -B -m scripts.probe_runtime .build/runtime-host-01
python3 -B -m scripts.probe_runtime .build/runtime-host-01 --native-core /path/to/clean-core
```

Outputs must be new immediate children of the owned, private `.build`
directory. Existing outputs are never overwritten; use another name for a
rebuild. The builder selects the host architecture from
`python-distributions.json`, downloads that exact CPython asset and verifies
its SHA-256. An unavailable or invalid asset is a failed proof, never a reason
to select another version or disable verification.

Failed build subprocesses retain a private `build-error.json` with the
command, exit code and bounded stdout/stderr tails. Inspect it locally for
diagnostics; its contents are not printed automatically.

The builder rejects unsafe or over-budget archives. Safe internal file links
are materialized as ordinary files; directory links are rejected. All upstream
files, including license notices, are retained. This normalization is a P0
choice, not a decision about production publisher symlink support.

The completed `manifest.json` is written last. It records the core commit,
wheel name/hash, runtime requirements hash, build constraints hash, uv version,
upstream Python URL/hash/version, architecture, and every runtime directory
and file, including root permissions and file hashes. A canonical JSON digest
identifies this build. **This unsigned digest is an integrity check, not an
authenticity or code-signing guarantee.** Probe only locally trusted outputs.

The probe retains a new directory with spaces in its path and runs only the
copied interpreter with `-I -B`. Its clean environment excludes user tokens,
Python paths and application settings. It checks the desktop handshake,
installed-package origin, SQLite, the local TLS CA store, and offline SDK
construction/closure. It makes no real provider API requests or live TLS
endpoint checks. Runtime inventory must be unchanged afterward.

## Native service safety and evidence

The optional native probe uses the same clean core revision as the built
wheel. Its pytest process runs with developer Python; the tested CLI and
LaunchAgent run with the relocated, wheel-installed interpreter. It requires
exactly `1 passed` — a skip is not a proof.

Only one newly created fake profile is used:

- Home: `<retained-proof>/native-test/service home`.
- Label: `io.insto.watch.<uid>.<first-16-hex-of-SHA256(os.fsencode(home))>`.
- Plist: `~/Library/LaunchAgents/<exact-label>.plist`.

The exact paths are recorded before pytest starts, in `native-context.json`.
The test exercises a new fake tick, idempotent installation, crash restart,
clean exit without restart, uninstall and data preservation. Real profiles,
tokens and watch databases are not used.

On timeout or interruption the supervisor signals only its own child process
group, initially allowing 60 seconds for cleanup. Fallback uninstall is
allowed only after that group is confirmed stopped and the exact fake home,
configuration and context pass validation. The installed core controller
checks manifest/plist ownership under its management lock. Unknown process or
launchd state means failure, never permission to guess or delete files.

The retained directory contains `native-result.txt`, `native-context.json`
and, only after the entire proof succeeds, `evidence.json`. The context must
say `phase: passed` and `cleanup_confirmed: true`. A timeout remains a failed
proof even when cleanup succeeds.

**Do not remove a failed proof's interpreter while its registration might
remain.** If cleanup is unconfirmed, inspect the exact context, stop only the
supervisor's known child group if necessary, validate the fake home/config
and use the installed core's `watch-service uninstall` with that exact
`INSTO_HOME`. Do not unlink a plist by hand or clean all LaunchAgents. Confirm
the recorded manifest/plist are absent and `launchctl print` reports that
exact label missing before manually removing any retained test artifacts.
Do not reuse its basetemp for another pytest run.

All binary outputs and raw evidence are ignored by Git. See
[proof-results.md](proof-results.md) for the recorded host result and limits.

## What follows P0

C1's desktop operations are pinned for P1. Production signing still requires
its own distribution proof. Signing changes binary bytes: sign nested binaries first, generate the
final manifest/build ID second, sign the outer application third, then
notarize. P0's pre-signing manifest must not be reused as the post-signing
production manifest. Test both Mac architectures and quarantine/Gatekeeper
before claiming a distributable installer. GUI onboarding must not invoke
pip, uv, ensurepip or these build/probe scripts on the user's machine.
