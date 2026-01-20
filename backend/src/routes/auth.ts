/**
 * Authentication routes for PIN-based login
 */
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { getDatabase } from '../db/index.js';

interface LoginBody {
  pin: string;
}

interface VerifyBody {
  token: string;
}

export default async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDatabase();

  /**
   * POST /api/auth/login
   * Authenticate user with 6-digit PIN
   */
  fastify.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    const { pin } = request.body;

    // Validate PIN format (6 digits)
    if (!pin || !/^\d{6}$/.test(pin)) {
      return reply.code(400).send({ error: 'PIN must be exactly 6 digits' });
    }

    try {
      // Get all users (in practice, there should be only one or few)
      const users = db.prepare('SELECT id, pin_hash FROM users').all() as Array<{
        id: string;
        pin_hash: string;
      }>;

      // Try to match PIN with any user
      for (const user of users) {
        const isValid = await bcrypt.compare(pin, user.pin_hash);

        if (isValid) {
          // Generate long-lived JWT token (30 days)
          const token = fastify.jwt.sign(
            { userId: user.id },
            { expiresIn: '30d' }
          );

          return reply.send({
            success: true,
            token,
            userId: user.id,
          });
        }
      }

      // No matching user found
      return reply.code(401).send({ error: 'Invalid PIN' });
    } catch (error) {
      fastify.log.error({ err: error }, 'Login error');
      return reply.code(500).send({ error: 'Authentication failed' });
    }
  });

  /**
   * POST /api/auth/verify
   * Verify JWT token validity
   */
  fastify.post<{ Body: VerifyBody }>('/api/auth/verify', async (request, reply) => {
    const { token } = request.body;

    if (!token) {
      return reply.code(400).send({ error: 'Token is required' });
    }

    try {
      const decoded = fastify.jwt.verify(token) as { userId: string };

      // Check if user still exists
      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(decoded.userId);

      if (!user) {
        return reply.code(401).send({ error: 'User not found' });
      }

      return reply.send({
        valid: true,
        userId: decoded.userId,
      });
    } catch (error) {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }
  });

  /**
   * GET /api/auth/check-setup
   * Check if any users exist in the system
   */
  fastify.get('/api/auth/check-setup', async (request, reply) => {
    try {
      const users = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };

      return reply.send({
        hasUsers: users.count > 0,
        requiresSetup: users.count === 0,
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Check setup error');
      return reply.code(500).send({ error: 'Failed to check setup status' });
    }
  });
}
