# insto-gui

Self-contained macOS app for Instagram monitoring with a bundled insto core.
Install the app, enter a HikerAPI token, add accounts, start monitoring. The
background service keeps running after the app is closed; it is disabled from
inside the app, not by deleting it.

## Install

Requires macOS 14 (Sonoma) or newer.

**Homebrew**

```sh
brew install --cask subzeroid/tap/insto
```

Then follow *First launch* below once. (`brew install --cask --no-quarantine`
skips that prompt by not marking the download; use it only if you have checked
the DMG hash against `SHA256SUMS` on the release page.)

**Download**

Take the file for your Mac from [GitHub Releases](https://github.com/subzeroid/insto-gui/releases)
and drag `insto.app` to `/Applications`. Apple menu → *About This Mac* shows which
chip you have.

| Mac | File |
|---|---|
| Apple Silicon (M1 and later) | `insto_x.y.z_aarch64.dmg` |
| Intel | `insto_x.y.z_x64.dmg` |

**First launch**

The app is ad-hoc signed and not notarized, so macOS refuses it once:

1. Open `insto.app`. macOS says it cannot verify the app. Close the dialog.
2. Open System Settings → Privacy & Security, scroll to the message about insto
   and choose *Open Anyway*. On macOS 14, Control-click → *Open* also works.
3. Open the app again. This happens only once per download.

## What the app does

The app bundles a compatible Python insto core; you do not install Python, uv or
the CLI separately. It migrates its own background service onto the runtime it
ships, automatically at startup; it can work with an existing `~/.insto` folder
after an explicit confirmation, leaving that folder's own files untouched; and it
can disable the background service without deleting settings, history or credentials.

## Developers

Packaging commands live in [packaging/README.md](packaging/README.md) and are not
user installation instructions. Evidence and remaining gates:
[app proof](packaging/app-proof-results.md). Licence: MIT, third-party notices in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
