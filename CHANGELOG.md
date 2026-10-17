# Changelog

## 0.3.0 — 2026-10-17

### Added

- Start a profile check or a profile-and-posts check from one account-first screen, with request cost visible before running it.
- Save checks locally, reopen them offline, compare two checks, and export standalone HTML or JSON reports.
- Explore a fetched post sample through Overview, Activity, Geography, and Hashtags / mentions tabs, including a local map and a Monday-first UTC heatmap.
- Set a daily request-attempt limit shared by desktop lookups and background monitoring.
- See actual scan stages and elapsed time with a radar and scan-line animation; reduced-motion settings are respected.

### Changed

- Group accounts and the change feed under Monitoring. Move connection, request limits, and diagnostics into Settings.
- Add an orange, pink, and purple gradient identity to the logo and Mac application icon.
- Bundle insto 0.7.25 with shared request budgeting and the weekday activity matrix.

### Fixed

- Preserve the selected scan scope and elapsed time when returning to a running check.
- Keep the successful profile available when post analysis fails, and skip post requests for private profiles.
- Prevent saved results and paid responses from crossing account or profile-folder changes. Competing paid calls are refused without queuing or replaying them under a later profile.
- Show post-only changes in history and clarify when the recent-post sample may omit more new posts.
- Avoid first-launch stalls caused by per-file physical flushes while preserving runtime verification and atomic publication.
