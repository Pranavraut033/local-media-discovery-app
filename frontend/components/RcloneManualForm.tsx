'use client';

import { useEffect, useState } from 'react';
import { X, Plus, Loader } from 'lucide-react';
import { validateRcloneRemote, addRcloneSource } from '@/lib/api';

interface RcloneManualFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface RemoteField {
  name: string;
  label: string;
  type: string;
  placeholder?: string;
  defaultValue?: string;
}

const REMOTE_TYPES = [
  { value: 'sftp', label: 'SFTP' },
  { value: 's3', label: 'Amazon S3' },
  { value: 'b2', label: 'Backblaze B2' },
  { value: 'dropbox', label: 'Dropbox' },
  { value: 'drive', label: 'Google Drive' },
  { value: 'onedrive', label: 'OneDrive' },
  { value: 'crypt', label: 'Crypt' },
];

const SFTP_FIELDS: RemoteField[] = [
  { name: 'host', label: 'Host', type: 'text', placeholder: 'sftp.example.com' },
  { name: 'user', label: 'Username', type: 'text', placeholder: 'username' },
  { name: 'pass', label: 'Password', type: 'password', placeholder: 'Password' },
  { name: 'port', label: 'Port', type: 'number', placeholder: '22', defaultValue: '22' },
];

const S3_FIELDS: RemoteField[] = [
  { name: 'access_key_id', label: 'Access Key ID', type: 'text' },
  { name: 'secret_access_key', label: 'Secret Access Key', type: 'password' },
  { name: 'region', label: 'Region', type: 'text', placeholder: 'us-east-1' },
  { name: 'endpoint', label: 'Endpoint (optional)', type: 'text' },
];

export function RcloneManualForm({ isOpen, onClose, onSuccess }: RcloneManualFormProps) {
  const [remoteType, setRemoteType] = useState('sftp');
  const [remoteName, setRemoteName] = useState('');
  const [basePath, setBasePath] = useState('/');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [useCrypt, setUseCrypt] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addProgress, setAddProgress] = useState(0);
  const [addStatus, setAddStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [validationSuccess, setValidationSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setAddProgress(0);
    setAddStatus('');
    setError(null);
    setValidationSuccess(false);
  }, [isOpen]);

  const fields = remoteType === 'sftp' ? SFTP_FIELDS : remoteType === 's3' ? S3_FIELDS : [];

  const handleCredentialChange = (field: string, value: string) => {
    setCredentials((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleValidate = async () => {
    if (!remoteName) {
      setError('Please enter a remote name');
      return;
    }

    try {
      setIsValidating(true);
      setError(null);
      setValidationSuccess(false);

      const remotePath = useCrypt ? `crypt:${remoteName}${basePath}` : `${remoteName}:${basePath}`;
      await validateRcloneRemote(remotePath);

      setValidationSuccess(true);
      setError(null);
    } catch (err) {
      setValidationSuccess(false);
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  const handleAdd = async () => {
    if (!remoteName) {
      setError('Please enter a remote name');
      return;
    }

    let progressTimer: ReturnType<typeof setInterval> | null = null;

    try {
      setIsAdding(true);
      setError(null);
      setAddProgress(10);
      setAddStatus('Preparing remote source...');

      // Validate first
      setAddProgress(30);
      setAddStatus('Validating remote access...');
      const remotePath = useCrypt ? `crypt:${remoteName}${basePath}` : `${remoteName}:${basePath}`;
      await validateRcloneRemote(remotePath);

      // Add source
      setAddProgress(55);
      setAddStatus('Adding source and indexing media...');
      progressTimer = setInterval(() => {
        setAddProgress((prev) => (prev < 90 ? prev + 4 : prev));
      }, 500);

      await addRcloneSource({
        remote_name: remoteName,
        base_path: basePath,
        remote_type: remoteType,
        credentials,
        use_crypt: useCrypt,
      });

      // Success
      if (progressTimer) {
        clearInterval(progressTimer);
      }
      setAddProgress(100);
      setAddStatus('Source added successfully');
      setError(null);
      onSuccess();
      onClose();
    } catch (err) {
      if (progressTimer) {
        clearInterval(progressTimer);
      }
      setAddStatus('Failed to add source');
      setError(err instanceof Error ? err.message : 'Failed to add remote source');
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer);
      }
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
            <Plus size={20} />
            Add Remote Manually
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
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Remote Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Remote Type
            </label>
            <select
              value={remoteType}
              onChange={(e) => {
                setRemoteType(e.target.value);
                setCredentials({});
              }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {REMOTE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Remote Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Remote Name
            </label>
            <input
              type="text"
              value={remoteName}
              onChange={(e) => setRemoteName(e.target.value)}
              placeholder="my-sftp-server"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              A friendly name for this remote (letters, numbers, hyphens)
            </p>
          </div>

          {/* Credentials Fields */}
          {fields.length > 0 && (
            <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              {fields.map((field) => (
                <div key={field.name}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {field.label}
                  </label>
                  <input
                    type={field.type}
                    value={credentials[field.name] || (field.defaultValue ? field.defaultValue : '')}
                    onChange={(e) => handleCredentialChange(field.name, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
          )}

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
              Path within the remote to index (e.g., /media or /photos)
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
              Wrap with crypt remote
            </label>
          </div>
          {useCrypt && (
            <p className="text-xs text-gray-500 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/20 p-2 rounded border border-blue-200 dark:border-blue-800">
              Creates a transparent encryption layer. The remote will be accessible as crypt:{remoteName}.
            </p>
          )}

          {/* Add Progress */}
          {isAdding && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-blue-800 dark:text-blue-300">{addStatus || 'Adding source...'}</p>
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">{addProgress}%</p>
              </div>
              <div className="h-2 w-full rounded-full bg-blue-100 dark:bg-blue-950/60 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300 ease-out"
                  style={{ width: `${addProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Validation Success */}
          {validationSuccess && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <p className="text-sm text-green-800 dark:text-green-700">✓ Remote validated successfully!</p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-800 dark:text-red-700">{error}</p>
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
          <button
            onClick={handleValidate}
            disabled={isValidating || isAdding || !remoteName}
            className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
          >
            {isValidating ? <Loader size={16} className="animate-spin" /> : null}
            {isValidating ? 'Validating...' : 'Validate'}
          </button>
          <button
            onClick={handleAdd}
            disabled={isValidating || isAdding || !remoteName}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
          >
            {isAdding ? <Loader size={16} className="animate-spin" /> : null}
            {isAdding ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
