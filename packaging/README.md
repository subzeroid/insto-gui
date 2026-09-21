# Runtime and app proofs — build machine only

P0 proves that a bundled Python core can run after relocation. These commands
are for developers, **not end-user installation steps**. P1 adds a local GUI
and a Rust runtime publisher, but R1 adds the public installer described below.
The target user flow remains:
install the app, enter a HikerAPI token, add accounts, start monitoring.

## P1/G1 local app

The Rust host strictly decodes C1 JSONL, bounds bridge I/O and lifetime, and
publishes the pinned runtime into a private versioned directory. Vue provides
token setup/replacement and explicit service Start/Stop/Repair. Opening the
app only prepares and inspects; closing must never stop the background service.
Cached quota and native process state are not monitoring-health guarantees.

G1 adds eleven commands on the C2 bridge: `read_overview`, `list_watches`,
`add_watch`, `update_watch`, `pause_watch`, `resume_watch`, `remove_watch`,
`search_targets`, `list_snapshots`, `compare_snapshots` and `list_changes`.
R1 adds a twelfth, `read_snapshot`, for the core's `snapshots.read`: one saved
snapshot's tracked fields, so the window can show the profile as soon as the
service has checked a newly added account.
Vue polls `read_overview` every five seconds while the window is visible and
reconciles with one read after every mutation; it never replays a mutation.

G2 adds six more on the C3 bridge: `inspect_service`, `migrate_service`,
`uninstall_service`, `inspect_home`, `select_home` and `inspect_binding`, so the
ACL now allows twenty-six commands. Five of the six reach the core; the sixth
does not. `inspect_binding` is a host-local read of `<desktop root>/desktop-home.json`
through `crates/desktop-host/src/binding.rs`, the only reader of that file, which
is why a broken binding can still be released after the first core inspection has
failed. Anything that file cannot be fully trusted to say is reported as an
unknown binding, and an unknown binding makes every service control read-only.

Use the clean revision (insto 0.7.22) in `packaging/core-pin.json` as the read-only
build input. The pin is `2dc187a905a0620bfc322a08bb66d380a5c07df7`: it carries
`snapshots.read` as the twenty-fifth capability, checks a new account right away,
and identifies a profile picture by its file name instead of the signed CDN URL,
so a check no longer looks like a picture change. `.build/runtime-media-hash` was
prepared from a plain clone of that exact commit in `.build-core-media-hash/` and
staged into `.build/app-resources/runtime`; its build id is
`efcf80e3ebefc505404824e9793ca439627066dff1f88cd5293ede748af532f0`, and its bridge
advertises the twenty-five pinned capabilities in the pinned order. A runtime
prepared from an earlier pin cannot be used: the host's `hello` check demands
exactly the pinned list, so a 24-capability bridge fails to prepare the desktop.

Build from the staged runtime with:

```sh
python3 -B -m scripts.stage_app_runtime .build/runtime-media-hash
npm ci --ignore-scripts
npm test
npm run build
cargo test -p insto-desktop-host --locked
CI=true npm run tauri -- build --bundles app,dmg -- --locked
```

`--bundles dmg` alone deletes the `.app`, so both are requested together; `CI=true`
skips the Finder AppleScript step of `bundle_dmg.sh`.

Staging refuses an existing `.build/app-resources/runtime`; it never overwrites
historical evidence. Rust is the production runtime-copy path; Python staging
is a developer packaging helper only. Bundled app commands and measured results
are recorded in [app-proof-results.md](app-proof-results.md).

Source locations must have safe ancestors: every directory from `/` down to the
bundle is owned by root or the current user and is not group- or world-writable,
with exactly one exemption. `/Applications` is `root:admin 0775` on macOS, and a
directory with precisely that owner, group (gid 80) and mode is accepted as a
path component, because a member of `admin` can replace the whole bundle anyway.
The exemption applies to every directory component the walk visits, the bundle's
own directories included (the walk does not know where the bundle starts, and
only an admin could have made such a directory); it never applies to files or to
the private destination. The Python proof helper keeps its stricter rule on
purpose: it demands a private parent directory and is never aimed at `/Applications`.
Destination ownership is always the current UID, never weakened to
accommodate source installation paths.

The frontend is a bounded numeric client: unusual Python quota/timestamp
integers outside Rust `u64`, or outside JavaScript safe integers, are rejected
rather than silently rounded. No browser storage or general filesystem,
shell, provider-network or arbitrary-URL IPC is exposed.

## G2 runtime

