/**
 * Remote provider abstraction.
 * Adding a new server type = implement RemoteProvider + register in registry.ts.
 */

export interface RemoteServer {
  id: string;
  userId: string;
  serverType: 'rclone' | 'webdav';
  displayName: string;
  rcloneRemoteType?: string | null;
  connection: Record<string, string>; // decrypted
}

export interface RemoteEntry {
  name: string;
  path: string;    // provider-specific path (rclone: "remote:path", webdav: url path)
  isDir: boolean;
  size?: number;
}

/** One level of directory listing — matches /api/filesystem/list shape */
export interface RemoteListing {
  currentPath: string;
  parentPath: string | null;
  directories: Array<{ name: string; path: string; accessible: boolean }>;
}

export interface RemoteProvider {
  /** Validate the connection is reachable. Throws on failure. */
  validate(connection: Record<string, string>): Promise<void>;

  /** List one directory level. `dir` is an opaque path for this provider. */
  list(server: RemoteServer, dir: string): Promise<RemoteListing>;

  /**
   * Recursively enumerate all media files under `dir`.
   * Yields batches for streaming indexer use.
   */
  scanMedia(
    server: RemoteServer,
    dir: string,
    onBatch: (files: RemoteFileInfo[]) => Promise<void>
  ): Promise<void>;
}

export interface RemoteFileInfo {
  absolutePath: string;    // provider-specific, stored in filePaths.absolute_path
  relativePath: string;    // relative to the indexed root dir
  fileName: string;
  sizeBytes: number;
  mediaKind: 'image' | 'video';
  mimeType: string | null;
  extension: string | null;
}
