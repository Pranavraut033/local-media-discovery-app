/**
 * Recent Folders Component
 * Displays recently accessed folders with quick access and clear option
 */
'use client';

import { useState, useEffect } from 'react';
import { FolderOpen, Clock } from 'lucide-react';
import { getApiBase, authenticatedFetch } from '@/lib/api';
import { setRootFolder } from '@/lib/storage';

interface RecentFoldersProps {
  onFolderSelect?: (path: string, name: string) => void;
}

interface RecentFolder {
  path: string;
  name: string;
  lastIndexedAt: number;
}

export function RecentFolders({ onFolderSelect }: RecentFoldersProps) {
  const API_URL = getApiBase();
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadRecentFolders = async () => {
      try {
        setIsLoading(true);
        const response = await authenticatedFetch(`${API_URL}/api/config/recent-folders`);
        if (!response.ok) {
          throw new Error('Failed to load recent folders');
        }

        const data = await response.json();
        setRecentFolders(Array.isArray(data.folders) ? data.folders : []);
      } catch (error) {
        console.error('Failed to load recent folders from DB:', error);
        setRecentFolders([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadRecentFolders();
  }, [API_URL]);

  const handleSelectFolder = async (path: string, name: string) => {
    try {
      setIsLoading(true);
      const response = await authenticatedFetch(`${API_URL}/api/config/root-folder`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      });

      if (!response.ok) throw new Error('Failed to set root folder');

      setRootFolder(path);
      onFolderSelect?.(path, name);
    } catch (error) {
      console.error('Failed to select folder:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading && recentFolders.length === 0) {
    return (
      <div className="mb-6 px-4">
        <h2 className="text-lg font-semibold text-(--surface-ink) flex items-center gap-2">
          <Clock size={20} />
          Recent Folders
        </h2>
        <p className="text-sm text-(--outline) mt-2">Loading recent folders...</p>
      </div>
    );
  }

  if (recentFolders.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 px-4">
      {/* Header with title and clear button */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-(--surface-ink) flex items-center gap-2">
          <Clock size={20} />
          Recent Folders
        </h2>
        <span className="text-xs text-(--outline)">From your indexed history</span>
      </div>

      {/* Recent folders list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {recentFolders.map((folder) => (
          <div
            key={folder.path}
            className="group relative bg-(--surface-lowest) rounded-2xl p-4 hover:bg-(--surface-low) transition-colors cursor-pointer overflow-hidden"
          >
            <button
              onClick={() => handleSelectFolder(folder.path, folder.name)}
              disabled={isLoading}
              className="w-full text-left flex items-start gap-3 disabled:opacity-50"
            >
              <div className="shrink-0 mt-1">
                <FolderOpen size={20} className="text-(--secondary)" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-(--surface-ink) truncate">
                  {folder.name || 'Unnamed Folder'}
                </p>
                <p className="text-xs text-(--surface-muted) truncate mt-1">
                  {folder.path}
                </p>
                <p className="text-xs text-(--outline) mt-2">
                  Last indexed {new Date(folder.lastIndexedAt * 1000).toLocaleDateString()}
                </p>
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
