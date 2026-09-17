insto for macOS 14 (Sonoma) and newer. Two builds, one per architecture:

- the `_aarch64.dmg` file for Apple Silicon (M1 and later)
- the `_x64.dmg` file for Intel Macs

`SHA256SUMS` lists both hashes; each DMG also has a `.sha256` file.

This build is ad-hoc signed and not notarized. On first launch macOS will say it
cannot verify the app. Open System Settings → Privacy & Security and choose
*Open Anyway*, or install with `brew install --cask --no-quarantine subzeroid/tap/insto`.
The README's *Install* section has the full steps.
