/**
 * Settings Component
 * Displays user preferences, system statistics, and app configuration
 */
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Settings as SettingsIcon, ArrowLeft, RotateCw, Eye, LogOut, FolderTree, Maximize, Minimize, Server, Plus, Trash2, Download, Upload } from 'lucide-react';
import { getApiBase, authenticatedFetch, ensureRcloneMount } from '@/lib/api';
import { useSources, useFolderTree, useHideFolderMutation } from '@/lib/hooks';
import { FolderTreeView } from './FolderTreeView';
import { AddServerModal } from './AddServerModal';
import { ShutdownButton } from './ShutdownButton';
import { useFullscreen } from '@/lib/useFullscreen';
import { useFoldersStore } from '@/lib/stores/folders.store';
import { useUIStore, type ViewMode, type DefaultPage } from '@/lib/stores/ui.store';
import { isDesktopRuntime } from '@/lib/desktop';

interface AppStats {
  totalMedia: number;
  totalSources: number;
  likedCount: number;
  savedCount: number;
  hiddenCount: number;
  rootFolder: string;
}

interface SettingsProps {
  onBack?: () => void;
  onViewHidden?: () => void;
  onRootFolderReset?: () => void;
}

export function Settings({ onBack, onViewHidden, onRootFolderReset }: SettingsProps) {
  const API_URL = getApiBase();
  const [preferences, setLocalPreferences] = useState<ReturnType<typeof useUIStore.getState>['preferences'] | null>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  const localRootFolder = useFoldersStore((s) => s.rootFolder);
  // const feedSourceType = useUIStore((s) => s.preferences.feedSourceType ?? 'local'); // rclone disabled
  const [stats, setStats] = useState<AppStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [mountStatus, setMountStatus] = useState<'mounted' | 'unmounted' | 'mounting' | 'error' | 'unavailable' | null>(null);
  const [isMounting, setIsMounting] = useState(false);
  const [remoteServers, setRemoteServers] = useState<Array<{ id: string; displayName: string; serverType: string }>>([]);
  const [showAddServer, setShowAddServer] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Fetch user sources
  const { data: sources } = useSources();

  const loadRemoteServers = () =>
    authenticatedFetch(`${API_URL}/api/servers`)
      .then((r) => r.ok ? r.json() : [])
      .then(setRemoteServers)
      .catch(() => setRemoteServers([]));

  // Fetch folder trees for every source — a rclone-based library can have many
  // independent top-level sources, not just one local root folder.
  const activeSourceIds = useMemo(() => sources?.map((source) => source.id) ?? [], [sources]);
  const { data: folderTree, isLoading: isTreeLoading } = useFolderTree(activeSourceIds);

  // Mutation for hiding/showing folders
  const hideFolderMutation = useHideFolderMutation();

  // Load preferences and stats on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Load local preferences
        const prefs = useUIStore.getState().preferences;
        setLocalPreferences(prefs);

        // Load stats from API
        const statsResponse = await authenticatedFetch(`${API_URL}/api/admin/stats`);
        if (!statsResponse.ok) {
          const errorData = await statsResponse.json().catch(() => ({}));
          throw new Error((errorData as { error?: string }).error || 'Failed to load system statistics');
        }

        const statsData = await statsResponse.json();

        // Get hidden count
        const hiddenResponse = await authenticatedFetch(`${API_URL}/api/hidden`);
        const hiddenData = hiddenResponse.ok ? await hiddenResponse.json() : { count: 0 };

        setStats({
          totalMedia: statsData.media_count || 0,
          totalSources: statsData.sources_count || 0,
          likedCount: statsData.liked_count || 0,
          savedCount: statsData.saved_count || 0,
          hiddenCount: hiddenData.count || 0,
          rootFolder: statsData.root_folder || 'Not set',
        });

        // Fetch rclone mount status (non-fatal)
        const serversRes = await authenticatedFetch(`${API_URL}/api/servers`).catch(() => null);
        const servers = serversRes?.ok ? await serversRes.json().catch(() => []) : [];
        const rcloneServerId = servers.find((s: { serverType: string; id: string }) => s.serverType === 'rclone')?.id;

        if (rcloneServerId) {
          const mountRes = await authenticatedFetch(`${API_URL}/api/rclone/mount/status?serverId=${encodeURIComponent(rcloneServerId)}`).catch(() => null);
          if (mountRes?.ok) {
            const mountData = await mountRes.json();
            setMountStatus(mountData.mounted ? 'mounted' : 'unmounted');
          } else {
            setMountStatus('unavailable');
          }
        } else {
          setMountStatus('unavailable');
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
        setError('Failed to load settings');
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
    loadRemoteServers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_URL]);

  const handleViewModeChange = (mode: ViewMode) => {
    if (!preferences) return;
    setIsSaving(true);
    const updated = { ...preferences, viewMode: mode };
    setLocalPreferences(updated);
    useUIStore.getState().setPreferences({ viewMode: mode });
    setTimeout(() => setIsSaving(false), 300);
  };

  const handleAutoPlayToggle = () => {
    if (!preferences) return;
    setIsSaving(true);
    const updated = { ...preferences, autoPlayVideos: !preferences.autoPlayVideos };
    setLocalPreferences(updated);
    useUIStore.getState().setPreferences({ autoPlayVideos: !preferences.autoPlayVideos });
    setTimeout(() => setIsSaving(false), 300);
  };

  const handleSourceBadgeToggle = () => {
    if (!preferences) return;
    setIsSaving(true);
    const updated = { ...preferences, showSourceBadge: !preferences.showSourceBadge };
    setLocalPreferences(updated);
    useUIStore.getState().setPreferences({ showSourceBadge: !preferences.showSourceBadge });
    setTimeout(() => setIsSaving(false), 300);
  };

  const handleDefaultPageChange = (page: DefaultPage) => {
    if (!preferences) return;
    setIsSaving(true);
    const updated = { ...preferences, defaultPage: page };
    setLocalPreferences(updated);
    useUIStore.getState().setPreferences({ defaultPage: page });
    setTimeout(() => setIsSaving(false), 300);
  };

  // handleFeedSourceTypeChange removed — rclone/remote sources disabled
  // const handleFeedSourceTypeChange = (type: FeedSourceType) => {
  //   useUIStore.getState().setPreferences({ feedSourceType: type });
  //   window.location.reload();
  // };

  const handleResetRootFolder = async () => {
    if (!confirm('Are you sure you want to reset the root folder? This will clear all indexed media and you will need to select a folder again.')) {
      return;
    }

    try {
      setIsResetting(true);
      setError(null);

      // Call the API to clear the backend database
      const response = await authenticatedFetch(`${API_URL}/api/config/root-folder`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Clear root folder from persisted store
        useFoldersStore.getState().clearRootFolder();

        // Clear recent folders from persisted store
        useFoldersStore.getState().clearRecentFolders();

        // Navigate back to folder selection without a full page reload
        if (onRootFolderReset) {
          onRootFolderReset();
        } else {
          window.location.reload();
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to reset root folder');
      }
    } catch (err) {
      console.error('Failed to reset root folder:', err);
      setError('Failed to reset root folder');
    } finally {
      setIsResetting(false);
    }
  };

  const handleRemount = async () => {
    setIsMounting(true);
    setMountStatus('mounting');
    try {
      const result = await ensureRcloneMount();
      setMountStatus(result.mounted ? 'mounted' : result.status === 'error' ? 'error' : 'mounting');
    } catch {
      setMountStatus('error');
    } finally {
      setIsMounting(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    try {
      const res = await authenticatedFetch(`${API_URL}/api/admin/export`);
      if (!res.ok) {
        throw new Error('Failed to export data');
      }
      const server = await res.json();

      const backup = {
        version: 1,
        exportedAt: Date.now(),
        server,
        client: {
          ui: {
            preferences: useUIStore.getState().preferences,
          },
          folders: {
            rootFolder: useFoldersStore.getState().rootFolder,
            recentFolders: useFoldersStore.getState().recentFolders,
          },
        },
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `media-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setBackupMessage('Backup exported');
      setTimeout(() => setBackupMessage(null), 2000);
    } catch (err) {
      console.error('Failed to export data:', err);
      setError('Failed to export data');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setError(null);
    try {
      let parsed: {
        version?: number;
        server?: unknown;
        client?: {
          ui?: { preferences?: Partial<ReturnType<typeof useUIStore.getState>['preferences']> };
          folders?: { rootFolder?: string | null; recentFolders?: { path: string; name: string; timestamp: number }[] };
        };
      };
      try {
        const text = await file.text();
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Invalid backup file');
      }

      if (parsed.version !== 1 || !parsed.server) {
        throw new Error('Invalid backup file');
      }

      const res = await authenticatedFetch(`${API_URL}/api/admin/import`, {
        method: 'POST',
        body: JSON.stringify(parsed.server),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error((errorData as { error?: string }).error || 'Failed to import data');
      }

      // Restore client-side stores; a malformed client block shouldn't block
      // the server-side restore that already succeeded above.
      try {
        if (parsed.client?.ui?.preferences) {
          useUIStore.getState().setPreferences(parsed.client.ui.preferences);
        }
        if (parsed.client?.folders?.rootFolder) {
          useFoldersStore.getState().setRootFolder(parsed.client.folders.rootFolder);
        }
        if (Array.isArray(parsed.client?.folders?.recentFolders)) {
          for (const folder of parsed.client.folders.recentFolders) {
            useFoldersStore.getState().addRecentFolder(folder.path, folder.name);
          }
        }
      } catch (clientErr) {
        console.error('Failed to restore client state from backup:', clientErr);
      }

      setBackupMessage('Backup imported');
      setTimeout(() => {
        // ponytail: reload instead of invalidating each query key; swap to queryClient.invalidateQueries if a full reload feels heavy
        window.location.reload();
      }, 800);
    } catch (err) {
      console.error('Failed to import data:', err);
      setError(err instanceof Error ? err.message : 'Failed to import data');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const isDesktop = isDesktopRuntime();

  if (isLoading) {
    return (
      <div className="w-full h-dvh flex flex-col bg-gray-900">
        <div className="border-b border-gray-700 p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {onBack && (
              <button
                onClick={onBack}
                className="bg-gray-800 hover:bg-gray-700 text-white p-2 rounded-lg transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft size={24} />
              </button>
            )}
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <SettingsIcon size={28} />
              Settings
            </h1>
          </div>
          <button
            onClick={toggleFullscreen}
            className="bg-gray-800 hover:bg-gray-700 text-white p-2 rounded-lg transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-gray-600 border-t-gray-200 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-400">Loading settings...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-dvh flex flex-col bg-gray-900 overflow-y-auto">
      {/* Header */}
      <div className="border-b border-gray-700 p-4 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
        <div className="flex items-center gap-4">
          {onBack && (
            <button
              onClick={onBack}
              className="bg-gray-800 hover:bg-gray-700 text-white p-2 rounded-lg transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft size={24} />
            </button>
          )}
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <SettingsIcon size={28} />
            Settings
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="bg-gray-800 hover:bg-gray-700 text-white p-2 rounded-lg transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
          </button>
          <ShutdownButton />
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="m-4 p-4 bg-red-900/20 border border-red-800 rounded-lg">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
        {/* System Statistics */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">System Statistics</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-linear-to-br from-blue-900/20 to-blue-900/10 p-4 rounded-lg border border-blue-800">
              <p className="text-sm text-gray-400 font-medium">Total Media</p>
              <p className="text-3xl font-bold text-blue-400 mt-1">
                {stats?.totalMedia || 0}
              </p>
            </div>
            <div className="bg-linear-to-br from-purple-900/20 to-purple-900/10 p-4 rounded-lg border border-purple-800">
              <p className="text-sm text-gray-400 font-medium">Sources</p>
              <p className="text-3xl font-bold text-purple-400 mt-1">
                {stats?.totalSources || 0}
              </p>
            </div>
            <div className="bg-linear-to-br from-red-900/20 to-red-900/10 p-4 rounded-lg border border-red-800">
              <p className="text-sm text-gray-400 font-medium">Liked</p>
              <p className="text-3xl font-bold text-red-400 mt-1">
                {stats?.likedCount || 0}
              </p>
            </div>
            <div className="bg-linear-to-br from-green-900/20 to-green-900/10 p-4 rounded-lg border border-green-800">
              <p className="text-sm text-gray-400 font-medium">Saved</p>
              <p className="text-3xl font-bold text-green-400 mt-1">
                {stats?.savedCount || 0}
              </p>
            </div>
            <div className="bg-linear-to-br from-gray-800/50 to-gray-700/50 p-4 rounded-lg border border-gray-600 cursor-pointer hover:shadow-md transition-shadow" onClick={onViewHidden}>
              <p className="text-sm text-gray-400 font-medium">Hidden</p>
              <p className="text-3xl font-bold text-gray-400 mt-1">
                {stats?.hiddenCount || 0}
              </p>
            </div>
          </div>
        </div>

        {/* Hidden Media Section */}
        {(stats?.hiddenCount || 0) > 0 && (
          <div className="mb-8 p-4 bg-gray-800 rounded-lg border border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Eye size={20} className="text-gray-400" />
                <div>
                  <p className="font-medium text-white">Hidden Media</p>
                  <p className="text-sm text-gray-400">View your hidden/archived items</p>
                </div>
              </div>
              <button
                onClick={onViewHidden}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium"
              >
                View
              </button>
            </div>
          </div>
        )}

        {/* Root Folder + Folder Management */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <FolderTree size={20} />
            Root Folder & Folder Management
          </h2>
          <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
            <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-700">

              <p className="text-xs text-gray-400 font-medium mt-2 mb-1">Sources</p>
              <p className="text-sm text-white break-all">
                {sources?.length ? sources.map((source) => source.displayName).join(', ') : 'No active source'}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Root folder path is read from indexed configuration data.
              </p>
            </div>

            <button
              onClick={handleResetRootFolder}
              disabled={isResetting || (!localRootFolder && !sources?.length)}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors font-medium flex items-center justify-center gap-2 mb-4"
            >
              {isResetting ? (
                <>
                  <RotateCw size={16} className="animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <LogOut size={16} />
                  Reset Root Folder
                </>
              )}
            </button>

            <p className="text-xs text-gray-500 mb-4">
              Reset will clear all indexed media and return you to the folder selection screen.
            </p>

            {sources?.length ? (
              <>
                <div className="mb-4">
                  <p className="text-sm text-gray-400">
                    Manage subfolders across your sources. Hidden subfolders will not appear in your feed.
                  </p>
                </div>

                {/* Folder Tree */}
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-700 max-h-96 overflow-y-auto">
                  {isTreeLoading ? (
                    <div className="text-center py-8">
                      <div className="w-8 h-8 border-4 border-gray-600 border-t-gray-200 rounded-full animate-spin mx-auto mb-2"></div>
                      <p className="text-sm text-gray-400">Loading folder tree...</p>
                    </div>
                  ) : folderTree ? (
                    <FolderTreeView
                      tree={folderTree}
                      onToggleHide={(folderPath, sourceId) => {
                        if (!sourceId) {
                          console.error('No sourceId provided for folder:', folderPath);
                          return;
                        }
                        hideFolderMutation.mutate(
                          {
                            sourceId,
                            folderPath,
                          },
                          {
                            onError: (mutationError) => {
                              setError(
                                mutationError instanceof Error
                                  ? mutationError.message
                                  : 'Failed to toggle folder visibility'
                              );
                            },
                          }
                        );
                      }}
                      isLoading={hideFolderMutation.isPending}
                    />
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-4">
                      No subfolders found
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-400">
                  No root folder selected. Please select a folder from the folder selection screen.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Display Preferences */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Display Preferences</h2>

          {/* View Mode */}
          <div className="mb-6 p-4 bg-gray-800 rounded-lg border border-gray-700">
            <p className="text-sm font-medium text-gray-300 mb-3">Default View Mode</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleViewModeChange('reels')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${preferences?.viewMode === 'reels'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-gray-700 text-white border border-gray-600 hover:bg-gray-600'
                  }`}
              >
                Reels
              </button>
              <button
                onClick={() => handleViewModeChange('feed')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${preferences?.viewMode === 'feed'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-gray-700 text-white border border-gray-600 hover:bg-gray-600'
                  }`}
              >
                Feed
              </button>
            </div>
          </div>

          {/* Default Page */}
          <div className="mb-6 p-4 bg-gray-800 rounded-lg border border-gray-700">
            <p className="text-sm font-medium text-gray-300 mb-1">Default Page</p>
            <p className="text-xs text-gray-400 mb-3">Which tab opens first when you launch the app.</p>
            <div className="grid grid-cols-4 gap-2">
              {([
                { id: 'feed', label: 'Feed' },
                { id: 'discover', label: 'Discover' },
                { id: 'saved', label: 'Saved' },
                { id: 'liked', label: 'Liked' },
              ] as { id: DefaultPage; label: string }[]).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => handleDefaultPageChange(id)}
                  className={`py-2 px-2 rounded-lg font-medium text-sm transition-all ${preferences?.defaultPage === id
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-gray-700 text-white border border-gray-600 hover:bg-gray-600'
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Auto-play Videos */}
          <div className="mb-6 p-4 bg-gray-800 rounded-lg border border-gray-700 flex items-center justify-between">
            <div>
              <p className="font-medium text-white">Auto-play Videos</p>
              <p className="text-sm text-gray-400 mt-1">Videos play automatically when in view</p>
            </div>
            <button
              onClick={handleAutoPlayToggle}
              className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${preferences?.autoPlayVideos
                ? 'bg-blue-600'
                : 'bg-gray-600'
                }`}
              role="switch"
              aria-checked={preferences?.autoPlayVideos}
            >
              <span
                className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${preferences?.autoPlayVideos ? 'translate-x-5' : ''
                  }`}
              />
            </button>
          </div>

          {/* Show Source Badge */}
          <div className="mb-6 p-4 bg-gray-800 rounded-lg border border-gray-700 flex items-center justify-between">
            <div>
              <p className="font-medium text-white">Show Source Badge</p>
              <p className="text-sm text-gray-400 mt-1">Display pseudo-user source on media cards</p>
            </div>
            <button
              onClick={handleSourceBadgeToggle}
              className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${preferences?.showSourceBadge
                ? 'bg-blue-600'
                : 'bg-gray-600'
                }`}
              role="switch"
              aria-checked={preferences?.showSourceBadge}
            >
              <span
                className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${preferences?.showSourceBadge ? 'translate-x-5' : ''
                  }`}
              />
            </button>
          </div>

          {/* Feed Source Type — remote sources disabled; selector hidden
          <div className="mb-6 p-4 bg-gray-800 rounded-lg border border-gray-700">
            <p className="text-sm font-medium text-gray-300 mb-1">Feed Source</p>
            <p className="text-xs text-gray-400 mb-3">Choose which media sources appear in your feed. Changing this will reload the page.</p>
            <div className="flex gap-3">
              {(['local', 'remote', 'all'] as FeedSourceType[]).map((type) => {
                const active = feedSourceType === type;
                const labels: Record<FeedSourceType, string> = { local: 'Local', remote: 'Remote', all: 'All' };
                return (
                  <button
                    key={type}
                    onClick={() => handleFeedSourceTypeChange(type)}
                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${active
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'bg-gray-700 text-white border border-gray-600 hover:bg-gray-600'
                      }`}
                  >
                    {labels[type]}
                  </button>
                );
              })}
            </div>
          </div>
          */}
        </div>

        {/* About */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">About</h2>
          <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
            <p className="text-sm text-gray-400 mb-2">
              <span className="font-medium">Local Media Discovery App</span>
            </p>
            <p className="text-sm text-gray-400 mb-4">
              A social-media-like experience for browsing your local media library
            </p>
            <p className="text-xs text-gray-500">
              All data is stored locally on your device. No external network connectivity required.
            </p>
          </div>
        </div>

        {/* Backup & Restore */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Backup & Restore</h2>

          <div className="mb-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Download size={20} className="text-gray-400" />
                <div>
                  <p className="font-medium text-white">Export Data</p>
                  <p className="text-sm text-gray-400">Download your likes, saves, hidden items, and preferences</p>
                </div>
              </div>
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors font-medium"
              >
                {isExporting ? 'Exporting...' : 'Export'}
              </button>
            </div>
          </div>

          <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
            <div className="flex items-center gap-3 mb-4">
              <Upload size={20} className="text-gray-400" />
              <div>
                <p className="font-medium text-white">Import Data</p>
                <p className="text-sm text-gray-400">Restore likes, saves, hidden items, and preferences from a backup file</p>
              </div>
            </div>
            <input
              type="file"
              accept="application/json"
              className="hidden"
              ref={fileInputRef}
              onChange={handleImportFileSelected}
            />
            <button
              onClick={handleImportClick}
              disabled={isImporting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
            >
              {isImporting ? (
                <>
                  <RotateCw size={16} className="animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Import Backup
                </>
              )}
            </button>
          </div>
        </div>

        {/* System Control */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">System Control</h2>
          <div className="p-4 bg-gray-800 rounded-lg border border-gray-700 space-y-4">

            {/* rclone Mount */}
            {mountStatus !== 'unavailable' && mountStatus !== null && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-white">rclone Mount</p>
                  <p className="text-sm mt-0.5">
                    {mountStatus === 'mounted' && <span className="text-green-400">Mounted</span>}
                    {mountStatus === 'unmounted' && <span className="text-red-500">Unmounted</span>}
                    {mountStatus === 'mounting' && <span className="text-yellow-500">Mounting…</span>}
                    {mountStatus === 'error' && <span className="text-red-500">Mount failed</span>}
                  </p>
                </div>
                <button
                  onClick={handleRemount}
                  disabled={isMounting || mountStatus === 'mounting'}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors font-medium flex items-center gap-2 shrink-0"
                >
                  <RotateCw size={15} className={isMounting ? 'animate-spin' : ''} />
                  {isMounting ? 'Mounting…' : 'Remount'}
                </button>
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="font-medium text-white">{isDesktop ? 'Quit App' : 'Stop All Services'}</p>
                <p className="text-sm text-gray-400 mt-1">
                  {isDesktop ? (
                    'Closes the app and stops the backend and media server'
                  ) : (
                    'Stops backend, frontend, and media-server'
                  )}
                </p>
              </div>
            </div>
            <ShutdownButton variant="block" />
          </div>
        </div>

        {/* Remote Servers */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-(--surface-ink) mb-3 flex items-center gap-2">
            <Server size={18} />
            Remote Servers{remoteServers.length > 0 ? ` (${remoteServers.length})` : ''}
          </h2>
          <div className="p-4 bg-(--surface-low) rounded-2xl flex flex-col gap-3">
            {remoteServers.length === 0 ? (
              <p className="text-sm text-(--outline)">No remote servers configured. Add one to browse rclone or WebDAV sources.</p>
            ) : (
              remoteServers.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Server size={16} className="text-(--outline) shrink-0" />
                    <span className="text-sm text-(--surface-ink) truncate">{s.displayName}</span>
                    <span className="text-xs text-(--outline) shrink-0">{s.serverType}</span>
                  </div>
                  <button
                    onClick={async () => {
                      await authenticatedFetch(`${API_URL}/api/servers/${s.id}`, { method: 'DELETE' });
                      loadRemoteServers();
                    }}
                    className="shrink-0 text-(--error) hover:opacity-70"
                    title="Remove server"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
            <button
              onClick={() => setShowAddServer(true)}
              className="flex items-center gap-2 text-sm text-(--primary) hover:opacity-70 mt-1"
            >
              <Plus size={16} />
              Add Remote Server…
            </button>
          </div>
        </div>

        {showAddServer && (
          <AddServerModal
            onClose={() => setShowAddServer(false)}
            onAdded={() => { setShowAddServer(false); loadRemoteServers(); }}
          />
        )}
      </div>

      {/* Save indicator */}
      {isSaving && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm">
          <RotateCw size={16} className="animate-spin" />
          Saving...
        </div>
      )}

      {/* Backup indicator */}
      {backupMessage && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm">
          {backupMessage}
        </div>
      )}
    </div>
  );
}
