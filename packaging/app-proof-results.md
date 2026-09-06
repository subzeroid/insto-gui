# P1 local application evidence

Date: 2026-09-05. Scope: local macOS arm64 developer shell, not a release.
No GitHub publication, Developer ID credentials, notarization, real HikerAPI
requests or live profiles were used.

## Pinned runtime and publisher

- Read-only core: `1abf3fbdea04d3da4e56ec9bec1090d7737a9727`, version 0.7.20,
  schema 2, all eight C1 capabilities.
- Build ID: `30f2959966b9f79cb3e727f0d6ac3c3592f4caecea5b5921f2d591e9f6e25e71`.
- Source `.build/runtime-c1-01`; staged `.build/app-resources/runtime`.
- Exact inventory: 3,122 entries. Original and staged inventory match.
- Manifest file SHA-256:
  `76d9997299e66aed8dd6ff47597904cec01757c3e31cbafffd0613ad0552857a`.
- Interpreter SHA-256 before and after publication:
  `2d96eb826dc74db4fcd5da6dde045a6fa145e292e07e69d1bdd1a19fa90ffc22`.
- Actual Rust publication took 38,651 ms into
  `.build/newprivateapp-proof-root/runtimes/<build_id>/python`.
- Strict hello, setup inspection and settings inspection succeeded. Both
  profile reads returned unconfigured. Proof root contains only `runtime.lock`
  and `runtimes`, not a profile, token or service registration.

This verifies the library's actual C1 runtime path, not a built-app or native
service gate. The unsigned manifest is integrity evidence, not authenticity.

## Built-app offline proof

Host: macOS 26.6.2 (25G83), arm64. Source at `1e00667` includes adapter
`fe80cfd` and the synchronous close integration. Built with:

```sh
npx tauri build --features app-proof --bundles app
```

The generated `.app` was copied into new private
`.build/app-proof-bundle/insto.app` before execution. Its embedded runtime is
byte-for-byte identical to `.build/app-resources/runtime`; strict ad-hoc code
signature verification passed. No Developer ID identity or notarization was
used. Only the application executable and outer bundle were ad-hoc signed;
the bundled Python inventory was not rewritten.

Copied application executable SHA-256:
`23b71b85a92ce4c5d8790c0653d967a3b544fa1e72eaf0c8227361123be5cd35`.

Actual command (absolute paths, no inherited environment except fixed PATH):

```sh
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  "$PWD/.build/app-proof-bundle/insto.app/Contents/MacOS/insto-gui" \
  --proof-root "$PWD/.build/insto-app-proof-01"
```

Result: exit 0 in **19.02 seconds**. `prepared` returned core 0.7.20 and the
exact pinned build ID; `inspected` returned all seven unconfigured profile
fields. The real bundled application's `DesktopState` performed publication,
strict hello, setup inspection and shutdown. This developer feature does not
open a window, call a provider, or issue service commands.

Published `.build/insto-app-proof-01/runtimes/<build_id>` matches the bundled
manifest and Python tree byte-for-byte. The interpreter SHA-256 is unchanged.
The fresh proof root contains only private `runtime.lock` and `runtimes`,
not a profile. The copied app and published runtime are retained separately.

The ordinary build (`npx tauri build --bundles app`, no proof feature) was
also built and retained at `.build/app-local-bundle/insto.app`. Its runtime
matches the staged inventory, and strict ad-hoc signature verification passes.
Its executable SHA-256 is
`85a1d39a9166b199aa1a635cd65d7744c2803ac114e83bc8a35cccbd3db50afd`.
Invoking it with `--proof-root` returned exit 1 and only `unsupported_arguments`;
the requested proof directory was not created. The ordinary GUI was not opened
against the default profile during verification.

## Frontend proof

22 Vitest tests pass, including named IPC, invalid tokens, safe errors, unsafe
integers and array-status rejection, duplicate submission, mutation readback,
stale-state blocking, saved setup after failed start and disposal during reads.
TypeScript checking and Vite production build pass.

Browser QA used local Vite at `127.0.0.1:1420` with a developer-injected
in-memory `__TAURI_INTERNALS__.invoke` mock. No mock backend or path override
was added to production code. Verified:

- Initial setup, password visibility and Enter submission.
- One configure command, cleared input and empty browser storage.
- Running/stopped states and zero cached quota despite a running process.
- Failed refresh preserves visible data and disables every mutation.
- No JavaScript console errors or external network requests during this flow.
- 980×820 and 375×812 layouts; no horizontal overflow on the narrow view.

