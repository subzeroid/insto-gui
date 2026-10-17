## What’s new in 0.3.0

- A simpler start screen: enter an account and choose Profile or Profile and posts, with the request cost shown before checking.
- An orange/pink/purple gradient logo and Mac icon, plus a scanner showing real request stages and elapsed time.
- Overview, Activity, Geography, and Hashtags / mentions tabs that reuse one fetched sample.
- Local saved checks, offline reopening, comparisons, and portable HTML / JSON reports.
- A shared daily request limit for lookups and background monitoring.
- Monitoring groups accounts and changes; Settings groups connection, request limits, and diagnostics.
- Faster verified first launch, safer account/profile switching, and post-only changes in snapshot history.

The app bundles insto 0.7.25. Existing settings and history are retained on upgrade.

## Downloads and first launch

insto for macOS 14 (Sonoma) and newer. Two builds, one per architecture:

- the `_aarch64.dmg` file for Apple Silicon (M1 and later)
- the `_x64.dmg` file for Intel Macs

`SHA256SUMS` lists both hashes; each DMG also has a `.sha256` file.

The interface is in English; Russian can be chosen in Settings.

This build is ad-hoc signed and not notarized. On first launch macOS will say it
cannot verify the app. Open System Settings → Privacy & Security and choose
*Open Anyway*. From a terminal, `xattr -dr com.apple.quarantine /Applications/insto.app`
does the same; check the DMG hash against `SHA256SUMS` first.
The README’s *Download* and *First launch* sections have the full steps.
