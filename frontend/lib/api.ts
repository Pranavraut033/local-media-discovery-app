import { getStoredToken } from './storage';

export function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `http://${window.location.hostname}:3001`;
  }

  return 'http://localhost:3001';
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

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    (headers as any)['Authorization'] = `Bearer ${token}`;
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
  return `${base}/api/media/file/${mediaId}`;
}

/**
 * Folder tree API
 */
export interface FolderNode {
  path: string;
  name: string;
  mediaCount: number;
  hidden: boolean;
  children: FolderNode[];
}

export async function getFolderTree(sourceId: string): Promise<FolderNode> {
  const base = getApiBase();
  const response = await authenticatedFetch(
    `${base}/api/folders/tree?sourceId=${encodeURIComponent(sourceId)}`
  );

  if (!response.ok) {
    throw new Error('Failed to fetch folder tree');
  }

  return response.json();
}

export async function toggleFolderHide(
  sourceId: string,
  folderPath: string
): Promise<{ hidden: boolean }> {
  const base = getApiBase();
  const response = await authenticatedFetch(`${base}/api/folders/hide`, {
    method: 'POST',
    body: JSON.stringify({ sourceId, folderPath }),
  });

  if (!response.ok) {
    throw new Error('Failed to toggle folder visibility');
  }

  return response.json();
}

export async function getHiddenFolders(
  sourceId: string
): Promise<Array<{ folder_path: string }>> {
  const base = getApiBase();
  const response = await authenticatedFetch(
    `${base}/api/folders/hidden?sourceId=${encodeURIComponent(sourceId)}`
  );

  if (!response.ok) {
    throw new Error('Failed to fetch hidden folders');
  }

  return response.json();
}
