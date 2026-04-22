#!/usr/bin/env bash
# rclone-watchdog.sh — DEPRECATED
# The inactivity watchdog is now built into the backend process
# via backend/src/services/rclone-mount.ts (RcloneMountService).
# This script is no longer used by PM2 or any other process.
echo "[rclone-watchdog.sh] This script is deprecated. The backend manages inactivity tracking directly."
exit 0


set -uo pipefail

MOUNT_DIR="${RCLONE_MOUNT_DIR:-$HOME/hetzner_mount3}"
INACTIVITY_SECONDS=600   # 10 minutes
CHECK_INTERVAL=60        # poll every 60 seconds
ACTIVITY_FILE="/tmp/rclone-last-activity"

log() {
  echo "[rclone-watchdog] $*"
}

mount_is_active() {
  mount 2>/dev/null | grep -q " on ${MOUNT_DIR} "
}

open_handles() {
  # grep -c returns exit code 1 when there are zero matches; keep numeric output stable.
  lsof 2>/dev/null | grep -c "${MOUNT_DIR}" || true
}

stop_mount() {
  log "Inactivity limit reached — stopping rclone mount."
  # Ask PM2 to stop the mount process gracefully first
  pm2 stop rclone-mount 2>/dev/null || true
  sleep 2
  diskutil unmount force "$MOUNT_DIR" 2>/dev/null || true
  pkill -f "rclone mount hetzner-crypt" 2>/dev/null || true
  rm -f "$ACTIVITY_FILE"
  log "Mount stopped."
}

log "Watchdog started. Mount dir: $MOUNT_DIR, timeout: ${INACTIVITY_SECONDS}s"

while true; do
  sleep "$CHECK_INTERVAL"

  # Only track inactivity when the mount is actually up
  if ! mount_is_active; then
    continue
  fi

  handles=$(open_handles)

  if [[ "$handles" -gt 0 ]]; then
    # Active file access — refresh timestamp
    date +%s > "$ACTIVITY_FILE"
    continue
  fi

  # No open handles — check idle duration
  if [[ ! -f "$ACTIVITY_FILE" ]]; then
    # No timestamp yet; create one and give it one full interval
    date +%s > "$ACTIVITY_FILE"
    continue
  fi

  last_activity=$(cat "$ACTIVITY_FILE")
  now=$(date +%s)
  idle=$(( now - last_activity ))

  log "Idle for ${idle}s (limit: ${INACTIVITY_SECONDS}s), open handles: ${handles}"

  if [[ "$idle" -ge "$INACTIVITY_SECONDS" ]]; then
    stop_mount
  fi
done
