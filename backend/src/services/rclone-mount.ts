/**
 * RcloneMountService — manages the rclone FUSE mount lifecycle entirely inside the backend process.
 *
 * Design:
 *  - Uses `rclone mount --daemon` so rclone forks itself into the background and the spawn call
 *    returns immediately. No caffeinate, no PM2 wrapper needed.
 *  - The real FUSE mountpoint is $HOME/.rclone-mounts/hetzner — a stable, user-owned directory
 *    that is never cleaned by macOS periodic scripts (unlike /tmp) and survives reboots.
 *  - ~/hetzner_mount is kept as a symlink pointing at that dir for compatibility.
 *  - If macFUSE refuses to release the preferred dir (stale lock), a timestamped sibling
 *    (~/.rclone-mounts/hetzner_<epoch>) is used as fallback and the symlink is updated.
 *    Old stale sibling dirs are cleaned up when stop() runs.
 *  - Activity is tracked via recordActivity(); any rclone API call should invoke it.
 *  - An inactivity watcher fires every 60 s and calls stop() after 10 min of silence.
 *  - stop() uses `umount -f` (macOS) / `fusermount -u` (Linux) which causes the daemon to exit.
 */

import { execFile, execFileSync, execSync } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REMOTE = 'hetzner-crypt:/';

function getBundledRclonePath(): string | null {
  const resourcesPath = (process as any).resourcesPath || '';
  const bundledPaths = [
    path.join(resourcesPath, 'rclone'),
    path.join(resourcesPath, 'bin', 'rclone'),
    path.join(__dirname, '..', '..', '..', 'resources', 'bin', 'rclone'),
    path.join(__dirname, '..', '..', '..', '..', 'Resources', 'bin', 'rclone'),
    path.join(__dirname, '..', '..', '..', '..', 'rclone'),
    path.join(__dirname, '..', '..', '..', '..', 'bin', 'rclone'),
  ];

  for (const p of bundledPaths) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return p;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function getSystemRclonePath(): string | null {
  const candidates: string[] = [];

  if (process.env.PATH) {
    for (const dir of process.env.PATH.split(path.delimiter)) {
      if (!dir) continue;
      candidates.push(path.join(dir, 'rclone'));
    }
  }

  candidates.push(
    '/usr/local/bin/rclone',
    '/opt/homebrew/bin/rclone',
    '/usr/bin/rclone',
    '/bin/rclone'
  );

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {
      // ignore missing files
    }
  }

  try {
    const resolved = execSync('command -v rclone', {
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: '/bin/sh',
    });
    const pathString = resolved.toString().trim();
    return pathString || null;
  } catch {
    return null;
  }
}

function getRclonePath(): string | null {
  return getBundledRclonePath() ?? getSystemRclonePath();
}

function isRcloneAvailable(): boolean {
  const binary = getRclonePath();
  if (!binary) return false;

  try {
    execFileSync(binary, ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const MOUNT_BASE = path.join(os.homedir(), '.rclone-mounts', 'hetzner');
const MOUNTS_DIR = path.join(os.homedir(), '.rclone-mounts');
const SYMLINK_PATH = path.join(os.homedir(), 'hetzner_mount');
// Cross-process ownership lock. The mount is a host-global singleton (one FUSE
// mountpoint, one symlink), so only ONE backend process may manage its lifecycle.
// A second instance (e.g. a PM2 stack running alongside the desktop app) adopts
// the live mount read-only instead of mounting/unmounting/pkilling it — which is
// what previously made two backends force-unmount each other into a stale mount.
const OWNER_LOCK_PATH = path.join(MOUNTS_DIR, '.owner.lock');
const CACHE_DIR = process.env.RCLONE_CACHE_DIR ?? path.join(os.homedir(), 'rclone-cache');

const INACTIVITY_MS = 10 * 60 * 1000; // 10 minutes
const CHECK_INTERVAL_MS = 60 * 1000; // check every 60 s
const MOUNT_CHECK_TIMEOUT_MS = 2000; // max time to wait for `mount` command
const MOUNT_CACHE_TTL_MS = 5000; // cache positive/negative result for 5 s
const COMMAND_TIMEOUT_MS = 3000; // timeout for unmount/kill commands
const STAT_TIMEOUT_MS = 1500; // max time to wait for a (possibly stale-FUSE) stat() call
const MOUNT_START_TIMEOUT_MS = 15000; // timeout for `rclone mount --daemon` launch
const START_GUARD_TIMEOUT_MS = 120000; // break stale "starting" state after 2 minutes

/** Sentinel returned by statWithTimeout() when a stat() call doesn't return in time. */
const STAT_TIMEOUT = Symbol('stat-timeout');

/**
 * stat() a path off the main thread with a hard wall-clock timeout.
 * A stale FUSE mountpoint can make stat() block in D-state indefinitely (libuv threadpool
 * thread, never returns) — without this timeout, callers would hang forever waiting on it.
 * Returns the Stats, `null` if the path doesn't exist (or any other error), or STAT_TIMEOUT
 * if the call didn't settle in time.
 */
function statWithTimeout(targetPath: string, timeoutMs = STAT_TIMEOUT_MS): Promise<fs.Stats | null | typeof STAT_TIMEOUT> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(STAT_TIMEOUT);
      }
    }, timeoutMs);
    timer.unref?.();

    fsp.stat(targetPath).then(
      (stat) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(stat);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    );
  });
}

