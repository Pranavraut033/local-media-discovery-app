/**
 * Recent Folders Component
 * Displays recently accessed folders with quick access and clear option
 */
'use client';

import { useState, useEffect } from 'react';
import { FolderOpen, Trash2, Clock } from 'lucide-react';
import { getRecentFolders, removeRecentFolder, clearRecentFolders, type RecentFolder, addRecentFolder } from '@/lib/storage';
import { getApiBase, authenticatedFetch } from '@/lib/api';

interface RecentFoldersProps {
  onFolderSelect?: (path: string, name: string) => void;
}

export function RecentFolders({ onFolderSelect }: RecentFoldersProps) {
  const API_URL = getApiBase();
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setRecentFolders(getRecentFolders());
  }, []);

  const handleSelectFolder = async (path: string, name: string) => {
    try {
      setIsLoading(true);
      const response = await authenticatedFetch(`${API_URL}/api/config/root-folder`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      });

      if (!response.ok) throw new Error('Failed to set root folder');

      // Add to recent folders
      addRecentFolder(path, name);
      setRecentFolders(getRecentFolders());

      onFolderSelect?.(path, name);
    } catch (error) {
      console.error('Failed to select folder:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveFolder = (path: string) => {
    removeRecentFolder(path);
    setRecentFolders(getRecentFolders());
  };

  const handleClearAll = () => {
    if (window.confirm('Clear all recent folders?')) {
      clearRecentFolders();
      setRecentFolders([]);
    }
  };

  if (recentFolders.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 px-4">
      {/* Header with title and clear button */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Clock size={20} />
          Recent Folders
        </h2>
        <button
          onClick={handleClearAll}
          className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors flex items-center gap-1"
        >
          <Trash2 size={14} />
          Clear
        </button>
      </div>

      {/* Recent folders list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {recentFolders.map((folder) => (
          <div
            key={folder.path}
            className="group relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer overflow-hidden"
          >
            <button
              onClick={() => handleSelectFolder(folder.path, folder.name)}
              disabled={isLoading}
              className="w-full text-left flex items-start gap-3 disabled:opacity-50"
            >
              <div className="shrink-0 mt-1">
                <FolderOpen size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-white truncate">
                  {folder.name || 'Unnamed Folder'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1">
                  {folder.path}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                  {new Date(folder.timestamp).toLocaleDateString()}
                </p>
              </div>
            </button>

            {/* Remove button (visible on hover) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveFolder(folder.path);
              }}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-red-100 dark:bg-red-900/20 hover:bg-red-200 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 p-1.5 rounded-md"
              aria-label="Remove folder"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
