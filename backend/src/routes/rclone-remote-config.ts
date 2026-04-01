/**
 * Remote Rclone Configuration Routes
 * Manage connection to Android/remote rclone daemon
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/index.js';
import {
  initializeRemoteRcloneConfig,
  setRemoteRcloneConfig,
  getRemoteRcloneConfig,
  disableRemoteRclone,
  clearRemoteRcloneConfig,
} from '../services/rclone-remote-config.js';
import { RemoteRcloneClient } from '../services/rclone-remote.js';

interface SetRemoteRcloneBody {
  host: string;
  port?: number;
  user?: string;
  password?: string;
}

interface TestRemoteRcloneQuery {
  host: string;
  port?: string;
  user?: string;
  password?: string;
}

export default async function remoteRcloneRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDatabase();

  // Initialize config table
  initializeRemoteRcloneConfig(db);

  /**
   * GET /api/rclone/remote-config
   * Get current remote rclone configuration (without credentials)
   */
  fastify.get(
    '/api/rclone/remote-config',
    {
      onRequest: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const config = getRemoteRcloneConfig(db);

        if (!config) {
          return reply.send({
            enabled: false,
            config: null,
            message: 'Remote rclone not configured',
          });
        }

        return reply.send({
          enabled: true,
          config: {
            host: config.host,
            port: config.port,
            user: config.user ? '***' : undefined, // Don't expose actual credentials
          },
        });
      } catch (error) {
        console.error('Failed to get remote rclone config:', error);
        return reply.code(500).send({ error: 'Failed to get configuration' });
      }
    }
  );

  /**
   * POST /api/rclone/remote-config/set
   * Set remote rclone daemon configuration
   */
  fastify.post<{ Body: SetRemoteRcloneBody }>(
    '/api/rclone/remote-config/set',
    {
      onRequest: [fastify.authenticate],
    },
    async (request: FastifyRequest<{ Body: SetRemoteRcloneBody }>, reply: FastifyReply) => {
      const { host, port = 5572, user, password } = request.body;

      if (!host) {
        return reply.code(400).send({ error: 'Host is required' });
      }

      try {
        setRemoteRcloneConfig(db, { host, port, user, password });

        return reply.send({
          success: true,
          message: `Remote rclone configured to ${host}:${port}`,
        });
      } catch (error) {
        console.error('Failed to set remote rclone config:', error);
        return reply.code(500).send({ error: 'Failed to set configuration' });
      }
    }
  );

  /**
   * POST /api/rclone/remote-config/test
   * Test connection to remote rclone daemon
   */
  fastify.post<{ Body: SetRemoteRcloneBody }>(
    '/api/rclone/remote-config/test',
    {
      onRequest: [fastify.authenticate],
    },
    async (request: FastifyRequest<{ Body: SetRemoteRcloneBody }>, reply: FastifyReply) => {
      const { host, port = 5572, user, password } = request.body;

      if (!host) {
        return reply.code(400).send({ error: 'Host is required' });
      }

      try {
        const client = new RemoteRcloneClient({ host, port, user, password });
        const result = await client.testConnection();

        if (result.connected) {
          return reply.send({
            success: true,
            message: `Connected to rclone daemon`,
            version: result.version,
          });
        } else {
          return reply.code(503).send({
            success: false,
            error: result.error || 'Failed to connect',
          });
        }
      } catch (error) {
        console.error('Failed to test remote rclone connection:', error);
        return reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Test failed',
        });
      }
    }
  );

  /**
   * POST /api/rclone/remote-config/disable
   * Disable remote rclone and fall back to local
   */
  fastify.post(
    '/api/rclone/remote-config/disable',
    {
      onRequest: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        disableRemoteRclone(db);

        return reply.send({
          success: true,
          message: 'Remote rclone disabled. Using local rclone.',
        });
      } catch (error) {
        console.error('Failed to disable remote rclone:', error);
        return reply.code(500).send({ error: 'Failed to disable remote' });
      }
    }
  );

  /**
   * POST /api/rclone/remote-config/clear
   * Clear remote rclone configuration
   */
  fastify.post(
    '/api/rclone/remote-config/clear',
    {
      onRequest: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        clearRemoteRcloneConfig(db);

        return reply.send({
          success: true,
          message: 'Remote rclone configuration cleared',
        });
      } catch (error) {
        console.error('Failed to clear remote rclone config:', error);
        return reply.code(500).send({ error: 'Failed to clear configuration' });
      }
    }
  );

  /**
   * GET /api/rclone/remote-remotes
   * List remotes from connected remote rclone daemon
   */
  fastify.get(
    '/api/rclone/remote-remotes',
    {
      onRequest: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const config = getRemoteRcloneConfig(db);

        if (!config) {
          return reply.code(503).send({
            error: 'Remote rclone not configured',
            message: 'Please configure remote rclone first',
          });
        }

        const client = new RemoteRcloneClient(config);
        const isAvailable = await client.isAvailable();

        if (!isAvailable) {
          return reply.code(503).send({
            error: 'Remote rclone daemon not reachable',
            message: `Cannot connect to rclone at ${config.host}:${config.port}`,
          });
        }

        const remotes = await client.listRemotes();

        return reply.send({
          success: true,
          remotes,
          source: 'remote-android-rclone',
        });
      } catch (error) {
        console.error('Failed to list remote remotes:', error);
        return reply.code(500).send({ error: 'Failed to list remotes' });
      }
    }
  );
}
