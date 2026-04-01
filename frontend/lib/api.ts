import { getRootFolder, getStoredToken } from './storage';

export function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  const port = process.env.API_PORT || '3001';

  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `http://${window.location.hostname}:${port}`;
  }

  return `http://localhost:${port}`;
}

/**
 * Get authentication headers with JWT token
 */
export function getAuthHeaders(): HeadersInit {
  const token = getStoredToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Authenticated fetch wrapper
 * Automatically adds JWT token to requests and handles 401 responses
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getStoredToken();

  const headers = new Headers(options.headers);

  // Only set JSON content type when we are actually sending a non-FormData body.
  if (options.body != null && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 401 - redirect to login
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }

  return response;
}

export function getMediaUrl(mediaId: string): string {
  const base = getApiBase();
  const url = new URL(`${base}/api/media/file/${mediaId}`);
  const token = getStoredToken();

  if (token) {
    url.searchParams.set('token', token);
  }

  return url.toString();
}

/**
 * Folder tree API
 */
export interface FolderNode {
  path: string;
  name: string;
  mediaCount: number;
  hidden: boolean;
  sourceId?: string; // ID of the source this folder belongs to
  children: FolderNode[];
}
const base = getApiBase();

export async function getFolderTree(sourceIds: string[]): Promise<FolderNode> {

  const responses = await Promise.all(
    sourceIds.map((sourceId) =>
      authenticatedFetch(`${base}/api/folders/tree?sourceId=${encodeURIComponent(sourceId)}`)
    )
  ).then((responses) => {
    if (!responses.every(response => response.ok)) {
      throw new Error('Failed to fetch folder tree');
    }

    return Promise.all(responses.map((response) => response.json()));
  });

  const root = getRootFolder()!

  // Add sourceId to each node recursively
  const addSourceIdToNodes = (node: FolderNode, sourceId: string): FolderNode => ({
    ...node,
    sourceId,
    children: node.children.map(child => addSourceIdToNodes(child, sourceId)),
  });

  const children = (responses as FolderNode[]).map((node, index) => ({
    ...addSourceIdToNodes(node, sourceIds[index]),
    mediaCount: node.mediaCount || node.children.reduce((sum, child) => sum + child.mediaCount, 0),
  }))

  return {
    path: root,
    name: 'Root',
    mediaCount: children.reduce((sum, node) => sum + node.mediaCount, 0),
    hidden: false,
    children,
  };

}

export async function toggleFolderHide(
  sourceId: string,
  folderPath: string
): Promise<{ hidden: boolean }> {
  const response = await authenticatedFetch(`${base}/api/folders/hide`, {
    method: 'POST',
    body: JSON.stringify({ sourceId, folderPath }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to toggle folder visibility');
  }

  return response.json();
}

export async function getHiddenFolders(
  sourceId: string
): Promise<Array<{ folder_path: string }>> {
  const response = await authenticatedFetch(
    `${base}/api/folders/hidden?sourceId=${encodeURIComponent(sourceId)}`
  );

  if (!response.ok) {
    throw new Error('Failed to fetch hidden folders');
  }

  return response.json();
}

/**
 * Rclone API helpers
 */

export interface RcloneRemote {
  name: string;
  type: string;
}

export interface AddRcloneSourceBody {
  remote_name: string;
  base_path: string;
  remote_type: string;
  credentials?: Record<string, string>;
  use_crypt?: boolean;
  crypt_password?: string;
}

export async function fetchRcloneRemotes(): Promise<RcloneRemote[]> {
  const response = await authenticatedFetch(`${base}/api/rclone/remotes`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch rclone remotes');
  }

  const data = (await response.json()) as { remotes: RcloneRemote[] };
  return data.remotes;
}

export async function validateRcloneRemote(remotePath: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await authenticatedFetch(`${base}/api/rclone/validate`, {
    method: 'POST',
    body: JSON.stringify({ remote_path: remotePath }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Validation failed');
  }

  return data;
}

export async function addRcloneSource(body: AddRcloneSourceBody): Promise<{ accepted?: boolean; success?: boolean; source_id?: string; jobId?: string; message?: string }> {
  const response = await authenticatedFetch(`${base}/api/rclone/add-source`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to add rclone source');
  }

  return data;
}
