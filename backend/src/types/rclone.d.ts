/**
 * TypeScript definitions for rclone integration
 */

export interface FileInfo {
  name?: string;
  path?: string;
  size?: number;
  modTime?: number;
  isDir: boolean;
}

export interface RcloneConfigEntry {
  remote_name: string;
  remote_type: 'sftp' | 's3' | 'b2' | 'crypt' | 'local' | string;
  auth_type?: 'password' | 'key' | 'credentials' | string;
  base_path?: string;
  encryption_salt?: string;
}

export interface SourceConfig {
  source_id: string;
  source_type: 'local' | 'rclone';
  display_name: string;
  folder_path: string;
  rclone_config?: string; // Encrypted JSON
}
