/**
 * Rclone integration service
 * Handles remote source management via rclone
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import type { FileInfo } from '../types/rclone.js';

const execAsync = promisify(exec);

export interface RcloneRemote {
  name: string;
  type: string;
}

export interface RcloneFileInfo extends FileInfo {
  path: string;
  size?: number;
  modTime?: number;
  isDir: boolean;
}

export interface RcloneValidationResult {
  success: boolean;
  error?: string;
  message?: string;
}

/**
 * Check if rclone is available on the system
 */
export async function isRcloneAvailable(): Promise<boolean> {
  try {
    execSync('rclone version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of configured rclone remotes
 */
export async function listRemotes(): Promise<RcloneRemote[]> {
  try {
    const { stdout } = await execAsync('rclone listremotes');
    const remotes = stdout
      .split('\n')
      .filter((line) => line.trim())
      .map((name) => ({
        name: name.trim().replace(':', ''),
        type: 'unknown', // Will be populated from rclone config if needed
      }));

    return remotes;
  } catch (error) {
    console.error('Failed to list rclone remotes:', error);
    return [];
  }
}

/**
 * Get rclone config value
 */
export async function getRcloneConfig(remoteName: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`rclone config get ${remoteName} ${key}`);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Validate rclone remote connectivity and permissions
 */
export async function validateRemote(remotePath: string): Promise<RcloneValidationResult> {
  try {
    // Use a shallow lsjson call to test connectivity without scanning recursively
    const { stdout } = await execAsync(`rclone lsjson "${remotePath}" --max-depth 1`, {
      timeout: 30000,
    });

    // If we can parse as JSON, remote is accessible
    JSON.parse(stdout || '[]');
    return { success: true, message: 'Remote is accessible' };
  } catch (error: any) {
    const errorMessage = error.stderr || error.message || 'Unknown error';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * List files in an rclone remote path (non-recursive, one level)
 */
export async function listFiles(remotePath: string): Promise<RcloneFileInfo[]> {
  try {
    const { stdout } = await execAsync(`rclone lsjson "${remotePath}"`, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large responses
    });

    const items = JSON.parse(stdout || '[]') as Array<{
      Name: string;
      Size?: number;
      ModTime?: string;
      IsDir?: boolean;
    }>;

    return items.map((item) => ({
      path: item.Name,
      size: item.Size,
      modTime: item.ModTime ? new Date(item.ModTime).getTime() / 1000 : undefined,
      isDir: item.IsDir || false,
    }));
  } catch (error) {
    console.error(`Failed to list files in ${remotePath}:`, error);
    return [];
  }
}

/**
 * Recursively scan rclone remote for all files
 * Returns list of files matching media extensions
 */
export async function scanRemoteForMedia(
  remotePath: string,
  maxDepth: number = 100
): Promise<Array<{ path: string; type: 'image' | 'video'; size?: number }>> {
  const mediaExtensions: Record<string, 'image' | 'video'> = {
    '.jpg': 'image',
    '.jpeg': 'image',
    '.png': 'image',
    '.gif': 'image',
    '.webp': 'image',
    '.mp4': 'video',
    '.webm': 'video',
    '.mov': 'video',
  };

  const results: Array<{ path: string; type: 'image' | 'video'; size?: number }> = [];

  async function recursiveScan(currentPath: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const items = await listFiles(currentPath);

      for (const item of items) {
        const fullPath = `${currentPath}/${item.path}`.replace('//', '/');

        if (item.isDir) {
          // Recursively scan subdirectories
          await recursiveScan(fullPath, depth + 1);
        } else {
          // Check if file is a media file
          const ext = item.path.substring(item.path.lastIndexOf('.')).toLowerCase();
          const mediaType = mediaExtensions[ext];

          if (mediaType) {
            results.push({
              path: fullPath,
              type: mediaType,
              size: item.size,
            });
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to scan ${currentPath}:`, error);
    }
  }

  await recursiveScan(remotePath, 0);
  return results;
}

/**
 * Read file content from rclone remote
 * Returns buffer of file data
 */
export async function readRemoteFile(remotePath: string): Promise<Buffer> {
  try {
    const { stdout } = await execAsync(`rclone cat "${remotePath}"`, {
      encoding: 'binary',
      maxBuffer: 100 * 1024 * 1024, // 100MB max file size for streaming
    });

    return Buffer.from(stdout, 'binary');
  } catch (error) {
    console.error(`Failed to read file ${remotePath}:`, error);
    throw new Error(`Cannot read file from remote: ${remotePath}`);
  }
}

/**
 * Encrypt rclone config (credentials) for storage
 * Uses a simple encryption with a derived key from user PIN
 */
export function encryptRcloneConfig(config: Record<string, any>, encryptionKey: string): string {
  const configJson = JSON.stringify(config);
  const algorithm = 'aes-256-gcm';
  const key = crypto
    .createHash('sha256')
    .update(encryptionKey)
    .digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(configJson, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Return: iv + authTag + encrypted (all hex encoded)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt rclone config (credentials) from storage
 */
export function decryptRcloneConfig(encryptedData: string, encryptionKey: string): Record<string, any> | null {
  try {
    const algorithm = 'aes-256-gcm';
    const key = crypto
      .createHash('sha256')
      .update(encryptionKey)
      .digest();

    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Failed to decrypt rclone config:', error);
    return null;
  }
}

/**
 * Get rclone remote type (returns cached config type: sftp, s3, etc.)
 */
export async function getRemoteType(remoteName: string): Promise<string | null> {
  try {
    const type = await getRcloneConfig(remoteName, 'type');
    return type;
  } catch {
    return null;
  }
}
