'use client';

import { useState, useEffect } from 'react';
import { X, Upload, Loader, Play } from 'lucide-react';
import { fetchRcloneRemotes, validateRcloneRemote, addRcloneSource, RcloneRemote } from '@/lib/api';
import { useIndexingStore } from '@/lib/stores/indexing.store';

interface RcloneImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onShowMedia?: () => void;
}

export function RcloneImportModal({ isOpen, onClose, onSuccess, onShowMedia }: RcloneImportModalProps) {
  const [remotes, setRemotes] = useState<RcloneRemote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRemote, setSelectedRemote] = useState<string | null>(null);
  const [basePath, setBasePath] = useState('/');
  const [useCrypt, setUseCrypt] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const jobs = useIndexingStore((s) => s.jobs);
  const activeJob = activeJobId ? jobs[activeJobId] : null;

  // Load remotes when modal opens
  useEffect(() => {
    if (!isOpen) return;

    setActiveJobId(null);

    const loadRemotes = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchRcloneRemotes();
        setRemotes(data);

        if (data.length > 0) {
          setSelectedRemote(data[0].name);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load rclone remotes');
        setRemotes([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadRemotes();
  }, [isOpen]);

  const handleValidate = async () => {
    if (!selectedRemote) {
      setError('Please select a remote');
      return;
    }

    try {
      setIsValidating(true);
      setError(null);

      const remotePath = useCrypt ? `crypt:${selectedRemote}${basePath}` : `${selectedRemote}:${basePath}`;
      await validateRcloneRemote(remotePath);

      // If validation succeeds, show success
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  const handleAdd = async () => {
    if (!selectedRemote) {
      setError('Please select a remote');
      return;
    }

    try {
      setIsAdding(true);
      setError(null);

      const remote = remotes.find((r) => r.name === selectedRemote);
      if (!remote) {
        setError('Selected remote not found');
        return;
      }

      // Validate first
      const remotePath = useCrypt ? `crypt:${selectedRemote}${basePath}` : `${selectedRemote}:${basePath}`;
      await validateRcloneRemote(remotePath);

      // Add source – returns immediately with jobId (202 Accepted)
      const result = await addRcloneSource({
        remote_name: selectedRemote,
        base_path: basePath,
        remote_type: remote.type,
        use_crypt: useCrypt,
      });

      if (result.jobId) {
        setActiveJobId(result.jobId);
      }

      // Notify parent so feed can refresh
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add remote source');
    } finally {
      setIsAdding(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg max-w-md w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between sticky top-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Upload size={20} />
            Import Rclone Remote
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader size={24} className="text-gray-400 dark:text-gray-600 animate-spin mb-2" />
              <p className="text-sm text-gray-600 dark:text-gray-400">Loading rclone remotes...</p>
            </div>
          ) : remotes.length === 0 ? (
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
              <p className="text-sm text-yellow-800 dark:text-yellow-700">
                No remotes found. Make sure rclone is installed and configured with remotes using `rclone config`.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Remote Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select Remote
                </label>
                <select
                  value={selectedRemote || ''}
                  onChange={(e) => setSelectedRemote(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {remotes.map((remote) => (
                    <option key={remote.name} value={remote.name}>
                      {remote.name} ({remote.type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Base Path */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Base Path
                </label>
                <input
                  type="text"
                  value={basePath}
                  onChange={(e) => setBasePath(e.target.value)}
                  placeholder="/"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Path within the remote to index (e.g., /media/pictures)
                </p>
              </div>

              {/* Crypt Checkbox */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="useCrypt"
                  checked={useCrypt}
                  onChange={(e) => setUseCrypt(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="useCrypt" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  Use as crypt remote
                </label>
              </div>
              {useCrypt && (
                <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-2 rounded">
                  Will create a crypt: prefix for transparent encryption. Make sure you have a crypt remote configured
                  in rclone.
                </p>
              )}

              {/* Live indexing progress from SSE */}
              {activeJob && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                      {activeJob.status === 'completed'
                        ? 'Indexing complete'
                        : activeJob.stage === 'discovery'
                        ? `Discovering files${activeJob.filesFound ? ` — ${activeJob.filesFound} found` : ''}…`
                        : activeJob.done !== undefined && activeJob.total
                        ? `Hashing ${activeJob.done}/${activeJob.total}`
                        : 'Queued…'}
                    </p>
                    {activeJob.total ? (
                      <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                        {Math.round(((activeJob.done ?? 0) / activeJob.total) * 100)}%
                      </p>
                    ) : null}
                  </div>
                  {activeJob.total ? (
                    <div className="h-2 w-full rounded-full bg-blue-100 dark:bg-blue-950/60 overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all duration-300 ease-out"
                        style={{ width: `${Math.round(((activeJob.done ?? 0) / activeJob.total) * 100)}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                  <p className="text-sm text-red-800 dark:text-red-700">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 flex gap-2 sticky bottom-0 bg-white dark:bg-gray-900">
          <button
            onClick={onClose}
            disabled={isValidating || isAdding}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          {activeJob ? (
            <button
              onClick={() => { onShowMedia?.(); onClose(); }}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
            >
              <Play size={16} />
              Show Media
            </button>
          ) : (
            <>
              <button
                onClick={handleValidate}
                disabled={isValidating || isAdding || !selectedRemote}
                className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
              >
                {isValidating ? <Loader size={16} className="animate-spin" /> : null}
                {isValidating ? 'Validating...' : 'Validate'}
              </button>
              <button
                onClick={handleAdd}
                disabled={isValidating || isAdding || !selectedRemote}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
              >
                {isAdding ? <Loader size={16} className="animate-spin" /> : null}
                {isAdding ? 'Adding...' : 'Add'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
