'use client';

import { useState } from 'react';
import { X, Server } from 'lucide-react';
import { getApiBase, authenticatedFetch } from '@/lib/api';

const TEMPLATES: { label: string; yaml: string }[] = [
  {
    label: 'SMB',
    yaml: `type: rclone
displayName: My NAS
rcloneRemoteType: smb
connection:
  remoteName: MyNAS
  host: nas.local
  user: media
  pass: yourpassword
  port: "445"
  domain: WORKGROUP`,
  },
  {
    label: 'SFTP',
    yaml: `type: rclone
displayName: My Server
rcloneRemoteType: sftp
connection:
  remoteName: MyServer
  host: server.local
  user: media
  pass: yourpassword
  port: "22"`,
  },
  {
    label: 'WebDAV',
    yaml: `type: webdav
displayName: Nextcloud
connection:
  url: https://cloud.example.com/remote.php/webdav
  user: alice
  pass: apppassword`,
  },
  {
    label: 'S3',
    yaml: `type: rclone
displayName: My Bucket
rcloneRemoteType: s3
connection:
  remoteName: MyBucket
  region: us-east-1
  access_key_id: AKIAIOSFODNN7EXAMPLE
  secret_access_key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`,
  },
  {
    label: 'Backblaze B2',
    yaml: `type: rclone
displayName: Backblaze B2
rcloneRemoteType: b2
connection:
  remoteName: MyB2
  account: your-account-id
  key: your-application-key`,
  },
  {
    label: 'Dropbox',
    yaml: `type: rclone
displayName: Dropbox
rcloneRemoteType: dropbox
connection:
  remoteName: Dropbox
  token: '{"access_token":"paste-token-here","token_type":"bearer","expiry":"0001-01-01T00:00:00Z"}'`,
  },
  {
    label: '+ Crypt',
    yaml: `type: rclone
displayName: Encrypted NAS
rcloneRemoteType: smb
crypt:
  path: /encrypted        # subfolder on the base remote containing encrypted files
  password: paste-obscured-password-here
  # password2: optional-filename-encryption-salt
connection:
  remoteName: MyNAS
  host: nas.local
  user: media
  pass: yourpassword
  port: "445"`,
  },
];

interface AddServerModalProps {
  onClose: () => void;
  onAdded: () => void;
  /** Pre-fill YAML for editing an existing server */
  initialYaml?: string;
  /** If set, PUT to this server ID instead of POST */
  serverId?: string;
}

export function AddServerModal({ onClose, onAdded, initialYaml, serverId }: AddServerModalProps) {
  const [yaml, setYaml] = useState(initialYaml ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const API_URL = getApiBase();

  const isEdit = !!serverId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!yaml.trim()) return;
    setIsLoading(true);
    setError('');
    try {
      const url = isEdit ? `${API_URL}/api/servers/${serverId}` : `${API_URL}/api/servers`;
      const method = isEdit ? 'PUT' : 'POST';
      const res = await authenticatedFetch(url, { method, body: JSON.stringify({ yaml }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (isEdit ? 'Failed to update server' : 'Failed to add server'));
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : (isEdit ? 'Failed to update server' : 'Failed to add server'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-(--surface) rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--outline-variant)]/30">
          <div className="flex items-center gap-2">
            <Server size={20} className="text-(--primary)" />
            <h2 className="font-semibold text-(--surface-ink)">
              {isEdit ? 'Edit Remote Server' : 'Add Remote Server'}
            </h2>
          </div>
          <button onClick={onClose} className="text-(--outline) hover:text-(--surface-ink)">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 p-5 gap-4">
          {/* Template chips — only show when not editing */}
          {!isEdit && (
            <div>
              <p className="text-xs text-(--outline) mb-2">Start from a template:</p>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => setYaml(t.yaml)}
                    className="px-3 py-1 text-xs rounded-full border border-[var(--outline-variant)]/50 text-(--surface-muted) hover:text-(--surface-ink) hover:border-[var(--primary)] hover:text-(--primary) transition-colors"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isEdit && (
            <p className="text-xs text-(--outline)">
              Edit the YAML below. Re-enter passwords — they are not shown for security.
            </p>
          )}

          <textarea
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            placeholder={`type: rclone\ndisplayName: My Server\nrcloneRemoteType: smb\nconnection:\n  remoteName: MyNAS\n  host: nas.local\n  user: media\n  pass: yourpassword`}
            className="flex-1 min-h-[220px] font-mono text-xs p-3 rounded-xl bg-(--surface-lowest) border border-[var(--outline-variant)]/40 text-(--surface-ink) placeholder-[var(--outline)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            spellCheck={false}
          />

          {error && (
            <p className="text-sm text-(--error) bg-(--error)/10 p-3 rounded-xl">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-full border border-[var(--outline-variant)]/40 text-(--surface-muted) hover:text-(--surface-ink)"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !yaml.trim()}
              className="flex-1 py-2.5 rounded-full bg-(--primary) text-(--on-primary) font-semibold disabled:opacity-50 transition-opacity"
            >
              {isLoading ? (isEdit ? 'Updating…' : 'Adding…') : (isEdit ? 'Update Server' : 'Add Server')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
