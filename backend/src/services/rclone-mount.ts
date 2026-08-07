/**
 * RcloneMountService — manages one rclone FUSE mount per remote_servers row.
 *
 * Design (per-server instance, generalized from a former single-remote singleton):
 *  - Spawns `rclone mount` detached ourselves (no `--daemon`) and tracks the child pid directly —
 *    rclone's own --daemon self-fork is flaky on macOS even when the identical foreground mount works.
 *  - Each server gets its own mountpoint at $HOME/.rclone-mounts/<serverId> — a stable,
 *    user-owned directory that is never cleaned by macOS periodic scripts (unlike /tmp) and
 *    survives reboots.
 *  - If macFUSE refuses to release the preferred dir (stale lock), a timestamped sibling
 *    (~/.rclone-mounts/<serverId>_<epoch>) is used as fallback.
 *    Old stale sibling dirs are cleaned up when stop() runs.
 *  - Activity is tracked via recordActivity(); any rclone API call should invoke it.
 *  - An inactivity watcher fires every 60 s and calls stop() after 30 min of silence.
 *  - stop() uses `umount -f` (macOS) / `fusermount -u` (Linux) which causes the daemon to exit.
 *  - rcloneMountManager (bottom of file) is the public surface — it owns one instance per
 *    serverId and is what the rest of the backend should import.
 */

import { execFile, execFileSync, execSync, spawn } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const MOUNTS_DIR = path.join(os.homedir(), '.rclone-mounts');
const RCLONE_CACHE_BASE = process.env.RCLONE_CACHE_DIR ?? path.join(os.homedir(), 'rclone-cache');

const INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes
const CHECK_INTERVAL_MS = 60 * 1000; // check every 60 s
const MOUNT_CHECK_TIMEOUT_MS = 2000; // max time to wait for `mount` command
const MOUNT_CACHE_TTL_MS = 5000; // cache positive/negative result for 5 s
const COMMAND_TIMEOUT_MS = 3000; // timeout for unmount/kill commands
const STAT_TIMEOUT_MS = 1500; // max time to wait for a (possibly stale-FUSE) stat() call
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

/** Manages the FUSE mount lifecycle for a single remote_servers row. */
class RcloneMountService {
  private readonly serverId: string;
  private readonly remote: string;
  private readonly mountBase: string;
  private readonly ownerLockPath: string;
  private readonly cacheDir: string;
  private readonly siblingPrefix: RegExp;

  private lastActivityAt = 0;
  private watcherTimer: ReturnType<typeof setInterval> | null = null;
  private starting = false;
  private startingSince: number | null = null;
  /** True when THIS process holds the ownership lock and may manage the mount lifecycle. */
  private isOwner = false;
  /** PID of the rclone daemon this process started, so teardown kills only our own daemon. */
  private ownedDaemonPid: number | null = null;
  /** The directory that is currently (or was last) mounted. Starts as the preferred base. */
  private activeMountDir: string;
  /** Cache: { result, expiresAt } — avoids running `mount` on every API call. */
  private mountCache: { result: boolean; expiresAt: number } | null = null;
  /** In-flight `mount` call — all concurrent callers share the same subprocess. */
  private mountInFlight: Promise<string> | null = null;

  constructor(serverId: string, remote: string) {
    this.serverId = serverId;
    this.remote = remote;
    this.mountBase = path.join(MOUNTS_DIR, serverId);
    this.activeMountDir = this.mountBase;
    this.ownerLockPath = path.join(MOUNTS_DIR, `.owner-${serverId}.lock`);
    this.cacheDir = path.join(RCLONE_CACHE_BASE, serverId);
    this.siblingPrefix = new RegExp(`^${serverId}_\\d+$`);
  }