Retained screenshots in ignored `.build/`:
`browser-setup-desktop.png`, `browser-running-desktop.png`,
`browser-running-mobile.png`. These are mock UI evidence, not actual provider
onboarding or macOS WebKit rendering evidence.

## Actual WebKit and native application proof

The separately reviewed `app-proof` feature opens the same production Tauri
window, ACL/CSP and eight-command IPC boundary. Its fixed developer script
uses real WebKit and real IPC, not the earlier browser mock. Production builds
do not admit proof roots or run the script/stdin controller.

- `.build/native-app-window-01`: setup/password visibility, invalid local
  input, Rust invalid-token IPC rejection, unconfigured profile inspection,
  DOM/style/geometry and actual close/drain passed. Executable SHA-256:
  `76397b26443155a9f240cc01839ddf74871bff6baddf59a0da74d1207aad6614`.
- Instrumented feature source `b567c40`, executable SHA-256:
  `74abb941077ce6980dfe362e7c58301bd5496151c3f61105a3e81402c78550f7`.
  `.build/native-app-close-02` closed while runtime preparation was underway;
  real CloseRequested, drain, exit 0 and owned-group cleanup passed in 18.82 s.
- `.build/native-app-quit-02` reached real ExitRequested and drained with exit 0
  in 236.928 s. It initially stalled between prepare_ready and inspect_started
  while backgrounded; one exact executable/PID-validated AppKit activation
  resumed the flow. No OS settings or permissions were changed. This proves
  the developer-launched foreground Quit path, not the cause of background
  suspension. Earlier quit01 timed out before Quit was sent and stays failed.
- No screen-recording access was requested. These are real DOM/style/geometry
  checks, not captured-pixel screenshot QA. No valid token or provider request
  was used; real-token configuration remains outside this fake/offline proof.

The new native fixture `.build/native-app-persistence-03` used that exact
instrumented app and supervisor commit `4e434d2`. It passed in 56.615 s with
`passed`, `app_group_cleaned` and `cleanup_confirmed` all true. Its initial
background view similarly resumed after one exact-owned-app activation.

The only fake home was
`insto-app-proof-persistence-03/native/service home`; installed Python was
`insto-app-proof-persistence-03/runtimes/<build_id>/python/bin/python3`.
The actual GUI remained unconfigured. The fixture seeded/installed via this
published interpreter, not a developer interpreter or source imports.

| Observation | Committed last_ok | Interval | Daemon PID |
| --- | ---: | ---: | ---: |
| GUI alive | 1788591015 | 601 | 27135 |
| GUI exited and owned group cleaned | 1788591017 | 600 | 27135 |
| Copied source app relocated | 1788591019 | 601 | 27135 |

All three observations had start identity `Sat Sep 5 09:50:15 2026` and
registration `881ca2816ad24926ac520231269e2525`. To request a fresh tick, the
fixture atomically toggled interval 600/601 and reset last_ok. C1's existing
reconciliation replaced the watch task; the daemon was not restarted.
The source copy moved from `insto.app` to the previously absent sibling
`insto-moved.app`, with the same directory inode. The installed runtime did
not move and its exact inventory remained verified.

Exact label `io.insto.watch.501.049bffdc9a7e53e0`, plist and manifest are absent
after installed-CLI uninstall. Its first call returned 1 with
`backend error: could not confirm LaunchAgent absence`; after exact absence
and renewed identity/ownership checks, the one permitted retry returned 0.
The result retains both calls. This bounded fixture recovery is not a core
uninstall fix; native post-bootout confirmation remains a follow-up to inspect
before distribution/uninstaller work. No raw bootout, manual plist removal or
broad process cleanup was used.

Earlier native02 stays failed: last_ok-only reset could not wake an existing
600-second task, and cleanup initially left ownership files. Those files and
the exact registration were subsequently removed through the validated
installed controller; `manual-cleanup.json` records that separately. The
original failed result, all profiles/logs/runtimes and copied apps are retained.

An ordinary build without `app-proof` is retained as
`.build/native-app-ordinary-02/insto.app`, executable SHA-256
`a77bfc654c6c33a32fb77a4093c70d5b608b1c48d214f072ea32d864383b5d89`.
Its full 3,122-entry runtime inventory and strict ad-hoc signature pass. Both
`--proof-root` and `--proof-window` return exit 1, empty stdout and exactly
`unsupported_arguments`, without creating the requested root. The default
profile was not opened. Ad-hoc verification is not a signed release gate.

