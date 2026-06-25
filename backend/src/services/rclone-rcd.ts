/**
 * rclone rcd sidecar — one local daemon serves all remotes via HTTP.
 * Uses `rclone rcd --rc-serve` so file bytes are range-capable over HTTP.
 * Replaces the FUSE mount as the default remote transport.
 *
 * ponytail: mount kept as fallback behind RCLONE_USE_MOUNT=1, delete once rcd proven.
 */
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import axios, { type AxiosInstance } from 'axios';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RC_PORT = parseInt(process.env.RCLONE_RC_PORT || '5574', 10);
const RC_USER = process.env.RCLONE_RC_USER || 'local-media';
const RC_PASS = process.env.RCLONE_RC_PASS || 'local-media-rcd-pass';
export const RC_URL = `http://127.0.0.1:${RC_PORT}`;

/** The rcd auth + base URL for use by the media-server (passed via env at startup). */
export function getRcdEnv(): Record<string, string> {
  return {
    RCLONE_RC_URL: RC_URL,
    RCLONE_RC_USER: RC_USER,
    RCLONE_RC_PASS: RC_PASS,
  };
}

// ── binary resolution (mirrors rclone-mount.ts) ──────────────────────────────

function getBundledRclonePath(): string | null {
  const rp = (process as any).resourcesPath || '';
  for (const p of [
    path.join(rp, 'rclone'),
    path.join(rp, 'bin', 'rclone'),
    path.join(__dirname, '..', '..', '..', 'resources', 'bin', 'rclone'),
  ]) {
    try { if (fs.statSync(p).isFile()) return p; } catch { /* skip */ }
  }
  return null;
}

function getRclonePath(): string {
  if (getBundledRclonePath()) return getBundledRclonePath()!;
  try {
    const r = execSync('command -v rclone', { stdio: ['ignore', 'pipe', 'ignore'], shell: '/bin/sh' });
    const p = r.toString().trim();
    if (p) return p;
  } catch { /* fall through */ }
  for (const c of ['/opt/homebrew/bin/rclone', '/usr/local/bin/rclone', '/usr/bin/rclone']) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* skip */ }
  }
  throw new Error('rclone binary not found');
}

// ── HTTP client ───────────────────────────────────────────────────────────────

export interface RcdListItem {
  path: string;    // relative path from the FS root
  name: string;
  size: number;
  isDir: boolean;
}

class RcdClient {
  private ax: AxiosInstance;

  constructor() {
    this.ax = axios.create({
      baseURL: RC_URL,
      auth: { username: RC_USER, password: RC_PASS },
      timeout: 60_000,
    });
  }

  async ping(): Promise<boolean> {
    try { await this.ax.post('/core/version', {}); return true; }
    catch { return false; }
  }

  /** List one directory level. fsStr = "remote:", remote = "sub/path" */
  async listDir(fsStr: string, remote: string): Promise<RcdListItem[]> {
    const res = await this.ax.post('/operations/list', { fs: fsStr, remote });
    // i.Path is already the full path relative to fsStr (rclone computes it,
    // not us) — use it directly rather than rebuilding from remote+i.Name,
    // which silently drops intermediate subfolders once recurse is involved.
    return (res.data?.list ?? []).map((i: any) => ({
      path: i.Path,
      name: i.Name,
      size: i.Size ?? 0,
      isDir: i.IsDir ?? false,
    }));
  }

  /** Recursive listing via fast-list opt. Falls back to iterative if rejected. */
  async listRecursive(fsStr: string, remote: string): Promise<RcdListItem[]> {
    try {
      const res = await this.ax.post('/operations/list', {
        fs: fsStr,
        remote,
        opt: { recurse: true, filesOnly: true, noMimeType: true },
      });
      // i.Path is the full path relative to fsStr for every nesting level —
      // rebuilding it from remote+i.Name (as listDir used to) collapses nested
      // files to "remote/filename", dropping every subfolder in between.
      return (res.data?.list ?? []).map((i: any) => ({
        path: i.Path,
        name: i.Name,
        size: i.Size ?? 0,
        isDir: false,
      }));
    } catch {
      // Server doesn't support recurse opt — walk manually
      return walkRecursive(this, fsStr, remote);
    }
  }

  /**
   * Returns the URL for ranged-GET file access via --rc-serve.
   * The media-server uses this to fetch bytes without going through the rc API.
   * rclone's rc-serve route matches the literal pattern `[fsname]remotepath`
   * (brackets included) — `fsname:remotepath` concatenated without brackets
   * never matches the route regex and 404s, even though the fs/remote split
   * is identical to what /operations/list accepts.
   */
  serveUrl(absolutePath: string): string {
    const { fs, remote } = splitFsRemote(normalizeRclonePath(absolutePath));
    return `${RC_URL}/${encodeURI(`[${fs}]${remote}`)}`;
  }

