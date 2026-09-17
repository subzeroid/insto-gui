#!/bin/bash
# Release gates for a built insto DMG. Three stages, run in this order by the
# release workflow; the schema is the contract (see packaging/README.md, "R1 release"):
#
#   preflight  (first step of the job, seconds, no build)
#     launchd gui domain ── /Applications is root:admin 0775 ── workspace ancestors safe
#   artifacts  (after the release build, BEFORE the app-proof build overwrites the .app)
#     codesign ── designated requirement ── runtime == manifest ── hdiutil verify ── one .app ── hashes
#   install    (after the native proof, so the proof never sees this Application Support)
#     ditto → /Applications ── quarantine ── spctl must refuse ── de-quarantine ── launch publishes runtime ── cleanup
#
# Every gate is blocking: the first failure appends a "fail" line to the evidence
# file and exits 1. Argument errors exit 2. The install stage replaces
# /Applications/insto.app and ~/Library/Application Support/insto-gui, so it
# refuses to start unless CI=true or --throwaway-machine says this machine is
# disposable; that refusal also exits 2, before anything is touched.
#
# Usage:
#   release-gates.sh --stage preflight --target TRIPLE --evidence FILE [--workspace DIR]
#   release-gates.sh --stage artifacts --dmg DMG --app APP --target TRIPLE --evidence FILE
#   release-gates.sh --stage install   --dmg DMG --target TRIPLE --evidence FILE [--throwaway-machine]
set -euo pipefail

STAGE=""; DMG=""; APP=""; TARGET=""; EVIDENCE=""; WORKSPACE="$PWD"; THROWAWAY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --stage) STAGE="$2"; shift 2 ;;
    --dmg) DMG="$2"; shift 2 ;;
    --app) APP="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --evidence) EVIDENCE="$2"; shift 2 ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --throwaway-machine) THROWAWAY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$STAGE" ] || [ -z "$TARGET" ] || [ -z "$EVIDENCE" ]; then
  echo "missing arguments: --stage, --target and --evidence are required" >&2; exit 2
fi
case "$STAGE" in
  preflight) ;;
  artifacts) [ -n "$DMG" ] && [ -n "$APP" ] || { echo "missing arguments: --dmg and --app are required for the artifacts stage" >&2; exit 2; } ;;
  install) [ -n "$DMG" ] || { echo "missing arguments: --dmg is required for the install stage" >&2; exit 2; } ;;
  *) echo "unknown stage: $STAGE" >&2; exit 2 ;;
esac
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# .build is created 0700 by other packaging tooling; mkdir -p on an existing
# directory is a no-op and never changes its mode.
mkdir -p "$WORKSPACE/.build"

# Cleanup safety net: any gate failure (via `exit 1` inside gate()/record fail
# branches) or argument-time exit still fires this trap. It kills a launched
# app, unmounts a still-mounted DMG, and — only for the install stage, which
# runs only on a throwaway machine — removes the installed app and its
# Application Support directory, so a mid-stage failure never leaves the DMG
# mounted or a half-cleaned /Applications behind. `local status=$?` captures
# the real exit code before any command in this handler can change it, and
# `exit "$status"` at the end re-asserts it so the trap never masks a failure.
MOUNT=""; INSTALLED=0; APP_PID=""
cleanup() {
  local status=$?
  [ -n "$APP_PID" ] && { kill "$APP_PID" 2>/dev/null || true; wait "$APP_PID" 2>/dev/null || true; }
  [ -n "$MOUNT" ] && hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  if [ "$INSTALLED" = "1" ]; then rm -rf /Applications/insto.app "$HOME/Library/Application Support/insto-gui"; fi
  exit "$status"
}
trap cleanup EXIT

