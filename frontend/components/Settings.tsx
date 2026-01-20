/**
 * Settings Component
 * Displays user preferences, system statistics, and app configuration
 */
'use client';

import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, ArrowLeft, RotateCw, Eye, LogOut, FolderTree } from 'lucide-react';
import { getPreferences, setPreferences, ViewMode, clearRecentFolders, getRootFolder, clearRootFolder } from '@/lib/storage';
import { getApiBase, authenticatedFetch } from '@/lib/api';
import { useSources, useFolderTree, useHideFolderMutation } from '@/lib/hooks';
import { FolderTreeView } from './FolderTreeView';

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
}

export function Settings({ onBack, onViewHidden }: SettingsProps) {
  const API_URL = getApiBase();
  const [preferences, setLocalPreferences] = useState<ReturnType<typeof getPreferences> | null>(null);
  const [stats, setStats] = useState<AppStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  // Fetch user sources
  const { data: sources } = useSources();

  // Automatically use the first source (current root folder)
  const currentSource = sources && sources.length > 0 ? sources[0] : null;

  // Fetch folder tree for current root folder
  const { data: folderTree, isLoading: isTreeLoading } = useFolderTree(currentSource?.id || null);

  // Mutation for hiding/showing folders
  const hideFolderMutation = useHideFolderMutation();

  // Load preferences and stats on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Load local preferences
        const prefs = getPreferences();
        setLocalPreferences(prefs);

        // Get root folder from localStorage (stored locally for privacy)
        const rootFolder = getRootFolder();

        // Load stats from API
        const statsResponse = await fetch(`${API_URL}/api/admin/stats`);
        if (statsResponse.ok) {
          const statsData = await statsResponse.json();

          // Get hidden count
          const hiddenResponse = await fetch(`${API_URL}/api/hidden`);
          const hiddenData = hiddenResponse.ok ? await hiddenResponse.json() : { count: 0 };

          setStats({
            totalMedia: statsData.media_count || 0,
            totalSources: statsData.sources_count || 0,
            likedCount: statsData.liked_count || 0,
            savedCount: statsData.saved_count || 0,
            hiddenCount: hiddenData.count || 0,
            rootFolder: rootFolder || 'Not set',
          });
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
        setError('Failed to load settings');
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, [API_URL]);

  const handleViewModeChange = (mode: ViewMode) => {
    if (!preferences) return;
    setIsSaving(true);
    const updated = { ...preferences, viewMode: mode };
    setLocalPreferences(updated);
    setPreferences({ viewMode: mode });
    setTimeout(() => setIsSaving(false), 300);
  };

  const handleAutoPlayToggle = () => {
    if (!preferences) return;
    setIsSaving(true);
    const updated = { ...preferences, autoPlayVideos: !preferences.autoPlayVideos };
    setLocalPreferences(updated);
    setPreferences({ autoPlayVideos: !preferences.autoPlayVideos });
    setTimeout(() => setIsSaving(false), 300);
  };

  const handleSourceBadgeToggle = () => {
    if (!preferences) return;
    setIsSaving(true);
    const updated = { ...preferences, showSourceBadge: !preferences.showSourceBadge };
    setLocalPreferences(updated);
    setPreferences({ showSourceBadge: !preferences.showSourceBadge });
    setTimeout(() => setIsSaving(false), 300);
  };

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
        // Clear root folder from localStorage (where it's actually stored)
        clearRootFolder();

        // Clear recent folders from local storage
        clearRecentFolders();

        // Reload the page to return to folder selection
        window.location.reload();
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

  if (isLoading) {
    return (
      <div className="w-full h-screen flex flex-col bg-white dark:bg-gray-900">
        <div className="border-b border-gray-200 dark:border-gray-700 p-4 flex items-center gap-4">
          {onBack && (
            <button
              onClick={onBack}
              className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white p-2 rounded-lg transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft size={24} />
            </button>
          )}
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <SettingsIcon size={28} />
            Settings
          </h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-gray-300 dark:border-gray-600 border-t-gray-900 dark:border-t-gray-200 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading settings...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen flex flex-col bg-white dark:bg-gray-900 overflow-y-auto pb-20">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 flex items-center gap-4 sticky top-0 bg-white dark:bg-gray-900 z-10">
        {onBack && (
          <button
            onClick={onBack}
            className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white p-2 rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={24} />
          </button>
        )}
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <SettingsIcon size={28} />
          Settings
        </h1>
      </div>

      {/* Error State */}
      {error && (
        <div className="m-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
        {/* System Statistics */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">System Statistics</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-linear-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-900/10 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Total Media</p>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                {stats?.totalMedia || 0}
              </p>
            </div>
            <div className="bg-linear-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-900/10 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Sources</p>
              <p className="text-3xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                {stats?.totalSources || 0}
              </p>
            </div>
            <div className="bg-linear-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-900/10 p-4 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Liked</p>
              <p className="text-3xl font-bold text-red-600 dark:text-red-400 mt-1">
                {stats?.likedCount || 0}
              </p>
            </div>
            <div className="bg-linear-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-900/10 p-4 rounded-lg border border-green-200 dark:border-green-800">
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Saved</p>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400 mt-1">
                {stats?.savedCount || 0}
              </p>
            </div>
            <div className="bg-linear-to-br from-gray-50 to-gray-100 dark:from-gray-800/50 dark:to-gray-700/50 p-4 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer hover:shadow-md transition-shadow" onClick={onViewHidden}>
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Hidden</p>
              <p className="text-3xl font-bold text-gray-600 dark:text-gray-400 mt-1">
                {stats?.hiddenCount || 0}
              </p>
            </div>
          </div>
        </div>

        {/* Hidden Media Section */}
        {(stats?.hiddenCount || 0) > 0 && (
          <div className="mb-8 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Eye size={20} className="text-gray-600 dark:text-gray-400" />
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Hidden Media</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">View your hidden/archived items</p>
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

        {/* Root Folder */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Root Folder</h2>
          <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="mb-3">
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium mb-2">Current Folder</p>
              <p className="text-gray-900 dark:text-white font-mono text-sm break-all">
                {stats?.rootFolder || 'Not set'}
              </p>
            </div>
            <button
              onClick={handleResetRootFolder}
              disabled={isResetting || !stats?.rootFolder || stats.rootFolder === 'Not set'}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
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
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
              This will clear all indexed media and return you to the folder selection screen.
            </p>
          </div>
        </div>

        {/* Folder Management */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <FolderTree size={20} />
            Folder Management
          </h2>
          <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            {currentSource ? (
              <>
                <div className="mb-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    Manage subfolders in your root folder. Hidden subfolders will not appear in your feed.
                  </p>
                  <div className="p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">Current Root Folder</p>
                    <p className="text-sm text-gray-900 dark:text-white font-mono break-all">
                      {currentSource.folderPath}
                    </p>
                  </div>
                </div>

                {/* Folder Tree */}
                <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 max-h-96 overflow-y-auto">
                  {isTreeLoading ? (
                    <div className="text-center py-8">
                      <div className="w-8 h-8 border-4 border-gray-300 dark:border-gray-600 border-t-gray-900 dark:border-t-gray-200 rounded-full animate-spin mx-auto mb-2"></div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Loading folder tree...</p>
                    </div>
                  ) : folderTree ? (
                    <FolderTreeView
                      tree={folderTree}
                      onToggleHide={(folderPath) => {
                        hideFolderMutation.mutate({
                          sourceId: currentSource.id,
                          folderPath,
                        });
                      }}
                      isLoading={hideFolderMutation.isPending}
                    />
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                      No subfolders found
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No root folder selected. Please select a folder from the folder selection screen.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Display Preferences */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Display Preferences</h2>

          {/* View Mode */}
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Default View Mode</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleViewModeChange('reels')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${preferences?.viewMode === 'reels'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
              >
                Reels
              </button>
              <button
                onClick={() => handleViewModeChange('feed')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${preferences?.viewMode === 'feed'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
              >
                Feed
              </button>
            </div>
          </div>

          {/* Auto-play Videos */}
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Auto-play Videos</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Videos play automatically when in view</p>
            </div>
            <button
              onClick={handleAutoPlayToggle}
              className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${preferences?.autoPlayVideos
                ? 'bg-blue-600'
                : 'bg-gray-300 dark:bg-gray-600'
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
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Show Source Badge</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Display pseudo-user source on media cards</p>
            </div>
            <button
              onClick={handleSourceBadgeToggle}
              className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${preferences?.showSourceBadge
                ? 'bg-blue-600'
                : 'bg-gray-300 dark:bg-gray-600'
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
        </div>

        {/* About */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">About</h2>
          <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              <span className="font-medium">Local Media Discovery App</span>
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              A social-media-like experience for browsing your local media library
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              All data is stored locally on your device. No external network connectivity required.
            </p>
          </div>
        </div>
      </div>

      {/* Save indicator */}
      {isSaving && (
        <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm">
          <RotateCw size={16} className="animate-spin" />
          Saving...
        </div>
      )}
    </div>
  );
}