G2 adds the five C3 operations on the 0.7.22 bridge: `service.inspect`,
`service.migrate`, `service.uninstall`, `home.inspect` and `home.select`.
`.build/runtime-c3-01` was prepared with `scripts.prepare_runtime` from insto
`3d2c8e7a512625c21e0e1b47c22ec14eea5da19d` (0.7.22); its manifest validated
against the pin of the day, and its bridge advertised the twenty-four capabilities
that pin listed. It was the staged runtime for G2 — build id
`4df54faceb61d38bd33ba2498d021384c5236d82a2431dbd932db4bee5ba7d60` — and has since
been superseded by `.build/runtime-media-hash` (see above), which is what
`.build/app-resources/runtime` now holds. The retained 0.7.21 runtime
`.build/runtime-c2-01` in the app-shell worktree is the "previous version" the
native migration proof starts from; it is kept, never deleted. Gated bridge tests
need `INSTO_GUI_RUNTIME=$PWD/.build/runtime-media-hash` — the host rejects both a
0.7.21 handshake and a 24-capability 0.7.22 one. Developer evidence only, not a
release artifact.

## G2 developer fixtures and proof modes

Developer-only. None of this is a user installation step.

- `.build/runtime-c3-01` — the prepared G2 runtime (insto 0.7.22). The retained
  `.build/runtime-c2-01` in the app-shell worktree is the previous version the
  migration proof starts from; it is kept, never deleted.
- `python3 -B -m scripts.seed_desktop_fixture ROOT ROWS_JSON [--desired=running|stopped]`
  — one fresh private desktop root with saved snapshots. The optional intent lets
  a proof stage a service that is meant to be running.
- `python3 -B -m scripts.seed_cli_home HOME` — a CLI-shaped home: 0700 directory,
  a HikerAPI configuration with an offline token and the unreachable proxy
  `http://127.0.0.1:9`, a database at the current schema, and no watches.
- `--proof-window <root> --staged` — the application waits for `<root>/staged.json`
  before publishing its runtime, and injects `globalThis.__INSTO_PROOF__` into the
  fixed developer script. Available only in an `app-proof` build.
- `python3 -B -m scripts.app_native_probe APP ROOT --mode migrate|adopt --previous-runtime PATH`
  — the two staged proof modes: the application migrating its own service onto the
  runtime it ships, and an adopted CLI home taken over through the interface's own
  confirmation and then released.

Each staged run uses exactly one temporary LaunchAgent label, derived from its own
fresh proof home. A run counts as evidence only when it ends with
`cleanup_confirmed: true` and its label is verified absent afterwards. `$HOME` is
not faked, so the label lives in the real `~/Library/LaunchAgents` while the run
lasts; what the cleanup cannot remove, and deliberately does not touch, is the one
persistent launchd enable/disable override entry launchd keeps for every label it
has seen.

## P1 real-window and native proof

Build the compile-gated developer app, then copy it into a **new** private
artifact parent. Use a fresh copy/root for each mode; never overwrite or reuse
a failed artifact. For example, from this worktree:

```sh
npm run tauri -- build --features app-proof --bundles app -- --locked --offline
mkdir -m 700 "$PWD/.build/native-app-example-01"
cp -cRp src-tauri/target/release/bundle/macos/insto.app "$PWD/.build/native-app-example-01/insto.app"
/opt/homebrew/bin/python3 -B -m scripts.app_native_probe \
  "$PWD/.build/native-app-example-01/insto.app" \
  "$PWD/.build/native-app-example-01/insto-app-proof-example-01" --mode window
```

Drop `--offline` if the local cargo registry cache is incomplete (it was on the
G1 host, so the G1 builds ran online).

The supervisor needs developer Python with working `os.waitid` and WNOWAIT
(Homebrew Python 3.14.7 on this host). This is not an end-user dependency.
Before running, verify the copied runtime inventory and ad-hoc bundle signature.
Keep the test window foreground: a developer-launched background WebKit view
was observed to stall until its exact owned app was activated. Do not disable
OS protections or repeatedly steal focus. No screen-recording permission is
required; DOM/style/geometry checks are not screenshot-based visual QA.

Modes `window`, `quit` and `close-preparing` verify actual window lifecycle and
drain. Mode `native` also requires explicit `--allow-native-fake`. It creates
one fresh fake home, seeds only alice and installs the service through the
published interpreter. The real GUI stays unconfigured: this does not test a
valid HikerAPI token or a GUI-triggered service mutation.

Native acceptance requires three strictly increasing SQLite commits with the
same watch registration and daemon PID/start time: while the app is alive,
after its actual exit, and after relocating only the copied source app. The
fixture toggles interval 600/601 and resets last_ok atomically to trigger C1's
existing reconciliation. It does not restart the daemon or add a scheduler.

