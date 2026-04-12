import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { loadOrCreateKey } from './services/keystore.js';
import { ensureCacheDir } from './services/cache.js';
import streamRoute from './routes/stream.js';
import prefetchRoute from './routes/prefetch.js';
import cacheRoute from './routes/cache.js';

if (config.isDefaultSecret) {
  console.warn(
    '[media-server] WARNING: MEDIA_SERVER_SECRET is not set. ' +
    'Set it to the same value used in the backend before going to production.'
  );
}

// Initialise key and cache directory before accepting requests.
loadOrCreateKey();
ensureCacheDir();

const fastify = Fastify({
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

await fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// Routes
await fastify.register(streamRoute);
await fastify.register(prefetchRoute);
await fastify.register(cacheRoute);

fastify.get('/health', async () => ({
  status: 'ok',
  timestamp: Date.now(),
  port: config.server.port,
}));

// Graceful shutdown
process.on('SIGINT', async () => {
  await fastify.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await fastify.close();
  process.exit(0);
});

await fastify.listen({ host: config.server.host, port: config.server.port });
console.log(`[media-server] Listening on ${config.server.host}:${config.server.port}`);
