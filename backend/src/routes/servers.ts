/**
 * /api/servers — remote server management (rclone, webdav).
 *
 * POST   /api/servers              — add via YAML or JSON body
 * GET    /api/servers              — list user's remote servers
 * GET    /api/servers/:id          — get single server with connection (for edit pre-fill)
 * PUT    /api/servers/:id          — update server (delete old remotes, recreate)
 * DELETE /api/servers/:id          — remove a server
 * GET    /api/servers/:id/list?path=… — browse one level
 * POST   /api/servers/:id/add-source  — index a selected folder → {jobId}
 *
 * GET  /api/internal/servers/:id/connection — media-server credential resolution
 *        gated by shared MEDIA_SERVER_SECRET in X-Internal-Secret header
 */
import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'crypto';
import yaml from 'js-yaml';
import { getDatabase } from '../db/index.js';
import { enqueueIndexingJob } from '../queue/index.js';
import { sseEventBus } from '../queue/events.js';
import {
  listServers,
  getServer,
  getServerById,
  createServer,
  updateServer,
  deleteServer,
} from '../services/remote/servers-db.js';
import { getProvider } from '../services/remote/registry.js';
import { getRcdClient, RC_URL } from '../services/rclone-rcd.js';

const MEDIA_SERVER_SECRET =
  process.env.MEDIA_SERVER_SECRET || 'media-server-default-secret-change-me';

function getRcAuth() {
  return {
    auth: {
      username: process.env.RCLONE_RC_USER || 'local-media',
      password: process.env.RCLONE_RC_PASS || 'local-media-rcd-pass',
    },
  };
}

/** Parse a server definition from YAML text or a plain JSON body. */
function parseServerDef(raw: unknown): {
  type: 'rclone' | 'webdav';
  displayName: string;
  rcloneRemoteType?: string;
  crypt?: { password?: string; password2?: string; remote?: string; path?: string; type?: string };
  connection: Record<string, string>;
} {
  let def: any;
  if (typeof raw === 'string') {
    def = yaml.load(raw);
  } else {
    def = raw;
  }
  if (!def || typeof def !== 'object') throw new Error('Invalid server definition');
  if (!['rclone', 'webdav'].includes(def.type)) throw new Error('type must be rclone or webdav');
  if (!def.displayName) throw new Error('displayName is required');
  if (!def.connection || typeof def.connection !== 'object') throw new Error('connection is required');
  return {
    type: def.type,
    displayName: def.displayName,
    rcloneRemoteType: def.rcloneRemoteType ?? def.rclone_remote_type ?? null,
    crypt: def.crypt ? {
      password: def.crypt.password,
      password2: def.crypt.password2,
      remote: def.crypt.remote,
      path: def.crypt.path,
    } : undefined,
    connection: Object.fromEntries(
      Object.entries(def.connection).map(([k, v]) => [k, String(v)])
    ),
  };
}

/**
 * Create/update rclone config entries for a server def and validate connectivity.
 * Returns the final connection object (with crypt metadata merged in if applicable).
 * Throws on validation failure (cleans up any created entries first).
 */