export type MountStatus = 'mounted' | 'mounting' | 'error' | 'stopped';

export interface MountResult {
  mounted: boolean;
  status: MountStatus;
  message: string;
  mountDir: string;
}

class RcloneMountService {
  private lastActivityAt = 0;
  private watcherTimer: ReturnType<typeof setInterval> | null = null;
  private starting = false;
  private startingSince: number | null = null;
  /** True when THIS process holds the ownership lock and may manage the mount lifecycle. */
  private isOwner = false;
  /** PID of the rclone daemon this process started, so teardown kills only our own daemon. */
  private ownedDaemonPid: number | null = null;
  /** The directory that is currently (or was last) mounted. Starts as the preferred base. */
  private activeMountDir = MOUNT_BASE;
  /** Cache: { result, expiresAt } — avoids running `mount` on every API call. */
  private mountCache: { result: boolean; expiresAt: number } | null = null;
  /** In-flight `mount` call — all concurrent callers share the same subprocess. */
  private mountInFlight: Promise<string> | null = null;

  /**
   * Execute a subprocess with a hard timeout so calls cannot block forever.
   * Unlike execFile's built-in `timeout` option, this rejects on our own timer
   * regardless of whether the child actually exits — `diskutil unmount force`
   * against a busy-but-healthy FUSE mount can enter an uninterruptible kernel
   * wait where even SIGKILL never lets the process exit, which would otherwise
   * leave the returned promise (and everything awaiting it) hanging forever.
   */
  private execWithTimeout(command: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const child = execFile(command, args, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout);
      });

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // best-effort — process may already be unkillable (uninterruptible wait)
        }
        reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
    });
  }

  /** Signal that a mount-dependent API call just happened. Resets the inactivity timer. */
  recordActivity(): void {
    this.lastActivityAt = Date.now();
  }

  /** True if a process with this PID is currently running (EPERM still means alive). */
  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException)?.code === 'EPERM';
    }
  }

  /** Read the owning PID from the lockfile, or null if absent/unparseable. */
  private readLockOwner(): number | null {
    try {
      const raw = fs.readFileSync(OWNER_LOCK_PATH, 'utf8');
      const pid = JSON.parse(raw)?.pid;
      return Number.isInteger(pid) ? pid : null;
    } catch {
      return null;
    }
  }

  /**
   * Acquire the mount-ownership lock. Returns true if this process now owns the
   * mount lifecycle. Uses an atomic exclusive-create; a lock held by a dead PID is
   * reclaimed. Idempotent — re-acquiring when already owner is a no-op true.
   */
  private acquireOwnership(): boolean {
    if (this.isOwner) return true;

    try {
      fs.mkdirSync(MOUNTS_DIR, { recursive: true });
    } catch {
      // ignore — directory may already exist
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const fd = fs.openSync(OWNER_LOCK_PATH, 'wx');
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
        fs.closeSync(fd);
        this.isOwner = true;
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') {
          console.warn('[rclone-mount] Could not write ownership lock:', err);
          return false;
        }

        const owner = this.readLockOwner();
        if (owner === process.pid) {
          this.isOwner = true;
          return true;
        }
        if (owner !== null && this.isProcessAlive(owner)) {
          return false; // another live instance owns the mount
        }

        // Stale lock (owner is dead) — reclaim it and retry the create.
        console.warn(`[rclone-mount] Reclaiming stale ownership lock (dead pid ${owner ?? 'unknown'}).`);
        try {
          fs.unlinkSync(OWNER_LOCK_PATH);
        } catch {
          // lost the race to another reclaimer — loop and re-check
        }
      }
    }

    return false;
  }

  /** Release the ownership lock if we hold it. */
  private releaseOwnership(): void {
    if (!this.isOwner) return;
    if (this.readLockOwner() === process.pid) {
      try {
        fs.unlinkSync(OWNER_LOCK_PATH);
      } catch {
        // already gone
      }
    }
    this.isOwner = false;
  }

  /** Find the rclone daemon PID serving a specific mount dir (so we kill only our own). */
  private async findDaemonPid(dir: string): Promise<number | null> {
    try {
      const out = await this.execWithTimeout('pgrep', ['-f', `rclone mount ${REMOTE} ${dir}`], COMMAND_TIMEOUT_MS);
      const pid = parseInt(out.trim().split('\n')[0], 10);
      return Number.isInteger(pid) ? pid : null;
    } catch {
      return null;
    }
  }

  /**
   * Mountpoint check via device-ID comparison, run off the main thread with a hard timeout.
   * If the directory's device ID differs from its parent's, something is mounted on it.
   * If a stat() call doesn't return within STAT_TIMEOUT_MS, that alone doesn't mean the
   * mount is dead — rclone's vfs-cache can make stat() briefly slow under heavy I/O, and
   * force-unmounting a busy-but-healthy mount is exactly what wedges the whole VFS (the
   * `diskutil unmount force` call itself goes uninterruptible and never returns). So a
   * timeout is only treated as "stale" if no rclone daemon process is alive for this dir —
   * otherwise we report "active" and let the busy mount keep working.
   */
  private async isMountpointActive(dir: string): Promise<'active' | 'inactive' | 'stale'> {
    const dirStat = await statWithTimeout(dir);
    if (dirStat === STAT_TIMEOUT) {
      return (await this.findDaemonPid(dir)) !== null ? 'active' : 'stale';
    }
    if (dirStat === null) return 'inactive';

    const parentStat = await statWithTimeout(path.dirname(dir));
    if (parentStat === STAT_TIMEOUT) {
      return (await this.findDaemonPid(dir)) !== null ? 'active' : 'stale';
    }
    if (parentStat === null) return 'inactive';

    return dirStat.dev !== parentStat.dev ? 'active' : 'inactive';
  }

  /** Run `mount` with a hard timeout. Concurrent callers share one subprocess (singleton in-flight). */
  private runMount(): Promise<string> {
    if (this.mountInFlight) return this.mountInFlight;
    this.mountInFlight = this.execWithTimeout('mount', [], MOUNT_CHECK_TIMEOUT_MS).finally(() => {
      this.mountInFlight = null;
    });
    return this.mountInFlight;
  }

  /** Invalidate the mount cache (call after any mount/unmount operation). */
  private invalidateCache(): void {
    this.mountCache = null;
    this.mountInFlight = null;
  }

  /**
   * Check whether the FUSE mount is live.
   * Primary: device-ID stat check (timeout-protected, never blocks the event loop).
   * If the mountpoint is stale (dead daemon, unresponsive stat), self-heal by force-unmounting.
   * Falls back to cached `mount` command only when the stat check is inconclusive (dir missing).
   */
  async isMounted(): Promise<boolean> {
    const status = await this.isMountpointActive(this.activeMountDir);

    if (status === 'active') {
      // Update cache so the slow path isn't needed
      this.mountCache = { result: true, expiresAt: Date.now() + MOUNT_CACHE_TTL_MS };
      return true;
    }

    if (status === 'stale') {
      // Only the owning instance may force-unmount. A non-owner leaves the mount
      // alone (the owner's own self-heal / inactivity watcher will handle it).
      if (this.isOwner) {
        console.warn(`[rclone-mount] Detected stale mountpoint at ${this.activeMountDir} — force-unmounting to self-heal.`);
        await this.unmountAndKill();
      } else {
        console.warn(`[rclone-mount] Mountpoint at ${this.activeMountDir} looks stale but this instance does not own it — not touching it.`);
      }
      this.mountCache = { result: false, expiresAt: Date.now() + MOUNT_CACHE_TTL_MS };
      return false;
    }

    // Slow path: fall back to cached `mount` command output
    const now = Date.now();
    if (this.mountCache && now < this.mountCache.expiresAt) {
      return this.mountCache.result;
    }
    let result = false;
    try {
      const stdout = await this.runMount();
      result = stdout.includes(` on ${this.activeMountDir} (`);
    } catch {
      result = false;
    }
    this.mountCache = { result, expiresAt: now + MOUNT_CACHE_TTL_MS };
    return result;
  }

  /** Returns true if `dir` is still registered as a mountpoint (stale/stuck). Stale dirs are force-unmounted. */
  private async isDirStillMounted(dir: string): Promise<boolean> {
    const status = await this.isMountpointActive(dir);
    if (status === 'active') return true;
    if (status === 'stale') {
      console.warn(`[rclone-mount] Detected stale mountpoint at ${dir} — force-unmounting to self-heal.`);
      await this.unmountDir(dir);
      this.invalidateCache();
      return false;
    }
    // Fallback to mount command
    try {
      const stdout = await this.runMount();
      return stdout.includes(` on ${dir} (`);
    } catch {
      return false;
    }
  }

  private async unmountDir(dir: string): Promise<void> {
    try {
      await this.execWithTimeout('diskutil', ['unmount', 'force', dir], COMMAND_TIMEOUT_MS);
    } catch {
      try {
        await this.execWithTimeout('umount', ['-f', dir], COMMAND_TIMEOUT_MS);
      } catch {
        try {
          await this.execWithTimeout('fusermount', ['-u', '-z', dir], COMMAND_TIMEOUT_MS);
        } catch {
          // ignore — dir may not be mounted at all
        }
      }
    }
  }

  private async unmountAndKill(): Promise<void> {
    // Kill the daemon FIRST. Once the rclone process exits, macFUSE drops the
    // mount and `diskutil unmount force` (or the stat-based checks) on an
    // already-dead mount resolve quickly instead of blocking on a live FUSE
    // channel — which is what previously wedged the VFS for the whole machine.
    const pid = this.ownedDaemonPid ?? (await this.findDaemonPid(this.activeMountDir));
    if (pid !== null) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone — fine
      }
      await new Promise<void>((r) => setTimeout(r, 500));
      if (this.isProcessAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone — fine
        }
        await new Promise<void>((r) => setTimeout(r, 500));
      }
    }
    this.ownedDaemonPid = null;

    await this.unmountDir(this.activeMountDir);
    this.invalidateCache();
  }

  /**
   * Resolve which directory to mount into.
   * Prefers MOUNT_BASE; falls back to a timestamped sibling if macFUSE still holds MOUNT_BASE.
   */
  private async resolveMountDir(): Promise<string> {
    // If the base dir is not stuck, always prefer it
    if (!(await this.isDirStillMounted(MOUNT_BASE))) {
      return MOUNT_BASE;
    }
    // macFUSE still has MOUNT_BASE locked — pick a fresh sibling to avoid "Resource busy"
    const fallback = `${MOUNT_BASE}_${Date.now()}`;
    console.warn(`[rclone-mount] ${MOUNT_BASE} is stale-locked by macFUSE — falling back to ${fallback}`);
    return fallback;
  }

  /** Remove any stale sibling dirs left by previous fallback attempts (not currently mounted). */
  private async cleanStaleSiblings(): Promise<void> {
    try {
      const entries = fs.readdirSync(MOUNTS_DIR);
      for (const entry of entries) {
        // Match hetzner_<digits> pattern — these are old fallback dirs
        if (!/^hetzner_\d+$/.test(entry)) continue;
        const fullPath = path.join(MOUNTS_DIR, entry);
        if (await this.isDirStillMounted(fullPath)) continue; // still in use — skip
        try {
          fs.rmdirSync(fullPath); // only removes if empty (FUSE dirs are always empty after unmount)
        } catch {
          // non-empty or already gone — ignore
        }
      }
    } catch {
      // MOUNTS_DIR may not exist yet
    }
  }

  private updateSymlink(target: string): void {
    try {
      const stat = fs.lstatSync(SYMLINK_PATH);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(SYMLINK_PATH);
      } else if (stat.isDirectory()) {
        const entries = fs.readdirSync(SYMLINK_PATH);
        if (entries.length === 0) {
          fs.rmdirSync(SYMLINK_PATH);
        } else {
          const backupPath = `${SYMLINK_PATH}.backup-${Date.now()}`;
          fs.renameSync(SYMLINK_PATH, backupPath);
          console.warn(`[rclone-mount] Existing directory at ${SYMLINK_PATH} was moved to ${backupPath} so symlink can be created.`);
        }
      } else {
        const backupPath = `${SYMLINK_PATH}.backup-${Date.now()}`;
        fs.renameSync(SYMLINK_PATH, backupPath);
        console.warn(`[rclone-mount] Existing file at ${SYMLINK_PATH} was moved to ${backupPath} so symlink can be created.`);
      }
    } catch {
      // doesn't exist yet — no action needed
    }

    try {
      fs.symlinkSync(target, SYMLINK_PATH);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[rclone-mount] Failed to create symlink ${SYMLINK_PATH} -> ${target}: ${msg}`);
    }
  }

  private startInactivityWatcher(): void {
    if (this.watcherTimer) return;
    this.watcherTimer = setInterval(async () => {
      const mounted = await this.isMounted();
      if (!mounted) {
        this.clearWatcher();
        return;
      }
      const idleMs = Date.now() - this.lastActivityAt;
      if (idleMs >= INACTIVITY_MS) {
        console.log(
          `[rclone-mount] Inactivity timeout (${Math.round(idleMs / 1000)}s idle) — stopping mount`
        );
        await this.stop();
      }
    }, CHECK_INTERVAL_MS);
    // Allow the Node process to exit even if this timer is still running
    this.watcherTimer.unref?.();
  }

  private clearWatcher(): void {
    if (this.watcherTimer) {
      clearInterval(this.watcherTimer);
      this.watcherTimer = null;
    }
  }

  /** Cleanly unmount and tear down the symlink. Safe to call even when not mounted. */
  async stop(): Promise<void> {
    this.clearWatcher();

    // Only the owner may unmount/kill and tear down the shared symlink. A non-owner
    // just stops its watcher and drops its adopted reference.
    if (this.isOwner) {
      await this.unmountAndKill();
      await this.cleanStaleSiblings();
      try {
        const stat = fs.lstatSync(SYMLINK_PATH);
        if (stat.isSymbolicLink()) fs.unlinkSync(SYMLINK_PATH);
      } catch {
        // already gone
      }
      this.releaseOwnership();
    }

    this.activeMountDir = MOUNT_BASE; // reset for next mount attempt
    console.log('[rclone-mount] Mount stopped.');
  }

  /**
   * Ensure rclone is mounted. Starts the daemon if needed.
   * Calling recordActivity() before returning so the inactivity clock starts fresh.
   */
  async ensureRunning(): Promise<MountResult> {
    // Non-destructive liveness check first — never unmount another instance's mount.
    if ((await this.isMountpointActive(this.activeMountDir)) === 'active') {
      // The mount is already up. Adopt it; become owner only if nobody live holds
      // the lock (e.g. it was started by a prior owner that has since exited).
      this.acquireOwnership();
      this.recordActivity();
      if (this.isOwner) {
        this.invalidateCache();
        this.updateSymlink(this.activeMountDir);
        this.startInactivityWatcher();
      }
      return { mounted: true, status: 'mounted', message: 'rclone mount is ready', mountDir: SYMLINK_PATH };
    }

    // Not mounted. Only the owner may bring it up; a second instance waits.
    if (!this.acquireOwnership()) {
      return {
        mounted: false,
        status: 'mounting',
        message: 'another instance is bringing up the rclone mount',
        mountDir: SYMLINK_PATH,
      };
    }

    if (this.starting) {
      if (this.startingSince && (Date.now() - this.startingSince) > START_GUARD_TIMEOUT_MS) {
        console.warn('[rclone-mount] Previous startup attempt appears stuck; resetting start guard and retrying.');
        this.starting = false;
        this.startingSince = null;
      }

      if (this.starting) {
        // Even while starting, the daemon may have already come up (e.g. it was running before
        // the backend restarted). Do a fast stat check before returning "mounting".
        if ((await this.isMountpointActive(this.activeMountDir)) === 'active') {
          this.starting = false;
          this.startingSince = null;
          this.invalidateCache();
          this.updateSymlink(this.activeMountDir);
          this.recordActivity();
          this.startInactivityWatcher();
          return { mounted: true, status: 'mounted', message: 'rclone mount is ready', mountDir: SYMLINK_PATH };
        }
        return { mounted: false, status: 'mounting', message: 'rclone mount is already starting', mountDir: SYMLINK_PATH };
      }
    }

    this.starting = true;
    this.startingSince = Date.now();
    try {
      // Attempt to clean up any stale / busy mountpoint first
      await this.unmountAndKill();
      await new Promise<void>((r) => setTimeout(r, 500));

      // If macFUSE still holds the preferred dir, fall back to a timestamped sibling
      const mountDir = await this.resolveMountDir();
      this.activeMountDir = mountDir;
      fs.mkdirSync(mountDir, { recursive: true });

      const rcloneBinary = getRclonePath();
      if (!rcloneBinary) {
        return {
          mounted: false,
          status: 'error',
          message: 'rclone binary not found. Install rclone or add it to PATH.',
          mountDir: SYMLINK_PATH,
        };
      }

      console.log(`[rclone-mount] Launching rclone daemon: ${rcloneBinary} ${REMOTE} → ${mountDir}`);

      await this.execWithTimeout(rcloneBinary, [
        'mount', REMOTE, mountDir,
        '--daemon',
        '--allow-other',
        '--allow-non-empty',
        '--dir-cache-time', '24h',
        '--poll-interval', '30s',
        '--fast-list',
        '--vfs-cache-mode', 'full',
        '--vfs-cache-max-age', '1h',
        '--vfs-cache-max-size', '10G',
        '--vfs-cache-poll-interval', '1m',
        '--vfs-read-ahead', '256M',
        '--vfs-read-chunk-size', '4M',
        '--vfs-read-chunk-size-limit', '256M',
        '--buffer-size', '256M',
        '--cache-dir', CACHE_DIR,
        '--transfers', '8',
        '--checkers', '16',
        '--multi-thread-streams', '4',
        '--multi-thread-cutoff', '16M',
        '--no-modtime',
        '--log-level', 'INFO',
      ], MOUNT_START_TIMEOUT_MS);

      // Poll until the FUSE mount appears (rclone daemon may take a few seconds)
      for (let i = 0; i < 20; i++) {
        await new Promise<void>((r) => setTimeout(r, 1000));
        if (await this.isMounted()) {
          // Record the daemon PID so teardown targets only our own process.
          this.ownedDaemonPid = await this.findDaemonPid(mountDir);
          this.updateSymlink(mountDir);
          this.recordActivity();
          this.startInactivityWatcher();
          console.log('[rclone-mount] Mount is ready.');
          return { mounted: true, status: 'mounted', message: 'rclone mount is ready', mountDir: SYMLINK_PATH };
        }
      }

      console.warn('[rclone-mount] Daemon launched but mount not visible yet.');
      return {
        mounted: false,
        status: 'mounting',
        message: 'rclone daemon started; mount is not ready yet — retry in a moment',
        mountDir: SYMLINK_PATH,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[rclone-mount] Failed to start:', msg);
      return { mounted: false, status: 'error', message: msg, mountDir: SYMLINK_PATH };
    } finally {
      this.starting = false;
      this.startingSince = null;
    }
  }

  /** Called from backend index.ts on startup. Failures are logged but do not crash the server. */
  async startOnInit(): Promise<void> {
    console.log('[rclone-mount] Auto-starting on backend init…');
    try {
      const result = await this.ensureRunning();
      console.log(`[rclone-mount] Init result: ${result.status} — ${result.message}`);
    } catch (err) {
      console.error('[rclone-mount] Non-fatal init error:', err);
    }
  }

  /** Called from backend index.ts on graceful shutdown. */
  async shutdown(): Promise<void> {
    await this.stop();
  }
}

export const rcloneMountService = new RcloneMountService();
