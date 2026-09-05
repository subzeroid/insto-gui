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

Final library verification: 64 Python tests and Ruff passed; 41 Rust host tests,
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

Nonblocking follow-ups: check an already-expired bridge deadline before spawning;
add a publisher coordination fixture with two distinct application processes
(current concurrent tests use separate file opens and real flock in one process).

## Open gates

- Tauri adapter ACL/lifecycle review, local `.app` bundle and real bundled-app
  prepare/inspect proof are being completed separately.
- A separately reviewed app-specific native supervisor must prove new fake
  SQLite ticks after app exit and source-app relocation. Historical P0/C1
  LaunchAgent evidence is not reused to claim this gate passed.
- Private-user source locations only. Standard `/Applications` ancestor trust
  remains an R1 compatibility gate; destination ownership stays strict.
- Watch/history UI is C2/G1; interpreter migration/external home adoption is G2.
- Signed/notarized downloaded installer, Gatekeeper/quarantine, both Mac
  architectures and clean-machine/minimum-OS support matrix remain R1.

P1 is not marked complete merely because library and frontend tests pass.