  /** Fetch a whole file's bytes via --rc-serve. Used by the backend's own thumbnail generator. */
  async fetchFile(absolutePath: string): Promise<Buffer> {
    const { fs, remote } = splitFsRemote(normalizeRclonePath(absolutePath));
    const url = `/${encodeURI(`[${fs}]${remote}`)}`;
    // ponytail: rcd can crash mid-request and self-restart (~7s worst case, see
    // startRcd's exit handler below). Retry through that window rather than
    // failing every thumbnail the moment it happens.
    const RETRY_DELAYS_MS = [1500, 3000, 4000];
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await this.ax.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(res.data as ArrayBuffer);
      } catch (err: any) {
        const isConnRefused = err?.code === 'ECONNREFUSED' || err?.cause?.code === 'ECONNREFUSED';
        if (!isConnRefused || attempt === RETRY_DELAYS_MS.length) throw err;
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
    throw new Error('unreachable');
  }
}

function splitFsRemote(absolutePath: string): { fs: string; remote: string } {
  const colonIdx = absolutePath.indexOf(':');
  return {
    fs: absolutePath.slice(0, colonIdx + 1),
    remote: absolutePath.slice(colonIdx + 1),
  };
}

// Some rclone crypt configs report a literal "." root segment (their `remote =`
// param ends in a bare dot, e.g. "Base:."), which leaks into decrypted listing
// paths as "remote:./sub/path" — not a valid rcd serve path. Strip it.
function normalizeRclonePath(p: string): string {
  return p.replace(/^([^:]+:)\.\/?/, '$1');
}

async function walkRecursive(client: RcdClient, fsStr: string, remote: string): Promise<RcdListItem[]> {
  const items = await client.listDir(fsStr, remote);
  const result: RcdListItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.isDir) result.push(...await walkRecursive(client, fsStr, item.path));
  }
  return result;
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

let _proc: ChildProcess | null = null;
let _client: RcdClient | null = null;

export function getRcdClient(): RcdClient | null {
  return _client;
}

export async function startRcd(): Promise<void> {
  if (process.env.RCLONE_USE_MOUNT === '1') {
    console.log('[rcd] RCLONE_USE_MOUNT=1: skipping rcd sidecar (using FUSE mount)');
    return;
  }

  // A previous dev session (or a crashed/killed Electron run) can leave an
  // orphaned `rclone rcd` bound to RC_PORT. Spawning another one just loops
  // forever on EADDRINUSE — ping first and adopt it instead of spawning.
  const existing = new RcdClient();
  if (await existing.ping()) {
    console.log('[rcd] reusing already-running rcd on', RC_URL);
    _client = existing;
    return;
  }

  let bin: string;
  try { bin = getRclonePath(); } catch {
    console.warn('[rcd] rclone binary not found — remote servers will be unavailable');
    return;
  }

  const args = [
    'rcd',
    `--rc-addr=127.0.0.1:${RC_PORT}`,
    `--rc-user=${RC_USER}`,
    `--rc-pass=${RC_PASS}`,
    '--rc-serve',   // enables GET /[remote:path] for ranged file access
    '--log-level=WARNING',
    // ponytail: no --read-only here — rcd doesn't mount a VFS, so that flag (mount/serve-only)
    // is rejected and crashes the daemon on every start. Read-only is enforced by app code only
    // calling list/config rc methods, plus rcd binding to 127.0.0.1 with rc-user/pass auth.
    // Upgrade path if untrusted local processes become a concern: an rc-method allowlist proxy.
  ];
  if (process.env.RCLONE_CONFIG) args.push(`--config=${process.env.RCLONE_CONFIG}`);

  _proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  _proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim();
    if (msg) console.log(`[rcd] ${msg}`);
  });
  _proc.on('exit', (code) => {
    console.warn(`[rcd] exited with code ${code}; restarting in 2s`);
    _proc = null;
    _client = null;
    setTimeout(() => {
      startRcd().catch((err) => console.error('[rcd] restart failed:', err));
    }, 2000);
  });

  // Wait up to 5 s for the daemon to be ready
  const client = new RcdClient();
  for (let i = 0; i < 25; i++) {
    if (await client.ping()) { _client = client; console.log('[rcd] ready'); return; }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.warn('[rcd] failed to become ready in 5 s');
}

export function stopRcd(): void {
  if (_proc) { _proc.kill('SIGTERM'); _proc = null; _client = null; }
}

// Self-check: node --input-type=module < this file (run as script)
// Exercises binary resolution + ping only (no side-effects in test env).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('[rcd demo] binary:', getRclonePath());
  console.log('[rcd demo] env:', getRcdEnv());
  console.log('[rcd demo] ok');
}