  /**
   * Directory other code should read mounted files from. Usually `mountBase`,
   * but if a busy-retry fell back to a timestamped sibling dir, that's the one
   * actually mounted — report it instead so token/thumbnail path resolution
   * doesn't point at an empty directory.
   */
  getMountDir(): string {
    return this.activeMountDir;
  }

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
      const raw = fs.readFileSync(this.ownerLockPath, 'utf8');
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
        const fd = fs.openSync(this.ownerLockPath, 'wx');
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
        fs.closeSync(fd);
        this.isOwner = true;
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') {
          console.warn(`[rclone-mount:${this.serverId}] Could not write ownership lock:`, err);
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
        console.warn(`[rclone-mount:${this.serverId}] Reclaiming stale ownership lock (dead pid ${owner ?? 'unknown'}).`);
        try {
          fs.unlinkSync(this.ownerLockPath);
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
        fs.unlinkSync(this.ownerLockPath);
      } catch {
        // already gone
      }
    }
    this.isOwner = false;
  }

  /** Find the rclone daemon PID serving a specific mount dir (so we kill only our own). */
  private async findDaemonPid(dir: string): Promise<number | null> {
    try {
      const out = await this.execWithTimeout('pgrep', ['-f', `rclone mount ${this.remote} ${dir}`], COMMAND_TIMEOUT_MS);
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
        console.warn(`[rclone-mount:${this.serverId}] Detected stale mountpoint at ${this.activeMountDir} — force-unmounting to self-heal.`);
        await this.unmountAndKill();
      } else {
        console.warn(`[rclone-mount:${this.serverId}] Mountpoint at ${this.activeMountDir} looks stale but this instance does not own it — not touching it.`);
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
      console.warn(`[rclone-mount:${this.serverId}] Detected stale mountpoint at ${dir} — force-unmounting to self-heal.`);
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
   * Prefers mountBase; falls back to a timestamped sibling if macFUSE still holds mountBase.
   */
  private async resolveMountDir(): Promise<string> {
    // If the base dir is not stuck, always prefer it
    if (!(await this.isDirStillMounted(this.mountBase))) {
      return this.mountBase;
    }
    // macFUSE still has mountBase locked — pick a fresh sibling to avoid "Resource busy"
    const fallback = `${this.mountBase}_${Date.now()}`;
    console.warn(`[rclone-mount:${this.serverId}] ${this.mountBase} is stale-locked by macFUSE — falling back to ${fallback}`);
    return fallback;
  }

  /** Remove any stale sibling dirs left by previous fallback attempts (not currently mounted). */
  private async cleanStaleSiblings(): Promise<void> {
    try {
      const entries = fs.readdirSync(MOUNTS_DIR);
      for (const entry of entries) {
        if (!this.siblingPrefix.test(entry)) continue;
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
          `[rclone-mount:${this.serverId}] Inactivity timeout (${Math.round(idleMs / 1000)}s idle) — stopping mount`
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

  /** Cleanly unmount. Safe to call even when not mounted. */
  async stop(): Promise<void> {
    this.clearWatcher();

    // Only the owner may unmount/kill. A non-owner just stops its watcher and
    // drops its adopted reference.
    if (this.isOwner) {
      await this.unmountAndKill();
      await this.cleanStaleSiblings();
      this.releaseOwnership();
    }

    this.activeMountDir = this.mountBase; // reset for next mount attempt
    console.log(`[rclone-mount:${this.serverId}] Mount stopped.`);
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
        this.startInactivityWatcher();
      }
      return { mounted: true, status: 'mounted', message: 'rclone mount is ready', mountDir: this.activeMountDir };
    }

    // Not mounted. Only the owner may bring it up; a second instance waits.
    if (!this.acquireOwnership()) {
      return {
        mounted: false,
        status: 'mounting',
        message: 'another instance is bringing up the rclone mount',
        mountDir: this.activeMountDir,
      };
    }

    if (this.starting) {
      if (this.startingSince && (Date.now() - this.startingSince) > START_GUARD_TIMEOUT_MS) {
        console.warn(`[rclone-mount:${this.serverId}] Previous startup attempt appears stuck; resetting start guard and retrying.`);
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
          this.recordActivity();
          this.startInactivityWatcher();
          return { mounted: true, status: 'mounted', message: 'rclone mount is ready', mountDir: this.activeMountDir };
        }
        return { mounted: false, status: 'mounting', message: 'rclone mount is already starting', mountDir: this.activeMountDir };
      }
    }

    this.starting = true;
    this.startingSince = Date.now();
    try {
      // Attempt to clean up any stale / busy mountpoint first
      await this.unmountAndKill();
      await new Promise<void>((r) => setTimeout(r, 500));

      const rcloneBinary = getRclonePath();
      if (!rcloneBinary) {
        return {
          mounted: false,
          status: 'error',
          message: 'rclone binary not found. Install rclone or add it to PATH.',
          mountDir: this.activeMountDir,
        };
      }

      // If macFUSE still holds the preferred dir, fall back to a timestamped sibling.
      // mount_macfuse can also report "Resource busy" on the underlying /dev/macfuseN
      // device on a dir that LOOKS free (a previous crashed daemon hadn't released it
      // yet) — spawnAndWait() detects that case and we retry with a fresh sibling dir
      // a few more times rather than giving up on the very first attempt.
      let mountDir = await this.resolveMountDir();
      const MAX_BUSY_RETRIES = 3;

      for (let attempt = 0; ; attempt++) {
        this.activeMountDir = mountDir;
        fs.mkdirSync(mountDir, { recursive: true });

        const result = await this.spawnAndWait(rcloneBinary, mountDir);

        if (result.outcome === 'mounted') {
          this.recordActivity();
          this.startInactivityWatcher();
          console.log(`[rclone-mount:${this.serverId}] Mount is ready.`);
          return { mounted: true, status: 'mounted', message: 'rclone mount is ready', mountDir: this.activeMountDir };
        }

        if (result.outcome === 'busy' && attempt < MAX_BUSY_RETRIES) {
          mountDir = `${this.mountBase}_${Date.now()}`;
          console.warn(`[rclone-mount:${this.serverId}] Mountpoint reported busy — retrying with fresh dir ${mountDir} (attempt ${attempt + 2}/${MAX_BUSY_RETRIES + 1}).`);
          continue;
        }

        if (result.outcome === 'failed') {
          return { mounted: false, status: 'error', message: result.message, mountDir: this.activeMountDir };
        }

        // 'timeout', or 'busy' with retries exhausted
        console.warn(`[rclone-mount:${this.serverId}] Daemon launched but mount not visible yet.`);
        return {
          mounted: false,
          status: 'mounting',
          message: 'rclone daemon started; mount is not ready yet — retry in a moment',
          mountDir: this.activeMountDir,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[rclone-mount:${this.serverId}] Failed to start:`, msg);
      return { mounted: false, status: 'error', message: msg, mountDir: this.activeMountDir };
    } finally {
      this.starting = false;
      this.startingSince = null;
    }
  }

  /**
   * Spawn the rclone mount daemon into `mountDir` and wait up to 20s for it to come up.
   * Watches stderr for macFUSE's "Resource busy" device-contention error and the child's
   * own exit so a doomed attempt is detected well before the 20s timeout.
   */
  private async spawnAndWait(
    rcloneBinary: string,
    mountDir: string
  ): Promise<{ outcome: 'mounted' } | { outcome: 'busy' } | { outcome: 'failed'; message: string } | { outcome: 'timeout' }> {
    console.log(`[rclone-mount:${this.serverId}] Launching rclone daemon: ${rcloneBinary} ${this.remote} → ${mountDir}`);

    // ponytail: rclone's own --daemon self-fork is flaky on macOS (observed: "Daemon timed out",
    // exits with code 1) even though the identical mount succeeds in the foreground. Spawn it
    // ourselves detached instead and track the child pid directly — same pattern as rclone-rcd.ts.
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const child = spawn(rcloneBinary, [
      'mount', this.remote, mountDir,
      '--allow-other',
      '--allow-non-empty',
      '--dir-cache-time', '24h',
      '--poll-interval', '30s',
      '--fast-list',
      '--vfs-cache-mode', 'full',
      '--vfs-cache-max-age', '24h',
      '--vfs-cache-max-size', '10G',
      '--vfs-cache-poll-interval', '5m',
      '--vfs-read-ahead', '64M',
      '--vfs-read-chunk-size', '512k',
      '--vfs-read-chunk-size-limit', '128M',
      '--vfs-fast-fingerprint',
      '--buffer-size', '64M',
      '--cache-dir', this.cacheDir,
      '--transfers', '4',
      '--checkers', '8',
      '--multi-thread-streams', '4',
      '--multi-thread-cutoff', '16M',
      '--no-modtime',
      '--log-level', 'INFO',
    ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.unref();

    let sawBusy = false;
    let hasExited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    child.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) console.log(`[rclone-mount:${this.serverId}] ${msg}`);
      if (/resource busy/i.test(msg)) sawBusy = true;
    });
    child.once('exit', (code, signal) => {
      hasExited = true;
      exitCode = code;
      exitSignal = signal;
    });
    this.ownedDaemonPid = child.pid ?? null;

    // Poll until the FUSE mount appears (the process may take a few seconds to mount)
    for (let i = 0; i < 20; i++) {
      await new Promise<void>((r) => setTimeout(r, 1000));
      if (await this.isMounted()) {
        return { outcome: 'mounted' };
      }
      if (hasExited) {
        if (sawBusy) return { outcome: 'busy' };
        return { outcome: 'failed', message: `rclone exited (code ${exitCode}, signal ${exitSignal}) before the mount appeared` };
      }
    }
    return { outcome: 'timeout' };
  }

  /** Called from backend index.ts on graceful shutdown. */
  async shutdown(): Promise<void> {
    await this.stop();
  }
}

/**
 * Public surface — one RcloneMountService per serverId, created lazily on first use.
 * `remote` should be `connection.cryptRemoteName ?? connection.remoteName` (the rclone
 * config entry that `provisionRemotes()` already created for this server).
 */
class RcloneMountManager {
  private instances = new Map<string, RcloneMountService>();

  private getOrCreate(serverId: string, remote: string): RcloneMountService {
    let instance = this.instances.get(serverId);
    if (!instance) {
      instance = new RcloneMountService(serverId, remote);
      this.instances.set(serverId, instance);
    }
    return instance;
  }

  async ensureRunning(serverId: string, remote: string): Promise<MountResult> {
    return this.getOrCreate(serverId, remote).ensureRunning();
  }

  async stop(serverId: string): Promise<void> {
    const instance = this.instances.get(serverId);
    if (!instance) return;
    await instance.stop();
    this.instances.delete(serverId);
  }

  async isMounted(serverId: string): Promise<boolean> {
    const instance = this.instances.get(serverId);
    if (!instance) return false;
    return instance.isMounted();
  }

  recordActivity(serverId: string): void {
    this.instances.get(serverId)?.recordActivity();
  }

  /**
   * The directory mounted files actually live under. Reflects the live instance's
   * active mount dir (which may be a busy-retry sibling, not the deterministic
   * base) when one exists; falls back to the deterministic base path otherwise —
   * callers should `ensureRunning()` first for an accurate answer.
   */
  getMountDir(serverId: string): string {
    return this.instances.get(serverId)?.getMountDir() ?? path.join(MOUNTS_DIR, serverId);
  }

  /**
   * Resolve a stored `{remoteName}:{relativePath}` value (see rclone.provider.ts) to its
   * absolute path on disk under this server's mount. Pure, no I/O.
   */
  resolveLocalPath(serverId: string, remotePath: string): string {
    const relPath = remotePath.slice(remotePath.indexOf(':') + 1);
    return path.join(this.getMountDir(serverId), relPath);
  }

  async shutdownAll(): Promise<void> {
    await Promise.all(Array.from(this.instances.values()).map((i) => i.shutdown()));
    this.instances.clear();
  }
}

export const rcloneMountManager = new RcloneMountManager();
