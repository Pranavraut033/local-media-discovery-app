/**
 * Folder Selection Component
 * Allows users to browse and select a root folder for media indexing.
 * Remote servers (rclone, webdav) appear as typed volume icons alongside local drives.
 * Privacy: Root folder path is stored in browser localStorage, not on the backend.
 */
'use client';

import { useState, useEffect } from 'react';
import { Folder, ChevronRight, Home, HardDrive, Play, Server, Globe, Database, Lock, Cloud, Plus, Pencil, Trash2 } from 'lucide-react';
import { getApiBase, authenticatedFetch } from '@/lib/api';
import { RecentFolders } from './RecentFolders';
import { useFoldersStore } from '@/lib/stores/folders.store';
import { useIndexingStore } from '@/lib/stores/indexing.store';
import { AddServerModal } from './AddServerModal';

interface FolderSelectionProps {
  onFolderSelected?: (source?: 'local' | 'remote') => void;
}

interface Directory {
  name: string;
  path: string;
  accessible: boolean;
}

interface RootDirectory {
  path: string;
  name: string;
  /** 'home' | 'common' | 'system' = local, 'remote' = a remote server */
  type: 'home' | 'common' | 'system' | 'remote';
  // remote-only
  serverId?: string;
  serverType?: 'rclone' | 'webdav';
  rcloneRemoteType?: string | null;
}

interface RemoteServer {
  id: string;
  serverType: 'rclone' | 'webdav';
  displayName: string;
  rcloneRemoteType?: string | null;
}

interface EditingServer {
  serverId: string;
  initialYaml: string;
}

/** Icon per server/rclone remote type — lucide generics for now. */
function serverIcon(serverType: string, rcloneRemoteType?: string | null) {
  if (serverType === 'webdav') return <Globe size={20} className="text-blue-500 shrink-0" />;
  switch (rcloneRemoteType) {
    case 'sftp': return <Server size={20} className="text-violet-500 shrink-0" />;
    case 'smb': return <HardDrive size={20} className="text-blue-600 shrink-0" />;
    case 's3':
    case 'b2': return <Database size={20} className="text-orange-500 shrink-0" />;
    case 'dropbox':
    case 'drive':
    case 'onedrive': return <Cloud size={20} className="text-sky-500 shrink-0" />;
    case 'crypt': return <Lock size={20} className="text-amber-500 shrink-0" />;
    default: return <Server size={20} className="text-violet-400 shrink-0" />;
  }
}

/** Reconstruct YAML from stored server connection for edit pre-fill. */
function buildYamlFromServer(server: {
  serverType: 'rclone' | 'webdav';
  displayName: string;
  rcloneRemoteType?: string | null;
  connection: Record<string, string>;
}): string {
  const conn = { ...server.connection };
  // Extract crypt metadata stored alongside the main connection
  const cryptRemoteName = conn.cryptRemoteName;
  const cryptPassword = conn.cryptPassword;
  const cryptPassword2 = conn.cryptPassword2;
  const cryptPath = conn.cryptPath;
  const cryptRemote = conn.cryptRemote;
  // Remove crypt metadata keys — they're not rclone config params
  for (const k of ['cryptRemoteName', 'cryptPassword', 'cryptPassword2', 'cryptPath', 'cryptRemote']) {
    delete conn[k];
  }

  const lines: string[] = [
    `type: ${server.serverType}`,
    `displayName: ${server.displayName}`,
  ];

  if (server.rcloneRemoteType && server.rcloneRemoteType !== 'crypt') {
    lines.push(`rcloneRemoteType: ${server.rcloneRemoteType}`);
  }

  if (cryptRemoteName) {
    lines.push('crypt:');
    if (cryptPath) lines.push(`  path: ${cryptPath}`);
    else if (cryptRemote) lines.push(`  remote: ${cryptRemote}`);
    lines.push(`  password: ${cryptPassword ?? '# re-enter your obscured password'}`);
    if (cryptPassword2) lines.push(`  password2: ${cryptPassword2}`);
  }

  lines.push('connection:');
  for (const [k, v] of Object.entries(conn)) {
    lines.push(`  ${k}: ${v}`);
  }

  return lines.join('\n');
}