record() { # record GATE RESULT [KEY VALUE]...
  local gate="$1" result="$2"; shift 2
  local args=(--arg gate "$gate" --arg result "$result" --arg target "$TARGET")
  # shellcheck disable=SC2016 # these are jq variables (bound via --arg above), not shell ones
  local expr='{gate:$gate,result:$result,target:$target'
  while [ $# -gt 0 ]; do args+=(--arg "$1" "$2"); expr="$expr,$1:\$$1"; shift 2; done
  jq -cn "${args[@]}" "$expr}" >>"$EVIDENCE"
}
gate() { # gate NAME COMMAND...  (records pass/fail, exits 1 on fail)
  local name="$1"; shift
  if "$@"; then record "$name" pass; else record "$name" fail; echo "GATE FAILED: $name" >&2; exit 1; fi
}
mount_dmg() { hdiutil attach -nobrowse -readonly -noautoopen "$DMG" | awk -F'\t' '/\/Volumes\//{print $NF}'; }

check_applications_layout() {
  local layout; layout="$(stat -f '%u:%g %Mp%Lp' /Applications)"
  if [ "$layout" = "0:80 0775" ]; then record applications_layout pass layout "$layout"
  else record applications_layout fail layout "$layout"; echo "GATE FAILED: applications_layout (/Applications is $layout, not root:admin 0775)" >&2; exit 1; fi
}

preflight_stage() {
  local uid; uid="$(id -u)"
  # The native proof bootstraps a LaunchAgent into gui/<uid>; a headless session has no such domain.
  gate launchd_gui_domain launchctl print "gui/$uid"
  check_applications_layout
  # Mirror app_native_probe.safe_ancestors: every directory from / down to the
  # workspace is owned by root or by this user, with no group/world write and no
  # special bits. Without this the same failure surfaces only after two builds.
  local dir kind owner mode
  dir="$(cd "$WORKSPACE" && pwd -P)"
  while :; do
    read -r kind owner mode <<<"$(stat -f '%HT %u %Mp%Lp' "$dir")"
    if [ "$kind" != "Directory" ] || { [ "$owner" != "0" ] && [ "$owner" != "$uid" ]; } || [ $((8#$mode & 8#7022)) -ne 0 ]; then
      record workspace_ancestors fail path "$dir" owner "$owner" mode "$mode"
      echo "GATE FAILED: workspace_ancestors ($dir: owner $owner, mode $mode)" >&2; exit 1
    fi
    [ "$dir" = "/" ] && break
    dir="$(dirname "$dir")"
  done
  record workspace_ancestors pass workspace "$WORKSPACE"
  # Gate 5 requires spctl to refuse; that only means something while assessments are on.
  gate gatekeeper_assessments_enabled bash -c 'spctl --status 2>&1 | grep -q "assessments enabled"'
}

artifacts_stage() {
  gate signature_intact codesign --verify --deep --strict "$APP"
  # shellcheck disable=SC2016 # $1 is the inner bash's positional param (the trailing "$APP"), not this shell's
  gate designated_requirement bash -c 'codesign --display --requirements - "$1" 2>&1 | grep -Fq "designated =>"' _ "$APP"
  local runtime
  if runtime="$(cd "$REPO" && python3 -B -m scripts.verify_app_runtime "$APP" 2>"$WORKSPACE/.build/verify-$TARGET.err")"; then
    record runtime_matches_manifest pass runtime_build_id "$(jq -r .build_id <<<"$runtime")" \
      runtime_architecture "$(jq -r .architecture <<<"$runtime")"
  else
    record runtime_matches_manifest fail
    echo "GATE FAILED: runtime_matches_manifest" >&2; cat "$WORKSPACE/.build/verify-$TARGET.err" >&2; exit 1
  fi
  gate dmg_verifies hdiutil verify "$DMG"
  local count
  MOUNT="$(mount_dmg)"
  count="$(find "$MOUNT" -maxdepth 1 -type d -name '*.app' | wc -l | tr -d ' ')"
  hdiutil detach "$MOUNT" -quiet
  MOUNT=""
  if [ "$count" = "1" ]; then record dmg_carries_one_app pass
  else record dmg_carries_one_app fail count "$count"; echo "GATE FAILED: dmg_carries_one_app" >&2; exit 1; fi
  local dmg_sha exe_sha
  dmg_sha="$(shasum -a 256 "$DMG" | cut -d' ' -f1)" || dmg_sha=""
  exe_sha="$(shasum -a 256 "$APP/Contents/MacOS/insto-gui" | cut -d' ' -f1)" || exe_sha=""
  if [ ${#dmg_sha} -ne 64 ] || [ ${#exe_sha} -ne 64 ]; then
    record hashes fail; echo "GATE FAILED: hashes" >&2; exit 1
  fi
  record hashes pass dmg_sha256 "$dmg_sha" executable_sha256 "$exe_sha"
}

install_stage() {
  if [ "${CI:-}" != "true" ] && [ "$THROWAWAY" != "1" ]; then
    echo "install stage refused: it replaces /Applications/insto.app and ~/Library/Application Support/insto-gui." >&2
    echo "Run it only on a throwaway machine: set CI=true or pass --throwaway-machine." >&2
    exit 2
  fi
  check_applications_layout
  MOUNT="$(mount_dmg)"
  rm -rf /Applications/insto.app
  INSTALLED=1
  gate install_to_applications ditto "$MOUNT/insto.app" /Applications/insto.app
  hdiutil detach "$MOUNT" -quiet
  MOUNT=""
  # Recursive, like a Safari download: every file in the bundle carries the attribute.
  gate quarantine_applied xattr -r -w com.apple.quarantine "0083;$(printf %x "$(date +%s)");Safari;" /Applications/insto.app
  # Unsigned and unnotarized: Gatekeeper must refuse (preflight proved assessments
  # are on). A pass here would mean the README lies or the app is unexpectedly trusted.
  local assessment
  if assessment="$(spctl --assess --type execute /Applications/insto.app 2>&1)"; then
    record gatekeeper_refuses_unnotarized fail assessment "$assessment"
    echo "GATE FAILED: gatekeeper_refuses_unnotarized (spctl accepted an unnotarized app: $assessment)" >&2; exit 1
  fi
  record gatekeeper_refuses_unnotarized pass assessment "$assessment"
  gate quarantine_removed xattr -r -d com.apple.quarantine /Applications/insto.app
  local build_id
  build_id="$(cd "$REPO" && python3 -B -m scripts.verify_app_runtime /Applications/insto.app | jq -r .build_id)" || build_id=""
  if [ ${#build_id} -ne 64 ]; then
    record launch_publishes_runtime fail reason no_build_id
    echo "GATE FAILED: launch_publishes_runtime (no_build_id)" >&2; exit 1
  fi
  local support="$HOME/Library/Application Support/insto-gui"
  local published="$support/runtimes/$build_id"
  rm -rf "$support"
  # Run the binary directly with its output captured: `open` detaches and hides
  # the log, and quitting through osascript needs a TCC automation grant that a
  # runner cannot give. The frontend calls prepare_desktop once the WebView is up.
  local log="$WORKSPACE/.build/launch-$TARGET.log"
  mkdir -p "$(dirname "$log")"
  /Applications/insto.app/Contents/MacOS/insto-gui >"$log" 2>&1 &
  APP_PID=$!
  local waited=0
  until [ -d "$published" ] || [ "$waited" -ge 90 ]; do sleep 3; waited=$((waited + 3)); done
  kill "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  APP_PID=""
  if [ -d "$published" ]; then record launch_publishes_runtime pass seconds "$waited" runtime_build_id "$build_id"
  else
    record launch_publishes_runtime fail seconds "$waited"
    echo "GATE FAILED: launch_publishes_runtime; application log follows" >&2; cat "$log" >&2; exit 1
  fi
  rm -rf /Applications/insto.app "$support"
  INSTALLED=0
  record cleanup pass
}

case "$STAGE" in
  preflight) preflight_stage ;;
  artifacts) artifacts_stage ;;
  install) install_stage ;;
esac
