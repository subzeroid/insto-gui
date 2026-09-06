# P1/G1 local application evidence

Date: 2026-09-05 (G1 sections: 2026-09-06). Scope: local macOS arm64 developer shell, not a release.
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

### G1 real-bridge proof

`crates/desktop-host/tests/c2_bridge.rs` executed against
`.build/runtime-c2-01` on 2026-09-06 with a fresh seeded fake profile: hello (19
capabilities), overview, add/limit/exists/conflict/pause/resume/update/remove,
paginated list, targets with identity diagnostic, snapshot list, comparison,
`snapshot_unavailable`, `snapshot_identity_mismatch`, global and filtered feed.
Result: 1 passed in 3.94 s. No provider call, no LaunchAgent, token absent from
every decoded response. The fixture is seeded by the developer-only
`scripts/seed_desktop_fixture.py` through the runtime interpreter into a private
temporary root that only contains `profile`, `desktop-state.json` and
`.desktop.lock` after shutdown. This is offline fake evidence, not user
onboarding.

### G1 frontend proof

Browser QA on 2026-09-06 used local Vite at `127.0.0.1:1420` with a
developer-injected in-memory `__TAURI_INTERNALS__.invoke` mock defined before
the app scripts ran (ignored `.build/qa/` harness page; no mock backend or path
override entered production code). The mock answered `prepare_desktop`
(core 0.7.21, sixty-four-hex build id), a stopped configured profile after
`configure_setup`, an overview with alice (waiting first check) and bob (paused,
three consecutive errors), one target PK 7 for the username search, three
snapshots, a comparison with one change plus one unknown field, a change feed
page with baseline, comparison, incomplete and diagnostic entries followed by
an empty complete page, a new watch on `add_watch`, one `watch_conflict` on
`pause_watch`, and a variant where `read_overview` rejected with `transport`
after the first success. Verified at a 980×820 app viewport and at 375×812
(both are the viewport of an iframe sized inside the automation window, whose
own top-level viewport was pinned at 980×757):

- Setup → configured flow landed on «Наблюдения» with the empty call to
  action and the four sections; the token input was unmounted and its value
  did not remain in the DOM. The add form rejected `bad name!` locally without
  a bridge call and canonicalized `@Alice` to `alice` (interval 300).
- Selecting a row issued exactly `search_targets`, `list_snapshots` and
  `compare_snapshots` with zero new resource requests; the comparison rendered
  «Подписчики 10 → 12» and the unknown-field note for «Полное имя». The pair
  pickers re-issued `compare_snapshots` for the chosen ordered pair and pruned
  the partner options (older 2,1 → newer 3,2 → older 1).
- The conflict showed the static `watch_conflict` message, one reconciling
  read and the refreshed paused row; removal opened the in-page confirmation
  (cancel issued nothing, confirm issued `remove_watch` then one read).
- The stale banner arrived from the five-second poll itself (observed
  `read_overview` spacing 5.0 s), disabled resume/remove/interval/add
  controls, marked the row, kept the data visible and showed «остановлена
  (устарело)» in the service section; «Обновить» issued one read and
  re-enabled everything.
- The feed showed all four kinds (filtered by PK 7 from the watch, then
  global), «Показать дальше» sent the cursor and the end-of-history note
  appeared; the service section showed the observed state, «Ядро и база» and
  the last successful read, and start/stop each reconciled with one read;
  settings showed «Заменить токен» (password field, «Сохранить токен») and the
  uninstall confirmation with the Trash note (DOM-verified).
- No console errors, no requests outside `127.0.0.1:1420`, empty
  `localStorage`/`sessionStorage`, and no horizontal overflow in any section
  at 375 px (scroll width equal to client width).

Retained screenshots in ignored `.build/`: `browser-g1-watches.png`,
`browser-g1-changes.png`, `browser-g1-service.png`, `browser-g1-settings.png`
and `browser-g1-stale.png` capture the 980×820 iframe viewport, and
`browser-g1-mobile.png` the 375×812 one. The "980×820" and "375×812" figures
are the app viewport of an iframe sized inside the automation window (whose
top-level viewport was pinned at 980×757); the PNGs are scaled captures of
that iframe at their actual pixel sizes, 1203×1008 for the five desktop shots
and 698×1510 for the mobile shot, not 1:1 window pixels. The
`browser-g1-settings.png` capture shows only the top of the uninstall
confirmation box; its text, including the Trash note, was verified in the DOM.
Limits: the console session was locked during the browser QA
(`CGSSessionScreenIsLocked` yes) and the automation window was occluded, so
interactions were driven by DOM-dispatched events through the same Vue
handlers rather than trusted pointer/keyboard input, the picker change was
simulated by a `change` event, and the harness reported `visibilityState` as
visible so the polling path ran. The QA mock returned
`read_overview.service_state` as `stopped` (the intended mock value was `unknown`);
both decode. These are mock UI evidence, not provider onboarding or WebKit
rendering evidence.

### G1 WebKit window proof

Built online on 2026-09-06 at `8f00434` with
`npm run tauri -- build --features app-proof --bundles app -- --locked`
(`--offline` was not used: the local cargo registry is not fully cached); the
release profile compiled in 51 s. The generated app was copied with `cp -cRp`
into the new private parent `.build/native-app-g1-window-01/insto.app`: strict
ad-hoc `codesign --verify --strict --deep` passed, all 3,139 entries match the
built bundle, executable SHA-256
`2ca303e1bce13fa696430d200715dd0245a2e96803c5cd0dcecc1da95e0d729b`, bundled
build id `a910ea75d07236f49db324d24766b7ddad6980d89e09334fff6c62ad79c9978c`.
The probe ran as `/opt/homebrew/bin/python3 -B -m scripts.app_native_probe
<copied app> .build/native-app-g1-window-01/insto-app-proof-g1-01 --mode window`.

