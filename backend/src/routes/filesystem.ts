/**
 * Filesystem Browser Routes
 * Allows remote browsing of host filesystem for folder selection
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface ListDirectoryQuery {
  path?: string;
}

interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string };
}

export default async function filesystemRoutes(fastify: FastifyInstance): Promise<void> {
  // Get common starting directories
  fastify.get(
    '/api/filesystem/roots',
    {
      onRequest: [fastify.authenticate as any],
    },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const homeDir = os.homedir();
      const platform = os.platform();

      const roots = [
        { path: homeDir, name: 'Home', type: 'home' },
        { path: path.join(homeDir, 'Desktop'), name: 'Desktop', type: 'common' },
        { path: path.join(homeDir, 'Documents'), name: 'Documents', type: 'common' },
        { path: path.join(homeDir, 'Pictures'), name: 'Pictures', type: 'common' },
        { path: path.join(homeDir, 'Downloads'), name: 'Downloads', type: 'common' },
      ];

      // Add platform-specific roots
      if (platform === 'darwin') {
        roots.push({ path: '/Volumes', name: 'Volumes', type: 'system' });
      } else if (platform === 'win32') {
        // Windows drives
        for (let i = 65; i <= 90; i++) {
          const drive = String.fromCharCode(i) + ':\\';
          try {
            await fs.access(drive);
            roots.push({ path: drive, name: `Drive ${String.fromCharCode(i)}:`, type: 'system' });
          } catch {
            // Drive doesn't exist
          }
        }
      } else {
        // Linux/Unix
        roots.push({ path: '/', name: 'Root', type: 'system' });
      }

      // Filter to only existing directories
      const existingRoots = await Promise.all(
        roots.map(async (root) => {
          try {
            const stats = await fs.stat(root.path);
            if (stats.isDirectory()) {
              return root;
            }
          } catch {
            return null;
          }
          return null;
        })
      );

      return {
        success: true,
        roots: existingRoots.filter((r) => r !== null),
      };
    } catch (error) {
      console.error('Get roots error:', error);
      return reply.code(500).send({
        error: 'Failed to get root directories',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // List directory contents
  fastify.get<{ Querystring: ListDirectoryQuery }>(
    '/api/filesystem/list',
    {
      onRequest: [fastify.authenticate as any],
    },
    async (request: AuthenticatedRequest & FastifyRequest<{ Querystring: ListDirectoryQuery }>, reply: FastifyReply) => {
      try {
        const dirPath = request.query.path;

        if (!dirPath) {
          return reply.code(400).send({ error: 'Path is required' });
        }

        // Security: Normalize path to prevent traversal attacks
        const normalizedPath = path.normalize(dirPath);

        // Check if directory exists
        const stats = await fs.stat(normalizedPath);
        if (!stats.isDirectory()) {
          return reply.code(400).send({ error: 'Path is not a directory' });
        }

        // Read directory contents
        const entries = await fs.readdir(normalizedPath, { withFileTypes: true });

        // Filter to only directories and format response
        const directories = await Promise.all(
          entries
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => {
              const fullPath = path.join(normalizedPath, entry.name);
              try {
                // Try to access to check permissions
                await fs.access(fullPath, fs.constants.R_OK);
                return {
                  name: entry.name,
                  path: fullPath,
                  accessible: true,
                };
              } catch {
                return {
                  name: entry.name,
                  path: fullPath,
                  accessible: false,
                };
              }
            })
        );

        // Sort directories alphabetically
        directories.sort((a, b) => a.name.localeCompare(b.name));

        // Get parent directory
        const parentPath = path.dirname(normalizedPath);
        const hasParent = parentPath !== normalizedPath;

        return {
          success: true,
          currentPath: normalizedPath,
          parentPath: hasParent ? parentPath : null,
          directories,
        };
      } catch (error) {
        console.error('List directory error:', error);
        return reply.code(500).send({
          error: 'Failed to list directory',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}
