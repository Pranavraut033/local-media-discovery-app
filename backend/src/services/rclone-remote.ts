/**
 * Remote Rclone Client
 * Communicates with an rclone daemon (e.g., on Android via Termux)
 * using the HTTP RPC interface instead of subprocess
 */

import axios, { AxiosInstance } from 'axios';

export interface RemoteRcloneConfig {
  host: string; // e.g., 'localhost' or '192.168.x.x'
  port: number; // default 5572
  user?: string | null;
  password?: string | null;
  enabled?: boolean; // whether the remote daemon is active
}

export interface RcloneRemote {
  name: string;
  type: string;
}

export interface RcloneFileInfo {
  path: string;
  size?: number;
  modTime?: number;
  isDir: boolean;
}

export class RemoteRcloneClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(config: RemoteRcloneConfig) {
    this.baseUrl = `http://${config.host}:${config.port}`;

    const clientConfig: any = {
      baseURL: this.baseUrl,
      timeout: 30000,
    };

    // Add auth if provided
    if (config.user && config.password) {
      clientConfig.auth = {
        username: config.user,
        password: config.password,
      };
    }

    this.client = axios.create(clientConfig);
  }

  /**
   * Check if rclone daemon is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.client.get('/core/version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List configured remotes
   */
  async listRemotes(): Promise<RcloneRemote[]> {
    try {
      const response = await this.client.post('/config/listremotes', {});
      const remotesList = response.data?.remotes || [];

      return remotesList.map((name: string) => ({
        name: name.replace(':', ''),
        type: 'unknown', // RPC doesn't expose type easily, would need config/get
      }));
    } catch (error) {
      console.error('Failed to list remotes:', error);
      return [];
    }
  }

  /**
   * Validate remote connectivity
   */
  async validateRemote(remotePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.client.post('/operations/list', {
        fs: remotePath,
        maxItems: 1,
      });

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Validation failed',
      };
    }
  }

  /**
   * List files in a directory
   */
  async listFiles(remotePath: string): Promise<RcloneFileInfo[]> {
    try {
      const response = await this.client.post('/operations/list', {
        fs: remotePath,
      });

      const items = response.data?.list || [];

      return items.map((item: any) => ({
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
   * Recursively scan for media files
   */
  async scanRemoteForMedia(
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
    const self = this;

    const recursiveScan = async (currentPath: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;

      try {
        const items = await self.listFiles(currentPath);

        for (const item of items) {
          const fullPath = `${currentPath}/${item.path}`.replace('//', '/');

          if (item.isDir) {
            await recursiveScan(fullPath, depth + 1);
          } else {
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
    };

    await recursiveScan(remotePath, 0);
    return results;
  }

  /**
   * Read file from remote via RPC
   * Note: rclone RPC doesn't have direct file download, so we use 'cat' operation
   * Alternatively, expose via HTTP streaming endpoint
   */
  async readRemoteFile(remotePath: string): Promise<Buffer> {
    try {
      // Try using rclone's HTTP server endpoint if available
      const encodedPath = encodeURIComponent(remotePath);
      const response = await this.client.get(`/file/${encodedPath}`, {
        responseType: 'arraybuffer',
      });

      return Buffer.from(response.data);
    } catch (error) {
      // Fallback: RPC doesn't support direct file streaming
      console.error(`Cannot read file ${remotePath} via RPC. Requires RPC 'file' endpoint or HTTP mount.`);
      throw new Error(`Remote file reading not available: ${remotePath}`);
    }
  }

  /**
   * Get rclone version info
   */
  async getVersion(): Promise<string> {
    try {
      const response = await this.client.get('/core/version');
      return response.data?.version || 'unknown';
    } catch {
      return 'unavailable';
    }
  }

  /**
   * Test connection with proper error handling
   */
  async testConnection(): Promise<{ connected: boolean; version?: string; error?: string }> {
    try {
      const version = await this.getVersion();
      return { connected: true, version };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }
}

// Singleton instance for app-wide use
let remoteClient: RemoteRcloneClient | null = null;

export function initializeRemoteRclone(config: RemoteRcloneConfig): RemoteRcloneClient {
  remoteClient = new RemoteRcloneClient(config);
  return remoteClient;
}

export function getRemoteRcloneClient(): RemoteRcloneClient | null {
  return remoteClient;
}