Result: **failed** — `passed: false`, `TimeoutError: proof signal timed out`
after 260.047 s, `app_group_cleaned` and `cleanup_confirmed` true. The real
application emitted `window_opened`, `prepare_started`, `script_started` and
`prepare_ready`: it opened the production WebKit window and published the
pinned runtime into the fresh root, which afterwards contains only private
`runtime.lock` and `runtimes/<build_id>`, not a profile. It never reached
`inspect_started` or `ui_ready`. The console session was locked for the whole
run (`CGSSessionScreenIsLocked` yes, user idle about 3.8 h), so the WebKit view
stayed occluded; one PID/executable-validated AppKit activation of the exact
app and one display wake (`caffeinate -u`) did not resume it. This is
consistent with the documented P1 stall (the same gap between `prepare_ready`
and `inspect_started`) and is attributed to the locked session; that
attribution is unverified until the `-02` rerun passes. It was not retried
into the same root. The retained
`.build/native-app-g1-window-01/insto-app-proof-g1-01-result.json` holds the
bounded evidence (empty app stderr). The window proof must be rerun in a new
artifact parent (for example `.build/native-app-g1-window-02`) from an
unlocked, foreground session before G1 is treated as WebKit-verified. No
`--mode native` run and no LaunchAgent were used.

The ordinary build (`npm run tauri -- build --bundles app -- --locked`, no
proof feature, compiled in 20.87 s) is retained at
`.build/app-g1-ordinary-01/insto.app`; its executable SHA-256 is
`dc0d8568ab461543fcf3639a2b8844785d4f05b0ed1e0bb8458e7f3828e73a07` and strict
ad-hoc signature verification passes. With a clean environment, both
`--proof-window /tmp/x` and `--proof-root /tmp/x` returned exit 1, empty
stdout and exactly `unsupported_arguments`; `/tmp/x` was not created and the
default profile was not opened.

### G1 WebKit window proof (rerun)

Rerun on 2026-09-06 at 13:02 local time from an unlocked, foreground console
session (`CGSSessionScreenIsLocked` absent) at `97f2274`. The app-proof bundle
was rebuilt online with
`npm run tauri -- build --features app-proof --bundles app -- --locked`
(23.44 s incremental; executable SHA-256
`41df95adc20666aeb92f5c46c8a8fd51b82b2a4655f02c0609939383e316f81e`), copied with
`cp -cRp` into the new private parent `.build/native-app-g1-window-02/insto.app`
(strict ad-hoc `codesign --verify --strict --deep` passed, same executable hash),
and driven by `/opt/homebrew/bin/python3 -B -m scripts.app_native_probe
<copied app> .build/native-app-g1-window-02/insto-app-proof-g1-02 --mode window`.
About two seconds after launch the exact app (PID-validated, bundle id
`app.insto.desktop`) received one AppleScript `activate`; no further focus
changes were made.

Result: **passed** — `passed: true`, `cleanup_confirmed: true`,
`app_group_cleaned: true`, `elapsed_seconds 21.365`, empty app stderr, bundled
build id `a910ea75d07236f49db324d24766b7ddad6980d89e09334fff6c62ad79c9978c`. The
real WebKit window emitted the complete sequence `window_opened`,
`prepare_started`, `script_started`, `prepare_ready`, `inspect_started`,
`inspect_ready`, `form_ready`, `ui_ready`, `close_requested`, `drained`: the
G1 frontend prepared the pinned runtime, read the unconfigured profile through
the real IPC path and rendered the token form with the P1 fixed developer
script's form, visibility, validation, geometry, IPC and profile checks all
passing. This confirms the `-01` attribution: the earlier stall was the locked
session, not a G1 regression. The retained
`.build/native-app-g1-window-02/insto-app-proof-g1-02-result.json` holds the
bounded evidence; the failed `-01` artifacts are kept unchanged. No
`--mode native` run and no LaunchAgent were used.

The ordinary build was rebuilt afterwards
(`npm run tauri -- build --bundles app -- --locked`, 20.82 s; executable SHA-256
`33d7a202df59fdc21307827690e8b8ad9662a71f8b9768d4ab8bde0389b0deb0`) and again
rejects `--proof-window /tmp/x` with exit 1 and exactly `unsupported_arguments`;
`/tmp/x` was not created.

### G1 gates

Run in order on 2026-09-06 at `8f00434` with the docs above staged: 16 Vitest
files / 75 tests and the TypeScript production build passed; `cargo fmt` for
both crates and strict all-target Clippy passed; the host crate ran 55 tests
with one failure, `owner::tests::local_mutation_uses_its_own_deadline_and_the_mutation_slot`
(not the `shutdown_preserves_original_mutation_deadline_and_never_replays` test
the plan names): its 400 ms local-mutation budget expired before the
`/usr/bin/python3` fixture wrote its `started` marker while the host carried a
load average of about 16 on 14 cores from unrelated workloads, which is the
known load-sensitive fixture timing, not a policy change. Rerun alone it failed
once more and passed on the second spaced rerun under the same load; the full
host suite was not observed green in a single run under that load of about 16.
The real bridge test `c2_bridge` against `.build/runtime-c2-01` passed (1 test,
4.16 s), the Tauri crate's 9 tests passed, 103 Python unittest cases passed and
`git diff --check` was clean. The trailer/home-path grep over all tracked files
(rerun without the plan carve-out after the plan's home paths were scrubbed)
matched only the trailer rule text in `AGENTS.md`.
