/**
 * Main Fastify server
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyJwt from '@fastify/jwt';
import { getDatabase, closeDatabase } from './db/index.js';
import { config } from './config.js';
import configRoutes from './routes/config.js';
import indexingRoutes from './routes/indexing.js';
import filesystemRoutes from './routes/filesystem.js';
import authRoutes from './routes/auth.js';
import rcloneRoutes from './routes/rclone.js';
import remoteRcloneConfigRoutes from './routes/rclone-remote-config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { stopWatcher } from './services/watcher.js';
import feedRoutes from './routes/feed.js';
import thumbnailRoutes from './routes/thumbnails.js';
import maintenanceRoutes from './routes/maintenance.js';
import folderRoutes from './routes/folders.js';
import eventsRoutes from './routes/events.js';
import discoverRoutes from './routes/discover.js';
import { initThumbnailService } from './services/thumbnails.js';
import { startIndexingWorker } from './workers/indexer.worker.js';
import { rcloneMountService } from './services/rclone-mount.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  // In production, emit JSON logs (no colour/formatting worker overhead).
  // In development, use pino-pretty for human-readable output.
  logger:
    process.env.NODE_ENV === 'production'
      ? { level: 'warn' }
      : {
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
            colorize: true,
            singleLine: true,
          },
        },
      },
});

// Register CORS for LAN access
await fastify.register(cors, {
  origin: true, // Allow all origins for local network
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// Register JWT plugin
await fastify.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || 'your-secret-key-change-this-in-production',
});

// Decorate fastify with authenticate method
fastify.decorate('authenticate', async function (request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});

// Serve static frontend files if they exist
const frontendPath = path.join(__dirname, '../../frontend/out');
if (fs.existsSync(frontendPath)) {
  await fastify.register(fastifyStatic, {
    root: frontendPath,
    prefix: '/',
  });
  console.log('Serving static frontend from:', frontendPath);
} else {
  console.log('Frontend build not found. Run `npm run build` in frontend directory.');
  // Serve a simple message
  fastify.get('/', async () => {
    return {
      message: 'Backend is running. Build the frontend with `npm run build` in the frontend directory.',
      apiEndpoints: ['/api/health', '/api/config/root-folder'],
    };
  });
}

// Initialize database
getDatabase();

// Initialize thumbnail service
await initThumbnailService('./.thumbnails');

// Register routes
await fastify.register(authRoutes);
await fastify.register(configRoutes);
await fastify.register(indexingRoutes);
await fastify.register(feedRoutes);
await fastify.register(thumbnailRoutes);
await fastify.register(maintenanceRoutes);
await fastify.register(filesystemRoutes);
await fastify.register(folderRoutes, { prefix: '/api/folders' });
await fastify.register(rcloneRoutes);
await fastify.register(remoteRcloneConfigRoutes);
await fastify.register(eventsRoutes);
await fastify.register(discoverRoutes);

// Start BullMQ indexing worker (in-process)
startIndexingWorker();

// Auto-start rclone mount (non-fatal if rclone not configured)
rcloneMountService.startOnInit();

// Health check
fastify.get('/api/health', async () => {
  return { status: 'ok', timestamp: Date.now() };
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await stopWatcher();
  await rcloneMountService.shutdown();
  closeDatabase();
  fastify.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully (SIGTERM)...');
  await stopWatcher();
  await rcloneMountService.shutdown();
  closeDatabase();
  fastify.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start server
const start = async (): Promise<void> => {
  try {
    await fastify.listen({
      host: config.server.host,
      port: config.server.port,
    });

    console.log(`\n🚀 Server running on http://localhost:${config.server.port}`);
    console.log(`📱 Mobile access: http://<your-local-ip>:${config.server.port}\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
