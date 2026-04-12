'use client';

import { useState, useEffect } from 'react';
import { Network, Zap, Clock } from 'lucide-react';
import { RcloneImportModal } from './RcloneImportModal';
import { fetchRcloneRemotes } from '@/lib/api';
import type { RcloneRemote } from '@/lib/api';
import { useUIStore } from '@/lib/stores/ui.store';

interface RemoteSourcesSectionProps {
  className?: string;
  titleClassName?: string;
  containerClassName?: string;
  onSourcesUpdated?: () => void;
}

export function RemoteSourcesSection({
  className = '',
  titleClassName = 'text-lg font-semibold text-(--surface-ink) mb-3 flex items-center gap-2',
  containerClassName = 'p-4 bg-(--surface-low) rounded-2xl',
  onSourcesUpdated,
}: RemoteSourcesSectionProps) {
  const [showRcloneImportModal, setShowRcloneImportModal] = useState(false);
  const [initialRemote, setInitialRemote] = useState<string | undefined>(undefined);
  const [initialBasePath, setInitialBasePath] = useState<string | undefined>(undefined);
  const [remotes, setRemotes] = useState<RcloneRemote[]>([]);

  const recentRcloneConfigs = useUIStore((s) => s.preferences.recentRcloneConfigs);

  useEffect(() => {
    fetchRcloneRemotes()
      .then(setRemotes)
      .catch(() => setRemotes([]));
  }, []);

  const handleSourcesUpdated = () => {
    onSourcesUpdated?.();
    fetchRcloneRemotes()
      .then(setRemotes)
      .catch(() => { });
  };

  const openImportWithRemote = (remoteName: string, basePath?: string) => {
    setInitialRemote(remoteName);
    setInitialBasePath(basePath);
    setShowRcloneImportModal(true);
  };

  return (
    <div className={className}>
      <h2 className={titleClassName}>
        <Network size={18} />
        Remote Sources{remotes.length > 0 ? ` (${remotes.length} configured)` : ''}
      </h2>

      <div className={containerClassName}>
        {/* Quick Connect chips for already-configured remotes */}
        {remotes.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-(--outline) mb-2 flex items-center gap-1">
              <Zap size={12} />
              Quick Connect
            </p>
            <div className="flex flex-wrap gap-2">
              {remotes.map((remote) => (
                <button
                  key={remote.name}
                  onClick={() => openImportWithRemote(remote.name)}
                  className="px-3 py-1 bg-(--secondary-container) text-(--on-secondary-container) text-sm font-medium rounded-full transition-opacity hover:opacity-80"
                >
                  {remote.name}
                  <span className="ml-1 text-xs opacity-60">({remote.type})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent remote:basePath chips */}
        {recentRcloneConfigs.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-(--outline) mb-2 flex items-center gap-1">
              <Clock size={12} />
              Recent
            </p>
            <div className="flex flex-wrap gap-2">
              {recentRcloneConfigs.map((cfg) => (
                <button
                  key={`${cfg.remoteName}:${cfg.basePath}`}
                  onClick={() => openImportWithRemote(cfg.remoteName, cfg.basePath)}
                  className="px-3 py-1 bg-(--surface-high) text-(--surface-ink) text-sm font-medium rounded-full transition-opacity hover:opacity-80"
                >
                  {cfg.remoteName}:{cfg.basePath}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-sm text-(--surface-muted) mb-3">
          Connect media sources from remotes configured in rclone on the server.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => { setInitialRemote(undefined); setInitialBasePath(undefined); setShowRcloneImportModal(true); }}
            className="flex-1 px-4 py-2 bg-(--secondary-container) hover:opacity-80 text-(--on-secondary-container) rounded-xl transition-opacity font-medium text-sm"
          >
            Import Rclone Config
          </button>
        </div>
      </div>

      <RcloneImportModal
        isOpen={showRcloneImportModal}
        onClose={() => { setShowRcloneImportModal(false); setInitialRemote(undefined); setInitialBasePath(undefined); }}
        onSuccess={() => {
          setShowRcloneImportModal(false);
          setInitialRemote(undefined);
          setInitialBasePath(undefined);
          handleSourcesUpdated();
        }}
        initialRemote={initialRemote}
        initialBasePath={initialBasePath}
      />
    </div>
  );
}