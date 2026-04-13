/**
 * Rclone routes - handles remote source management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID, createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import mime from 'mime-types';
import { getDatabase } from '../db/index.js';
import {
  listRemotes,
  validateRemote,
  getRemoteType,
  encryptRcloneConfig,
  isRcloneAvailable,
  scanRemoteForMedia,
} from '../services/rclone.js';
import { enqueueIndexingJob } from '../queue/index.js';

interface AddRcloneSourceBody {
  remote_name: string;
  base_path: string;
  remote_type: string;
  credentials?: Record<string, string>;
  use_crypt?: boolean;
  crypt_password?: string;
}

interface ValidateRcloneBody {
  remote_path: string;
}

interface RcloneRemoteInfo {
  name: string;
  type: string;
}

interface ScannedRemoteFile {
  absolutePath: string;
  relativePathFromRoot: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string | null;
  extension: string | null;
  mediaKind: 'image' | 'video';
  contentHash: string;
  fileKey: string;
  folderRelativePath: string;
}

interface FolderRecord {
  id: string;
  parentFolderId: string | null;
  absolutePath: string;
  relativePathFromRoot: string;
  name: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');
const mountDir = process.env.RCLONE_MOUNT_DIR || path.join(process.env.HOME || '', 'hetzner_mount');

function runCommand(command: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function isMountActive(): Promise<boolean> {
  // Primary check: mount table
  try {
    const { stdout } = await runCommand('mount', []);
    if (stdout.includes(` on ${mountDir} (`)) return true;
  } catch {
    // ignore
  }
  // Fallback: rclone process running and directory is a non-empty/accessible mountpoint
  try {
    await runCommand('pgrep', ['-f', 'rclone mount hetzner-crypt']);
    // pgrep exits 0 only when a match is found
    const { stdout } = await runCommand('ls', [mountDir]);
    // If ls returns at least something the vfs is responsive
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function getPm2RcloneStatus(): Promise<string | null> {
  try {
    const { stdout } = await runCommand('pm2', ['jlist'], projectRoot);
    const processList = JSON.parse(stdout) as Array<{ name?: string; pm2_env?: { status?: string } }>;
    const process = processList.find((item) => item.name === 'rclone-mount');
    return process?.pm2_env?.status || null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function ensureMountRunning(): Promise<{ mounted: boolean; status: 'mounted' | 'mounting' | 'error'; message: string }> {
  const mounted = await isMountActive();
  if (mounted) {
    return { mounted: true, status: 'mounted', message: 'rclone mount is ready' };
  }

  const pm2Status = await getPm2RcloneStatus();

  if (pm2Status === null) {
    // Process not yet registered in PM2 — load from ecosystem config
    try {
      await runCommand('pm2', ['start', 'ecosystem.config.cjs', '--only', 'rclone-mount'], projectRoot);
    } catch {
      return { mounted: false, status: 'error', message: 'Failed to register rclone-mount in PM2' };
    }
  } else if (pm2Status === 'stopped' || pm2Status === 'errored') {
    // Already registered but not running — restart it
    try {
      await runCommand('pm2', ['restart', 'rclone-mount'], projectRoot);
    } catch {
      return { mounted: false, status: 'error', message: 'Failed to restart rclone-mount via PM2' };
    }
  }
  // pm2Status === 'online' or 'launching': process is already starting, just wait

  for (let i = 0; i < 20; i += 1) {
    await delay(1000);
    if (await isMountActive()) {
      return { mounted: true, status: 'mounted', message: 'rclone mount is ready' };
    }
  }

  return { mounted: false, status: 'mounting', message: 'rclone is starting; mount is not ready yet' };
}

function normalizeSegment(input: string): string {
  return input.trim().replace(/^\/+|\/+$/g, '');
}

function createRcloneSourcePrefix(remoteName: string, basePath: string): string {
  const normalizedBase = normalizeSegment(basePath);
  const fingerprint = createHash('sha1')
    .update(`${remoteName}:${normalizedBase}`)
    .digest('hex')
    .slice(0, 8);

  const safeRemote = remoteName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `rclone_${safeRemote}_${fingerprint}`;
}

function deriveFolderId(userId: string, relativePathFromRoot: string): string {
  return createHash('sha256')
    .update(`folder:${userId}:rclone:${relativePathFromRoot}`)
    .digest('hex')
    .slice(0, 32);
}

function derivePathId(userId: string, absolutePath: string): string {
  return createHash('sha256')
    .update(`path:${userId}:rclone:${absolutePath}`)
    .digest('hex')
    .slice(0, 32);
}

function buildRemotePrefix(remoteName: string, basePath: string): string {
  const normalizedBase = normalizeSegment(basePath);
  if (!normalizedBase) {
    return `${remoteName}:`;
  }
  return `${remoteName}:${normalizedBase}`;
}

function toRcloneAbsolutePath(remotePrefix: string, relativePath: string): string {
  if (!relativePath) {
    return remotePrefix;
  }
  return `${remotePrefix}/${relativePath}`.replace(/\/+/g, '/');
}

function extractRelativePath(remotePath: string, remotePrefix: string): string {
  if (remotePath === remotePrefix) {
    return '';
  }

  if (remotePath.startsWith(`${remotePrefix}/`)) {
    return remotePath.slice(remotePrefix.length + 1);
  }

  const withoutRemote = remotePath.includes(':') ? remotePath.split(':').slice(1).join(':') : remotePath;
  return withoutRemote.replace(/^\/+/, '');
}

function buildFolderRecords(
  userId: string,
  sourcePrefix: string,
  remotePrefix: string,
  scannedFolders: Set<string>
): FolderRecord[] {
  const relativePaths = new Set<string>();
  relativePaths.add(sourcePrefix);

  for (const folderRelativeWithinSource of scannedFolders) {
    if (!folderRelativeWithinSource || folderRelativeWithinSource === '.') {
      continue;
    }
    relativePaths.add(`${sourcePrefix}/${folderRelativeWithinSource}`);
  }

  const sorted = Array.from(relativePaths).sort((a, b) => {
    const aDepth = a.split('/').length;
    const bDepth = b.split('/').length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return a.localeCompare(b);
  });

  return sorted.map((relativePathFromRoot) => {
    const parentRelative = relativePathFromRoot.includes('/')
      ? relativePathFromRoot.slice(0, relativePathFromRoot.lastIndexOf('/'))
      : null;

    const relativeWithinSource = relativePathFromRoot === sourcePrefix
      ? ''
      : relativePathFromRoot.slice(sourcePrefix.length + 1);

    return {
      id: deriveFolderId(userId, relativePathFromRoot),
      parentFolderId: parentRelative ? deriveFolderId(userId, parentRelative) : null,
      absolutePath: toRcloneAbsolutePath(remotePrefix, relativeWithinSource),
      relativePathFromRoot,
      name: relativeWithinSource
        ? path.basename(relativeWithinSource)
        : `${remotePrefix}`,
    };
  });
}

function buildScannedRemoteFiles(
  remoteFiles: Array<{ path: string; type: 'image' | 'video'; size?: number }>,
  remotePrefix: string,
  sourcePrefix: string
): { scannedFiles: ScannedRemoteFile[]; scannedFolders: Set<string> } {
  const scannedFiles: ScannedRemoteFile[] = [];
  const scannedFolders = new Set<string>();

  for (const remoteFile of remoteFiles) {
    const relativeWithinSource = extractRelativePath(remoteFile.path, remotePrefix);
    if (!relativeWithinSource) {
      continue;
    }

    const relativePathFromRoot = `${sourcePrefix}/${relativeWithinSource}`;
    const fileName = path.basename(relativeWithinSource);
    const extension = path.extname(relativeWithinSource).toLowerCase() || null;
    const mimeType = (mime.lookup(fileName) || null) as string | null;
    const folderRelativeWithinSource = path.dirname(relativeWithinSource) === '.'
      ? ''
      : path.dirname(relativeWithinSource).replace(/\\/g, '/');
    const folderRelativePath = folderRelativeWithinSource
      ? `${sourcePrefix}/${folderRelativeWithinSource}`
      : sourcePrefix;

    if (folderRelativeWithinSource) {
      const parts = folderRelativeWithinSource.split('/').filter(Boolean);
      let rolling = '';
      for (const part of parts) {
        rolling = rolling ? `${rolling}/${part}` : part;
        scannedFolders.add(rolling);
      }
    }

    const absolutePath = toRcloneAbsolutePath(remotePrefix, relativeWithinSource);
    const contentHash = createHash('sha256')
      .update(`${absolutePath}:${remoteFile.size ?? 0}`)
      .digest('hex');

    scannedFiles.push({
      absolutePath,
      relativePathFromRoot,
      fileName,
      sizeBytes: remoteFile.size || 0,
      mimeType,
      extension,
      mediaKind: remoteFile.type,
      contentHash,
      fileKey: contentHash.slice(0, 16),
      folderRelativePath,
    });
  }

  return { scannedFiles, scannedFolders };
}

export default async function rcloneRoutes(fastify: FastifyInstance): Promise<void> {
  const rcloneAvailable = await isRcloneAvailable();
  if (!rcloneAvailable) {
    console.warn('rclone is not installed or not in PATH. Rclone features will be limited.');
  }

  fastify.get('/api/rclone/mount/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const mounted = await isMountActive();
    const pm2Status = await getPm2RcloneStatus();

    return reply.send({
      mounted,
      mountDir,
      pm2Status,
      status: mounted ? 'mounted' : 'unmounted',
    });
  });

  fastify.post('/api/rclone/mount/ensure', async (_request: FastifyRequest, reply: FastifyReply) => {
    const ensured = await ensureMountRunning();
    const pm2Status = await getPm2RcloneStatus();

    if (ensured.status === 'error') {
      return reply.code(500).send({
        ...ensured,
        mountDir,
        pm2Status,
      });
    }

    return reply.send({
      ...ensured,
      mountDir,
      pm2Status,
    });
  });

  fastify.get(
    '/api/rclone/remotes',
    {
      onRequest: [fastify.authenticate],
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        if (!rcloneAvailable) {
          return reply.code(503).send({
            error: 'rclone is not installed',
            message: 'Please install rclone on the server machine',
          });
        }

        const remotes = await listRemotes();
        const remotesWithTypes: RcloneRemoteInfo[] = [];

        for (const remote of remotes) {
          const type = await getRemoteType(remote.name);
          remotesWithTypes.push({
            name: remote.name,
            type: type || 'unknown',
          });
        }

        return reply.send({ remotes: remotesWithTypes });
      } catch (error) {
        console.error('Failed to list rclone remotes:', error);
        return reply.code(500).send({ error: 'Failed to list remotes' });
      }
    }
  );

  fastify.post<{ Body: ValidateRcloneBody }>(
    '/api/rclone/validate',
    {
      onRequest: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { remote_path } = request.body as ValidateRcloneBody;

      if (!remote_path || typeof remote_path !== 'string') {
        return reply.code(400).send({ error: 'Invalid remote path' });
      }

      try {
        const result = await validateRemote(remote_path);

        if (result.success) {
          return reply.send({
            success: true,
            message: 'Remote is accessible',
          });
        }

        return reply.code(400).send({
          success: false,
          error: result.error || 'Failed to connect to remote',
        });
      } catch (error) {
        console.error('Validation error:', error);
        return reply.code(500).send({ error: 'Validation failed' });
      }
    }
  );

  fastify.post<{ Body: AddRcloneSourceBody }>(
    '/api/rclone/add-source',
    {
      onRequest: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.userId;
      const { remote_name, base_path, remote_type, credentials, use_crypt } =
        request.body as AddRcloneSourceBody;

      if (!remote_name || !base_path) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      try {
        const db = getDatabase();
        const now = Math.floor(Date.now() / 1000);

        // Persist encrypted rclone config
        const rcloneConfigData = {
          remote_name,
          remote_type: remote_type || 'unknown',
          base_path,
          credentials: credentials || {},
          use_crypt: use_crypt || false,
        };

        const encryptedConfig = encryptRcloneConfig(rcloneConfigData, userId);

        const existingConfig = db
          .prepare('SELECT id, local_root_path FROM user_storage_configs WHERE user_id = ? LIMIT 1')
          .get(userId) as { id: string; local_root_path: string } | undefined;

        const storageConfigId = existingConfig?.id || createHash('sha256').update(`storage:${userId}`).digest('hex').slice(0, 32);
        const localRootPath = existingConfig?.local_root_path || '';

        db.prepare(
          `INSERT INTO user_storage_configs (id, user_id, local_root_path, rclone_config_encrypted, rclone_config_nonce, rclone_config_kdf_salt, rclone_config_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             local_root_path = excluded.local_root_path,
             rclone_config_encrypted = excluded.rclone_config_encrypted,
             rclone_config_nonce = excluded.rclone_config_nonce,
             rclone_config_kdf_salt = excluded.rclone_config_kdf_salt,
             rclone_config_version = excluded.rclone_config_version,
             updated_at = excluded.updated_at`
        ).run(storageConfigId, userId, localRootPath, encryptedConfig, now, now);

        const sourceId = createRcloneSourcePrefix(remote_name, base_path);
        const jobId = randomUUID();

        db.prepare(
          `INSERT INTO indexing_jobs (id, user_id, job_type, status, source_path, created_at, updated_at)
           VALUES (?, ?, 'rclone', 'queued', ?, ?, ?)`
        ).run(jobId, userId, `${remote_name}:${base_path}`, now, now);

        await enqueueIndexingJob({ jobId, userId, type: 'rclone', remoteName: remote_name, basePath: base_path, remoteType: remote_type || 'unknown' });

        return reply.code(202).send({ accepted: true, jobId, source_id: sourceId });
      } catch (error) {
        console.error('Failed to add rclone source:', error);
        return reply.code(500).send({ error: 'Failed to add rclone source' });
      }
    }
  );
}
