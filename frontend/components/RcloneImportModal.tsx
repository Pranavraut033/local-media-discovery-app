'use client';

import { useState, useEffect } from 'react';
import { X, Upload, Loader, Play } from 'lucide-react';
import { fetchRcloneRemotes, validateRcloneRemote, addRcloneSource, RcloneRemote } from '@/lib/api';
import { useIndexingStore } from '@/lib/stores/indexing.store';
import { useUIStore } from '@/lib/stores/ui.store';

interface RcloneImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onShowMedia?: () => void;
  initialRemote?: string;
}

export function RcloneImportModal({ isOpen, onClose, onSuccess, onShowMedia, initialRemote }: RcloneImportModalProps) {
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
  const lastUsedRemote = useUIStore((s) => s.preferences.lastRcloneRemote);
  const setPreferences = useUIStore((s) => s.setPreferences);

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

        // Pre-select initialRemote (from chip), or last-used, or first
        const preferred = initialRemote ?? lastUsedRemote;
        if (preferred && data.some((r: RcloneRemote) => r.name === preferred)) {
          setSelectedRemote(preferred);
        } else if (data.length > 0) {
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
  }, [isOpen, initialRemote]);

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

      // Persist last-used remote
      setPreferences({ lastRcloneRemote: selectedRemote ?? undefined });

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
      <div className="bg-(--surface-lowest) rounded-2xl max-w-md w-full max-h-[90vh] flex flex-col shadow-(--ambient-shadow)">
        {/* Header */}
        <div className="bg-(--surface-low) rounded-t-2xl px-4 py-3 flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-(--surface-ink) flex items-center gap-2">
            <Upload size={18} />
            Import Rclone Remote
          </h2>
          <button
            onClick={onClose}
            className="text-(--outline) hover:text-(--surface-ink) transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader size={24} className="text-(--outline) animate-spin mb-2" />
              <p className="text-sm text-(--surface-muted)">Loading rclone remotes...</p>
            </div>
          ) : remotes.length === 0 ? (
            <div className="p-4 bg-(--surface-high) rounded-xl">
              <p className="text-sm text-(--surface-muted)">
                No remotes found. Make sure rclone is installed and configured with remotes using `rclone config`.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Remote Selection */}
              <div>
                <label className="block text-sm font-medium text-(--surface-muted) mb-2">
                  Select Remote
                </label>
                <select
                  value={selectedRemote || ''}
                  onChange={(e) => setSelectedRemote(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-(--surface-highest) text-(--surface-ink) focus:outline-none focus:ring-1 focus:ring-(--primary)/30"
                >
                  {remotes.map((remote) => (
                    <option key={remote.name} value={remote.name}>
                      {remote.name} ({remote.type}){remote.name === lastUsedRemote ? ' · recent' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Base Path */}
              <div>
                <label className="block text-sm font-medium text-(--surface-muted) mb-2">
                  Base Path
                </label>
                <input
                  type="text"
                  value={basePath}
                  onChange={(e) => setBasePath(e.target.value)}
                  placeholder="/"
                  className="w-full px-3 py-2 rounded-lg bg-(--surface-highest) text-(--surface-ink) placeholder:text-(--outline) focus:outline-none focus:ring-1 focus:ring-(--primary)/30"
                />
                <p className="text-xs text-(--outline) mt-1">
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
                <label htmlFor="useCrypt" className="text-sm text-(--surface-muted) cursor-pointer">
                  Use as crypt remote
                </label>
              </div>
              {useCrypt && (
                <p className="text-xs text-(--outline) bg-(--surface-low) p-2 rounded-lg">
                  Will create a crypt: prefix for transparent encryption. Make sure you have a crypt remote configured
                  in rclone.
                </p>
              )}

              {/* Live indexing progress from SSE */}
              {activeJob && (
                <div className="p-3 bg-(--secondary-container)/30 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-(--on-secondary-container)">
                      {activeJob.status === 'completed'
                        ? 'Indexing complete'
                        : activeJob.stage === 'discovery'
                          ? `Discovering files${activeJob.filesFound ? ` — ${activeJob.filesFound} found` : ''}…`
                          : activeJob.done !== undefined && activeJob.total
                            ? `Hashing ${activeJob.done}/${activeJob.total}`
                            : 'Queued…'}
                    </p>
                    {activeJob.total ? (
                      <p className="text-xs font-semibold text-(--on-secondary-container)">
                        {Math.round(((activeJob.done ?? 0) / activeJob.total) * 100)}%
                      </p>
                    ) : null}
                  </div>
                  {activeJob.total ? (
                    <div className="h-2 w-full rounded-full bg-(--secondary-container)/50 overflow-hidden">
                      <div
                        className="h-full bg-(--secondary) transition-all duration-300 ease-out"
                        style={{ width: `${Math.round(((activeJob.done ?? 0) / activeJob.total) * 100)}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="p-3 bg-(--error)/10 rounded-xl">
                  <p className="text-sm text-(--error)">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-(--surface-low) rounded-b-2xl px-4 py-3 flex gap-2 shrink-0">
          <button
            onClick={onClose}
            disabled={isValidating || isAdding}
            className="flex-1 px-4 py-2 rounded-xl bg-(--surface-high) hover:bg-(--surface-highest) text-(--surface-ink) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          {activeJob ? (
            <button
              onClick={() => { onShowMedia?.(); onClose(); }}
              className="flex-1 px-4 py-2 bg-(--primary) hover:opacity-90 text-(--on-primary) rounded-xl transition-opacity font-medium flex items-center justify-center gap-2"
            >
              <Play size={16} />
              Show Media
            </button>
          ) : (
            <>
              <button
                onClick={handleValidate}
                disabled={isValidating || isAdding || !selectedRemote}
                className="flex-1 px-4 py-2 bg-(--secondary-container) hover:opacity-80 text-(--on-secondary-container) disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-opacity font-medium flex items-center justify-center gap-2"
              >
                {isValidating ? <Loader size={16} className="animate-spin" /> : null}
                {isValidating ? 'Validating...' : 'Validate'}
              </button>
              <button
                onClick={handleAdd}
                disabled={isValidating || isAdding || !selectedRemote}
                className="flex-1 px-4 py-2 bg-(--primary) hover:opacity-90 text-(--on-primary) disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-opacity font-medium flex items-center justify-center gap-2"
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
