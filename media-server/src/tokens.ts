/**
 * Stream token signing and verification using HMAC-SHA256 (no external deps).
 * Produces standard JWT-shaped tokens compatible with any HS256 verifier.
 *
 * The same sign/verify logic is duplicated in backend/src/tokens.ts so that
 * the media server remains completely independent (no shared package).
 */
import { createHmac, timingSafeEqual } from 'crypto';

export interface StreamTokenPayload {
  /** File ID from the backend DB (used as cache key on the media server). */
  mediaId: string;
  /** Absolute path on the machine running the backend / media-server. */
  path: string;
  /** Lowercase extension including dot, e.g. ".mp4" */
  ext: string;
  /** Media kind. */
  type: 'image' | 'video';
}

interface InternalPayload extends StreamTokenPayload {
  iat: number;
  exp: number;
}

function b64uEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function b64uDecode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

const HEADER = b64uEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function hmacSign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Sign a stream token valid for 2 hours. */
export function signStreamToken(payload: StreamTokenPayload, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const full: InternalPayload = { ...payload, iat: now, exp: now + 7200 };
  const body = b64uEncode(JSON.stringify(full));
  const sig = hmacSign(`${HEADER}.${body}`, secret);
  return `${HEADER}.${body}.${sig}`;
}

/** Verify a stream token. Throws if invalid or expired. */
export function verifyStreamToken(token: string, secret: string): StreamTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [header, body, sig] = parts;
  const expectedSig = hmacSign(`${header}.${body}`, secret);

  // Constant-time comparison to prevent timing attacks.
  const sigBuf = Buffer.from(sig, 'base64url');
  const expectedBuf = Buffer.from(expectedSig, 'base64url');
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Invalid token signature');
  }

  const decoded = JSON.parse(b64uDecode(body)) as InternalPayload;
  if (decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  const { mediaId, path, ext, type } = decoded;
  if (!mediaId || !path || !ext || !type) throw new Error('Incomplete token payload');
  return { mediaId, path, ext, type };
}
