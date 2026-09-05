# P0 runtime portability proof — 2026-09-05

**Result: PASS on the tested Apple Silicon host.** This is a developer
runtime proof, not a released GUI, signed application or installer.

## Scope completed

- [x] Separate repository and local `feat/runtime-proof` branch.
- [x] Exact runtime inventory with owner/type/mode checks, including root mode.
- [x] Pinned, hash-verified CPython input and bounded archive extraction.
- [x] Frozen dependency exports, hashed build constraints and installed core wheel.
- [x] Offline relocated-runtime proof in a new path containing spaces.
- [x] Isolated native LaunchAgent lifecycle and verified cleanup.
- [x] Developer instructions and retained local evidence.

Only Astra agents were used for implementation and independent reviews.
Review findings about root permission drift, interrupted process construction,
interrupted shutdown and hidden build diagnostics were fixed with regression
tests before completion.

## Inputs

| Input | Tested value |
| --- | --- |
| Host | macOS 26.6.2, build 25G83, arm64 |
| Bundled Python | CPython 3.12.14, standalone release 20260901 |
| Developer Python | 3.12.11 |
| uv | 0.8.13 (`ede75fe62`, 2025-08-21) |
| Core | insto 0.7.20 |
| Core commit | `d4ea4f89aa57940e6fbba2d9c195b11ae682e777` |
| Core wheel | `insto-0.7.20-py3-none-any.whl` |
| HikerAPI SDK | 1.7.9 |
| Inventory | 3,115 entries, including the runtime root |
| Installed runtime disk usage | approximately 117 MiB (`du -sh`) |

The two architecture URLs and digests in `python-distributions.json` were
checked against upstream GitHub release asset metadata. Only arm64 was built
and executed. No upstream or dependency fallback was used.

```text
build_id:
50fb4f6e77cbbb13e7267cf4dbd5c0b262832b6f0220b24b545c451586469778
upstream_arm64_sha256:
81a359f1cfadd4da11766534c5913791cea55f26e1bb902cacd2a531bb1e4b2b
core_wheel_sha256:
ed5907606ed00218a81bb1b90153f14ef4bfd20219d80a52e6e92fd2aef7e13d
requirements_sha256:
5f9753cf664ef68bf17eb1e670aa1829271dbab0fe5860efa363dfefa180a9b6
build_constraints_sha256:
0a06f4618a685fd6d9093cab8789b4b1f7c61a8134996b4c49d0b2133540e771
```

The independently built wheel hash matches the previously verified C0 wheel.
The source core worktree remained clean at the same commit after the build
and native test. Upstream Python and installed dependency license files
remain in the runtime; this is not a completed distribution-license audit.

## Verification

| Check | Result |
| --- | --- |
| stdlib unit tests | 44 passed |
| Ruff lint and format check | Passed |
| Pinned runtime build and pip dependency check | Exit 0 |
| Relocated desktop handshake | Protocol 1, schema 2, `hello`, core 0.7.20 |
| Installed package origin | Inside relocated `python/lib/python3.12/site-packages` |
| SQLite in-memory query | Passed |
| TLS CA store | Loaded successfully from bundled certifi |
| HikerAPI SDK | Constructed and closed with an offline fixture token, no API request |
| Runtime inventory after offline/native execution | Unchanged |
| Native LaunchAgent test | **1 passed in 23.62s**, no skip |

The native test verified a new fake monitoring tick, idempotent installation,
restart after a verified test-process crash, clean exit without restart,
uninstall and preserved fake profile data. Its supervisor recorded exit code
`0`, phase `passed`, and `cleanup_confirmed: true`.

Afterward, a separate read-only check confirmed the exact launchd label was
missing and the plist/manifest were absent. An immutable, read-only query of
the already-stopped fixture confirmed the preserved fake watch was `alice`,
with `last_ok = 1788573662`, without modifying the database.

## Retained local evidence

Paths below are relative to this checkout and ignored by Git:

```text
.build/runtime-host-01/manifest.json
.build/runtime-host-01/requirements.txt
.build/runtime-host-01/build-constraints.txt
.build/relocated proof _e0cg_7k/evidence.json
.build/relocated proof cxaea3qr/evidence.json
.build/relocated proof cxaea3qr/native-context.json
.build/relocated proof cxaea3qr/native-result.txt
.build/relocated proof cxaea3qr/native-test/service home/
```

Exact test label: `io.insto.watch.501.1318937ddc32a22e` — confirmed absent.
The test registration and its generated plist/manifest were removed by the
test's normal uninstall. Fake data, logs and both relocated runtimes are
retained. No real watch, token or user service was used or removed.

## Explicitly not proved

- Intel/x86_64 runtime execution or native service behavior.
- A packaged `.app`, code signing, notarization, quarantine or Gatekeeper.
- The production runtime publisher and its post-signing manifest.
- GUI/token-entry onboarding, Keychain storage or real HikerAPI access.
- Compatibility with other macOS versions or a clean end-user machine.

Nothing was pushed, published, merged or released. Next: C1 desktop operations,
then P1 signed application/runtime proof, before the GUI onboarding milestone.
