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

## Independent review

Final library verification: 64 Python tests and Ruff passed; 43 Rust host tests,
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

## Open gates

- Actual macOS WebKit window interaction and app-specific native persistence
  remain unverified; the offline developer feature does not open a window.
- A separately reviewed app-specific native supervisor must prove new fake
  SQLite ticks after app exit and source-app relocation. Historical P0/C1
  LaunchAgent evidence is not reused to claim this gate passed.
- Private-user source locations only. Standard `/Applications` ancestor trust
  remains an R1 compatibility gate; destination ownership stays strict.
- Watch/history UI is C2/G1; interpreter migration/external home adoption is G2.
- Signed/notarized downloaded installer, Gatekeeper/quarantine, both Mac
  architectures and clean-machine/minimum-OS support matrix remain R1.

P1 is not marked complete merely because library and frontend tests pass.
