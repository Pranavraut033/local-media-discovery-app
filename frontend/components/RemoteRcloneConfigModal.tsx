'use client';

import React, { useState, useEffect } from 'react';

interface RemoteRcloneConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  enabled: boolean;
}

interface RemoteRcloneConfigModalProps {
  onClose: () => void;
  onConfigured?: () => void;
}

export default function RemoteRcloneConfigModal({
  onClose,
  onConfigured,
}: RemoteRcloneConfigModalProps) {
  const [config, setConfig] = useState<RemoteRcloneConfig>({
    host: '',
    port: 5572,
    username: '',
    password: '',
    enabled: false,
  });

  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Load current config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch('/api/rclone/remote-config');
        if (response.ok) {
          const data = await response.json();
          if (data.enabled) {
            setConfig(data);
          }
        }
      } catch (err) {
        console.error('Failed to load remote rclone config:', err);
      }
    };
    loadConfig();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]: name === 'port' ? parseInt(value) || 5572 : value,
    }));
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch('/api/rclone/remote-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: config.host,
          port: config.port,
          username: config.username || undefined,
          password: config.password || undefined,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setMessage(`✓ Connected! rclone version: ${data.version}`);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(`Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch('/api/rclone/remote-config/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: config.host,
          port: config.port,
          username: config.username || undefined,
          password: config.password || undefined,
        }),
      });

      if (response.ok) {
        setMessage('✓ Configuration saved successfully!');
        setTimeout(() => {
          onConfigured?.();
          onClose();
        }, 1500);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to save configuration');
      }
    } catch (err) {
      setError(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!window.confirm('Disable remote rclone and switch to local mode?')) {
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch('/api/rclone/remote-config/disable', {
        method: 'POST',
      });

      if (response.ok) {
        setMessage('✓ Remote rclone disabled');
        setTimeout(() => {
          setConfig({
            host: '',
            port: 5572,
            username: '',
            password: '',
            enabled: false,
          });
          onConfigured?.();
          onClose();
        }, 1500);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to disable');
      }
    } catch (err) {
      setError(`Failed to disable: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[500px] flex-col overflow-y-auto rounded-xl border border-white/10 bg-neutral-900 text-neutral-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="font-serif text-xl tracking-tight">Configure Android rclone Daemon</h2>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-md text-xl text-neutral-300 transition-colors hover:bg-white/10 hover:text-neutral-100"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-5 text-sm text-neutral-300">
            Connect to an rclone daemon running on Android (via Termux). The daemon should be
            accessible on your local network.
          </p>

          <div className="mb-4">
            <label htmlFor="host" className="mb-1.5 block text-sm font-semibold text-neutral-100">
              Host / IP Address *
            </label>
            <input
              type="text"
              id="host"
              name="host"
              value={config.host}
              onChange={handleChange}
              placeholder="e.g., 192.168.1.100 or rclone-device.local"
              className="w-full rounded-md border border-white/15 bg-neutral-950 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              required
            />
            <small className="mt-1 block text-xs text-neutral-400">
              IP address or hostname of Android device
            </small>
          </div>

          <div className="mb-4">
            <label htmlFor="port" className="mb-1.5 block text-sm font-semibold text-neutral-100">
              Port
            </label>
            <input
              type="number"
              id="port"
              name="port"
              value={config.port}
              onChange={handleChange}
              min="1"
              max="65535"
              className="w-full rounded-md border border-white/15 bg-neutral-950 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            />
            <small className="mt-1 block text-xs text-neutral-400">Default rclone RPC port: 5572</small>
          </div>

          <div className="mb-4">
            <label htmlFor="username" className="mb-1.5 block text-sm font-semibold text-neutral-100">
              Username (optional)
            </label>
            <input
              type="text"
              id="username"
              name="username"
              value={config.username}
              onChange={handleChange}
              placeholder="rclone auth username"
              className="w-full rounded-md border border-white/15 bg-neutral-950 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-neutral-100">
              Password (optional)
            </label>
            <input
              type="password"
              id="password"
              name="password"
              value={config.password}
              onChange={handleChange}
              placeholder="rclone auth password"
              className="w-full rounded-md border border-white/15 bg-neutral-950 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            />
          </div>

          {message && (
            <div className="mb-4 rounded-md border border-emerald-400/20 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">
              {message}
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-md border border-red-400/20 bg-red-500/15 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="mt-5 rounded-lg border border-white/10 bg-neutral-950/80 p-4 text-sm">
            <h4 className="mb-3 text-sm font-semibold text-neutral-100">Android Installation Guide (Termux)</h4>
            <ol className="list-decimal space-y-2 pl-5 text-neutral-300">
              <li>Install Termux from F-Droid (recommended) and open it once.</li>
              <li>Run setup commands in Termux:</li>
            </ol>
            <pre className="my-3 overflow-x-auto rounded-md bg-black/50 px-3 py-2 text-xs leading-relaxed text-neutral-100">pkg update && pkg upgrade -y
pkg install rclone -y
rclone config</pre>
            <p className="my-2 text-xs text-neutral-300">
              Create your remote in{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-neutral-100">rclone config</code>{' '}
              (SFTP/WebDAV/Drive/etc). For encrypted remotes, create a{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-neutral-100">crypt</code> remote that wraps
              your base remote.
            </p>
            <ol start={3} className="list-decimal space-y-2 pl-5 text-neutral-300">
              <li>Start rclone daemon in Termux:</li>
            </ol>
            <pre className="my-3 overflow-x-auto rounded-md bg-black/50 px-3 py-2 text-xs leading-relaxed text-neutral-100">rclone rcd --rc-addr=0.0.0.0:5572 --rc-no-auth</pre>
            <p className="my-2 text-xs text-neutral-300">More secure option (recommended on shared networks):</p>
            <pre className="my-3 overflow-x-auto rounded-md bg-black/50 px-3 py-2 text-xs leading-relaxed text-neutral-100">rclone rcd --rc-addr=0.0.0.0:5572 --rc-user=myuser --rc-pass=mypassword</pre>
            <ol start={4} className="list-decimal space-y-2 pl-5 text-neutral-300">
              <li>Find Android phone IP on Wi-Fi (same network as this app).</li>
              <li>Enter Host and Port above, then click <strong>Test Connection</strong>.</li>
              <li>Click <strong>Save Configuration</strong>, then add/import rclone remotes.</li>
            </ol>
            <p className="mt-2 text-xs text-neutral-300">
              Tip: keep Termux awake while indexing large remote folders. If connection fails, verify phone and server
              are on the same LAN and port{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5 text-neutral-100">5572</code> is reachable.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleTestConnection}
            disabled={!config.host || testing || loading}
            title="Test connection to rclone daemon"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button
            className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleDisable}
            disabled={!config.enabled || loading}
            title="Disable remote rclone and use local mode"
          >
            Disable Remote
          </button>
          <button
            className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleSave}
            disabled={!config.host || loading}
          >
            {loading ? 'Saving...' : 'Save Configuration'}
          </button>
          <button
            className="rounded-md bg-white/10 px-4 py-2 text-sm font-semibold text-neutral-200 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
