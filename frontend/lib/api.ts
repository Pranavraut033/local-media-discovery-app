import { useFoldersStore } from './stores/folders.store';
import { useAuthStore } from './stores/auth.store';

const getRootFolder = (): string | null => useFoldersStore.getState().rootFolder;
const getStoredToken = (): string | null => useAuthStore.getState().token;

// The desktop shell launches the frontend with ?apiPort=…&mediaServerPort=… set
// to the ephemeral ports it assigned its bundled backend/media-server. Those query
// params are dropped on any navigation (notably the 401 redirect below), after
// which we'd otherwise fall back to the fixed dev ports 3001/3002 — and if a PM2
// stack is also running, silently talk to the WRONG backend (different DB + HMAC
// secret). So we persist the injected ports to sessionStorage on first load and
// read from there for the rest of the session.
function getRuntimePort(paramName: string, fallbackPort: string): string {
  if (typeof window === 'undefined') {
    return fallbackPort;
  }

  const storageKey = `runtime:${paramName}`;

  const fromQuery = new URLSearchParams(window.location.search).get(paramName);
  if (fromQuery) {
    try {
      window.sessionStorage.setItem(storageKey, fromQuery);
    } catch {
      // sessionStorage unavailable (private mode / disabled) — fall through.
    }
    return fromQuery;
  }

  try {
    const fromStorage = window.sessionStorage.getItem(storageKey);
    if (fromStorage) {
      return fromStorage;
    }
  } catch {
    // ignore
  }

  return fallbackPort;
}

export function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  const port = getRuntimePort('apiPort', process.env.API_PORT || '3001');

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

  // Handle 401 - redirect to login. Preserve the runtime port query params so the
  // desktop shell's ephemeral apiPort/mediaServerPort survive the navigation
  // (getRuntimePort also persists them to sessionStorage as a backstop).
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const preserved = new URLSearchParams();
      for (const key of ['apiPort', 'mediaServerPort']) {
        const value = params.get(key);
        if (value) preserved.set(key, value);
      }
      const query = preserved.toString();
      window.location.href = query ? `/?${query}` : '/';
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

export function getThumbnailUrl(mediaId: string): string {
  const base = getApiBase();
  const url = new URL(`${base}/api/thumbnail/${mediaId}`);
  const token = getStoredToken();

  if (token) {
    url.searchParams.set('token', token);
  }

  return url.toString();
}

export function getMediaServerBase(): string {
  if (process.env.NEXT_PUBLIC_MEDIA_SERVER_URL) {
    return process.env.NEXT_PUBLIC_MEDIA_SERVER_URL;
  }
  const port = getRuntimePort('mediaServerPort', process.env.MEDIA_SERVER_PORT || '3002');
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `http://${window.location.hostname}:${port}`;
  }
  return `http://localhost:${port}`;
}

/**
 * Build a media URL that routes through the fast media-cache server when a
 * stream token is available, with automatic fallback to the backend.
 */
export function getStreamUrl(streamToken: string | undefined, mediaId: string): string {
  if (streamToken) {
    const base = getMediaServerBase();
    const url = new URL(`${base}/stream`);
    url.searchParams.set('token', streamToken);
    return url.toString();
  }
  return getMediaUrl(mediaId);
}

export async function prefetchMediaFiles(tokens: string[]): Promise<void> {
  if (!tokens.length) return;
  try {
    await fetch(`${getMediaServerBase()}/prefetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Media server may not be running; ignore.
  }
}

export function cancelPrefetch(): void {
  // Fire-and-forget — no await, non-critical
  fetch(`${getMediaServerBase()}/prefetch`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(2000),
  }).catch(() => undefined);
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
  // A single missing/invalid source (e.g. a stale rclone source) shouldn't blank out
  // the whole tree, so failed sources are skipped rather than failing the batch.
  const results = await Promise.all(
    sourceIds.map(async (sourceId) => {
      const response = await authenticatedFetch(`${base}/api/folders/tree?sourceId=${encodeURIComponent(sourceId)}`);
      if (!response.ok) return null;
      return { sourceId, node: (await response.json()) as FolderNode };
    })
  );

  // Add sourceId to each node recursively
  const addSourceIdToNodes = (node: FolderNode, sourceId: string): FolderNode => ({
    ...node,
    sourceId,
    children: node.children.map(child => addSourceIdToNodes(child, sourceId)),
  });

  const children = results
    .filter((result): result is { sourceId: string; node: FolderNode } => result !== null)
    .map(({ sourceId, node }) => ({
      ...addSourceIdToNodes(node, sourceId),
      mediaCount: node.mediaCount || node.children.reduce((sum, child) => sum + child.mediaCount, 0),
    }));

  return {
    path: getRootFolder() ?? 'Root',
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

export interface RcloneMountEnsureResponse {
  mounted: boolean;
  status: 'mounted' | 'mounting' | 'error' | 'unmounted';
  message?: string;
  mountDir?: string;
  mountProcessStatus?: string | null;
}

let _ensureMountInFlight: Promise<RcloneMountEnsureResponse> | null = null;

async function getRcloneServerId(): Promise<string | null> {
  const response = await authenticatedFetch(`${base}/api/servers`).catch(() => null);
  if (!response?.ok) return null;
  const servers = (await response.json().catch(() => [])) as Array<{ id: string; serverType: string }>;
  return servers.find((s) => s.serverType === 'rclone')?.id ?? null;
}

export function ensureRcloneMount(): Promise<RcloneMountEnsureResponse> {
  if (_ensureMountInFlight) return _ensureMountInFlight;

  _ensureMountInFlight = (async () => {
    const serverId = await getRcloneServerId();
    if (!serverId) {
      return { mounted: false, status: 'unmounted' as const, message: 'No rclone remote server configured' };
    }

    const response = await authenticatedFetch(`${base}/api/rclone/mount/ensure?serverId=${encodeURIComponent(serverId)}`, {
      method: 'POST',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        mounted: false,
        status: 'error' as const,
        message: (data && typeof data.message === 'string' ? data.message : undefined) || 'Failed to ensure rclone mount',
      };
    }
    return data as RcloneMountEnsureResponse;
  })().finally(() => {
    _ensureMountInFlight = null;
  });

  return _ensureMountInFlight;
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