async function provisionRemotes(
  def: ReturnType<typeof parseServerDef>,
  log: FastifyBaseLogger
): Promise<Record<string, string>> {
  const RC_AUTH = getRcAuth();
  const axios = (await import('axios')).default;
  let connection = { ...def.connection };
  let createdRcloneRemote: string | null = null;

  // Create the base rclone remote in rclone config
  if (def.type === 'rclone' && def.rcloneRemoteType && def.rcloneRemoteType !== 'crypt') {
    const remoteName = connection.remoteName;
    if (!remoteName) throw new Error('connection.remoteName is required for rclone servers');

    const { remoteName: _omit, type: _type, ...rcloneParams } = connection;
    const remoteType = def.rcloneRemoteType;

    try {
      await axios.post(`${RC_URL}/config/create`, { name: remoteName, type: remoteType, parameters: rcloneParams }, RC_AUTH);
      createdRcloneRemote = remoteName;
      log.info({ remoteName, type: remoteType }, '[servers] created rclone config entry');
    } catch (err: any) {
      const rcdMsg = err?.response?.data?.error ?? err?.message;
      if (typeof rcdMsg === 'string' && rcdMsg.toLowerCase().includes('already')) {
        try {
          await axios.post(`${RC_URL}/config/update`, { name: remoteName, type: remoteType, parameters: rcloneParams }, RC_AUTH);
          log.info({ remoteName }, '[servers] updated existing rclone config entry');
        } catch (uerr: any) {
          log.error({ err: uerr, remoteName }, '[servers] failed to update rclone config entry');
          throw new Error(`Failed to register rclone remote "${remoteName}": ${uerr?.response?.data?.error ?? uerr?.message}`);
        }
      } else {
        log.error({ err, remoteName, type: remoteType, rcloneParams }, '[servers] failed to create rclone config entry');
        throw new Error(`Failed to register rclone remote "${remoteName}": ${rcdMsg}`);
      }
    }
  }

  // Validate by listing root — confirms remote is reachable
  try {
    await getProvider(def.type).validate(def.connection);
  } catch (err: any) {
    if (createdRcloneRemote) {
      await axios.post(`${RC_URL}/config/delete`, { name: createdRcloneRemote }, RC_AUTH).catch(() => {});
    }
    log.error({ err, type: def.type, connection: def.connection }, '[servers] validation failed');
    throw new Error(`Connection validation failed: ${err.message}`);
  }

  // Create crypt remote wrapping the base remote
  if (def.type === 'rclone' && def.crypt?.password && def.rcloneRemoteType !== 'crypt') {
    const baseName = (connection.remoteName || 'remote').replace(/[^a-z0-9_-]/gi, '_');
    const cryptName = `${baseName}_crypt`;
    // Build rclone crypt "remote" param:
    //   explicit crypt.remote wins; crypt.path becomes remoteName:subpath; else root
    let cryptRemote: string;
    if (def.crypt.remote) {
      cryptRemote = def.crypt.remote.includes(':') ? def.crypt.remote : `${def.crypt.remote}:`;
    } else if (def.crypt.path) {
      const subpath = def.crypt.path.replace(/^\//, '');
      cryptRemote = `${connection.remoteName}:${subpath}`;
    } else {
      cryptRemote = `${connection.remoteName}:`;
    }
    const cryptParams: Record<string, string> = { remote: cryptRemote, password: def.crypt.password };
    if (def.crypt.password2) cryptParams.password2 = def.crypt.password2;
    try {
      await axios.post(`${RC_URL}/config/create`, { name: cryptName, type: 'crypt', parameters: cryptParams }, RC_AUTH);
      // Store crypt metadata so edit can reconstruct YAML
      connection = {
        ...connection,
        cryptRemoteName: cryptName,
        cryptPassword: def.crypt.password,
        ...(def.crypt.password2 ? { cryptPassword2: def.crypt.password2 } : {}),
        ...(def.crypt.path ? { cryptPath: def.crypt.path } : {}),
        ...(def.crypt.remote ? { cryptRemote: def.crypt.remote } : {}),
      };
      log.info({ cryptName, cryptRemote }, '[servers] created crypt remote');
    } catch (err: any) {
      log.warn({ err, cryptName }, '[servers] failed to create crypt remote');
    }
  }

  return connection;
}

/** Delete rclone config entries for a server (best-effort, no throw). */
async function cleanupRcloneRemotes(connection: Record<string, string>, log: FastifyBaseLogger) {
  const RC_AUTH = getRcAuth();
  const axios = (await import('axios')).default;
  if (connection.cryptRemoteName) {
    await axios.post(`${RC_URL}/config/delete`, { name: connection.cryptRemoteName }, RC_AUTH).catch((e: any) => {
      log.warn({ err: e, name: connection.cryptRemoteName }, '[servers] cleanup: delete crypt remote failed');
    });
  }
  if (connection.remoteName) {
    await axios.post(`${RC_URL}/config/delete`, { name: connection.remoteName }, RC_AUTH).catch((e: any) => {
      log.warn({ err: e, name: connection.remoteName }, '[servers] cleanup: delete base remote failed');
    });
  }
}

export default async function serversRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /api/servers ──────────────────────────────────────────────────────
  fastify.get('/api/servers', { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user!.userId;
      const db = getDatabase();
      return reply.send(listServers(db, userId));
    }
  );

  // ── POST /api/servers ─────────────────────────────────────────────────────
  fastify.post('/api/servers', { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user!.userId;
      const body = req.body as any;

      let def: ReturnType<typeof parseServerDef>;
      try {
        def = parseServerDef(body.yaml ?? body);
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }

      let connection: Record<string, string>;
      try {
        connection = await provisionRemotes(def, fastify.log);
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }

      const db = getDatabase();
      const id = createServer(db, userId, def.type, def.displayName, def.rcloneRemoteType ?? null, connection);
      return reply.code(201).send({ id, serverType: def.type, displayName: def.displayName });
    }
  );

  // ── GET /api/servers/:id ──────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/servers/:id', { onRequest: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user!.userId;
      const db = getDatabase();
      const server = getServer(db, req.params.id, userId);
      if (!server) return reply.code(404).send({ error: 'Server not found' });
      return reply.send(server);
    }
  );

  // ── PUT /api/servers/:id ──────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/api/servers/:id', { onRequest: [fastify.authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = req.user!.userId;
      const body = req.body as any;
      const db = getDatabase();

      const existing = getServer(db, req.params.id, userId);
      if (!existing) return reply.code(404).send({ error: 'Server not found' });

      let def: ReturnType<typeof parseServerDef>;
      try {
        def = parseServerDef(body.yaml ?? body);
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }

      // Remove old rclone config entries before recreating
      if (existing.serverType === 'rclone') {
        await cleanupRcloneRemotes(existing.connection, fastify.log);
      }

      let connection: Record<string, string>;
      try {
        connection = await provisionRemotes(def, fastify.log);
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }

      const updated = updateServer(db, req.params.id, userId, def.displayName, def.rcloneRemoteType ?? null, connection);
      if (!updated) return reply.code(404).send({ error: 'Server not found' });
      return reply.send({ id: req.params.id, serverType: def.type, displayName: def.displayName });
    }
  );

  // ── DELETE /api/servers/:id ───────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/servers/:id', { onRequest: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user!.userId;
      const db = getDatabase();
      const server = getServer(db, req.params.id, userId);
      if (server?.serverType === 'rclone') {
        await cleanupRcloneRemotes(server.connection, fastify.log);
      }
      const deleted = deleteServer(db, req.params.id, userId);
      if (!deleted) return reply.code(404).send({ error: 'Server not found' });
      return reply.code(204).send();
    }
  );

  // ── GET /api/servers/:id/list?path= ──────────────────────────────────────
  fastify.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/servers/:id/list', { onRequest: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user!.userId;
      const db = getDatabase();
      const server = getServer(db, req.params.id, userId);
      if (!server) return reply.code(404).send({ error: 'Server not found' });

      const dir = req.query.path || '';
      try {
        const listing = await getProvider(server.serverType).list(server, dir);
        return reply.send(listing);
      } catch (err: any) {
        fastify.log.error({ err, serverId: req.params.id, dir }, '[servers] list failed');
        return reply.code(502).send({ error: `Failed to list directory: ${err.message}` });
      }
    }
  );

  // ── POST /api/servers/:id/add-source ─────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { path: string } }>('/api/servers/:id/add-source', { onRequest: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user!.userId;
      const db = getDatabase();
      const server = getServer(db, req.params.id, userId);
      if (!server) return reply.code(404).send({ error: 'Server not found' });

      const remotePath = req.body?.path;
      if (typeof remotePath !== 'string') return reply.code(400).send({ error: 'path is required' });

      const jobId = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      db.prepare(
        `INSERT INTO indexing_jobs (id, user_id, job_type, status, source_path, created_at, updated_at)
         VALUES (?, ?, 'remote', 'queued', ?, ?, ?)`
      ).run(jobId, userId, remotePath, now, now);

      await enqueueIndexingJob({
        jobId,
        userId,
        type: 'remote',
        serverId: server.id,
        serverType: server.serverType,
        remotePath,
      });

      return reply.code(202).send({ jobId });
    }
  );

  // ── GET /api/internal/servers/:id/connection (media-server only) ──────────
  fastify.get<{ Params: { id: string } }>('/api/internal/servers/:id/connection',
    async (req, reply) => {
      const secret = req.headers['x-internal-secret'];
      if (!secret || secret !== MEDIA_SERVER_SECRET) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const db = getDatabase();
      const server = getServerById(db, req.params.id);
      if (!server) return reply.code(404).send({ error: 'Server not found' });
      return reply.send({
        serverType: server.serverType,
        rcloneRemoteType: server.rcloneRemoteType,
        connection: server.connection,
      });
    }
  );
}
