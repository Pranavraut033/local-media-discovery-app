/**
 * Stream token helper — backend side.
 *
 * Signs short-lived HMAC-SHA256 (HS256) tokens that the media-server can
 * verify without having access to the database.
 *
 * Token payload:
 *   mediaId  — file ID (used as cache key on the media server)
 *   path     — absolute path on this machine (rclone VFS mount path)
 *   ext      — lowercase extension with leading dot, e.g. ".mp4"
 *   type     — "image" | "video"
 *   exp      — unix epoch (iat + 7200 s)
 */
import { createHmac, timingSafeEqual } from 'crypto';

export interface StreamTokenPayload {
  mediaId: string;
  path: string;
  ext: string;
  type: 'image' | 'video';
}

interface InternalPayload extends StreamTokenPayload {
  iat: number;
  exp: number;
}

function b64uEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
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
