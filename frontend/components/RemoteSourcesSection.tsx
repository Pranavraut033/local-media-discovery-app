'use client';

import { useState } from 'react';
import { Network } from 'lucide-react';
import { RcloneImportModal } from './RcloneImportModal';
import { RcloneManualForm } from './RcloneManualForm';
import RemoteRcloneConfigModal from './RemoteRcloneConfigModal';

interface RemoteSourcesSectionProps {
  className?: string;
  titleClassName?: string;
  containerClassName?: string;
  onSourcesUpdated?: () => void;
}

export function RemoteSourcesSection({
  className = '',
  titleClassName = 'text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2',
  containerClassName = 'p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700',
  onSourcesUpdated,
}: RemoteSourcesSectionProps) {
  const [showRcloneImportModal, setShowRcloneImportModal] = useState(false);
  const [showRcloneManualForm, setShowRcloneManualForm] = useState(false);
  const [showRemoteRcloneConfigModal, setShowRemoteRcloneConfigModal] = useState(false);

  const handleSourcesUpdated = () => {
    onSourcesUpdated?.();
  };

  return (
    <div className={className}>
      <h2 className={titleClassName}>
        <Network size={18} />
        Remote Sources
      </h2>

      <div className={containerClassName}>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Connect media sources from rclone remotes and Android Termux.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => setShowRemoteRcloneConfigModal(true)}
            className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors font-medium text-sm"
          >
            Android rclone (Termux)
          </button>
          <button
            onClick={() => setShowRcloneImportModal(true)}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium text-sm"
          >
            Import Rclone Config
          </button>
          <button
            onClick={() => setShowRcloneManualForm(true)}
            className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium text-sm"
          >
            Add Remote Manually
          </button>
        </div>
      </div>

      <RcloneImportModal
        isOpen={showRcloneImportModal}
        onClose={() => setShowRcloneImportModal(false)}
        onSuccess={() => {
          setShowRcloneImportModal(false);
          handleSourcesUpdated();
        }}
      />
      <RcloneManualForm
        isOpen={showRcloneManualForm}
        onClose={() => setShowRcloneManualForm(false)}
        onSuccess={() => {
          setShowRcloneManualForm(false);
          handleSourcesUpdated();
        }}
      />
      {showRemoteRcloneConfigModal && (
        <RemoteRcloneConfigModal
          onClose={() => setShowRemoteRcloneConfigModal(false)}
          onConfigured={() => {
            setShowRemoteRcloneConfigModal(false);
            handleSourcesUpdated();
          }}
        />
      )}
    </div>
  );
}