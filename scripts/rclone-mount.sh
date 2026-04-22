#!/usr/bin/env bash
# rclone-mount.sh — DEPRECATED
# rclone mount lifecycle is now managed entirely by the backend process
# via backend/src/services/rclone-mount.ts.
# This script is no longer used by PM2 or any other process.
echo "[rclone-mount.sh] This script is deprecated. The backend manages the rclone mount directly."
exit 0


set -euo pipefail

MOUNT_DIR="${RCLONE_MOUNT_DIR:-$HOME/hetzner_mount3}"
CACHE_DIR="${RCLONE_CACHE_DIR:-$HOME/rclone-cache}"
REMOTE="hetzner-crypt:/"
ACTIVITY_FILE="/tmp/rclone-last-activity"
CAFFEINATE_PID=""

cleanup() {
  echo "[rclone-mount] Cleaning up mount at $MOUNT_DIR..."
  if [[ -n "${CAFFEINATE_PID}" ]]; then
    kill "$CAFFEINATE_PID" 2>/dev/null || true
  fi
  diskutil unmount force "$MOUNT_DIR" 2>/dev/null || true
  umount -f "$MOUNT_DIR" 2>/dev/null || true
  pkill -f "rclone mount hetzner-crypt" 2>/dev/null || true
  rm -f "$ACTIVITY_FILE"
  echo "[rclone-mount] Cleanup done."
}

trap cleanup EXIT INT TERM

# Ensure directories exist
mkdir -p "$MOUNT_DIR" "$CACHE_DIR"

# If the mountpoint is stale/busy (common after abrupt exits), clear it first.
echo "[rclone-mount] Pre-cleaning mountpoint at $MOUNT_DIR..."
diskutil unmount force "$MOUNT_DIR" 2>/dev/null || true
umount -f "$MOUNT_DIR" 2>/dev/null || true
pkill -f "rclone mount hetzner-crypt" 2>/dev/null || true
sleep 1

# Record initial activity timestamp so watchdog doesn't stop immediately
date +%s > "$ACTIVITY_FILE"

echo "[rclone-mount] Mounting $REMOTE -> $MOUNT_DIR"
echo "[rclone-mount] Cache dir: $CACHE_DIR"

# Do NOT use `exec` here — bash must stay alive so the EXIT trap fires on rclone exit/kill.
# caffeinate runs in background to prevent macOS sleep while mount is active.
caffeinate -d -i &
CAFFEINATE_PID=$!

mount_attempt=1
max_attempts=3
while [[ "$mount_attempt" -le "$max_attempts" ]]; do
  echo "[rclone-mount] Mount attempt ${mount_attempt}/${max_attempts}"

  if rclone mount "$REMOTE" "$MOUNT_DIR" \
    --allow-other \
    --allow-non-empty \
    --dir-cache-time 24h \
    --poll-interval 30s \
    --fast-list \
    --vfs-cache-mode full \
    --vfs-cache-max-age 1h \
    --vfs-cache-max-size 10G \
    --vfs-cache-poll-interval 1m \
    --vfs-read-ahead 256M \
    --vfs-read-chunk-size 4M \
    --vfs-read-chunk-size-limit 256M \
    --buffer-size 256M \
    --cache-dir "$CACHE_DIR" \
    --transfers 8 \
    --checkers 16 \
    --multi-thread-streams 4 \
    --multi-thread-cutoff 16M \
    --sftp-concurrency 8 \
    --sftp-chunk-size 128k \
    --use-mmap \
    --no-modtime \
    --log-level INFO; then
    break
  fi

  echo "[rclone-mount] Mount attempt ${mount_attempt} failed."
  diskutil unmount force "$MOUNT_DIR" 2>/dev/null || true
  umount -f "$MOUNT_DIR" 2>/dev/null || true
  sleep 2
  mount_attempt=$((mount_attempt + 1))
done

if [[ "$mount_attempt" -gt "$max_attempts" ]]; then
  echo "[rclone-mount] Failed to mount after ${max_attempts} attempts."
  exit 1
fi

# rclone exited — kill caffeinate and let the EXIT trap run cleanup
kill "$CAFFEINATE_PID" 2>/dev/null || true