The supervisor reserves child identity until its final owned-group signal,
confirms no live descendants, then reaps. Unknown ownership prohibits native
fallback. Cleanup uses only the exact installed controller with immutable
fake-home/runtime identity validation. One retry is allowed only after a
normal positive nonzero CLI exit, confirmed exact label absence and renewed
validation, within one 120-second cleanup budget. Timeouts, signal termination,
unknown ownership and loaded/ambiguous labels are not retryable.

The new private `<root-name>-result.json` retains bounded failure diagnostics,
including both primary and cleanup errors. Success requires `passed`,
`app_group_cleaned` and `cleanup_confirmed` all true, and all three native
tick events. Missing label alone is insufficient: exact plist and manifest
must also be absent. Never remove retained runtimes before exact cleanup.
An unsuccessful attempt stays failed even after a later manual cleanup;
record supplemental cleanup evidence separately.

Rebuild without `app-proof` for the ordinary app and verify both proof switches
are rejected before profile access. See [app-proof-results.md](app-proof-results.md)
for actual hashes, measured results and remaining distribution gates.

## Historical P0 workflow

The P0 scripts below are historical evidence, not the supervisor for new P1
application proofs. Use the separately reviewed P1 helper above.

### Prerequisites

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

## R1 release

A tag `v<version>` (equal to the version in `package.json`, `src-tauri/Cargo.toml`
and `src-tauri/tauri.conf.json`, checked by `scripts.release_version`) runs
`.github/workflows/release.yml`. Supported macOS is exactly what the runners test:
14 (Sonoma) and newer, `macos-14` for aarch64 and `macos-15-intel` for x86_64.
`workflow_dispatch` runs the same pipeline without publishing; that is how a change
to the pipeline is tried.

```
tag v* ─┬─► checks (ci.yml via workflow_call)
        ├─► version (release_version.py --tag)            ┐
        │                                                 ▼
        └─► release [macos-14 / aarch64] ──┐   needs: checks, version
            release [macos-15-intel / x64] ─┤
              preflight gates ─► stage runtime ─► build app,dmg ─► artifacts gates
              ─► previous runtime (0.7.21) ─► proof build (app-proof) ─► native migrate + adopt
              ─► install gates (/Applications, Gatekeeper, launch) ─► evidence complete
              ─► upload artifacts dmg-<target>, evidence-<target>       (contents: read)
                                            │
                                            ▼
            publish (needs both legs; only when uploading)               (contents: write)
              download dmg-* ─► exactly two DMGs ─► SHA256SUMS ─► gh release create --draft ─► upload
```

The order is load-bearing. Preflight runs before any build so an unsuitable runner
(no launchd GUI domain, `/Applications` not `root:admin 0775`, a group-writable
workspace ancestor, Gatekeeper assessments disabled) fails in seconds. The
artefact gates hash the DMG before the proof build overwrites
`bundle/macos/insto.app`. The native proof runs before the install gates so it
never sees this user's `Application Support`. The matrix jobs hold a read-only
token; only `publish`, which builds nothing, can write.

Gates, all blocking, each one a JSON line in the evidence artifact: preflight
(`launchd_gui_domain`, `applications_layout`, `workspace_ancestors`,
`gatekeeper_assessments_enabled`); artifacts (`signature_intact`,
`designated_requirement`, `runtime_matches_manifest` via
`scripts.verify_app_runtime`, which is the rule that signing must not touch the
runtime, `dmg_verifies`, `dmg_carries_one_app`, `hashes`); the proof build and the
native `migrate` and `adopt` legs against a previous runtime prepared from insto
0.7.21; install (`install_to_applications`, `quarantine_applied` as Safari would,
`gatekeeper_refuses_unnotarized`, which is expected without notarization and only
meaningful because preflight proved assessments are enabled,
`quarantine_removed`, `launch_publishes_runtime` into
`~/Library/Application Support/insto-gui`, `cleanup`); finally the evidence file is
complete, the runtime's own architecture matches the target that was built, and
the DMG hash agrees with the `.sha256` that is published.

`applications_layout` is recorded twice on purpose: the install stage repeats the
check immediately before it copies anything into `/Applications`, so a layout that
changed between preflight and install is caught rather than assumed. Two passing
lines for that gate are the expected evidence, not a duplicate.

`packaging/release-gates.sh` runs the same stages locally. `preflight` and
`artifacts` are safe anywhere; `install` replaces `/Applications/insto.app` and
this user's `Application Support/insto-gui`, so it refuses to run unless `CI=true`
or `--throwaway-machine` is given.

Signing order remains the rule for any future Developer ID work: sign nested
binaries, generate the manifest and build id, sign the outer application, notarize.
With ad-hoc signing Tauri leaves the runtime untouched, and the manifest gate
enforces that on every build.
