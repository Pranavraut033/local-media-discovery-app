'use client';

import { useState, useEffect } from 'react';
import { Folder, ChevronRight, Home, HardDrive } from 'lucide-react';
import { getApiBase } from '@/lib/api';
import { RecentFolders } from './RecentFolders';
import { addRecentFolder } from '@/lib/storage';

interface FolderSelectionProps {
  onFolderSelected?: () => void;
}

interface Directory {
  name: string;
  path: string;
  accessible: boolean;
}

interface RootDirectory {
  path: string;
  name: string;
  type: 'home' | 'common' | 'system';
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

  // Load root directories on mount
  useEffect(() => {
    loadRoots();
  }, []);

  const loadRoots = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${API_URL}/api/filesystem/roots`);
      if (!response.ok) throw new Error('Failed to load roots');
      const data = await response.json();
      setRoots(data.roots || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load directories');
    } finally {
      setIsLoading(false);
    }
  };

  const loadDirectory = async (path: string) => {
    try {
      setIsLoading(true);
      setError('');
      const response = await fetch(
        `${API_URL}/api/filesystem/list?${new URLSearchParams({ path })}`
      );
      if (!response.ok) throw new Error('Failed to load directory');
      const data = await response.json();
      setCurrentPath(data.currentPath);
      setDirectories(data.directories || []);
      setParentPath(data.parentPath);
    } catch (err: any) {
      setError(err.message || 'Failed to load directory');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectFolder = async (path: string) => {
    try {
      setIsLoading(true);
      setError('');
      const response = await fetch(`${API_URL}/api/config/root-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      if (!response.ok) throw new Error('Failed to set root folder');

      // Extract folder name from path
      const folderName = path.split('/').filter(Boolean).pop() || path;
      addRecentFolder(path, folderName);

      onFolderSelected?.();
    } catch (err: any) {
      setError(err.message || 'Failed to set folder');
    } finally {
      setIsLoading(false);
    }
  };

  if (!showBrowser) {
    // Initial screen with option to browse or enter manually
    return (
      <div className="flex flex-col items-center gap-6 w-full max-w-2xl">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="rounded-full bg-blue-100 dark:bg-blue-900/30 p-6">
            <Folder className="w-12 h-12 text-blue-600 dark:text-blue-400" />
          </div>

          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Select Your Media Folder
          </h1>

          <p className="text-gray-600 dark:text-gray-400">
            Choose a folder on the host computer containing your photos and videos
          </p>
        </div>

        {/* Recent Folders Section */}
        <RecentFolders onFolderSelect={onFolderSelected} />

        <button
          onClick={() => setShowBrowser(true)}
          disabled={isLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-4 px-6 rounded-lg transition-colors"
        >
          Browse Host Folders
        </button>

        {error && (
          <div className="w-full p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
          <p>💡 All media stays local and private on your host computer</p>
        </div>
      </div>
    );
  }

  // File browser interface
  return (
    <div className="flex flex-col w-full max-w-2xl h-150">
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Browse Folders
          </h2>
          <button
            onClick={() => {
              setShowBrowser(false);
              setCurrentPath('');
              setDirectories([]);
            }}
            className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            Cancel
          </button>
        </div>

        {/* Current path display */}
        {currentPath && (
          <div className="flex items-center gap-2 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-x-auto">
            <Folder size={16} className="shrink-0" />
            <span className="text-sm font-mono text-gray-900 dark:text-white truncate">
              {currentPath}
            </span>
          </div>
        )}

        {/* Select current folder button */}
        {currentPath && (
          <button
            onClick={() => handleSelectFolder(currentPath)}
            disabled={isLoading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            {isLoading ? 'Setting...' : 'Use This Folder'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Directory listing */}
      <div className="flex-1 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-4 border-gray-300 dark:border-gray-600 border-t-blue-600 rounded-full animate-spin"></div>
          </div>
        ) : !currentPath ? (
          // Show root directories
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {roots.map((root) => (
              <button
                key={root.path}
                onClick={() => loadDirectory(root.path)}
                className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
              >
                {root.type === 'home' ? (
                  <Home size={20} className="text-blue-600 dark:text-blue-400 shrink-0" />
                ) : root.type === 'system' ? (
                  <HardDrive size={20} className="text-gray-600 dark:text-gray-400 shrink-0" />
                ) : (
                  <Folder size={20} className="text-gray-600 dark:text-gray-400 shrink-0" />
                )}
                <span className="flex-1 font-medium text-gray-900 dark:text-white">
                  {root.name}
                </span>
                <ChevronRight size={20} className="text-gray-400 shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          // Show directory contents
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {/* Parent directory button */}
            {parentPath && (
              <button
                onClick={() => loadDirectory(parentPath)}
                className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
              >
                <Folder size={20} className="text-gray-600 dark:text-gray-400 shrink-0" />
                <span className="flex-1 font-medium text-gray-900 dark:text-white">..</span>
                <ChevronRight size={20} className="text-gray-400 shrink-0" />
              </button>
            )}

            {/* Subdirectories */}
            {directories.length === 0 ? (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                No subdirectories found
              </div>
            ) : (
              directories.map((dir) => (
                <button
                  key={dir.path}
                  onClick={() => dir.accessible && loadDirectory(dir.path)}
                  disabled={!dir.accessible}
                  className={`w-full flex items-center gap-3 p-4 transition-colors text-left ${dir.accessible
                    ? 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    : 'opacity-50 cursor-not-allowed'
                    }`}
                >
                  <Folder
                    size={20}
                    className={`shrink-0 ${dir.accessible
                      ? 'text-gray-600 dark:text-gray-400'
                      : 'text-gray-400 dark:text-gray-600'
                      }`}
                  />
                  <span className="flex-1 text-gray-900 dark:text-white truncate">
                    {dir.name}
                  </span>
                  {dir.accessible && (
                    <ChevronRight size={20} className="text-gray-400 shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