## Independent review

Earlier library verification: 64 Python tests and Ruff passed; 43 Rust host tests,
Rust formatting and all-target Clippy with warnings denied passed. The 22 Vue
tests and TypeScript/production build passed again after the review fix.

Core C1 remains clean at the pinned commit; its `uv.lock` SHA-256 is unchanged:
`efa064cc8906504ba0e60e054c42ed2cfaefdf8ab6c44d145b353904cbfdc86b`.
The original GUI P0 checkout remains clean at
`a7ca08321ead17039413f22adcc015ef5bb0b74b`; core main remains clean at
`6db7c115745ab99bb988ea22d1f481114e8af278`.

Astra spec and fresh quality reviews passed separately for transport, publisher
and frontend. Publisher ownership finding was fixed in `3dac13d`; destination
manifest and every inventory entry now require current UID. Frontend status
coercion was reproduced and fixed with a rejection regression.

The expired-deadline review edge was also fixed: a controlled-child test first
observed one unwanted spawn, then passed with zero spawns for both reads and
mutations. The guard rejects expired work before command construction.

Tauri integration also required synchronous owner admission closure before
scheduling the asynchronous drain. Its regression first admitted an unpolled
invoke after a no-op close, then correctly rejected it without launching a child.
One concurrent development run had two existing fixture-start timing failures;
both passed individually, then the complete 43-test suite passed in 27.48 s.
This was not a production deadline change or a claim that fixture timing is
immune to host load.

Nonblocking follow-up: add a publisher coordination fixture with two distinct application processes
(current concurrent tests use separate file opens and real flock in one process).

Tauri spec and fresh quality source reviews also passed, with 9 adapter tests
and strict all-target/all-feature Clippy passing. A nonblocking review edge
remains: if the initialization future itself panics, a closed empty watch
receiver is retained and explicit Retry cannot recover without restarting the
application. No concrete production panic trigger was identified.

Latest native extension verification at `4e434d2`: 99 Python tests and Ruff
passed; 22 Vue tests, typecheck and production build passed; 18 all-feature and
8 default adapter tests, formatting and strict Clippy passed. Full host tests
run concurrently with other builds had 42 passes/1 failure: the dedicated 600 ms
mutation-deadline fixture ended before its ready marker. A complete serial
43-test run passed in 33.02 s, followed by formatting and strict Clippy. No
production policy was changed and timing robustness under load is not claimed.

Astra spec and fresh safety/quality reviews approved the real-window feature,
owned-child supervisor and final native fixture before installation. The
signal-termination retry finding was reproduced (two uninstall calls instead
of one), fixed and re-reviewed. Original tick-trigger and masked-cleanup-error
regressions also failed before the developer-only corrections.

## Remaining product/release gates

- P1's real WebKit and isolated app-specific native persistence checks above
  passed. This is local fake/offline evidence, not real-provider onboarding or
  a released installer. Historical P0/C1 native evidence was not substituted.
- Private-user source locations only. Standard `/Applications` ancestor trust
  remains an R1 compatibility gate; destination ownership stays strict.
- Watch/history UI is C2/G1; interpreter migration/external home adoption is G2.
- Signed/notarized downloaded installer, Gatekeeper/quarantine, both Mac
  architectures and clean-machine/minimum-OS support matrix remain R1.

Earlier independent Astra integration review at `3b50ef4`: PASS for safe local
handoff, no integration blockers. It checked frontend/IPC response alignment,
resource/pin wiring, synchronous admission closure and the evidence boundaries.
The local worktree is retained on `feat/app-shell`; nothing was published or
merged. The new app-specific native and WebKit evidence above closes those
additional execution gates. Final independent Astra extension integration
review approved `5617966..4e434d2` and this measured evidence for local P1
handoff, with no blockers. All planned P1 gates are complete; full watch/history
product completion and distribution remain separate stages.

## G1 runtime

Prepared `.build/runtime-c2-01` from insto `7a1872568bd90a642a3df838fd9854286f251d03`
(0.7.21) with `scripts.prepare_runtime`; probe passed; hello advertises the
nineteen pinned capabilities. Staged into `.build/app-resources/runtime`
(build id `a910ea75d07236f49db324d24766b7ddad6980d89e09334fff6c62ad79c9978c`). Developer evidence only, not a release artifact.