export default function FolderSelection({ onFolderSelected }: FolderSelectionProps) {
  const API_URL = getApiBase();
  const [currentPath, setCurrentPath] = useState<string>('');
  const [directories, setDirectories] = useState<Directory[]>([]);
  const [roots, setRoots] = useState<RootDirectory[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [showBrowser, setShowBrowser] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobSource, setActiveJobSource] = useState<'local' | 'remote' | null>(null);
  const [showAddServer, setShowAddServer] = useState(false);
  const [editingServer, setEditingServer] = useState<EditingServer | null>(null);

  // Remote server browsing state
  const [activeServerId, setActiveServerId] = useState<string | null>(null);

  const jobs = useIndexingStore((s) => s.jobs);
  const activeJob = activeJobId ? jobs[activeJobId] : null;

  const loadRoots = async () => {
    try {
      setIsLoading(true);
      const [localResp, remoteResp] = await Promise.all([
        authenticatedFetch(`${API_URL}/api/filesystem/roots`),
        authenticatedFetch(`${API_URL}/api/servers`),
      ]);
      const localData = localResp.ok ? await localResp.json() : { roots: [] };
      const remoteServers: RemoteServer[] = remoteResp.ok ? await remoteResp.json() : [];

      const remoteRoots: RootDirectory[] = remoteServers.map((s) => ({
        path: `__server__${s.id}`,
        name: s.displayName,
        type: 'remote',
        serverId: s.id,
        serverType: s.serverType,
        rcloneRemoteType: s.rcloneRemoteType,
      }));

      setRoots([...(localData.roots || []), ...remoteRoots]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directories');
    } finally {
      setIsLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { loadRoots(); }, []);

  const loadDirectory = async (path: string, serverId?: string | null) => {
    try {
      setIsLoading(true);
      setError('');

      if (serverId) {
        const response = await authenticatedFetch(
          `${API_URL}/api/servers/${serverId}/list?${new URLSearchParams({ path })}`
        );
        if (!response.ok) throw new Error('Failed to load remote directory');
        const data = await response.json();
        setActiveServerId(serverId);
        setCurrentPath(data.currentPath);
        setDirectories(data.directories || []);
        setParentPath(data.parentPath);
      } else {
        const response = await authenticatedFetch(
          `${API_URL}/api/filesystem/list?${new URLSearchParams({ path })}`
        );
        if (!response.ok) throw new Error('Failed to load directory');
        const data = await response.json();
        setActiveServerId(null);
        setCurrentPath(data.currentPath);
        setDirectories(data.directories || []);
        setParentPath(data.parentPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectFolder = async (path: string) => {
    try {
      setIsLoading(true);
      setError('');
      useFoldersStore.getState().setRootFolder(path);
      const response = await authenticatedFetch(`${API_URL}/api/config/root-folder`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      if (!response.ok) { useFoldersStore.getState().setRootFolder(''); throw new Error('Failed to set root folder'); }
      const data = await response.json();
      if (data.jobId) {
        setActiveJobId(data.jobId);
        setActiveJobSource('local');
        // ponytail: seed the store before the SSE job_queued event arrives, so Feed
        // doesn't briefly render "No media yet" — upgrade to a server-pushed event if this gets flaky.
        useIndexingStore.getState().upsertJob({ jobId: data.jobId, status: 'queued', sourcePath: path });
      }
      onFolderSelected?.('local');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set folder');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectRemoteFolder = async (path: string, serverId: string) => {
    try {
      setIsLoading(true);
      setError('');
      const response = await authenticatedFetch(`${API_URL}/api/servers/${serverId}/add-source`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      if (!response.ok) throw new Error('Failed to start remote indexing');
      const data = await response.json();
      useFoldersStore.getState().setRootFolder(path);
      if (data.jobId) {
        setActiveJobId(data.jobId);
        setActiveJobSource('remote');
        useIndexingStore.getState().upsertJob({ jobId: data.jobId, status: 'queued', sourcePath: path });
      }
      onFolderSelected?.('remote');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to index remote folder');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteServer = async (serverId: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      const res = await authenticatedFetch(`${API_URL}/api/servers/${serverId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete server');
      loadRoots();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete server');
    }
  };

  const handleEditServer = async (serverId: string) => {
    try {
      const res = await authenticatedFetch(`${API_URL}/api/servers/${serverId}`);
      if (!res.ok) throw new Error('Failed to load server details');
      const server = await res.json();
      setEditingServer({ serverId, initialYaml: buildYamlFromServer(server) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load server details');
    }
  };

  const resetBrowser = () => {
    setCurrentPath('');
    setDirectories([]);
    setParentPath(null);
    setActiveServerId(null);
  };

  if (!showBrowser) {
    return (
      <div className="flex flex-col items-center gap-6 w-full max-w-2xl">
        <div className="surface-panel flex flex-col items-center gap-4 text-center p-8 w-full">
          <div className="rounded-full bg-(--secondary-container) p-6">
            <Folder className="w-12 h-12 text-(--on-secondary-container)" />
          </div>
          <h1 className="editorial-title text-4xl text-(--surface-ink)">
            Select Your Media Folder
          </h1>
          <p className="text-(--surface-muted)">
            Choose a folder on the host computer containing your photos and videos
          </p>
        </div>

        <RecentFolders onFolderSelect={onFolderSelected} />

        {activeJob && (
          <div className="w-full p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800">
            <p className="text-sm text-blue-800 dark:text-blue-300 mb-2">
              {activeJob.status === 'completed'
                ? 'Indexing complete'
                : activeJob.stage === 'discovery'
                  ? `Discovering files${activeJob.filesFound ? ` — ${activeJob.filesFound} found` : ''}…`
                  : activeJob.done !== undefined && activeJob.total
                    ? `Hashing ${activeJob.done}/${activeJob.total}`
                    : 'Queued…'}
            </p>
            {activeJob.total ? (
              <div className="h-1.5 w-full rounded-full bg-blue-100 dark:bg-blue-950/60 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300 ease-out"
                  style={{ width: `${Math.round(((activeJob.done ?? 0) / activeJob.total) * 100)}%` }}
                />
              </div>
            ) : null}
          </div>
        )}

        {activeJobId && (
          <button
            onClick={() => onFolderSelected?.(activeJobSource ?? 'local')}
            className="focus-ring w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-4 px-6 rounded-full transition-colors"
          >
            <Play size={18} />
            Show Media
          </button>
        )}

        <div className="flex gap-3 w-full">
          <button
            onClick={() => setShowBrowser(true)}
            disabled={isLoading}
            className="focus-ring flex-1 bg-linear-to-r from-(--primary) to-(--primary-container) disabled:bg-(--outline) text-(--on-primary) font-semibold py-4 px-6 rounded-full transition-opacity"
          >
            Browse Folders & Servers
          </button>
          <button
            onClick={() => setShowAddServer(true)}
            disabled={isLoading}
            className="focus-ring flex items-center justify-center gap-2 border border-[var(--outline-variant)]/60 text-(--surface-muted) hover:text-(--surface-ink) font-semibold py-4 px-5 rounded-full transition-colors"
            title="Add remote server"
          >
            <Plus size={18} />
          </button>
        </div>

        {error && (
          <div className="w-full p-4 bg-(--error)/10 rounded-2xl">
            <p className="text-sm text-(--error)">{error}</p>
          </div>
        )}

        <div className="text-sm text-(--surface-muted) text-center">
          <p>💡 All media stays local and private on your host computer</p>
        </div>

        {showAddServer && (
          <AddServerModal
            onClose={() => setShowAddServer(false)}
            onAdded={() => { setShowAddServer(false); loadRoots(); }}
          />
        )}

        {editingServer && (
          <AddServerModal
            serverId={editingServer.serverId}
            initialYaml={editingServer.initialYaml}
            onClose={() => setEditingServer(null)}
            onAdded={() => { setEditingServer(null); loadRoots(); }}
          />
        )}
      </div>
    );
  }

  // File/remote browser interface
  return (
    <div className="flex flex-col w-full max-w-2xl h-150">
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-(--surface-ink)">Browse Folders</h2>
          <button
            onClick={() => { setShowBrowser(false); resetBrowser(); }}
            className="text-sm text-(--outline) hover:text-(--surface-ink)"
          >
            Cancel
          </button>
        </div>

        {currentPath && (
          <div className="flex items-center gap-2 p-3 bg-(--surface-high) rounded-xl overflow-x-auto">
            <Folder size={16} className="shrink-0 text-(--outline)" />
            <span className="text-sm font-mono text-(--surface-ink) truncate">{currentPath}</span>
          </div>
        )}

        {currentPath && (
          <button
            onClick={() => activeServerId
              ? handleSelectRemoteFolder(currentPath, activeServerId)
              : handleSelectFolder(currentPath)
            }
            disabled={isLoading}
            className="w-full bg-(--primary) hover:opacity-90 disabled:opacity-50 text-(--on-primary) font-semibold py-3 px-4 rounded-full transition-opacity"
          >
            {isLoading ? 'Setting...' : 'Use This Folder'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-(--error)/10 rounded-xl">
          <p className="text-sm text-(--error)">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-(--surface-lowest) rounded-2xl">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-4 border-(--outline-variant) border-t-[var(--secondary)] rounded-full animate-spin"></div>
          </div>
        ) : !currentPath ? (
          // Roots / volumes — local + remote servers
          <div className="divide-y divide-[var(--outline-variant)]/20">
            {roots.map((root) => (
              root.type === 'remote' && root.serverId ? (
                // Remote server row: browse area + edit/delete actions
                <div key={root.path} className="flex items-center hover:bg-(--surface-low) transition-colors">
                  <button
                    onClick={() => loadDirectory('', root.serverId)}
                    className="flex-1 flex items-center gap-3 p-4 text-left min-w-0"
                  >
                    {serverIcon(root.serverType || 'rclone', root.rcloneRemoteType)}
                    <span className="flex-1 font-medium text-(--surface-ink) truncate">{root.name}</span>
                    <span className="text-xs text-(--outline) shrink-0 mr-1">{root.serverType}</span>
                  </button>
                  <div className="flex items-center gap-1 pr-3 shrink-0">
                    <button
                      onClick={() => handleEditServer(root.serverId!)}
                      className="p-1.5 rounded-lg text-(--outline) hover:text-(--primary) hover:bg-(--primary)/10 transition-colors"
                      title="Edit server"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => handleDeleteServer(root.serverId!, root.name)}
                      className="p-1.5 rounded-lg text-(--outline) hover:text-(--error) hover:bg-(--error)/10 transition-colors"
                      title="Delete server"
                    >
                      <Trash2 size={15} />
                    </button>
                    <ChevronRight size={18} className="text-(--outline) ml-1" />
                  </div>
                </div>
              ) : (
                <button
                  key={root.path}
                  onClick={() => loadDirectory(root.path)}
                  className="w-full flex items-center gap-3 p-4 hover:bg-(--surface-low) transition-colors text-left"
                >
                  {root.type === 'home' ? (
                    <Home size={20} className="text-(--secondary) shrink-0" />
                  ) : root.type === 'system' ? (
                    <HardDrive size={20} className="text-(--outline) shrink-0" />
                  ) : (
                    <Folder size={20} className="text-(--outline) shrink-0" />
                  )}
                  <span className="flex-1 font-medium text-(--surface-ink)">{root.name}</span>
                  <ChevronRight size={20} className="text-(--outline) shrink-0" />
                </button>
              )
            ))}

            {/* Add a server entry at the bottom */}
            <button
              onClick={() => setShowAddServer(true)}
              className="w-full flex items-center gap-3 p-4 hover:bg-(--surface-low) transition-colors text-left"
            >
              <Plus size={20} className="text-(--primary) shrink-0" />
              <span className="flex-1 font-medium text-(--primary)">Add Remote Server…</span>
            </button>
          </div>
        ) : (
          // Directory contents
          <div className="divide-y divide-[var(--outline-variant)]/20">
            {parentPath !== null ? (
              <button
                onClick={() => loadDirectory(parentPath || '', activeServerId)}
                className="w-full flex items-center gap-3 p-4 hover:bg-(--surface-low) transition-colors text-left"
              >
                <Folder size={20} className="text-(--outline) shrink-0" />
                <span className="flex-1 font-medium text-(--surface-ink)">..</span>
                <ChevronRight size={20} className="text-(--outline) shrink-0" />
              </button>
            ) : activeServerId ? (
              <button
                onClick={resetBrowser}
                className="w-full flex items-center gap-3 p-4 hover:bg-(--surface-low) transition-colors text-left"
              >
                <Folder size={20} className="text-(--outline) shrink-0" />
                <span className="flex-1 font-medium text-(--surface-ink)">..</span>
                <ChevronRight size={20} className="text-(--outline) shrink-0" />
              </button>
            ) : null}

            {directories.length === 0 ? (
              <div className="p-8 text-center text-(--outline)">No subdirectories found</div>
            ) : (
              directories.map((dir) => (
                <button
                  key={dir.path}
                  onClick={() => dir.accessible && loadDirectory(dir.path, activeServerId)}
                  disabled={!dir.accessible}
                  className={`w-full flex items-center gap-3 p-4 transition-colors text-left ${
                    dir.accessible ? 'hover:bg-(--surface-low)' : 'opacity-50 cursor-not-allowed'
                  }`}
                >
                  <Folder
                    size={20}
                    className={`shrink-0 ${dir.accessible ? 'text-(--outline)' : 'text-(--outline-variant)'}`}
                  />
                  <span className="flex-1 text-(--surface-ink) truncate">{dir.name}</span>
                  {dir.accessible && <ChevronRight size={20} className="text-(--outline) shrink-0" />}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {showAddServer && (
        <AddServerModal
          onClose={() => setShowAddServer(false)}
          onAdded={() => { setShowAddServer(false); loadRoots(); }}
        />
      )}

      {editingServer && (
        <AddServerModal
          serverId={editingServer.serverId}
          initialYaml={editingServer.initialYaml}
          onClose={() => setEditingServer(null)}
          onAdded={() => { setEditingServer(null); loadRoots(); }}
        />
      )}
    </div>
  );
}
