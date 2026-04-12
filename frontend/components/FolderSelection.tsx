/**
 * Folder Selection Component
 * Allows users to browse and select a root folder for media indexing
 * Privacy: Root folder path is stored in browser localStorage, not on the backend
 */
'use client';

import { useState, useEffect } from 'react';
import { Folder, ChevronRight, Home, HardDrive, Play } from 'lucide-react';
import { getApiBase, authenticatedFetch } from '@/lib/api';
import { RecentFolders } from './RecentFolders';
import { setRootFolder } from '@/lib/storage';
import { RemoteSourcesSection } from './RemoteSourcesSection';
import { useIndexingStore } from '@/lib/stores/indexing.store';

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
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const jobs = useIndexingStore((s) => s.jobs);
  const activeJob = activeJobId ? jobs[activeJobId] : null;

  // Load root directories on mount
  useEffect(() => {
    loadRoots();
  }, []);

  const loadRoots = async () => {
    try {
      setIsLoading(true);
      const response = await authenticatedFetch(`${API_URL}/api/filesystem/roots`);
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
      const response = await authenticatedFetch(
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

      // Store root folder in localStorage for privacy
      setRootFolder(path);

      // Trigger indexing on backend (202 Accepted + jobId)
      const response = await authenticatedFetch(`${API_URL}/api/config/root-folder`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      });

      if (!response.ok) {
        setRootFolder('');
        throw new Error('Failed to set root folder');
      }

      const data = await response.json();
      if (data.jobId) {
        setActiveJobId(data.jobId);
      }

      // Notify parent so feed loads with pending items immediately
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

        {/* Recent Folders Section */}
        <RecentFolders onFolderSelect={onFolderSelected} />

        {/* Live indexing progress */}
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

        {/* Show Media button – always visible after folder is set */}
        {activeJobId && (
          <button
            onClick={() => onFolderSelected?.()}
            className="focus-ring w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold py-4 px-6 rounded-full transition-colors"
          >
            <Play size={18} />
            Show Media
          </button>
        )}

        <button
          onClick={() => setShowBrowser(true)}
          disabled={isLoading}
          className="focus-ring w-full bg-linear-to-r from-(--primary) to-(--primary-container) disabled:bg-(--outline) text-(--on-primary) font-semibold py-4 px-6 rounded-full transition-opacity"
        >
          Browse Host Folders
        </button>

        <RemoteSourcesSection
          className="w-full"
          titleClassName="text-lg font-semibold text-(--surface-ink) mb-3 flex items-center gap-2"
          containerClassName="surface-panel"
          onSourcesUpdated={() => {
            onFolderSelected?.();
          }}
        />

        {error && (
          <div className="w-full p-4 bg-(--error)/10 rounded-2xl">
            <p className="text-sm text-(--error)">{error}</p>
          </div>
        )}

        <div className="text-sm text-(--surface-muted) text-center">
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
          <h2 className="text-2xl font-bold text-(--surface-ink)">
            Browse Folders
          </h2>
          <button
            onClick={() => {
              setShowBrowser(false);
              setCurrentPath('');
              setDirectories([]);
            }}
            className="text-sm text-(--outline) hover:text-(--surface-ink)"
          >
            Cancel
          </button>
        </div>

        {/* Current path display */}
        {currentPath && (
          <div className="flex items-center gap-2 p-3 bg-(--surface-high) rounded-xl overflow-x-auto">
            <Folder size={16} className="shrink-0 text-(--outline)" />
            <span className="text-sm font-mono text-(--surface-ink) truncate">
              {currentPath}
            </span>
          </div>
        )}

        {/* Select current folder button */}
        {currentPath && (
          <button
            onClick={() => handleSelectFolder(currentPath)}
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

      {/* Directory listing */}
      <div className="flex-1 overflow-y-auto bg-(--surface-lowest) rounded-2xl">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-4 border-(--outline-variant) border-t-[var(--secondary)] rounded-full animate-spin"></div>
          </div>
        ) : !currentPath ? (
          // Show root directories
          <div className="divide-y divide-[var(--outline-variant)]/20">
            {roots.map((root) => (
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
                <span className="flex-1 font-medium text-(--surface-ink)">
                  {root.name}
                </span>
                <ChevronRight size={20} className="text-(--outline) shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          // Show directory contents
          <div className="divide-y divide-[var(--outline-variant)]/20">
            {/* Parent directory button */}
            {parentPath && (
              <button
                onClick={() => loadDirectory(parentPath)}
                className="w-full flex items-center gap-3 p-4 hover:bg-(--surface-low) transition-colors text-left"
              >
                <Folder size={20} className="text-(--outline) shrink-0" />
                <span className="flex-1 font-medium text-(--surface-ink)">..</span>
                <ChevronRight size={20} className="text-(--outline) shrink-0" />
              </button>
            )}

            {/* Subdirectories */}
            {directories.length === 0 ? (
              <div className="p-8 text-center text-(--outline)">
                No subdirectories found
              </div>
            ) : (
              directories.map((dir) => (
                <button
                  key={dir.path}
                  onClick={() => dir.accessible && loadDirectory(dir.path)}
                  disabled={!dir.accessible}
                  className={`w-full flex items-center gap-3 p-4 transition-colors text-left ${dir.accessible
                    ? 'hover:bg-(--surface-low)'
                    : 'opacity-50 cursor-not-allowed'
                    }`}
                >
                  <Folder
                    size={20}
                    className={`shrink-0 ${dir.accessible
                      ? 'text-(--outline)'
                      : 'text-(--outline-variant)'
                      }`}
                  />
                  <span className="flex-1 text-(--surface-ink) truncate">
                    {dir.name}
                  </span>
                  {dir.accessible && (
                    <ChevronRight size={20} className="text-(--outline) shrink-0" />
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
