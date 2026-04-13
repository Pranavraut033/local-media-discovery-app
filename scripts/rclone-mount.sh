#!/usr/bin/env bash
# rclone-mount.sh — Mount hetzner-crypt remote and keep it alive.
# Managed by PM2 as the "rclone-mount" process.
# On exit (PM2 stop, SIGTERM, error) it cleans up the FUSE mount.

set -euo pipefail

MOUNT_DIR="${RCLONE_MOUNT_DIR:-$HOME/hetzner_mount}"
CACHE_DIR="${RCLONE_CACHE_DIR:-$HOME/rclone-cache}"
REMOTE="hetzner-crypt:/"
ACTIVITY_FILE="/tmp/rclone-last-activity"

cleanup() {
  echo "[rclone-mount] Cleaning up mount at $MOUNT_DIR..."
  diskutil unmount force "$MOUNT_DIR" 2>/dev/null || true
  pkill -f "rclone mount hetzner-crypt" 2>/dev/null || true
  rm -f "$ACTIVITY_FILE"
  echo "[rclone-mount] Cleanup done."
}

trap cleanup EXIT INT TERM

# Ensure directories exist
mkdir -p "$MOUNT_DIR" "$CACHE_DIR"

# Record initial activity timestamp so watchdog doesn't stop immediately
date +%s > "$ACTIVITY_FILE"

echo "[rclone-mount] Mounting $REMOTE -> $MOUNT_DIR"
echo "[rclone-mount] Cache dir: $CACHE_DIR"

exec caffeinate -d -i rclone mount "$REMOTE" "$MOUNT_DIR" \
  --allow-other \
  --allow-non-empty \
  --dir-cache-time 24h \
  --poll-interval 30s \
  --fast-list \
  --vfs-cache-mode full \
  --vfs-cache-max-age 24h \
  --vfs-cache-max-size 50G \
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
  --log-level INFO
